# Architecture

```
frontend/ (React SPA, built to dist/)  --HTTP/JSON-->  backend/src/app.js (routes, auth, errors)
                                                            |
                                                    backend/src/services/*  (all business rules, transactions)
                                                            |
                                                    SQLite (backend/data/bookshop.db, migrations in src/db/migrations)
```

## Backend layout

| Path | Purpose |
|---|---|
| `src/app.js` | Express app: security headers, CSRF header check, session auth, role guards, routes, error mapping, serves `frontend/dist` |
| `src/services/` | `books`, `inventory`, `sales`, `orders`, `suppliers`, `purchasing`, `restock`, `dashboard`, `expenses`, `users`, `settings` |
| `src/lib/` | `validate` (input checks, ISBN), `money` (percent/bp and the single bill-arithmetic function), `dates`, `errors` |
| `src/db/` | connection and `tx()` helper, migration runner, `migrations/*.sql`, demo seed |
| `test/` | node:test suites (auth, catalogue, billing, orders, purchasing, reports) |
| `e2e/smoke.js` | 10-second headless-browser smoke test (puppeteer-core) |

Routes contain no business logic; they validate the session/role and call one service function. Billing and phone-order fulfilment both call `recordSale`,
so totals, snapshots and stock rules live in exactly one place.

## Frontend layout

React 18 + React Router (hash routes) + Tailwind CSS 3, built with Vite. In development Vite serves the app on :5173 and proxies `/api` to the API on :3000.
In production the API serves the built `frontend/dist` itself (one origin, so the session cookie stays same-site).

| Path | Purpose |
|---|---|
| `src/App.jsx` | sidebar + header shell and route table; owner-only pages are not routed at all for staff |
| `src/pages/` | one file per screen: Billing, Bills, Catalogue, Inventory, Orders, Restock, Suppliers, Purchases, Dashboard, Expenses, Settings, Receipt, Login |
| `src/lib/` | `api.js` (fetch wrapper), `ui.jsx` (Modal, Button, BookPicker, Badge...), `overlays.jsx` (toasts, confirm), `auth.jsx`, `format.js`, `hooks.js` |
| `tailwind.config.js`, `src/index.css` | design tokens and shared component classes |

Design ("Editorial Artisanal"): warm off-white paper with charcoal ink; accents taken from physical materials (sage, terracotta, slate); Playfair Display for headlines and
book titles, Inter (tabular numerals) for all data; fine 1px rules separate sections instead of boxes; tables are ruled ledgers; a faint SVG grain overlays the page.
No glass, blur or neon. Fonts are bundled (no external requests). React escapes all rendered text, so catalogue data cannot inject markup.

- **Book covers** (`lib/cover.jsx`): there is no cover art in the data, so each book gets a stable generated cover (colour and layout derived from title and author) drawn as a physical
  object, with spine shading, a page-edge highlight and a layered contact shadow. Swapping in real cover images later means changing only this component.
- **Motion** (`lib/motion.jsx`, Framer Motion): slow fades with a few pixels of drift, staggered list loads, and the dashboard sales line that draws itself. No springs or bounce, and
  `MotionConfig reducedMotion="user"` disables movement for people who request reduced motion.

## Data integrity decisions

- Money is integer minor units; percentages are basis points; the only bill arithmetic is `computeTotals`.
- Every write path runs inside `db.transaction(...).immediate()` (SQLite `BEGIN IMMEDIATE`), so concurrent writers, even from separate processes, are serialised and any thrown error rolls back all of it.
- Stock changes go through `applyStock` (guarded UPDATE + `stock_movements` ledger) with `CHECK` constraints as the last line of defence.
- Uniqueness constraints carry the business rules: ISBN, `sales.order_id` (one bill per order), `sales.idempotency_key`, `goods_receipts.idempotency_key`.
- Sales, receipts and orders never delete history; reversals are new records (void, refund, adjustment).

## Security

Passwords are bcrypt-hashed; sessions are random 256-bit tokens stored hashed, sent in an `HttpOnly; SameSite=Strict` cookie. Mutating requests must carry `X-Requested-With`.
All SQL is parameterised; LIKE wildcards are escaped. A CSP restricts scripts to the app's own origin.
Supplier prices, cost, purchasing, dashboard and expenses are guarded by an owner check on the server and cost fields are omitted from staff responses.

## Key workflows

**Sale:** validate -> (idempotency check) -> load books, check available = stock - reserved -> `recordSale` (bill, snapshot items, deduct stock, ledger) -> commit.

**Phone order:** place (reserve) -> ready -> [out for delivery] -> fulfil: collect any balance, create the bill, deduct stock and release the reservation, mark completed. One transaction.

**Purchasing:** create PO (cost defaults to supplier quote) -> receive (per-line quantities <= outstanding) -> stock up, weighted-average cost, supplier price updated, PO status updated.
