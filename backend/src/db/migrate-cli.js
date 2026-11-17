const config = require('../config');
const { createDb } = require('./index');
const { migrate } = require('./migrate');

(async () => {
  const db = createDb({ connectionString: config.databaseUrl, max: 1 });
  try {
    const ran = await migrate(db, { log: (m) => console.log(m) });
    console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
