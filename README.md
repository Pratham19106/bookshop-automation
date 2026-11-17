# Bookshop Automation System

A multi-shop system for bookshop businesses: one owner, several shops, each with its own stock, bills, phone orders and
purchase orders, sharing one title list, price list and set of suppliers. Includes point-of-sale billing, returns and
exchanges, inventory with shelf locations, rule-based restocking, suppliers and purchasing, a per-shop and all-shops
dashboard, a printable date-range financial statement laid out like a bill (one column per shop plus a total), and a
shared ISBN catalogue (about 10,000 titles imported from the open4goods ISBN dataset) so titles are picked, not typed.

Screens update live: a bill, refund, phone order or delivery on one device refreshes the affected screens on every
other device of the business within a second (Server-Sent Events from the API; nothing is polled).

- **backend/**: Node.js + Express REST API on Supabase Postgres (`pg`), all business rules, tenant isolation, tests
- **frontend/**: React + Tailwind CSS + Framer Motion single-page app (Vite)
- **supabase/migrations/**: the database schema (applied by `npm run migrate`)
- **docs/**: requirements checklist, architecture, operations guide, basis-path testing report
- **archive/**: the retired SQLite database files and earlier schema drafts, kept for reference only

## Quick start

Requires Node.js 22+ and a Supabase project (free tier is enough). Run from the project root.

```
npm install                    # root tools (concurrently)
npm run setup                  # install backend + frontend dependencies (once)
cp backend/.env.example backend/.env   # then paste your Supabase connection string into DATABASE_URL
npm run migrate                # create the schema
npm run import-catalog         # load ~10,000 titles from ../open4goods-isbn-dataset.csv (about 2 minutes)
npm run seed                   # optional: demo business with 2 shops, 60 days of sales, suppliers, orders
npm run dev                    # API on :3000 and web app on :5173  ->  open http://localhost:5173
```

Production-style run (one process, one port; builds the frontend and serves it from the API): `npm start`.

Demo logins (created by `npm run seed`, **demo only**):

| Role | Username | Password | Shops |
|---|---|---|---|
| Owner | `owner` | `owner12345` | all |
| Manager | `manager` | `manager12345` | Dadar (S01), FC Road (S02) |
| Staff | `staff` | `staff12345` | Dadar (S01) |
| Staff | `punestaff` | `staff12345` | FC Road (S02) |

For a real business skip the seed and either register from the app's sign-up page or run
`npm --prefix backend run create-owner -- <username> <password> "Business Name"`.

## Roles

- **Owner**: everything in every shop: shops, people (roles and shop assignment), business settings, voiding bills, all reports.
- **Manager**: for the shops they are assigned to: titles and prices, stock counts, shelf locations, suppliers, purchase orders and
  receiving, restocking, expenses, dashboard and sales reports. Sees costs. Discount ceiling set by the owner.
- **Staff**: billing, bills, returns/exchanges, phone orders and stock look-up in their own shop. Never sees costs.

All of this is enforced on the server; the UI only hides what the server would refuse anyway.

## Tests

| Command | What |
|---|---|
| `npm test` | backend tests in throwaway Postgres schemas: billing maths, stock integrity, concurrency, tenant isolation, roles, phone orders, purchasing, restocking, returns and exchanges, dashboard, financial statement, live updates, basis-path suite |
| `npm run test:ui` | headless Chrome/Edge smoke test: every page, a sale, a phone order, shop switching, a sale on a second device appearing live, a refund from the bill screen, the statement, manager and staff limits |
| `npm --prefix backend run prod-check -- <site> <user> <password>` | read-only check of a deployed site |

Both need `TEST_DATABASE_URL` (or `DATABASE_URL`) in `backend/.env`, a session/direct connection (port 5432).

## Configuration (backend/.env)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (required) |
| `TEST_DATABASE_URL` | database for tests (defaults to `DATABASE_URL`) |
| `TZ_OFFSET_MINUTES` | shop's offset east of UTC in minutes (India = 330) |
| `SESSION_HOURS` | login session length (default 12) |
| `COOKIE_SECURE` | `1` when served over HTTPS |
| `CORS_ORIGINS` | only if the frontend is on a different origin |

Tax, discount ceilings, low-stock default, return window and restocking parameters are set in the app (Settings, owner).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/OPERATIONS.md](docs/OPERATIONS.md),
[docs/DEPLOY.md](docs/DEPLOY.md) (Render + Vercel) and [docs/DEMO.md](docs/DEMO.md) (demo script).
