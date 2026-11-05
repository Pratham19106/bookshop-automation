const config = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const db = openDatabase(config.dbPath);
if (!require('node:fs').existsSync(config.publicDir)) {
  console.warn('Frontend is not built yet (frontend/dist missing). Run: npm run build   (or use npm run dev)');
}

const users = db.prepare('SELECT COUNT(*) c FROM users').get()?.c || 0;
if (users === 0) {
  console.log('No users found in database. Automatically initializing demo data and default owner account...');
  try {
    const { seedDemo } = require('./db/seed');
    seedDemo(db);
  } catch (err) {
    console.error('Failed to auto-seed demo database:', err);
  }
}

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.log(`Bookshop Automation System running at http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
