# Bookshop Automation System

An integrated system for running a single physical bookshop: catalogue and shelf locations, point-of-sale billing,
inventory, rule-based restocking recommendations, suppliers and purchasing, a sales/expenses dashboard, and phone-in orders.

- **backend/** – Node.js + Express REST API, SQLite (via better-sqlite3), all business rules, migrations, tests
- **frontend/** – static single-page UI (plain JavaScript modules + CSS, no build step), served by the backend
- **docs/** – requirements checklist, architecture, operations guide

## Quick start

Requires Node.js 20 or newer.

```
npm run setup      # install backend dependencies (once)
npm run seed       # optional: load demo data (about 60 days of sales, suppliers, orders)
npm run dev        # start the app with auto-restart  ->  http://localhost:3000
```

Demo logins (created by `npm run seed`, **demo only**):

| Role  | Username | Password     |
|-------|----------|--------------|
| Owner | `owner`  | `owner12345` |
| Staff | `staff`  | `staff12345` |

For a real shop skip the seed and create your own owner instead:

```
npm --prefix backend run create-owner -- <username> <password> "Full Name"
npm start
```

Migrations are applied automatically on start (`npm --prefix backend run migrate` runs them on their own).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | run the server (dev restarts on file changes) |
| `npm test` | 70 backend tests (about 2 s) |
| `npm --prefix backend run test:e2e` | headless-Chrome UI test against a throwaway seeded database (needs Chrome or Edge; set `CHROME_PATH` if not auto-found) |
| `npm --prefix backend run backup` | consistent online backup of the database |

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DB_PATH` | `backend/data/bookshop.db` | SQLite file |
| `TZ_OFFSET_MINUTES` | server local offset | shop's offset from UTC, used to bucket sales into local days |
| `SESSION_HOURS` | 12 | login session length |
| `COOKIE_SECURE` | unset | set to `1` when served over HTTPS |

Shop name, tax rate, staff discount limit, low-stock default and restocking parameters are edited in the app under Settings (owner).

## Roles

- **Owner**: everything, including suppliers and their prices, purchasing, restocking, dashboard, expenses, stock corrections, voiding bills, users and settings.
- **Staff**: catalogue (add/edit, no cost data), billing, bills, inventory view, phone orders. Staff discounts are capped by a setting. Enforced on the server, not just hidden in the UI.

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md).
