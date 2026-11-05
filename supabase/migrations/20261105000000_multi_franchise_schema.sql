-- =============================================================================
-- Bookshop Automation System: Supabase Multi-Franchise PostgreSQL Schema
-- Configured for Supabase PostgreSQL & Vercel Deployment
-- Features:
--   1. Explicit PostgreSQL ENUMs for all categorical data
--   2. Multi-franchise architecture with >= 2 franchises enforced by constraint/trigger
--   3. Centralized master catalogue with per-franchise inventory coordinates
--   4. RLS policies for secure client-side and server-side access
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. EXPLICIT POSTGRESQL ENUMS (Categorical Data)
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'manager', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE franchise_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE book_genre AS ENUM (
    'Fiction',
    'Non-Fiction',
    'Science & Tech',
    'Business & Economics',
    'Children',
    'History',
    'Philosophy',
    'Comics',
    'Academic & Textbook',
    'Other'
  );
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
-- 2. FRANCHISES TABLE & MULTI-FRANCHISE CONSTRAINT
-- =============================================================================

CREATE TABLE IF NOT EXISTS franchises (
  id              TEXT PRIMARY KEY,                     -- e.g. 'fr_kukatpally', 'fr_hitec'
  code            TEXT NOT NULL UNIQUE,                 -- e.g. 'FR-001', 'FR-002'
  name            TEXT NOT NULL,                        -- e.g. 'Srinivasa Book Store - Kukatpally (HQ)'
  city            TEXT NOT NULL DEFAULT 'Hyderabad',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  status          franchise_status NOT NULL DEFAULT 'active',
  is_headquarters BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Constraint Trigger: Ensure at least 2 active franchises are maintained at all times
CREATE OR REPLACE FUNCTION check_min_active_franchises()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO active_count FROM franchises WHERE status = 'active';
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status != 'active')) THEN
    IF active_count < 2 THEN
      RAISE EXCEPTION 'Constraint Violation: System requires at least 2 active franchises supportable at all times.';
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
-- 3. USERS & SESSIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'staff',
  franchise_id  TEXT REFERENCES franchises(id) ON DELETE SET NULL, -- NULL = owner / multi-franchise superuser
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
-- 4. MASTER CATALOGUE (Global Book Definitions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS books (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL,
  isbn        TEXT UNIQUE,                          -- Digits and trailing X, no hyphens
  publisher   TEXT NOT NULL DEFAULT '',
  edition     TEXT NOT NULL DEFAULT '',
  genre       book_genre NOT NULL DEFAULT 'Other',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);

-- =============================================================================
-- 5. FRANCHISE INVENTORY (Multi-Store Quantities & Coordinates)
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

-- Stock Movements Ledger (Scoped to Franchise & Cross-Franchise Transfers)
CREATE TABLE IF NOT EXISTS stock_movements (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id        TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  book_id             BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  delta               INTEGER NOT NULL CHECK (delta <> 0),
  reason              stock_reason NOT NULL,
  ref_type            TEXT,
  ref_id              BIGINT,
  target_franchise_id TEXT REFERENCES franchises(id) ON DELETE SET NULL, -- For franchise transfers
  note                TEXT NOT NULL DEFAULT '',
  user_id             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_franchise ON stock_movements(franchise_id, created_at DESC);

-- =============================================================================
-- 6. POINT-OF-SALE SALES & BILLING (Franchise-Scoped)
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id    TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  bill_no         TEXT NOT NULL UNIQUE,
  status          sale_status NOT NULL DEFAULT 'completed',
  customer_name   TEXT NOT NULL DEFAULT '',
  payment_method  payment_method NOT NULL DEFAULT 'cash',
  subtotal_cents  INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_bp     INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_bp          INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp >= 0),
  tax_cents       INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  order_id        BIGINT UNIQUE,
  idempotency_key TEXT UNIQUE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  void_reason     TEXT NOT NULL DEFAULT '',
  voided_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  voided_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_sales_franchise_date ON sales(franchise_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id          BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  book_id          BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  author           TEXT NOT NULL DEFAULT '',
  isbn             TEXT,
  edition          TEXT NOT NULL DEFAULT '',
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  UNIQUE (sale_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_book ON sale_items(book_id);

-- =============================================================================
-- 7. PHONE ORDERS & RESERVATIONS (Franchise-Scoped)
-- =============================================================================

CREATE TABLE IF NOT EXISTS phone_orders (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id     TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  order_no         TEXT NOT NULL UNIQUE,
  customer_name    TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,
  delivery_type    delivery_type NOT NULL DEFAULT 'pickup',
  delivery_address TEXT NOT NULL DEFAULT '',
  promised_date    TIMESTAMPTZ,
  notes            TEXT NOT NULL DEFAULT '',
  status           order_status NOT NULL DEFAULT 'placed',
  discount_bp      INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  tax_bp           INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp >= 0),
  subtotal_cents   INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents   INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents        INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents      INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  sale_id          BIGINT REFERENCES sales(id) ON DELETE SET NULL,
  cancel_reason    TEXT NOT NULL DEFAULT '',
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK ((status = 'completed') = (sale_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_orders_franchise_status ON phone_orders(franchise_id, status);

CREATE TABLE IF NOT EXISTS phone_order_items (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         BIGINT NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  book_id          BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  UNIQUE (order_id, book_id)
);

CREATE TABLE IF NOT EXISTS order_payments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  order_id     BIGINT NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  method       payment_method NOT NULL DEFAULT 'cash',
  note         TEXT NOT NULL DEFAULT '',
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- =============================================================================
-- 8. SUPPLIERS & RESTOCK PURCHASING
-- =============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  contact_person TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  categories     TEXT NOT NULL DEFAULT '',
  lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
  notes          TEXT NOT NULL DEFAULT '',
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS supplier_books (
  supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  book_id         BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (supplier_id, book_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id  TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  po_no         TEXT NOT NULL UNIQUE,
  supplier_id   BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  status        po_status NOT NULL DEFAULT 'ordered',
  notes         TEXT NOT NULL DEFAULT '',
  expected_date TIMESTAMPTZ,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id           BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  book_id         BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  qty_ordered     INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received    INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  UNIQUE (po_id, book_id),
  CHECK (qty_received <= qty_ordered)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id    TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  po_id           BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  note            TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id      BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id      BIGINT NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
  book_id         BIGINT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
);

-- =============================================================================
-- 9. EXPENSES & FRANCHISE SETTINGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  franchise_id TEXT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  category     expense_category NOT NULL DEFAULT 'other',
  description  TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_expenses_franchise_date ON expenses(franchise_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS settings (
  franchise_id TEXT NOT NULL DEFAULT 'global',
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (franchise_id, key)
);

-- =============================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

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

-- Allow anon and authenticated roles full read access
DO $$ BEGIN
  CREATE POLICY "Public read franchises" ON franchises FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read books" ON books FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read inventory" ON franchise_inventory FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read sales" ON sales FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read sale_items" ON sale_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read orders" ON phone_orders FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read order_items" ON phone_order_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read payments" ON order_payments FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read suppliers" ON suppliers FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read supplier_books" ON supplier_books FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read purchase_orders" ON purchase_orders FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read po_items" ON purchase_order_items FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read expenses" ON expenses FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read settings" ON settings FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public read movements" ON stock_movements FOR SELECT TO anon, authenticated USING (true);
  
  -- Mutations for application terminal
  CREATE POLICY "App insert sales" ON sales FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "App insert sale_items" ON sale_items FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "App update inventory" ON franchise_inventory FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "App insert movements" ON stock_movements FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "App mutate orders" ON phone_orders FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "App mutate order_items" ON phone_order_items FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "App mutate expenses" ON expenses FOR ALL TO anon, authenticated USING (true);
  CREATE POLICY "App mutate settings" ON settings FOR ALL TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 11. SEED DATA: AT LEAST 2 FRANCHISES & INITIAL SETTINGS
-- =============================================================================

INSERT INTO franchises (id, code, name, city, address, phone, email, status, is_headquarters) VALUES
  (
    'fr_kukatpally',
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

-- Global & Franchise Settings
INSERT INTO settings (franchise_id, key, value) VALUES
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

