// Per-shop running numbers (bill / phone order / purchase order). The upsert takes a row lock on the counter, so
// concurrent transactions in the same shop are serialised and never hand out the same number. Must run in a tx.
async function nextNumber(q, shopId, kind) {
  const { value } = await q.one(`INSERT INTO shop_counters(shop_id, kind, value) VALUES ($1, $2, 1)
                                 ON CONFLICT (shop_id, kind) DO UPDATE SET value = shop_counters.value + 1
                                 RETURNING value`, [shopId, kind]);
  return value;
}

async function shopCode(q, shopId) {
  return (await q.one('SELECT code FROM shops WHERE id = $1', [shopId])).code;
}

// e.g. INV-S01-000042: the shop code keeps numbers readable and unique across a business's shops.
async function formatNumber(q, shopId, kind, prefix, pad) {
  const n = await nextNumber(q, shopId, kind);
  return `${prefix}-${await shopCode(q, shopId)}-${String(n).padStart(pad, '0')}`;
}

module.exports = { nextNumber, formatNumber };
