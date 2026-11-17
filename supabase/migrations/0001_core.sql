-- Bookshop Automation System: multi-business / multi-shop core schema (PostgreSQL / Supabase).
--
-- Conventions
--   * Money is integer minor units (paise). Percentages are basis points (1% = 100).
--   * Every tenant row carries business_id; shop-level rows also carry shop_id. Composite foreign keys
--     (business_id, shop_id) / (business_id, book_id) make it impossible to attach a row of one business to
--     a shop or book of another, even if application code had a bug.
--   * History is never deleted: voids, refunds and exchanges are new rows.
--   * RLS is enabled on every table with no policies: the API connects as the table owner (bypasses RLS),
--     while Supabase's public anon / publishable key can read or write nothing.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- tenancy
create table businesses (
  id          bigint generated always as identity primary key,
  name        text not null check (length(name) between 1 and 100),
  slug        text not null unique,
  email       text not null default '',
  phone       text not null default '',
  created_at  timestamptz not null default now()
);

create table business_settings (
  business_id                    bigint primary key references businesses(id) on delete cascade,
  currency_symbol                text not null default '₹',
  tax_bp                         integer not null default 0 check (tax_bp between 0 and 10000),
  staff_max_discount_bp          integer not null default 1000 check (staff_max_discount_bp between 0 and 10000),
  manager_max_discount_bp        integer not null default 2500 check (manager_max_discount_bp between 0 and 10000),
  default_low_stock_threshold    integer not null default 5 check (default_low_stock_threshold >= 0),
  restock_lookback_days          integer not null default 30 check (restock_lookback_days between 7 and 365),
  restock_cover_days             integer not null default 21 check (restock_cover_days between 1 and 365),
  restock_default_lead_time_days integer not null default 7 check (restock_default_lead_time_days between 0 and 120),
  return_window_days             integer not null default 7 check (return_window_days between 0 and 90)
);

create table shops (
  id           bigint generated always as identity primary key,
  business_id  bigint not null references businesses(id) on delete cascade,
  code         text not null,
  name         text not null check (length(name) between 1 and 100),
  city         text not null default '',
  address      text not null default '',
  phone        text not null default '',
  is_hq        boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, id)
);
create unique index uq_shops_one_hq on shops(business_id) where is_hq;

create table users (
  id            bigint generated always as identity primary key,
  business_id   bigint not null references businesses(id) on delete cascade,
  username      text not null check (username ~ '^[A-Za-z0-9_.-]{3,50}$'),
  full_name     text not null,
  password_hash text not null,
  role          text not null check (role in ('owner', 'manager', 'staff')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (business_id, id)
);
-- Usernames are global so sign-in needs only username + password.
create unique index uq_users_username on users(lower(username));

-- Shops a manager / staff member works in. Owners implicitly have every shop of their business.
create table user_shops (
  business_id bigint not null,
  user_id     bigint not null,
  shop_id     bigint not null,
  primary key (user_id, shop_id),
  foreign key (business_id, user_id) references users(business_id, id) on delete cascade,
  foreign key (business_id, shop_id) references shops(business_id, id) on delete cascade
);

create table sessions (
  token_hash  text primary key,
  user_id     bigint not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index idx_sessions_user on sessions(user_id);

-- Per-shop running numbers for bills, phone orders and purchase orders (no MAX(id)+1 races).
create table shop_counters (
  shop_id  bigint not null references shops(id) on delete cascade,
  kind     text not null check (kind in ('bill', 'order', 'po')),
  value    bigint not null default 0,
  primary key (shop_id, kind)
);

-- ---------------------------------------------------------------- catalogue
-- Global ISBN reference catalogue shared by every business (imported from open4goods). Read-only for tenants.
create table catalog_books (
  isbn             text primary key check (isbn ~ '^[0-9]{9}[0-9X]$|^[0-9]{13}$'),
  title            text not null,
  publisher        text not null default '',
  format           text not null default '',
  pages            integer,
  category         text not null default '',
  subcategory      text not null default '',
  ref_price_cents  integer,             -- reference list price from the source (EUR minor units); informational only
  imported_at      timestamptz not null default now()
);
create index idx_catalog_title_trgm on catalog_books using gin (lower(title) extensions.gin_trgm_ops);
create index idx_catalog_category on catalog_books(category);

-- A business's own titles. Price is set by the business; stock lives per shop in shop_stock.
create table books (
  id           bigint generated always as identity primary key,
  business_id  bigint not null references businesses(id) on delete cascade,
  isbn         text,                     -- normalised digits (+X); NULL when unknown
  title        text not null,
  author       text not null default '',
  publisher    text not null default '',
  edition      text not null default '',
  genre        text not null default '',
  price_cents  integer not null check (price_cents >= 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);
create unique index uq_books_isbn on books(business_id, isbn) where isbn is not null;
create unique index uq_books_identity on books(business_id, lower(title), lower(author), lower(edition), lower(publisher)) where isbn is null;
create index idx_books_title_trgm on books using gin (lower(title) extensions.gin_trgm_ops);
create index idx_books_business on books(business_id, active);

-- Stock of one title in one shop.
create table shop_stock (
  business_id          bigint not null,
  shop_id              bigint not null,
  book_id              bigint not null,
  stock_qty            integer not null default 0 check (stock_qty >= 0),
  reserved_qty         integer not null default 0 check (reserved_qty >= 0),
  cost_cents           integer not null default 0 check (cost_cents >= 0),  -- weighted-average purchase cost; 0 = unknown
  low_stock_threshold  integer check (low_stock_threshold >= 0),           -- NULL = business default
  aisle                text not null default '',
  rack                 text not null default '',
  shelf                text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (shop_id, book_id),
  check (reserved_qty <= stock_qty),
  foreign key (business_id, shop_id) references shops(business_id, id) on delete cascade,
  foreign key (business_id, book_id) references books(business_id, id) on delete cascade
);
create index idx_shop_stock_book on shop_stock(book_id);

-- Append-only ledger of every stock change.
create table stock_movements (
  id          bigint generated always as identity primary key,
  business_id bigint not null,
  shop_id     bigint not null,
  book_id     bigint not null,
  delta       integer not null check (delta <> 0),
  reason      text not null check (reason in ('sale', 'sale_void', 'receipt', 'adjustment', 'opening', 'refund', 'exchange', 'transfer')),
  ref_type    text,
  ref_id      bigint,
  note        text not null default '',
  user_id     bigint references users(id),
  created_at  timestamptz not null default now(),
  foreign key (business_id, shop_id) references shops(business_id, id),
  foreign key (business_id, book_id) references books(business_id, id)
);
create index idx_movements_book on stock_movements(shop_id, book_id, created_at);

-- ---------------------------------------------------------------- phone orders
create table phone_orders (
  id                bigint generated always as identity primary key,
  business_id       bigint not null,
  shop_id           bigint not null,
  order_no          text not null,
  customer_name     text not null,
  customer_phone    text not null,
  delivery_type     text not null check (delivery_type in ('pickup', 'delivery')),
  delivery_address  text not null default '',
  promised_date     date,
  notes             text not null default '',
  status            text not null default 'placed' check (status in ('placed', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
  discount_bp       integer not null default 0 check (discount_bp between 0 and 10000),
  tax_bp            integer not null default 0 check (tax_bp >= 0),
  subtotal_cents    integer not null default 0,
  discount_cents    integer not null default 0,
  tax_cents         integer not null default 0,
  total_cents       integer not null default 0,
  sale_id           bigint,                     -- set when the order is billed (fulfilment)
  cancel_reason     text not null default '',
  created_by        bigint not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (shop_id, order_no),
  unique (business_id, id),
  check ((status = 'completed') = (sale_id is not null)),
  foreign key (business_id, shop_id) references shops(business_id, id)
);
create index idx_orders_shop_status on phone_orders(shop_id, status);

create table phone_order_items (
  id                bigint generated always as identity primary key,
  order_id          bigint not null references phone_orders(id) on delete cascade,
  book_id           bigint not null references books(id),
  title             text not null,
  quantity          integer not null check (quantity > 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  unique (order_id, book_id)
);

-- Signed ledger: positive = payment received, negative = refund.
create table order_payments (
  id            bigint generated always as identity primary key,
  order_id      bigint not null references phone_orders(id),
  amount_cents  integer not null check (amount_cents <> 0),
  method        text not null check (method in ('cash', 'card', 'upi', 'other')),
  note          text not null default '',
  user_id       bigint references users(id),
  created_at    timestamptz not null default now()
);
create index idx_order_payments_order on order_payments(order_id);

-- ---------------------------------------------------------------- sales
create table sales (
  id               bigint generated always as identity primary key,
  business_id      bigint not null,
  shop_id          bigint not null,
  bill_no          text not null,
  status           text not null default 'completed' check (status in ('completed', 'voided')),
  customer_name    text not null default '',
  payment_method   text not null check (payment_method in ('cash', 'card', 'upi', 'other')),
  subtotal_cents   integer not null check (subtotal_cents >= 0),
  discount_bp      integer not null default 0,
  discount_cents   integer not null default 0 check (discount_cents >= 0),
  tax_bp           integer not null default 0,
  tax_cents        integer not null default 0 check (tax_cents >= 0),
  total_cents      integer not null check (total_cents >= 0),
  order_id         bigint unique references phone_orders(id),   -- one bill per phone order, ever
  idempotency_key  text,
  user_id          bigint not null references users(id),
  void_reason      text not null default '',
  voided_by        bigint references users(id),
  voided_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (shop_id, bill_no),
  unique (shop_id, idempotency_key),
  unique (business_id, id),
  foreign key (business_id, shop_id) references shops(business_id, id)
);
create index idx_sales_shop_created on sales(shop_id, created_at);
create index idx_sales_business_created on sales(business_id, created_at);

alter table phone_orders add constraint fk_phone_orders_sale foreign key (sale_id) references sales(id);

-- Snapshot of what was sold: title / price / cost frozen at the time of sale.
create table sale_items (
  id                bigint generated always as identity primary key,
  sale_id           bigint not null references sales(id) on delete cascade,
  book_id           bigint not null references books(id),
  title             text not null,
  author            text not null default '',
  isbn              text,
  edition           text not null default '',
  quantity          integer not null check (quantity > 0),
  returned_qty      integer not null default 0 check (returned_qty >= 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  unit_cost_cents   integer not null default 0 check (unit_cost_cents >= 0),
  line_total_cents  integer not null check (line_total_cents >= 0),
  unique (sale_id, book_id),
  check (returned_qty <= quantity)
);
create index idx_sale_items_book on sale_items(book_id);

create table sale_returns (
  id                   bigint generated always as identity primary key,
  business_id          bigint not null,
  shop_id              bigint not null,
  sale_id              bigint not null references sales(id) on delete cascade,
  sale_item_id         bigint not null references sale_items(id) on delete cascade,
  book_id              bigint not null references books(id),
  type                 text not null check (type in ('refund', 'exchange')),
  quantity             integer not null check (quantity > 0),
  amount_cents         integer not null default 0,
  replacement_book_id  bigint references books(id),
  reason               text not null default '',
  user_id              bigint references users(id),
  created_at           timestamptz not null default now(),
  foreign key (business_id, shop_id) references shops(business_id, id)
);
create index idx_sale_returns_sale on sale_returns(sale_id);
create index idx_sale_returns_shop on sale_returns(shop_id, created_at);

-- ---------------------------------------------------------------- suppliers & purchasing
create table suppliers (
  id              bigint generated always as identity primary key,
  business_id     bigint not null references businesses(id) on delete cascade,
  name            text not null,
  contact_person  text not null default '',
  phone           text not null default '',
  email           text not null default '',
  address         text not null default '',
  categories      text not null default '',
  lead_time_days  integer not null default 7 check (lead_time_days >= 0),
  notes           text not null default '',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (business_id, id)
);
create unique index uq_suppliers_name on suppliers(business_id, lower(name));

-- Which supplier quotes which title at what cost (business-wide).
create table supplier_books (
  business_id      bigint not null,
  supplier_id      bigint not null,
  book_id          bigint not null,
  unit_cost_cents  integer not null check (unit_cost_cents >= 0),
  updated_at       timestamptz not null default now(),
  primary key (supplier_id, book_id),
  foreign key (business_id, supplier_id) references suppliers(business_id, id) on delete cascade,
  foreign key (business_id, book_id) references books(business_id, id) on delete cascade
);
create index idx_supplier_books_book on supplier_books(book_id);

create table purchase_orders (
  id             bigint generated always as identity primary key,
  business_id    bigint not null,
  shop_id        bigint not null,
  po_no          text not null,
  supplier_id    bigint not null,
  status         text not null default 'ordered' check (status in ('ordered', 'partially_received', 'received', 'cancelled')),
  notes          text not null default '',
  expected_date  date,
  created_by     bigint not null references users(id),
  created_at     timestamptz not null default now(),
  unique (shop_id, po_no),
  foreign key (business_id, shop_id) references shops(business_id, id),
  foreign key (business_id, supplier_id) references suppliers(business_id, id)
);
create index idx_po_shop_status on purchase_orders(shop_id, status);

create table purchase_order_items (
  id               bigint generated always as identity primary key,
  po_id            bigint not null references purchase_orders(id) on delete cascade,
  book_id          bigint not null references books(id),
  qty_ordered      integer not null check (qty_ordered > 0),
  qty_received     integer not null default 0 check (qty_received >= 0),
  unit_cost_cents  integer not null check (unit_cost_cents >= 0),
  unique (po_id, book_id),
  check (qty_received <= qty_ordered)
);

create table goods_receipts (
  id               bigint generated always as identity primary key,
  business_id      bigint not null,
  shop_id          bigint not null,
  po_id            bigint not null references purchase_orders(id),
  supplier_id      bigint not null references suppliers(id),
  total_cents      integer not null default 0 check (total_cents >= 0),
  note             text not null default '',
  idempotency_key  text,
  user_id          bigint not null references users(id),
  received_at      timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  foreign key (business_id, shop_id) references shops(business_id, id)
);
create index idx_receipts_shop_date on goods_receipts(shop_id, received_at);

create table goods_receipt_items (
  id               bigint generated always as identity primary key,
  receipt_id       bigint not null references goods_receipts(id) on delete cascade,
  po_item_id       bigint not null references purchase_order_items(id),
  book_id          bigint not null references books(id),
  quantity         integer not null check (quantity > 0),
  unit_cost_cents  integer not null check (unit_cost_cents >= 0)
);

-- ---------------------------------------------------------------- expenses
create table expenses (
  id            bigint generated always as identity primary key,
  business_id   bigint not null,
  shop_id       bigint not null,
  expense_date  date not null,
  category      text not null,
  description   text not null default '',
  amount_cents  integer not null check (amount_cents > 0),
  user_id       bigint not null references users(id),
  created_at    timestamptz not null default now(),
  foreign key (business_id, shop_id) references shops(business_id, id)
);
create index idx_expenses_shop_date on expenses(shop_id, expense_date);

-- ---------------------------------------------------------------- lock everything down for the public API keys
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','business_settings','shops','users','user_shops','sessions','shop_counters','catalog_books','books',
    'shop_stock','stock_movements','phone_orders','phone_order_items','order_payments','sales','sale_items',
    'sale_returns','suppliers','supplier_books','purchase_orders','purchase_order_items','goods_receipts',
    'goods_receipt_items','expenses']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
