const v = require('../lib/validate');
const { computeTotals, percentToBp } = require('../lib/money');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { checkDiscount, requireShop } = require('../lib/tenant');
const { formatNumber } = require('../lib/counters');
const { getSettings } = require('./settings');
const { applyStock, loadBook, likeEscape } = require('./inventory');
const { recordSale, METHODS } = require('./sales');

/*
 * Phone-order lifecycle (fulfilment status), independent of payment status:
 *
 *   placed ──► ready ──► out_for_delivery ──► completed (bill created, stock deducted)
 *      │         │  ◄────────┘ (failed delivery)
 *      └─────────┴──────────────► cancelled (reservation released)
 *
 * Stock: copies are RESERVED in the order's shop when the order is placed (shop_stock.reserved_qty). They are
 * deducted exactly once, at completion, in the same transaction that creates the bill (sales.order_id is UNIQUE).
 * Payment: order_payments is a signed ledger (advances, refunds). Payment status is derived from it.
 * Revenue is only recognised when the order completes and becomes a sale; advance payments are not revenue.
 */
const OPEN = ['placed', 'ready', 'out_for_delivery'];
const TRANSITIONS = { placed: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['ready'] };

async function paidCents(q, orderId) {
  return (await q.one('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM order_payments WHERE order_id = $1', [orderId])).s;
}

function paymentStatus(order, paid, hadPayments) {
  if (order.status === 'cancelled') return paid > 0 ? 'refund_due' : hadPayments ? 'refunded' : 'unpaid';
  if (paid <= 0) return 'unpaid';
  return paid >= order.total_cents ? 'paid' : 'partial';
}

async function orderToApi(q, row) {
  const items = await q.many(`SELECT oi.*, COALESCE((SELECT string_agg(sh.aisle || ' · ' || sh.rack || ' · ' || sh.shelf || ' (' || x.qty || ')', ', ' ORDER BY sh.aisle,sh.rack,sh.shelf)
      FROM shelf_stock x JOIN shelves sh ON sh.id=x.shelf_id WHERE x.shop_id=$2 AND x.book_id=oi.book_id AND x.qty>0),'') AS location
                                FROM phone_order_items oi
                                LEFT JOIN shop_stock ss ON ss.book_id = oi.book_id AND ss.shop_id = $2
                               WHERE oi.order_id = $1 ORDER BY oi.id`, [row.id, row.shop_id]);
  const payments = await q.many(`SELECT p.id, p.amount_cents, p.method, p.note, p.created_at, u.username
                                   FROM order_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.order_id = $1 ORDER BY p.id`, [row.id]);
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  return {
    id: row.id, orderNo: row.order_no, shopId: row.shop_id, customerName: row.customer_name, customerPhone: row.customer_phone,
    deliveryType: row.delivery_type, deliveryAddress: row.delivery_address, promisedDate: row.promised_date,
    notes: row.notes, status: row.status,
    paymentStatus: paymentStatus(row, paid, payments.length > 0),
    discountPercent: row.discount_bp / 100, taxPercent: row.tax_bp / 100,
    subtotalCents: row.subtotal_cents, discountCents: row.discount_cents, taxCents: row.tax_cents, totalCents: row.total_cents,
    paidCents: paid, balanceCents: row.status === 'cancelled' ? 0 : Math.max(row.total_cents - paid, 0),
    saleId: row.sale_id, cancelReason: row.cancel_reason, createdAt: row.created_at, updatedAt: row.updated_at,
    items: items.map((i) => ({
      bookId: i.book_id, title: i.title, quantity: i.quantity, unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.quantity * i.unit_price_cents,
      location: i.location,
    })),
    payments: payments.map((p) => ({ id: p.id, amountCents: p.amount_cents, method: p.method, note: p.note, createdAt: p.created_at, user: p.username })),
  };
}

// Orders belong to the active shop. FOR UPDATE inside transactions serialises concurrent changes to one order.
async function loadOrder(q, ctx, id, { lock = false } = {}) {
  const row = await q.one(`SELECT * FROM phone_orders WHERE id = $1 AND business_id = $2 AND shop_id = $3 ${lock ? 'FOR UPDATE' : ''}`,
    [id, ctx.businessId, requireShop(ctx)]);
  if (!row) throw notFound('Order');
  return row;
}

function parseItems(input) {
  const items = v.array(input, 'items', { max: 100 });
  const wanted = new Map();
  for (const [n, it] of items.entries()) {
    v.object(it, `items[${n}]`);
    const bookId = v.int(it.bookId, `items[${n}].bookId`, { min: 1 });
    wanted.set(bookId, (wanted.get(bookId) || 0) + v.int(it.quantity, `items[${n}].quantity`, { min: 1, max: 100000 }));
  }
  return wanted;
}

function parseDetails(input) {
  const deliveryType = v.oneOf(input.deliveryType, 'deliveryType', ['pickup', 'delivery']);
  const deliveryAddress = v.str(input.deliveryAddress, 'deliveryAddress', { max: 400 });
  if (deliveryType === 'delivery' && !deliveryAddress) throw badRequest('deliveryAddress is required for delivery orders');
  const phone = v.str(input.customerPhone, 'customerPhone', { required: true, max: 30 });
  if (!/^[0-9+()\-\s]{6,30}$/.test(phone)) throw badRequest('customerPhone does not look like a phone number');
  return {
    customer_name: v.str(input.customerName, 'customerName', { required: true, max: 100 }),
    customer_phone: phone,
    delivery_type: deliveryType,
    delivery_address: deliveryType === 'delivery' ? deliveryAddress : '',
    promised_date: v.date(input.promisedDate, 'promisedDate', { required: false }),
    notes: v.str(input.notes, 'notes', { max: 500 }),
  };
}

// Reserve / release copies so the order's reservations match `target` (Map bookId -> qty), given `current`.
async function syncReservations(q, ctx, current, target, orderNo) {
  const ids = [...new Set([...current.keys(), ...target.keys()])].sort((a, b) => a - b);
  for (const bookId of ids) {
    const delta = (target.get(bookId) || 0) - (current.get(bookId) || 0);
    if (delta === 0) continue;
    if (delta > 0) {
      const b = await loadBook(q, ctx, bookId);
      if (!b.active) throw badRequest(`"${b.title}" is no longer sold`);
      const available = b.stock_qty - b.reserved_qty;
      if (delta > available) throw conflict(`Insufficient stock for "${b.title}": ${available} available to reserve, ${delta} more needed`, { bookId, available });
    }
    await applyStock(q, ctx, { bookId, reservedDelta: delta, reason: 'adjustment', refType: 'phone_order', note: orderNo });
  }
}

async function writeItemsAndTotals(q, ctx, orderId, target, priceFor, discountBp, taxBp) {
  await q.query('DELETE FROM phone_order_items WHERE order_id = $1', [orderId]);
  const lines = [];
  for (const [bookId, quantity] of target) {
    const b = await loadBook(q, ctx, bookId);
    const unitPriceCents = await priceFor(bookId);
    await q.query('INSERT INTO phone_order_items(order_id, book_id, title, quantity, unit_price_cents) VALUES ($1, $2, $3, $4, $5)',
      [orderId, bookId, b.title, quantity, unitPriceCents]);
    lines.push({ unitPriceCents, quantity });
  }
  const t = computeTotals(lines, discountBp, taxBp);
  await q.query(`UPDATE phone_orders SET subtotal_cents = $2, discount_cents = $3, tax_cents = $4, total_cents = $5, discount_bp = $6, tax_bp = $7, updated_at = now()
                  WHERE id = $1`, [orderId, t.subtotalCents, t.discountCents, t.taxCents, t.totalCents, discountBp, taxBp]);
  return t;
}

async function recordPayment(q, ctx, orderId, amountCents, method, note) {
  await q.query('INSERT INTO order_payments(order_id, amount_cents, method, note, user_id) VALUES ($1, $2, $3, $4, $5)',
    [orderId, amountCents, method, note, ctx.user.id]);
}

const touch = (q, id) => q.query('UPDATE phone_orders SET updated_at = now() WHERE id = $1', [id]);

async function createOrder(ctx, input) {
  v.object(input);
  const shopId = requireShop(ctx);
  const d = parseDetails(input);
  const wanted = parseItems(input.items);
  const discountBp = percentToBp(input.discountPercent, 'discountPercent');
  const advance = input.advancePayment ? v.object(input.advancePayment, 'advancePayment') : null;
  const advanceCents = advance ? v.money(advance.amountCents, 'advancePayment.amountCents', { min: 1, max: 1e11 }) : 0;
  const advanceMethod = advance ? v.oneOf(advance.method, 'advancePayment.method', METHODS) : null;

  const id = await ctx.db.tx(async (q) => {
    const settings = await getSettings(q, ctx.businessId);
    checkDiscount(ctx, settings, discountBp);
    const orderNo = await formatNumber(q, shopId, 'order', 'TEL', 5);
    const { id: orderId } = await q.one(`INSERT INTO phone_orders(business_id, shop_id, order_no, customer_name, customer_phone, delivery_type,
                                           delivery_address, promised_date, notes, created_by)
                                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [ctx.businessId, shopId, orderNo, d.customer_name, d.customer_phone, d.delivery_type, d.delivery_address, d.promised_date, d.notes, ctx.user.id]);
    await syncReservations(q, ctx, new Map(), wanted, orderNo);
    const totals = await writeItemsAndTotals(q, ctx, orderId, wanted, async (b) => (await loadBook(q, ctx, b)).price_cents, discountBp, settings.taxBp);
    if (advance) {
      if (advanceCents > totals.totalCents) throw badRequest('Advance payment cannot exceed the order total');
      await recordPayment(q, ctx, orderId, advanceCents, advanceMethod, 'Advance');
    }
    return orderId;
  });
  return getOrder(ctx, id);
}

async function getOrder(ctx, id) {
  return orderToApi(ctx.db, await loadOrder(ctx.db, ctx, id));
}

async function listOrders(ctx, { status = '', payment = '', q = '', limit = 50, offset = 0 } = {}) {
  const params = [ctx.businessId, requireShop(ctx)];
  const p = (val) => { params.push(val); return `$${params.length}`; };
  const where = ['o.business_id = $1', 'o.shop_id = $2'];
  if (status === 'open') where.push("o.status IN ('placed','ready','out_for_delivery')");
  else if (status) where.push(`o.status = ${p(v.oneOf(status, 'status', [...OPEN, 'completed', 'cancelled']))}`);
  if (q) {
    const like = p(`%${likeEscape(q)}%`);
    where.push(`(o.order_no ILIKE ${like} OR o.customer_name ILIKE ${like} OR o.customer_phone ILIKE ${like})`);
  }
  const rows = await ctx.db.many(`
    SELECT o.*, COALESCE(pay.paid, 0) AS paid, COALESCE(pay.n, 0) AS payments
      FROM phone_orders o
      LEFT JOIN (SELECT order_id, SUM(amount_cents) AS paid, COUNT(*) AS n FROM order_payments GROUP BY order_id) pay ON pay.order_id = o.id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN o.status IN ('placed','ready','out_for_delivery') THEN 0 ELSE 1 END, o.promised_date NULLS LAST, o.id DESC`, params);
  let items = rows.map((r) => ({
    id: r.id, orderNo: r.order_no, customerName: r.customer_name, customerPhone: r.customer_phone,
    deliveryType: r.delivery_type, promisedDate: r.promised_date, status: r.status,
    paymentStatus: paymentStatus(r, r.paid, r.payments > 0), totalCents: r.total_cents, paidCents: r.paid,
    saleId: r.sale_id, createdAt: r.created_at,
  }));
  if (payment) items = items.filter((o) => o.paymentStatus === payment);
  const off = Math.max(Number(offset) || 0, 0);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return { total: items.length, items: items.slice(off, off + lim) };
}

const itemMap = async (q, id, col) => new Map((await q.many(`SELECT book_id, ${col} AS v FROM phone_order_items WHERE order_id = $1`, [id])).map((r) => [r.book_id, r.v]));

async function modifyOrder(ctx, id, input) {
  v.object(input);
  const d = parseDetails(input);
  const wanted = parseItems(input.items);
  const discountBp = percentToBp(input.discountPercent, 'discountPercent');
  await ctx.db.tx(async (q) => {
    const order = await loadOrder(q, ctx, id, { lock: true });
    if (!['placed', 'ready'].includes(order.status)) throw conflict(`An order that is ${order.status.replace(/_/g, ' ')} can no longer be modified`);
    checkDiscount(ctx, await getSettings(q, ctx.businessId), discountBp);
    await syncReservations(q, ctx, await itemMap(q, id, 'quantity'), wanted, order.order_no);
    // Lines already on the order keep their agreed price; newly added books use today's price.
    const frozen = await itemMap(q, id, 'unit_price_cents');
    const priceFor = async (b) => frozen.get(b) ?? (await loadBook(q, ctx, b)).price_cents;
    const totals = await writeItemsAndTotals(q, ctx, id, wanted, priceFor, discountBp, order.tax_bp);
    const paid = await paidCents(q, id);
    if (paid > totals.totalCents) throw conflict(`The new total is less than the ${paid / 100} already paid; record a refund first`);
    await q.query(`UPDATE phone_orders SET customer_name = $2, customer_phone = $3, delivery_type = $4, delivery_address = $5,
                    promised_date = $6, notes = $7 WHERE id = $1`,
    [id, d.customer_name, d.customer_phone, d.delivery_type, d.delivery_address, d.promised_date, d.notes]);
  });
  return getOrder(ctx, id);
}

async function setStatus(ctx, id, input) {
  const next = v.oneOf(input && input.status, 'status', ['ready', 'out_for_delivery']);
  await ctx.db.tx(async (q) => {
    const order = await loadOrder(q, ctx, id, { lock: true });
    if (!(TRANSITIONS[order.status] || []).includes(next)) {
      throw conflict(`Cannot move an order from "${order.status.replace(/_/g, ' ')}" to "${next.replace(/_/g, ' ')}"`);
    }
    if (next === 'out_for_delivery' && order.delivery_type !== 'delivery') throw conflict('Only delivery orders can be sent out for delivery');
    await q.query('UPDATE phone_orders SET status = $2, updated_at = now() WHERE id = $1', [id, next]);
  });
  return getOrder(ctx, id);
}

async function cancelOrder(ctx, id, input) {
  const reason = v.str(input && input.reason, 'reason', { required: true, max: 300 });
  await ctx.db.tx(async (q) => {
    const order = await loadOrder(q, ctx, id, { lock: true });
    if (order.status === 'cancelled') throw conflict('This order is already cancelled');
    if (order.status === 'completed') throw conflict('A completed order cannot be cancelled; it has already been billed');
    await syncReservations(q, ctx, await itemMap(q, id, 'quantity'), new Map(), order.order_no);
    await q.query(`UPDATE phone_orders SET status = 'cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
  });
  return getOrder(ctx, id);
}

async function addPayment(ctx, id, input) {
  v.object(input);
  const amount = v.money(input.amountCents, 'amountCents', { min: 1, max: 1e11 });
  const method = v.oneOf(input.method, 'method', METHODS);
  await ctx.db.tx(async (q) => {
    const order = await loadOrder(q, ctx, id, { lock: true });
    if (!OPEN.includes(order.status)) throw conflict(`Payments cannot be added to a ${order.status} order`);
    const balance = order.total_cents - await paidCents(q, id);
    if (amount > balance) throw badRequest(`Payment exceeds the outstanding balance of ${balance / 100}`);
    await recordPayment(q, ctx, id, amount, method, v.str(input.note, 'note', { max: 200 }));
    await touch(q, id);
  });
  return getOrder(ctx, id);
}

async function refund(ctx, id, input) {
  v.object(input);
  const method = v.oneOf(input.method, 'method', METHODS);
  await ctx.db.tx(async (q) => {
    const order = await loadOrder(q, ctx, id, { lock: true });
    if (order.status === 'completed') throw conflict('A completed order has been billed; refunds are not handled here');
    const paid = await paidCents(q, id);
    if (paid <= 0) throw conflict('Nothing has been paid on this order');
    const amount = input.amountCents === undefined || input.amountCents === null ? paid : v.money(input.amountCents, 'amountCents', { min: 1, max: 1e11 });
    if (amount > paid) throw badRequest(`Refund exceeds the ${paid / 100} paid`);
    await recordPayment(q, ctx, id, -amount, method, v.str(input.note, 'note', { max: 200 }) || 'Refund');
    await touch(q, id);
  });
  return getOrder(ctx, id);
}

// Hand over / deliver: collects any balance, creates the bill, deducts stock, releases reservations.
// All-or-nothing, and safe to call twice (the row lock makes the second call see 'completed' and fail with 409).
async function fulfilOrder(ctx, id, input) {
  const method = input && input.paymentMethod !== undefined ? v.oneOf(input.paymentMethod, 'paymentMethod', METHODS) : null;
  await ctx.db.tx(async (q) => {
    const order = await loadOrder(q, ctx, id, { lock: true });
    if (order.status === 'completed') throw conflict(`This order was already fulfilled (bill #${order.sale_id})`, { saleId: order.sale_id });
    if (order.status === 'cancelled') throw conflict('A cancelled order cannot be fulfilled');
    if (order.status === 'placed') throw conflict('Mark the order as ready before handing it over');
    if (order.delivery_type === 'delivery' && order.status === 'ready') throw conflict('Send the order out for delivery first');
    const balance = order.total_cents - await paidCents(q, id);
    if (balance > 0 && !method) throw badRequest('paymentMethod is required to collect the outstanding balance');
    if (balance > 0) await recordPayment(q, ctx, id, balance, method, 'Balance collected on fulfilment');
    const lastPay = await q.one('SELECT method FROM order_payments WHERE order_id = $1 AND amount_cents > 0 ORDER BY id DESC LIMIT 1', [id]);
    const lines = (await q.many('SELECT book_id, quantity, unit_price_cents FROM phone_order_items WHERE order_id = $1', [id]))
      .map((r) => ({ bookId: r.book_id, quantity: r.quantity, unitPriceCents: r.unit_price_cents }));
    const { saleId } = await recordSale(q, ctx, {
      lines, discountBp: order.discount_bp, taxBp: order.tax_bp,
      paymentMethod: lastPay ? lastPay.method : (method || 'cash'),
      customerName: order.customer_name, orderId: id, fromReservation: true,
    });
    await q.query(`UPDATE phone_orders SET status = 'completed', sale_id = $2, updated_at = now() WHERE id = $1`, [id, saleId]);
  });
  return getOrder(ctx, id);
}

module.exports = { createOrder, getOrder, listOrders, modifyOrder, setStatus, cancelOrder, addPayment, refund, fulfilOrder };
