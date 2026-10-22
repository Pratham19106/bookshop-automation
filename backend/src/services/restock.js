const v = require('../lib/validate');
const { DAY } = require('../lib/dates');
const { getSettings } = require('./settings');

/*
 * Rule-based restocking. For each active book:
 *   velocity       = units sold (completed bills) in the analysis window / days actually observed
 *   available      = stock - reserved for phone orders
 *   onOrder        = units still outstanding on open purchase orders
 *   daysOfCover    = available / velocity
 *   targetStock    = ceil(velocity * coverDays) + threshold      (demand over the cover period + safety buffer)
 *   suggestedQty   = max(1, targetStock - (available + onOrder))
 * A book is flagged when any rule fires:
 *   out_of_stock  : available <= 0 and it sold in the window
 *   will_run_out  : daysOfCover < supplier lead time (stock would run out before a new order could arrive)
 *   below_threshold: available <= threshold and the incoming purchase orders do not lift it above the threshold
 * "Days observed" is limited by how long the book has existed and how long the shop has been recording sales, so
 * young data is never divided by a window it did not cover; thin data is marked low-confidence instead of hidden.
 */
const URGENCY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const MIN_DAYS_FOR_CONFIDENCE = 14;
const MIN_UNITS_FOR_CONFIDENCE = 3;

function recommendations(db, opts = {}) {
  const settings = getSettings(db);
  const lookback = v.int(opts.lookbackDays ?? settings.restockLookbackDays, 'lookbackDays', { min: 7, max: 365 });
  const cover = v.int(opts.coverDays ?? settings.restockCoverDays, 'coverDays', { min: 1, max: 365 });
  const now = opts.now ? new Date(opts.now) : new Date();
  const since = new Date(now.getTime() - lookback * DAY).toISOString();

  const firstSale = db.prepare("SELECT MIN(created_at) AS t FROM sales WHERE status = 'completed'").get().t;
  const historyDays = firstSale ? Math.max(0, (now - new Date(firstSale)) / DAY) : 0;

  const sold = new Map(db.prepare(`SELECT si.book_id, SUM(si.quantity) AS q FROM sale_items si JOIN sales s ON s.id = si.sale_id
                                    WHERE s.status = 'completed' AND s.created_at >= ? GROUP BY si.book_id`).all(since).map((r) => [r.book_id, r.q]));
  const onOrder = new Map(db.prepare(`SELECT i.book_id, SUM(i.qty_ordered - i.qty_received) AS q FROM purchase_order_items i
                                       JOIN purchase_orders po ON po.id = i.po_id WHERE po.status IN ('ordered','partially_received') GROUP BY i.book_id`)
    .all().map((r) => [r.book_id, r.q]));
  const supplierRows = db.prepare(`SELECT sb.book_id, s.id, s.name, s.lead_time_days, sb.unit_cost_cents FROM supplier_books sb
                                     JOIN suppliers s ON s.id = sb.supplier_id WHERE s.active = 1 ORDER BY sb.unit_cost_cents, s.lead_time_days`).all();
  const suppliers = new Map();
  for (const r of supplierRows) {
    if (!suppliers.has(r.book_id)) suppliers.set(r.book_id, []);
    suppliers.get(r.book_id).push({ supplierId: r.id, name: r.name, unitCostCents: r.unit_cost_cents, leadTimeDays: r.lead_time_days });
  }

  const out = [];
  for (const b of db.prepare('SELECT * FROM books WHERE active = 1').all()) {
    const unitsSold = sold.get(b.id) || 0;
    const bookAgeDays = (now - new Date(b.created_at)) / DAY;
    const observedDays = Math.max(1, Math.min(lookback, bookAgeDays, firstSale ? historyDays : 0));
    const velocity = unitsSold / observedDays;
    const available = b.stock_qty - b.reserved_qty;
    const incoming = onOrder.get(b.id) || 0;
    const threshold = b.low_stock_threshold ?? settings.defaultLowStockThreshold;
    const supp = suppliers.get(b.id) || [];
    const leadTime = supp.length ? Math.min(...supp.map((s) => s.leadTimeDays)) : settings.restockDefaultLeadTimeDays;
    const daysOfCover = velocity > 0 ? available / velocity : null;

    const reasons = [];
    let urgency = null;
    if (unitsSold > 0 && available <= 0) {
      reasons.push(`Out of stock, but ${unitsSold} sold in the last ${observedDays < lookback ? 'observed ' + round1(observedDays) : lookback} days`);
      urgency = 'critical';
    }
    if (velocity > 0 && daysOfCover > 0 && daysOfCover < leadTime) {
      reasons.push(`About ${round1(daysOfCover)} days of stock left at ${round2(velocity)}/day, less than the ${leadTime}-day supplier lead time`);
      urgency = urgency || 'high';
    }
    if (available <= threshold && !(available + incoming > threshold)) {
      reasons.push(`Available stock ${available} is at or below the low-stock threshold of ${threshold}`);
      urgency = urgency || 'medium';
    }
    if (!reasons.length) continue;

    // Already-ordered stock that will cover the shortfall downgrades but never hides the row.
    if (incoming > 0) reasons.push(`${incoming} already on order from suppliers`);
    const target = Math.ceil(velocity * cover) + threshold;
    const suggestedQty = Math.max(1, target - (available + incoming));
    const caveats = [];
    const confidence = observedDays >= MIN_DAYS_FOR_CONFIDENCE && unitsSold >= MIN_UNITS_FOR_CONFIDENCE ? 'normal' : 'low';
    if (observedDays < MIN_DAYS_FOR_CONFIDENCE) caveats.push(`Only ${round1(observedDays)} day(s) of sales history for this title; the sales rate is a rough guess`);
    if (unitsSold < MIN_UNITS_FOR_CONFIDENCE) caveats.push(unitsSold === 0 ? 'No recent sales; suggestion is based on the low-stock threshold only' : `Only ${unitsSold} unit(s) sold, too few to trust the rate`);
    if (available <= 0 && unitsSold > 0) caveats.push('Time spent out of stock may understate true demand');
    if (!supp.length) caveats.push('No supplier is linked to this book yet');
    const cheapest = supp[0] || null;

    out.push({
      bookId: b.id, title: b.title, author: b.author, edition: b.edition, isbn: b.isbn,
      location: [b.aisle && `Aisle ${b.aisle}`, b.rack && `Rack ${b.rack}`, b.shelf && `Shelf ${b.shelf}`].filter(Boolean).join(' · '),
      urgency, reasons, caveats, confidence,
      metrics: {
        unitsSold, windowDays: lookback, observedDays: round1(observedDays), velocityPerDay: round2(velocity),
        stockQty: b.stock_qty, reservedQty: b.reserved_qty, availableQty: available, onOrderQty: incoming,
        threshold, daysOfCover: daysOfCover === null ? null : round1(daysOfCover), leadTimeDays: leadTime,
        coverDays: cover, targetStock: target,
      },
      suggestedQty,
      suppliers: supp,
      estimatedCostCents: cheapest ? cheapest.unitCostCents * suggestedQty : null,
    });
  }

  out.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    || (a.metrics.daysOfCover ?? Infinity) - (b.metrics.daysOfCover ?? Infinity)
    || b.metrics.velocityPerDay - a.metrics.velocityPerDay
    || a.title.localeCompare(b.title));

  return {
    parameters: { lookbackDays: lookback, coverDays: cover },
    dataNotes: firstSale
      ? (historyDays < lookback ? [`Sales have only been recorded for ${round1(historyDays)} day(s); rates use the days actually observed and may be unreliable.`] : [])
      : ['No sales have been recorded yet, so only low-stock-threshold rules can fire.'],
    items: out,
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

module.exports = { recommendations };
