// Serverless entry point (Vercel). One connection pool per warm instance; use Supabase's transaction pooler URL.
const config = require('../backend/src/config');
const { createDb } = require('../backend/src/db');
const { createApp } = require('../backend/src/app');

const db = createDb({ connectionString: config.databaseUrl, max: 3 });

module.exports = createApp(db);
