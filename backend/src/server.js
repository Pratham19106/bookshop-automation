const config = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const db = openDatabase(config.dbPath);
if (!require('node:fs').existsSync(config.publicDir)) {
  console.warn('Frontend is not built yet (frontend/dist missing). Run: npm run build   (or use npm run dev)');
}
const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (users === 0) {
  console.warn('No users exist yet. Create the owner account with:\n  npm run create-owner -- <username> <password>\n(or load demo data with: npm run seed)');
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
