const { Pool, types } = require('pg');
const { ResilientSocket } = require('./resilient-socket');

// int8 (ids, COUNT, SUM over integers) and numeric -> JS number. Values stay far below 2^53 here.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
// timestamptz -> ISO-8601 UTC string (the API has always exposed ISO strings); date -> 'YYYY-MM-DD' as-is.
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(1082, (v) => v);

// Thin query helpers shared by the pool and by a transaction's client, so services use one API either way.
function helpers(runner) {
  const query = (text, params = []) => runner.query(text, params);
  return {
    query,
    many: async (text, params) => (await query(text, params)).rows,
    one: async (text, params) => (await query(text, params)).rows[0] || null,
    // rowCount of an UPDATE / DELETE
    run: async (text, params) => (await query(text, params)).rowCount,
  };
}

/**
 * Database handle.
 *   db.one / many / run / query  - single statements on the pool
 *   db.tx(async (q) => ...)       - BEGIN ... COMMIT on one client; any throw rolls everything back.
 *                                   Nested db.tx calls made with the transaction handle reuse it.
 * `schema` (tests) pins search_path so a run is isolated in its own schema.
 */
function createDb({ connectionString, schema = null, max = 10, ssl } = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill in your Supabase connection string.');
  }
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  const pool = new Pool({
    connectionString,
    max,
    ssl: ssl ?? (/localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false }),
    // Survive intermittent DNS failures for the database host (see resilient-socket.js).
    stream: () => new ResilientSocket(),
  });
  // A dropped idle connection must not crash the process.
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));

  // Tests: pin every connection to the isolated schema with an explicit SET before its first statement.
  // (A startup "options" parameter is not reliable through Supabase's pooler: a reused server connection can
  // come back with the default search_path, which would point tests at the real tables.)
  const pinned = new Set();
  pool.on('remove', (c) => pinned.delete(c));
  async function checkout() {
    const client = await pool.connect();
    if (schema && !pinned.has(client)) {
      try {
        await client.query(`SET search_path TO "${schema}", public, extensions`);
        pinned.add(client);
      } catch (err) {
        client.release(err);
        throw err;
      }
    }
    return client;
  }
  // Without a schema the pool is used directly (production); with one, every statement goes through checkout().
  const runner = schema
    ? { query: async (text, params) => { const c = await checkout(); try { return await c.query(text, params); } finally { c.release(); } } }
    : pool;

  const db = {
    ...helpers(runner),
    pool,
    schema,
    inTx: false,
    async tx(fn) {
      const client = await checkout();
      try {
        await client.query('BEGIN');
        const q = { ...helpers(client), inTx: true, tx: (inner) => inner(q) };
        const result = await fn(q);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    // Pooled server connections are reused by later sessions: put search_path back before letting go.
    close: async () => {
      for (const c of pinned) await c.query('RESET search_path').catch(() => {});
      await pool.end();
    },
  };
  return db;
}

module.exports = { createDb };
