// Usage: npm run backup [-- <target-file>]   Online, consistent copy of the database (safe while the server runs).
const path = require('node:path');
const config = require('../src/config');
const { openDatabase } = require('../src/db');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = process.argv[2] || path.join(path.dirname(config.dbPath), 'backups', `bookshop-${stamp}.db`);
require('node:fs').mkdirSync(path.dirname(target), { recursive: true });

const db = openDatabase(config.dbPath, { runMigrations: false });
db.backup(target)
  .then(() => { console.log(`Backup written to ${target}`); db.close(); })
  .catch((e) => { console.error('Backup failed:', e.message); process.exitCode = 1; });
