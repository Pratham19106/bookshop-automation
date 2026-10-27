const config = require('../config');
const { openDatabase } = require('./index');
const { seedDemo } = require('./seed');

const db = openDatabase(config.dbPath);
const force = process.argv.includes('--force') || process.argv.includes('-f');

try {
  const result = seedDemo(db, { force });
  console.log('\n=======================================================');
  console.log('✓ Comprehensive Bookshop Data Loaded Successfully!');
  console.log('=======================================================');
  console.log(`- Titles in Catalogue:  ${result.bookCount} books across 10 genres`);
  console.log(`- Active Suppliers:     ${result.supplierCount} competing wholesale vendors`);
  console.log('- Counter Sales:        60 days of itemized customer receipts');
  console.log('- Phone Orders:         Sample reservations (Ready, Placed)');
  console.log('- Purchase Activity:    Received shipments + in-transit PO');
  console.log('- Store Overheads:      Rent, electricity, packaging, wages');
  console.log('-------------------------------------------------------');
  console.log('Active Login Credentials:');
  console.log(`  Owner Account:   ${result.owner}`);
  console.log(`  Worker Account:  ${result.worker}`);
  console.log(`  Demo Owner:      ${result.demoOwner}`);
  console.log(`  Demo Staff:      ${result.demoStaff}`);
  console.log('=======================================================\n');
} catch (e) {
  console.error('\n✗ Seeding Notice:', e.message);
  console.error('Tip: To replace existing records with fresh mock data, run:');
  console.error('     npm run seed -- --force\n');
  process.exitCode = 1;
}
