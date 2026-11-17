// Usage: npm run create-owner -- <username> <password> "<Business Name>" ["Owner Full Name"] [email]
// Creates a new business with one (HQ) shop and its owner account. More shops and staff are added in the app.
const config = require('../src/config');
const { createDb } = require('../src/db');
const users = require('../src/services/users');

const [username, password, businessName, fullName, email] = process.argv.slice(2);
if (!username || !password || !businessName) {
  console.error('Usage: npm run create-owner -- <username> <password> "<Business Name>" ["Owner Full Name"] [email]');
  process.exit(1);
}

(async () => {
  const db = createDb({ connectionString: config.databaseUrl, max: 1 });
  try {
    const r = await users.registerBusiness(db, {
      businessName, ownerName: fullName || username, username, password, email: email || 'owner@example.com',
    });
    console.log(`Business "${r.business.name}" created with shop "${r.shops[0].name}" and owner "${username}".`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
