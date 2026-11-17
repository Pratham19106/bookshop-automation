const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');

// Apply supabase/migrations/NNNN_*.sql in order, each in its own transaction, recording them in schema_migrations.
// With db.schema set (tests) everything lands in that schema.
async function migrate(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  if (db.schema) {
    await db.query(`CREATE SCHEMA IF NOT EXISTS "${db.schema}"`);
    // Refuse to run if isolation is not in effect: never migrate (or seed tests into) the real tables by accident.
    const { s } = await db.one('SELECT current_schema() AS s');
    if (s !== db.schema) throw new Error(`Isolation failed: connection is in schema "${s}", expected "${db.schema}"`);
  }
  await db.tx(async (q) => {
    await q.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await q.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');
  });
  const done = new Set((await db.many('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => /^(?:\d{4}|\d{14})_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.tx(async (q) => {
      await q.query(sql);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    });
    log(`applied ${file}`);
    applied.push(file);
  }
  return applied;
}

module.exports = { migrate, MIGRATIONS_DIR };
