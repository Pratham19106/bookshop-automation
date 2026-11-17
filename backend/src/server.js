const config = require('./config');
const { createDb } = require('./db');
const { createApp } = require('./app');
const { migrate } = require('./db/migrate');

const db = createDb({ connectionString: config.databaseUrl });
if (!require('node:fs').existsSync(config.publicDir)) {
  console.warn('Frontend is not built yet (frontend/dist missing). Run: npm run build   (or use npm run dev)');
}

const app = createApp(db);
let server;

async function start() {
  // Hosted deploys (Render): apply any new supabase/migrations before taking traffic. Safe to repeat.
  if (process.env.MIGRATE_ON_START === '1') {
    const applied = await migrate(db, { log: (m) => console.log(m) });
    console.log(applied.length ? `Applied ${applied.length} migration(s)` : 'Database schema is up to date');
  }
  server = app.listen(config.port, () => {
    console.log(`Bookshop Automation System running at http://localhost:${config.port}`);
  });
}
start().catch((err) => { console.error('Startup failed:', err.message); process.exit(1); });

function shutdown() {
  if (!server) process.exit(0);
  server.close(() => { db.close().finally(() => process.exit(0)); });
  // Open live-update streams keep connections alive; do not wait for them forever.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
