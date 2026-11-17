const { tx } = require('../db');
const v = require('../lib/validate');
const { computeTotals, percentToBp } = require('../lib/money');
const { conflict, notFound, forbidden, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');
const { applyStock } = require('./inventory');
const { dayRangeToUtc } = require('../lib/dates');

const METHODS = ['cash', 'card', 'upi', 'other'];

function itemToApi(i, includeCost) {
  const out = {
    id: i.id,
    bookId: i.book_id, title: i.title, author: i.author, isbn: i.isbn, edition: i.edition,
    quantity: i.quantity, returnedQty: i.returned_qty || 0,
    unitPriceCents: i.unit_price_cents, lineTotalCents: i.line_total_cents,
  };
  if (includeCost) out.unitCostCents = i.unit_cost_cents;
  return out;
}

function saleToApi(db, user, row) {
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(row.id);
  const cashier = db.prepare('SELECT full_name FROM users WHERE id = ?').get(row.user_id);
  let returns = [];
  try {
    returns = db.prepare(`SELECT r.id, r.sale_id AS saleId, r.sale_item_id AS saleItemId,
                                 r.book_id AS bookId, r.type, r.quantity, r.amount_cents AS amountCents,
                                 r.replacement_book_id AS replacementBookId, r.reason,
                                 r.created_at AS createdAt,
                                 u.full_name AS processedBy,
                                 b.title AS replacementTitle, b.isbn AS replacementIsbn
                          FROM sale_returns r
                          LEFT JOIN users u ON u.id = r.user_id
                          LEFT JOIN books b ON b.id = r.replacement_book_id
                          WHERE r.sale_id = ? ORDER BY r.id DESC`).all(row.id);
  } catch {}

  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const saleAgeMs = Date.now() - new Date(row.created_at).getTime();
  const isReturnEligible = saleAgeMs <= ONE_WEEK_MS && row.status !== 'voided';

  return {
    id: row.id, billNo: row.bill_no, status: row.status, customerName: row.customer_name,
    paymentMethod: row.payment_method,
    subtotalCents: row.subtotal_cents, discountPercent: row.discount_bp / 100, discountCents: row.discount_cents,
    taxPercent: row.tax_bp / 100, taxCents: row.tax_cents, totalCents: row.total_cents,
    orderId: row.order_id, cashier: cashier ? cashier.full_name : '',
    voidReason: row.void_reason, voidedAt: row.voided_at, createdAt: row.created_at,
    isReturnEligible,
    returnDaysRemaining: Math.max(0, Math.ceil((ONE_WEEK_MS - saleAgeMs) / (24 * 60 * 60 * 1000))),
    items: items.map((i) => itemToApi(i, user.role === 'owner')),
    returns,
  };
}

/**
 * Persist a completed sale and move stock. Shared by counter billing and phone-order fulfilment so the
 * arithmetic, snapshots and stock rules exist in exactly one place. Must be called inside a transaction.
 *
 * lines: [{ bookId, quantity, unitPriceCents }]; fromReservation: the stock was already reserved (phone order),
 * so the reservation is released in the same step as the deduction.
 */
function recordSale(db, { lines, discountBp, taxBp, paymentMethod, customerName = '', orderId = null, idempotencyKey = null, userId, fromReservation = false }) {
  const totals = computeTotals(lines, discountBp, taxBp);
  const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM sales').get().m;
  const billNo = `INV-${String(last + 1).padStart(6, '0')}`;
  const sale = db.prepare(`INSERT INTO sales(bill_no, customer_name, payment_method, subtotal_cents, discount_bp, discount_cents,
                           tax_bp, tax_cents, total_cents, order_id, idempotency_key, user_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(billNo, customerName, paymentMethod, totals.subtotalCents, discountBp, totals.discountCents,
      taxBp, totals.taxCents, totals.totalCents, orderId, idempotencyKey, userId);
  const saleId = Number(sale.lastInsertRowid);
  const insItem = db.prepare(`INSERT INTO sale_items(sale_id, book_id, title, author, isbn, edition, quantity, unit_price_cents, unit_cost_cents, line_total_cents)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const l of lines) {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(l.bookId);
    insItem.run(saleId, book.id, book.title, book.author, book.isbn, book.edition, l.quantity, l.unitPriceCents, book.cost_cents, l.unitPriceCents * l.quantity);
    applyStock(db, {
      bookId: book.id, stockDelta: -l.quantity, reservedDelta: fromReservation ? -l.quantity : 0,
      reason: 'sale', refType: 'sale', refId: saleId, note: billNo, userId,
    });
  }
  return { saleId, billNo, totals };
}

function createSale(db, user, input) {
  v.object(input);
  const items = v.array(input.items, 'items', { max: 100 });
  const paymentMethod = v.oneOf(input.paymentMethod, 'paymentMethod', METHODS);
  const customerName = v.str(input.customerName, 'customerName', { max: 100 });
  const discountBp = percentToBp(input.discountPercent, 'discountPercent');
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? null : v.str(input.idempotencyKey, 'idempotencyKey', { max: 100 }) || null;

  // Merge repeated lines for the same book.
  const wanted = new Map();
  for (const [n, it] of items.entries()) {
    v.object(it, `items[${n}]`);
    const bookId = v.int(it.bookId, `items[${n}].bookId`, { min: 1 });
    const qty = v.int(it.quantity, `items[${n}].quantity`, { min: 1, max: 100000 });
    wanted.set(bookId, (wanted.get(bookId) || 0) + qty);
  }

  const result = tx(db, () => {
    if (key) {
      const prior = db.prepare('SELECT * FROM sales WHERE idempotency_key = ?').get(key);
      if (prior) return { row: prior, duplicate: true };
    }
    const settings = getSettings(db);
    if (user.role !== 'owner' && discountBp > settings.staffMaxDiscountBp) {
      throw forbidden(`Staff may give at most ${settings.staffMaxDiscountBp / 100}% discount; ask the owner for more`);
    }
    const lines = [];
    for (const [bookId, quantity] of wanted) {
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      if (!book) throw notFound(`Book #${bookId}`);
      if (!book.active) throw badRequest(`"${book.title}" is no longer sold`);
      const available = book.stock_qty - book.reserved_qty;
      if (quantity > available) {
        const held = book.reserved_qty ? ` (${book.reserved_qty} reserved for phone orders)` : '';
        throw conflict(`Insufficient stock for "${book.title}": ${available} available, ${quantity} requested${held}`, { bookId, available });
      }
      lines.push({ bookId, quantity, unitPriceCents: book.price_cents });
    }
    const { saleId } = recordSale(db, { lines, discountBp, taxBp: settings.taxBp, paymentMethod, customerName, idempotencyKey: key, userId: user.id });
    return { row: db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId), duplicate: false };
  });
  return { sale: saleToApi(db, user, result.row), duplicate: result.duplicate };
}

function getSale(db, user, id) {
  const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!row) throw notFound('Bill');
  return saleToApi(db, user, row);
}

function getSaleByBillNo(db, user, billNo) {
  const row = db.prepare('SELECT * FROM sales WHERE bill_no = ?').get(billNo);
  if (!row) throw notFound('Bill');
  return saleToApi(db, user, row);
}

function listSales(db, tzOffsetMinutes, { from, to, q = '', status = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (from || to) {
    const r = dayRangeToUtc(v.date(from, 'from', { required: false }), v.date(to, 'to', { required: false }), tzOffsetMinutes);
    if (r.start) { where.push('s.created_at >= @start'); params.start = r.start; }
    if (r.end) { where.push('s.created_at < @end'); params.end = r.end; }
  }
  if (status) { where.push('s.status = @status'); params.status = v.oneOf(status, 'status', ['completed', 'voided']); }
  if (q) {
    where.push(`(s.bill_no LIKE @q ESCAPE '\\' OR s.customer_name LIKE @q ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND (i.title LIKE @q ESCAPE '\\' OR i.isbn LIKE @q ESCAPE '\\')))`);
    params.q = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) c FROM sales s ${w}`).get(params).c;
  const rows = db.prepare(`SELECT s.id, s.bill_no, s.status, s.customer_name, s.payment_method, s.total_cents, s.order_id, s.created_at,
                                  (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS units
                             FROM sales s ${w} ORDER BY s.id DESC LIMIT ${lim} OFFSET ${off}`).all(params);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, billNo: r.bill_no, status: r.status, customerName: r.customer_name, paymentMethod: r.payment_method,
      totalCents: r.total_cents, orderId: r.order_id, units: r.units, createdAt: r.created_at,
    })),
  };
}

// Owner-only reversal of a counter bill: restores stock and excludes the bill from every report.
function voidSale(db, user, id, input) {
  v.object(input);
  const reason = v.str(input.reason, 'reason', { required: true, max: 300 });
  return tx(db, () => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) throw notFound('Bill');
    if (sale.status === 'voided') throw conflict('This bill has already been voided');
    if (sale.order_id) throw conflict('This bill was generated from a phone order and cannot be voided here');
    for (const it of db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id)) {
      applyStock(db, { bookId: it.book_id, stockDelta: it.quantity, reason: 'sale_void', refType: 'sale', refId: id, note: `${sale.bill_no} voided: ${reason}`, userId: user.id });
    }
    db.prepare("UPDATE sales SET status='voided', void_reason=?, voided_by=?, voided_at=? WHERE id=?")
      .run(reason, user.id, new Date().toISOString(), id);
    return saleToApi(db, user, db.prepare('SELECT * FROM sales WHERE id = ?').get(id));
  });
}

/**
 * Refund an item on an existing sale within 1 week (7 days).
 * Restores the returned quantity back to stock and creates a refund record.
 */
function refundItem(db, user, saleId, input) {
  v.object(input);
  const itemId = v.int(input.itemId, 'itemId', { min: 1 });
  const qty = v.int(input.quantity || 1, 'quantity', { min: 1, max: 10000 });
  const reason = v.str(input.reason || '', 'reason', { max: 300 });

  return tx(db, () => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) throw notFound('Bill');
    if (sale.status === 'voided') throw conflict('Cannot refund a voided bill');

    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const saleAgeMs = Date.now() - new Date(sale.created_at).getTime();
    if (saleAgeMs > ONE_WEEK_MS) {
      throw badRequest('Refund policy expired: refunds are only accepted within 1 week (7 days) of purchase');
    }

    const item = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(itemId, saleId);
    if (!item) throw notFound('Sale item not found on this bill');

    const returnedQty = item.returned_qty || 0;
    const eligibleQty = item.quantity - returnedQty;
    if (qty > eligibleQty) {
      throw badRequest(`Cannot refund ${qty} copy/copies: only ${eligibleQty} eligible (already returned: ${returnedQty})`);
    }

    const netUnitCents = Math.round(item.unit_price_cents * (1 - (sale.discount_bp || 0) / 10000));
    const refundAmountCents = netUnitCents * qty;

    db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(qty, itemId);

    applyStock(db, {
      bookId: item.book_id,
      stockDelta: qty,
      reason: 'refund',
      refType: 'sale',
      refId: saleId,
      note: `Refund on ${sale.bill_no}: returned "${item.title}" x${qty} - ${reason || 'Customer refund'}`,
      userId: user.id,
    });

    db.prepare(`INSERT INTO sale_returns(sale_id, sale_item_id, book_id, type, quantity, amount_cents, reason, user_id, business_id, franchise_id)
                VALUES (?, ?, ?, 'refund', ?, ?, ?, ?, ?, ?)`).run(
      saleId, itemId, item.book_id, qty, refundAmountCents, reason || 'Customer refund', user.id, sale.business_id || null, sale.franchise_id || null
    );

    return saleToApi(db, user, db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
  });
}

/**
 * Exchange an item on an existing sale within 1 week (7 days) for another book of the exact same price.
 * Restores original book to stock and deducts replacement book from stock.
 */
function exchangeItem(db, user, saleId, input) {
  v.object(input);
  const itemId = v.int(input.itemId, 'itemId', { min: 1 });
  const replacementBookId = v.int(input.replacementBookId, 'replacementBookId', { min: 1 });
  const qty = v.int(input.quantity || 1, 'quantity', { min: 1, max: 10000 });
  const reason = v.str(input.reason || '', 'reason', { max: 300 });

  return tx(db, () => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) throw notFound('Bill');
    if (sale.status === 'voided') throw conflict('Cannot exchange on a voided bill');

    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const saleAgeMs = Date.now() - new Date(sale.created_at).getTime();
    if (saleAgeMs > ONE_WEEK_MS) {
      throw badRequest('Exchange policy expired: exchanges are only accepted within 1 week (7 days) of purchase');
    }

    const item = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(itemId, saleId);
    if (!item) throw notFound('Sale item not found on this bill');

    const returnedQty = item.returned_qty || 0;
    const eligibleQty = item.quantity - returnedQty;
    if (qty > eligibleQty) {
      throw badRequest(`Cannot exchange ${qty} copy/copies: only ${eligibleQty} eligible (already returned: ${returnedQty})`);
    }

    const repBook = db.prepare('SELECT * FROM books WHERE id = ?').get(replacementBookId);
    if (!repBook) throw notFound('Replacement book');
    if (!repBook.active) throw badRequest(`"${repBook.title}" is no longer active`);

    // Strict same price constraint
    if (repBook.price_cents !== item.unit_price_cents) {
      const origFmt = (item.unit_price_cents / 100).toFixed(2);
      const repFmt = (repBook.price_cents / 100).toFixed(2);
      throw badRequest(`Exchange policy requires a replacement book of the exact same price (₹${origFmt}). "${repBook.title}" is priced at ₹${repFmt}.`);
    }

    // Available stock check
    const available = repBook.stock_qty - repBook.reserved_qty;
    if (available < qty) {
      throw conflict(`Insufficient stock for "${repBook.title}": ${available} available, ${qty} needed`);
    }

    db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(qty, itemId);

    // Return original book to stock
    applyStock(db, {
      bookId: item.book_id,
      stockDelta: qty,
      reason: 'exchange',
      refType: 'sale',
      refId: saleId,
      note: `Exchange on ${sale.bill_no}: returned "${item.title}" x${qty}`,
      userId: user.id,
    });

    // Deduct replacement book from stock
    applyStock(db, {
      bookId: repBook.id,
      stockDelta: -qty,
      reason: 'exchange',
      refType: 'sale',
      refId: saleId,
      note: `Exchange on ${sale.bill_no}: took "${repBook.title}" x${qty}`,
      userId: user.id,
    });

    db.prepare(`INSERT INTO sale_returns(sale_id, sale_item_id, book_id, type, quantity, amount_cents, replacement_book_id, reason, user_id, business_id, franchise_id)
                VALUES (?, ?, ?, 'exchange', ?, 0, ?, ?, ?, ?, ?)`).run(
      saleId, itemId, item.book_id, qty, repBook.id, reason || 'Customer exchange (same price)', user.id, sale.business_id || null, sale.franchise_id || null
    );

    return saleToApi(db, user, db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
  });
}

module.exports = {
  createSale,
  getSale,
  getSaleByBillNo,
  listSales,
  voidSale,
  recordSale,
  refundItem,
  exchangeItem,
  METHODS,
};
