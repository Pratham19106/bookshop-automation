const v = require('../lib/validate');
const { badRequest, forbidden } = require('../lib/errors');
const { localDate, addDays, dayRangeToUtc, weekStart } = require('../lib/dates');
const { getSettings } = require('./settings');
const { stockOverview } = require('./inventory');
const { recommendations } = require('./restock');

/*
 * Metric definitions (all from persisted records; voided bills are always excluded):
 *   Net sales (revenue)   = sum(sale subtotal - discount) - refunds   what customers paid before tax
 *   Tax collected         = sum(sale tax)                            not revenue; shown separately
 *   COGS                  = sum(item quantity * unit cost at time of sale) - cost of refunded copies
 *   Gross profit          = Net sales - COGS
 *   Purchase spend        = value of goods RECEIVED from suppliers in the period (stock purchases)
 *   Operating expenses    = expenses entered for the shop(s) (rent, wages, ...), excluding stock purchases
 *   Operating profit      = Gross profit - Operating expenses
 *                           (purchases are NOT subtracted again: their cost reaches profit through COGS when sold)
 *   Net cash movement     = Net sales + tax - Purchase spend - Operating expenses  (a rough cash view, not profit)
 * Items sold with an unknown cost (cost 0) are counted separately so gross profit is not silently overstated.
 *
 * Scope: `outlet` = 'all' (every shop the user may see) or one shop id. Owners see all shops of the business,
 * managers only their assigned shops.
 */

function resolveScope(ctx, outlet) {
  const o = String(outlet ?? 'all');
  if (o === 'all') return ctx.shopIds;
  const id = Number(o);
  if (!Number.isInteger(id) || !ctx.shopIds.includes(id)) throw forbidden('You do not have access to that shop');
  return [id];
}

function parseRange(ctx, input) {
  const today = localDate(input.now ? new Date(input.now) : new Date(), ctx.tz);
  const to = v.date(input.to, 'to', { required: false }) || today;
  const from = v.date(input.from, 'from', { required: false }) || addDays(to, -29);
  if (from > to) throw badRequest('"from" must not be after "to"');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 800) throw badRequest('Date range is too large (max ~2 years)');
  return { today, from, to };
}

// SQL expression for the local-calendar bucket of a timestamptz column ($tz = minutes east of UTC).
function bucketSql(column, group, tzParam) {
  const local = `(timezone('UTC', ${column}) + make_interval(mins => ${tzParam}))`;
  if (group === 'month') return `to_char(${local}, 'YYYY-MM')`;
  if (group === 'week') return `to_char(date_trunc('week', ${local}), 'YYYY-MM-DD')`;
  return `to_char(${local}, 'YYYY-MM-DD')`;
}

async function salesTotals(db, shops, r) {
  const s = await db.one(`SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal_cents - discount_cents), 0) AS net,
                                 COALESCE(SUM(tax_cents), 0) AS tax, COALESCE(SUM(discount_cents), 0) AS discounts,
                                 COALESCE(SUM(total_cents), 0) AS gross
                            FROM sales WHERE shop_id = ANY($1::bigint[]) AND status = 'completed' AND created_at >= $2 AND created_at < $3`,
  [shops, r.start, r.end]);
  const c = await db.one(`SELECT COALESCE(SUM(i.quantity * i.unit_cost_cents), 0) AS cogs, COALESCE(SUM(i.quantity), 0) AS units,
                                 COALESCE(SUM(CASE WHEN i.unit_cost_cents = 0 THEN i.line_total_cents ELSE 0 END), 0) AS unknown_rev,
                                 COALESCE(SUM(CASE WHEN i.unit_cost_cents = 0 THEN i.quantity ELSE 0 END), 0) AS unknown_units
                            FROM sale_items i JOIN sales s ON s.id = i.sale_id
                           WHERE s.shop_id = ANY($1::bigint[]) AND s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3`,
  [shops, r.start, r.end]);
  const ref = await db.one(`SELECT COALESCE(SUM(r.amount_cents), 0) AS amount, COALESCE(SUM(r.tax_cents), 0) AS tax,
                                   COUNT(*) AS count, COALESCE(SUM(r.quantity * i.unit_cost_cents), 0) AS cost,
                                   COALESCE(SUM(r.quantity), 0) AS units,
                                   COALESCE(SUM(CASE WHEN i.unit_cost_cents = 0 THEN r.quantity ELSE 0 END), 0) AS unknown_units,
                                   COALESCE(SUM(CASE WHEN i.unit_cost_cents = 0 THEN r.quantity * i.unit_price_cents ELSE 0 END), 0) AS unknown_rev
                              FROM sale_returns r JOIN sale_items i ON i.id = r.sale_item_id JOIN sales s ON s.id = r.sale_id
                             WHERE r.shop_id = ANY($1::bigint[]) AND r.type = 'refund' AND s.status = 'completed'
                               AND NOT EXISTS (SELECT 1 FROM adjustments a WHERE a.legacy_return_id=r.id)
                               AND r.created_at >= $2 AND r.created_at < $3`, [shops, r.start, r.end]);
  const adj = await db.one(`SELECT COALESCE(SUM(i.sign*i.line_total_cents),0) net,
      COALESCE(SUM(i.sign*i.tax_cents),0) tax, COALESCE(SUM(i.sign*i.quantity*COALESCE(i.unit_cost_cents,0)),0) cost,
      COALESCE(SUM(i.sign*i.quantity),0) units,
      COALESCE(SUM(CASE WHEN COALESCE(i.unit_cost_cents,0)=0 THEN i.sign*i.quantity ELSE 0 END),0) unknown_units,
      COALESCE(SUM(CASE WHEN COALESCE(i.unit_cost_cents,0)=0 THEN i.sign*i.quantity*i.unit_price_cents ELSE 0 END),0) unknown_rev,
      COALESCE(SUM(CASE WHEN i.sign=-1 THEN i.line_total_cents ELSE 0 END),0) returned,
      COALESCE(SUM(CASE WHEN i.sign=-1 THEN i.tax_cents ELSE 0 END),0) returned_tax,
      COUNT(DISTINCT a.id) FILTER (WHERE a.type='refund') refunds
    FROM adjustments a JOIN adjustment_items i ON i.adjustment_id=a.id JOIN sales s ON s.id=a.original_sale_id
    WHERE a.shop_id=ANY($1::bigint[]) AND s.status='completed' AND a.created_at >= $2 AND a.created_at < $3
      AND (a.legacy_return_id IS NULL OR a.type='refund')`, [shops,r.start,r.end]);
  const net = s.net - ref.amount + adj.net;
  const cogs = c.cogs - ref.cost + adj.cost;
  return {
    bills: s.bills, unitsSold: c.units - ref.units + adj.units, netSalesCents: net, taxCents: s.tax - ref.tax + adj.tax, discountCents: s.discounts,
    salesBeforeRefundsCents: s.net, billedCents: s.gross, refundCount: ref.count + adj.refunds, refundTaxCents: ref.tax + adj.returned_tax,
    grossBilledCents: s.gross - ref.amount - ref.tax + adj.net + adj.tax, refundCents: ref.amount + adj.returned, cogsCents: cogs, grossProfitCents: net - cogs,
    unknownCostUnits: c.unknown_units - ref.unknown_units + adj.unknown_units, unknownCostRevenueCents: c.unknown_rev - ref.unknown_rev + adj.unknown_rev,
  };
}

async function summarise(ctx, shops, from, to) {
  const r = dayRangeToUtc(from, to, ctx.tz);
  const s = await salesTotals(ctx.db, shops, r);
  const { p: purchases } = await ctx.db.one(`SELECT COALESCE(SUM(total_cents), 0) AS p FROM goods_receipts
                                              WHERE shop_id = ANY($1::bigint[]) AND received_at >= $2 AND received_at < $3`, [shops, r.start, r.end]);
  const { e: expenses } = await ctx.db.one(`SELECT COALESCE(SUM(amount_cents), 0) AS e FROM expenses
                                             WHERE shop_id = ANY($1::bigint[]) AND expense_date >= $2 AND expense_date <= $3`, [shops, from, to]);
  return {
    from, to, ...s, purchaseSpendCents: purchases, operatingExpensesCents: expenses,
    operatingProfitCents: s.grossProfitCents - expenses,
    netCashMovementCents: s.netSalesCents + s.taxCents - purchases - expenses,
  };
}

async function dashboard(ctx, input = {}) {
  const shops = resolveScope(ctx, input.outlet ?? input.shop);
  const { today, from, to } = parseRange(ctx, input);
  const group = v.oneOf(input.group, 'group', ['day', 'week', 'month'], { required: false, fallback: 'day' });
  const range = dayRangeToUtc(from, to, ctx.tz);
  const db = ctx.db;

  const summary = await summarise(ctx, shops, from, to);
  const period = async (f, t) => {
    const s = await salesTotals(db, shops, dayRangeToUtc(f, t, ctx.tz));
    return { from: f, to: t, bills: s.bills, netSalesCents: s.netSalesCents };
  };
  const periods = {
    today: await period(today, today),
    week: await period(weekStart(today), today),
    month: await period(today.slice(0, 8) + '01', today),
  };

  const salesSeries = (await db.many(`SELECT ${bucketSql('s.created_at', group, '$4')} AS bucket, COUNT(*) AS bills,
                                             SUM(s.subtotal_cents - s.discount_cents) AS net
                                        FROM sales s WHERE s.shop_id = ANY($1::bigint[]) AND s.status = 'completed'
                                         AND s.created_at >= $2 AND s.created_at < $3
                                       GROUP BY bucket ORDER BY bucket`, [shops, range.start, range.end, ctx.tz]))
    .map((r) => ({ bucket: r.bucket, bills: r.bills, netSalesCents: r.net }));
  const refundSeries = await db.many(`SELECT ${bucketSql('r.created_at', group, '$4')} AS bucket, SUM(r.amount_cents) AS amount
                                        FROM sale_returns r JOIN sales s ON s.id = r.sale_id
                                       WHERE r.shop_id = ANY($1::bigint[]) AND r.type = 'refund' AND s.status = 'completed'
                                         AND NOT EXISTS (SELECT 1 FROM adjustments a WHERE a.legacy_return_id=r.id)
                                         AND r.created_at >= $2 AND r.created_at < $3 GROUP BY bucket`, [shops, range.start, range.end, ctx.tz]);
  for (const refund of refundSeries) {
    let entry = salesSeries.find((x) => x.bucket === refund.bucket);
    if (!entry) { entry = { bucket: refund.bucket, bills: 0, netSalesCents: 0 }; salesSeries.push(entry); }
    entry.netSalesCents -= refund.amount;
  }
  const adjustmentSeries = await db.many(`SELECT ${bucketSql('a.created_at',group,'$4')} bucket, SUM(i.sign*i.line_total_cents) amount
    FROM adjustments a JOIN adjustment_items i ON i.adjustment_id=a.id JOIN sales s ON s.id=a.original_sale_id
    WHERE a.shop_id=ANY($1::bigint[]) AND s.status='completed' AND a.created_at >= $2 AND a.created_at < $3
      AND (a.legacy_return_id IS NULL OR a.type='refund') GROUP BY bucket`, [shops,range.start,range.end,ctx.tz]);
  for (const adj of adjustmentSeries) {
    let entry = salesSeries.find(x=>x.bucket===adj.bucket);
    if (!entry) { entry={bucket:adj.bucket,bills:0,netSalesCents:0}; salesSeries.push(entry); }
    entry.netSalesCents += adj.amount;
  }
  salesSeries.sort((a, b) => a.bucket.localeCompare(b.bucket));

  const bestSellers = (await db.many(`
    SELECT book_id, MIN(title) title, MIN(author) author, MIN(edition) edition, SUM(units) units, SUM(revenue) revenue FROM (
      SELECT i.book_id,i.title,i.author,i.edition,i.quantity units,i.line_total_cents revenue FROM sale_items i JOIN sales s ON s.id=i.sale_id
       WHERE s.shop_id=ANY($1::bigint[]) AND s.status='completed' AND s.created_at >= $2 AND s.created_at < $3
      UNION ALL
      SELECT i.book_id,i.title,i.author,i.edition,i.sign*i.quantity,i.sign*i.line_total_cents FROM adjustment_items i
       JOIN adjustments a ON a.id=i.adjustment_id JOIN sales s ON s.id=a.original_sale_id
       WHERE a.shop_id=ANY($1::bigint[]) AND s.status='completed' AND a.created_at >= $2 AND a.created_at < $3
         AND (a.legacy_return_id IS NULL OR a.type='refund')
      UNION ALL
      SELECT i.book_id,i.title,i.author,i.edition,-r.quantity,-r.amount_cents FROM sale_returns r JOIN sale_items i ON i.id=r.sale_item_id JOIN sales s ON s.id=r.sale_id
       WHERE r.shop_id=ANY($1::bigint[]) AND r.type='refund' AND s.status='completed' AND r.created_at >= $2 AND r.created_at < $3
         AND NOT EXISTS(SELECT 1 FROM adjustments a WHERE a.legacy_return_id=r.id)
    ) activity GROUP BY book_id HAVING SUM(units)>0 ORDER BY units DESC,revenue DESC,title LIMIT 10`, [shops, range.start, range.end]))
    .map((r) => ({ bookId: r.book_id, title: r.title, author: r.author, edition: r.edition, units: r.units, revenueCents: r.revenue }));

  // Per-shop comparison (the owner's "which branch is doing well" view).
  const byShop = (await db.many(`
    SELECT sh.id, sh.name, sh.code,
           COUNT(s.id) AS bills, COALESCE(SUM(s.subtotal_cents - s.discount_cents), 0) AS net
      FROM shops sh
      LEFT JOIN sales s ON s.shop_id = sh.id AND s.status = 'completed' AND s.created_at >= $2 AND s.created_at < $3
     WHERE sh.id = ANY($1::bigint[])
     GROUP BY sh.id ORDER BY net DESC, sh.name`, [shops, range.start, range.end]))
    .map((r) => ({ shopId: r.id, name: r.name, code: r.code, bills: r.bills, netSalesCents: r.net }));
  for (const shop of byShop) {
    const total = await salesTotals(db,[shop.shopId],range);
    shop.netSalesCents = total.netSalesCents;
  }
  byShop.sort((a,b)=>b.netSalesCents-a.netSalesCents || a.name.localeCompare(b.name));

  const spendBySupplier = (await db.many(`
    SELECT s.id, s.name, COUNT(g.id) AS receipts, SUM(g.total_cents) AS spend
      FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
     WHERE g.shop_id = ANY($1::bigint[]) AND g.received_at >= $2 AND g.received_at < $3
     GROUP BY s.id ORDER BY spend DESC`, [shops, range.start, range.end]))
    .map((r) => ({ supplierId: r.id, name: r.name, receipts: r.receipts, spendCents: r.spend }));

  const expensesByCategory = (await db.many(`SELECT category, SUM(amount_cents) AS total FROM expenses
                                              WHERE shop_id = ANY($1::bigint[]) AND expense_date >= $2 AND expense_date <= $3
                                              GROUP BY category ORDER BY total DESC`, [shops, from, to]))
    .map((r) => ({ category: r.category, totalCents: r.total }));

  // Stock-level panels are computed per shop and merged (each item is tagged with its shop).
  const shopNames = new Map(byShop.map((s) => [s.shopId, s.name]));
  let lowStock = [];
  let restock = [];
  for (const shopId of shops) {
    const sctx = { ...ctx, shopId };
    const tag = (x) => ({ ...x, shopId, shopName: shopNames.get(shopId) });
    lowStock = lowStock.concat((await stockOverview(sctx, { lowOnly: true })).map(tag));
    restock = restock.concat((await recommendations(sctx, { now: input.now })).items.map(tag));
  }
  const urgency = { critical: 0, high: 1, medium: 2, low: 3 };
  restock.sort((a, b) => urgency[a.urgency] - urgency[b.urgency]);

  const openOrders = await db.one(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS value FROM phone_orders
                                    WHERE shop_id = ANY($1::bigint[]) AND status IN ('placed','ready','out_for_delivery')`, [shops]);
  const openPos = await db.one(`SELECT COUNT(*) AS n FROM purchase_orders
                                 WHERE shop_id = ANY($1::bigint[]) AND status IN ('ordered','partially_received')`, [shops]);
  const inv = await db.one(`SELECT COALESCE(SUM(ss.stock_qty), 0) AS units, COALESCE(SUM(ss.stock_qty * ss.cost_cents), 0) AS at_cost,
                                   COALESCE(SUM(ss.stock_qty * b.price_cents), 0) AS at_price
                              FROM shop_stock ss JOIN books b ON b.id = ss.book_id
                             WHERE ss.shop_id = ANY($1::bigint[]) AND b.active`, [shops]);

  return {
    salesOnly: false,
    range: { from, to, group, outlet: input.outlet ?? 'all', timezoneOffsetMinutes: ctx.tz },
    currencySymbol: (await getSettings(db, ctx.businessId)).currencySymbol,
    summary,
    periods,
    salesSeries,
    bestSellers,
    byShop,
    spendBySupplier,
    expensesByCategory,
    inventory: { units: inv.units, valueAtCostCents: inv.at_cost, valueAtPriceCents: inv.at_price },
    lowStock: { count: lowStock.length, items: lowStock.slice(0, 10) },
    restocking: { count: restock.length, top: restock.slice(0, 5) },
    openPhoneOrders: { count: openOrders.n, valueCents: openOrders.value },
    openPurchaseOrders: openPos.n,
  };
}

// Paged sales register across the selected shop(s), with per-shop totals.
async function salesReport(ctx, input = {}) {
  const shops = resolveScope(ctx, input.outlet ?? input.shop);
  const { from, to } = parseRange(ctx, input);
  const r = dayRangeToUtc(from, to, ctx.tz);
  const base = [shops, r.start, r.end];
  const where = 's.shop_id = ANY($1::bigint[]) AND s.created_at >= $2 AND s.created_at < $3';
  const totals = await salesTotals(ctx.db,shops,r);
  const summary = { bills:totals.bills, gross:totals.billedCents, net:totals.salesBeforeRefundsCents,
    refunds:totals.refundCents, netAfterAdjustments:totals.netSalesCents };
  const shopRows = await ctx.db.many('SELECT id,name FROM shops WHERE business_id=$1 AND id=ANY($2::bigint[]) ORDER BY name',[ctx.businessId,shops]);
  const outlets = [];
  for (const shop of shopRows) { const s=await salesTotals(ctx.db,[shop.id],r); outlets.push({ ...shop,bills:s.bills,total:s.grossBilledCents }); }
  const activity = `SELECT s.id,s.bill_no AS "billNo",s.created_at AS "createdAt",s.customer_name AS customer,s.payment_method AS payment,
      s.status,s.total_cents::bigint AS "totalCents",sh.name AS outlet,(SELECT COALESCE(SUM(quantity),0) FROM sale_items i WHERE i.sale_id=s.id) units,
      0::bigint AS "refundCents",'sale'::text AS type,NULL::text AS "originalBillNo"
    FROM sales s JOIN shops sh ON sh.id=s.shop_id WHERE ${where}
    UNION ALL
    SELECT a.id,a.adj_no,a.created_at,s.customer_name,a.payment_method,a.type,a.net_cents,sh.name,
      COALESCE((SELECT SUM(i.sign*i.quantity) FROM adjustment_items i WHERE i.adjustment_id=a.id),0),
      0::bigint,'adjustment'::text,s.bill_no
    FROM adjustments a JOIN sales s ON s.id=a.original_sale_id JOIN shops sh ON sh.id=a.shop_id
    WHERE a.shop_id=ANY($1::bigint[]) AND a.created_at >= $2 AND a.created_at < $3`;
  const total = (await ctx.db.one(`SELECT COUNT(*) AS n FROM (${activity}) activity`,base)).n;
  const pages = Math.max(1, Math.ceil(total / 50));
  const page = Math.max(1, Math.min(Number.parseInt(input.page, 10) || 1, pages));
  const items = await ctx.db.many(`SELECT * FROM (${activity}) activity ORDER BY "createdAt" DESC,id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, base);
  return { from, to, summary, outlets, items, page, total, pages };
}

/*
 * Financial statement for a date range, laid out like a bill: one column per shop plus a total column.
 * Uses summarise() so every figure matches the dashboard exactly. Payments are what customers paid by method,
 * less refunds handed back against bills of that method.
 */
const PAY_METHODS = ['cash', 'card', 'upi', 'other'];

async function statementColumn(ctx, shops, from, to) {
  const r = dayRangeToUtc(from, to, ctx.tz);
  const db = ctx.db;
  const [s, paid, refunded, exch, exp, settlements, exchangeValues] = await Promise.all([
    summarise(ctx, shops, from, to),
    db.many(`SELECT payment_method AS method, COALESCE(SUM(total_cents), 0) AS amount FROM sales
              WHERE shop_id = ANY($1::bigint[]) AND status = 'completed' AND created_at >= $2 AND created_at < $3
              GROUP BY payment_method`, [shops, r.start, r.end]),
    db.many(`SELECT s.payment_method AS method, COALESCE(SUM(x.amount_cents + x.tax_cents), 0) AS amount
               FROM sale_returns x JOIN sales s ON s.id = x.sale_id
              WHERE x.shop_id = ANY($1::bigint[]) AND x.type = 'refund' AND s.status = 'completed'
                AND NOT EXISTS (SELECT 1 FROM adjustments a WHERE a.legacy_return_id=x.id)
                AND x.created_at >= $2 AND x.created_at < $3 GROUP BY s.payment_method`, [shops, r.start, r.end]),
    db.one(`SELECT COUNT(*) AS n, COALESCE(SUM(units),0) AS units FROM (
      SELECT a.id, COALESCE((SELECT SUM(i.quantity) FROM adjustment_items i WHERE i.adjustment_id=a.id AND i.sign=1),0) units
        FROM adjustments a JOIN sales s ON s.id=a.original_sale_id WHERE a.shop_id=ANY($1::bigint[]) AND a.type='exchange' AND s.status='completed' AND a.created_at >= $2 AND a.created_at < $3
      UNION ALL SELECT x.id,x.quantity FROM sale_returns x JOIN sales s ON s.id=x.sale_id WHERE x.shop_id=ANY($1::bigint[]) AND x.type='exchange' AND s.status='completed' AND x.created_at >= $2 AND x.created_at < $3
        AND NOT EXISTS (SELECT 1 FROM adjustments a WHERE a.legacy_return_id=x.id)) combined`, [shops,r.start,r.end]),
    db.many(`SELECT category, SUM(amount_cents) AS amount FROM expenses
              WHERE shop_id = ANY($1::bigint[]) AND expense_date >= $2 AND expense_date <= $3
              GROUP BY category ORDER BY category`, [shops, from, to]),
    db.many(`SELECT a.payment_method method, SUM(a.net_cents) amount FROM adjustments a JOIN sales s ON s.id=a.original_sale_id
      WHERE a.shop_id=ANY($1::bigint[]) AND s.status='completed' AND a.payment_method IS NOT NULL AND a.created_at >= $2 AND a.created_at < $3 GROUP BY a.payment_method`, [shops,r.start,r.end]),
    db.one(`SELECT
      (SELECT COALESCE(SUM(i.line_total_cents),0) FROM adjustment_items i JOIN adjustments a ON a.id=i.adjustment_id JOIN sales s ON s.id=a.original_sale_id
       WHERE a.shop_id=ANY($1::bigint[]) AND a.type='exchange' AND i.sign=1 AND a.legacy_return_id IS NULL AND s.status='completed' AND a.created_at >= $2 AND a.created_at < $3) replacements,
      (SELECT COALESCE(SUM(a.net_cents),0) FROM adjustments a JOIN sales s ON s.id=a.original_sale_id
       WHERE a.shop_id=ANY($1::bigint[]) AND a.type='exchange' AND s.status='completed' AND a.created_at >= $2 AND a.created_at < $3) settlement`, [shops,r.start,r.end]),
  ]);
  const payments = Object.fromEntries(PAY_METHODS.map((m) => [m, 0]));
  for (const p of paid) payments[p.method] += p.amount;
  for (const p of refunded) payments[p.method] -= p.amount;
  for (const p of settlements) payments[p.method] += p.amount;
  return {
    bills: s.bills,
    unitsSold: s.unitsSold,
    grossSalesCents: s.salesBeforeRefundsCents + s.discountCents, // at list price
    discountCents: s.discountCents,
    refundCount: s.refundCount,
    refundCents: s.refundCents,
    netSalesCents: s.netSalesCents,
    taxCents: s.taxCents,
    receivedCents: s.netSalesCents + s.taxCents,
    exchangeCount: exch.n,
    exchangeUnits: exch.units,
    exchangeReplacementCents: exchangeValues.replacements,
    exchangeSettlementCents: exchangeValues.settlement,
    payments,
    cogsCents: s.cogsCents,
    grossProfitCents: s.grossProfitCents,
    grossMarginPercent: s.netSalesCents > 0 ? Math.round((s.grossProfitCents / s.netSalesCents) * 1000) / 10 : null,
    expenses: Object.fromEntries(exp.map((e) => [e.category, e.amount])),
    expensesCents: s.operatingExpensesCents,
    operatingProfitCents: s.operatingProfitCents,
    purchasesCents: s.purchaseSpendCents,
    unknownCostUnits: s.unknownCostUnits,
  };
}

async function statement(ctx, input = {}) {
  const scope = resolveScope(ctx, input.outlet ?? input.shop);
  const { from, to } = parseRange(ctx, input);
  const shopRows = await ctx.db.many(`SELECT id, code, name, city, address, phone, is_hq AS "isHq" FROM shops
                                       WHERE business_id = $1 AND id = ANY($2::bigint[]) ORDER BY is_hq DESC, code`,
  [ctx.businessId, scope]);
  const business = await ctx.db.one('SELECT name, email, phone FROM businesses WHERE id = $1', [ctx.businessId]);
  const perShop = shopRows.length > 1;
  const columns = await Promise.all([
    ...(perShop ? shopRows.map((sh) => statementColumn(ctx, [sh.id], from, to).then((c) => ({ key: String(sh.id), label: sh.code, name: sh.name, ...c }))) : []),
    statementColumn(ctx, shopRows.map((s) => s.id), from, to).then((c) => ({ key: 'total', label: perShop ? 'Total' : shopRows[0]?.code ?? 'Total', name: perShop ? 'All shops' : shopRows[0]?.name, ...c })),
  ]);
  const categories = [...new Set(columns.flatMap((c) => Object.keys(c.expenses)))].sort();
  return {
    statementNo: `STM-${perShop ? 'ALL' : shopRows[0]?.code ?? 'NA'}-${from.replaceAll('-', '')}-${to.replaceAll('-', '')}`,
    business, shops: shopRows, from, to,
    generatedAt: new Date().toISOString(), generatedBy: ctx.user.full_name || ctx.user.username,
    expenseCategories: categories, paymentMethods: PAY_METHODS, columns,
  };
}

module.exports = { dashboard, salesReport, statement };
