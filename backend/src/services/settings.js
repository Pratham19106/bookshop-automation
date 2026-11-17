const v = require('../lib/validate');
const { percentToBp } = require('../lib/money');
const { notFound } = require('../lib/errors');

const COLUMNS = {
  currencySymbol: 'currency_symbol',
  taxBp: 'tax_bp',
  staffMaxDiscountBp: 'staff_max_discount_bp',
  managerMaxDiscountBp: 'manager_max_discount_bp',
  defaultLowStockThreshold: 'default_low_stock_threshold',
  restockLookbackDays: 'restock_lookback_days',
  restockCoverDays: 'restock_cover_days',
  restockDefaultLeadTimeDays: 'restock_default_lead_time_days',
  returnWindowDays: 'return_window_days',
};

// Business-wide settings in camelCase. `q` is the pool or a transaction handle.
async function getSettings(q, businessId) {
  const row = await q.one('SELECT * FROM business_settings WHERE business_id = $1', [businessId]);
  if (!row) throw notFound('Business settings');
  return Object.fromEntries(Object.entries(COLUMNS).map(([k, col]) => [k, row[col]]));
}

// API representation: percentages as decimal percent, plus the active shop's receipt header.
async function publicSettings(ctx) {
  const s = await getSettings(ctx.db, ctx.businessId);
  const business = await ctx.db.one('SELECT name FROM businesses WHERE id = $1', [ctx.businessId]);
  const shop = ctx.shopId ? await ctx.db.one('SELECT name, address, phone, city FROM shops WHERE id = $1', [ctx.shopId]) : null;
  const { taxBp, staffMaxDiscountBp, managerMaxDiscountBp, ...rest } = s;
  return {
    ...rest,
    businessName: business ? business.name : '',
    shopName: shop ? shop.name : (business ? business.name : ''),
    shopAddress: shop ? [shop.address, shop.city].filter(Boolean).join(', ') : '',
    shopPhone: shop ? shop.phone : '',
    taxPercent: taxBp / 100,
    staffMaxDiscountPercent: staffMaxDiscountBp / 100,
    managerMaxDiscountPercent: managerMaxDiscountBp / 100,
  };
}

// Owner-only. Updates business settings; shop header fields (shopName / shopAddress / shopPhone) update the active shop.
async function updateSettings(ctx, input) {
  v.object(input);
  const set = {};
  if (input.currencySymbol !== undefined) set.currency_symbol = v.str(input.currencySymbol, 'currencySymbol', { required: true, max: 5 });
  if (input.taxPercent !== undefined) set.tax_bp = percentToBp(input.taxPercent, 'taxPercent');
  if (input.staffMaxDiscountPercent !== undefined) set.staff_max_discount_bp = percentToBp(input.staffMaxDiscountPercent, 'staffMaxDiscountPercent');
  if (input.managerMaxDiscountPercent !== undefined) set.manager_max_discount_bp = percentToBp(input.managerMaxDiscountPercent, 'managerMaxDiscountPercent');
  if (input.defaultLowStockThreshold !== undefined) set.default_low_stock_threshold = v.int(input.defaultLowStockThreshold, 'defaultLowStockThreshold', { min: 0, max: 100000 });
  if (input.restockLookbackDays !== undefined) set.restock_lookback_days = v.int(input.restockLookbackDays, 'restockLookbackDays', { min: 7, max: 365 });
  if (input.restockCoverDays !== undefined) set.restock_cover_days = v.int(input.restockCoverDays, 'restockCoverDays', { min: 1, max: 365 });
  if (input.restockDefaultLeadTimeDays !== undefined) set.restock_default_lead_time_days = v.int(input.restockDefaultLeadTimeDays, 'restockDefaultLeadTimeDays', { min: 0, max: 120 });
  if (input.returnWindowDays !== undefined) set.return_window_days = v.int(input.returnWindowDays, 'returnWindowDays', { min: 0, max: 90 });

  const shopSet = {};
  if (input.shopName !== undefined) shopSet.name = v.str(input.shopName, 'shopName', { required: true, max: 100 });
  if (input.shopAddress !== undefined) shopSet.address = v.str(input.shopAddress, 'shopAddress', { max: 300 });
  if (input.shopPhone !== undefined) shopSet.phone = v.str(input.shopPhone, 'shopPhone', { max: 60 });

  await ctx.db.tx(async (q) => {
    const cols = Object.keys(set);
    if (cols.length) {
      await q.query(`UPDATE business_settings SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE business_id = $1`,
        [ctx.businessId, ...cols.map((c) => set[c])]);
    }
    const shopCols = Object.keys(shopSet);
    if (shopCols.length && ctx.shopId) {
      await q.query(`UPDATE shops SET ${shopCols.map((c, i) => `${c} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND id = $2`,
        [ctx.businessId, ctx.shopId, ...shopCols.map((c) => shopSet[c])]);
    }
  });
  return publicSettings(ctx);
}

module.exports = { getSettings, publicSettings, updateSettings };
