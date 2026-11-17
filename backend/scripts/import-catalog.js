/*
 * Import the global ISBN reference catalogue from the open4goods ISBN dataset into catalog_books.
 *
 *   npm run import-catalog -- [--file path/to/open4goods-isbn-dataset.csv] [--limit 10000] [--per-category 150] [--dry-run]
 *
 * The source (~1.3 GB, ~7.7M rows) is mostly French. We keep English-language (978-0 / 978-1) and Indian
 * (978-81 / 978-93) ISBNs that have both a publisher and a category, validate the ISBN-13 checksum, translate the
 * (French, Decitre) category into English, and pick a varied subset:
 *   - Indian-ISBN titles first (most relevant to an Indian bookshop),
 *   - then round-robin across categories, at most --per-category rows each, so no genre (e.g. manga) dominates.
 * Only the needed columns are kept: isbn, title, publisher, format, pages, category, subcategory, reference price.
 * Re-running is safe: rows are upserted on ISBN.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse');
const config = require('../src/config');
const { createDb } = require('../src/db');
const { migrate } = require('../src/db/migrate');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const FILE = path.resolve(opt('file', path.join(__dirname, '..', '..', '..', 'open4goods-isbn-dataset.csv')));
const LIMIT = Number(opt('limit', 10000));
const PER_CATEGORY = Number(opt('per-category', 150));
const DRY = args.includes('--dry-run');

const PREFIXES = ['9780', '9781', '97881', '97893'];

// Decitre (French) top-level categories -> English shelf categories. Unlisted ones are kept as-is.
const CATEGORY_EN = {
  'Manga': 'Manga', 'Comics': 'Comics', 'BD tout public': 'Graphic Novels', 'BD jeunesse': 'Graphic Novels',
  'Bandes dessinées, Comics, Mangas': 'Graphic Novels', 'Humour': 'Humour',
  'Actualités et médias': 'Current Affairs & Media', 'Beaux arts': 'Fine Arts', 'Musique - danse': 'Music & Dance',
  'Littérature étrangère': 'Fiction', 'Littérature française': 'Fiction', 'Littérature Générale': 'Fiction',
  'Poches littérature internationale': 'Fiction', 'Poches littérature française': 'Fiction',
  'Littérature érotique et sentimentale': 'Romance', 'Littérature jeunesse': 'Children', 'Albums 0/6 ans': 'Children',
  'Livres 0-3 ans': 'Children', 'Livres 3 ans et +': 'Children', 'Lecture 6-9 ans': 'Children', '12 ans et +': 'Young Adult',
  'Documentaires jeunesse': 'Children\'s Non-fiction', 'Policiers': 'Mystery & Crime', 'Science-fiction': 'Sci-Fi',
  'Fantastique': 'Fantasy', 'Poésie': 'Poetry', 'Critique littéraire': 'Literary Criticism', 'Théâtre': 'Drama',
  'Histoire internationale': 'History', 'Histoire de France': 'History', 'Histoire ancienne': 'History', 'Histoire': 'History',
  'Sciences historiques': 'History', 'Géographie': 'Geography', 'Sciences politiques': 'Politics', 'Sociologie': 'Sociology',
  'Philosophie': 'Philosophy', 'Religion': 'Religion', 'Ésotérisme': 'Spirituality', 'Psychologie - Psychanalyse': 'Psychology',
  'Développement personnel': 'Self-Help', 'Couple - Famille': 'Family & Relationships', 'Santé': 'Health',
  'Spécialités médicales': 'Medicine', 'Sciences PCEM': 'Medicine', 'Informatique': 'Computing', 'Technologie': 'Technology',
  'Mathématiques': 'Mathematics', 'Physique - Chimie': 'Physics & Chemistry', 'Sciences de la vie et de la terre': 'Life & Earth Sciences',
  'Histoire et philosophie des sciences': 'History of Science', 'Économie': 'Economics', 'Gestion': 'Business & Management',
  'Droit': 'Law', 'Anglais': 'English Language', 'Pédagogie': 'Education', 'Collège parascolaire': 'School Revision',
  'Science humaines et sociales, Lettres': 'Humanities', 'Cuisine': 'Cooking', 'Décoration': 'Home & Decor',
  'Sports': 'Sports', 'Loisirs': 'Hobbies', 'Loisirs et Jeux': 'Games & Hobbies', 'Pratique': 'Practical Guides',
  'Animaux/Nature': 'Nature & Animals', 'Cinéma': 'Film', 'Guides touristiques Monde': 'Travel', 'Tourisme hors France': 'Travel',
  'Tourisme en France': 'Travel',
};

function validIsbn13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function toRow(r) {
  const isbn = String(r.isbn || '').trim();
  if (!PREFIXES.some((p) => isbn.startsWith(p)) || !validIsbn13(isbn)) return null;
  const title = clean(r.title, 300);
  const publisher = clean(r.editeur, 200);
  const rawCat = clean(r.classification_decitre_1, 100);
  if (!title || title.length < 2 || !publisher || !rawCat) return null;
  const price = Number.parseFloat(r.min_price);
  const pages = Number.parseInt(r.nb_page, 10);
  return {
    isbn,
    title,
    publisher,
    format: clean(r.format, 60),
    pages: Number.isInteger(pages) && pages > 0 && pages < 20000 ? pages : null,
    category: CATEGORY_EN[rawCat] || rawCat,
    subcategory: clean(r.classification_decitre_2, 100),
    ref_price_cents: Number.isFinite(price) && price > 0 && price < 10000 ? Math.round(price * 100) : null,
    indian: isbn.startsWith('97881') || isbn.startsWith('97893'),
  };
}

async function scan() {
  if (!fs.existsSync(FILE)) throw new Error(`Dataset not found: ${FILE} (pass --file)`);
  // Per category: up to PER_CATEGORY Indian-ISBN rows and PER_CATEGORY others; Indian ones are taken first.
  const byCat = new Map();
  let rows = 0;
  let kept = 0;
  const parser = fs.createReadStream(FILE).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true }));
  for await (const r of parser) {
    rows += 1;
    if (rows % 1000000 === 0) console.log(`  scanned ${(rows / 1e6).toFixed(0)}M rows, ${kept} candidates`);
    const row = toRow(r);
    if (!row) continue;
    kept += 1;
    const entry = byCat.get(row.category) || { indian: [], other: [] };
    const list = row.indian ? entry.indian : entry.other;
    if (list.length < PER_CATEGORY) list.push(row);
    byCat.set(row.category, entry);
  }
  // Round-robin across categories until the limit, so every category is represented.
  const picked = [];
  const lists = [...byCat.values()].map((e) => [...e.indian, ...e.other]);
  for (let i = 0; picked.length < LIMIT; i++) {
    let added = false;
    for (const l of lists) {
      if (i < l.length && picked.length < LIMIT) { picked.push(l[i]); added = true; }
    }
    if (!added) break;
  }
  return { rows, kept, picked, categories: byCat.size };
}

async function load(db, picked) {
  const cols = ['isbn', 'title', 'publisher', 'format', 'pages', 'category', 'subcategory', 'ref_price_cents'];
  const BATCH = 2000;
  let done = 0;
  for (let i = 0; i < picked.length; i += BATCH) {
    const chunk = picked.slice(i, i + BATCH);
    const params = [];
    const values = chunk.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(', ')})`);
    await db.query(`INSERT INTO catalog_books (${cols.join(', ')}) VALUES ${values.join(', ')}
                    ON CONFLICT (isbn) DO UPDATE SET title = EXCLUDED.title, publisher = EXCLUDED.publisher, format = EXCLUDED.format,
                      pages = EXCLUDED.pages, category = EXCLUDED.category, subcategory = EXCLUDED.subcategory,
                      ref_price_cents = EXCLUDED.ref_price_cents`, params);
    done += chunk.length;
    console.log(`  loaded ${done}/${picked.length}`);
  }
}

(async () => {
  console.log(`Scanning ${FILE} (limit ${LIMIT}, max ${PER_CATEGORY} per category)...`);
  const t0 = Date.now();
  const { rows, kept, picked, categories } = await scan();
  console.log(`Scanned ${rows} rows in ${Math.round((Date.now() - t0) / 1000)}s: ${kept} usable, ${categories} categories, ${picked.length} selected.`);
  const counts = {};
  for (const r of picked) counts[r.category] = (counts[r.category] || 0) + 1;
  console.log('Top categories:', Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} ${n}`).join(', '));
  if (DRY) return;
  const db = createDb({ connectionString: config.databaseUrl, max: 1 });
  try {
    await migrate(db, { log: (m) => console.log(m) });
    await load(db, picked);
    const { n } = await db.one('SELECT COUNT(*) AS n FROM catalog_books');
    console.log(`✓ catalog_books now holds ${n} titles.`);
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error('Import failed:', e.message);
  process.exitCode = 1;
});
