-- Bookshop Automation System: initial schema.
-- All money is stored as integer minor units (paise/cents). Percentages are basis points (1% = 100).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','staff')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Each edition is its own row (own ISBN, own stock).
CREATE TABLE books (
  id                  INTEGER PRIMARY KEY,
  title               TEXT NOT NULL,
  author              TEXT NOT NULL,
  isbn                TEXT,                       -- normalised: digits (and trailing X), no hyphens; NULL if unknown
  publisher           TEXT NOT NULL DEFAULT '',
  edition             TEXT NOT NULL DEFAULT '',   -- e.g. "2nd", "Paperback 2021"
  genre               TEXT NOT NULL DEFAULT '',
  price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents          INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0), -- weighted-average purchase cost; 0 = unknown
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reserved_qty        INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  low_stock_threshold INTEGER,                    -- NULL = use shop default
  aisle               TEXT NOT NULL DEFAULT '',
  rack                TEXT NOT NULL DEFAULT '',
  shelf               TEXT NOT NULL DEFAULT '',
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (reserved_qty <= stock_qty)
);
CREATE UNIQUE INDEX uq_books_isbn ON books(isbn) WHERE isbn IS NOT NULL;
-- Without an ISBN, a book is identified by title+author+edition+publisher.
CREATE UNIQUE INDEX uq_books_identity ON books(lower(title), lower(author), lower(edition), lower(publisher)) WHERE isbn IS NULL;
CREATE INDEX idx_books_title ON books(title COLLATE NOCASE);
CREATE INDEX idx_books_author ON books(author COLLATE NOCASE);

-- Append-only ledger of every stock change.
CREATE TABLE stock_movements (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES books(id),
  delta      INTEGER NOT NULL CHECK (delta <> 0),
  reason     TEXT NOT NULL CHECK (reason IN ('sale','sale_void','receipt','adjustment','opening')),
  ref_type   TEXT,
  ref_id     INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_movements_book ON stock_movements(book_id, created_at);

CREATE TABLE phone_orders (
  id                 INTEGER PRIMARY KEY,
  order_no           TEXT NOT NULL UNIQUE,
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT NOT NULL,
  delivery_type      TEXT NOT NULL CHECK (delivery_type IN ('pickup','delivery')),
  delivery_address   TEXT NOT NULL DEFAULT '',
  promised_date      TEXT,
  notes              TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'placed'
                     CHECK (status IN ('placed','ready','out_for_delivery','completed','cancelled')),
  discount_bp        INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  tax_bp             INTEGER NOT NULL DEFAULT 0 CHECK (tax_bp >= 0),
  subtotal_cents     INTEGER NOT NULL DEFAULT 0,
  discount_cents     INTEGER NOT NULL DEFAULT 0,
  tax_cents          INTEGER NOT NULL DEFAULT 0,
  total_cents        INTEGER NOT NULL DEFAULT 0,
  sale_id            INTEGER,                      -- set when converted into a bill (fulfilment)
  cancel_reason      TEXT NOT NULL DEFAULT '',
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((status = 'completed') = (sale_id IS NOT NULL))
);
CREATE INDEX idx_orders_status ON phone_orders(status);

CREATE TABLE phone_order_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES phone_orders(id) ON DELETE CASCADE,
  book_id          INTEGER NOT NULL REFERENCES books(id),
  title            TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  UNIQUE (order_id, book_id)
);

-- Signed ledger: positive = payment received, negative = refund. Payment status is derived from this.
CREATE TABLE order_payments (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES phone_orders(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','card','upi','other')),
  note         TEXT NOT NULL DEFAULT '',
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sales (
  id               INTEGER PRIMARY KEY,
  bill_no          TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  customer_name    TEXT NOT NULL DEFAULT '',
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('cash','card','upi','other')),
  subtotal_cents   INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_bp      INTEGER NOT NULL DEFAULT 0,
  discount_cents   INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_bp           INTEGER NOT NULL DEFAULT 0,
  tax_cents        INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  order_id         INTEGER UNIQUE REFERENCES phone_orders(id),  -- one bill per phone order, ever
  idempotency_key  TEXT UNIQUE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  void_reason      TEXT NOT NULL DEFAULT '',
  voided_by        INTEGER REFERENCES users(id),
  voided_at        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sales_created ON sales(created_at);

-- Snapshot of what was sold: title/price/cost are frozen at the time of sale.
CREATE TABLE sale_items (
  id               INTEGER PRIMARY KEY,
  sale_id          INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  book_id          INTEGER NOT NULL REFERENCES books(id),
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
CREATE INDEX idx_sale_items_book ON sale_items(book_id);

CREATE TABLE suppliers (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact_person TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  categories     TEXT NOT NULL DEFAULT '',   -- free text, e.g. genres supplied
  lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
  notes          TEXT NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Which supplier can supply which book, at what quoted cost. Several suppliers per book are allowed.
CREATE TABLE supplier_books (
  supplier_id      INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  book_id          INTEGER NOT NULL REFERENCES books(id),
  unit_cost_cents  INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (supplier_id, book_id)
);
CREATE INDEX idx_supplier_books_book ON supplier_books(book_id);

CREATE TABLE purchase_orders (
  id          INTEGER PRIMARY KEY,
  po_no       TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status      TEXT NOT NULL DEFAULT 'ordered'
              CHECK (status IN ('ordered','partially_received','received','cancelled')),
  notes       TEXT NOT NULL DEFAULT '',
  expected_date TEXT,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE purchase_order_items (
  id               INTEGER PRIMARY KEY,
  po_id            INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  book_id          INTEGER NOT NULL REFERENCES books(id),
  qty_ordered      INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received     INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_cents  INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  UNIQUE (po_id, book_id),
  CHECK (qty_received <= qty_ordered)
);

CREATE TABLE goods_receipts (
  id              INTEGER PRIMARY KEY,
  po_id           INTEGER NOT NULL REFERENCES purchase_orders(id),
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  note            TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  received_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_receipts_date ON goods_receipts(received_at);

CREATE TABLE goods_receipt_items (
  id              INTEGER PRIMARY KEY,
  receipt_id      INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id      INTEGER NOT NULL REFERENCES purchase_order_items(id),
  book_id         INTEGER NOT NULL REFERENCES books(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY,
  expense_date TEXT NOT NULL,                -- YYYY-MM-DD
  category     TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);

INSERT INTO settings(key, value) VALUES
  ('shop_name', 'My Bookshop'),
  ('shop_address', ''),
  ('currency_symbol', '₹'),
  ('tax_bp', '0'),                     -- tax on (subtotal - discount); 0 by default (books are commonly exempt)
  ('staff_max_discount_bp', '1000'),   -- staff may discount up to 10%; owner up to 100%
  ('default_low_stock_threshold', '5'),
  ('restock_lookback_days', '30'),
  ('restock_cover_days', '21'),
  ('restock_default_lead_time_days', '7');
