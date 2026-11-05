const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { openDatabase } = require('../backend/src/db');
const { seedDemo } = require('../backend/src/db/seed');
const { createApp } = require('../backend/src/app');

// On serverless environments (like Vercel), /tmp is the writable filesystem directory
const dbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), 'bookshop_serverless.db')
  : path.join(__dirname, '../backend/data/bookshop.db');

let db;
try {
  db = openDatabase(dbPath);
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get()?.c || 0;
  if (userCount === 0) {
    seedDemo(db);
  }
} catch (err) {
  console.warn('Initializing database fallback for serverless:', err);
  db = openDatabase(':memory:');
  seedDemo(db);
}

const app = createApp(db);

module.exports = app;

