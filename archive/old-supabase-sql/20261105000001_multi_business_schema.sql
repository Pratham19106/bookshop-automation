-- =============================================================================
-- Bookshop Automation System: Multi-Business & Multi-Franchise PostgreSQL Schema
-- Migration: 20261105000001_multi_business_schema.sql
-- Enables:
--   1. Multi-business / Multi-chain support (multiple owners with distinct bookshop chains)
--   2. Multi-franchise per business (each chain must maintain >= 2 active outlets)
--   3. Cross-franchise isolation and per-business tenant partitioning
--   4. Public business registration flow with owner user creation
-- =============================================================================

-- 1. Businesses Table (Bookshop Chains)
CREATE TABLE IF NOT EXISTS businesses (
  id              TEXT PRIMARY KEY,                     -- e.g. 'biz_srinivasa', 'biz_crossword'
  name            TEXT NOT NULL,                        -- e.g. 'Srinivasa Book Store Chain'
  slug            TEXT NOT NULL UNIQUE,                 -- e.g. 'srinivasa-books'
  owner_name      TEXT NOT NULL,                        -- e.g. 'Pratham BookShop'
  email           TEXT NOT NULL,                        -- e.g. 'contact@srinivasabooks.example'
  phone           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. Link Franchises (Outlets) to Businesses
ALTER TABLE franchises 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_franchises_biz ON franchises(business_id);

-- 3. Update Multi-Franchise Constraint Trigger (Scoped per Business)
-- Enforces that every bookshop chain maintains at least 2 active franchises/outlets
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

-- 4. Multi-Tenant Scoping Columns
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE books 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE sales 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE phone_orders 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE expenses 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE suppliers 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE purchase_orders 
  ADD COLUMN IF NOT EXISTS business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE;

-- 5. Seed Initial Default Business & Associate Existing Franchises/Users
INSERT INTO businesses (id, name, slug, owner_name, email, phone)
VALUES (
  'biz_srinivasa', 
  'Srinivasa Book Store Chain', 
  'srinivasa-books', 
  'Pratham BookShop', 
  'contact@srinivasabooks.example', 
  '040-6455 5452'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  owner_name = EXCLUDED.owner_name,
  phone = EXCLUDED.phone;

-- Migrate existing orphaned records to the default business
UPDATE franchises SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE users SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE books SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE sales SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE phone_orders SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE expenses SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE suppliers SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;
UPDATE purchase_orders SET business_id = 'biz_srinivasa' WHERE business_id IS NULL;

-- 6. Row Level Security Policies for Multi-Tenant Registration & Sessions
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Public select businesses" ON businesses FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public insert businesses" ON businesses FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public update businesses" ON businesses FOR UPDATE TO anon, authenticated USING (true);

  CREATE POLICY "Public insert users" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public read users" ON users FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public update users" ON users FOR UPDATE TO anon, authenticated USING (true);

  CREATE POLICY "Public insert franchises" ON franchises FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public update franchises" ON franchises FOR UPDATE TO anon, authenticated USING (true);

  CREATE POLICY "Public insert sessions" ON sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY "Public read sessions" ON sessions FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "Public delete sessions" ON sessions FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

