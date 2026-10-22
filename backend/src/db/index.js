const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { migrate } = require('./migrate');

function openDatabase(dbPath, { runMigrations = true } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (runMigrations) migrate(db);
  return db;
}

// Run fn inside BEGIN IMMEDIATE so concurrent writers serialise and a throw rolls everything back.
function tx(db, fn) {
  return db.transaction(fn).immediate();
}

module.exports = { openDatabase, tx };
