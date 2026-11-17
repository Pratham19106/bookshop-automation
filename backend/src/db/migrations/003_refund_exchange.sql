-- Bookshop Automation System: Refund and Exchange Support
-- Adds returned_qty to sale_items, creates sale_returns table, and updates stock_movements check constraint.

ALTER TABLE sale_items ADD COLUMN returned_qty INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sale_returns (
  id                  INTEGER PRIMARY KEY,
  sale_id             INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sale_item_id        INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  book_id             INTEGER NOT NULL REFERENCES books(id),
  type                TEXT NOT NULL CHECK (type IN ('refund', 'exchange')),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  amount_cents        INTEGER NOT NULL DEFAULT 0,
  replacement_book_id INTEGER REFERENCES books(id),
  reason              TEXT NOT NULL DEFAULT '',
  user_id             INTEGER REFERENCES users(id),
  business_id         TEXT REFERENCES businesses(id),
  franchise_id        TEXT REFERENCES franchises(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_book ON sale_returns(book_id);

-- Recreate stock_movements to allow 'refund' and 'exchange' as valid reasons
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS stock_movements_new (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES books(id),
  delta      INTEGER NOT NULL CHECK (delta <> 0),
  reason     TEXT NOT NULL CHECK (reason IN ('sale','sale_void','receipt','adjustment','opening','refund','exchange')),
  ref_type   TEXT,
  ref_id     INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO stock_movements_new SELECT * FROM stock_movements;
DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;
CREATE INDEX IF NOT EXISTS idx_movements_book ON stock_movements(book_id, created_at);
PRAGMA foreign_keys=ON;
