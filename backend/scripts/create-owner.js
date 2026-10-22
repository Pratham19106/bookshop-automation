// Usage: npm run create-owner -- <username> <password> ["Full Name"]
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const users = require('../src/services/users');

const [username, password, fullName] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run create-owner -- <username> <password> ["Full Name"]');
  process.exit(1);
}
const db = openDatabase(config.dbPath);
try {
  const u = users.createUser(db, { username, password, fullName: fullName || username, role: 'owner' });
  console.log(`Owner account "${u.username}" created.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
