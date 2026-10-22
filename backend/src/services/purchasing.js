const { tx } = require('../db');
const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { applyStock } = require('./inventory');

const OPEN_STATUSES = ['ordered', 'partially_received'];

function poToApi(db, po) {
  const supplier = db.prepare('SELECT id, name, phone, email FROM suppliers WHERE id = ?').get(po.supplier_id);
  const items = db.prepare(`SELECT i.*, b.title, b.author, b.edition, b.isbn FROM purchase_order_items i JOIN books b ON b.id = i.book_id
                             WHERE i.po_id = ? ORDER BY i.id`).all(po.id);
  const receipts = db.prepare(`SELECT g.id, g.total_cents, g.note, g.received_at, u.username
                                 FROM goods_receipts g LEFT JOIN users u ON u.id = g.user_id WHERE g.po_id = ? ORDER BY g.id`).all(po.id);
  return {
    id: po.id, poNo: po.po_no, status: po.status, notes: po.notes, expectedDate: po.expected_date, createdAt: po.created_at,
    supplier: supplier ? { id: supplier.id, name: supplier.name, phone: supplier.phone, email: supplier.email } : null,
    orderedCents: items.reduce((s, i) => s + i.qty_ordered * i.unit_cost_cents, 0),
    receivedCents: receipts.reduce((s, r) => s + r.total_cents, 0),
    items: items.map((i) => ({
      id: i.id, bookId: i.book_id, title: i.title, author: i.author, edition: i.edition, isbn: i.isbn,
      qtyOrdered: i.qty_ordered, qtyReceived: i.qty_received, qtyOutstanding: i.qty_ordered - i.qty_received, unitCostCents: i.unit_cost_cents,
    })),
    receipts: receipts.map((r) => ({ id: r.id, totalCents: r.total_cents, note: r.note, receivedAt: r.received_at, user: r.username })),
  };
}

function loadPo(db, id) {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
  if (!po) throw notFound('Purchase order');
  return po;
}

function createPo(db, user, input) {
  v.object(input);
  const supplierId = v.int(input.supplierId, 'supplierId', { min: 1 });
  const items = v.array(input.items, 'items', { max: 200 });
  const expectedDate = v.date(input.expectedDate, 'expectedDate', { required: false });
  const notes = v.str(input.notes, 'notes', { max: 500 });
  const lines = new Map();
  for (const [n, it] of items.entries()) {
    v.object(it, `items[${n}]`);
    const bookId = v.int(it.bookId, `items[${n}].bookId`, { min: 1 });
    if (lines.has(bookId)) throw badRequest(`Book #${bookId} appears more than once; combine the quantities`);
    lines.set(bookId, {
      qty: v.int(it.quantity, `items[${n}].quantity`, { min: 1, max: 1e6 }),
      cost: v.int(it.unitCostCents, `items[${n}].unitCostCents`, { min: 0, max: 1e9, required: false }),
    });
  }
  const id = tx(db, () => {
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
    if (!supplier) throw notFound('Supplier');
    if (!supplier.active) throw conflict('This supplier is inactive');
    const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM purchase_orders').get().m;
    const poNo = `PO-${String(last + 1).padStart(5, '0')}`;
    const r = db.prepare('INSERT INTO purchase_orders(po_no, supplier_id, notes, expected_date, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(poNo, supplierId, notes, expectedDate, user.id);
    const poId = Number(r.lastInsertRowid);
    for (const [bookId, l] of lines) {
      const book = db.prepare('SELECT title FROM books WHERE id = ?').get(bookId);
      if (!book) throw notFound(`Book #${bookId}`);
      // Cost defaults to this supplier's quoted price; if neither exists the owner must state it.
      const quote = db.prepare('SELECT unit_cost_cents FROM supplier_books WHERE supplier_id = ? AND book_id = ?').get(supplierId, bookId);
      const cost = l.cost ?? (quote ? quote.unit_cost_cents : null);
      if (cost === null) throw badRequest(`Unit cost is required for "${book.title}" (no quoted price from this supplier)`);
      db.prepare('INSERT INTO purchase_order_items(po_id, book_id, qty_ordered, unit_cost_cents) VALUES (?, ?, ?, ?)').run(poId, bookId, l.qty, cost);
    }
    return poId;
  });
  return poToApi(db, loadPo(db, id));
}

function listPos(db, { status = '', supplierId = null } = {}) {
  const where = [];
  const params = {};
  if (status === 'open') where.push("po.status IN ('ordered','partially_received')");
  else if (status) { where.push('po.status = @status'); params.status = v.oneOf(status, 'status', ['ordered', 'partially_received', 'received', 'cancelled']); }
  if (supplierId) { where.push('po.supplier_id = @sid'); params.sid = Number(supplierId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT po.id, po.po_no, po.status, po.created_at, po.expected_date, s.name AS supplier,
           (SELECT COALESCE(SUM(qty_ordered * unit_cost_cents), 0) FROM purchase_order_items WHERE po_id = po.id) AS ordered_cents,
           (SELECT COALESCE(SUM(qty_ordered), 0) FROM purchase_order_items WHERE po_id = po.id) AS units_ordered,
           (SELECT COALESCE(SUM(qty_received), 0) FROM purchase_order_items WHERE po_id = po.id) AS units_received
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id ${w} ORDER BY po.id DESC LIMIT 200`).all(params)
    .map((r) => ({ id: r.id, poNo: r.po_no, status: r.status, supplier: r.supplier, createdAt: r.created_at, expectedDate: r.expected_date,
      orderedCents: r.ordered_cents, unitsOrdered: r.units_ordered, unitsReceived: r.units_received }));
}

function getPo(db, id) {
  return poToApi(db, loadPo(db, id));
}

function cancelPo(db, id) {
  tx(db, () => {
    const po = loadPo(db, id);
    if (!OPEN_STATUSES.includes(po.status)) throw conflict(`A ${po.status.replace(/_/g, ' ')} purchase order cannot be cancelled`);
    db.prepare("UPDATE purchase_orders SET status='cancelled' WHERE id=?").run(id);
  });
  return getPo(db, id);
}

/**
 * Goods receipt: increases stock by the quantities actually received (possibly less than ordered), updates the
 * weighted-average cost and the supplier's price, and moves the PO to partially_received/received. One transaction.
 * A repeated idempotencyKey returns the original receipt instead of receiving twice.
 */
function receive(db, user, poId, input) {
  v.object(input);
  const items = v.array(input.items, 'items', { max: 200 });
  const note = v.str(input.note, 'note', { max: 300 });
  const key = input.idempotencyKey ? v.str(input.idempotencyKey, 'idempotencyKey', { max: 100 }) : null;
  const wanted = new Map();
  for (const [n, it] of items.entries()) {
    v.object(it, `items[${n}]`);
    const itemId = v.int(it.poItemId, `items[${n}].poItemId`, { min: 1 });
    if (wanted.has(itemId)) throw badRequest('The same purchase-order line appears more than once');
    wanted.set(itemId, {
      qty: v.int(it.quantity, `items[${n}].quantity`, { min: 0, max: 1e6 }),
      cost: v.int(it.unitCostCents, `items[${n}].unitCostCents`, { min: 0, max: 1e9, required: false }),
    });
  }
  const receiptId = tx(db, () => {
    if (key) {
      const prior = db.prepare('SELECT id, po_id FROM goods_receipts WHERE idempotency_key = ?').get(key);
      if (prior) {
        if (prior.po_id !== poId) throw conflict('This idempotency key was already used for a different purchase order');
        return { id: prior.id, duplicate: true };
      }
    }
    const po = loadPo(db, poId);
    if (!OPEN_STATUSES.includes(po.status)) throw conflict(`This purchase order is ${po.status.replace(/_/g, ' ')} and cannot receive goods`);
    const received = [...wanted.entries()].filter(([, w]) => w.qty > 0);
    if (!received.length) throw badRequest('Enter a received quantity for at least one line');
    const r = db.prepare('INSERT INTO goods_receipts(po_id, supplier_id, total_cents, note, idempotency_key, user_id) VALUES (?, ?, 0, ?, ?, ?)')
      .run(poId, po.supplier_id, note, key, user.id);
    const rid = Number(r.lastInsertRowid);
    let total = 0;
    for (const [itemId, w] of received) {
      const line = db.prepare('SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?').get(itemId, poId);
      if (!line) throw badRequest(`Line #${itemId} does not belong to this purchase order`);
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(line.book_id);
      const outstanding = line.qty_ordered - line.qty_received;
      if (w.qty > outstanding) throw conflict(`"${book.title}": ${w.qty} received but only ${outstanding} still outstanding on this order`);
      const cost = w.cost ?? line.unit_cost_cents;
      db.prepare('UPDATE purchase_order_items SET qty_received = qty_received + ? WHERE id = ?').run(w.qty, itemId);
      db.prepare('INSERT INTO goods_receipt_items(receipt_id, po_item_id, book_id, quantity, unit_cost_cents) VALUES (?, ?, ?, ?, ?)')
        .run(rid, itemId, line.book_id, w.qty, cost);
      // Weighted-average cost; unknown (0) existing cost is replaced rather than averaged in.
      const newCost = book.cost_cents === 0 || book.stock_qty === 0
        ? cost
        : Math.round((book.stock_qty * book.cost_cents + w.qty * cost) / (book.stock_qty + w.qty));
      db.prepare('UPDATE books SET cost_cents = ? WHERE id = ?').run(newCost, line.book_id);
      applyStock(db, { bookId: line.book_id, stockDelta: w.qty, reason: 'receipt', refType: 'goods_receipt', refId: rid, note: po.po_no, userId: user.id });
      db.prepare(`INSERT INTO supplier_books(supplier_id, book_id, unit_cost_cents, updated_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT(supplier_id, book_id) DO UPDATE SET unit_cost_cents = excluded.unit_cost_cents, updated_at = excluded.updated_at`)
        .run(po.supplier_id, line.book_id, cost, new Date().toISOString());
      total += w.qty * cost;
    }
    db.prepare('UPDATE goods_receipts SET total_cents = ? WHERE id = ?').run(total, rid);
    const open = db.prepare('SELECT COUNT(*) c FROM purchase_order_items WHERE po_id = ? AND qty_received < qty_ordered').get(poId).c;
    db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(open ? 'partially_received' : 'received', poId);
    return { id: rid, duplicate: false };
  });
  return { purchaseOrder: getPo(db, poId), receiptId: receiptId.id, duplicate: receiptId.duplicate };
}

module.exports = { createPo, listPos, getPo, cancelPo, receive };
