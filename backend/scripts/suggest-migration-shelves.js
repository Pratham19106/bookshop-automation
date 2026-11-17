// Only the explicitly authorized test project may be modified by this one-off helper.
const config = require('../src/config');
const { createDb } = require('../src/db');
const { suggestMigrationShelves } = require('../src/services/arrangement');

async function main() {
  const url = new URL(config.databaseUrl);
  if (url.username !== 'postgres.bpvnstaodehxjetsglwn' || url.hostname !== 'aws-0-ap-southeast-1.pooler.supabase.com') {
    throw new Error('Refusing to access a database other than the authorized test project.');
  }
  const db = createDb({ connectionString: config.databaseUrl });
  try {
    const shops = await db.many(`SELECT sh.id,sh.business_id,sh.name,
      (SELECT COUNT(*) FROM shelves s WHERE s.shop_id=sh.id AND s.active) AS shelves,
      (SELECT COALESCE(SUM(t.qty),0) FROM arrangement_tasks t WHERE t.shop_id=sh.id AND t.source='migration' AND t.status='open' AND t.proposed_shelf_id IS NULL) AS unassigned
      FROM shops sh ORDER BY sh.id`);
    for (const shop of shops) {
      if (process.argv.includes('--apply') && shop.unassigned) {
        const result = await suggestMigrationShelves({db,businessId:shop.business_id,shopId:shop.id});
        console.log(JSON.stringify({shop:shop.name,shelves:shop.shelves,...result}));
      } else console.log(JSON.stringify({shop:shop.name,shelves:shop.shelves,unassigned:shop.unassigned}));
    }
  } finally { await db.close(); }
}
main().catch(err => { console.error(err.message); process.exitCode=1; });
