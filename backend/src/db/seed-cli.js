const config = require('../config');
const { createDb } = require('./index');
const { migrate } = require('./migrate');
const { seedDemo } = require('./seed');

(async () => {
  const db = createDb({ connectionString: config.databaseUrl, max: 2 });
  const force = process.argv.includes('--force') || process.argv.includes('-f');
  try {
    await migrate(db, { log: (m) => console.log(m) });
    const r = await seedDemo(db, { force, log: (m) => console.log(`  seeding ${m}...`) });
    console.log('\n✓ Demo data loaded');
    console.log(`  Shops:     ${r.shops.join(' | ')}`);
    console.log(`  Titles:    ${r.bookCount} (${r.fromCatalog} from the ISBN catalogue)`);
    console.log(`  Suppliers: ${r.supplierCount}`);
    console.log('  Logins:');
    for (const l of r.logins) console.log(`    ${l}`);
  } catch (e) {
    console.error('\n✗ Seeding failed:', e.message);
    if (/already contains/.test(e.message)) console.error('  To wipe ALL tenant data and reseed: npm run seed -- --force');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
