# Operations: setup, backup, deployment

## First-time setup

1. Install Node.js 22+ and create a Supabase project.
2. `npm install && npm run setup`
3. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` (Supabase: Project Settings → Database → Connection string).
4. `npm run migrate`, then `npm run import-catalog` (needs `open4goods-isbn-dataset.csv` next to the project folder, or pass `-- --file <path>`).
5. Create the business: sign up from the app, or `npm --prefix backend run create-owner -- <username> <password> "Business Name"`.
6. `npm start` and sign in. Under **Settings** add your other shops, then add managers and staff and assign them to shops.

Do not run `npm run seed` on a real database: it is demo data with well-known passwords. It refuses when businesses already
exist; `-- --force` wipes **all** tenant data (the ISBN catalogue is kept).

## Database

Supabase Postgres. The schema lives in `supabase/migrations/NNNN_*.sql`, applied in order by `npm run migrate` and recorded in
`schema_migrations`. Row-level security is enabled on every table with no policies, so Supabase's public (anon / publishable)
API keys can read and write nothing; only the API, connecting with the database password, can. Keep `DATABASE_URL` secret.

Catalogue import options: `--limit N` (default 10000), `--per-category N` (default 150), `--dry-run` (scan and report only).
Re-running is safe (rows are upserted by ISBN).

## Backup and recovery

- Supabase keeps daily backups of the project (see the dashboard; point-in-time recovery on paid plans).
- `npm --prefix backend run backup` writes a consistent JSON export of all tenant tables to `backend/backups/` (git-ignored).

## Deployment

API on Render, web app on Vercel with an `/api` rewrite: see [DEPLOY.md](DEPLOY.md).
Serve over HTTPS only. Live updates need a long-running API process (Render, not serverless functions).

## Troubleshooting

- *"DATABASE_URL is not set"*: create `backend/.env` from `.env.example`.
- *Tests fail to connect*: tests need a session/direct connection string (port 5432), not the transaction pooler.
- *Locked out of the owner account*: another owner can reset it in Settings, or create a new business with `create-owner`.
