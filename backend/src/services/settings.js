const { tx } = require('../db');
const v = require('../lib/validate');
const { percentToBp } = require('../lib/money');

function getSettings(db) {
  const raw = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return {
    shopName: raw.shop_name,
    shopAddress: raw.shop_address,
    currencySymbol: raw.currency_symbol,
    taxBp: Number(raw.tax_bp),
    staffMaxDiscountBp: Number(raw.staff_max_discount_bp),
    defaultLowStockThreshold: Number(raw.default_low_stock_threshold),
    restockLookbackDays: Number(raw.restock_lookback_days),
    restockCoverDays: Number(raw.restock_cover_days),
    restockDefaultLeadTimeDays: Number(raw.restock_default_lead_time_days),
  };
}

// API representation: percentages as decimal percent rather than basis points.
function publicSettings(db) {
  const s = getSettings(db);
  const { taxBp, staffMaxDiscountBp, ...rest } = s;
  return { ...rest, taxPercent: taxBp / 100, staffMaxDiscountPercent: staffMaxDiscountBp / 100 };
}

function updateSettings(db, input) {
  v.object(input);
  const updates = {};
  if (input.shopName !== undefined) updates.shop_name = v.str(input.shopName, 'shopName', { required: true, max: 100 });
  if (input.shopAddress !== undefined) updates.shop_address = v.str(input.shopAddress, 'shopAddress', { max: 300 });
  if (input.currencySymbol !== undefined) updates.currency_symbol = v.str(input.currencySymbol, 'currencySymbol', { required: true, max: 5 });
  if (input.taxPercent !== undefined) updates.tax_bp = percentToBp(input.taxPercent, 'taxPercent');
  if (input.staffMaxDiscountPercent !== undefined) updates.staff_max_discount_bp = percentToBp(input.staffMaxDiscountPercent, 'staffMaxDiscountPercent');
  if (input.defaultLowStockThreshold !== undefined) updates.default_low_stock_threshold = v.int(input.defaultLowStockThreshold, 'defaultLowStockThreshold', { min: 0, max: 100000 });
  if (input.restockLookbackDays !== undefined) updates.restock_lookback_days = v.int(input.restockLookbackDays, 'restockLookbackDays', { min: 7, max: 365 });
  if (input.restockCoverDays !== undefined) updates.restock_cover_days = v.int(input.restockCoverDays, 'restockCoverDays', { min: 1, max: 365 });
  if (input.restockDefaultLeadTimeDays !== undefined) updates.restock_default_lead_time_days = v.int(input.restockDefaultLeadTimeDays, 'restockDefaultLeadTimeDays', { min: 0, max: 120 });
  tx(db, () => {
    const stmt = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, val] of Object.entries(updates)) stmt.run(k, String(val));
  });
  return publicSettings(db);
}

module.exports = { getSettings, publicSettings, updateSettings };
