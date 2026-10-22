const config = require('../config');
const { openDatabase } = require('./index');
const { migrate } = require('./migrate');

const db = openDatabase(config.dbPath, { runMigrations: false });
const ran = migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
