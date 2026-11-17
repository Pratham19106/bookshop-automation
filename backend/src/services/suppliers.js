const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { likeEscape } = require('./inventory');

// Suppliers are shared by all shops of a business; purchase history shown here is business-wide.

const toApi = (s) => ({
  id: s.id, name: s.name, contactPerson: s.contact_person, phone: s.phone, email: s.email, address: s.address,
  categories: s.categories, leadTimeDays: s.lead_time_days, notes: s.notes, active: s.active,
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

async function list(ctx, { q = '', includeInactive = false } = {}) {
  const rows = await ctx.db.many(`
    SELECT s.*,
           (SELECT COUNT(*) FROM supplier_books sb WHERE sb.supplier_id = s.id) AS book_count,
           (SELECT COALESCE(SUM(total_cents), 0) FROM goods_receipts g WHERE g.supplier_id = s.id) AS purchased_cents
      FROM suppliers s
     WHERE s.business_id = $1 AND ($2 OR s.active)
       AND ($3 = '' OR s.name ILIKE $4 OR s.categories ILIKE $4 OR s.contact_person ILIKE $4)
     ORDER BY lower(s.name)`, [ctx.businessId, !!includeInactive, String(q), `%${likeEscape(q)}%`]);
  return rows.map((r) => ({ ...toApi(r), bookCount: r.book_count, totalPurchasedCents: r.purchased_cents }));
}

async function loadSupplier(q, ctx, id) {
  const s = await q.one('SELECT * FROM suppliers WHERE id = $1 AND business_id = $2', [id, ctx.businessId]);
  if (!s) throw notFound('Supplier');
  return s;
}

async function get(ctx, id, q = ctx.db) {
  const s = await loadSupplier(q, ctx, id);
  const books = await q.many(`SELECT sb.book_id, b.title, b.author, b.edition, b.isbn, sb.unit_cost_cents, sb.updated_at
                                FROM supplier_books sb JOIN books b ON b.id = sb.book_id WHERE sb.supplier_id = $1 ORDER BY b.title`, [id]);
  const orders = await q.many(`
    SELECT po.id, po.po_no, po.status, po.created_at, po.expected_date, sh.name AS shop_name,
           (SELECT COALESCE(SUM(qty_ordered * unit_cost_cents), 0) FROM purchase_order_items WHERE po_id = po.id) AS ordered_cents,
           (SELECT COALESCE(SUM(gi.quantity * gi.unit_cost_cents), 0) FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id WHERE g.po_id = po.id) AS received_cents
      FROM purchase_orders po JOIN shops sh ON sh.id = po.shop_id
     WHERE po.supplier_id = $1 ORDER BY po.id DESC LIMIT 50`, [id]);
  const { s: spent } = await q.one('SELECT COALESCE(SUM(total_cents), 0) AS s FROM goods_receipts WHERE supplier_id = $1', [id]);
  return {
    ...toApi(s),
    totalPurchasedCents: spent,
    books: books.map((b) => ({ bookId: b.book_id, title: b.title, author: b.author, edition: b.edition, isbn: b.isbn, unitCostCents: b.unit_cost_cents, updatedAt: b.updated_at })),
    purchaseOrders: orders.map((o) => ({ id: o.id, poNo: o.po_no, status: o.status, shopName: o.shop_name, createdAt: o.created_at, expectedDate: o.expected_date, orderedCents: o.ordered_cents, receivedCents: o.received_cents })),
  };
}

async function wrapUnique(fn) {
  try { return await fn(); } catch (e) {
    if (e.code === '23505') throw conflict('A supplier with this name already exists');
    throw e;
  }
}

const FIELDS = ['name', 'contact_person', 'phone', 'email', 'address', 'categories', 'lead_time_days', 'notes'];

async function create(ctx, input) {
  const f = parse(input);
  const { id } = await wrapUnique(() => ctx.db.one(
    `INSERT INTO suppliers(business_id, ${FIELDS.join(', ')}) VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [ctx.businessId, ...FIELDS.map((k) => f[k])]));
  return get(ctx, id);
}

async function update(ctx, id, input) {
  const f = parse(input);
  const n = await wrapUnique(() => ctx.db.run(
    `UPDATE suppliers SET ${FIELDS.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND business_id = $2`,
    [id, ctx.businessId, ...FIELDS.map((k) => f[k])]));
  if (!n) throw notFound('Supplier');
  return get(ctx, id);
}

async function setActive(ctx, id, active) {
  const n = await ctx.db.run('UPDATE suppliers SET active = $3 WHERE id = $1 AND business_id = $2', [id, ctx.businessId, !!active]);
  if (!n) throw notFound('Supplier');
  return get(ctx, id);
}

// Record / replace a supplier's quoted price for a title.
async function setBookPrice(ctx, supplierId, bookId, input) {
  v.object(input);
  const cost = v.money(input.unitCostCents, 'unitCostCents', { min: 0, max: 1e9 });
  return ctx.db.tx(async (q) => {
    await loadSupplier(q, ctx, supplierId);
    if (!(await q.one('SELECT 1 FROM books WHERE id = $1 AND business_id = $2', [bookId, ctx.businessId]))) throw notFound('Book');
    await q.query(`INSERT INTO supplier_books(business_id, supplier_id, book_id, unit_cost_cents) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (supplier_id, book_id) DO UPDATE SET unit_cost_cents = EXCLUDED.unit_cost_cents, updated_at = now()`,
    [ctx.businessId, supplierId, bookId, cost]);
    return get(ctx, supplierId, q);
  });
}

async function removeBook(ctx, supplierId, bookId) {
  await loadSupplier(ctx.db, ctx, supplierId);
  await ctx.db.run('DELETE FROM supplier_books WHERE supplier_id = $1 AND book_id = $2', [supplierId, bookId]);
  return get(ctx, supplierId);
}

// Every supplier that can provide a title, cheapest first, with purchase history for comparison.
async function suppliersForBook(ctx, bookId) {
  if (!(await ctx.db.one('SELECT 1 FROM books WHERE id = $1 AND business_id = $2', [bookId, ctx.businessId]))) throw notFound('Book');
  const rows = await ctx.db.many(`
    SELECT s.id, s.name, s.phone, s.email, s.lead_time_days, sb.unit_cost_cents, sb.updated_at,
           (SELECT COALESCE(SUM(gi.quantity), 0) FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id
             WHERE g.supplier_id = s.id AND gi.book_id = sb.book_id) AS qty_bought,
           (SELECT MAX(g.received_at) FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id
             WHERE g.supplier_id = s.id AND gi.book_id = sb.book_id) AS last_received_at,
           (SELECT gi.unit_cost_cents FROM goods_receipt_items gi JOIN goods_receipts g ON g.id = gi.receipt_id
             WHERE g.supplier_id = s.id AND gi.book_id = sb.book_id ORDER BY g.received_at DESC, gi.id DESC LIMIT 1) AS last_paid_cents
      FROM supplier_books sb JOIN suppliers s ON s.id = sb.supplier_id
     WHERE sb.book_id = $1 AND s.business_id = $2 AND s.active
     ORDER BY sb.unit_cost_cents, s.lead_time_days, s.name`, [bookId, ctx.businessId]);
  const cheapest = rows.length ? rows[0].unit_cost_cents : null;
  return rows.map((r) => ({
    supplierId: r.id, name: r.name, phone: r.phone, email: r.email, leadTimeDays: r.lead_time_days,
    unitCostCents: r.unit_cost_cents, quotedAt: r.updated_at, isCheapest: r.unit_cost_cents === cheapest,
    qtyPurchased: r.qty_bought, lastReceivedAt: r.last_received_at, lastPaidCents: r.last_paid_cents,
  }));
}

module.exports = { list, get, create, update, setActive, setBookPrice, removeBook, suppliersForBook };
