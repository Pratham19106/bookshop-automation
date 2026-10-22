const { tx } = require('./index');
const users = require('../services/users');
const purchasing = require('../services/purchasing');
const orders = require('../services/orders');
const suppliersSvc = require('../services/suppliers');
const { recordSale } = require('../services/sales');
const { getSettings } = require('../services/settings');
const { applyStock } = require('../services/inventory');

const DAY = 86400000;

function isbn13(body9) {
  const d = '978' + body9;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return d + ((10 - (sum % 10)) % 10);
}

// Small deterministic PRNG so the demo data is the same on every machine.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

// [title, author, publisher, edition, genre, price, aisle, rack, shelf, popularity(0-1), startStock]
const CATALOGUE = [
  ['The Alchemist', 'Paulo Coelho', 'HarperOne', 'Paperback 2014', 'Fiction', 299, 'A', '1', '2', 0.9, 40],
  ['The Alchemist', 'Paulo Coelho', 'HarperCollins', 'Hardcover 2018', 'Fiction', 599, 'A', '1', '3', 0.2, 8],
  ['Atomic Habits', 'James Clear', 'Penguin', '1st', 'Self-Help', 499, 'B', '2', '1', 1.0, 45],
  ['Rich Dad Poor Dad', 'Robert Kiyosaki', 'Plata', '20th Anniversary', 'Finance', 350, 'B', '2', '2', 0.7, 30],
  ['The Psychology of Money', 'Morgan Housel', 'Jaico', '1st', 'Finance', 399, 'B', '2', '3', 0.8, 35],
  ['Sapiens', 'Yuval Noah Harari', 'Harvill Secker', '1st', 'History', 550, 'C', '1', '1', 0.6, 25],
  ['Homo Deus', 'Yuval Noah Harari', 'Harvill Secker', '1st', 'History', 575, 'C', '1', '2', 0.3, 15],
  ['1984', 'George Orwell', 'Penguin', 'Paperback 2008', 'Fiction', 250, 'A', '2', '1', 0.5, 30],
  ['Animal Farm', 'George Orwell', 'Penguin', 'Paperback 2008', 'Fiction', 199, 'A', '2', '2', 0.5, 30],
  ['To Kill a Mockingbird', 'Harper Lee', 'Arrow', 'Paperback 2010', 'Fiction', 325, 'A', '3', '1', 0.4, 20],
  ['Pride and Prejudice', 'Jane Austen', 'Penguin Classics', '2nd', 'Classics', 275, 'A', '3', '2', 0.3, 18],
  ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Universities Press', '1st', 'Biography', 225, 'D', '1', '1', 0.6, 25],
  ['Ikigai', 'Hector Garcia', 'Penguin', '1st', 'Self-Help', 350, 'B', '1', '3', 0.7, 28],
  ['Deep Work', 'Cal Newport', 'Piatkus', '1st', 'Self-Help', 450, 'B', '1', '2', 0.4, 20],
  ['Clean Code', 'Robert C. Martin', 'Prentice Hall', '1st', 'Technology', 3200, 'E', '1', '1', 0.2, 10],
  ['Introduction to Algorithms', 'Cormen et al.', 'MIT Press', '4th', 'Technology', 5800, 'E', '1', '2', 0.1, 6],
  ['Introduction to Algorithms', 'Cormen et al.', 'MIT Press', '3rd', 'Technology', 4500, 'E', '1', '3', 0.05, 4],
  ['Python Crash Course', 'Eric Matthes', 'No Starch Press', '3rd', 'Technology', 2900, 'E', '2', '1', 0.25, 12],
  ['Harry Potter and the Philosopher\'s Stone', 'J. K. Rowling', 'Bloomsbury', 'Paperback 2014', 'Children', 399, 'F', '1', '1', 0.85, 40],
  ['Harry Potter and the Chamber of Secrets', 'J. K. Rowling', 'Bloomsbury', 'Paperback 2014', 'Children', 399, 'F', '1', '2', 0.6, 30],
  ['The Little Prince', 'Antoine de Saint-Exupery', 'Egmont', '1st', 'Children', 199, 'F', '2', '1', 0.3, 15],
  ['Gitanjali', 'Rabindranath Tagore', 'Fingerprint', '1st', 'Poetry', 150, 'G', '1', '1', 0.1, 10],
  ['Discovery of India', 'Jawaharlal Nehru', 'Penguin', '1st', 'History', 450, 'C', '2', '1', 0.15, 10],
  ['The White Tiger', 'Aravind Adiga', 'Atlantic', '1st', 'Fiction', 350, 'A', '4', '1', 0.25, 14],
  ['Zero to One', 'Peter Thiel', 'Virgin', '1st', 'Business', 499, 'B', '3', '1', 0.35, 18],
];

const SUPPLIERS = [
  { name: 'Sharma Book Distributors', contactPerson: 'Anil Sharma', phone: '+91 98200 11111', email: 'anil@sharmabooks.example', categories: 'Fiction, Self-Help, Children', leadTimeDays: 5, discount: 0.62 },
  { name: 'National Publishing House', contactPerson: 'Meera Joshi', phone: '+91 98200 22222', email: 'orders@nph.example', categories: 'History, Biography, Classics, Poetry', leadTimeDays: 8, discount: 0.60 },
  { name: 'TechBooks India', contactPerson: 'Rohan Patil', phone: '+91 98200 33333', email: 'sales@techbooks.example', categories: 'Technology, Business, Finance', leadTimeDays: 10, discount: 0.70 },
  { name: 'Metro Wholesale Books', contactPerson: 'Farah Khan', phone: '+91 98200 44444', email: 'farah@metrobooks.example', categories: 'All categories', leadTimeDays: 3, discount: 0.66 },
];

/**
 * Loads a demo shop with ~60 days of backdated sales, receipts and expenses so every screen has real records.
 * Everything goes through the same services/primitives as live operation, then timestamps are shifted into the past.
 */
function seedDemo(db, { now = new Date() } = {}) {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) throw new Error('Database already contains users; refusing to seed demo data into a live database.');
  const rand = rng(42);
  const iso = (t) => new Date(t).toISOString();
  const owner = users.createUser(db, { username: 'owner', fullName: 'Shop Owner', password: 'owner12345', role: 'owner' });
  users.createUser(db, { username: 'staff', fullName: 'Counter Staff', password: 'staff12345', role: 'staff' });
  db.prepare("UPDATE settings SET value = 'Page & Pixel Books' WHERE key = 'shop_name'").run();
  db.prepare("UPDATE settings SET value = '12 College Road, Mumbai' WHERE key = 'shop_address'").run();

  const start = now.getTime() - 60 * DAY;
  const bookIds = [];
  const supplierIds = [];

  tx(db, () => {
    CATALOGUE.forEach((c, i) => {
      const [title, author, publisher, edition, genre, price, aisle, rack, shelf, , stock] = c;
      const r = db.prepare(`INSERT INTO books(title, author, isbn, publisher, edition, genre, price_cents, aisle, rack, shelf, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(title, author, isbn13(String(100000000 + i * 7919).slice(0, 9)), publisher, edition, genre, price * 100, aisle, rack, shelf, iso(start), iso(start));
      const id = Number(r.lastInsertRowid);
      bookIds.push(id);
      // Opening stock = what we will sell over the period plus what remains.
      applyStock(db, { bookId: id, stockDelta: stock + Math.round(c[9] * 60), reason: 'opening', note: 'Opening stock', userId: owner.id });
      db.prepare('UPDATE stock_movements SET created_at = ? WHERE book_id = ?').run(iso(start), id);
    });

    SUPPLIERS.forEach((s) => {
      const created = suppliersSvc.create(db, s);
      supplierIds.push(created.id);
    });
    // Supplier price lists: each supplier quotes a share of list price; several suppliers overlap per book.
    CATALOGUE.forEach((c, i) => {
      const genre = c[4];
      SUPPLIERS.forEach((s, si) => {
        const covers = s.categories === 'All categories' || s.categories.includes(genre);
        if (!covers) return;
        const jitter = 1 + (rand() - 0.5) * 0.06;
        const cost = Math.round(c[5] * s.discount * jitter) * 100;
        db.prepare('INSERT OR REPLACE INTO supplier_books(supplier_id, book_id, unit_cost_cents) VALUES (?, ?, ?)').run(supplierIds[si], bookIds[i], cost);
      });
    });

    // Initial goods receipts to establish cost: one PO per supplier for its cheapest books, dated 58 days ago.
    const cheapest = db.prepare(`SELECT book_id, supplier_id, MIN(unit_cost_cents) AS c FROM supplier_books GROUP BY book_id`).all();
    const bySupplier = new Map();
    for (const row of cheapest) {
      if (!bySupplier.has(row.supplier_id)) bySupplier.set(row.supplier_id, []);
      bySupplier.get(row.supplier_id).push(row);
    }
    for (const [sid, rows] of bySupplier) {
      const po = purchasing.createPo(db, owner, { supplierId: sid, items: rows.map((r) => ({ bookId: r.book_id, quantity: 1, unitCostCents: r.c })) });
      purchasing.receive(db, owner, po.id, { items: po.items.map((i) => ({ poItemId: i.id, quantity: i.qtyOrdered })) });
      db.prepare('UPDATE goods_receipts SET received_at = ? WHERE po_id = ?').run(iso(start + DAY), po.id);
      db.prepare('UPDATE purchase_orders SET created_at = ? WHERE id = ?').run(iso(start), po.id);
      db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'receipt' AND note = ?").run(iso(start + DAY), po.poNo);
    }

    // 60 days of sales. Weekends are busier. Each book's popularity drives its daily probability.
    const taxBp = getSettings(db).taxBp;
    for (let d = 59; d >= 0; d--) {
      const day = now.getTime() - d * DAY;
      const weekend = [0, 6].includes(new Date(day).getUTCDay());
      const bills = Math.round((5 + rand() * 6) * (weekend ? 1.5 : 1));
      for (let k = 0; k < bills; k++) {
        const lines = [];
        const n = 1 + Math.floor(rand() * 3);
        const picked = new Set();
        for (let j = 0; j < n; j++) {
          const idx = Math.floor(rand() * CATALOGUE.length);
          if (picked.has(idx) || rand() > CATALOGUE[idx][9] + 0.15) continue;
          picked.add(idx);
          const b = db.prepare('SELECT * FROM books WHERE id = ?').get(bookIds[idx]);
          const qty = 1 + (rand() < 0.2 ? 1 : 0);
          if (b.stock_qty - b.reserved_qty < qty) continue;
          lines.push({ bookId: b.id, quantity: qty, unitPriceCents: b.price_cents });
        }
        if (!lines.length) continue;
        const discountBp = rand() < 0.1 ? 500 : 0;
        const t = day - Math.floor(rand() * 9 * 3600000) - 3600000;
        const sale = recordSale(db, { lines, discountBp, taxBp, paymentMethod: ['cash', 'upi', 'card'][Math.floor(rand() * 3)], userId: owner.id });
        db.prepare('UPDATE sales SET created_at = ? WHERE id = ?').run(iso(t), sale.saleId);
        db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'sale' AND ref_id = ?").run(iso(t), sale.saleId);
      }
      if (d % 15 === 0) {
        const date = iso(day).slice(0, 10);
        db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)').run(date, 'Rent', 'Shop rent', 2500000, owner.id);
      }
      if (d % 30 === 7) db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)').run(iso(day).slice(0, 10), 'Utilities', 'Electricity', 420000, owner.id);
      if (d % 30 === 3) db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)').run(iso(day).slice(0, 10), 'Wages', 'Part-time helper', 1200000, owner.id);
    }

    // Recent purchase activity: a received PO 10 days ago and an open PO still on order.
    const recent = purchasing.createPo(db, owner, { supplierId: supplierIds[2], items: [{ bookId: bookIds[14], quantity: 5 }, { bookId: bookIds[17], quantity: 4 }] });
    purchasing.receive(db, owner, recent.id, { items: recent.items.map((i) => ({ poItemId: i.id, quantity: i.qtyOrdered })) });
    const when = iso(now.getTime() - 10 * DAY);
    db.prepare('UPDATE goods_receipts SET received_at = ? WHERE po_id = ?').run(when, recent.id);
    db.prepare('UPDATE purchase_orders SET created_at = ? WHERE id = ?').run(when, recent.id);
    db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'receipt' AND note = ?").run(when, recent.poNo);
    purchasing.createPo(db, owner, { supplierId: supplierIds[3], items: [{ bookId: bookIds[1], quantity: 10 }], notes: 'Hardcovers running low' });

    // Sample phone orders in different states.
    const o1 = orders.createOrder(db, owner, { customerName: 'Priya Desai', customerPhone: '+91 98765 43210', deliveryType: 'delivery',
      deliveryAddress: '4B, Lotus Apartments, Dadar', items: [{ bookId: bookIds[2], quantity: 2 }, { bookId: bookIds[4], quantity: 1 }],
      advancePayment: { amountCents: 50000, method: 'upi' }, promisedDate: iso(now.getTime() + 2 * DAY).slice(0, 10) });
    orders.setStatus(db, o1.id, { status: 'ready' });
    orders.createOrder(db, owner, { customerName: 'Rahul Mehta', customerPhone: '9820012345', deliveryType: 'pickup',
      items: [{ bookId: bookIds[0], quantity: 1 }], notes: 'Will collect after 6pm' });
  });
  return { owner: 'owner / owner12345', staff: 'staff / staff12345' };
}

module.exports = { seedDemo };
