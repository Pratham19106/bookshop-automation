const config = require('../config');
const { openDatabase } = require('./index');
const { seedDemo } = require('./seed');

const db = openDatabase(config.dbPath);
try {
  const creds = seedDemo(db);
  console.log('Demo data loaded.');
  console.log(`  Owner login: ${creds.owner}`);
  console.log(`  Staff login: ${creds.staff}`);
  console.log('These passwords are for DEMO ONLY. Do not use demo data in a real shop.');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
