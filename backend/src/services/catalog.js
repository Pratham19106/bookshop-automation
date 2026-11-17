const { notFound, badRequest } = require('../lib/errors');
const { likeEscape } = require('./inventory');

// Global ISBN reference catalogue (read-only). Lets a shop add a title by searching instead of typing it in.

const toApi = (r) => ({
  isbn: r.isbn, title: r.title, publisher: r.publisher, format: r.format, pages: r.pages,
  category: r.category, subcategory: r.subcategory, refPriceCents: r.ref_price_cents,
  bookId: r.book_id ?? null, // set when this business already stocks the ISBN
});

async function search(ctx, { q = '', category = '', limit = 20 } = {}) {
  const text = String(q).trim();
  if (text.length < 2) throw badRequest('Type at least 2 characters to search the catalogue');
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const digits = text.replace(/[\s-]/g, '').toUpperCase();
  const params = [ctx.businessId];
  const p = (val) => { params.push(val); return `$${params.length}`; };

  let where;
  let order;
  if (/^[0-9]{9}[0-9X]$|^[0-9]{13}$/.test(digits)) {
    where = `c.isbn = ${p(digits)}`;
    order = 'c.title';
  } else if (/^[0-9]{4,}$/.test(digits)) {
    where = `c.isbn LIKE ${p(`${digits}%`)}`;
    order = 'c.isbn';
  } else {
    // Every word must appear in the title (trigram index on lower(title)); title prefix matches rank first.
    const words = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    where = words.map((w) => `lower(c.title) LIKE ${p(`%${likeEscape(w)}%`)}`).join(' AND ');
    order = `(lower(c.title) LIKE ${p(`${likeEscape(text.toLowerCase())}%`)}) DESC, length(c.title), c.title`;
  }
  if (category) where += ` AND c.category = ${p(String(category))}`;
  const rows = await ctx.db.many(`SELECT c.*, b.id AS book_id FROM catalog_books c
                                    LEFT JOIN books b ON b.business_id = $1 AND b.isbn = c.isbn
                                   WHERE ${where} ORDER BY ${order} LIMIT ${lim}`, params);
  return { items: rows.map(toApi) };
}

async function getByIsbn(ctx, isbn) {
  const digits = String(isbn).replace(/[\s-]/g, '').toUpperCase();
  const row = await ctx.db.one(`SELECT c.*, b.id AS book_id FROM catalog_books c
                                  LEFT JOIN books b ON b.business_id = $1 AND b.isbn = c.isbn WHERE c.isbn = $2`, [ctx.businessId, digits]);
  if (!row) throw notFound(`ISBN ${digits} in the catalogue`);
  return toApi(row);
}

async function categories(ctx) {
  return (await ctx.db.many(`SELECT category, COUNT(*) AS n FROM catalog_books WHERE category <> ''
                              GROUP BY category ORDER BY n DESC LIMIT 200`)).map((r) => ({ category: r.category, count: r.n }));
}

module.exports = { search, getByIsbn, categories };
