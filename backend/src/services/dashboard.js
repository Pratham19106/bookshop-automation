const v = require('../lib/validate');
const { badRequest } = require('../lib/errors');
const { localDate, addDays, dayRangeToUtc, weekStart } = require('../lib/dates');
const { getSettings } = require('./settings');
const { stockOverview } = require('./inventory');
const { recommendations } = require('./restock');

/*
 * Metric definitions (all from persisted records; voided bills are always excluded):
 *   Net sales (revenue)   = sum(sale subtotal - discount)            i.e. what customers paid before tax
 *   Tax collected         = sum(sale tax)                            not revenue; shown separately
 *   COGS                  = sum(item quantity * unit cost at time of sale)
 *   Gross profit          = Net sales - COGS
 *   Purchase spend        = value of goods RECEIVED from suppliers in the period (stock purchases)
 *   Operating expenses    = expenses entered by the owner (rent, wages, ...), excluding stock purchases
 *   Operating profit      = Gross profit - Operating expenses
 *                           (purchases are NOT subtracted again: their cost reaches profit through COGS when sold)
 *   Net cash movement     = Net sales + tax - Purchase spend - Operating expenses  (a rough cash view, not profit)
 * Items sold with an unknown cost (cost 0) are counted separately so gross profit is not silently overstated.
 */
function dashboard(db, tzOffsetMinutes, input = {}) {
  const now = input.now ? new Date(input.now) : new Date();
  const today = localDate(now, tzOffsetMinutes);
  const to = v.date(input.to, 'to', { required: false }) || today;
  const from = v.date(input.from, 'from', { required: false }) || addDays(to, -29);
  if (from > to) throw badRequest('"from" must not be after "to"');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 800) throw badRequest('Date range is too large (max ~2 years)');
  const group = v.oneOf(input.group, 'group', ['day', 'week', 'month'], { required: false, fallback: 'day' });

  const off = `${tzOffsetMinutes >= 0 ? '+' : '-'}${Math.abs(tzOffsetMinutes)} minutes`;
  const range = dayRangeToUtc(from, to, tzOffsetMinutes);

  const salesIn = (r) => {
    const s = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal_cents - discount_cents), 0) AS net,
                                 COALESCE(SUM(tax_cents), 0) AS tax, COALESCE(SUM(discount_cents), 0) AS discounts,
                                 COALESCE(SUM(total_cents), 0) AS gross
                            FROM sales WHERE status = 'completed' AND created_at >= ? AND created_at < ?`).get(r.start, r.end);
    const c = db.prepare(`SELECT COALESCE(SUM(i.quantity * i.unit_cost_cents), 0) AS cogs,
                                 COALESCE(SUM(i.quantity), 0) AS units,
                                 COALESCE(SUM(CASE WHEN i.unit_cost_cents = 0 THEN i.line_total_cents ELSE 0 END), 0) AS unknown_rev,
                                 COALESCE(SUM(CASE WHEN i.unit_cost_cents = 0 THEN i.quantity ELSE 0 END), 0) AS unknown_units
                            FROM sale_items i JOIN sales s ON s.id = i.sale_id
                           WHERE s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?`).get(r.start, r.end);
    return { bills: s.bills, unitsSold: c.units, netSalesCents: s.net, taxCents: s.tax, discountCents: s.discounts, grossBilledCents: s.gross,
      cogsCents: c.cogs, grossProfitCents: s.net - c.cogs, unknownCostUnits: c.unknown_units, unknownCostRevenueCents: c.unknown_rev };
  };

  const purchasesIn = (r) => db.prepare('SELECT COALESCE(SUM(total_cents), 0) AS s FROM goods_receipts WHERE received_at >= ? AND received_at < ?').get(r.start, r.end).s;
  const expensesIn = (f, t) => db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM expenses WHERE expense_date >= ? AND expense_date <= ?').get(f, t).s;

  const summarise = (f, t) => {
    const r = dayRangeToUtc(f, t, tzOffsetMinutes);
    const s = salesIn(r);
    const purchases = purchasesIn(r);
    const expenses = expensesIn(f, t);
    return { from: f, to: t, ...s, purchaseSpendCents: purchases, operatingExpensesCents: expenses,
      operatingProfitCents: s.grossProfitCents - expenses,
      netCashMovementCents: s.netSalesCents + s.taxCents - purchases - expenses };
  };

  const summary = summarise(from, to);
  const periods = {
    today: periodRevenue(db, today, today, tzOffsetMinutes),
    week: periodRevenue(db, weekStart(today), today, tzOffsetMinutes),
    month: periodRevenue(db, today.slice(0, 8) + '01', today, tzOffsetMinutes),
  };

  const bucket = group === 'day' ? `date(s.created_at, '${off}')`
    : group === 'month' ? `strftime('%Y-%m', s.created_at, '${off}')`
    : `date(s.created_at, '${off}', '-' || ((CAST(strftime('%w', s.created_at, '${off}') AS INTEGER) + 6) % 7) || ' days')`;
  const salesSeries = db.prepare(`SELECT ${bucket} AS bucket, COUNT(*) AS bills, SUM(s.subtotal_cents - s.discount_cents) AS net
                                    FROM sales s WHERE s.status='completed' AND s.created_at >= ? AND s.created_at < ?
                                   GROUP BY bucket ORDER BY bucket`).all(range.start, range.end)
    .map((r) => ({ bucket: r.bucket, bills: r.bills, netSalesCents: r.net }));

  const bestSellers = db.prepare(`
    SELECT i.book_id, i.title, i.author, i.edition, SUM(i.quantity) AS units, SUM(i.line_total_cents) AS revenue
      FROM sale_items i JOIN sales s ON s.id = i.sale_id
     WHERE s.status='completed' AND s.created_at >= ? AND s.created_at < ?
     GROUP BY i.book_id ORDER BY units DESC, revenue DESC, i.title LIMIT 10`).all(range.start, range.end)
    .map((r) => ({ bookId: r.book_id, title: r.title, author: r.author, edition: r.edition, units: r.units, revenueCents: r.revenue }));

  const spendBySupplier = db.prepare(`
    SELECT s.id, s.name, COUNT(g.id) AS receipts, SUM(g.total_cents) AS spend
      FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
     WHERE g.received_at >= ? AND g.received_at < ? GROUP BY s.id ORDER BY spend DESC`).all(range.start, range.end)
    .map((r) => ({ supplierId: r.id, name: r.name, receipts: r.receipts, spendCents: r.spend }));

  const expensesByCategory = db.prepare(`SELECT category, SUM(amount_cents) AS total FROM expenses
                                          WHERE expense_date >= ? AND expense_date <= ? GROUP BY category ORDER BY total DESC`).all(from, to)
    .map((r) => ({ category: r.category, totalCents: r.total }));

  const lowStock = stockOverview(db, { lowOnly: true });
  const restock = recommendations(db, { now });
  const openOrders = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS value FROM phone_orders WHERE status IN ('placed','ready','out_for_delivery')`).get();
  const openPos = db.prepare("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('ordered','partially_received')").get();
  const inv = db.prepare(`SELECT COALESCE(SUM(stock_qty), 0) AS units, COALESCE(SUM(stock_qty * cost_cents), 0) AS at_cost,
                                 COALESCE(SUM(stock_qty * price_cents), 0) AS at_price FROM books WHERE active = 1`).get();

  return {
    range: { from, to, group, timezoneOffsetMinutes: tzOffsetMinutes },
    currencySymbol: getSettings(db).currencySymbol,
    summary,
    periods,
    salesSeries,
    bestSellers,
    spendBySupplier,
    expensesByCategory,
    inventory: { units: inv.units, valueAtCostCents: inv.at_cost, valueAtPriceCents: inv.at_price },
    lowStock: { count: lowStock.length, items: lowStock.slice(0, 10) },
    restocking: { count: restock.items.length, top: restock.items.slice(0, 5) },
    openPhoneOrders: { count: openOrders.n, valueCents: openOrders.value },
    openPurchaseOrders: openPos.n,
  };
}

function periodRevenue(db, f, t, tz) {
  const r = dayRangeToUtc(f, t, tz);
  const row = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal_cents - discount_cents), 0) AS net
                            FROM sales WHERE status='completed' AND created_at >= ? AND created_at < ?`).get(r.start, r.end);
  return { from: f, to: t, bills: row.bills, netSalesCents: row.net };
}

module.exports = { dashboard };
