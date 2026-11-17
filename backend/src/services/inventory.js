const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { requireShop } = require('../lib/tenant');
const { getSettings } = require('./settings');

// A business book joined with its stock in one shop ($1 = business_id, $2 = shop_id). Books never stocked in the
// shop show zero stock rather than disappearing, so every shop can sell / order any title of the business.
const BOOK_SELECT = `
  SELECT b.*, COALESCE(ss.stock_qty, 0) AS stock_qty, COALESCE(ss.reserved_qty, 0) AS reserved_qty,
         COALESCE(ss.cost_cents, 0) AS cost_cents, ss.low_stock_threshold,
         COALESCE((SELECT string_agg(s.aisle || ' · ' || s.rack || ' · ' || s.shelf || ' (' || x.qty || ')', ', ' ORDER BY s.aisle,s.rack,s.shelf)
           FROM shelf_stock x JOIN shelves s ON s.id=x.shelf_id WHERE x.shop_id=$2 AND x.book_id=b.id AND x.qty>0),'') AS location
    FROM books b
    LEFT JOIN shop_stock ss ON ss.book_id = b.id AND ss.shop_id = $2
   WHERE b.business_id = $1`;

async function loadBook(q, ctx, bookId) {
  const row = await q.one(`${BOOK_SELECT} AND b.id = $3`, [ctx.businessId, requireShop(ctx), bookId]);
  if (!row) throw notFound(`Book #${bookId}`);
  return row;
}

async function ensureStockRow(q, ctx, shopId, bookId) {
  await q.query(`INSERT INTO shop_stock(business_id, shop_id, book_id) VALUES ($1, $2, $3) ON CONFLICT (shop_id, book_id) DO NOTHING`,
    [ctx.businessId, shopId, bookId]);
}

/**
 * The one primitive that changes stock / reservations in a shop. The guarded UPDATE is atomic in Postgres (the row
 * is locked and the WHERE re-checked), so concurrent sales can never take stock negative or below reservations;
 * the table CHECKs are the last line of defence. Must run inside a transaction (pass the tx handle as q).
 */
async function applyStock(q, ctx, { bookId, stockDelta = 0, reservedDelta = 0, reason, refType = null, refId = null, note = '', shopId = null }) {
  const shop = shopId || requireShop(ctx);
  const sctx = { ...ctx, shopId: shop };
  if (stockDelta < 0) await require('./arrangement').consume(q, sctx, bookId, -stockDelta, reason);
  if (stockDelta > 0 || reservedDelta !== 0) await ensureStockRow(q, ctx, shop, bookId);
  const row = await q.one(`
    UPDATE shop_stock
       SET stock_qty = stock_qty + $3, reserved_qty = reserved_qty + $4, updated_at = now()
     WHERE shop_id = $1 AND book_id = $2
       AND stock_qty + $3 >= 0 AND reserved_qty + $4 >= 0 AND stock_qty + $3 >= reserved_qty + $4
     RETURNING stock_qty`, [shop, bookId, stockDelta, reservedDelta]);
  if (!row) {
    const book = await q.one(`SELECT b.title, COALESCE(ss.stock_qty, 0) - COALESCE(ss.reserved_qty, 0) AS available
                                FROM books b LEFT JOIN shop_stock ss ON ss.book_id = b.id AND ss.shop_id = $2
                               WHERE b.id = $1 AND b.business_id = $3`, [bookId, shop, ctx.businessId]);
    if (!book) throw notFound('Book');
    throw conflict(`Insufficient stock for "${book.title}": ${book.available} available`, { bookId, available: book.available });
  }
  if (stockDelta !== 0) {
    await q.query(`INSERT INTO stock_movements(business_id, shop_id, book_id, delta, reason, ref_type, ref_id, note, user_id)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ctx.businessId, shop, bookId, stockDelta, reason, refType, refId, note, ctx.user.id]);
  }
  if (stockDelta > 0) {
    const source = reason === 'receipt' ? 'receipt' : reason === 'refund' || reason === 'sale_void' ? 'return' : reason === 'exchange' ? 'adjustment' : 'stock_count';
    await require('./arrangement').propose(q, sctx, bookId, stockDelta, source, refId);
  }
}

// Manager/owner stock correction: enter the physically counted quantity and a reason.
async function adjustStock(ctx, bookId, input) {
  v.object(input);
  const counted = v.int(input.countedQty, 'countedQty', { min: 0, max: 1e7 });
  const reason = v.str(input.reason, 'reason', { required: true, max: 300 });
  return ctx.db.tx(async (q) => {
    const book = await loadBook(q, ctx, bookId);
    const delta = counted - book.stock_qty;
    if (delta === 0) throw badRequest('Counted quantity equals the current stock; nothing to adjust');
    if (counted < book.reserved_qty) {
      throw conflict(`Cannot set stock below ${book.reserved_qty}: that many copies are reserved for phone orders`);
    }
    await applyStock(q, ctx, { bookId, stockDelta: delta, reason: 'adjustment', refType: 'adjustment', note: reason });
    const after = await loadBook(q, ctx, bookId);
    return { id: after.id, title: after.title, stock_qty: after.stock_qty, reserved_qty: after.reserved_qty };
  });
}

async function movements(ctx, bookId, limit = 100) {
  await loadBook(ctx.db, ctx, bookId);
  return ctx.db.many(`SELECT m.id, m.delta, m.reason, m.ref_type AS "refType", m.ref_id AS "refId", m.note,
                             m.created_at AS "createdAt", u.username AS user
                        FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
                       WHERE m.shop_id = $1 AND m.book_id = $2 ORDER BY m.id DESC LIMIT $3`,
  [requireShop(ctx), bookId, Math.min(Number(limit) || 100, 500)]);
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, '\\$&');

// Current stock in the active shop. lowOnly restricts to titles at/below their effective threshold.
async function stockOverview(ctx, { lowOnly = false, q = '' } = {}) {
  const { defaultLowStockThreshold: def } = await getSettings(ctx.db, ctx.businessId);
  const rows = await ctx.db.many(`
    SELECT * FROM (
      SELECT b.id, b.title, b.author, b.isbn, b.edition, b.publisher,
             COALESCE(ss.stock_qty, 0) AS "stockQty", COALESCE(ss.reserved_qty, 0) AS "reservedQty",
             COALESCE(ss.stock_qty, 0) - COALESCE(ss.reserved_qty, 0) AS "availableQty",
             COALESCE(ss.low_stock_threshold, $3) AS threshold,
             ss.low_stock_threshold IS NULL AS "thresholdIsDefault",
             COALESCE((SELECT string_agg(sh.aisle || ' · ' || sh.rack || ' · ' || sh.shelf || ' (' || x.qty || ')', ', ' ORDER BY sh.aisle,sh.rack,sh.shelf)
               FROM shelf_stock x JOIN shelves sh ON sh.id=x.shelf_id WHERE x.shop_id=$2 AND x.book_id=b.id AND x.qty>0),'') AS location
        FROM books b LEFT JOIN shop_stock ss ON ss.book_id = b.id AND ss.shop_id = $2
       WHERE b.business_id = $1 AND b.active
         AND ($4 = '' OR b.title ILIKE $5 OR b.author ILIKE $5 OR b.isbn ILIKE $5)
    ) x
    WHERE (NOT $6 OR "availableQty" <= threshold)
    ORDER BY "availableQty" - threshold, title`,
  [ctx.businessId, requireShop(ctx), def, String(q), `%${likeEscape(q)}%`, !!lowOnly]);
  return rows.map((r) => ({ ...r, isLowStock: r.availableQty <= r.threshold }));
}

module.exports = { BOOK_SELECT, loadBook, applyStock, adjustStock, movements, stockOverview, likeEscape };
