const { tx } = require('../db');
const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');

const toApi = (s) => ({
  id: s.id, name: s.name, contactPerson: s.contact_person, phone: s.phone, email: s.email, address: s.address,
  categories: s.categories, leadTimeDays: s.lead_time_days, notes: s.notes, active: !!s.active,
});

function parse(input) {
  v.object(input);
  const email = v.str(input.email, 'email', { max: 200 });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('email is not valid');
  return {
    name: v.str(input.name, 'name', { required: true, max: 150 }),
    contact_person: v.str(input.contactPerson, 'contactPerson', { max: 100 }),
    phone: v.str(input.phone, 'phone', { max: 40 }),
    email,
    address: v.str(input.address, 'address', { max: 400 }),
    categories: v.str(input.categories, 'categories', { max: 300 }),
    lead_time_days: v.int(input.leadTimeDays ?? 7, 'leadTimeDays', { min: 0, max: 120 }),
    notes: v.str(input.notes, 'notes', { max: 1000 }),
  };
}

function list(db, { q = '', includeInactive = false } = {}) {
  const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
  const rows = db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM supplier_books sb WHERE sb.supplier_id = s.id) AS book_count,
           (SELECT COALESCE(SUM(total_cents), 0) FROM goods_receipts g WHERE g.supplier_id = s.id) AS purchased_cents
      FROM suppliers s
     WHERE (@all = 1 OR s.active = 1) AND (@q = '' OR s.name LIKE @like ESCAPE '\\' OR s.categories LIKE @like ESCAPE '\\' OR s.contact_person LIKE @like ESCAPE '\\')
     ORDER BY s.name`).all({ all: includeInactive ? 1 : 0, q, like });
  return rows.map((r) => ({ ...toApi(r), bookCount: r.book_count, totalPurchasedCents: r.purchased_cents }));
}

function get(db, id) {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) throw notFound('Supplier');
  const books = db.prepare(`SELECT sb.book_id, b.title, b.author, b.edition, b.isbn, sb.unit_cost_cents, sb.updated_at
                              FROM supplier_books sb JOIN books b ON b.id = sb.book_id WHERE sb.supplier_id = ? ORDER BY b.title`).all(id);
  const orders = db.prepare(`
    SELECT po.id, po.po_no, po.status, po.created_at, po.expected_date,
           (SELECT COALESCE(SUM(qty_ordered * unit_cost_cents), 0) FROM purchase_order_items WHERE po_id = po.id) AS ordered_cents,
           (SELECT COALESCE(SUM(quantity * unit_cost_cents), 0) FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id WHERE g.po_id = po.id) AS received_cents
      FROM purchase_orders po WHERE po.supplier_id = ? ORDER BY po.id DESC LIMIT 50`).all(id);
  const spent = db.prepare('SELECT COALESCE(SUM(total_cents), 0) s FROM goods_receipts WHERE supplier_id = ?').get(id).s;
  return {
    ...toApi(s),
    totalPurchasedCents: spent,
    books: books.map((b) => ({ bookId: b.book_id, title: b.title, author: b.author, edition: b.edition, isbn: b.isbn, unitCostCents: b.unit_cost_cents, updatedAt: b.updated_at })),
    purchaseOrders: orders.map((o) => ({ id: o.id, poNo: o.po_no, status: o.status, createdAt: o.created_at, expectedDate: o.expected_date, orderedCents: o.ordered_cents, receivedCents: o.received_cents })),
  };
}

function wrapUnique(fn) {
  try { return fn(); } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT_UNIQUE')) throw conflict('A supplier with this name already exists');
    throw e;
  }
}

function create(db, input) {
  const f = parse(input);
  const id = wrapUnique(() => db.prepare(`INSERT INTO suppliers(name, contact_person, phone, email, address, categories, lead_time_days, notes)
    VALUES (@name, @contact_person, @phone, @email, @address, @categories, @lead_time_days, @notes)`).run(f).lastInsertRowid);
  return get(db, Number(id));
}

function update(db, id, input) {
  const f = parse(input);
  const r = wrapUnique(() => db.prepare(`UPDATE suppliers SET name=@name, contact_person=@contact_person, phone=@phone, email=@email,
    address=@address, categories=@categories, lead_time_days=@lead_time_days, notes=@notes WHERE id=@id`).run({ ...f, id }));
  if (!r.changes) throw notFound('Supplier');
  return get(db, id);
}

function setActive(db, id, active) {
  const r = db.prepare('UPDATE suppliers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (!r.changes) throw notFound('Supplier');
  return get(db, id);
}

// Record/replace a supplier's quoted price for a book.
function setBookPrice(db, supplierId, bookId, input) {
  v.object(input);
  const cost = v.int(input.unitCostCents, 'unitCostCents', { min: 0, max: 1e9 });
  return tx(db, () => {
    if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw notFound('Supplier');
    if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw notFound('Book');
    db.prepare(`INSERT INTO supplier_books(supplier_id, book_id, unit_cost_cents, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(supplier_id, book_id) DO UPDATE SET unit_cost_cents = excluded.unit_cost_cents, updated_at = excluded.updated_at`)
      .run(supplierId, bookId, cost, new Date().toISOString());
    return get(db, supplierId);
  });
}

function removeBook(db, supplierId, bookId) {
  db.prepare('DELETE FROM supplier_books WHERE supplier_id = ? AND book_id = ?').run(supplierId, bookId);
  return get(db, supplierId);
}

// Every supplier that can provide a book, cheapest first, with purchase history for comparison.
function suppliersForBook(db, bookId) {
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw notFound('Book');
  const rows = db.prepare(`
    SELECT s.id, s.name, s.phone, s.email, s.lead_time_days, sb.unit_cost_cents, sb.updated_at,
           (SELECT COALESCE(SUM(gi.quantity), 0) FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id
             WHERE g.supplier_id = s.id AND gi.book_id = sb.book_id) AS qty_bought,
           (SELECT MAX(g.received_at) FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id
             WHERE g.supplier_id = s.id AND gi.book_id = sb.book_id) AS last_received_at,
           (SELECT gi.unit_cost_cents FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id
             WHERE g.supplier_id = s.id AND gi.book_id = sb.book_id ORDER BY g.received_at DESC, gi.id DESC LIMIT 1) AS last_paid_cents
      FROM supplier_books sb JOIN suppliers s ON s.id = sb.supplier_id
     WHERE sb.book_id = ? AND s.active = 1 ORDER BY sb.unit_cost_cents, s.lead_time_days, s.name`).all(bookId);
  const cheapest = rows.length ? rows[0].unit_cost_cents : null;
  return rows.map((r) => ({
    supplierId: r.id, name: r.name, phone: r.phone, email: r.email, leadTimeDays: r.lead_time_days,
    unitCostCents: r.unit_cost_cents, quotedAt: r.updated_at, isCheapest: r.unit_cost_cents === cheapest,
    qtyPurchased: r.qty_bought, lastReceivedAt: r.last_received_at, lastPaidCents: r.last_paid_cents,
  }));
}

module.exports = { list, get, create, update, setActive, setBookPrice, removeBook, suppliersForBook };
