const { tx } = require('../db');
const v = require('../lib/validate');
const { computeTotals, percentToBp } = require('../lib/money');
const { conflict, notFound, forbidden, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');
const { applyStock } = require('./inventory');
const { recordSale, METHODS } = require('./sales');

/*
 * Phone-order lifecycle (fulfilment status), independent of payment status:
 *
 *   placed ──► ready ──► out_for_delivery ──► completed (bill created, stock deducted)
 *      │         │  ◄────────┘ (failed delivery)
 *      └─────────┴──────────────► cancelled (reservation released)
 *
 * Stock: copies are RESERVED when the order is placed (books.reserved_qty). They are physically deducted exactly
 * once, at completion, in the same transaction that creates the bill (sales.order_id is UNIQUE as a backstop).
 * Payment: order_payments is a signed ledger (advance payments, refunds). Payment status is derived from it.
 * Revenue is only recognised when the order completes and becomes a sale; advance payments are not revenue.
 */
const OPEN = ['placed', 'ready', 'out_for_delivery'];
const TRANSITIONS = { placed: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['ready'] };

function paidCents(db, orderId) {
  return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM order_payments WHERE order_id = ?').get(orderId).s;
}

function paymentStatus(order, paid, hadPayments) {
  if (order.status === 'cancelled') return paid > 0 ? 'refund_due' : hadPayments ? 'refunded' : 'unpaid';
  if (paid <= 0) return 'unpaid';
  return paid >= order.total_cents ? 'paid' : 'partial';
}

function orderToApi(db, row) {
  const items = db.prepare(`SELECT oi.*, b.aisle, b.rack, b.shelf, b.stock_qty, b.reserved_qty
                              FROM phone_order_items oi JOIN books b ON b.id = oi.book_id WHERE oi.order_id = ? ORDER BY oi.id`).all(row.id);
  const payments = db.prepare(`SELECT p.id, p.amount_cents, p.method, p.note, p.created_at, u.username
                                 FROM order_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.order_id = ? ORDER BY p.id`).all(row.id);
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  return {
    id: row.id, orderNo: row.order_no, customerName: row.customer_name, customerPhone: row.customer_phone,
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
      location: [i.aisle && `Aisle ${i.aisle}`, i.rack && `Rack ${i.rack}`, i.shelf && `Shelf ${i.shelf}`].filter(Boolean).join(' · '),
    })),
    payments: payments.map((p) => ({ id: p.id, amountCents: p.amount_cents, method: p.method, note: p.note, createdAt: p.created_at, user: p.username })),
  };
}

function loadOrder(db, id) {
  const row = db.prepare('SELECT * FROM phone_orders WHERE id = ?').get(id);
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

// Reserve/release copies so reservations for the order match `target` (Map bookId -> qty), given `current`.
function syncReservations(db, user, current, target, orderNo) {
  const ids = new Set([...current.keys(), ...target.keys()]);
  for (const bookId of ids) {
    const delta = (target.get(bookId) || 0) - (current.get(bookId) || 0);
    if (delta === 0) continue;
    if (delta > 0) {
      const b = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      if (!b) throw notFound(`Book #${bookId}`);
      if (!b.active) throw badRequest(`"${b.title}" is no longer sold`);
      const available = b.stock_qty - b.reserved_qty;
      if (delta > available) throw conflict(`Insufficient stock for "${b.title}": ${available} available to reserve, ${delta} more needed`, { bookId, available });
    }
    applyStock(db, { bookId, reservedDelta: delta, reason: 'adjustment', refType: 'phone_order', note: orderNo, userId: user.id });
  }
}

function writeItemsAndTotals(db, orderId, target, priceFor, discountBp, taxBp) {
  db.prepare('DELETE FROM phone_order_items WHERE order_id = ?').run(orderId);
  const lines = [];
  for (const [bookId, quantity] of target) {
    const b = db.prepare('SELECT title FROM books WHERE id = ?').get(bookId);
    const unitPriceCents = priceFor(bookId);
    db.prepare('INSERT INTO phone_order_items(order_id, book_id, title, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)')
      .run(orderId, bookId, b.title, quantity, unitPriceCents);
    lines.push({ unitPriceCents, quantity });
  }
  const t = computeTotals(lines, discountBp, taxBp);
  db.prepare('UPDATE phone_orders SET subtotal_cents=?, discount_cents=?, tax_cents=?, total_cents=?, discount_bp=?, tax_bp=?, updated_at=? WHERE id=?')
    .run(t.subtotalCents, t.discountCents, t.taxCents, t.totalCents, discountBp, taxBp, new Date().toISOString(), orderId);
  return t;
}

function checkDiscount(user, settings, discountBp) {
  if (user.role !== 'owner' && discountBp > settings.staffMaxDiscountBp) {
    throw forbidden(`Staff may give at most ${settings.staffMaxDiscountBp / 100}% discount; ask the owner for more`);
  }
}

function recordPayment(db, user, orderId, amountCents, method, note) {
  db.prepare('INSERT INTO order_payments(order_id, amount_cents, method, note, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(orderId, amountCents, method, note, user.id);
}

function createOrder(db, user, input) {
  v.object(input);
  const details = parseDetails(input);
  const wanted = parseItems(input.items);
  const discountBp = percentToBp(input.discountPercent, 'discountPercent');
  const advance = input.advancePayment ? v.object(input.advancePayment, 'advancePayment') : null;
  const advanceCents = advance ? v.int(advance.amountCents, 'advancePayment.amountCents', { min: 1, max: 1e11 }) : 0;
  const advanceMethod = advance ? v.oneOf(advance.method, 'advancePayment.method', METHODS) : null;

  const id = tx(db, () => {
    const settings = getSettings(db);
    checkDiscount(user, settings, discountBp);
    const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM phone_orders').get().m;
    const orderNo = `TEL-${String(last + 1).padStart(5, '0')}`;
    const r = db.prepare(`INSERT INTO phone_orders(order_no, customer_name, customer_phone, delivery_type, delivery_address, promised_date, notes, created_by)
                          VALUES (@order_no, @customer_name, @customer_phone, @delivery_type, @delivery_address, @promised_date, @notes, @by)`)
      .run({ ...details, order_no: orderNo, by: user.id });
    const orderId = Number(r.lastInsertRowid);
    syncReservations(db, user, new Map(), wanted, orderNo);
    const prices = new Map([...wanted.keys()].map((b) => [b, db.prepare('SELECT price_cents FROM books WHERE id = ?').get(b).price_cents]));
    const totals = writeItemsAndTotals(db, orderId, wanted, (b) => prices.get(b), discountBp, settings.taxBp);
    if (advance) {
      if (advanceCents > totals.totalCents) throw badRequest('Advance payment cannot exceed the order total');
      recordPayment(db, user, orderId, advanceCents, advanceMethod, 'Advance');
    }
    return orderId;
  });
  return orderToApi(db, loadOrder(db, id));
}

function getOrder(db, id) {
  return orderToApi(db, loadOrder(db, id));
}

function listOrders(db, { status = '', payment = '', q = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (status === 'open') where.push("status IN ('placed','ready','out_for_delivery')");
  else if (status) { where.push('status = @status'); params.status = v.oneOf(status, 'status', [...OPEN, 'completed', 'cancelled']); }
  if (q) {
    where.push(`(order_no LIKE @q ESCAPE '\\' OR customer_name LIKE @q ESCAPE '\\' OR customer_phone LIKE @q ESCAPE '\\')`);
    params.q = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM phone_orders ${w} ORDER BY
      CASE WHEN status IN ('placed','ready','out_for_delivery') THEN 0 ELSE 1 END, COALESCE(promised_date, '9999-12-31'), id DESC`).all(params);
  let items = rows.map((r) => {
    const paid = paidCents(db, r.id);
    const n = db.prepare('SELECT COUNT(*) c FROM order_payments WHERE order_id = ?').get(r.id).c;
    return {
      id: r.id, orderNo: r.order_no, customerName: r.customer_name, customerPhone: r.customer_phone,
      deliveryType: r.delivery_type, promisedDate: r.promised_date, status: r.status,
      paymentStatus: paymentStatus(r, paid, n > 0), totalCents: r.total_cents, paidCents: paid,
      saleId: r.sale_id, createdAt: r.created_at,
    };
  });
  if (payment) items = items.filter((o) => o.paymentStatus === payment);
  const total = items.length;
  const off = Math.max(Number(offset) || 0, 0);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return { total, items: items.slice(off, off + lim) };
}

function modifyOrder(db, user, id, input) {
  v.object(input);
  const details = parseDetails(input);
  const wanted = parseItems(input.items);
  const discountBp = percentToBp(input.discountPercent, 'discountPercent');
  tx(db, () => {
    const order = loadOrder(db, id);
    if (!['placed', 'ready'].includes(order.status)) throw conflict(`An order that is ${order.status.replace(/_/g, ' ')} can no longer be modified`);
    checkDiscount(user, getSettings(db), discountBp);
    const current = new Map(db.prepare('SELECT book_id, quantity FROM phone_order_items WHERE order_id = ?').all(id).map((r) => [r.book_id, r.quantity]));
    syncReservations(db, user, current, wanted, order.order_no);
    // Lines already on the order keep their agreed price; newly added books use today's price.
    const frozen = new Map(db.prepare('SELECT book_id, unit_price_cents FROM phone_order_items WHERE order_id = ?').all(id).map((r) => [r.book_id, r.unit_price_cents]));
    const priceFor = (b) => frozen.get(b) ?? db.prepare('SELECT price_cents FROM books WHERE id = ?').get(b).price_cents;
    const totals = writeItemsAndTotals(db, id, wanted, priceFor, discountBp, order.tax_bp);
    const paid = paidCents(db, id);
    if (paid > totals.totalCents) {
      throw conflict(`The new total is less than the ${paid / 100} already paid; record a refund first`);
    }
    db.prepare(`UPDATE phone_orders SET customer_name=@customer_name, customer_phone=@customer_phone, delivery_type=@delivery_type,
                delivery_address=@delivery_address, promised_date=@promised_date, notes=@notes WHERE id=@id`).run({ ...details, id });
  });
  return getOrder(db, id);
}

function setStatus(db, id, input) {
  const next = v.oneOf(input && input.status, 'status', ['ready', 'out_for_delivery']);
  tx(db, () => {
    const order = loadOrder(db, id);
    if (!(TRANSITIONS[order.status] || []).includes(next)) {
      throw conflict(`Cannot move an order from "${order.status.replace(/_/g, ' ')}" to "${next.replace(/_/g, ' ')}"`);
    }
    if (next === 'out_for_delivery' && order.delivery_type !== 'delivery') throw conflict('Only delivery orders can be sent out for delivery');
    db.prepare('UPDATE phone_orders SET status=?, updated_at=? WHERE id=?').run(next, new Date().toISOString(), id);
  });
  return getOrder(db, id);
}

function cancelOrder(db, user, id, input) {
  const reason = v.str(input && input.reason, 'reason', { required: true, max: 300 });
  tx(db, () => {
    const order = loadOrder(db, id);
    if (order.status === 'cancelled') throw conflict('This order is already cancelled');
    if (order.status === 'completed') throw conflict('A completed order cannot be cancelled; it has already been billed');
    const items = new Map(db.prepare('SELECT book_id, quantity FROM phone_order_items WHERE order_id = ?').all(id).map((r) => [r.book_id, r.quantity]));
    syncReservations(db, user, items, new Map(), order.order_no);
    db.prepare("UPDATE phone_orders SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?").run(reason, new Date().toISOString(), id);
  });
  return getOrder(db, id);
}

function addPayment(db, user, id, input) {
  v.object(input);
  const amount = v.int(input.amountCents, 'amountCents', { min: 1, max: 1e11 });
  const method = v.oneOf(input.method, 'method', METHODS);
  tx(db, () => {
    const order = loadOrder(db, id);
    if (!OPEN.includes(order.status)) throw conflict(`Payments cannot be added to a ${order.status} order`);
    const balance = order.total_cents - paidCents(db, id);
    if (amount > balance) throw badRequest(`Payment exceeds the outstanding balance of ${balance / 100}`);
    recordPayment(db, user, id, amount, method, v.str(input.note, 'note', { max: 200 }));
    db.prepare('UPDATE phone_orders SET updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  });
  return getOrder(db, id);
}

function refund(db, user, id, input) {
  v.object(input);
  const method = v.oneOf(input.method, 'method', METHODS);
  tx(db, () => {
    const order = loadOrder(db, id);
    if (order.status === 'completed') throw conflict('A completed order has been billed; refunds are not handled here');
    const paid = paidCents(db, id);
    if (paid <= 0) throw conflict('Nothing has been paid on this order');
    const amount = input.amountCents === undefined || input.amountCents === null ? paid : v.int(input.amountCents, 'amountCents', { min: 1, max: 1e11 });
    if (amount > paid) throw badRequest(`Refund exceeds the ${paid / 100} paid`);
    recordPayment(db, user, id, -amount, method, v.str(input.note, 'note', { max: 200 }) || 'Refund');
    db.prepare('UPDATE phone_orders SET updated_at=? WHERE id=?').run(new Date().toISOString(), id);
  });
  return getOrder(db, id);
}

// Hand over / deliver the books: collects any balance, creates the bill, deducts stock, releases reservations.
// All-or-nothing, and safe to call twice (a second call fails with 409 without touching stock).
function fulfilOrder(db, user, id, input) {
  const method = input && input.paymentMethod !== undefined ? v.oneOf(input.paymentMethod, 'paymentMethod', METHODS) : null;
  tx(db, () => {
    const order = loadOrder(db, id);
    if (order.status === 'completed') throw conflict(`This order was already fulfilled (bill #${order.sale_id})`, { saleId: order.sale_id });
    if (order.status === 'cancelled') throw conflict('A cancelled order cannot be fulfilled');
    if (order.status === 'placed') throw conflict('Mark the order as ready before handing it over');
    if (order.delivery_type === 'delivery' && order.status === 'ready') throw conflict('Send the order out for delivery first');
    const balance = order.total_cents - paidCents(db, id);
    if (balance > 0 && !method) throw badRequest('paymentMethod is required to collect the outstanding balance');
    if (balance > 0) recordPayment(db, user, id, balance, method, 'Balance collected on fulfilment');
    const lastPay = db.prepare('SELECT method FROM order_payments WHERE order_id = ? AND amount_cents > 0 ORDER BY id DESC LIMIT 1').get(id);
    const lines = db.prepare('SELECT book_id, quantity, unit_price_cents FROM phone_order_items WHERE order_id = ?').all(id)
      .map((r) => ({ bookId: r.book_id, quantity: r.quantity, unitPriceCents: r.unit_price_cents }));
    const { saleId } = recordSale(db, {
      lines, discountBp: order.discount_bp, taxBp: order.tax_bp,
      paymentMethod: lastPay ? lastPay.method : (method || 'cash'),
      customerName: order.customer_name, orderId: id, userId: user.id, fromReservation: true,
    });
    db.prepare("UPDATE phone_orders SET status='completed', sale_id=?, updated_at=? WHERE id=?").run(saleId, new Date().toISOString(), id);
  });
  return getOrder(db, id);
}

module.exports = { createOrder, getOrder, listOrders, modifyOrder, setStatus, cancelOrder, addPayment, refund, fulfilOrder };
