-- =============================================================================
-- Bookshop Automation System: Master Database Migration (One & Done)
-- Target Database: Supabase PostgreSQL
-- Features:
--   1. Clean setup of all schema tables, indexes, and extensions
--   2. Explicit PostgreSQL ENUMs for categorical statuses
--   3. Book categories/genres stored as TEXT for open-ended classification
--   4. Multi-business & multi-franchise architecture (NO constraint on minimum shops)
--   5. Only mock book catalogue data seeded (70+ books); NO dummy users or businesses
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. ENUMS (Status & Categorical Types)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'manager', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE franchise_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stock_reason AS ENUM (
    'sale',
    'sale_void',
    'receipt',
    'adjustment',
    'opening',
    'franchise_transfer_in',
    'franchise_transfer_out'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_type AS ENUM ('pickup', 'delivery');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('placed', 'ready', 'out_for_delivery', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('cash', 'card', 'upi', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM ('completed', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE po_status AS ENUM ('ordered', 'partially_received', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Drop legacy triggers/functions enforcing minimum active shops
DROP TRIGGER IF EXISTS trg_enforce_min_active_franchises ON franchises;
DROP FUNCTION IF EXISTS check_min_active_franchises();

-- =============================================================================
-- 2. BUSINESSES (Bookshop Chains / Organizations)
-- =============================================================================

CREATE TABLE IF NOT EXISTS businesses (
  id              TEXT PRIMARY KEY,                     -- e.g. 'biz_oxford', 'biz_crossword'
  name            TEXT NOT NULL,                        -- e.g. 'Oxford Bookstore Chain'
  slug            TEXT NOT NULL UNIQUE,                 -- e.g. 'oxford-books'
  owner_name      TEXT NOT NULL,                        -- e.g. 'Aarav Sharma'
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 3. FRANCHISES / SHOPS / OUTLETS
-- =============================================================================

CREATE TABLE IF NOT EXISTS franchises (
  id              TEXT PRIMARY KEY,                     -- e.g. 'fr_oxford_1', 'fr_oxford_2'
  business_id     TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,                        -- e.g. 'FR-001'
  name            TEXT NOT NULL,                        -- e.g. 'Park Street Flagship'
  city            TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  status          franchise_status NOT NULL DEFAULT 'active',
  is_headquarters BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_franchises_biz ON franchises(business_id);

-- =============================================================================
-- 4. USERS & SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id  TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'staff',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 5. BOOKS CATALOGUE (Open-ended TEXT genres/categories)
-- =============================================================================

CREATE TABLE IF NOT EXISTS books (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  author              TEXT NOT NULL,
  isbn                TEXT UNIQUE,
  publisher           TEXT NOT NULL DEFAULT '',
  edition             TEXT NOT NULL DEFAULT '',
  genre               TEXT NOT NULL DEFAULT 'General',     -- TEXT: unrestricted book classification
  price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents          INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty        INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  aisle               TEXT NOT NULL DEFAULT '',
  rack                TEXT NOT NULL DEFAULT '',
  shelf               TEXT NOT NULL DEFAULT '',
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (reserved_qty <= stock_qty)
);

-- Ensure genre column is TEXT if upgrading from an earlier table version
DO $$ BEGIN
  ALTER TABLE books ALTER COLUMN genre TYPE TEXT;
  ALTER TABLE books ALTER COLUMN genre SET DEFAULT 'General';
EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);
CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);

-- =============================================================================
-- 6. FRANCHISE INVENTORY & STOCK MOVEMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS franchise_inventory (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id        TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty        INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  aisle               TEXT NOT NULL DEFAULT '',
  rack                TEXT NOT NULL DEFAULT '',
  shelf               TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (franchise_id, book_id),
  CHECK (reserved_qty <= stock_qty)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  delta               INTEGER NOT NULL CHECK (delta <> 0),
  reason              stock_reason NOT NULL,
  ref_type            TEXT,
  ref_id              TEXT,
  user_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  note                TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 7. SALES & BILLING
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id     TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id    TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  bill_no         TEXT NOT NULL,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method  payment_method NOT NULL DEFAULT 'cash',
  gross_cents     INTEGER NOT NULL CHECK (gross_cents >= 0),
  discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents       INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  net_cents       INTEGER NOT NULL CHECK (net_cents >= 0),
  cogs_cents      INTEGER NOT NULL DEFAULT 0 CHECK (cogs_cents >= 0),
  status          sale_status NOT NULL DEFAULT 'completed',
  void_reason     TEXT,
  voided_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  voided_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (business_id, bill_no)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id           BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  book_id           BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents   INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents  INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

-- =============================================================================
-- 8. PHONE ORDERS & RESERVATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS phone_orders (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id       TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id      TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  order_no          TEXT NOT NULL,
  customer_name     TEXT NOT NULL,
  customer_phone    TEXT NOT NULL,
  delivery_type     delivery_type NOT NULL DEFAULT 'pickup',
  delivery_address  TEXT NOT NULL DEFAULT '',
  status            order_status NOT NULL DEFAULT 'placed',
  promised_date     DATE,
  notes             TEXT NOT NULL DEFAULT '',
  created_by        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (business_id, order_no)
);

CREATE TABLE IF NOT EXISTS phone_order_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  book_id     BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0)
);

CREATE TABLE IF NOT EXISTS order_payments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method      payment_method NOT NULL DEFAULT 'cash',
  note        TEXT NOT NULL DEFAULT '',
  created_by  BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 9. SUPPLIERS & PURCHASING
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id     TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_person  TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  categories      TEXT NOT NULL DEFAULT '',
  lead_time_days  INTEGER NOT NULL DEFAULT 7,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS supplier_books (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id         BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  quoted_price_cents  INTEGER NOT NULL CHECK (quoted_price_cents >= 0),
  lead_time_days      INTEGER,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (supplier_id, book_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id  TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  po_no         TEXT NOT NULL,
  supplier_id   BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status        po_status NOT NULL DEFAULT 'ordered',
  notes         TEXT NOT NULL DEFAULT '',
  created_by    BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (business_id, po_no)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id             BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  book_id           BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  qty_ordered       INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received      INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_cents   INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id         BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  received_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes         TEXT NOT NULL DEFAULT '',
  received_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id    BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id    BIGINT NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  qty_received  INTEGER NOT NULL CHECK (qty_received > 0)
);

-- =============================================================================
-- 10. EXPENSES & SETTINGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id  TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  expense_date  DATE NOT NULL,
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS settings (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id  TEXT,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  UNIQUE (business_id, franchise_id, key)
);

-- =============================================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchises ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Businesses
  CREATE POLICY "Public select businesses" ON businesses FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert businesses" ON businesses FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public update businesses" ON businesses FOR UPDATE TO anon, authenticated USING (true);

  -- Franchises
  CREATE POLICY "Public select franchises" ON franchises FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert franchises" ON franchises FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public update franchises" ON franchises FOR UPDATE TO anon, authenticated USING (true);

  -- Users & Sessions
  CREATE POLICY "Public select users" ON users FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert users" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public update users" ON users FOR UPDATE TO anon, authenticated USING (true);
  CREATE POLICY "Public select sessions" ON sessions FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert sessions" ON sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public delete sessions" ON sessions FOR DELETE TO anon, authenticated USING (true);

  -- Catalogue & Inventory
  CREATE POLICY "Public select books" ON books FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate books" ON books FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select inventory" ON franchise_inventory FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate inventory" ON franchise_inventory FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select movements" ON stock_movements FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert movements" ON stock_movements FOR INSERT TO anon, authenticated WITH CHECK (true);

  -- Sales & Orders
  CREATE POLICY "Public select sales" ON sales FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert sales" ON sales FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public select sale_items" ON sale_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert sale_items" ON sale_items FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public select orders" ON phone_orders FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate orders" ON phone_orders FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select order_items" ON phone_order_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate order_items" ON phone_order_items FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select payments" ON order_payments FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert payments" ON order_payments FOR INSERT TO anon, authenticated WITH CHECK (true);

  -- Suppliers, Purchasing, Expenses, Settings
  CREATE POLICY "Public select suppliers" ON suppliers FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate suppliers" ON suppliers FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select supplier_books" ON supplier_books FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate supplier_books" ON supplier_books FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select purchase_orders" ON purchase_orders FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate purchase_orders" ON purchase_orders FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select po_items" ON purchase_order_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate po_items" ON purchase_order_items FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select receipts" ON goods_receipts FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate receipts" ON goods_receipts FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select receipt_items" ON goods_receipt_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate receipt_items" ON goods_receipt_items FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select expenses" ON expenses FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate expenses" ON expenses FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "Public select settings" ON settings FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public mutate settings" ON settings FOR ALL TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 12. SEED ONLY MOCK BOOKS (UNIVERSAL MASTER CATALOGUE)
-- No dummy users, franchises, sales or businesses seeded.
-- =============================================================================

INSERT INTO books (
  business_id, title, author, isbn, publisher, edition, genre,
  price_cents, cost_cents, stock_qty, aisle, rack, shelf, active
) VALUES
(NULL, 'The Alchemist', 'Paulo Coelho', '9781000000009', 'HarperOne', 'Paperback 2014', 'Fiction', 29900, 17940, 40, 'A', '1', '2', true),
  (NULL, 'The Alchemist', 'Paulo Coelho', '9781000079197', 'HarperCollins', 'Hardcover 2018', 'Fiction', 59900, 35940, 8, 'A', '1', '3', true),
  (NULL, 'The White Tiger', 'Aravind Adiga', '9781000158380', 'Atlantic Books', '1st', 'Fiction', 35000, 21000, 18, 'A', '1', '4', true),
  (NULL, 'Midnight''s Children', 'Salman Rushdie', '9781000237573', 'Vintage Classics', '40th Anniversary', 'Fiction', 55000, 33000, 15, 'A', '2', '1', true),
  (NULL, 'The God of Small Things', 'Arundhati Roy', '9781000316766', 'IndiaInk', 'Paperback', 'Fiction', 39900, 23940, 22, 'A', '2', '2', true),
  (NULL, 'The Kite Runner', 'Khaled Hosseini', '9781000395952', 'Riverhead Books', '10th Anniversary', 'Fiction', 39900, 23940, 28, 'A', '2', '3', true),
  (NULL, 'Life of Pi', 'Yann Martel', '9781000475142', 'Mariner Books', 'Illustrated', 'Fiction', 35000, 21000, 20, 'A', '2', '4', true),
  (NULL, 'The Shadow of the Wind', 'Carlos Ruiz Zafon', '9781000554335', 'Penguin Books', 'Paperback', 'Fiction', 45000, 27000, 18, 'A', '3', '1', true),
  (NULL, '1984', 'George Orwell', '9781000633528', 'Penguin', 'Paperback 2008', 'Fiction', 25000, 15000, 30, 'A', '3', '2', true),
  (NULL, 'Animal Farm', 'George Orwell', '9781000712711', 'Penguin', 'Paperback 2008', 'Fiction', 19900, 11940, 30, 'A', '3', '3', true),
  (NULL, 'To Kill a Mockingbird', 'Harper Lee', '9781000791907', 'Arrow', 'Paperback 2010', 'Fiction', 32500, 19500, 20, 'A', '3', '4', true),
  (NULL, 'The Catcher in the Rye', 'J. D. Salinger', '9781000871098', 'Little, Brown', 'Paperback', 'Fiction', 35000, 21000, 25, 'A', '4', '1', true),
  (NULL, 'One Hundred Years of Solitude', 'Gabriel Garcia Marquez', '9781000950281', 'Harper Perennial', '1st', 'Fiction', 49900, 29940, 20, 'A', '4', '2', true),
  (NULL, 'Pride and Prejudice', 'Jane Austen', '9781001029474', 'Penguin Classics', '2nd', 'Classics', 27500, 16500, 18, 'A', '4', '3', true),
  (NULL, 'The Great Gatsby', 'F. Scott Fitzgerald', '9781001108667', 'Scribner', 'Paperback 2004', 'Classics', 25000, 15000, 24, 'A', '4', '4', true),
  (NULL, 'Crime and Punishment', 'Fyodor Dostoevsky', '9781001187853', 'Vintage', 'Pevear Translation', 'Classics', 45000, 27000, 16, 'B', '1', '1', true),
  (NULL, 'The Picture of Dorian Gray', 'Oscar Wilde', '9781001267043', 'Penguin Classics', 'Paperback', 'Classics', 22500, 13500, 18, 'B', '1', '2', true),
  (NULL, 'War and Peace', 'Leo Tolstoy', '9781001346236', 'Oxford World Classics', 'Paperback', 'Classics', 79900, 47940, 10, 'B', '1', '3', true),
  (NULL, 'Dune', 'Frank Herbert', '9781001425429', 'Ace Books', 'Deluxe Edition', 'Sci-Fi', 65000, 39000, 35, 'D', '1', '1', true),
  (NULL, 'Fahrenheit 451', 'Ray Bradbury', '9781001504612', 'Simon & Schuster', '60th Anniversary', 'Sci-Fi', 35000, 21000, 22, 'D', '1', '2', true),
  (NULL, 'Brave New World', 'Aldous Huxley', '9781001583808', 'Harper Perennial', 'Modern Classics', 'Sci-Fi', 32500, 19500, 22, 'D', '1', '3', true),
  (NULL, 'Foundation', 'Isaac Asimov', '9781001662992', 'Spectra', '1st', 'Sci-Fi', 39900, 23940, 18, 'D', '1', '4', true),
  (NULL, 'Project Hail Mary', 'Andy Weir', '9781001742182', 'Ballantine Books', '1st', 'Sci-Fi', 59900, 35940, 26, 'D', '2', '1', true),
  (NULL, 'The Hitchhiker''s Guide to the Galaxy', 'Douglas Adams', '9781001821375', 'Del Rey', 'Paperback', 'Sci-Fi', 35000, 21000, 22, 'D', '2', '2', true),
  (NULL, 'The Hobbit', 'J. R. R. Tolkien', '9781001900568', 'Mariner Books', 'Paperback 2012', 'Fantasy', 45000, 27000, 30, 'D', '2', '3', true),
  (NULL, 'The Fellowship of the Ring', 'J. R. R. Tolkien', '9781001979755', 'Mariner Books', 'Paperback 2012', 'Fantasy', 55000, 33000, 25, 'D', '2', '4', true),
  (NULL, 'Atomic Habits', 'James Clear', '9781002058947', 'Penguin', '1st', 'Self-Help', 49900, 29940, 45, 'B', '2', '1', true),
  (NULL, 'Ikigai', 'Hector Garcia', '9781002138137', 'Penguin', '1st', 'Self-Help', 35000, 21000, 28, 'B', '2', '2', true),
  (NULL, 'Deep Work', 'Cal Newport', '9781002217320', 'Piatkus', '1st', 'Self-Help', 45000, 27000, 20, 'B', '2', '3', true),
  (NULL, 'The Psychology of Money', 'Morgan Housel', '9781002296516', 'Jaico', '1st', 'Finance', 39900, 23940, 35, 'B', '2', '4', true),
  (NULL, 'Thinking, Fast and Slow', 'Daniel Kahneman', '9781002375709', 'Farrar, Straus and Giroux', '1st', 'Psychology', 49900, 29940, 24, 'B', '3', '1', true),
  (NULL, 'Man''s Search for Meaning', 'Viktor E. Frankl', '9781002454893', 'Beacon Press', '1st', 'Psychology', 29900, 17940, 26, 'B', '3', '2', true),
  (NULL, 'The Power of Habit', 'Charles Duhigg', '9781002534083', 'Random House', 'Paperback', 'Self-Help', 42500, 25500, 22, 'B', '3', '3', true),
  (NULL, 'Can''t Hurt Me', 'David Goggins', '9781002613276', 'Lioncrest', 'Clean Edition', 'Biography', 59900, 35940, 25, 'B', '3', '4', true),
  (NULL, 'Rich Dad Poor Dad', 'Robert Kiyosaki', '9781002692462', 'Plata', '20th Anniversary', 'Finance', 35000, 21000, 30, 'B', '4', '1', true),
  (NULL, 'Zero to One', 'Peter Thiel', '9781002771655', 'Virgin', '1st', 'Business', 49900, 29940, 18, 'B', '4', '2', true),
  (NULL, 'The Intelligent Investor', 'Benjamin Graham', '9781002850848', 'Harper Business', 'Revised 2006', 'Finance', 69900, 41940, 26, 'B', '4', '3', true),
  (NULL, 'Shoe Dog', 'Phil Knight', '9781002930038', 'Scribner', 'Paperback 2018', 'Business', 49900, 29940, 24, 'B', '4', '4', true),
  (NULL, 'Principles: Life and Work', 'Ray Dalio', '9781003009221', 'Simon & Schuster', '1st', 'Business', 89900, 53940, 16, 'C', '1', '1', true),
  (NULL, 'The Lean Startup', 'Eric Ries', '9781003088417', 'Crown Business', '1st', 'Business', 55000, 33000, 20, 'C', '1', '2', true),
  (NULL, 'Good to Great', 'Jim Collins', '9781003167600', 'Harper Business', '1st', 'Business', 65000, 39000, 14, 'C', '1', '3', true),
  (NULL, 'Sapiens', 'Yuval Noah Harari', '9781003246794', 'Harvill Secker', '1st', 'History', 55000, 33000, 25, 'C', '2', '1', true),
  (NULL, 'Homo Deus', 'Yuval Noah Harari', '9781003325987', 'Harvill Secker', '1st', 'History', 57500, 34500, 15, 'C', '2', '2', true),
  (NULL, 'Guns, Germs, and Steel', 'Jared Diamond', '9781003405177', 'W. W. Norton', '20th Anniversary', 'History', 55000, 33000, 16, 'C', '2', '3', true),
  (NULL, 'Discovery of India', 'Jawaharlal Nehru', '9781003484363', 'Penguin', '1st', 'History', 45000, 27000, 12, 'C', '2', '4', true),
  (NULL, 'Wings of Fire', 'A. P. J. Abdul Kalam', '9781003563556', 'Universities Press', '1st', 'Biography', 22500, 13500, 25, 'C', '3', '1', true),
  (NULL, 'An Era of Darkness', 'Shashi Tharoor', '9781003642749', 'Aleph Book Company', '1st', 'History', 49900, 29940, 20, 'C', '3', '2', true),
  (NULL, 'India After Gandhi', 'Ramachandra Guha', '9781003721932', 'HarperCollins', '10th Anniversary', 'History', 75000, 45000, 14, 'C', '3', '3', true),
  (NULL, 'A Brief History of Time', 'Stephen Hawking', '9781003801122', 'Bantam', '10th Anniversary', 'Science', 39900, 23940, 22, 'C', '3', '4', true),
  (NULL, 'Cosmos', 'Carl Sagan', '9781003880318', 'Ballantine Books', 'Paperback 2013', 'Science', 49900, 29940, 18, 'C', '4', '1', true),
  (NULL, 'The Gene: An Intimate History', 'Siddhartha Mukherjee', '9781003959502', 'Scribner', '1st', 'Science', 59900, 35940, 15, 'C', '4', '2', true),
  (NULL, 'Meditations', 'Marcus Aurelius', '9781004038695', 'Modern Library', 'Hays Translation', 'Philosophy', 35000, 21000, 28, 'C', '4', '3', true),
  (NULL, 'Beyond Good and Evil', 'Friedrich Nietzsche', '9781004117888', 'Vintage', 'Kaufmann Translation', 'Philosophy', 39900, 23940, 14, 'C', '4', '4', true),
  (NULL, 'Clean Code', 'Robert C. Martin', '9781004197071', 'Prentice Hall', '1st', 'Technology', 320000, 192000, 12, 'E', '1', '1', true),
  (NULL, 'Introduction to Algorithms', 'Cormen et al.', '9781004276264', 'MIT Press', '4th', 'Technology', 580000, 348000, 6, 'E', '1', '2', true),
  (NULL, 'Introduction to Algorithms', 'Cormen et al.', '9781004355457', 'MIT Press', '3rd', 'Technology', 450000, 270000, 4, 'E', '1', '3', true),
  (NULL, 'Python Crash Course', 'Eric Matthes', '9781004434640', 'No Starch Press', '3rd', 'Technology', 290000, 174000, 14, 'E', '1', '4', true),
  (NULL, 'Designing Data-Intensive Applications', 'Martin Kleppmann', '9781004513833', 'O''Reilly Media', '1st', 'Technology', 340000, 204000, 16, 'E', '2', '1', true),
  (NULL, 'The Pragmatic Programmer', 'David Thomas & Andrew Hunt', '9781004593026', 'Addison-Wesley', '20th Anniversary', 'Technology', 310000, 186000, 12, 'E', '2', '2', true),
  (NULL, 'Design Patterns', 'Erich Gamma et al.', '9781004672219', 'Addison-Wesley', '1st', 'Technology', 420000, 252000, 8, 'E', '2', '3', true),
  (NULL, 'Grokking Algorithms', 'Aditya Bhargava', '9781004751402', 'Manning', '1st', 'Technology', 185000, 111000, 18, 'E', '2', '4', true),
  (NULL, 'The Silent Patient', 'Alex Michaelides', '9781004830596', 'Celadon Books', '1st', 'Mystery', 39900, 23940, 32, 'G', '1', '1', true),
  (NULL, 'And Then There Were None', 'Agatha Christie', '9781004909780', 'William Morrow', 'Paperback', 'Mystery', 29900, 17940, 25, 'G', '1', '2', true),
  (NULL, 'The Hound of the Baskervilles', 'Arthur Conan Doyle', '9781004988976', 'Penguin Classics', 'Paperback', 'Mystery', 22500, 13500, 20, 'G', '1', '3', true),
  (NULL, 'The Da Vinci Code', 'Dan Brown', '9781005068165', 'Anchor Books', 'Paperback', 'Mystery', 39900, 23940, 25, 'G', '1', '4', true),
  (NULL, 'Gone Girl', 'Gillian Flynn', '9781005147358', 'Crown Publishing', '1st', 'Mystery', 35000, 21000, 20, 'G', '2', '1', true),
  (NULL, 'Harry Potter and the Philosopher''s Stone', 'J. K. Rowling', '9781005226541', 'Bloomsbury', 'Paperback 2014', 'Children', 39900, 23940, 45, 'F', '1', '1', true),
  (NULL, 'Harry Potter and the Chamber of Secrets', 'J. K. Rowling', '9781005305734', 'Bloomsbury', 'Paperback 2014', 'Children', 39900, 23940, 30, 'F', '1', '2', true),
  (NULL, 'Harry Potter and the Prisoner of Azkaban', 'J. K. Rowling', '9781005384920', 'Bloomsbury', 'Paperback 2014', 'Children', 45000, 27000, 30, 'F', '1', '3', true),
  (NULL, 'The Little Prince', 'Antoine de Saint-Exupery', '9781005464110', 'Egmont', '1st', 'Children', 19900, 11940, 18, 'F', '2', '1', true),
  (NULL, 'Percy Jackson: The Lightning Thief', 'Rick Riordan', '9781005543303', 'Disney Hyperion', '1st', 'Children', 35000, 21000, 25, 'F', '2', '2', true),
  (NULL, 'Gitanjali', 'Rabindranath Tagore', '9781005622497', 'Fingerprint', '1st', 'Poetry', 15000, 9000, 12, 'G', '3', '1', true),
  (NULL, 'The Prophet', 'Kahlil Gibran', '9781005701680', 'Knopf', 'Deluxe Edition', 'Poetry', 29900, 17940, 18, 'G', '3', '2', true),
  (NULL, 'Rumi: Selected Poems', 'Coleman Barks', '9781005780876', 'Penguin Classics', 'Paperback', 'Poetry', 35000, 21000, 15, 'G', '3', '3', true);
ON CONFLICT (isbn) DO UPDATE SET
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  publisher = EXCLUDED.publisher,
  edition = EXCLUDED.edition,
  genre = EXCLUDED.genre,
  price_cents = EXCLUDED.price_cents,
  cost_cents = EXCLUDED.cost_cents,
  stock_qty = EXCLUDED.stock_qty,
  aisle = EXCLUDED.aisle,
  rack = EXCLUDED.rack,
  shelf = EXCLUDED.shelf;
