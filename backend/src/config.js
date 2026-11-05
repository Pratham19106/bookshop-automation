const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || (isServerless ? path.join(os.tmpdir(), 'bookshop.db') : path.join(root, 'data', 'bookshop.db')),
  // Minutes east of UTC used to bucket sales into local calendar days (dashboard, daily reports).
  tzOffsetMinutes: process.env.TZ_OFFSET_MINUTES !== undefined
    ? Number(process.env.TZ_OFFSET_MINUTES)
    : -new Date().getTimezoneOffset(),
  sessionHours: Number(process.env.SESSION_HOURS) || 12,
  secureCookies: process.env.COOKIE_SECURE === '1',
  publicDir: path.join(root, '..', 'frontend', 'dist'),
};
