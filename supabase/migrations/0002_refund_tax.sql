-- A refund hands back what the customer paid for the returned copies: the discounted price (amount_cents, which is
-- the revenue being reversed) plus the tax charged on it (tax_cents, reversing tax collected). Exchanges are zero.
alter table sale_returns add column if not exists tax_cents integer not null default 0 check (tax_cents >= 0);

-- Refund / exchange reporting by shop and date.
create index if not exists sale_returns_shop_created_idx on sale_returns (shop_id, created_at);
