const v = require('../lib/validate');
const { conflict, notFound, badRequest } = require('../lib/errors');
const { canSeeCost, requireShop } = require('../lib/tenant');
const { getSettings } = require('./settings');
const { BOOK_SELECT, loadBook, applyStock, likeEscape } = require('./inventory');

function locationText(b) {
  const parts = [];
  if (b.aisle) parts.push(`Aisle ${b.aisle}`);
  if (b.rack) parts.push(`Rack ${b.rack}`);
  if (b.shelf) parts.push(`Shelf ${b.shelf}`);
  return parts.join(' · ');
}

// Map a book-with-shop-stock row to the API shape. Cost is hidden from staff (it reflects supplier pricing).
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
    location: row.location || '',
    active: row.active,
  };
  if (includeCost) out.costCents = row.cost_cents;
  return out;
}

async function view(ctx) {
  return { includeCost: canSeeCost(ctx), defaultThreshold: (await getSettings(ctx.db, ctx.businessId)).defaultLowStockThreshold };
}

async function search(ctx, { q = '', genre = '', lowOnly = false, includeInactive = false, limit = 50, offset = 0 } = {}) {
  const tokens = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const vw = await view(ctx);
  const params = [ctx.businessId, requireShop(ctx)];
  const p = (val) => { params.push(val); return `$${params.length}`; };
  const where = [];
  for (const t of tokens) {
    const like = p(`%${likeEscape(t)}%`);
    const digits = p(`%${likeEscape(t.replace(/-/g, ''))}%`);
    where.push(`(b.title ILIKE ${like} OR b.author ILIKE ${like} OR b.publisher ILIKE ${like}
                 OR b.genre ILIKE ${like} OR b.edition ILIKE ${like} OR b.isbn ILIKE ${digits})`);
  }
  if (!includeInactive) where.push('b.active');
  if (genre) where.push(`lower(b.genre) = lower(${p(String(genre))})`);
  if (lowOnly) {
    where.push(`COALESCE(ss.stock_qty, 0) - COALESCE(ss.reserved_qty, 0) <= COALESCE(ss.low_stock_threshold, ${p(vw.defaultThreshold)})`);
  }
  const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
  const first = String(q).trim();
  const exact = p(first.replace(/[\s-]/g, '').toUpperCase());
  const prefix = p(`${likeEscape(first)}%`);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const total = (await ctx.db.one(`SELECT COUNT(*) AS c FROM books b LEFT JOIN shop_stock ss ON ss.book_id = b.id AND ss.shop_id = $2
                                    WHERE b.business_id = $1 ${whereSql}`, params.slice(0, params.length - 2))).c;
  const rows = await ctx.db.many(`${BOOK_SELECT} ${whereSql}
     ORDER BY (b.isbn = ${exact}) DESC NULLS LAST, (b.title ILIKE ${prefix}) DESC, lower(b.title), b.edition
     LIMIT ${lim} OFFSET ${off}`, params);
  return { total, items: rows.map((r) => toApi(r, vw)) };
}

async function get(ctx, id, q = ctx.db) {
  return toApi(await loadBook(q, ctx, id), await view(ctx));
}

async function genres(ctx) {
  return (await ctx.db.many(`SELECT DISTINCT genre FROM books WHERE business_id = $1 AND genre <> '' ORDER BY genre`, [ctx.businessId]))
    .map((r) => r.genre);
}

function parseFields(input) {
  v.object(input);
  return {
    title: v.str(input.title, 'title', { required: true, max: 300 }),
    author: v.str(input.author, 'author', { max: 200 }),
    isbn: v.isbn(input.isbn),
    publisher: v.str(input.publisher, 'publisher', { max: 200 }),
    edition: v.str(input.edition, 'edition', { max: 100 }),
    genre: v.str(input.genre, 'genre', { max: 100 }),
    price_cents: v.money(input.priceCents, 'priceCents', { min: 0, max: 1e9 }),
  };
}

// Shop-level fields (threshold, location) are optional on create / update and apply to the active shop.
function parseShopFields(input) {
  const out = {};
  if (input.lowStockThreshold !== undefined) out.low_stock_threshold = v.int(input.lowStockThreshold, 'lowStockThreshold', { min: 0, max: 100000, required: false });
  return out;
}

async function duplicateError(q, ctx, f, excludeId = -1) {
  if (f.isbn) {
    const other = await q.one('SELECT id, title, edition FROM books WHERE business_id = $1 AND isbn = $2 AND id <> $3', [ctx.businessId, f.isbn, excludeId]);
    if (other) return conflict(`ISBN ${f.isbn} already belongs to "${other.title}"${other.edition ? ` (${other.edition})` : ''}`, { bookId: other.id });
  } else {
    const other = await q.one(`SELECT id, title, author FROM books WHERE business_id = $1 AND isbn IS NULL AND lower(title) = lower($2)
                                 AND lower(author) = lower($3) AND lower(edition) = lower($4) AND lower(publisher) = lower($5) AND id <> $6`,
    [ctx.businessId, f.title, f.author, f.edition, f.publisher, excludeId]);
    if (other) return conflict(`"${other.title}"${other.author ? ` by ${other.author}` : ''} with the same edition and publisher already exists (no ISBN). Add an ISBN or a different edition to tell them apart.`, { bookId: other.id });
  }
  return null;
}

async function writeShopFields(q, ctx, bookId, sf) {
  const cols = Object.keys(sf);
  if (!cols.length) return;
  await q.query(`INSERT INTO shop_stock(business_id, shop_id, book_id) VALUES ($1, $2, $3) ON CONFLICT (shop_id, book_id) DO NOTHING`,
    [ctx.businessId, requireShop(ctx), bookId]);
  await q.query(`UPDATE shop_stock SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = now() WHERE shop_id = $1 AND book_id = $2`,
    [ctx.shopId, bookId, ...cols.map((c) => sf[c])]);
}

async function create(ctx, input) {
  const f = parseFields(input);
  const sf = parseShopFields(input);
  const opening = v.int(input.openingStock, 'openingStock', { min: 0, max: 1e7, required: false }) ?? 0;
  requireShop(ctx);
  return ctx.db.tx(async (q) => {
    const dup = await duplicateError(q, ctx, f);
    if (dup) throw dup;
    const { id } = await q.one(`INSERT INTO books(business_id, title, author, isbn, publisher, edition, genre, price_cents)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [ctx.businessId, f.title, f.author, f.isbn, f.publisher, f.edition, f.genre, f.price_cents]);
    await writeShopFields(q, ctx, id, sf);
    if (opening > 0) await applyStock(q, ctx, { bookId: id, stockDelta: opening, reason: 'opening', note: 'Opening stock' });
    return get(ctx, id, q);
  });
}

// Add a title from the global ISBN catalogue: bibliographic data is copied, the shop supplies price and stock.
async function createFromCatalog(ctx, input) {
  v.object(input);
  const isbn = v.isbn(input.isbn);
  if (!isbn) throw badRequest('isbn is required');
  const cat = await ctx.db.one('SELECT * FROM catalog_books WHERE isbn = $1', [isbn]);
  if (!cat) throw notFound(`ISBN ${isbn} in the catalogue`);
  return create(ctx, {
    ...input,
    isbn,
    title: input.title || cat.title,
    publisher: input.publisher ?? cat.publisher,
    genre: input.genre ?? cat.category,
    edition: input.edition ?? cat.format,
  });
}

async function update(ctx, id, input) {
  const f = parseFields(input);
  const sf = parseShopFields(input);
  return ctx.db.tx(async (q) => {
    if (!(await q.one('SELECT 1 FROM books WHERE business_id = $1 AND id = $2', [ctx.businessId, id]))) throw notFound('Book');
    const dup = await duplicateError(q, ctx, f, id);
    if (dup) throw dup;
    await q.query(`UPDATE books SET title = $3, author = $4, isbn = $5, publisher = $6, edition = $7, genre = $8, price_cents = $9, updated_at = now()
                    WHERE business_id = $1 AND id = $2`,
    [ctx.businessId, id, f.title, f.author, f.isbn, f.publisher, f.edition, f.genre, f.price_cents]);
    await writeShopFields(q, ctx, id, sf);
    return get(ctx, id, q);
  });
}

// Retire / restore a title (business-wide). Retired books disappear from billing / search but keep their history.
async function setActive(ctx, id, active) {
  return ctx.db.tx(async (q) => {
    const book = await q.one('SELECT id FROM books WHERE business_id = $1 AND id = $2', [ctx.businessId, id]);
    if (!book) throw notFound('Book');
    if (!active) {
      const { r } = await q.one('SELECT COALESCE(SUM(reserved_qty), 0) AS r FROM shop_stock WHERE book_id = $1', [id]);
      if (r > 0) throw conflict(`${r} cop${r === 1 ? 'y is' : 'ies are'} reserved for open phone orders; complete or cancel them first`);
    }
    await q.query('UPDATE books SET active = $2, updated_at = now() WHERE id = $1', [id, !!active]);
    return get(ctx, id, q);
  });
}

function parseLocation(input) {
  v.object(input);
  return {
    aisle: v.str(input.aisle, 'aisle', { max: 30 }) || '',
    rack: v.str(input.rack, 'rack', { max: 30 }) || '',
    shelf: v.str(input.shelf, 'shelf', { max: 30 }) || '',
  };
}

// Shelf placement in the active shop (Floor & Shelves designer).
async function setLocation(ctx, id, input) {
  throw conflict('Use Books to Arrange to confirm shelf placement');
}

async function batchAssignLocation(ctx, input) {
  throw conflict('Use Books to Arrange to confirm shelf placement');
}

module.exports = { search, get, genres, create, createFromCatalog, update, setActive, locationText, setLocation, batchAssignLocation, toApi };
