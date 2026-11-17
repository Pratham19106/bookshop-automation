const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { requireShop } = require('../lib/tenant');
const { formatNumber } = require('../lib/counters');
const { applyStock } = require('./inventory');

const OPEN_STATUSES = ['ordered', 'partially_received'];

async function poToApi(q, po) {
  const supplier = await q.one('SELECT id, name, phone, email FROM suppliers WHERE id = $1', [po.supplier_id]);
  const items = await q.many(`SELECT i.*, b.title, b.author, b.edition, b.isbn FROM purchase_order_items i JOIN books b ON b.id = i.book_id
                               WHERE i.po_id = $1 ORDER BY i.id`, [po.id]);
  const receipts = await q.many(`SELECT g.id, g.total_cents, g.note, g.received_at, u.username
                                   FROM goods_receipts g LEFT JOIN users u ON u.id = g.user_id WHERE g.po_id = $1 ORDER BY g.id`, [po.id]);
  return {
    id: po.id, poNo: po.po_no, shopId: po.shop_id, status: po.status, notes: po.notes, expectedDate: po.expected_date, createdAt: po.created_at,
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

// Purchase orders belong to the shop that will receive the goods.
async function loadPo(q, ctx, id, { lock = false } = {}) {
  const po = await q.one(`SELECT * FROM purchase_orders WHERE id = $1 AND business_id = $2 AND shop_id = $3 ${lock ? 'FOR UPDATE' : ''}`,
    [id, ctx.businessId, requireShop(ctx)]);
  if (!po) throw notFound('Purchase order');
  return po;
}

async function createPo(ctx, input) {
  v.object(input);
  const shopId = requireShop(ctx);
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
      cost: v.money(it.unitCostCents, `items[${n}].unitCostCents`, { min: 0, max: 1e9, required: false }),
    });
  }
  const id = await ctx.db.tx(async (q) => {
    const supplier = await q.one('SELECT * FROM suppliers WHERE id = $1 AND business_id = $2', [supplierId, ctx.businessId]);
    if (!supplier) throw notFound('Supplier');
    if (!supplier.active) throw conflict('This supplier is inactive');
    const poNo = await formatNumber(q, shopId, 'po', 'PO', 5);
    const { id: poId } = await q.one(`INSERT INTO purchase_orders(business_id, shop_id, po_no, supplier_id, notes, expected_date, created_by)
                                      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ctx.businessId, shopId, poNo, supplierId, notes, expectedDate, ctx.user.id]);
    for (const [bookId, l] of lines) {
      const book = await q.one('SELECT title FROM books WHERE id = $1 AND business_id = $2', [bookId, ctx.businessId]);
      if (!book) throw notFound(`Book #${bookId}`);
      // Cost defaults to this supplier's quoted price; if neither exists it must be stated.
      const quote = await q.one('SELECT unit_cost_cents FROM supplier_books WHERE supplier_id = $1 AND book_id = $2', [supplierId, bookId]);
      const cost = l.cost ?? (quote ? quote.unit_cost_cents : null);
      if (cost === null) throw badRequest(`Unit cost is required for "${book.title}" (no quoted price from this supplier)`);
      await q.query('INSERT INTO purchase_order_items(po_id, book_id, qty_ordered, unit_cost_cents) VALUES ($1, $2, $3, $4)', [poId, bookId, l.qty, cost]);
    }
    return poId;
  });
  return getPo(ctx, id);
}

async function listPos(ctx, { status = '', supplierId = null } = {}) {
  const params = [ctx.businessId, requireShop(ctx)];
  const p = (val) => { params.push(val); return `$${params.length}`; };
  const where = ['po.business_id = $1', 'po.shop_id = $2'];
  if (status === 'open') where.push("po.status IN ('ordered','partially_received')");
  else if (status) where.push(`po.status = ${p(v.oneOf(status, 'status', ['ordered', 'partially_received', 'received', 'cancelled']))}`);
  if (supplierId) where.push(`po.supplier_id = ${p(Number(supplierId))}`);
  const rows = await ctx.db.many(`
    SELECT po.id, po.po_no, po.status, po.created_at, po.expected_date, s.name AS supplier,
           COALESCE(SUM(i.qty_ordered * i.unit_cost_cents), 0) AS ordered_cents,
           COALESCE(SUM(i.qty_ordered), 0) AS units_ordered,
           COALESCE(SUM(i.qty_received), 0) AS units_received
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN purchase_order_items i ON i.po_id = po.id
     WHERE ${where.join(' AND ')}
     GROUP BY po.id, s.name ORDER BY po.id DESC LIMIT 200`, params);
  return rows.map((r) => ({ id: r.id, poNo: r.po_no, status: r.status, supplier: r.supplier, createdAt: r.created_at, expectedDate: r.expected_date,
    orderedCents: r.ordered_cents, unitsOrdered: r.units_ordered, unitsReceived: r.units_received }));
}

async function getPo(ctx, id) {
  return poToApi(ctx.db, await loadPo(ctx.db, ctx, id));
}

async function cancelPo(ctx, id) {
  await ctx.db.tx(async (q) => {
    const po = await loadPo(q, ctx, id, { lock: true });
    if (!OPEN_STATUSES.includes(po.status)) throw conflict(`A ${po.status.replace(/_/g, ' ')} purchase order cannot be cancelled`);
    await q.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [id]);
  });
  return getPo(ctx, id);
}

/**
 * Goods receipt: increases the shop's stock by the quantities actually received (possibly less than ordered),
 * updates the shop's weighted-average cost and the supplier's quoted price, and moves the PO to
 * partially_received / received. One transaction. A repeated idempotencyKey returns the original receipt.
 */
async function receive(ctx, poId, input) {
  v.object(input);
  const shopId = requireShop(ctx);
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
      cost: v.money(it.unitCostCents, `items[${n}].unitCostCents`, { min: 0, max: 1e9, required: false }),
    });
  }
  const result = await ctx.db.tx(async (q) => {
    // The PO row lock serialises receipts against the same order (and against a retried request).
    const po = await loadPo(q, ctx, poId, { lock: true });
    if (key) {
      const prior = await q.one('SELECT id, po_id FROM goods_receipts WHERE shop_id = $1 AND idempotency_key = $2', [shopId, key]);
      if (prior) {
        if (prior.po_id !== poId) throw conflict('This idempotency key was already used for a different purchase order');
        return { id: prior.id, duplicate: true };
      }
    }
    if (!OPEN_STATUSES.includes(po.status)) throw conflict(`This purchase order is ${po.status.replace(/_/g, ' ')} and cannot receive goods`);
    const received = [...wanted.entries()].filter(([, w]) => w.qty > 0);
    if (!received.length) throw badRequest('Enter a received quantity for at least one line');
    const lockLines = await q.many('SELECT id,book_id FROM purchase_order_items WHERE po_id=$1 AND id=ANY($2::bigint[]) ORDER BY book_id', [poId,received.map(([id])=>id)]);
    if (lockLines.length !== received.length) throw badRequest('A line does not belong to this purchase order');
    for (const line of lockLines) await q.query('INSERT INTO shop_stock(business_id,shop_id,book_id) VALUES($1,$2,$3) ON CONFLICT(shop_id,book_id) DO NOTHING',[ctx.businessId,shopId,line.book_id]);
    await q.many('SELECT book_id FROM shop_stock WHERE shop_id=$1 AND book_id=ANY($2::bigint[]) ORDER BY book_id FOR UPDATE',[shopId,lockLines.map(line=>line.book_id)]);
    const order = new Map(lockLines.map((line,index)=>[line.id,index]));
    received.sort((a,b)=>order.get(a[0])-order.get(b[0]));
    const { id: rid } = await q.one(`INSERT INTO goods_receipts(business_id, shop_id, po_id, supplier_id, note, idempotency_key, user_id)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [ctx.businessId, shopId, poId, po.supplier_id, note, key, ctx.user.id]);
    let total = 0;
    for (const [itemId, w] of received) {
      const line = await q.one(`SELECT i.*, b.title FROM purchase_order_items i JOIN books b ON b.id = i.book_id
                                 WHERE i.id = $1 AND i.po_id = $2`, [itemId, poId]);
      if (!line) throw badRequest(`Line #${itemId} does not belong to this purchase order`);
      const outstanding = line.qty_ordered - line.qty_received;
      if (w.qty > outstanding) throw conflict(`"${line.title}": ${w.qty} received but only ${outstanding} still outstanding on this order`);
      const cost = w.cost ?? line.unit_cost_cents;
      await q.query('UPDATE purchase_order_items SET qty_received = qty_received + $2 WHERE id = $1', [itemId, w.qty]);
      await q.query('INSERT INTO goods_receipt_items(receipt_id, po_item_id, book_id, quantity, unit_cost_cents) VALUES ($1, $2, $3, $4, $5)',
        [rid, itemId, line.book_id, w.qty, cost]);
      // Weighted-average cost, computed before the stock rises; an unknown (0) cost is replaced, not averaged in.
      await q.query(`INSERT INTO shop_stock(business_id, shop_id, book_id) VALUES ($1, $2, $3) ON CONFLICT (shop_id, book_id) DO NOTHING`,
        [ctx.businessId, shopId, line.book_id]);
      await q.query(`UPDATE shop_stock
                        SET cost_cents = CASE WHEN cost_cents = 0 OR stock_qty = 0 THEN $3::int
                                              ELSE (ROUND((stock_qty::numeric * cost_cents + $4::int * $3::numeric) / (stock_qty + $4::int) / 100) * 100)::int END
                      WHERE shop_id = $1 AND book_id = $2`, [shopId, line.book_id, cost, w.qty]);
      await applyStock(q, ctx, { bookId: line.book_id, stockDelta: w.qty, reason: 'receipt', refType: 'goods_receipt', refId: rid, note: po.po_no });
      await q.query(`INSERT INTO supplier_books(business_id, supplier_id, book_id, unit_cost_cents) VALUES ($1, $2, $3, $4)
                     ON CONFLICT (supplier_id, book_id) DO UPDATE SET unit_cost_cents = EXCLUDED.unit_cost_cents, updated_at = now()`,
      [ctx.businessId, po.supplier_id, line.book_id, cost]);
      total += w.qty * cost;
    }
    await q.query('UPDATE goods_receipts SET total_cents = $2 WHERE id = $1', [rid, total]);
    const { n } = await q.one('SELECT COUNT(*) AS n FROM purchase_order_items WHERE po_id = $1 AND qty_received < qty_ordered', [poId]);
    await q.query('UPDATE purchase_orders SET status = $2 WHERE id = $1', [poId, n ? 'partially_received' : 'received']);
    return { id: rid, duplicate: false };
  });
  return { purchaseOrder: await getPo(ctx, poId), receiptId: result.id, duplicate: result.duplicate };
}

module.exports = { createPo, listPos, getPo, cancelPo, receive };
