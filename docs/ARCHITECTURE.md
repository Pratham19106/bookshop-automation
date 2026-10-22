# Architecture

```
frontend/ (static files)  --HTTP/JSON-->  backend/src/app.js (routes, auth, errors)
                                              |
                                      backend/src/services/*  (all business rules, transactions)
                                              |
                                      SQLite (backend/data/bookshop.db, migrations in src/db/migrations)
```

## Backend layout

| Path | Purpose |
|---|---|
| `src/app.js` | Express app: security headers, CSRF header check, session auth, role guards, routes, error mapping |
| `src/services/` | `books`, `inventory`, `sales`, `orders`, `suppliers`, `purchasing`, `restock`, `dashboard`, `expenses`, `users`, `settings` |
| `src/lib/` | `validate` (input checks, ISBN), `money` (percent/bp and the single bill-arithmetic function), `dates`, `errors` |
| `src/db/` | connection and `tx()` helper, migration runner, `migrations/*.sql`, demo seed |
| `test/` | node:test suites (auth, catalogue, billing, orders, purchasing, reports) |
| `e2e/ui.e2e.js` | puppeteer-core browser test |

Routes contain no business logic; they validate the session/role and call one service function. Billing and phone-order fulfilment both call `recordSale`,
so totals, snapshots and stock rules live in exactly one place.

## Data integrity decisions

- Money is integer minor units; percentages are basis points; the only bill arithmetic is `computeTotals`.
- Every write path runs inside `db.transaction(...).immediate()` (SQLite `BEGIN IMMEDIATE`), so concurrent writers, even from separate processes, are serialised and any thrown error rolls back all of it.
- Stock changes go through `applyStock` (guarded UPDATE + `stock_movements` ledger) with `CHECK` constraints as the last line of defence.
- Uniqueness constraints carry the business rules: ISBN, `sales.order_id` (one bill per order), `sales.idempotency_key`, `goods_receipts.idempotency_key`.
- Sales, receipts and orders never delete history; reversals are new records (void, refund, adjustment).

## Security

Passwords are bcrypt-hashed; sessions are random 256-bit tokens stored hashed, sent in an `HttpOnly; SameSite=Strict` cookie. Mutating requests must carry `X-Requested-With`.
All SQL is parameterised; LIKE wildcards are escaped. The frontend builds HTML through an escaping template tag, so catalogue data cannot inject markup. A CSP restricts scripts to the app's own origin.
Supplier prices, cost, purchasing, dashboard and expenses are guarded by an owner check on the server and cost fields are omitted from staff responses.

## Key workflows

**Sale:** validate -> (idempotency check) -> load books, check available = stock - reserved -> `recordSale` (bill, snapshot items, deduct stock, ledger) -> commit.

**Phone order:** place (reserve) -> ready -> [out for delivery] -> fulfil: collect any balance, create the bill, deduct stock and release the reservation, mark completed. One transaction.

**Purchasing:** create PO (cost defaults to supplier quote) -> receive (per-line quantities <= outstanding) -> stock up, weighted-average cost, supplier price updated, PO status updated.
