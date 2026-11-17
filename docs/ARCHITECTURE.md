# Architecture

```
frontend/ (React SPA)  --HTTP/JSON + X-Shop-Id-->  backend/src/app.js (session auth, tenant context, role guards, routes)
                                                         |
                                                 backend/src/services/*  (business rules; every query scoped by business / shop)
                                                         |
                                                 Supabase Postgres (schema in supabase/migrations, RLS on, no public access)
```

## Live updates

After every successful change the API publishes a small event (`sale`, `return`, `orders`, `books`, `stock`, ...) to
`GET /api/events` (Server-Sent Events). Each browser keeps one stream open while signed in and receives only events of
its own business and shops. `frontend/src/lib/queryClient.js` maps each event to the cached screens it affects
(TanStack Query) and only those reload. After a reconnect everything is refreshed once. Mapping of routes to events:
`backend/src/lib/hub.js`.

## Tenancy model

- A **business** (one owner, or several) has **shops**. Each request carries `X-Shop-Id`; `app.js` builds
  `req.ctx = { db, user, businessId, shopIds, shopId, tz }` and refuses a shop the user may not use.
- Shared by all shops of a business: titles (`books`, with the selling price), suppliers and their quotes, settings.
- Per shop: stock (`shop_stock`: on hand, reserved, weighted-average cost, threshold, aisle/rack/shelf), stock ledger,
  bills, phone orders, purchase orders, goods receipts, expenses, and the running numbers (`INV-S01-000042`).
- Global and read-only: `catalog_books`, the ISBN reference catalogue used to add titles.
- Composite foreign keys `(business_id, shop_id)` / `(business_id, book_id)` make cross-tenant rows impossible even if code had a bug.

## Roles

`owner > manager > staff`. Owners see every shop; managers and staff only the shops in `user_shops`. Route guards in `app.js`
(`authed`, `role('manager')`, `role('owner')`); cost data is omitted for staff; discount ceilings per role in `lib/tenant.js`.

## Backend layout

| Path | Purpose |
|---|---|
| `src/app.js` | Express app: security headers, CSRF header check, session → tenant context, role guards, routes, Postgres error mapping |
| `src/services/` | `books`, `catalog`, `inventory`, `sales`, `orders`, `suppliers`, `purchasing`, `restock`, `dashboard`, `expenses`, `users` (auth, people, shops, sign-up), `settings`, `billPrinter` |
| `src/lib/` | `validate`, `money` (the single bill-arithmetic function), `dates`, `errors`, `tenant` (roles, discount ceilings), `counters` (per-shop numbering) |
| `src/db/` | `pg` pool + `tx()` helper, migration runner, demo seed |
| `scripts/` | `import-catalog`, `create-owner`, `backup` |
| `test/` | node:test suites, each in its own throwaway Postgres schema |
| `e2e/smoke.js` | headless-browser smoke test |

## Data integrity decisions

- Money is integer minor units; percentages are basis points; the only bill arithmetic is `computeTotals`.
- Every write path runs in one transaction (`db.tx`). Stock changes go through `applyStock`: a guarded `UPDATE ... WHERE stock + delta >= reserved`
  (atomic in Postgres, so concurrent sales can never oversell) plus a `stock_movements` ledger row; `CHECK` constraints are the last line of defence.
- Orders, bills and purchase orders being changed are locked with `SELECT ... FOR UPDATE`; stock rows are touched in book-id order to avoid deadlocks.
- Bill / order / PO numbers come from `shop_counters` (row-locked upsert), never `MAX(id)+1`.
- Uniqueness carries business rules: ISBN per business, one bill per phone order, idempotency keys per shop.
- Sales, receipts and orders never delete history; reversals are new records (void, refund, exchange, adjustment).

## Security

Passwords are bcrypt-hashed; sessions are random 256-bit tokens stored hashed, sent in an `HttpOnly; SameSite=Strict` cookie.
Mutating requests must carry `X-Requested-With`. All SQL is parameterised. The browser never talks to the database: the frontend
has no Supabase keys, and RLS without policies blocks the public API keys entirely.

## Key workflows

**Sale:** validate → idempotency check → load titles with this shop's stock, check available = stock − reserved → `recordSale`
(bill number, snapshot items, deduct stock, ledger) → commit.

**Phone order:** place (reserve in this shop) → ready → [out for delivery] → fulfil: collect any balance, create the bill, deduct
stock and release the reservation, mark completed. One transaction.

**Purchasing:** create PO for a shop (cost defaults to the supplier quote) → receive (≤ outstanding) → that shop's stock up,
weighted-average cost, supplier price updated, PO status updated.

**Adding a title:** search the ISBN catalogue → pick → title, publisher, format and category are copied; the manager sets the price and opening stock.
