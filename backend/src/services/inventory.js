const { tx } = require('../db');
const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');

// The one primitive that changes stock/reservations. The WHERE clause is a second line of defence behind the
// callers' own friendly checks and the table CHECK constraints: stock can never go negative or below reservations.
function applyStock(db, { bookId, stockDelta = 0, reservedDelta = 0, reason, refType = null, refId = null, note = '', userId = null }) {
  const r = db.prepare(`
    UPDATE books
       SET stock_qty = stock_qty + @sd, reserved_qty = reserved_qty + @rd, updated_at = @now
     WHERE id = @id
       AND stock_qty + @sd >= 0
       AND reserved_qty + @rd >= 0
       AND stock_qty + @sd >= reserved_qty + @rd`)
    .run({ sd: stockDelta, rd: reservedDelta, id: bookId, now: new Date().toISOString() });
  if (r.changes === 0) {
    const book = db.prepare('SELECT title, stock_qty, reserved_qty FROM books WHERE id = ?').get(bookId);
    if (!book) throw notFound('Book');
    throw conflict(`Insufficient stock for "${book.title}": ${book.stock_qty - book.reserved_qty} available`, { bookId });
  }
  if (stockDelta !== 0) {
    db.prepare(`INSERT INTO stock_movements(book_id, delta, reason, ref_type, ref_id, note, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(bookId, stockDelta, reason, refType, refId, note, userId);
  }
}

// Owner-only stock correction: the owner enters the physically counted quantity and a reason.
function adjustStock(db, user, bookId, input) {
  v.object(input);
  const counted = v.int(input.countedQty, 'countedQty', { min: 0, max: 1e7 });
  const reason = v.str(input.reason, 'reason', { required: true, max: 300 });
  return tx(db, () => {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) throw notFound('Book');
    const delta = counted - book.stock_qty;
    if (delta === 0) throw badRequest('Counted quantity equals the current stock; nothing to adjust');
    if (counted < book.reserved_qty) {
      throw conflict(`Cannot set stock below ${book.reserved_qty}: that many copies are reserved for phone orders`);
    }
    applyStock(db, { bookId, stockDelta: delta, reason: 'adjustment', refType: 'adjustment', note: reason, userId: user.id });
    return db.prepare('SELECT id, title, stock_qty, reserved_qty FROM books WHERE id = ?').get(bookId);
  });
}

function movements(db, bookId, limit = 100) {
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) throw notFound('Book');
  return db.prepare(`SELECT m.id, m.delta, m.reason, m.ref_type AS refType, m.ref_id AS refId, m.note,
                            m.created_at AS createdAt, u.username AS user
                       FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
                      WHERE m.book_id = ? ORDER BY m.id DESC LIMIT ?`).all(bookId, Math.min(Number(limit) || 100, 500));
}

// Current-stock overview. lowOnly restricts to books at/below their effective threshold.
function stockOverview(db, { lowOnly = false, q = '' } = {}) {
  const { defaultLowStockThreshold } = getSettings(db);
  const rows = db.prepare(`
    SELECT id, title, author, isbn, edition, publisher, stock_qty AS stockQty, reserved_qty AS reservedQty,
           stock_qty - reserved_qty AS availableQty,
           COALESCE(low_stock_threshold, @def) AS threshold,
           low_stock_threshold IS NULL AS thresholdIsDefault,
           aisle, rack, shelf
      FROM books
     WHERE active = 1
       AND (@q = '' OR title LIKE @like ESCAPE '\\' OR author LIKE @like ESCAPE '\\' OR isbn LIKE @like ESCAPE '\\')
       AND (@low = 0 OR stock_qty - reserved_qty <= COALESCE(low_stock_threshold, @def))
     ORDER BY (stock_qty - reserved_qty) - COALESCE(low_stock_threshold, @def), title`)
    .all({ def: defaultLowStockThreshold, q, like: `%${q.replace(/[\\%_]/g, '\\$&')}%`, low: lowOnly ? 1 : 0 });
  return rows.map((r) => ({ ...r, thresholdIsDefault: !!r.thresholdIsDefault, isLowStock: r.availableQty <= r.threshold }));
}

module.exports = { applyStock, adjustStock, movements, stockOverview };
