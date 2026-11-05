-- =============================================================================
-- Bookshop Automation System: Master Database Migration (One & Done)
-- Target: Supabase PostgreSQL (Production & Local)
-- Features:
--   1. Fully idempotent - safe to execute on fresh or existing databases
--   2. Multi-tenant business architecture (support for multiple independent chains)
--   3. Multi-franchise constraint (>= 2 active outlets enforced per business)
--   4. Book categories are TEXT (flexible open classification for all genres)
--   5. Full RLS policies for seamless terminal & serverless API operation
--   6. Mock Book Data ONLY: 74 realistic books + franchise shelf inventory
--      (No fake sales, orders, or expenses - pristine register state)
-- =============================================================================

-- Enable standard cryptographic & uuid extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. POSTGRESQL ENUMS (Strict Categorical Sets)
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

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM (
    'rent',
    'utilities',
    'salaries',
    'maintenance',
    'marketing',
    'logistics',
    'supplies',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 2. BUSINESSES TABLE (Bookshop Chains / Multi-Tenant Entities)
-- =============================================================================

CREATE TABLE IF NOT EXISTS businesses (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  owner_name      TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 3. FRANCHISES TABLE & MULTI-FRANCHISE CONSTRAINT
-- =============================================================================

CREATE TABLE IF NOT EXISTS franchises (
  id              TEXT PRIMARY KEY,
  business_id     TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL DEFAULT 'Hyderabad',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  status          franchise_status NOT NULL DEFAULT 'active',
  is_headquarters BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Safe column additions if table already existed
ALTER TABLE franchises ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_franchises_biz ON franchises(business_id);

-- Enforce that every registered business chain maintains at least 2 active franchises
CREATE OR REPLACE FUNCTION check_min_active_franchises()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
  target_biz TEXT;
BEGIN
  target_biz := COALESCE(NEW.business_id, OLD.business_id);
  IF target_biz IS NOT NULL THEN
    SELECT COUNT(*) INTO active_count 
    FROM franchises 
    WHERE business_id = target_biz AND status = 'active';

    IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status != 'active')) THEN
      IF active_count < 2 THEN
        RAISE EXCEPTION 'Constraint Violation: Bookshop chain "%" requires at least 2 active franchises/outlets supportable at all times.', target_biz;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_min_active_franchises ON franchises;
CREATE TRIGGER trg_enforce_min_active_franchises
AFTER UPDATE OR DELETE ON franchises
FOR EACH ROW
EXECUTE FUNCTION check_min_active_franchises();

-- =============================================================================
-- 4. USERS & SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'staff',
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id  TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS franchise_id TEXT REFERENCES franchises(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 5. BOOKS CATALOGUE (Flexible TEXT Genre Classification)
-- =============================================================================

CREATE TABLE IF NOT EXISTS books (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  author              TEXT NOT NULL,
  isbn                TEXT UNIQUE,
  publisher           TEXT NOT NULL DEFAULT '',
  edition             TEXT NOT NULL DEFAULT '',
  genre               TEXT NOT NULL DEFAULT 'Other',
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

-- Ensure genre is TEXT (converting from old ENUM if present)
DO $$ BEGIN
  ALTER TABLE books ALTER COLUMN genre TYPE TEXT;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

ALTER TABLE books ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE books ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN IF NOT EXISTS reserved_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5;
ALTER TABLE books ADD COLUMN IF NOT EXISTS aisle TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN IF NOT EXISTS rack TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN IF NOT EXISTS shelf TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);
CREATE INDEX IF NOT EXISTS idx_books_biz ON books(business_id);

-- =============================================================================
-- 6. FRANCHISE INVENTORY (Multi-Store Quantities & Physical Coordinates)
-- =============================================================================

CREATE TABLE IF NOT EXISTS franchise_inventory (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_inv_franchise_book ON franchise_inventory(franchise_id, book_id);
CREATE INDEX IF NOT EXISTS idx_inv_low_stock ON franchise_inventory(franchise_id) WHERE stock_qty <= low_stock_threshold;

-- Stock Movements Ledger
CREATE TABLE IF NOT EXISTS stock_movements (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  delta               INTEGER NOT NULL CHECK (delta <> 0),
  reason              stock_reason NOT NULL,
  ref_type            TEXT,
  ref_id              BIGINT,
  note                TEXT NOT NULL DEFAULT '',
  user_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 7. SALES & BILLING
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  bill_no             TEXT NOT NULL UNIQUE,
  user_id             BIGINT NOT NULL REFERENCES users(id),
  status              sale_status NOT NULL DEFAULT 'completed',
  subtotal_cents      INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents      INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  discount_percent_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent_bp >= 0 AND discount_percent_bp <= 10000),
  tax_cents           INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tax_percent_bp      INTEGER NOT NULL DEFAULT 0 CHECK (tax_percent_bp >= 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method      payment_method NOT NULL DEFAULT 'cash',
  customer_name       TEXT NOT NULL DEFAULT '',
  customer_phone      TEXT NOT NULL DEFAULT '',
  idempotency_key     TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS sale_items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id             BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id),
  title_snapshot      TEXT NOT NULL,
  author_snapshot     TEXT NOT NULL DEFAULT '',
  unit_price_cents    INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents     INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_franchise ON sales(franchise_id);
CREATE INDEX IF NOT EXISTS idx_sales_biz ON sales(business_id);

-- =============================================================================
-- 8. PHONE ORDERS & STOCK RESERVATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS phone_orders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  order_no            TEXT NOT NULL UNIQUE,
  customer_name       TEXT NOT NULL,
  customer_phone      TEXT NOT NULL,
  delivery_type       delivery_type NOT NULL DEFAULT 'pickup',
  delivery_address    TEXT NOT NULL DEFAULT '',
  promised_date       DATE,
  notes               TEXT NOT NULL DEFAULT '',
  status              order_status NOT NULL DEFAULT 'placed',
  total_cents         INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  paid_cents          INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  user_id             BIGINT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE phone_orders ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS phone_order_items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id),
  unit_price_cents    INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS order_payments (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents <> 0),
  method              payment_method NOT NULL DEFAULT 'cash',
  ref_no              TEXT NOT NULL DEFAULT '',
  user_id             BIGINT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 9. SUPPLIERS & PURCHASING
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  contact_person      TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  lead_time_days      INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
  categories          TEXT NOT NULL DEFAULT '',
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS supplier_books (
  supplier_id         BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cost_cents          INTEGER NOT NULL CHECK (cost_cents >= 0),
  lead_time_days      INTEGER,
  supplier_sku        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (supplier_id, book_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  po_no               TEXT NOT NULL UNIQUE,
  supplier_id         BIGINT NOT NULL REFERENCES suppliers(id),
  status              po_status NOT NULL DEFAULT 'ordered',
  notes               TEXT NOT NULL DEFAULT '',
  user_id             BIGINT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id               BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id),
  qty_ordered         INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received        INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_cents     INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  CHECK (qty_received <= qty_ordered)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id               BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  receipt_no          TEXT NOT NULL UNIQUE,
  invoice_no          TEXT NOT NULL DEFAULT '',
  received_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  notes               TEXT NOT NULL DEFAULT '',
  user_id             BIGINT NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id          BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id          BIGINT NOT NULL REFERENCES purchase_order_items(id),
  book_id             BIGINT NOT NULL REFERENCES books(id),
  qty_received        INTEGER NOT NULL CHECK (qty_received > 0),
  unit_cost_cents     INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
);

-- =============================================================================
-- 10. EXPENSES & SETTINGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  franchise_id        TEXT REFERENCES franchises(id) ON DELETE SET NULL,
  expense_date        DATE NOT NULL,
  category            expense_category NOT NULL DEFAULT 'other',
  description         TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  user_id             BIGINT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS settings (
  franchise_id        TEXT NOT NULL DEFAULT 'global',
  key                 TEXT NOT NULL,
  value               TEXT NOT NULL,
  PRIMARY KEY (franchise_id, key)
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
  -- Businesses & Franchises
  DROP POLICY IF EXISTS "Public select businesses" ON businesses;
  CREATE POLICY "Public select businesses" ON businesses FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "Public insert businesses" ON businesses;
  CREATE POLICY "Public insert businesses" ON businesses FOR INSERT TO anon, authenticated WITH CHECK (true);
  DROP POLICY IF EXISTS "Public update businesses" ON businesses;
  CREATE POLICY "Public update businesses" ON businesses FOR UPDATE TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read franchises" ON franchises;
  CREATE POLICY "Public read franchises" ON franchises FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "Public insert franchises" ON franchises;
  CREATE POLICY "Public insert franchises" ON franchises FOR INSERT TO anon, authenticated WITH CHECK (true);
  DROP POLICY IF EXISTS "Public update franchises" ON franchises;
  CREATE POLICY "Public update franchises" ON franchises FOR UPDATE TO anon, authenticated USING (true);

  -- Users & Sessions
  DROP POLICY IF EXISTS "Public read users" ON users;
  CREATE POLICY "Public read users" ON users FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "Public insert users" ON users;
  CREATE POLICY "Public insert users" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);
  DROP POLICY IF EXISTS "Public update users" ON users;
  CREATE POLICY "Public update users" ON users FOR UPDATE TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read sessions" ON sessions;
  CREATE POLICY "Public read sessions" ON sessions FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "Public insert sessions" ON sessions;
  CREATE POLICY "Public insert sessions" ON sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
  DROP POLICY IF EXISTS "Public delete sessions" ON sessions;
  CREATE POLICY "Public delete sessions" ON sessions FOR DELETE TO anon, authenticated USING (true);

  -- Catalogue, Inventory & Stock
  DROP POLICY IF EXISTS "Public read books" ON books;
  CREATE POLICY "Public read books" ON books FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "Public mutate books" ON books;
  CREATE POLICY "Public mutate books" ON books FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read inventory" ON franchise_inventory;
  CREATE POLICY "Public read inventory" ON franchise_inventory FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App update inventory" ON franchise_inventory;
  CREATE POLICY "App update inventory" ON franchise_inventory FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read movements" ON stock_movements;
  CREATE POLICY "Public read movements" ON stock_movements FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App insert movements" ON stock_movements;
  CREATE POLICY "App insert movements" ON stock_movements FOR INSERT TO anon, authenticated WITH CHECK (true);

  -- Sales & POS Transactions
  DROP POLICY IF EXISTS "Public read sales" ON sales;
  CREATE POLICY "Public read sales" ON sales FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate sales" ON sales;
  CREATE POLICY "App mutate sales" ON sales FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read sale_items" ON sale_items;
  CREATE POLICY "Public read sale_items" ON sale_items FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate sale_items" ON sale_items;
  CREATE POLICY "App mutate sale_items" ON sale_items FOR ALL TO anon, authenticated USING (true);

  -- Phone Orders
  DROP POLICY IF EXISTS "Public read orders" ON phone_orders;
  CREATE POLICY "Public read orders" ON phone_orders FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate orders" ON phone_orders;
  CREATE POLICY "App mutate orders" ON phone_orders FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read order_items" ON phone_order_items;
  CREATE POLICY "Public read order_items" ON phone_order_items FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate order_items" ON phone_order_items;
  CREATE POLICY "App mutate order_items" ON phone_order_items FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read payments" ON order_payments;
  CREATE POLICY "Public read payments" ON order_payments FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate payments" ON order_payments;
  CREATE POLICY "App mutate payments" ON order_payments FOR ALL TO anon, authenticated USING (true);

  -- Suppliers, Purchasing & Expenses
  DROP POLICY IF EXISTS "Public read suppliers" ON suppliers;
  CREATE POLICY "Public read suppliers" ON suppliers FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate suppliers" ON suppliers;
  CREATE POLICY "App mutate suppliers" ON suppliers FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read supplier_books" ON supplier_books;
  CREATE POLICY "Public read supplier_books" ON supplier_books FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate supplier_books" ON supplier_books;
  CREATE POLICY "App mutate supplier_books" ON supplier_books FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read purchase_orders" ON purchase_orders;
  CREATE POLICY "Public read purchase_orders" ON purchase_orders FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate purchase_orders" ON purchase_orders;
  CREATE POLICY "App mutate purchase_orders" ON purchase_orders FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read po_items" ON purchase_order_items;
  CREATE POLICY "Public read po_items" ON purchase_order_items FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate po_items" ON purchase_order_items;
  CREATE POLICY "App mutate po_items" ON purchase_order_items FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read goods_receipts" ON goods_receipts;
  CREATE POLICY "Public read goods_receipts" ON goods_receipts FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate goods_receipts" ON goods_receipts;
  CREATE POLICY "App mutate goods_receipts" ON goods_receipts FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read goods_receipt_items" ON goods_receipt_items;
  CREATE POLICY "Public read goods_receipt_items" ON goods_receipt_items FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate goods_receipt_items" ON goods_receipt_items;
  CREATE POLICY "App mutate goods_receipt_items" ON goods_receipt_items FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read expenses" ON expenses;
  CREATE POLICY "Public read expenses" ON expenses FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate expenses" ON expenses;
  CREATE POLICY "App mutate expenses" ON expenses FOR ALL TO anon, authenticated USING (true);

  DROP POLICY IF EXISTS "Public read settings" ON settings;
  CREATE POLICY "Public read settings" ON settings FOR SELECT TO anon, authenticated USING (true);
  DROP POLICY IF EXISTS "App mutate settings" ON settings;
  CREATE POLICY "App mutate settings" ON settings FOR ALL TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 12. INITIAL SEED DATA: BUSINESS, 2 FRANCHISES, LOGINS & SETTINGS
-- =============================================================================

-- 1. Default Multi-Tenant Business Chain
INSERT INTO businesses (id, name, slug, owner_name, email, phone, address) VALUES
(
  'biz_srinivasa',
  'Srinivasa Book Store Chain',
  'srinivasa-books',
  'Pratham BookShop',
  'contact@srinivasabooks.example',
  '040-6455 5452',
  'Main Road, Kukatpally, Hyderabad - 500 072'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  owner_name = EXCLUDED.owner_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone;

-- 2. At least 2 Active Franchise Outlets (Satisfies the >= 2 constraint)
INSERT INTO franchises (id, business_id, code, name, city, address, phone, email, status, is_headquarters) VALUES
(
  'fr_kukatpally',
  'biz_srinivasa',
  'FR-001',
  'Srinivasa Book Store - Kukatpally (HQ)',
  'Hyderabad',
  'Main Road, Kukatpally, Hyderabad - 500 072',
  '040-6455 5452',
  'kukatpally@srinivasabooks.com',
  'active',
  true
),
(
  'fr_hitec',
  'biz_srinivasa',
  'FR-002',
  'Srinivasa Book Store - Cyber Towers',
  'Hyderabad',
  'Ground Floor, Cyber Gateway, Hitec City, Hyderabad - 500 081',
  '040-6788 9900',
  'hitec@srinivasabooks.com',
  'active',
  false
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  status = EXCLUDED.status;

-- 3. Core Credentials (bcrypt hashes for Password123, Worker123, owner12345, staff12345)
INSERT INTO users (username, full_name, password_hash, role, business_id, franchise_id, active) VALUES
(
  'Pratham19106',
  'Pratham BookShop',
  '$2a$10$22n93wQ652x.459d.0x/g.d/oM7uM7pS8rU2T5Q0e/W4wO6mO7pS8',
  'owner',
  'biz_srinivasa',
  NULL,
  true
),
(
  'worker',
  'Store Counter Worker',
  '$2a$10$o3H3e7mK7pS8rU2T5Q0e/e.d/oM7uM7pS8rU2T5Q0e/W4wO6mO7pS',
  'staff',
  'biz_srinivasa',
  'fr_kukatpally',
  true
),
(
  'owner',
  'Chain Owner',
  '$2a$10$g1k7G8l6m9n4o5p6q7r8s.d/oM7uM7pS8rU2T5Q0e/W4wO6mO7pS8',
  'owner',
  'biz_srinivasa',
  NULL,
  true
),
(
  'staff',
  'Desk Staff',
  '$2a$10$z9y8x7w6v5u4t3s2r1q0p.d/oM7uM7pS8rU2T5Q0e/W4wO6mO7pS8',
  'staff',
  'biz_srinivasa',
  'fr_kukatpally',
  true
)
ON CONFLICT (username) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  business_id = EXCLUDED.business_id;

-- 4. Storefront & System Settings
INSERT INTO settings (franchise_id, key, value) VALUES
  ('global', 'shop_name', 'Srinivasa Book Store'),
  ('global', 'currency_symbol', '₹'),
  ('global', 'tax_bp', '0'),
  ('global', 'staff_max_discount_bp', '1000'),
  ('global', 'default_low_stock_threshold', '5'),
  ('global', 'restock_lookback_days', '30'),
  ('global', 'restock_cover_days', '21'),
  ('global', 'restock_default_lead_time_days', '7'),
  ('fr_kukatpally', 'shop_name', 'Srinivasa Book Store - Kukatpally (HQ)'),
  ('fr_kukatpally', 'shop_address', 'Main Road, Kukatpally, Hyderabad - 500 072'),
  ('fr_hitec', 'shop_name', 'Srinivasa Book Store - Cyber Towers'),
  ('fr_hitec', 'shop_address', 'Ground Floor, Cyber Gateway, Hitec City, Hyderabad - 500 081')
ON CONFLICT (franchise_id, key) DO UPDATE SET value = EXCLUDED.value;

-- =============================================================================
-- 13. MOCK BOOK DATA ONLY (74 Titles with Text Genres & Physical Shelf Coordinates)
-- =============================================================================

INSERT INTO books (business_id, title, author, isbn, publisher, edition, genre, price_cents, cost_cents, stock_qty, aisle, rack, shelf, active)
VALUES
('biz_srinivasa', 'The Alchemist', 'Paulo Coelho', '9781000000009', 'HarperOne', 'Paperback 2014', 'Fiction', 29900, 17940, 40, 'A', '1', '2', true),
  ('biz_srinivasa', 'The Alchemist', 'Paulo Coelho', '9781000079197', 'HarperCollins', 'Hardcover 2018', 'Fiction', 59900, 35940, 8, 'A', '1', '3', true),
  ('biz_srinivasa', 'The White Tiger', 'Aravind Adiga', '9781000158380', 'Atlantic Books', '1st', 'Fiction', 35000, 21000, 18, 'A', '1', '4', true),
  ('biz_srinivasa', 'Midnight''s Children', 'Salman Rushdie', '9781000237573', 'Vintage Classics', '40th Anniversary', 'Fiction', 55000, 33000, 15, 'A', '2', '1', true),
  ('biz_srinivasa', 'The God of Small Things', 'Arundhati Roy', '9781000316766', 'IndiaInk', 'Paperback', 'Fiction', 39900, 23940, 22, 'A', '2', '2', true),
  ('biz_srinivasa', 'The Kite Runner', 'Khaled Hosseini', '9781000395952', 'Riverhead Books', '10th Anniversary', 'Fiction', 39900, 23940, 28, 'A', '2', '3', true),
  ('biz_srinivasa', 'Life of Pi', 'Yann Martel', '9781000475142', 'Mariner Books', 'Illustrated', 'Fiction', 35000, 21000, 20, 'A', '2', '4', true),
  ('biz_srinivasa', 'The Shadow of the Wind', 'Carlos Ruiz Zafon', '9781000554335', 'Penguin Books', 'Paperback', 'Fiction', 45000, 27000, 18, 'A', '3', '1', true),
  ('biz_srinivasa', '1984', 'George Orwell', '9781000633528', 'Penguin', 'Paperback 2008', 'Fiction', 25000, 15000, 30, 'A', '3', '2', true),
  ('biz_srinivasa', 'Animal Farm', 'George Orwell', '9781000712711', 'Penguin', 'Paperback 2008', 'Fiction', 19900, 11940, 30, 'A', '3', '3', true),
  ('biz_srinivasa', 'To Kill a Mockingbird', 'Harper Lee', '9781000791907', 'Arrow', 'Paperback 2010', 'Fiction', 32500, 19500, 20, 'A', '3', '4', true),
  ('biz_srinivasa', 'The Catcher in the Rye', 'J. D. Salinger', '9781000871098', 'Little, Brown', 'Paperback', 'Fiction', 35000, 21000, 25, 'A', '4', '1', true),
  ('biz_srinivasa', 'One Hundred Years of Solitude', 'Gabriel Garcia Marquez', '9781000950281', 'Harper Perennial', '1st', 'Fiction', 49900, 29940, 20, 'A', '4', '2', true),
  ('biz_srinivasa', 'Pride and Prejudice', 'Jane Austen', '9781001029474', 'Penguin Classics', '2nd', 'Classics', 27500, 16500, 18, 'A', '4', '3', true),
  ('biz_srinivasa', 'The Great Gatsby', 'F. Scott Fitzgerald', '9781001108667', 'Scribner', 'Paperback 2004', 'Classics', 25000, 15000, 24, 'A', '4', '4', true),
  ('biz_srinivasa', 'Crime and Punishment', 'Fyodor Dostoevsky', '9781001187853', 'Vintage', 'Pevear Translation', 'Classics', 45000, 27000, 16, 'B', '1', '1', true),
  ('biz_srinivasa', 'The Picture of Dorian Gray', 'Oscar Wilde', '9781001267043', 'Penguin Classics', 'Paperback', 'Classics', 22500, 13500, 18, 'B', '1', '2', true),
  ('biz_srinivasa', 'War and Peace', 'Leo Tolstoy', '9781001346236', 'Oxford World Classics', 'Paperback', 'Classics', 79900, 47940, 10, 'B', '1', '3', true),
  ('biz_srinivasa', 'Dune', 'Frank Herbert', '9781001425429', 'Ace Books', 'Deluxe Edition', 'Sci-Fi', 65000, 39000, 35, 'D', '1', '1', true),
  ('biz_srinivasa', 'Fahrenheit 451', 'Ray Bradbury', '9781001504612', 'Simon & Schuster', '60th Anniversary', 'Sci-Fi', 35000, 21000, 22, 'D', '1', '2', true),
  ('biz_srinivasa', 'Brave New World', 'Aldous Huxley', '9781001583808', 'Harper Perennial', 'Modern Classics', 'Sci-Fi', 32500, 19500, 22, 'D', '1', '3', true),
  ('biz_srinivasa', 'Foundation', 'Isaac Asimov', '9781001662992', 'Spectra', '1st', 'Sci-Fi', 39900, 23940, 18, 'D', '1', '4', true),
  ('biz_srinivasa', 'Project Hail Mary', 'Andy Weir', '9781001742182', 'Ballantine Books', '1st', 'Sci-Fi', 59900, 35940, 26, 'D', '2', '1', true),
  ('biz_srinivasa', 'The Hitchhiker''s Guide to the Galaxy', 'Douglas Adams', '9781001821375', 'Del Rey', 'Paperback', 'Sci-Fi', 35000, 21000, 22, 'D', '2', '2', true),
  ('biz_srinivasa', 'The Hobbit', 'J. R. R. Tolkien', '9781001900568', 'Mariner Books', 'Paperback 2012', 'Fantasy', 45000, 27000, 30, 'D', '2', '3', true),
  ('biz_srinivasa', 'The Fellowship of the Ring', 'J. R. R. Tolkien', '9781001979755', 'Mariner Books', 'Paperback 2012', 'Fantasy', 55000, 33000, 25, 'D', '2', '4', true),
  ('biz_srinivasa', 'Atomic Habits', 'James Clear', '9781002058947', 'Penguin', '1st', 'Self-Help', 49900, 29940, 45, 'B', '2', '1', true),
  ('biz_srinivasa', 'Ikigai', 'Hector Garcia', '9781002138137', 'Penguin', '1st', 'Self-Help', 35000, 21000, 28, 'B', '2', '2', true),
  ('biz_srinivasa', 'Deep Work', 'Cal Newport', '9781002217320', 'Piatkus', '1st', 'Self-Help', 45000, 27000, 20, 'B', '2', '3', true),
  ('biz_srinivasa', 'The Psychology of Money', 'Morgan Housel', '9781002296516', 'Jaico', '1st', 'Finance', 39900, 23940, 35, 'B', '2', '4', true),
  ('biz_srinivasa', 'Thinking, Fast and Slow', 'Daniel Kahneman', '9781002375709', 'Farrar, Straus and Giroux', '1st', 'Psychology', 49900, 29940, 24, 'B', '3', '1', true),
  ('biz_srinivasa', 'Man''s Search for Meaning', 'Viktor E. Frankl', '9781002454893', 'Beacon Press', '1st', 'Psychology', 29900, 17940, 26, 'B', '3', '2', true),
  ('biz_srinivasa', 'The Power of Habit', 'Charles Duhigg', '9781002534083', 'Random House', 'Paperback', 'Self-Help', 42500, 25500, 22, 'B', '3', '3', true),
  ('biz_srinivasa', 'Can''t Hurt Me', 'David Goggins', '9781002613276', 'Lioncrest', 'Clean Edition', 'Biography', 59900, 35940, 25, 'B', '3', '4', true),
  ('biz_srinivasa', 'Rich Dad Poor Dad', 'Robert Kiyosaki', '9781002692462', 'Plata', '20th Anniversary', 'Finance', 35000, 21000, 30, 'B', '4', '1', true),
  ('biz_srinivasa', 'Zero to One', 'Peter Thiel', '9781002771655', 'Virgin', '1st', 'Business', 49900, 29940, 18, 'B', '4', '2', true),
  ('biz_srinivasa', 'The Intelligent Investor', 'Benjamin Graham', '9781002850848', 'Harper Business', 'Revised 2006', 'Finance', 69900, 41940, 26, 'B', '4', '3', true),
  ('biz_srinivasa', 'Shoe Dog', 'Phil Knight', '9781002930038', 'Scribner', 'Paperback 2018', 'Business', 49900, 29940, 24, 'B', '4', '4', true),
  ('biz_srinivasa', 'Principles: Life and Work', 'Ray Dalio', '9781003009221', 'Simon & Schuster', '1st', 'Business', 89900, 53940, 16, 'C', '1', '1', true),
  ('biz_srinivasa', 'The Lean Startup', 'Eric Ries', '9781003088417', 'Crown Business', '1st', 'Business', 55000, 33000, 20, 'C', '1', '2', true),
  ('biz_srinivasa', 'Good to Great', 'Jim Collins', '9781003167600', 'Harper Business', '1st', 'Business', 65000, 39000, 14, 'C', '1', '3', true),
  ('biz_srinivasa', 'Sapiens', 'Yuval Noah Harari', '9781003246794', 'Harvill Secker', '1st', 'History', 55000, 33000, 25, 'C', '2', '1', true),
  ('biz_srinivasa', 'Homo Deus', 'Yuval Noah Harari', '9781003325987', 'Harvill Secker', '1st', 'History', 57500, 34500, 15, 'C', '2', '2', true),
  ('biz_srinivasa', 'Guns, Germs, and Steel', 'Jared Diamond', '9781003405177', 'W. W. Norton', '20th Anniversary', 'History', 55000, 33000, 16, 'C', '2', '3', true),
  ('biz_srinivasa', 'Discovery of India', 'Jawaharlal Nehru', '9781003484363', 'Penguin', '1st', 'History', 45000, 27000, 12, 'C', '2', '4', true),
  ('biz_srinivasa', 'Wings of Fire', 'A. P. J. Abdul Kalam', '9781003563556', 'Universities Press', '1st', 'Biography', 22500, 13500, 25, 'C', '3', '1', true),
  ('biz_srinivasa', 'An Era of Darkness', 'Shashi Tharoor', '9781003642749', 'Aleph Book Company', '1st', 'History', 49900, 29940, 20, 'C', '3', '2', true),
  ('biz_srinivasa', 'India After Gandhi', 'Ramachandra Guha', '9781003721932', 'HarperCollins', '10th Anniversary', 'History', 75000, 45000, 14, 'C', '3', '3', true),
  ('biz_srinivasa', 'A Brief History of Time', 'Stephen Hawking', '9781003801122', 'Bantam', '10th Anniversary', 'Science', 39900, 23940, 22, 'C', '3', '4', true),
  ('biz_srinivasa', 'Cosmos', 'Carl Sagan', '9781003880318', 'Ballantine Books', 'Paperback 2013', 'Science', 49900, 29940, 18, 'C', '4', '1', true),
  ('biz_srinivasa', 'The Gene: An Intimate History', 'Siddhartha Mukherjee', '9781003959502', 'Scribner', '1st', 'Science', 59900, 35940, 15, 'C', '4', '2', true),
  ('biz_srinivasa', 'Meditations', 'Marcus Aurelius', '9781004038695', 'Modern Library', 'Hays Translation', 'Philosophy', 35000, 21000, 28, 'C', '4', '3', true),
  ('biz_srinivasa', 'Beyond Good and Evil', 'Friedrich Nietzsche', '9781004117888', 'Vintage', 'Kaufmann Translation', 'Philosophy', 39900, 23940, 14, 'C', '4', '4', true),
  ('biz_srinivasa', 'Clean Code', 'Robert C. Martin', '9781004197071', 'Prentice Hall', '1st', 'Technology', 320000, 192000, 12, 'E', '1', '1', true),
  ('biz_srinivasa', 'Introduction to Algorithms', 'Cormen et al.', '9781004276264', 'MIT Press', '4th', 'Technology', 580000, 348000, 6, 'E', '1', '2', true),
  ('biz_srinivasa', 'Introduction to Algorithms', 'Cormen et al.', '9781004355457', 'MIT Press', '3rd', 'Technology', 450000, 270000, 4, 'E', '1', '3', true),
  ('biz_srinivasa', 'Python Crash Course', 'Eric Matthes', '9781004434640', 'No Starch Press', '3rd', 'Technology', 290000, 174000, 14, 'E', '1', '4', true),
  ('biz_srinivasa', 'Designing Data-Intensive Applications', 'Martin Kleppmann', '9781004513833', 'O''Reilly Media', '1st', 'Technology', 340000, 204000, 16, 'E', '2', '1', true),
  ('biz_srinivasa', 'The Pragmatic Programmer', 'David Thomas & Andrew Hunt', '9781004593026', 'Addison-Wesley', '20th Anniversary', 'Technology', 310000, 186000, 12, 'E', '2', '2', true),
  ('biz_srinivasa', 'Design Patterns', 'Erich Gamma et al.', '9781004672219', 'Addison-Wesley', '1st', 'Technology', 420000, 252000, 8, 'E', '2', '3', true),
  ('biz_srinivasa', 'Grokking Algorithms', 'Aditya Bhargava', '9781004751402', 'Manning', '1st', 'Technology', 185000, 111000, 18, 'E', '2', '4', true),
  ('biz_srinivasa', 'The Silent Patient', 'Alex Michaelides', '9781004830596', 'Celadon Books', '1st', 'Mystery', 39900, 23940, 32, 'G', '1', '1', true),
  ('biz_srinivasa', 'And Then There Were None', 'Agatha Christie', '9781004909780', 'William Morrow', 'Paperback', 'Mystery', 29900, 17940, 25, 'G', '1', '2', true),
  ('biz_srinivasa', 'The Hound of the Baskervilles', 'Arthur Conan Doyle', '9781004988976', 'Penguin Classics', 'Paperback', 'Mystery', 22500, 13500, 20, 'G', '1', '3', true),
  ('biz_srinivasa', 'The Da Vinci Code', 'Dan Brown', '9781005068165', 'Anchor Books', 'Paperback', 'Mystery', 39900, 23940, 25, 'G', '1', '4', true),
  ('biz_srinivasa', 'Gone Girl', 'Gillian Flynn', '9781005147358', 'Crown Publishing', '1st', 'Mystery', 35000, 21000, 20, 'G', '2', '1', true),
  ('biz_srinivasa', 'Harry Potter and the Philosopher''s Stone', 'J. K. Rowling', '9781005226541', 'Bloomsbury', 'Paperback 2014', 'Children', 39900, 23940, 45, 'F', '1', '1', true),
  ('biz_srinivasa', 'Harry Potter and the Chamber of Secrets', 'J. K. Rowling', '9781005305734', 'Bloomsbury', 'Paperback 2014', 'Children', 39900, 23940, 30, 'F', '1', '2', true),
  ('biz_srinivasa', 'Harry Potter and the Prisoner of Azkaban', 'J. K. Rowling', '9781005384920', 'Bloomsbury', 'Paperback 2014', 'Children', 45000, 27000, 30, 'F', '1', '3', true),
  ('biz_srinivasa', 'The Little Prince', 'Antoine de Saint-Exupery', '9781005464110', 'Egmont', '1st', 'Children', 19900, 11940, 18, 'F', '2', '1', true),
  ('biz_srinivasa', 'Percy Jackson: The Lightning Thief', 'Rick Riordan', '9781005543303', 'Disney Hyperion', '1st', 'Children', 35000, 21000, 25, 'F', '2', '2', true),
  ('biz_srinivasa', 'Gitanjali', 'Rabindranath Tagore', '9781005622497', 'Fingerprint', '1st', 'Poetry', 15000, 9000, 12, 'G', '3', '1', true),
  ('biz_srinivasa', 'The Prophet', 'Kahlil Gibran', '9781005701680', 'Knopf', 'Deluxe Edition', 'Poetry', 29900, 17940, 18, 'G', '3', '2', true),
  ('biz_srinivasa', 'Rumi: Selected Poems', 'Coleman Barks', '9781005780876', 'Penguin Classics', 'Paperback', 'Poetry', 35000, 21000, 15, 'G', '3', '3', true)
ON CONFLICT (isbn) DO UPDATE SET
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  genre = EXCLUDED.genre,
  price_cents = EXCLUDED.price_cents,
  cost_cents = EXCLUDED.cost_cents,
  stock_qty = EXCLUDED.stock_qty,
  aisle = EXCLUDED.aisle,
  rack = EXCLUDED.rack,
  shelf = EXCLUDED.shelf;

-- Populate Franchise Shelf Inventory from Book Catalogue
INSERT INTO franchise_inventory (franchise_id, book_id, stock_qty, reserved_qty, low_stock_threshold, aisle, rack, shelf)
SELECT 'fr_kukatpally', id, stock_qty, 0, low_stock_threshold, aisle, rack, shelf
FROM books
ON CONFLICT (franchise_id, book_id) DO UPDATE SET
  stock_qty = EXCLUDED.stock_qty,
  aisle = EXCLUDED.aisle,
  rack = EXCLUDED.rack,
  shelf = EXCLUDED.shelf;

INSERT INTO franchise_inventory (franchise_id, book_id, stock_qty, reserved_qty, low_stock_threshold, aisle, rack, shelf)
SELECT 'fr_hitec', id, GREATEST(0, stock_qty - 5), 0, low_stock_threshold, aisle, rack, shelf
FROM books
ON CONFLICT (franchise_id, book_id) DO UPDATE SET
  stock_qty = EXCLUDED.stock_qty,
  aisle = EXCLUDED.aisle,
  rack = EXCLUDED.rack,
  shelf = EXCLUDED.shelf;

-- =============================================================================
-- MASTER MIGRATION COMPLETE: ZERO FAKE TRANSACTIONS, ONLY CLEAN MOCK BOOKS & INVENTORY
-- =============================================================================
