const v = require('../lib/validate');
const { computeTotals, percentToBp, roundRupee } = require('../lib/money');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { dayRangeToUtc, DAY } = require('../lib/dates');
const { canSeeCost, checkDiscount, requireShop } = require('../lib/tenant');
const { formatNumber } = require('../lib/counters');
const { getSettings } = require('./settings');
const { applyStock, loadBook, likeEscape } = require('./inventory');

const METHODS = ['cash', 'card', 'upi', 'other'];

function itemToApi(i, includeCost) {
  const out = {
    id: i.id,
    bookId: i.book_id, title: i.title, author: i.author, isbn: i.isbn, edition: i.edition,
    quantity: i.quantity, returnedQty: i.returned_qty,
    unitPriceCents: i.unit_price_cents, lineTotalCents: i.line_total_cents,
  };
  if (includeCost) out.unitCostCents = i.unit_cost_cents;
  return out;
}

async function saleToApi(q, ctx, row) {
  const items = await q.many('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [row.id]);
  const cashier = await q.one('SELECT full_name FROM users WHERE id = $1', [row.user_id]);
  const shop = await q.one('SELECT name, code, city, address, phone FROM shops WHERE id = $1', [row.shop_id]);
  const returns = await q.many(`SELECT r.id, r.sale_id AS "saleId", r.sale_item_id AS "saleItemId",
                                       r.book_id AS "bookId", r.type, r.quantity, r.amount_cents AS "amountCents",
                                       r.tax_cents AS "taxCents", r.amount_cents + r.tax_cents AS "paidBackCents",
                                       r.replacement_book_id AS "replacementBookId", r.reason,
                                       r.created_at AS "createdAt", u.full_name AS "processedBy",
                                       b.title AS "replacementTitle", b.isbn AS "replacementIsbn"
                                  FROM sale_returns r
                                  LEFT JOIN users u ON u.id = r.user_id
                                  LEFT JOIN books b ON b.id = r.replacement_book_id
                                 WHERE r.sale_id = $1 ORDER BY r.id DESC`, [row.id]);
  const adjustmentIds = await q.many('SELECT id FROM adjustments WHERE original_sale_id=$1 ORDER BY id DESC', [row.id]);
  const adjustments = [];
  for (const a of adjustmentIds) adjustments.push(await require('./adjustments').getAdjustment(ctx,a.id,q));
  const { returnWindowDays } = await getSettings(q, ctx.businessId);
  const windowMs = returnWindowDays * DAY;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return {
    id: row.id, billNo: row.bill_no, status: row.status, customerName: row.customer_name,
    paymentMethod: row.payment_method,
    subtotalCents: row.subtotal_cents, discountPercent: row.discount_bp / 100, discountCents: row.discount_cents,
    taxPercent: row.tax_bp / 100, taxCents: row.tax_cents, totalCents: row.total_cents,
    orderId: row.order_id, cashier: cashier ? cashier.full_name : '',
    // The bill prints the shop it was made in, not whichever shop the viewer has selected.
    shopId: row.shop_id, shopName: shop ? shop.name : '', shopCode: shop ? shop.code : '',
    shopAddress: shop ? [shop.address, shop.city].filter(Boolean).join(', ') : '', shopPhone: shop ? shop.phone : '',
    returnWindowDays,
    voidReason: row.void_reason, voidedAt: row.voided_at, createdAt: row.created_at,
    isReturnEligible: ageMs <= windowMs && row.status !== 'voided',
    returnDaysRemaining: Math.max(0, Math.ceil((windowMs - ageMs) / DAY)),
    items: items.map((i) => itemToApi(i, canSeeCost(ctx))),
    returns, adjustments,
  };
}

/**
 * Persist a completed sale and move stock. Shared by counter billing and phone-order fulfilment so the
 * arithmetic, snapshots and stock rules live in exactly one place. Must be called inside a transaction (q).
 *
 * lines: [{ bookId, quantity, unitPriceCents }]; fromReservation: the stock was already reserved (phone order),
 * so the reservation is released in the same step as the deduction.
 */
async function recordSale(q, ctx, { lines, discountBp, taxBp, paymentMethod, customerName = '', orderId = null, idempotencyKey = null, fromReservation = false }) {
  const shopId = requireShop(ctx);
  const totals = computeTotals(lines, discountBp, taxBp);
  const billNo = await formatNumber(q, shopId, 'bill', 'INV', 6);
  const { id: saleId } = await q.one(`INSERT INTO sales(business_id, shop_id, bill_no, customer_name, payment_method, subtotal_cents, discount_bp,
                                        discount_cents, tax_bp, tax_cents, total_cents, order_id, idempotency_key, user_id)
                                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
  [ctx.businessId, shopId, billNo, customerName, paymentMethod, totals.subtotalCents, discountBp, totals.discountCents,
    taxBp, totals.taxCents, totals.totalCents, orderId, idempotencyKey, ctx.user.id]);
  // Lock all affected stock rows before touching shelf rows, to keep cross-book lock order consistent.
  await q.many('SELECT book_id FROM shop_stock WHERE shop_id=$1 AND book_id=ANY($2::bigint[]) ORDER BY book_id FOR UPDATE',
    [shopId, lines.map((line) => line.bookId)]);
  // Book-id order keeps row locks in a consistent order across concurrent sales (no deadlocks).
  for (const l of [...lines].sort((a, b) => a.bookId - b.bookId)) {
    const book = await loadBook(q, ctx, l.bookId);
    await q.query(`INSERT INTO sale_items(sale_id, book_id, title, author, isbn, edition, quantity, unit_price_cents, unit_cost_cents, line_total_cents)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [saleId, book.id, book.title, book.author, book.isbn, book.edition, l.quantity, l.unitPriceCents, book.cost_cents, l.unitPriceCents * l.quantity]);
    await applyStock(q, ctx, {
      bookId: book.id, stockDelta: -l.quantity, reservedDelta: fromReservation ? -l.quantity : 0,
      reason: 'sale', refType: 'sale', refId: saleId, note: billNo,
    });
  }
  return { saleId, billNo, totals };
}

async function findByKey(q, ctx, key) {
  return q.one('SELECT * FROM sales WHERE shop_id = $1 AND idempotency_key = $2', [ctx.shopId, key]);
}

async function createSale(ctx, input) {
  v.object(input);
  const shopId = requireShop(ctx);
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

  let result;
  try {
    result = await ctx.db.tx(async (q) => {
      if (key) {
        const prior = await findByKey(q, ctx, key);
        if (prior) return { row: prior, duplicate: true };
      }
      const settings = await getSettings(q, ctx.businessId);
      checkDiscount(ctx, settings, discountBp);
      const lines = [];
      for (const [bookId, quantity] of wanted) {
        const book = await loadBook(q, ctx, bookId);
        if (!book.active) throw badRequest(`"${book.title}" is no longer sold`);
        const available = book.stock_qty - book.reserved_qty;
        if (quantity > available) {
          const held = book.reserved_qty ? ` (${book.reserved_qty} reserved for phone orders)` : '';
          throw conflict(`Insufficient stock for "${book.title}": ${available} available, ${quantity} requested${held}`, { bookId, available });
        }
        lines.push({ bookId, quantity, unitPriceCents: book.price_cents });
      }
      const { saleId } = await recordSale(q, ctx, { lines, discountBp, taxBp: settings.taxBp, paymentMethod, customerName, idempotencyKey: key });
      return { row: await q.one('SELECT * FROM sales WHERE id = $1', [saleId]), duplicate: false };
    });
  } catch (e) {
    // Two identical requests raced: the loser hits the unique (shop_id, idempotency_key) and returns the winner's bill.
    if (key && e.code === '23505') {
      const prior = await findByKey(ctx.db, { ...ctx, shopId }, key);
      if (prior) result = { row: prior, duplicate: true };
    }
    if (!result) throw e;
  }
  return { sale: await saleToApi(ctx.db, ctx, result.row), duplicate: result.duplicate };
}

// Bills are visible across the user's shops (owner: all shops of the business).
async function loadSale(q, ctx, id, { lock = false } = {}) {
  const row = await q.one(`SELECT * FROM sales WHERE id = $1 AND business_id = $2 AND shop_id = ANY($3::bigint[]) ${lock ? 'FOR UPDATE' : ''}`,
    [id, ctx.businessId, ctx.shopIds]);
  if (!row) throw notFound('Bill');
  return row;
}

async function getSale(ctx, id) {
  return saleToApi(ctx.db, ctx, await loadSale(ctx.db, ctx, id));
}

async function listSales(ctx, { from, to, q = '', status = '', shop = '', limit = 50, offset = 0 } = {}) {
  const params = [ctx.businessId];
  const p = (val) => { params.push(val); return `$${params.length}`; };
  const where = ['s.business_id = $1'];
  // Default: the active shop. Owners may pass shop=all to see every shop.
  if (shop === 'all' && ctx.user.role === 'owner') where.push(`s.shop_id = ANY(${p(ctx.shopIds)}::bigint[])`);
  else where.push(`s.shop_id = ${p(requireShop(ctx))}`);
  if (from || to) {
    const r = dayRangeToUtc(v.date(from, 'from', { required: false }), v.date(to, 'to', { required: false }), ctx.tz);
    if (r.start) where.push(`s.created_at >= ${p(r.start)}`);
    if (r.end) where.push(`s.created_at < ${p(r.end)}`);
  }
  if (status) where.push(`s.status = ${p(v.oneOf(status, 'status', ['completed', 'voided']))}`);
  if (q) {
    const like = p(`%${likeEscape(q)}%`);
    where.push(`(s.bill_no ILIKE ${like} OR s.customer_name ILIKE ${like}
                 OR EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND (i.title ILIKE ${like} OR i.isbn ILIKE ${like})))`);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const total = (await ctx.db.one(`SELECT COUNT(*) AS c FROM sales s ${w}`, params)).c;
  const rows = await ctx.db.many(`SELECT s.id, s.bill_no, s.status, s.customer_name, s.payment_method, s.total_cents, s.order_id, s.created_at,
                                         s.shop_id, sh.name AS shop_name,
                                         (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS units
                                    FROM sales s JOIN shops sh ON sh.id = s.shop_id ${w}
                                   ORDER BY s.created_at DESC, s.id DESC LIMIT ${lim} OFFSET ${off}`, params);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, billNo: r.bill_no, status: r.status, customerName: r.customer_name, paymentMethod: r.payment_method,
      totalCents: r.total_cents, orderId: r.order_id, units: r.units, createdAt: r.created_at, shopId: r.shop_id, shopName: r.shop_name,
    })),
  };
}

// Stock movements for a bill always happen in the shop that made the sale.
const inShopOf = (ctx, sale) => ({ ...ctx, shopId: sale.shop_id });

// Owner-only reversal of a counter bill: restores stock and excludes the bill from every report.
async function voidSale(ctx, id, input) {
  v.object(input);
  const reason = v.str(input.reason, 'reason', { required: true, max: 300 });
  return ctx.db.tx(async (q) => {
    const sale = await loadSale(q, ctx, id, { lock: true });
    if (sale.status === 'voided') throw conflict('This bill has already been voided');
    if (sale.order_id) throw conflict('This bill was generated from a phone order and cannot be voided here');
    if (await q.one('SELECT 1 FROM adjustments WHERE original_sale_id = $1 LIMIT 1', [id])) throw conflict('A bill with adjustments cannot be voided');
    if (await q.one('SELECT 1 FROM sale_returns WHERE sale_id = $1 LIMIT 1', [id])) throw conflict('A bill with returns cannot be voided');
    const sctx = inShopOf(ctx, sale);
    const items = await q.many('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY book_id', [id]);
    await q.many('SELECT book_id FROM shop_stock WHERE shop_id=$1 AND book_id=ANY($2::bigint[]) ORDER BY book_id FOR UPDATE', [sale.shop_id,items.map(i=>i.book_id)]);
    for (const it of items) {
      const remaining = it.quantity - it.returned_qty;
      if (remaining > 0) {
        await applyStock(q, sctx, { bookId: it.book_id, stockDelta: remaining, reason: 'sale_void', refType: 'sale', refId: id, note: `${sale.bill_no} voided: ${reason}` });
      }
    }
    await q.query(`UPDATE sales SET status = 'voided', void_reason = $2, voided_by = $3, voided_at = now() WHERE id = $1`, [id, reason, ctx.user.id]);
    return saleToApi(q, ctx, await q.one('SELECT * FROM sales WHERE id = $1', [id]));
  });
}

async function returnable(q, ctx, sale, itemId, qty, what) {
  if (sale.status === 'voided') throw conflict(`Cannot ${what} on a voided bill`);
  const { returnWindowDays } = await getSettings(q, ctx.businessId);
  if (Date.now() - new Date(sale.created_at).getTime() > returnWindowDays * DAY) {
    throw badRequest(`${what === 'refund' ? 'Refund' : 'Exchange'} policy expired: ${what}s are only accepted within ${returnWindowDays} days of purchase`);
  }
  const item = await q.one('SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2 FOR UPDATE', [itemId, sale.id]);
  if (!item) throw notFound('Sale item not found on this bill');
  const eligible = item.quantity - item.returned_qty;
  if (qty > eligible) throw badRequest(`Cannot ${what} ${qty} copy/copies: only ${eligible} eligible (already returned: ${item.returned_qty})`);
  return item;
}

/**
 * Refund an item on an existing sale within the return window. Restores the returned quantity to the selling
 * shop's stock and records a refund (net of the bill's discount).
 */
async function refundItem(ctx, saleId, input) {
  v.object(input);
  const itemId = v.int(input.itemId, 'itemId', { min: 1 });
  const qty = v.int(input.quantity || 1, 'quantity', { min: 1, max: 10000 });
  const reason = v.str(input.reason || '', 'reason', { max: 300 });
  return ctx.db.tx(async (q) => {
    const sale = await loadSale(q, ctx, saleId, { lock: true });
    const item = await returnable(q, ctx, sale, itemId, qty, 'refund');
    // Revenue reversed = the discounted price of the copies; the tax charged on it is handed back as well.
    // Whole rupees, like every other amount.
    const amount = roundRupee(item.unit_price_cents * qty * (1 - sale.discount_bp / 10000));
    const tax = roundRupee((amount * sale.tax_bp) / 10000);
    await q.query('UPDATE sale_items SET returned_qty = returned_qty + $2 WHERE id = $1', [itemId, qty]);
    await applyStock(q, inShopOf(ctx, sale), {
      bookId: item.book_id, stockDelta: qty, reason: 'refund', refType: 'sale', refId: saleId,
      note: `Refund on ${sale.bill_no}: returned "${item.title}" x${qty} - ${reason || 'Customer refund'}`,
    });
    await q.query(`INSERT INTO sale_returns(business_id, shop_id, sale_id, sale_item_id, book_id, type, quantity, amount_cents, tax_cents, reason, user_id)
                   VALUES ($1, $2, $3, $4, $5, 'refund', $6, $7, $8, $9, $10)`,
    [ctx.businessId, sale.shop_id, saleId, itemId, item.book_id, qty, amount, tax, reason || 'Customer refund', ctx.user.id]);
    return saleToApi(q, ctx, await q.one('SELECT * FROM sales WHERE id = $1', [saleId]));
  });
}

/**
 * Exchange an item within the return window for another title of exactly the same price, in the same shop.
 * The original copy goes back to stock and the replacement is deducted.
 */
async function exchangeItem(ctx, saleId, input) {
  v.object(input);
  const itemId = v.int(input.itemId, 'itemId', { min: 1 });
  const replacementBookId = v.int(input.replacementBookId, 'replacementBookId', { min: 1 });
  const qty = v.int(input.quantity || 1, 'quantity', { min: 1, max: 10000 });
  const reason = v.str(input.reason || '', 'reason', { max: 300 });
  return ctx.db.tx(async (q) => {
    const sale = await loadSale(q, ctx, saleId, { lock: true });
    const item = await returnable(q, ctx, sale, itemId, qty, 'exchange');
    const sctx = inShopOf(ctx, sale);
    const rep = await loadBook(q, sctx, replacementBookId);
    if (!rep.active) throw badRequest(`"${rep.title}" is no longer active`);
    if (rep.price_cents !== item.unit_price_cents) {
      const fmt = (c) => Math.round(c / 100).toLocaleString('en-IN');
      throw badRequest(`Exchange policy requires a replacement book of the exact same price (₹${fmt(item.unit_price_cents)}). "${rep.title}" is priced at ₹${fmt(rep.price_cents)}.`);
    }
    const available = rep.stock_qty - rep.reserved_qty;
    if (available < qty) throw conflict(`Insufficient stock for "${rep.title}": ${available} available, ${qty} needed`);

    await q.query('UPDATE sale_items SET returned_qty = returned_qty + $2 WHERE id = $1', [itemId, qty]);
    const moves = [
      { bookId: item.book_id, stockDelta: qty, note: `Exchange on ${sale.bill_no}: returned "${item.title}" x${qty}` },
      { bookId: rep.id, stockDelta: -qty, note: `Exchange on ${sale.bill_no}: took "${rep.title}" x${qty}` },
    ].sort((a, b) => a.bookId - b.bookId);
    for (const m of moves) await applyStock(q, sctx, { ...m, reason: 'exchange', refType: 'sale', refId: saleId });
    await q.query(`INSERT INTO sale_returns(business_id, shop_id, sale_id, sale_item_id, book_id, type, quantity, amount_cents, replacement_book_id, reason, user_id)
                   VALUES ($1, $2, $3, $4, $5, 'exchange', $6, 0, $7, $8, $9)`,
    [ctx.businessId, sale.shop_id, saleId, itemId, item.book_id, qty, rep.id, reason || 'Customer exchange (same price)', ctx.user.id]);
    return saleToApi(q, ctx, await q.one('SELECT * FROM sales WHERE id = $1', [saleId]));
  });
}

module.exports = { createSale, getSale, listSales, voidSale, recordSale, refundItem, exchangeItem, loadSale, METHODS };
