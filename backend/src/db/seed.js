const bcrypt = require('bcryptjs');
const { computeTotals } = require('../lib/money');
const purchasing = require('../services/purchasing');
const orders = require('../services/orders');

const DAY = 86400000;

// Valid ISBN-13 from a 9-digit body (978 prefix), so demo titles pass the API's checksum validation.
function isbn13(body9) {
  const d = '978' + body9;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return d + ((10 - (sum % 10)) % 10);
}

// Deterministic PRNG so the generated data is consistent and verifiable.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

// [title, author, publisher, edition, genre, price (₹), aisle, rack, shelf, popularity(0-1), shelf stock]
const CATALOGUE = [
  ['The Alchemist', 'Paulo Coelho', 'HarperOne', 'Paperback 2014', 'Fiction', 299, 'A', '1', '2', 0.9, 40],
  ['The White Tiger', 'Aravind Adiga', 'Atlantic Books', '1st', 'Fiction', 350, 'A', '1', '4', 0.45, 18],
  ["Midnight's Children", 'Salman Rushdie', 'Vintage Classics', '40th Anniversary', 'Fiction', 550, 'A', '2', '1', 0.35, 15],
  ['The God of Small Things', 'Arundhati Roy', 'IndiaInk', 'Paperback', 'Fiction', 399, 'A', '2', '2', 0.5, 22],
  ['The Kite Runner', 'Khaled Hosseini', 'Riverhead Books', '10th Anniversary', 'Fiction', 399, 'A', '2', '3', 0.65, 28],
  ['1984', 'George Orwell', 'Penguin', 'Paperback 2008', 'Fiction', 250, 'A', '3', '2', 0.6, 30],
  ['Animal Farm', 'George Orwell', 'Penguin', 'Paperback 2008', 'Fiction', 199, 'A', '3', '3', 0.6, 30],
  ['To Kill a Mockingbird', 'Harper Lee', 'Arrow', 'Paperback 2010', 'Fiction', 325, 'A', '3', '4', 0.45, 20],
  ['Pride and Prejudice', 'Jane Austen', 'Penguin Classics', '2nd', 'Classics', 275, 'A', '4', '3', 0.35, 18],
  ['The Great Gatsby', 'F. Scott Fitzgerald', 'Scribner', 'Paperback 2004', 'Classics', 250, 'A', '4', '4', 0.5, 24],
  ['Crime and Punishment', 'Fyodor Dostoevsky', 'Vintage', 'Pevear Translation', 'Classics', 450, 'B', '1', '1', 0.35, 16],
  ['Dune', 'Frank Herbert', 'Ace Books', 'Deluxe Edition', 'Sci-Fi', 650, 'D', '1', '1', 0.8, 35],
  ['Project Hail Mary', 'Andy Weir', 'Ballantine Books', '1st', 'Sci-Fi', 599, 'D', '2', '1', 0.75, 26],
  ['The Hobbit', 'J. R. R. Tolkien', 'Mariner Books', 'Paperback 2012', 'Fantasy', 450, 'D', '2', '3', 0.65, 30],
  ['Atomic Habits', 'James Clear', 'Penguin', '1st', 'Self-Help', 499, 'B', '2', '1', 1.0, 45],
  ['Ikigai', 'Hector Garcia', 'Penguin', '1st', 'Self-Help', 350, 'B', '2', '2', 0.75, 28],
  ['Deep Work', 'Cal Newport', 'Piatkus', '1st', 'Self-Help', 450, 'B', '2', '3', 0.45, 20],
  ['The Psychology of Money', 'Morgan Housel', 'Jaico', '1st', 'Finance', 399, 'B', '2', '4', 0.85, 35],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Farrar, Straus and Giroux', '1st', 'Psychology', 499, 'B', '3', '1', 0.6, 24],
  ["Man's Search for Meaning", 'Viktor E. Frankl', 'Beacon Press', '1st', 'Psychology', 299, 'B', '3', '2', 0.65, 26],
  ['Rich Dad Poor Dad', 'Robert Kiyosaki', 'Plata', '20th Anniversary', 'Finance', 350, 'B', '4', '1', 0.75, 30],
  ['Zero to One', 'Peter Thiel', 'Virgin', '1st', 'Business', 499, 'B', '4', '2', 0.45, 18],
  ['The Intelligent Investor', 'Benjamin Graham', 'Harper Business', 'Revised 2006', 'Finance', 699, 'B', '4', '3', 0.65, 26],
  ['Shoe Dog', 'Phil Knight', 'Scribner', 'Paperback 2018', 'Business', 499, 'B', '4', '4', 0.6, 24],
  ['Sapiens', 'Yuval Noah Harari', 'Harvill Secker', '1st', 'History', 550, 'C', '2', '1', 0.7, 25],
  ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Universities Press', '1st', 'Biography', 225, 'C', '3', '1', 0.65, 25],
  ['India After Gandhi', 'Ramachandra Guha', 'HarperCollins', '10th Anniversary', 'History', 750, 'C', '3', '3', 0.35, 14],
  ['A Brief History of Time', 'Stephen Hawking', 'Bantam', '10th Anniversary', 'Science', 399, 'C', '3', '4', 0.55, 22],
  ['Meditations', 'Marcus Aurelius', 'Modern Library', 'Hays Translation', 'Philosophy', 350, 'C', '4', '3', 0.7, 28],
  ['Clean Code', 'Robert C. Martin', 'Prentice Hall', '1st', 'Technology', 3200, 'E', '1', '1', 0.35, 12],
  ['Introduction to Algorithms', 'Cormen et al.', 'MIT Press', '4th', 'Technology', 5800, 'E', '1', '2', 0.15, 6],
  ['Designing Data-Intensive Applications', 'Martin Kleppmann', "O'Reilly Media", '1st', 'Technology', 3400, 'E', '2', '1', 0.45, 16],
  ['Grokking Algorithms', 'Aditya Bhargava', 'Manning', '1st', 'Technology', 1850, 'E', '2', '4', 0.5, 18],
  ['The Silent Patient', 'Alex Michaelides', 'Celadon Books', '1st', 'Mystery', 399, 'G', '1', '1', 0.8, 32],
  ['And Then There Were None', 'Agatha Christie', 'William Morrow', 'Paperback', 'Mystery', 299, 'G', '1', '2', 0.65, 25],
  ["Harry Potter and the Philosopher's Stone", 'J. K. Rowling', 'Bloomsbury', 'Paperback 2014', 'Children', 399, 'F', '1', '1', 0.9, 45],
  ['The Little Prince', 'Antoine de Saint-Exupery', 'Egmont', '1st', 'Children', 199, 'F', '2', '1', 0.4, 18],
  ['Gitanjali', 'Rabindranath Tagore', 'Fingerprint', '1st', 'Poetry', 150, 'G', '3', '1', 0.2, 12],
];

const SUPPLIERS = [
  { name: 'Sharma Book Distributors Pvt Ltd', contactPerson: 'Anil Sharma', phone: '+91 98200 11111', email: 'anil@sharmabooks.example', categories: 'Fiction, Classics, Self-Help, Children', leadTimeDays: 4, discount: 0.62 },
  { name: 'National Publishing House & Wholesale', contactPerson: 'Meera Joshi', phone: '+91 98200 22222', email: 'orders@nph.example', categories: 'History, Biography, Classics, Poetry, Philosophy', leadTimeDays: 7, discount: 0.60 },
  { name: 'TechBooks India Distribution Network', contactPerson: 'Rohan Patil', phone: '+91 98200 33333', email: 'sales@techbooks.example', categories: 'Technology, Business, Finance, Science', leadTimeDays: 9, discount: 0.68 },
  { name: 'Metro Wholesale Books Corporation', contactPerson: 'Farah Khan', phone: '+91 98200 44444', email: 'farah@metrobooks.example', categories: 'All categories', leadTimeDays: 3, discount: 0.65 },
  { name: 'Apex Trade & Paperbacks Ltd', contactPerson: 'Sunita Menon', phone: '+91 98200 66666', email: 'orders@apextrade.example', categories: 'Fiction, Mystery, Sci-Fi, Fantasy', leadTimeDays: 5, discount: 0.64 },
];

const SHOPS = [
  { code: 'S01', name: 'Pratham Books - Dadar (HQ)', city: 'Mumbai', address: '12 College Road, Dadar', phone: '022-2411 5452', isHq: true, traffic: 1.0 },
  { code: 'S02', name: 'Pratham Books - FC Road', city: 'Pune', address: '44 Fergusson College Road', phone: '020-2553 9900', isHq: false, traffic: 0.7 },
];

// username, full name, password, role, shop codes (owner: all)
const USERS = [
  ['Pratham19106', 'Pratham (Owner)', 'Password123', 'owner', []],
  ['owner', 'Shop Owner', 'owner12345', 'owner', []],
  ['manager', 'Meera Manager', 'manager12345', 'manager', ['S01', 'S02']],
  ['worker', 'Store Worker', 'Worker123', 'staff', ['S01']],
  ['staff', 'Counter Staff', 'staff12345', 'staff', ['S01']],
  ['punestaff', 'Pune Counter Staff', 'staff12345', 'staff', ['S02']],
];

const CUSTOMERS = ['Aarav Sharma', 'Priya Desai', 'Rahul Mehta', 'Ananya Iyer', 'Rohan Gupta', 'Aditi Rao', 'Vikram Patel', 'Sneha Kulkarni', 'Arjun Nair', 'Kavita Joshi'];

// All tenant tables, children first. catalog_books (the global ISBN catalogue) is never touched by the seed.
const TENANT_TABLES = ['goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders', 'supplier_books', 'suppliers',
  'sale_returns', 'sale_items', 'order_payments', 'phone_order_items', 'sales', 'phone_orders', 'stock_movements', 'shop_stock',
  'expenses', 'books', 'shop_counters', 'sessions', 'user_shops', 'users', 'shops', 'business_settings', 'businesses'];

// Multi-row INSERT in chunks (Postgres allows 65535 bind parameters per statement).
async function bulkInsert(q, table, cols, rows, returning = '') {
  const out = [];
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const params = [];
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`);
    const res = await q.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')} ${returning ? `RETURNING ${returning}` : ''}`, params);
    out.push(...res.rows);
  }
  return out;
}

/**
 * Demo data for one business with two shops:
 *  - owner / manager / staff logins, staff assigned per shop
 *  - ~40 hand-picked titles (+ up to 20 from the ISBN catalogue when it has been imported)
 *  - 5 suppliers with quoted prices, 60 days of counter sales in both shops, expenses
 *  - a received and an open purchase order, open phone orders with reservations (created through the services)
 * Refuses to run on a database that already has businesses unless force = true, which wipes ALL tenant data.
 */
async function seedDemo(db, { now = new Date(), force = false, log = () => {} } = {}) {
  const { c } = await db.one('SELECT COUNT(*) AS c FROM businesses');
  if (c > 0 && !force) throw new Error('Database already contains businesses. Pass --force to wipe all tenant data and reseed.');
  const rand = rng(42);
  const iso = (t) => new Date(t).toISOString();
  const start = now.getTime() - 60 * DAY;

  const ids = await db.tx(async (q) => {
    if (force) await q.query(`TRUNCATE ${TENANT_TABLES.join(', ')} RESTART IDENTITY CASCADE`);

    log('business, shops, users');
    const business = await q.one(`INSERT INTO businesses(name, slug, email, phone) VALUES ('Pratham Books', 'pratham-books', 'hello@prathambooks.example', '022-2411 5452') RETURNING id`);
    const bid = business.id;
    await q.query('INSERT INTO business_settings(business_id) VALUES ($1)', [bid]);
    const shopRows = await bulkInsert(q, 'shops', ['business_id', 'code', 'name', 'city', 'address', 'phone', 'is_hq'],
      SHOPS.map((s) => [bid, s.code, s.name, s.city, s.address, s.phone, s.isHq]), 'id, code');
    const shopId = Object.fromEntries(shopRows.map((r) => [r.code, r.id]));
    const userId = {};
    for (const [username, fullName, password, role, shops] of USERS) {
      const u = await q.one(`INSERT INTO users(business_id, username, full_name, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [bid, username, fullName, await bcrypt.hash(password, 10), role]);
      userId[username] = u.id;
      for (const code of shops) await q.query('INSERT INTO user_shops(business_id, user_id, shop_id) VALUES ($1, $2, $3)', [bid, u.id, shopId[code]]);
    }

    log('books');
    const titles = CATALOGUE.map(([title, author, publisher, edition, genre, price, aisle, rack, shelf, pop, stock], i) => ({
      isbn: isbn13(String(100000000 + i * 7919).slice(0, 9)), title, author, publisher, edition, genre, price: price * 100,
      aisle, rack, shelf, pop, stock,
    }));
    // Real titles from the imported ISBN catalogue, if present, so the demo shows catalogue-sourced stock too.
    const fromCatalog = await q.many(`SELECT isbn, title, publisher, format, category, ref_price_cents FROM catalog_books
                                       WHERE length(title) BETWEEN 5 AND 70 ORDER BY md5(isbn) LIMIT 20`);
    fromCatalog.forEach((cb, i) => titles.push({
      isbn: cb.isbn, title: cb.title, author: '', publisher: cb.publisher, edition: cb.format, genre: cb.category,
      price: Math.max(19900, Math.round(((cb.ref_price_cents || 1500) * 0.9) / 100) * 100),
      aisle: 'H', rack: String(1 + Math.floor(i / 5)), shelf: String(1 + (i % 5)), pop: 0.15, stock: 6,
    }));
    const bookRows = await bulkInsert(q, 'books', ['business_id', 'isbn', 'title', 'author', 'publisher', 'edition', 'genre', 'price_cents', 'created_at', 'updated_at'],
      titles.map((t) => [bid, t.isbn, t.title, t.author, t.publisher, t.edition, t.genre, t.price, iso(start), iso(start)]), 'id, isbn');
    const bookIdByIsbn = Object.fromEntries(bookRows.map((r) => [r.isbn, r.id]));
    titles.forEach((t) => { t.id = bookIdByIsbn[t.isbn]; });

    log('suppliers and quotes');
    const supplierRows = await bulkInsert(q, 'suppliers', ['business_id', 'name', 'contact_person', 'phone', 'email', 'categories', 'lead_time_days'],
      SUPPLIERS.map((s) => [bid, s.name, s.contactPerson, s.phone, s.email, s.categories, s.leadTimeDays]), 'id');
    const quotes = [];
    const cheapest = new Map();
    for (const t of titles) {
      SUPPLIERS.forEach((s, si) => {
        if (s.categories !== 'All categories' && !s.categories.includes(t.genre)) return;
        const cost = Math.round((t.price * s.discount * (1 + (rand() - 0.5) * 0.08)) / 100) * 100;
        quotes.push([bid, supplierRows[si].id, t.id, cost]);
        if (!cheapest.has(t.id) || cost < cheapest.get(t.id)) cheapest.set(t.id, cost);
      });
    }
    await bulkInsert(q, 'supplier_books', ['business_id', 'supplier_id', 'book_id', 'unit_cost_cents'], quotes);

    log('60 days of sales');
    const { tax_bp: taxBp } = await q.one('SELECT tax_bp FROM business_settings WHERE business_id = $1', [bid]);
    const sold = new Map(); // `${shop}:${book}` -> units
    const saleRows = [];
    const lineRows = [];
    for (const s of SHOPS) {
      const sid = shopId[s.code];
      const cashiers = USERS.filter((u) => u[3] === 'owner' || u[4].includes(s.code)).map((u) => userId[u[0]]);
      let billNo = 0;
      for (let d = 59; d >= 0; d--) {
        const day = now.getTime() - d * DAY;
        const weekend = [0, 6].includes(new Date(day).getUTCDay());
        const bills = Math.round((4 + rand() * 6) * (weekend ? 1.4 : 1) * s.traffic);
        for (let k = 0; k < bills; k++) {
          const lines = [];
          const picked = new Set();
          for (let j = 0, n = 1 + Math.floor(rand() * 3); j < n; j++) {
            const t = titles[Math.floor(rand() * titles.length)];
            if (picked.has(t.id) || rand() > t.pop + 0.12) continue;
            picked.add(t.id);
            lines.push({ bookId: t.id, t, quantity: 1 + (rand() < 0.25 ? 1 : 0), unitPriceCents: t.price });
          }
          if (!lines.length) continue;
          billNo += 1;
          const discountBp = rand() < 0.15 ? 500 : 0;
          const tot = computeTotals(lines, discountBp, taxBp);
          const key = `INV-${s.code}-${String(billNo).padStart(6, '0')}`;
          saleRows.push([bid, sid, key, rand() < 0.4 ? CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)] : '', ['cash', 'upi', 'card'][Math.floor(rand() * 3)],
            tot.subtotalCents, discountBp, tot.discountCents, taxBp, tot.taxCents, tot.totalCents,
            cashiers[Math.floor(rand() * cashiers.length)], iso(day - Math.floor(rand() * 9 * 3600000) - 3600000)]);
          for (const l of lines) {
            lineRows.push({ key: `${sid}|${key}`, l });
            sold.set(`${sid}:${l.bookId}`, (sold.get(`${sid}:${l.bookId}`) || 0) + l.quantity);
          }
        }
      }
      await q.query(`INSERT INTO shop_counters(shop_id, kind, value) VALUES ($1, 'bill', $2)`, [sid, billNo]);
    }
    const inserted = await bulkInsert(q, 'sales', ['business_id', 'shop_id', 'bill_no', 'customer_name', 'payment_method', 'subtotal_cents', 'discount_bp',
      'discount_cents', 'tax_bp', 'tax_cents', 'total_cents', 'user_id', 'created_at'], saleRows, 'id, shop_id, bill_no, created_at, user_id');
    const saleByKey = new Map(inserted.map((r) => [`${r.shop_id}|${r.bill_no}`, r]));
    await bulkInsert(q, 'sale_items', ['sale_id', 'book_id', 'title', 'author', 'isbn', 'edition', 'quantity', 'unit_price_cents', 'unit_cost_cents', 'line_total_cents'],
      lineRows.map(({ key, l }) => [saleByKey.get(key).id, l.bookId, l.t.title, l.t.author, l.t.isbn, l.t.edition, l.quantity, l.unitPriceCents,
        cheapest.get(l.bookId) || 0, l.unitPriceCents * l.quantity]));

    log('stock and ledger');
    const stockRows = [];
    const moves = [];
    for (const s of SHOPS) {
      const sid = shopId[s.code];
      for (const t of titles) {
        const unitsSold = sold.get(`${sid}:${t.id}`) || 0;
        // A few fast sellers are running low in the HQ shop, so restocking has something to recommend.
        const runningLow = s.code === 'S01' && t.pop >= 0.75 && t.pop < 0.9;
        const onShelf = runningLow ? 3 : Math.max(2, Math.round(t.stock * s.traffic));
        stockRows.push([bid, sid, t.id, onShelf, cheapest.get(t.id) || 0, t.aisle, t.rack, t.shelf, iso(start)]);
        moves.push([bid, sid, t.id, onShelf + unitsSold, 'opening', null, null, 'Opening store inventory', userId.Pratham19106, iso(start)]);
      }
    }
    for (const { key, l } of lineRows) {
      const sale = saleByKey.get(key);
      moves.push([bid, sale.shop_id, l.bookId, -l.quantity, 'sale', 'sale', sale.id, sale.bill_no, sale.user_id, sale.created_at]);
    }
    await bulkInsert(q, 'shop_stock', ['business_id', 'shop_id', 'book_id', 'stock_qty', 'cost_cents', 'aisle', 'rack', 'shelf', 'created_at'], stockRows);
    await bulkInsert(q, 'stock_movements', ['business_id', 'shop_id', 'book_id', 'delta', 'reason', 'ref_type', 'ref_id', 'note', 'user_id', 'created_at'], moves);
    // The old seed locations do not prove physical placement; keep copies unassigned until confirmed.
    await q.query(`INSERT INTO shelves(business_id,shop_id,aisle,rack,shelf,capacity)
      SELECT DISTINCT business_id,shop_id,aisle,rack,shelf,50 FROM shop_stock
      WHERE business_id=$1 AND btrim(aisle)<>'' AND btrim(rack)<>'' AND btrim(shelf)<>''
      ON CONFLICT(shop_id,aisle,rack,shelf) DO NOTHING`,[bid]);
    await q.query(`INSERT INTO arrangement_tasks(business_id,shop_id,book_id,qty,source)
      SELECT business_id,shop_id,book_id,stock_qty,'migration' FROM shop_stock WHERE business_id=$1 AND stock_qty>0`,[bid]);

    log('expenses');
    const exp = [];
    for (const s of SHOPS) {
      for (let d = 59; d >= 0; d--) {
        const date = iso(now.getTime() - d * DAY).slice(0, 10);
        if (d % 30 === 0) exp.push([bid, shopId[s.code], date, 'Rent', 'Store premises lease', Math.round((5000000 * s.traffic) / 100) * 100, userId.Pratham19106]);
        if (d % 30 === 5) exp.push([bid, shopId[s.code], date, 'Utilities', 'Electricity bill', Math.round((420000 * s.traffic) / 100) * 100, userId.Pratham19106]);
        if (d % 30 === 1) exp.push([bid, shopId[s.code], date, 'Wages', 'Counter staff wages', 1500000, userId.Pratham19106]);
      }
    }
    await bulkInsert(q, 'expenses', ['business_id', 'shop_id', 'expense_date', 'category', 'description', 'amount_cents', 'user_id'], exp);

    return { bid, shopId, userId, titles, supplierIds: supplierRows.map((r) => r.id) };
  });

  // Live workflow objects go through the real services so they exercise the same rules as the app.
  log('purchase orders and phone orders');
  const owner = await db.one('SELECT * FROM users WHERE id = $1', [ids.userId.Pratham19106]);
  const ctx = (shopCode) => ({
    db, user: owner, businessId: ids.bid, shopIds: Object.values(ids.shopId), shopId: ids.shopId[shopCode], tz: 330,
  });
  const byTitle = (t) => ids.titles.find((x) => x.title === t).id;

  const po = await purchasing.createPo(ctx('S01'), {
    supplierId: ids.supplierIds[2],
    items: [{ bookId: byTitle('Clean Code'), quantity: 6 }, { bookId: byTitle('Designing Data-Intensive Applications'), quantity: 5 }],
  });
  await purchasing.receive(ctx('S01'), po.id, { items: po.items.map((i) => ({ poItemId: i.id, quantity: i.qtyOrdered })) });
  await purchasing.createPo(ctx('S02'), {
    supplierId: ids.supplierIds[0],
    items: [{ bookId: byTitle('Atomic Habits'), quantity: 15 }, { bookId: byTitle('Ikigai'), quantity: 10 }],
    notes: 'Weekly fast-seller replenishment',
  });
  const o1 = await orders.createOrder(ctx('S01'), {
    customerName: 'Priya Desai', customerPhone: '+91 98765 43210', deliveryType: 'delivery', deliveryAddress: '4B Lotus Apartments, Dadar, Mumbai',
    items: [{ bookId: byTitle('Atomic Habits'), quantity: 2 }, { bookId: byTitle('The Psychology of Money'), quantity: 1 }],
    advancePayment: { amountCents: 50000, method: 'upi' }, promisedDate: iso(now.getTime() + 2 * DAY).slice(0, 10),
  });
  await orders.setStatus(ctx('S01'), o1.id, { status: 'ready' });
  await orders.createOrder(ctx('S02'), {
    customerName: 'Rahul Mehta', customerPhone: '+91 98200 12345', deliveryType: 'pickup',
    items: [{ bookId: byTitle('Dune'), quantity: 1 }], notes: 'Collects after 6 PM',
  });

  return {
    logins: USERS.map(([u, , p, role, shops]) => `${role.padEnd(7)} ${u} / ${p}${shops.length ? `  (${shops.join(', ')})` : '  (all shops)'}`),
    bookCount: ids.titles.length,
    fromCatalog: ids.titles.filter((t) => t.aisle === 'H').length,
    supplierCount: SUPPLIERS.length,
    shops: SHOPS.map((s) => `${s.code} ${s.name}`),
  };
}

module.exports = { seedDemo, CATALOGUE, SUPPLIERS, isbn13 };
