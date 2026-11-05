-- Bookshop Automation System: Multi-Business & Multi-Franchise schema migration.

CREATE TABLE IF NOT EXISTS businesses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  owner_name  TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS franchises (
  id              TEXT PRIMARY KEY,
  business_id     TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL DEFAULT 'Hyderabad',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_headquarters INTEGER NOT NULL DEFAULT 0 CHECK (is_headquarters IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE users ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE users ADD COLUMN franchise_id TEXT REFERENCES franchises(id);

ALTER TABLE books ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE books ADD COLUMN franchise_id TEXT REFERENCES franchises(id);

ALTER TABLE sales ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE sales ADD COLUMN franchise_id TEXT REFERENCES franchises(id);

ALTER TABLE phone_orders ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE phone_orders ADD COLUMN franchise_id TEXT REFERENCES franchises(id);

ALTER TABLE expenses ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE expenses ADD COLUMN franchise_id TEXT REFERENCES franchises(id);

ALTER TABLE suppliers ADD COLUMN business_id TEXT REFERENCES businesses(id);

ALTER TABLE purchase_orders ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE purchase_orders ADD COLUMN franchise_id TEXT REFERENCES franchises(id);

-- Default seeds for standalone or existing local installations
INSERT OR IGNORE INTO businesses (id, name, slug, owner_name, email, phone)
VALUES ('biz_default', 'Srinivasa Book Store Chain', 'srinivasa-books', 'Pratham BookShop', 'contact@srinivasabooks.example', '040-6455 5452');

INSERT OR IGNORE INTO franchises (id, business_id, code, name, city, address, phone, is_headquarters)
VALUES ('fr_kukatpally', 'biz_default', 'FR-001', 'Srinivasa Book Store - Kukatpally (HQ)', 'Hyderabad', 'Main Road, Kukatpally, Hyderabad - 500 072', '040-6455 5452', 1);

INSERT OR IGNORE INTO franchises (id, business_id, code, name, city, address, phone, is_headquarters)
VALUES ('fr_hitec', 'biz_default', 'FR-002', 'Srinivasa Book Store - Cyber Towers', 'Hyderabad', 'Ground Floor, Cyber Gateway, Hitec City', '040-6788 9900', 0);

UPDATE users SET business_id = 'biz_default' WHERE business_id IS NULL;
UPDATE books SET business_id = 'biz_default' WHERE business_id IS NULL;
UPDATE sales SET business_id = 'biz_default' WHERE business_id IS NULL;
UPDATE phone_orders SET business_id = 'biz_default' WHERE business_id IS NULL;
UPDATE expenses SET business_id = 'biz_default' WHERE business_id IS NULL;
UPDATE suppliers SET business_id = 'biz_default' WHERE business_id IS NULL;
UPDATE purchase_orders SET business_id = 'biz_default' WHERE business_id IS NULL;

