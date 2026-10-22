# Bookshop Automation System

An integrated system for running a single physical bookshop: catalogue and shelf locations, point-of-sale billing,
inventory, rule-based restocking recommendations, suppliers and purchasing, a sales/expenses dashboard, and phone-in orders.

- **backend/** – Node.js + Express REST API, SQLite (better-sqlite3), all business rules, migrations, tests
- **frontend/** – React + Tailwind CSS single-page app (Vite), "Utilitarian Archivist" design: paper and ink palette, serif headings, monospace figures, hard 1px borders, ledger-style tables
- **docs/** – requirements checklist, architecture, operations guide

## Quick start

Requires Node.js 20 or newer. Run from the project root.

```
npm install        # root tools (concurrently)
npm run setup      # install backend + frontend dependencies (once)
npm run seed       # optional: load demo data (about 60 days of sales, suppliers, orders)
npm run dev        # API on :3000 and web app on :5173  ->  open http://localhost:5173
```

Production-style run (one process, one port; builds the frontend and serves it from the API):

```
npm start          # -> http://localhost:3000
```

Demo logins (created by `npm run seed`, **demo only**):

| Role  | Username | Password     |
|-------|----------|--------------|
| Owner | `owner`  | `owner12345` |
| Staff | `staff`  | `staff12345` |

For a real shop skip the seed and create your own owner instead:

```
npm --prefix backend run create-owner -- <username> <password> "Full Name"
```

Migrations are applied automatically on start (`npm --prefix backend run migrate` runs them on their own).

## Tests

| Command | What | Time |
|---|---|---|
| `npm test` | 70 backend tests: billing math, stock integrity, concurrency, phone-order lifecycle, purchasing, restocking, dashboard, permissions | ~3 s |
| `npm run test:ui` | UI smoke test in headless Chrome/Edge: sign in, open all 11 pages, one sale, one phone order, staff restrictions (builds the frontend first) | ~10 s |

Set `CHROME_PATH` if Chrome/Edge is not found automatically. Output is one dot per passing test; a failure prints the reason.

## Other commands

| Command | What it does |
|---|---|
| `npm run build` | build the frontend into `frontend/dist` |
| `npm --prefix backend run backup` | consistent online backup of the database |

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | API port |
| `DB_PATH` | `backend/data/bookshop.db` | SQLite file |
| `TZ_OFFSET_MINUTES` | server local offset | shop's offset from UTC, used to bucket sales into local days |
| `SESSION_HOURS` | 12 | login session length |
| `COOKIE_SECURE` | unset | set to `1` when served over HTTPS |

Shop name, tax rate, staff discount limit, low-stock default and restocking parameters are edited in the app under Settings (owner).

## Roles

- **Owner**: everything, including suppliers and their prices, purchasing, restocking, dashboard, expenses, stock corrections, voiding bills, users and settings.
- **Staff**: catalogue (add/edit, no cost data), billing, bills, inventory view, phone orders. Staff discounts are capped by a setting. Enforced on the server, not just hidden in the UI.

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md).
