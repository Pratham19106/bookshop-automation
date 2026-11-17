# Deploying: API on Render, web app on Vercel, data on Supabase

```
browser ──> https://<your-site>.vercel.app ──(/api/* rewrite)──> https://<service>.onrender.com/api ──> Supabase Postgres
```

The browser only ever talks to the Vercel address. Vercel forwards `/api/*` to Render, so the sign-in cookie,
the API and the live-update stream all come from one site: no CORS, and the `SameSite=Strict` cookie works.

## 1. Point the Vercel rewrite at Render (once)

In **both** `frontend/vercel.json` and `vercel.json`, replace `RENDER-SERVICE-NAME` with your Render service's name
(the `https://….onrender.com` address shown at the top of the Render service page).

## 2. Render (API)

Service settings:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/health` |

Environment (Service → Environment):

| Key | Value |
|---|---|
| `DATABASE_URL` | the **new** Supabase project → Connect → Session pooler URI (port 5432), with the password filled in |
| `MIGRATE_ON_START` | `1` (applies new `supabase/migrations` on each deploy) |
| `TZ_OFFSET_MINUTES` | `330` |
| `COOKIE_SECURE` | `1` |
| `SESSION_HOURS` | `12` |

Delete any old variables that pointed at the previous Supabase project (`SUPABASE_URL`, `SUPABASE_*KEY`, an old
`DATABASE_URL`). Do not set `CORS_ORIGINS`: it is not needed with the rewrite.

## 3. Vercel (web app)

| Setting | Value |
|---|---|
| Root directory | `frontend` (then `frontend/vercel.json` is used) |
| Framework | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |

Environment: **delete** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_API_URL`. The web app
needs no variables at all.

## 4. Publish

Commit and push the project (Render and Vercel both deploy automatically from the repository). On Render the
log should end with `Database schema is up to date` (or `Applied N migration(s)`) and `running at`.

## 5. Check the live site

```
npm --prefix backend run prod-check -- https://<your-site>.vercel.app owner owner12345
```

It loads the site, checks the API and database, signs in through the site, opens the dashboard and the financial
statement, and checks that the live-update stream stays open. It changes no data.

The first request after the free Render service has been idle for 15 minutes takes about 30 seconds while it
wakes up; open the site a minute before a demo.

## Notes

- The previous production database is not used or changed by any of this. Once the new site is confirmed you can
  pause the old Supabase project.
- Demo data (`npm run seed -- --force`) is for demonstrations only; it wipes the business data in the database
  `DATABASE_URL` points at (the ISBN catalogue is kept).
- Live updates run inside the single Render instance. If the API is ever scaled to several instances, switch
  `backend/src/lib/hub.js` to Postgres `LISTEN/NOTIFY`.
