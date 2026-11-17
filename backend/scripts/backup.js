// Usage: npm run backup [-- <target-file.json>]
// Logical JSON export of every tenant table (one consistent snapshot, REPEATABLE READ). Supabase also keeps its own
// daily backups; this is a portable copy you control. The global ISBN catalogue is skipped (re-import it instead).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { createDb } = require('../src/db');

const TABLES = ['businesses', 'business_settings', 'shops', 'users', 'user_shops', 'shop_counters', 'books', 'shop_stock', 'stock_movements',
  'suppliers', 'supplier_books', 'phone_orders', 'phone_order_items', 'order_payments', 'sales', 'sale_items', 'sale_returns',
  'purchase_orders', 'purchase_order_items', 'goods_receipts', 'goods_receipt_items', 'expenses'];

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = process.argv[2] || path.join(__dirname, '..', 'backups', `bookshop-${stamp}.json`);

(async () => {
  const db = createDb({ connectionString: config.databaseUrl, max: 1 });
  try {
    const data = await db.tx(async (q) => {
      await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const out = { exportedAt: new Date().toISOString(), tables: {} };
      for (const t of TABLES) out.tables[t] = await q.many(`SELECT * FROM ${t} ORDER BY 1`);
      return out;
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data));
    const rows = Object.values(data.tables).reduce((s, r) => s + r.length, 0);
    console.log(`Backup written to ${target} (${rows} rows; sessions excluded).`);
  } catch (e) {
    console.error('Backup failed:', e.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
