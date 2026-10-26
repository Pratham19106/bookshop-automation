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

// Deterministic PRNG so the generated data is consistent and verifiable.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

// [title, author, publisher, edition, genre, price, aisle, rack, shelf, popularity(0-1), startStock]
const CATALOGUE = [
  // --- Fiction & Contemporary ---
  ['The Alchemist', 'Paulo Coelho', 'HarperOne', 'Paperback 2014', 'Fiction', 299, 'A', '1', '2', 0.9, 40],
  ['The Alchemist', 'Paulo Coelho', 'HarperCollins', 'Hardcover 2018', 'Fiction', 599, 'A', '1', '3', 0.2, 8],
  ['The White Tiger', 'Aravind Adiga', 'Atlantic Books', '1st', 'Fiction', 350, 'A', '1', '4', 0.45, 18],
  ['Midnight\'s Children', 'Salman Rushdie', 'Vintage Classics', '40th Anniversary', 'Fiction', 550, 'A', '2', '1', 0.35, 15],
  ['The God of Small Things', 'Arundhati Roy', 'IndiaInk', 'Paperback', 'Fiction', 399, 'A', '2', '2', 0.5, 22],
  ['The Kite Runner', 'Khaled Hosseini', 'Riverhead Books', '10th Anniversary', 'Fiction', 399, 'A', '2', '3', 0.65, 28],
  ['Life of Pi', 'Yann Martel', 'Mariner Books', 'Illustrated', 'Fiction', 350, 'A', '2', '4', 0.4, 20],
  ['The Shadow of the Wind', 'Carlos Ruiz Zafon', 'Penguin Books', 'Paperback', 'Fiction', 450, 'A', '3', '1', 0.45, 18],
  ['1984', 'George Orwell', 'Penguin', 'Paperback 2008', 'Fiction', 250, 'A', '3', '2', 0.6, 30],
  ['Animal Farm', 'George Orwell', 'Penguin', 'Paperback 2008', 'Fiction', 199, 'A', '3', '3', 0.6, 30],
  ['To Kill a Mockingbird', 'Harper Lee', 'Arrow', 'Paperback 2010', 'Fiction', 325, 'A', '3', '4', 0.45, 20],
  ['The Catcher in the Rye', 'J. D. Salinger', 'Little, Brown', 'Paperback', 'Fiction', 350, 'A', '4', '1', 0.5, 25],
  ['One Hundred Years of Solitude', 'Gabriel Garcia Marquez', 'Harper Perennial', '1st', 'Fiction', 499, 'A', '4', '2', 0.45, 20],

  // --- Classics & World Literature ---
  ['Pride and Prejudice', 'Jane Austen', 'Penguin Classics', '2nd', 'Classics', 275, 'A', '4', '3', 0.35, 18],
  ['The Great Gatsby', 'F. Scott Fitzgerald', 'Scribner', 'Paperback 2004', 'Classics', 250, 'A', '4', '4', 0.5, 24],
  ['Crime and Punishment', 'Fyodor Dostoevsky', 'Vintage', 'Pevear Translation', 'Classics', 450, 'B', '1', '1', 0.35, 16],
  ['The Picture of Dorian Gray', 'Oscar Wilde', 'Penguin Classics', 'Paperback', 'Classics', 225, 'B', '1', '2', 0.4, 18],
  ['War and Peace', 'Leo Tolstoy', 'Oxford World Classics', 'Paperback', 'Classics', 799, 'B', '1', '3', 0.2, 10],

  // --- Sci-Fi & Fantasy ---
  ['Dune', 'Frank Herbert', 'Ace Books', 'Deluxe Edition', 'Sci-Fi', 650, 'D', '1', '1', 0.8, 35],
  ['Fahrenheit 451', 'Ray Bradbury', 'Simon & Schuster', '60th Anniversary', 'Sci-Fi', 350, 'D', '1', '2', 0.5, 22],
  ['Brave New World', 'Aldous Huxley', 'Harper Perennial', 'Modern Classics', 'Sci-Fi', 325, 'D', '1', '3', 0.5, 22],
  ['Foundation', 'Isaac Asimov', 'Spectra', '1st', 'Sci-Fi', 399, 'D', '1', '4', 0.45, 18],
  ['Project Hail Mary', 'Andy Weir', 'Ballantine Books', '1st', 'Sci-Fi', 599, 'D', '2', '1', 0.75, 26],
  ['The Hitchhiker\'s Guide to the Galaxy', 'Douglas Adams', 'Del Rey', 'Paperback', 'Sci-Fi', 350, 'D', '2', '2', 0.55, 22],
  ['The Hobbit', 'J. R. R. Tolkien', 'Mariner Books', 'Paperback 2012', 'Fantasy', 450, 'D', '2', '3', 0.65, 30],
  ['The Fellowship of the Ring', 'J. R. R. Tolkien', 'Mariner Books', 'Paperback 2012', 'Fantasy', 550, 'D', '2', '4', 0.6, 25],

  // --- Self-Help & Psychology ---
  ['Atomic Habits', 'James Clear', 'Penguin', '1st', 'Self-Help', 499, 'B', '2', '1', 1.0, 45],
  ['Ikigai', 'Hector Garcia', 'Penguin', '1st', 'Self-Help', 350, 'B', '2', '2', 0.75, 28],
  ['Deep Work', 'Cal Newport', 'Piatkus', '1st', 'Self-Help', 450, 'B', '2', '3', 0.45, 20],
  ['The Psychology of Money', 'Morgan Housel', 'Jaico', '1st', 'Finance', 399, 'B', '2', '4', 0.85, 35],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Farrar, Straus and Giroux', '1st', 'Psychology', 499, 'B', '3', '1', 0.6, 24],
  ['Man\'s Search for Meaning', 'Viktor E. Frankl', 'Beacon Press', '1st', 'Psychology', 299, 'B', '3', '2', 0.65, 26],
  ['The Power of Habit', 'Charles Duhigg', 'Random House', 'Paperback', 'Self-Help', 425, 'B', '3', '3', 0.55, 22],
  ['Can\'t Hurt Me', 'David Goggins', 'Lioncrest', 'Clean Edition', 'Biography', 599, 'B', '3', '4', 0.7, 25],

  // --- Business, Finance & Leadership ---
  ['Rich Dad Poor Dad', 'Robert Kiyosaki', 'Plata', '20th Anniversary', 'Finance', 350, 'B', '4', '1', 0.75, 30],
  ['Zero to One', 'Peter Thiel', 'Virgin', '1st', 'Business', 499, 'B', '4', '2', 0.45, 18],
  ['The Intelligent Investor', 'Benjamin Graham', 'Harper Business', 'Revised 2006', 'Finance', 699, 'B', '4', '3', 0.65, 26],
  ['Shoe Dog', 'Phil Knight', 'Scribner', 'Paperback 2018', 'Business', 499, 'B', '4', '4', 0.6, 24],
  ['Principles: Life and Work', 'Ray Dalio', 'Simon & Schuster', '1st', 'Business', 899, 'C', '1', '1', 0.45, 16],
  ['The Lean Startup', 'Eric Ries', 'Crown Business', '1st', 'Business', 550, 'C', '1', '2', 0.5, 20],
  ['Good to Great', 'Jim Collins', 'Harper Business', '1st', 'Business', 650, 'C', '1', '3', 0.35, 14],

  // --- History, Philosophy & Science ---
  ['Sapiens', 'Yuval Noah Harari', 'Harvill Secker', '1st', 'History', 550, 'C', '2', '1', 0.7, 25],
  ['Homo Deus', 'Yuval Noah Harari', 'Harvill Secker', '1st', 'History', 575, 'C', '2', '2', 0.4, 15],
  ['Guns, Germs, and Steel', 'Jared Diamond', 'W. W. Norton', '20th Anniversary', 'History', 550, 'C', '2', '3', 0.4, 16],
  ['Discovery of India', 'Jawaharlal Nehru', 'Penguin', '1st', 'History', 450, 'C', '2', '4', 0.25, 12],
  ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Universities Press', '1st', 'Biography', 225, 'C', '3', '1', 0.65, 25],
  ['An Era of Darkness', 'Shashi Tharoor', 'Aleph Book Company', '1st', 'History', 499, 'C', '3', '2', 0.5, 20],
  ['India After Gandhi', 'Ramachandra Guha', 'HarperCollins', '10th Anniversary', 'History', 750, 'C', '3', '3', 0.35, 14],
  ['A Brief History of Time', 'Stephen Hawking', 'Bantam', '10th Anniversary', 'Science', 399, 'C', '3', '4', 0.55, 22],
  ['Cosmos', 'Carl Sagan', 'Ballantine Books', 'Paperback 2013', 'Science', 499, 'C', '4', '1', 0.45, 18],
  ['The Gene: An Intimate History', 'Siddhartha Mukherjee', 'Scribner', '1st', 'Science', 599, 'C', '4', '2', 0.35, 15],
  ['Meditations', 'Marcus Aurelius', 'Modern Library', 'Hays Translation', 'Philosophy', 350, 'C', '4', '3', 0.7, 28],
  ['Beyond Good and Evil', 'Friedrich Nietzsche', 'Vintage', 'Kaufmann Translation', 'Philosophy', 399, 'C', '4', '4', 0.3, 14],

  // --- Technology & Software ---
  ['Clean Code', 'Robert C. Martin', 'Prentice Hall', '1st', 'Technology', 3200, 'E', '1', '1', 0.35, 12],
  ['Introduction to Algorithms', 'Cormen et al.', 'MIT Press', '4th', 'Technology', 5800, 'E', '1', '2', 0.15, 6],
  ['Introduction to Algorithms', 'Cormen et al.', 'MIT Press', '3rd', 'Technology', 4500, 'E', '1', '3', 0.1, 4],
  ['Python Crash Course', 'Eric Matthes', 'No Starch Press', '3rd', 'Technology', 2900, 'E', '1', '4', 0.35, 14],
  ['Designing Data-Intensive Applications', 'Martin Kleppmann', 'O\'Reilly Media', '1st', 'Technology', 3400, 'E', '2', '1', 0.45, 16],
  ['The Pragmatic Programmer', 'David Thomas & Andrew Hunt', 'Addison-Wesley', '20th Anniversary', 'Technology', 3100, 'E', '2', '2', 0.35, 12],
  ['Design Patterns', 'Erich Gamma et al.', 'Addison-Wesley', '1st', 'Technology', 4200, 'E', '2', '3', 0.25, 8],
  ['Grokking Algorithms', 'Aditya Bhargava', 'Manning', '1st', 'Technology', 1850, 'E', '2', '4', 0.5, 18],

  // --- Mystery, Crime & Thrillers ---
  ['The Silent Patient', 'Alex Michaelides', 'Celadon Books', '1st', 'Mystery', 399, 'G', '1', '1', 0.8, 32],
  ['And Then There Were None', 'Agatha Christie', 'William Morrow', 'Paperback', 'Mystery', 299, 'G', '1', '2', 0.65, 25],
  ['The Hound of the Baskervilles', 'Arthur Conan Doyle', 'Penguin Classics', 'Paperback', 'Mystery', 225, 'G', '1', '3', 0.5, 20],
  ['The Da Vinci Code', 'Dan Brown', 'Anchor Books', 'Paperback', 'Mystery', 399, 'G', '1', '4', 0.6, 25],
  ['Gone Girl', 'Gillian Flynn', 'Crown Publishing', '1st', 'Mystery', 350, 'G', '2', '1', 0.5, 20],

  // --- Children, YA & Poetry ---
  ['Harry Potter and the Philosopher\'s Stone', 'J. K. Rowling', 'Bloomsbury', 'Paperback 2014', 'Children', 399, 'F', '1', '1', 0.9, 45],
  ['Harry Potter and the Chamber of Secrets', 'J. K. Rowling', 'Bloomsbury', 'Paperback 2014', 'Children', 399, 'F', '1', '2', 0.7, 30],
  ['Harry Potter and the Prisoner of Azkaban', 'J. K. Rowling', 'Bloomsbury', 'Paperback 2014', 'Children', 450, 'F', '1', '3', 0.75, 30],
  ['The Little Prince', 'Antoine de Saint-Exupery', 'Egmont', '1st', 'Children', 199, 'F', '2', '1', 0.4, 18],
  ['Percy Jackson: The Lightning Thief', 'Rick Riordan', 'Disney Hyperion', '1st', 'Children', 350, 'F', '2', '2', 0.6, 25],
  ['Gitanjali', 'Rabindranath Tagore', 'Fingerprint', '1st', 'Poetry', 150, 'G', '3', '1', 0.2, 12],
  ['The Prophet', 'Kahlil Gibran', 'Knopf', 'Deluxe Edition', 'Poetry', 299, 'G', '3', '2', 0.4, 18],
  ['Rumi: Selected Poems', 'Coleman Barks', 'Penguin Classics', 'Paperback', 'Poetry', 350, 'G', '3', '3', 0.35, 15]
];

const SUPPLIERS = [
  { name: 'Sharma Book Distributors Pvt Ltd', contactPerson: 'Anil Sharma', phone: '+91 98200 11111', email: 'anil@sharmabooks.example', categories: 'Fiction, Classics, Self-Help, Children', leadTimeDays: 4, discount: 0.62 },
  { name: 'National Publishing House & Wholesale', contactPerson: 'Meera Joshi', phone: '+91 98200 22222', email: 'orders@nph.example', categories: 'History, Biography, Classics, Poetry, Philosophy', leadTimeDays: 7, discount: 0.60 },
  { name: 'TechBooks India Distribution Network', contactPerson: 'Rohan Patil', phone: '+91 98200 33333', email: 'sales@techbooks.example', categories: 'Technology, Business, Finance, Science', leadTimeDays: 9, discount: 0.68 },
  { name: 'Metro Wholesale Books Corporation', contactPerson: 'Farah Khan', phone: '+91 98200 44444', email: 'farah@metrobooks.example', categories: 'All categories', leadTimeDays: 3, discount: 0.65 },
  { name: 'Heritage Imprints & Scholastic', contactPerson: 'Vikram Sengupta', phone: '+91 98200 55555', email: 'vikram@heritagebooks.example', categories: 'Classics, Philosophy, History, Poetry', leadTimeDays: 6, discount: 0.58 },
  { name: 'Apex Trade & Paperbacks Ltd', contactPerson: 'Sunita Menon', phone: '+91 98200 66666', email: 'orders@apextrade.example', categories: 'Fiction, Mystery, Sci-Fi, Fantasy', leadTimeDays: 5, discount: 0.64 },
  { name: 'Vanguard Scientific & Academic Importers', contactPerson: 'Dr. K. Raman', phone: '+91 98200 77777', email: 'raman@vanguardbooks.example', categories: 'Technology, Science, Computer Science', leadTimeDays: 8, discount: 0.70 },
  { name: 'SpeedyTrade Express Logistics', contactPerson: 'Deepak Varma', phone: '+91 98200 88888', email: 'express@speedytrade.example', categories: 'All categories', leadTimeDays: 2, discount: 0.55 }
];

const CUSTOMER_NAMES = [
  'Aarav Sharma', 'Priya Desai', 'Rahul Mehta', 'Ananya Iyer', 'Rohan Gupta',
  'Aditi Rao', 'Vikram Patel', 'Sneha Kulkarni', 'Arjun Nair', 'Kavita Joshi',
  'Devendra Singh', 'Pooja Verma', 'Manish Kapoor', 'Divya Sundaram', 'Siddharth Roy'
];

/**
 * Loads a rich, realistic, comprehensive bookshop dataset:
 * - 70+ books with valid ISBN-13 checksums and physical store coordinates
 * - 8 competing suppliers with quoted wholesale costs
 * - 60 days of sales history across cash/card/UPI
 * - Active & completed phone orders with stock reservations
 * - Goods receipts establishing true weighted-average COGS
 * - Operating expenses (rent, electricity, internet, salaries)
 * - Owner (Pratham19106) and Worker (worker) credentials
 */
function seedDemo(db, { now = new Date(), force = false } = {}) {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0 && !force) {
    throw new Error('Database already contains records. Pass --force to replace with fresh comprehensive data.');
  }

  const rand = rng(42);
  const iso = (t) => new Date(t).toISOString();

  // If force is requested, clean up all existing records cleanly
  if (force) {
    tx(db, () => {
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM sale_items').run();
      db.prepare('DELETE FROM sales').run();
      db.prepare('DELETE FROM order_payments').run();
      db.prepare('DELETE FROM phone_order_items').run();
      db.prepare('DELETE FROM phone_orders').run();
      db.prepare('DELETE FROM stock_movements').run();
      db.prepare('DELETE FROM supplier_books').run();
      db.prepare('DELETE FROM goods_receipt_items').run();
      db.prepare('DELETE FROM goods_receipts').run();
      db.prepare('DELETE FROM purchase_order_items').run();
      db.prepare('DELETE FROM purchase_orders').run();
      db.prepare('DELETE FROM expenses').run();
      db.prepare('DELETE FROM books').run();
      db.prepare('DELETE FROM suppliers').run();
      db.prepare('DELETE FROM users').run();
    });
  }

  let owner, worker, demoOwner, demoStaff;
  tx(db, () => {
    // 1. Create Owner & Staff Users
    owner = users.createUser(db, { username: 'Pratham19106', fullName: 'Pratham BookShop', password: 'Password123', role: 'owner' });
    worker = users.createUser(db, { username: 'worker', fullName: 'Store Worker', password: 'Worker123', role: 'staff' });
    // Also create demo logins for automated test compatibility
    demoOwner = users.createUser(db, { username: 'owner', fullName: 'Shop Owner', password: 'owner12345', role: 'owner' });
    demoStaff = users.createUser(db, { username: 'staff', fullName: 'Counter Staff', password: 'staff12345', role: 'staff' });

    // 2. Configure Store Settings
    db.prepare("UPDATE settings SET value = 'Pratham BookShop' WHERE key = 'shop_name'").run();
    db.prepare("UPDATE settings SET value = '12 College Road, Mumbai' WHERE key = 'shop_address'").run();

    const start = now.getTime() - 60 * DAY;
    const bookIds = [];
    const supplierIds = [];

    // 3. Insert Catalogue Books & Opening Stock
    CATALOGUE.forEach((c, i) => {
      const [title, author, publisher, edition, genre, price, aisle, rack, shelf, popularity, stock] = c;
      const validIsbn = isbn13(String(100000000 + i * 7919).slice(0, 9));
      const r = db.prepare(`INSERT INTO books(title, author, isbn, publisher, edition, genre, price_cents, aisle, rack, shelf, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(title, author, validIsbn, publisher, edition, genre, price * 100, aisle, rack, shelf, iso(start), iso(start));
      const id = Number(r.lastInsertRowid);
      bookIds.push(id);

      // Opening stock = what will be sold over 60 days plus final current stock on shelf
      const expectedSales = Math.round(popularity * 55);
      const openingStock = stock + expectedSales;
      applyStock(db, { bookId: id, stockDelta: openingStock, reason: 'opening', note: 'Opening store inventory', userId: owner.id });
      db.prepare('UPDATE stock_movements SET created_at = ? WHERE book_id = ?').run(iso(start), id);
    });

    // 4. Insert Suppliers
    SUPPLIERS.forEach((s) => {
      const created = suppliersSvc.create(db, s);
      supplierIds.push(created.id);
    });

    // 5. Supplier Quoted Prices Matrix
    CATALOGUE.forEach((c, i) => {
      const genre = c[4];
      const listPrice = c[5];
      SUPPLIERS.forEach((s, si) => {
        const covers = s.categories === 'All categories' || s.categories.includes(genre);
        if (!covers) return;
        const jitter = 1 + (rand() - 0.5) * 0.08;
        const quotedUnitCost = Math.round(listPrice * s.discount * jitter) * 100;
        db.prepare('INSERT OR REPLACE INTO supplier_books(supplier_id, book_id, unit_cost_cents) VALUES (?, ?, ?)')
          .run(supplierIds[si], bookIds[i], quotedUnitCost);
      });
    });

    // 6. Establish Real Cost via Initial Goods Receipts 58 Days Ago
    const cheapestQuotes = db.prepare(`SELECT book_id, supplier_id, MIN(unit_cost_cents) AS c FROM supplier_books GROUP BY book_id`).all();
    const bySupplier = new Map();
    for (const row of cheapestQuotes) {
      if (!bySupplier.has(row.supplier_id)) bySupplier.set(row.supplier_id, []);
      bySupplier.get(row.supplier_id).push(row);
    }

    for (const [sid, rows] of bySupplier) {
      const po = purchasing.createPo(db, owner, {
        supplierId: sid,
        items: rows.map((r) => ({ bookId: r.book_id, quantity: 2, unitCostCents: r.c }))
      });
      purchasing.receive(db, owner, po.id, {
        items: po.items.map((it) => ({ poItemId: it.id, quantity: it.qtyOrdered }))
      });
      db.prepare('UPDATE goods_receipts SET received_at = ? WHERE po_id = ?').run(iso(start + DAY), po.id);
      db.prepare('UPDATE purchase_orders SET created_at = ? WHERE id = ?').run(iso(start), po.id);
      db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'receipt' AND note = ?").run(iso(start + DAY), po.poNo);
    }

    // 7. Generate 60 Days of Realistic Counter Sales & Bills
    const taxBp = getSettings(db).taxBp;
    for (let d = 59; d >= 0; d--) {
      const day = now.getTime() - d * DAY;
      const isWeekend = [0, 6].includes(new Date(day).getUTCDay());
      // 6 to 14 sales transactions per day
      const dailyBills = Math.round((6 + rand() * 8) * (isWeekend ? 1.4 : 1.0));

      for (let k = 0; k < dailyBills; k++) {
        const lines = [];
        const itemsInBasket = 1 + Math.floor(rand() * 3);
        const pickedBooks = new Set();

        for (let j = 0; j < itemsInBasket; j++) {
          const idx = Math.floor(rand() * CATALOGUE.length);
          if (pickedBooks.has(idx) || rand() > CATALOGUE[idx][9] + 0.12) continue;
          pickedBooks.add(idx);

          const b = db.prepare('SELECT * FROM books WHERE id = ?').get(bookIds[idx]);
          const qty = 1 + (rand() < 0.25 ? 1 : 0);
          if (b.stock_qty - b.reserved_qty < qty) continue;
          lines.push({ bookId: b.id, quantity: qty, unitPriceCents: b.price_cents });
        }

        if (!lines.length) continue;

        const discountBp = rand() < 0.15 ? 500 : (rand() < 0.05 ? 1000 : 0);
        const saleTimestamp = day - Math.floor(rand() * 9 * 3600000) - 3600000;
        const customerName = rand() < 0.4 ? CUSTOMER_NAMES[Math.floor(rand() * CUSTOMER_NAMES.length)] : '';
        const paymentMethod = ['cash', 'upi', 'card'][Math.floor(rand() * 3)];
        const cashier = rand() < 0.6 ? worker.id : owner.id;

        const sale = recordSale(db, {
          lines,
          discountBp,
          taxBp,
          paymentMethod,
          customerName,
          userId: cashier
        });

        db.prepare('UPDATE sales SET created_at = ? WHERE id = ?').run(iso(saleTimestamp), sale.saleId);
        db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'sale' AND ref_id = ?").run(iso(saleTimestamp), sale.saleId);
      }

      // Operating Overheads
      if (d % 15 === 0) {
        db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(iso(day).slice(0, 10), 'Rent', 'Store premises lease', 2500000, owner.id);
      }
      if (d % 30 === 5) {
        db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(iso(day).slice(0, 10), 'Utilities', 'Electricity & AC power bill', 420000, owner.id);
      }
      if (d % 30 === 18) {
        db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(iso(day).slice(0, 10), 'Packaging', 'Paper book bags & receipt thermal rolls', 185000, owner.id);
      }
      if (d % 30 === 1) {
        db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)')
          .run(iso(day).slice(0, 10), 'Wages', 'Staff assistant monthly wage', 1500000, owner.id);
      }
    }

    // 8. Recent Purchasing Activity & Open In-Transit POs
    const recentPo = purchasing.createPo(db, owner, {
      supplierId: supplierIds[2],
      items: [
        { bookId: bookIds[54], quantity: 6 }, // Clean Code
        { bookId: bookIds[58], quantity: 5 }  // Designing Data-Intensive Apps
      ]
    });
    purchasing.receive(db, owner, recentPo.id, {
      items: recentPo.items.map((i) => ({ poItemId: i.id, quantity: i.qtyOrdered }))
    });
    const recentDate = iso(now.getTime() - 8 * DAY);
    db.prepare('UPDATE goods_receipts SET received_at = ? WHERE po_id = ?').run(recentDate, recentPo.id);
    db.prepare('UPDATE purchase_orders SET created_at = ? WHERE id = ?').run(recentDate, recentPo.id);
    db.prepare("UPDATE stock_movements SET created_at = ? WHERE reason = 'receipt' AND note = ?").run(recentDate, recentPo.poNo);

    // One open purchase order currently in transit
    purchasing.createPo(db, owner, {
      supplierId: supplierIds[0],
      items: [
        { bookId: bookIds[26], quantity: 15 }, // Atomic Habits
        { bookId: bookIds[27], quantity: 10 }  // Ikigai
      ],
      notes: 'Weekly fast-seller replenishment order'
    });

    // 9. Active & Completed Phone-in Orders (Stock Reservations)
    const o1 = orders.createOrder(db, owner, {
      customerName: 'Priya Desai',
      customerPhone: '+91 98765 43210',
      deliveryType: 'delivery',
      deliveryAddress: '4B, Lotus Apartments, Dadar, Mumbai',
      items: [
        { bookId: bookIds[26], quantity: 2 }, // Atomic Habits
        { bookId: bookIds[29], quantity: 1 }  // Psychology of Money
      ],
      advancePayment: { amountCents: 50000, method: 'upi' },
      promisedDate: iso(now.getTime() + 2 * DAY).slice(0, 10)
    });
    orders.setStatus(db, o1.id, { status: 'ready' });

    orders.createOrder(db, worker, {
      customerName: 'Rahul Mehta',
      customerPhone: '+91 98200 12345',
      deliveryType: 'pickup',
      items: [{ bookId: bookIds[0], quantity: 1 }],
      notes: 'Customer will collect after 6 PM today'
    });

    orders.createOrder(db, worker, {
      customerName: 'Siddharth Roy',
      customerPhone: '+91 98111 22334',
      deliveryType: 'pickup',
      items: [{ bookId: bookIds[18], quantity: 1 }], // Dune
      advancePayment: { amountCents: 65000, method: 'cash' },
      notes: 'Hold until Saturday morning'
    });
  });

  return {
    owner: 'Pratham19106 / Password123',
    worker: 'worker / Worker123',
    demoOwner: 'owner / owner12345',
    demoStaff: 'staff / staff12345',
    bookCount: CATALOGUE.length,
    supplierCount: SUPPLIERS.length
  };
}

module.exports = { seedDemo, CATALOGUE, SUPPLIERS };
