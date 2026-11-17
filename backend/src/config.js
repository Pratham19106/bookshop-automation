const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// Local development: read backend/.env if present (Node 22 built-in). Hosted platforms inject real env vars.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // Supabase Postgres connection string (Project Settings -> Database -> Connection string).
  databaseUrl: process.env.DATABASE_URL || '',
  testDatabaseUrl: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '',
  // Minutes east of UTC used to bucket sales into local calendar days (dashboard, daily reports). India = 330.
  tzOffsetMinutes: process.env.TZ_OFFSET_MINUTES !== undefined
    ? Number(process.env.TZ_OFFSET_MINUTES)
    : -new Date().getTimezoneOffset(),
  sessionHours: Number(process.env.SESSION_HOURS) || 12,
  secureCookies: process.env.COOKIE_SECURE === '1',
  publicDir: path.join(root, '..', 'frontend', 'dist'),
};
