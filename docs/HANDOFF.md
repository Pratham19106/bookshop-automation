# Handoff: Bookshop Automation, multi-shop rebuild on Supabase

Written for the next coding agent (Codex) taking over this project mid-stream. It covers everything done in the
previous session, the decisions behind it, what is verified, and what is still open. Read it fully before changing code.

- Project root: `D:\SE Project\bookshop-automation` (the git repository root; `D:\SE Project` is the outer folder).
- Date of handoff: 2026-11-18.

---

## 0. Ground rules (from the user, still in force)

1. **Never run `git` or `gh` commands** of any kind. The user commits and pushes themselves.
2. **Do not touch the old production database or the currently deployed site.** A *new* Supabase project was created
   for this rebuild. `backend/.env` points at it.
3. **Secrets:**
   - `backend/.env` holds the new database password. It is git-ignored.
   - Never print it, echo it, or put it in docs, commits or URLs. Mask it if you must show a connection string.
4. **Plan before implementing** anything non-trivial. The user likes to see a plan first.
5. A knowledge graph exists at `D:\SE Project\graphify-out`:
   - `D:\SE Project\CLAUDE.md` asks to use `graphify query "<question>"` for orientation.
   - Run `graphify update .` from `D:\SE Project` after code changes. It is AST-only and costs nothing.
6. **Deleting files was blocked** for the previous agent. Three files are waiting for the user to delete (section 9).
   Do not try to work around that.
7. Reply to the user briefly and plainly. The user dislikes "AI-looking" fluff in the UI (see section 6.2).

---

## 1. What the project is

A bookshop management system, built as a university Software Engineering project:
- **Backend:** Node 22 + Express 5.
- **Frontend:** React 19 + Vite + Tailwind + Framer Motion.
- **Database:** Postgres on Supabase.

The mentor's feedback was that the original app was too simple, manual and single-tenant. The user's long-term vision:
- Automatic shelf assignment, and modelling the physical shop layout (aisles, racks, shelves).
- A multi-shop business: one owner, several shops; the owner watches sales from a phone (mobile web).
- A granular dashboard with monthly reports.
- A **Manager** role between Owner and Staff, handling suppliers and purchasing.
- A seeded, indexed, shared ISBN catalogue, so shops pick titles instead of typing them.
- Keep returns and exchanges.

The mentor's explicit checklist (the latest request, all addressed in section 6):
1. Make the UI dynamic and realtime.
2. Remove the "AI stuff": live/API-ready badges, prefilled owner/staff details, etc.
3. Multiple bookshops plus date-range financial reports that look like a bill.
4. Deploy it.
5. Make sure everything works before the demo.
6. Implement exchange and return (it already existed; now polished).

---

## 2. Architecture now

```
Browser (React SPA, HashRouter)
   │  same origin: https://<site>.vercel.app
   │  /api/*  ──Vercel rewrite──>  https://<service>.onrender.com/api/*   (Express API on Render)
   │                                         │
   │  GET /api/events (Server-Sent Events) <─┤ in-process hub publishes after each successful write
   │                                         │
   │                                   Supabase Postgres (pg Pool; RLS on every table, no policies)
```

- The browser never talks to Supabase directly. It has **no Supabase keys**.
- RLS is enabled with no policies, so the anon and publishable keys can read and write nothing. The API connects with
  the database password and bypasses RLS.
- **Sessions** are custom: bcrypt passwords, a random 256-bit token stored hashed, and an `HttpOnly; SameSite=Strict`
  cookie `sid`. The user chose these over Supabase Auth.
- **CSRF:** mutating requests must send the header `X-Requested-With: bookshop`.
- **Active shop:** every request sends `X-Shop-Id`. The server builds
  `req.ctx = { db, user, businessId, shopIds, shopId, tz }`.
  - `shopId` must be one of the user's active shops.
  - A foreign shop makes `shopId = null`, and `requireShop` then returns 403.
- **Roles:** `owner > manager > staff` (`backend/src/lib/tenant.js`: `atLeast`, `canSeeCost`, `checkDiscount`,
  `requireShop`).
  - Discount ceilings: staff 10%, manager 25% (both set in business settings); the owner is unlimited.
  - Staff never see cost prices.
- **Money** is stored as integer minor units (paise); percentages as basis points. The only bill arithmetic is
  `lib/money.js computeTotals`.

---

## 3. Phase 1 (done earlier in the session): SQLite removed, multi-tenant on Supabase

### 3.1 Decisions (user answers)
- Keep Express and use Postgres through `pg`, not Supabase JS.
- Keep the custom sessions.
- Build the catalogue from `D:\SE Project\open4goods-isbn-dataset.csv` (1.3 GB, about 7.76M rows) with only the
  needed columns, and **import only 10,000 books for now** (about 280k qualify).
- Add the Manager role now.

### 3.2 Database schema: `supabase/migrations/0001_core.sql`
- **Tenancy and access:**
  - `businesses`
  - `business_settings`: currency_symbol, tax_bp, staff/manager_max_discount_bp, default_low_stock_threshold,
    restock_* parameters, return_window_days (default 7)
  - `shops`: code unique per business; a partial unique index allows one HQ per business
  - `users`: role in owner/manager/staff; unique `lower(username)` across all businesses
  - `user_shops`, `sessions`
  - `shop_counters`: (shop_id, kind in bill/order/po), giving numbers like `INV-S01-000042`, `TEL-S01-00001`,
    `PO-S02-00001`
- **Catalogue and titles:**
  - `catalog_books`: global, isbn PK, title, publisher, format, pages, category, subcategory, ref_price_cents; a
    `pg_trgm` GIN index on `lower(title)` in the `extensions` schema
  - `books`: per business; unique (business_id, isbn); author optional
- **Stock** (per shop):
  - `shop_stock`: PK (shop_id, book_id); stock_qty, reserved_qty, cost_cents (weighted average),
    low_stock_threshold, aisle/rack/shelf
  - `stock_movements`: the ledger
- **Sales and phone orders:**
  - `phone_orders`, `phone_order_items`, `order_payments`
  - `sales`: unique (shop_id, bill_no), (shop_id, idempotency_key), order_id
  - `sale_items` (with returned_qty), `sale_returns`
- **Purchasing:** `suppliers`, `supplier_books`, `purchase_orders`, `purchase_order_items`, `goods_receipts`,
  `goods_receipt_items`
- **Other:** `expenses`
- **Cross-tenant guard:** composite FKs `(business_id, shop_id) → shops(business_id, id)` and
  `(business_id, book_id) → books(business_id, id)` make cross-tenant rows impossible.
- **Lock-down:** the final DO block enables RLS on every table.

### 3.3 Data layer: `backend/src/db/`
- **`index.js`:** `createDb({ connectionString, schema, max, ssl })` returns
  `{ query, many, one, run, tx, pool, schema, close }`.
  - `tx(async q => …)` wraps BEGIN/COMMIT/ROLLBACK.
  - Type parsers: int8/numeric → Number, timestamptz → ISO string, date → `'YYYY-MM-DD'`.
  - **Changed in this session; see 6.7.**
- **`migrate.js`:** applies `supabase/migrations/NNNN_*.sql` in order, one transaction each, and records them in
  `schema_migrations`. Now refuses to run if test isolation is not in effect (6.7).
- **CLIs:** `migrate-cli.js`, `seed-cli.js`.
- **`seed.js`:** the demo business "Pratham Books".
  - Shops: **S01** "Pratham Books - Dadar (HQ)" (Mumbai) and **S02** "Pratham Books - FC Road" (Pune).
  - 38 hand-picked titles plus 20 from the catalogue, 5 suppliers, 60 days of sales in both shops, expenses,
    purchase orders and phone orders.
  - `--force` truncates tenant data and keeps the catalogue.

### 3.4 Services: `backend/src/services/*`
All services are async `fn(ctx, …)`, and every query is scoped by business and/or shop.
- **inventory:** `applyStock` is a guarded UPDATE (`stock+d >= reserved+r`) plus a ledger row.
- **sales, orders, purchasing:** `SELECT … FOR UPDATE` on the record being changed; stock rows are touched in
  book-id order to avoid deadlocks.
- **Bill numbers:** come from `lib/counters.js`.
- **Idempotency:** a race on the idempotency key (23505) returns the original sale.

| Service | Contents |
|---|---|
| books | search, get, genres, create, createFromCatalog, update, setActive, setLocation, batchAssignLocation |
| catalog | search (exact ISBN, ISBN prefix, or every word ILIKE), getByIsbn, categories |
| sales | createSale, listSales (`shop=all` for owner), voidSale (owner), refundItem, exchangeItem |
| orders | phone-order lifecycle |
| purchasing | POs per shop; receive updates the weighted-average cost |
| suppliers, restock, expenses, settings | — |
| dashboard | `dashboard`, `salesReport`, and now `statement` |
| users | auth, people, shops, registerBusiness |

### 3.5 Catalogue import: `backend/scripts/import-catalog.js`
- Streams the CSV with csv-parse.
- **Filters:**
  - ISBN prefix 9780 / 9781 / 97881 / 97893;
  - must have both a publisher and a category;
  - ISBN-13 checksum must be valid;
  - French Decitre categories are mapped to English.
- **Selection:** round-robins across categories (at most 150 per category, Indian ISBNs first), limit 10,000.
- Upserts in batches of 2,000.
- Flags: `--file`, `--limit`, `--per-category`, `--dry-run`.

### 3.6 Frontend changes in Phase 1
- **New libraries:**
  - `src/lib/shop.jsx`: `ShopProvider` and `useShop()`; the shop switcher shows when a user has more than one shop.
  - `src/lib/events.js`: in-browser activity bus.
- **`src/lib/api.js`:** sends `X-Shop-Id`; the active shop is stored in localStorage under `bk_active_shop`.
- **`src/lib/auth.jsx`:** role helpers `isOwner`, `isManager`, `maxDiscountPercent`.
- **`App.jsx`:** pages gated with `min: 'manager'`; `<main key={currentShop.id}>` remounts pages when the shop changes.
- **Pages:**
  - Settings rewritten: shops, people with roles and shop assignment, business rules.
  - Catalogue has `CatalogLookup` (ISBN catalogue search pre-fills the Add-book form).
- **Removed:** all Supabase JS, the franchise code, and hard-coded production keys.
- **Old material** was moved to `archive/`.

### 3.7 Phase 1 against the new Supabase project (verified)
- Migration applied; RLS confirmed on all tables with 0 policies. The publishable key gets `[]` from the REST API.
- Catalogue import: **10,000 titles**, 127 categories (about 2 minutes to scan the CSV).
- Seed loaded.

**Demo logins** (demo only):

| Username | Password | Role and shops |
|---|---|---|
| `owner` | `owner12345` | owner, both shops |
| `Pratham19106` | `Password123` | owner, both shops |
| `manager` | `manager12345` | manager, S01 + S02 |
| `staff` | `staff12345` | staff, S01 |
| `worker` | `Worker123` | staff, S01 |
| `punestaff` | `staff12345` | staff, S02 |

**Note:** the user has since used the app themselves as `Pratham19106`. There is a real sale `INV-S02-000237` and a
refund on `INV-S02-000236` ("not wanted"). That is the user's own activity, not leaked test data. Leave it.

---

## 4. TanStack Query caching (first request after Phase 1)

The user asked for caching on pages that don't need to be realtime (Catalogue, Bills), so they don't reload on every
visit and refresh only when, for example, a new bill is added. `@tanstack/react-query` was already in
`frontend/package.json`.
- **`src/lib/queryClient.js`:**
  - one `QueryClient` with `staleTime: Infinity` and no refetch on focus or reconnect;
  - a `STALE` map from activity events to query-key groups;
  - subscribes to the activity bus and calls `invalidateQueries({queryKey:[group]})`.
- **`src/lib/hooks.js`:** `useCached(key, fn, {enabled})`.
  - It has the same shape as the older `useLoad`: `{data, error, loading, reload}`.
  - The real key is `[group, activeShopId, ...rest]`, so shops never share cached data.
  - `reload()` invalidates the whole group.
  - Uses `placeholderData: keepPreviousData`.
- **`main.jsx`:** wraps the app in `QueryClientProvider`.
- **`auth.jsx`:** clears the cache on logout and on session expiry.
- This was later extended to almost every page and driven by server events (6.1).

---

## 5. Run results so far

| Check | Result |
|---|---|
| Backend tests (`npm test` in `backend/`) | **All pass against Supabase** after the latest changes (157 tests, exit 0) |
| UI smoke test (`node e2e/smoke.js` in `backend/`, needs a built frontend) | **12/12 pass** against Supabase |
| `prod-check` against a local server on port 3311 | all 8 checks pass |
| Frontend build (`npm run build` in `frontend/`) | succeeds |

Timing: each test file builds its own schema on the remote Supabase database, so every `setup()` takes 11–15 s. The
whole suite takes several minutes.

---

## 6. Mentor checklist: what was implemented (latest work)

The approved plan is at `C:\Users\Pratham\.claude\plans\temporal-moseying-brook.md`. Its order of work was: fluff
removal → realtime → statement → tests → deploy config.

### 6.1 Realtime across devices (Server-Sent Events)

**Backend**
- **`backend/src/lib/hub.js` (new):**
  - `createHub()` returns `{subscribe, publish, size}`. It is **per app instance**, not a module singleton, because
    tests run several apps in one process and every test schema's first business has id 1.
  - `eventsFor(method, path)` maps routes to events:

| Route | Events |
|---|---|
| `POST /sales` | `sale` |
| `/sales/:id/refund` and `/sales/:id/exchange` | `return` |
| `/sales/:id/void` | `void` |
| `POST /orders/:id/fulfil` | `sale` + `orders` |
| other `/orders*` | `orders` |
| `POST /purchase-orders/:id/receive` | `stock` + `purchasing` |
| other `/purchase-orders*` | `purchasing` |
| `/books*`, `/inventory*` | `books` |
| `/suppliers*` | `suppliers` |
| `/expenses*` | `expenses` |
| `/shops`, `/users`, `/settings` | `admin` |

- **`backend/src/app.js`:**
  - `createApp(db, {…, heartbeatMs = 20000})` creates `app.locals.hub`.
  - **Publish middleware**, after the auth/ctx middleware:
    - for non-GET requests it wraps `res.json` to capture the body, and on `finish` with status < 400 publishes
      `{event, businessId, shopId, by, at}`;
    - shop-scoped events (sale, return, void, orders, stock, purchasing, expenses) use `body.shopId` if present (for
      example a refund on another shop's bill), else `ctx.shopId`;
    - business-wide events use `shopId: null`.
  - **`GET /api/events` (authed):**
    - SSE headers, including `X-Accel-Buffering: no`, `retry: 3000`, then a `ready` event;
    - forwards only events of the same business whose `shopId` is null or in `ctx.shopIds`;
    - `: ping` heartbeat; unsubscribes on `close`.
- **`backend/src/server.js`:**
  - with `MIGRATE_ON_START=1`, runs migrations before listening;
  - on shutdown, force-exits after 5 s, because open SSE streams keep connections alive.

**Frontend**
- **`src/lib/realtime.js` (new):**
  - `startRealtime()` opens `EventSource(`${API_BASE}/api/events`, {withCredentials:true})`;
  - each message → `emitLocal(event)`, which goes to this tab only; every tab has its own stream;
  - after every reconnect (a `ready` that is not the first), calls `queryClient.invalidateQueries()` to catch up;
  - `useLiveStatus()` reports `off | connecting | live | reconnecting`.
- **`src/lib/auth.jsx`:** starts realtime while a user is signed in. On an `admin` event it reloads the profile and
  settings (shops, roles, settings changed elsewhere).
- **`src/lib/events.js`:** gained `emitLocal`. `broadcastEvent` still does local + BroadcastChannel for actions
  started in this browser.
- **`src/lib/api.js`:** exports `API_BASE`.
- **`src/lib/queryClient.js`** groups:

| Event | Groups made stale |
|---|---|
| sale, return, void | bills, books, inventory, dashboard |
| orders | orders, books, inventory |
| books | books, catalog, inventory |
| stock | books, inventory, dashboard, purchasing |
| purchasing | purchasing, inventory, dashboard |
| suppliers | purchasing |
| expenses | expenses, dashboard |
| admin | admin |

- **Pages moved from `useLoad` to `useCached`:**

| Page | Query keys |
|---|---|
| Dashboard | `['dashboard','main',f]`, shops `['admin','shops']` |
| Inventory | `['inventory','list',…]` |
| Restock | `['inventory','restock',…]` |
| Orders | list and detail under `orders` |
| Purchases | list and PO detail under `purchasing` (PoForm's supplier and quote loaders are still `useLoad`) |
| Suppliers | list and detail under `purchasing` |
| Expenses | `['expenses',range]` |
| SalesReport | `dashboard` group |
| Shelves | `['books','shelves']` |
| Catalogue and Bills | done in section 4 |

  Still `useLoad` on purpose: Receipt, Settings, and the form loaders.
- **Billing:** subscribes to sale/return/void/orders/books/stock events and re-fetches the cart's books (debounced
  300 ms), so "Only N in stock" is current.
- **`App.jsx`:** shows a small "Reconnecting…" text in the header only while disconnected. There are no "LIVE"
  decorations, by user preference.
- **Orders:** completing a phone order (fulfil) calls `broadcastEvent('sale')`.
- **Purchases:** receive calls `broadcastEvent('stock')`.
- **Shelves:** location changes call `broadcastEvent('books')`.

**Tests:** `backend/test/realtime.test.js`. The helpers client gained `stream()`, which returns
`{status, events, waitFor(pred), close()}`. The file covers:
- the route→event mapping;
- 401 without a session;
- a sale in shop 1 reaches the owner and shop-1 staff, but not shop-2 staff or another business;
- a business-wide event reaches shop-2 staff with `shopId: null`, and failed writes publish nothing;
- a refund on a shop-2 bill made while the owner is working in shop 1 is published for shop 2.

### 6.2 "AI stuff" removed (user and mentor dislike it)
- **Login.jsx:** rewritten as a plain sign-in. No "Quick Credential Filler" buttons (they filled `Pratham19106`
  and `worker`), no "API Online" or "Till Ready" badges, no "Sign in to Terminal", no link to Platform Overview.
- **RegisterBusiness.jsx:** removed `prefillDemo` (fake chain data and phones) and the "Direct Setup" badge;
  wording made plain. Each shop now has a "Shop phone" input, because the bill prints it.
- **App.jsx:**
  - removed the "Platform Info" page, route and header link, and the Landing import;
  - signed-out users are redirected to `/login`;
  - the sidebar shows the business name; the "Multi-Store" tag is gone; the sign-out tooltip is plain.
- **Removed the numbered page badges** (`01 · POS Counter`, `02 · Catalogue`, `03 · Reservations`,
  `04 · Inventory Ledger`, `05 · Velocity Engine`, `06 · Restocking POs`, `06 · Supply Chain`,
  `07 · Financial Engine`), the "Realtime Engine", "Live Sales" and "Live Stock" ping dots, and "Top Velocity".
  Affected pages: Billing, Catalogue, Orders, Inventory, Restock, Purchases, Suppliers, Dashboard, Bills.
- **Billing.jsx:** removed the "Auto-Saved" chip, the "Barcode / ISBN Search" badge and "Multi-Customer Queue".
  Renamed "Parked Drafts" to "Parked bills", "Hold / Save Draft" to "Hold", and "Resume Draft →" to "Resume".
- **Shelves.jsx:**
  - deleted `LayoutWizardModal`, which was **fake**: it only showed a toast;
  - removed the "Physical Coordinates" badge and the Refresh button;
  - renamed "Shop Floor Blueprint" to "Shop floor", "Rack Elevation" to "Rack", "Active Target" to "Selected",
    "Target" to "Select", and "Rapid Ingestion & Placement Dock" to "Place books on the selected shelf";
  - unused imports cleaned up.
- **Help.jsx:** fully rewritten in plain language and corrected.
  - The old text described SQLite ("BEGIN IMMEDIATE") and wrong roles ("Owner only" for manager pages).
  - New sections: Billing; Bills, returns and exchanges; Phone orders; Catalogue; Inventory; Floor & shelves;
    Restocking; Suppliers; Purchases; Dashboard; Financial statement; Expenses; Settings.
- **PhysicalCashMemo.jsx** (the printed bill):
  - removed the hard-coded phone `040-6455 5452 / +91 98200 11111`, the fallback name and address, and the fake
    "DISTRIBUTORS : ALL TYPES OF BOOK & STATIONERY" line;
  - removed the "Address: Counter Sale / Direct Purchase" filler line;
  - removed the "Download PDF" button (Puppeteer has no Chrome on Render) and the "Standalone Tab" link;
  - the button is now "Print / Save PDF" (browser print);
  - the footer "goods once sold will not taken back" contradicted returns; it now says
    "Returns and exchanges within N days with this bill.";
  - a voided bill shows a VOID stamp and badge.
  - The bill header comes from **the bill's own shop**. `services/sales.js saleToApi` now returns `shopCode`,
    `shopAddress` (address + city), `shopPhone` and `returnWindowDays`.
- **Bills.jsx:**
  - the return badge uses the configured window instead of "7-Day";
  - refund and exchange reasons default to empty;
  - tooltips are plain;
  - the audit row shows "Refunded to customer: ₹X (incl. ₹Y tax)" and "By <name>" instead of "Terminal Staff".
- **Not deletable by the agent** (see section 9): `frontend/src/pages/Landing.jsx` is no longer imported anywhere.

### 6.3 Refund tax fix (returns and exchange)
- **Bug:** refunds returned only the discounted price, never the tax the customer paid.
- **Migration `supabase/migrations/0002_refund_tax.sql`:**
  - adds `sale_returns.tax_cents int not null default 0 check >= 0`;
  - adds index `sale_returns_shop_created_idx (shop_id, created_at)`.
  - **Already applied to the new Supabase project.**
- **`sales.refundItem`:** `amount = round(unit_price*(1-discount_bp/10000))*qty`, and
  `tax = round(amount*tax_bp/10000)`, stored in `tax_cents`. The sale API's returns include `taxCents` and
  `paidBackCents`.
- **`dashboard.salesTotals`:** the refund query also returns `tax` and `count`.
  - `taxCents` = sale tax − refunded tax.
  - `grossBilledCents` = gross − refund amount − refund tax.
  - New fields: `salesBeforeRefundsCents`, `billedCents`, `refundCount`, `refundTaxCents`.
- **RefundModal in Bills.jsx:** computes the same total, including tax.
- **New test** in `test/refund-exchange.test.js`: with 18% tax, 10% discount and 2 × ₹100, the bill is ₹212.40. A
  1-copy refund gives amount 9000, tax 1620, paid back 10620, and the dashboard net / tax / gross reflect it.
- Exchange rules are unchanged: same price exactly, replacement in stock, same shop, within the return window.

### 6.4 Financial statement (a date-range report like a bill)

**Backend** (`services/dashboard.js`):
- `statementColumn(ctx, shops, from, to)` reuses `summarise()`, so figures match the dashboard exactly, plus:
  - payments by method (sales `total_cents` by `payment_method`, minus refunds (amount + tax) by the original bill's
    method);
  - exchange count and units;
  - expenses by category.
- `statement(ctx, input)`:
  - when the scope has more than one shop, returns one column per shop (HQ first, then by code) plus `Total`;
  - otherwise one column;
  - includes `statementNo` (`STM-ALL-YYYYMMDD-YYYYMMDD` or `STM-S01-…`), business, shops, from/to, generatedAt,
    generatedBy, expenseCategories and paymentMethods.

| Column field | Meaning |
|---|---|
| bills, unitsSold | counts |
| grossSalesCents | at list price |
| discountCents, refundCount, refundCents | deductions |
| netSalesCents, taxCents, receivedCents | sales, tax, money in |
| exchangeCount, exchangeUnits | same-price swaps |
| payments{cash,card,upi,other} | money in by method |
| cogsCents, grossProfitCents, grossMarginPercent | profit |
| expenses{category}, expensesCents, operatingProfitCents | running costs |
| purchasesCents, unknownCostUnits | stock bought; books sold with no recorded cost |

- **Route:** `GET /api/reports/statement?from&to&outlet=all|<shopId>`, manager and above. Scope comes from
  `resolveScope`, so another shop gets 403. The max range is about 2 years.
- **Tests:** `backend/test/statement.test.js`:
  - per-shop columns plus total;
  - sales, refunds, exchanges, payments and expenses figures;
  - total = sum of the shop columns;
  - matches the dashboard;
  - a single shop gives a single column;
  - staff 403, foreign business 403 for our shop, and its own statement shows 0 bills;
  - from > to gives 400.

**Frontend:**
- **`src/pages/Statement.jsx` (new):** "Reports → Financial Statement", route `/statement`, manager and above.
  - Range presets: Today, This week, This month, Last month, plus custom from/to.
  - Shop select: "All my shops (one column each)" or one shop.
  - The paper uses the same red-ledger look as the bill: header with business, shop line, period, prepared time and
    statement number.
  - Sections: Sales; Received by payment method; Profit and loss (including each expense category); Stock bought.
  - Signatory footer; a note about books sold without a cost.
  - "Print / Save PDF" via `window.print()`.
- **`index.css`:** an `@media print` block (A4, 12 mm margins, `print-color-adjust: exact`).
- **SalesReport.jsx:** a "Financial statement" button in the header.

### 6.5 Deployment preparation (NOT deployed yet)
The user's setup: **backend on Render, frontend on Vercel**. The design: Vercel rewrites `/api/*` to Render, so the
site is a single origin. The cookie is `SameSite=Strict` and would not work cross-site, and with the rewrite there is
no CORS and SSE works.
- **`frontend/vercel.json` and the root `vercel.json`:** rewrite `/api/:path*` →
  `https://RENDER-SERVICE-NAME.onrender.com/api/:path*`, then the SPA fallback.
  **`RENDER-SERVICE-NAME` is a placeholder.** The user must give the real Render URL. Which `vercel.json` Vercel uses
  depends on the project's Root Directory (`frontend` is recommended).
- **`render.yaml`:** `rootDir: backend`, build `npm install`, start `npm start`, health `/health`, and env vars:
  - `DATABASE_URL` (sync false)
  - `MIGRATE_ON_START=1`
  - `TZ_OFFSET_MINUTES=330`
  - `COOKIE_SECURE=1`
  - `SESSION_HOURS=12`
- **`backend/scripts/prod-check.js` (new),** run as `npm --prefix backend run prod-check -- <site> <user> <pass>`.
  - Read-only checks: site loads, `/api/health` reports db ok, sign-in sets a cookie through the site (and it is
    Secure on https), shops, dashboard, statement, the SSE stream opens, sign out.
  - Verified against a local server.
- **Docs (new or updated):**
  - `docs/DEPLOY.md`: exact Render and Vercel settings; delete the old `VITE_SUPABASE_*` and `VITE_API_URL` on Vercel;
    the user pushes.
  - `docs/DEMO.md`: a 6-minute demo script.
  - `README.md`, `docs/ARCHITECTURE.md` (live-updates section), `docs/OPERATIONS.md` (deployment points to
    DEPLOY.md).
- `puppeteer-core` stays a backend dependency. The `/api/sales/:id/pdf` route still exists but will fail on Render
  (no Chrome). The UI no longer calls it.

### 6.6 UI smoke test extended: `backend/e2e/smoke.js` (12 checks)
1. The sign-in page is plain: no credentials or filler text, and the username is empty.
2. The owner signs in and sees dashboard figures.
3. Every page renders: billing, bills, orders, catalogue, inventory, shelves, restock, suppliers, purchases,
   dashboard, **statement**, sales-report, expenses, settings, **help**.
4. Catalogue search.
5. Billing sale.
6. Receipt.
7. Phone-order lifecycle.
8. Shop switching.
9. **Live:** `punestaff`, in a separate browser context, sells via fetch, and the owner's open Bills page shows the
   new `INV-S02-…` bill with no reload.
10. **Refund from the bill dialog:** stock +1, "Refunded to customer" appears, and the statement shows S01 / S02 /
    TOTAL with refunds.
11. Manager restrictions.
12. Staff restrictions.

Other details:
- The default timeout is 30 s when the database is remote (6 s locally).
- The waits look for no "Loading data" text anywhere.
- Button text matching is case-insensitive, because CSS uppercases some buttons.

### 6.7 Test-isolation bug found and fixed (important)
- **Before:** tests isolated themselves with `pg` Pool `options: -c search_path=<schema>,…`, a startup parameter.
- **Problem:** through Supabase's Supavisor session pooler, a reused server connection can arrive without that
  setting. A test could then run against the **real `public` tables**. Evidence: migration 0002 was applied to
  `public` by a test run before the user ran `migrate`.
- **No real data was damaged.** Checked: one business, the 6 seed users, seed data only. A leaked test sign-up would
  fail on the username "owner", which the seed already uses.
- **Fix in `backend/src/db/index.js`:**
  - when `schema` is set, every checkout runs `SET search_path TO "<schema>", public, extensions` before the first
    statement;
  - pool-level queries go through `checkout()`;
  - `close()` runs `RESET search_path` on pinned clients before `pool.end()`, so later sessions don't inherit it;
  - the schema name is validated (`^[a-z_][a-z0-9_]*$`).
- **`migrate.js`:** when `db.schema` is set, asserts `current_schema() === db.schema` and throws otherwise.
- **Verified:** 60 parallel statements all stayed in the test schema, and a normal pool afterwards reports `public`.
- Leftover `t_*` schemas from killed runs were dropped. There are none now.
- Scratch scripts used for this (not part of the project) are in the agent scratchpad: `migcheck.js`,
  `isocheck.js`, `dropleft.js`, `leak.js`.

---

## 7. Changed or new files in the latest round (quick index)

**Backend**
- `src/app.js`: hub, publish middleware, `/events`, `/reports/statement`, `heartbeatMs` option
- `src/lib/hub.js` (new)
- `src/server.js`: `MIGRATE_ON_START`, shutdown timeout
- `src/db/index.js`: isolation fix
- `src/db/migrate.js`: isolation guard
- `src/services/sales.js`: shop details and returnWindowDays on bills, refund tax, `taxCents` / `paidBackCents`
- `src/services/dashboard.js`: refund tax in totals, `statementColumn`, `statement`
- `scripts/prod-check.js` (new); `package.json` adds the `prod-check` script
- `test/helpers.js`: `stream()` client helper
- `test/realtime.test.js` (new), `test/statement.test.js` (new); `test/refund-exchange.test.js` gains the tax test
- `e2e/smoke.js`: 12 checks

**Database:** `supabase/migrations/0002_refund_tax.sql` (new)

**Frontend**
- **New:** `src/lib/realtime.js`, `src/pages/Statement.jsx`
- **Changed libraries:** `src/lib/queryClient.js`, `hooks.js` (`useCached`), `events.js` (`emitLocal`),
  `api.js` (export `API_BASE`), `auth.jsx` (realtime start, admin reload, cache clear)
- **`src/App.jsx`:** Statement page, no Landing, `/login` redirect, live status, business name
- **`src/main.jsx`:** QueryClientProvider
- **Rewritten:** `src/pages/Login.jsx`, `Help.jsx`
- **Changed pages:** `RegisterBusiness.jsx`, `Billing.jsx`, `Bills.jsx`, `Catalogue.jsx`, `Dashboard.jsx`,
  `Inventory.jsx`, `Orders.jsx`, `Purchases.jsx`, `Suppliers.jsx`, `Restock.jsx`, `Expenses.jsx`, `SalesReport.jsx`,
  `Shelves.jsx`
- **Other:** `src/components/PhysicalCashMemo.jsx`, `src/index.css` (print styles), `frontend/vercel.json`

**Root and docs**
- `vercel.json`, `render.yaml`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`
- New: `docs/DEPLOY.md`, `docs/DEMO.md`, and this file

---

## 8. How to run things (Windows, PowerShell)

From `D:\SE Project\bookshop-automation`:

| Command | What it does |
|---|---|
| `npm run dev` | API on :3000 and Vite on :5173 |
| `npm run migrate` | apply `supabase/migrations` to `DATABASE_URL` |
| `npm run seed -- --force` | **wipes business data** in the configured DB and reseeds the demo |
| `npm --prefix backend test` | full suite; slow on remote Supabase (about 12 s per test file setup) |
| `node --test --test-reporter=spec --test-timeout=240000 test/<file>.test.js` | one file, run from `backend/` |
| `node e2e/smoke.js` | UI smoke test, run from `backend/` after `npm run build` in `frontend/` |
| `npm --prefix backend run prod-check -- <url> owner owner12345` | read-only check of a deployed site |
| `graphify update .` | refresh the code graph, run from `D:\SE Project` |

Gotchas:
- Piping long node runs into `Select-Object -Last N` buffers all output until the end, so the run looks hung.
  Redirect to a file instead (`*> "$env:TEMP\x.txt"`) and read the file.
- `--test-timeout` also applies to the whole test file, so use about 240000+ against remote Supabase.
- Some source files have CRLF line endings: prefer exact-string edits over regex rewrites with `\n`.
- `backend/.env` holds `DATABASE_URL` (session pooler, port 5432) and an empty `TEST_DATABASE_URL`, which falls back
  to `DATABASE_URL`.
  - Tests create and drop `t_<hex>` schemas; the UI test uses `ui_<hex>`.
  - Tests must use port 5432, not the transaction pooler.

---

## 9. Open items / next steps

**Waiting on the user**
1. **The Render service URL:** replace `RENDER-SERVICE-NAME` in `frontend/vercel.json` and in the root `vercel.json`.
2. **Configure Render and Vercel** per `docs/DEPLOY.md`.
   - Render env: `DATABASE_URL` (new project, session pooler), `MIGRATE_ON_START=1`, `TZ_OFFSET_MINUTES=330`,
     `COOKIE_SECURE=1`, `SESSION_HOURS=12`; remove old Supabase variables.
   - Vercel: Root Directory `frontend`; delete `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
     `VITE_API_URL`.
3. **The user pushes the code.** Do not run git.
4. **Delete these unused files** (the agent was not permitted to):
   - `frontend/src/pages/Landing.jsx`: the old marketing page, not imported anymore.
   - `frontend/src/utils/supabase.ts`: has the old production Supabase URL and publishable key hard-coded; unused,
     and its package is no longer installed.
   - `frontend/.env`: the old production `VITE_SUPABASE_*` values; unused.

**After the deploy:** run `prod-check` against the live Vercel URL and walk through `docs/DEMO.md`. Reseed the day
before the demo so "today" and "this month" have data. Open the site about 10 minutes before the demo, because the
free Render service sleeps.

**Security follow-ups to remind the user about**
- The database password was pasted in chat earlier; suggest resetting it after the demo and updating `backend/.env`
  and Render.
- Check that the **old** production Supabase project also has RLS enabled.

**Later phases (roadmap, not started)**
- Automatic shelf assignment, and a real shop-floor model (aisles, racks and shelves as data, not free text). The fake
  wizard was removed, so this needs a proper design.
- A more granular, monthly dashboard (month-by-month comparisons, per-category). The statement already covers any date
  range.
- Mobile polish for the owner's phone view.
- Optional: enrich the catalogue with authors and descriptions from `BooksDatasetClean.csv` (open4goods has no
  author column); import more than 10k titles with `--limit`.
- If the API is ever scaled beyond one instance, change `lib/hub.js` to Postgres `LISTEN/NOTIFY`.

**Known limitations**
- The Billing cart and parked bills are stored per browser in localStorage, not per shop.
- `GET /api/sales/:id/pdf` (Puppeteer) won't work on Render; the UI uses browser print instead.
- Realtime events are per API process (fine for one Render instance).
