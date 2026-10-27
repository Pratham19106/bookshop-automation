const { tx } = require('../db');
const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { getSettings } = require('./settings');
const { applyStock } = require('./inventory');

const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');

function locationText(b) {
  const parts = [];
  if (b.aisle) parts.push(`Aisle ${b.aisle}`);
  if (b.rack) parts.push(`Rack ${b.rack}`);
  if (b.shelf) parts.push(`Shelf ${b.shelf}`);
  return parts.join(' · ');
}

// Map a DB row to the API shape. Cost is owner-only (it reflects supplier pricing).
function toApi(row, { includeCost, defaultThreshold }) {
  const threshold = row.low_stock_threshold ?? defaultThreshold;
  const available = row.stock_qty - row.reserved_qty;
  const out = {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    publisher: row.publisher,
    edition: row.edition,
    genre: row.genre,
    priceCents: row.price_cents,
    stockQty: row.stock_qty,
    reservedQty: row.reserved_qty,
    availableQty: available,
    lowStockThreshold: threshold,
    thresholdIsDefault: row.low_stock_threshold === null,
    isLowStock: available <= threshold,
    aisle: row.aisle,
    rack: row.rack,
    shelf: row.shelf,
    location: locationText(row),
    active: !!row.active,
  };
  if (includeCost) out.costCents = row.cost_cents;
  return out;
}

const ctx = (db, user) => ({ includeCost: user.role === 'owner', defaultThreshold: getSettings(db).defaultLowStockThreshold });

function search(db, user, { q = '', genre = '', lowOnly = false, includeInactive = false, limit = 50, offset = 0 } = {}) {
  const tokens = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const where = [];
  const params = {};
  tokens.forEach((t, i) => {
    const digits = t.replace(/-/g, '');
    params[`t${i}`] = `%${likeEscape(t)}%`;
    params[`d${i}`] = `%${likeEscape(digits)}%`;
    where.push(`(title LIKE @t${i} ESCAPE '\\' OR author LIKE @t${i} ESCAPE '\\' OR publisher LIKE @t${i} ESCAPE '\\'
                 OR genre LIKE @t${i} ESCAPE '\\' OR edition LIKE @t${i} ESCAPE '\\' OR isbn LIKE @d${i} ESCAPE '\\')`);
  });
  if (!includeInactive) where.push('active = 1');
  if (genre) { where.push('genre = @genre COLLATE NOCASE'); params.genre = genre; }
  const { defaultLowStockThreshold } = getSettings(db);
  if (lowOnly) { where.push('stock_qty - reserved_qty <= COALESCE(low_stock_threshold, @def)'); params.def = defaultLowStockThreshold; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Rank exact ISBN, then title prefix, then the rest alphabetically.
  const first = String(q).trim();
  params.exactIsbn = first.replace(/[\s-]/g, '').toUpperCase();
  params.prefix = `${likeEscape(first)}%`;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) c FROM books ${whereSql}`).get(params).c;
  const rows = db.prepare(`SELECT * FROM books ${whereSql}
                           ORDER BY (isbn = @exactIsbn) DESC, (title LIKE @prefix ESCAPE '\\') DESC, title COLLATE NOCASE, edition
                           LIMIT ${lim} OFFSET ${off}`).all(params);
  const c = ctx(db, user);
  return { total, items: rows.map((r) => toApi(r, c)) };
}

function get(db, user, id) {
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!row) throw notFound('Book');
  return toApi(row, ctx(db, user));
}

function genres(db) {
  return db.prepare("SELECT DISTINCT genre FROM books WHERE genre <> '' ORDER BY genre COLLATE NOCASE").all().map((r) => r.genre);
}

function parseFields(input) {
  v.object(input);
  return {
    title: v.str(input.title, 'title', { required: true, max: 300 }),
    author: v.str(input.author, 'author', { required: true, max: 200 }),
    isbn: v.isbn(input.isbn),
    publisher: v.str(input.publisher, 'publisher', { max: 200 }),
    edition: v.str(input.edition, 'edition', { max: 100 }),
    genre: v.str(input.genre, 'genre', { max: 100 }),
    price_cents: v.int(input.priceCents, 'priceCents', { min: 0, max: 1e9 }),
    low_stock_threshold: v.int(input.lowStockThreshold, 'lowStockThreshold', { min: 0, max: 100000, required: false }),
    aisle: v.str(input.aisle, 'aisle', { max: 30 }),
    rack: v.str(input.rack, 'rack', { max: 30 }),
    shelf: v.str(input.shelf, 'shelf', { max: 30 }),
  };
}

function duplicateError(db, f, excludeId) {
  let other;
  if (f.isbn) {
    other = db.prepare('SELECT * FROM books WHERE isbn = ? AND id <> ?').get(f.isbn, excludeId ?? -1);
    if (other) return conflict(`ISBN ${f.isbn} already belongs to "${other.title}"${other.edition ? ` (${other.edition})` : ''}`, { bookId: other.id });
  } else {
    other = db.prepare(`SELECT * FROM books WHERE isbn IS NULL AND lower(title)=lower(?) AND lower(author)=lower(?)
                        AND lower(edition)=lower(?) AND lower(publisher)=lower(?) AND id <> ?`)
      .get(f.title, f.author, f.edition, f.publisher, excludeId ?? -1);
    if (other) return conflict(`"${other.title}" by ${other.author} with the same edition and publisher already exists (no ISBN). Add an ISBN or a different edition to tell them apart.`, { bookId: other.id });
  }
  return null;
}

function create(db, user, input) {
  const f = parseFields(input);
  const opening = v.int(input.openingStock, 'openingStock', { min: 0, max: 1e7, required: false }) ?? 0;
  return tx(db, () => {
    const dup = duplicateError(db, f);
    if (dup) throw dup;
    const r = db.prepare(`INSERT INTO books(title, author, isbn, publisher, edition, genre, price_cents, low_stock_threshold, aisle, rack, shelf)
                          VALUES (@title, @author, @isbn, @publisher, @edition, @genre, @price_cents, @low_stock_threshold, @aisle, @rack, @shelf)`).run(f);
    const id = Number(r.lastInsertRowid);
    if (opening > 0) applyStock(db, { bookId: id, stockDelta: opening, reason: 'opening', note: 'Opening stock', userId: user.id });
    return get(db, user, id);
  });
}

function update(db, user, id, input) {
  const f = parseFields(input);
  return tx(db, () => {
    if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(id)) throw notFound('Book');
    const dup = duplicateError(db, f, id);
    if (dup) throw dup;
    db.prepare(`UPDATE books SET title=@title, author=@author, isbn=@isbn, publisher=@publisher, edition=@edition, genre=@genre,
                price_cents=@price_cents, low_stock_threshold=@low_stock_threshold, aisle=@aisle, rack=@rack, shelf=@shelf,
                updated_at=@now WHERE id=@id`).run({ ...f, id, now: new Date().toISOString() });
    return get(db, user, id);
  });
}

// Retire/restore a title. Retired books disappear from billing/search but keep their history.
function setActive(db, user, id, active) {
  return tx(db, () => {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) throw notFound('Book');
    if (!active && book.reserved_qty > 0) throw conflict(`${book.reserved_qty} cop${book.reserved_qty === 1 ? 'y is' : 'ies are'} reserved for open phone orders; complete or cancel them first`);
    db.prepare('UPDATE books SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), id);
    return get(db, user, id);
  });
}

// Fast shelf relocation / batch placement for the Floor & Shelves designer
function setLocation(db, user, id, input) {
  v.object(input);
  const aisle = v.str(input.aisle, 'aisle', { max: 30, required: false }) || '';
  const rack = v.str(input.rack, 'rack', { max: 30, required: false }) || '';
  const shelf = v.str(input.shelf, 'shelf', { max: 30, required: false }) || '';
  return tx(db, () => {
    const book = db.prepare('SELECT id FROM books WHERE id = ?').get(id);
    if (!book) throw notFound('Book');
    db.prepare('UPDATE books SET aisle = ?, rack = ?, shelf = ?, updated_at = ? WHERE id = ?')
      .run(aisle, rack, shelf, new Date().toISOString(), id);
    return get(db, user, id);
  });
}

function batchAssignLocation(db, user, input) {
  v.object(input);
  const aisle = v.str(input.aisle, 'aisle', { max: 30, required: false }) || '';
  const rack = v.str(input.rack, 'rack', { max: 30, required: false }) || '';
  const shelf = v.str(input.shelf, 'shelf', { max: 30, required: false }) || '';
  const bookIds = v.array(input.bookIds, 'bookIds', { min: 1, max: 1000 });
  return tx(db, () => {
    const stmt = db.prepare('UPDATE books SET aisle = ?, rack = ?, shelf = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const rawId of bookIds) {
      const id = v.int(rawId, 'bookId', { min: 1 });
      stmt.run(aisle, rack, shelf, now, id);
    }
    return { ok: true, count: bookIds.length, aisle, rack, shelf };
  });
}

module.exports = { search, get, genres, create, update, setActive, locationText, setLocation, batchAssignLocation };
