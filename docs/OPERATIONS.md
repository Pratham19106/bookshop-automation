# Operations: setup, backup, deployment

## First-time setup for a real shop

1. Install Node.js 20+.
2. `npm run setup`
3. `npm --prefix backend run create-owner -- <username> <a-strong-password> "Owner Name"`
4. `npm start` and open http://localhost:3000. Sign in, then go to **Settings** to set the shop name, currency, tax and limits, and add staff users.
5. Enter books under **Catalogue** (with opening stock and shelf location), add suppliers with their quoted prices, and start billing.

Do not run `npm run seed` on a real database; it is demo data with well-known passwords (and it refuses if users already exist).

## Database

SQLite file at `DB_PATH` (default `backend/data/bookshop.db`, plus `-wal`/`-shm` files while running). Schema changes are SQL files in
`backend/src/db/migrations/`, applied once each in name order at startup and recorded in `schema_migrations`.

## Backup and recovery

- **Backup (safe while the app runs):** `npm --prefix backend run backup` writes a timestamped copy to `backend/data/backups/`. Pass a path to choose the target.
  Schedule it daily (Windows Task Scheduler or cron) and copy the files off the machine.
- **Restore:** stop the app, replace the database file with a backup (delete any `-wal`/`-shm` files next to it), start the app.
- `backend/data/` is git-ignored: never commit the database.

## Deployment on a shop PC or small server

- Run `npm start` under a process manager (pm2, NSSM/Windows service, or systemd) so it restarts after reboot.
- If it is reachable beyond the shop PC, put it behind HTTPS (a reverse proxy such as Caddy or nginx) and set `COOKIE_SECURE=1`.
  The app has no TLS of its own. Do not expose it to the internet over plain HTTP.
- Set `TZ_OFFSET_MINUTES` (e.g. `330` for India) so "today" on the dashboard matches the shop's local day.
- One instance only: SQLite is a single-writer, single-file database.

## Troubleshooting

- *"No users exist yet"* on start: run `create-owner` (or `seed` for a demo).
- *Port in use:* set `PORT`.
- *Locked out of the owner account:* run `create-owner` with a new username.
