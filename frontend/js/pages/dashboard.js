import { state, html, render, raw, get, qs, fmt, fmtDate, badge, daysAgo, today, esc } from '../core.js';

const tile = (k, v, s = '', cls = '') => html`<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${s ? html`<div class="s">${s}</div>` : ''}</div>`;
const signed = (c) => (c < 0 ? 'neg' : c > 0 ? 'pos' : '');

function barChart(series) {
  if (!series.length) return html`<div class="empty">No sales in this period.</div>`;
  const max = Math.max(...series.map((s) => s.netSalesCents), 1);
  return html`<div class="bars" role="img" aria-label="Net sales per period">${series.map((s) =>
    html`<div class="bar" style="height:${Math.max(2, (s.netSalesCents / max) * 100)}%" title="${s.bucket}: ${fmt(s.netSalesCents)} (${s.bills} bills)"></div>`)}</div>
    <div class="bar-labels"><span>${series[0].bucket}</span><span>peak ${fmt(max)}</span><span>${series[series.length - 1].bucket}</span></div>`;
}
function hbars(rows, name, value, fmtFn = fmt) {
  if (!rows.length) return html`<div class="empty">Nothing in this period.</div>`;
  const max = Math.max(...rows.map(value), 1);
  return html`${rows.map((r) => html`<div class="hbar"><span class="name" title="${name(r)}">${name(r)}</span><span class="track"><span class="fill" style="display:block;width:${(value(r) / max) * 100}%"></span></span><span>${fmtFn(value(r))}</span></div>`)}`;
}

export default async function dashboard(view) {
  const f = { from: daysAgo(29), to: today(), group: 'day' };
  render(view, html`<h1>Dashboard</h1>
    <div class="toolbar">
      <div><label for="from">From</label><input id="from" type="date" value="${f.from}"></div>
      <div><label for="to">To</label><input id="to" type="date" value="${f.to}"></div>
      <div><label for="grp">Chart by</label><select id="grp"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>
      <div class="row"><button data-r="0">Today</button><button data-r="6">7 days</button><button data-r="29">30 days</button><button data-r="89">90 days</button></div>
    </div><div id="body"><div class="loading">Loading…</div></div>`);
  const body = document.getElementById('body');
  async function load() {
    try {
      const d = await get(`/dashboard${qs(f)}`);
      const s = d.summary;
      render(body, html`
        <div class="tiles">
          ${tile('Sales today', fmt(d.periods.today.netSalesCents), `${d.periods.today.bills} bills`)}
          ${tile('Sales this week', fmt(d.periods.week.netSalesCents), `${d.periods.week.bills} bills · since ${fmtDate(d.periods.week.from)}`)}
          ${tile('Sales this month', fmt(d.periods.month.netSalesCents), `${d.periods.month.bills} bills`)}
        </div>
        <h2>${fmtDate(s.from)} – ${fmtDate(s.to)}</h2>
        ${s.unknownCostUnits ? html`<div class="notice warn">${s.unknownCostUnits} unit(s) sold in this period have no recorded purchase cost (${fmt(s.unknownCostRevenueCents)} of sales). Gross profit counts their cost as zero, so it is overstated until costs are recorded via goods receipts.</div>` : ''}
        <div class="tiles">
          ${tile('Net sales (revenue)', fmt(s.netSalesCents), `${s.bills} bills · ${s.unitsSold} units · after ${fmt(s.discountCents)} discounts, before tax`)}
          ${tile('Cost of goods sold', fmt(s.cogsCents), 'cost of the books actually sold')}
          ${tile('Gross profit', fmt(s.grossProfitCents), s.netSalesCents ? `${((s.grossProfitCents / s.netSalesCents) * 100).toFixed(1)}% margin` : '', signed(s.grossProfitCents))}
          ${tile('Operating expenses', fmt(s.operatingExpensesCents), 'rent, wages, utilities…')}
          ${tile('Operating profit', fmt(s.operatingProfitCents), 'gross profit − operating expenses', signed(s.operatingProfitCents))}
          ${tile('Stock purchases', fmt(s.purchaseSpendCents), 'value of goods received from suppliers')}
          ${tile('Tax collected', fmt(s.taxCents), 'passed on, not revenue')}
          ${tile('Net cash movement', fmt(s.netCashMovementCents), 'sales + tax − purchases − expenses', signed(s.netCashMovementCents))}
        </div>
        <p class="muted small">Revenue, purchases, cost of goods sold and profit are different measures: buying stock is not an expense of the period until the books are sold (it then appears as cost of goods sold).</p>
        <div class="grid g2">
          <section class="card"><h2>Net sales by ${d.range.group}</h2>${barChart(d.salesSeries)}</section>
          <section class="card"><h2>Best-selling titles</h2>${hbars(d.bestSellers, (b) => b.title + (b.edition ? ` (${b.edition})` : ''), (b) => b.units, (n) => `${n} sold`)}</section>
          <section class="card"><h2>Stock purchases by supplier</h2>${hbars(d.spendBySupplier, (x) => x.name, (x) => x.spendCents)}</section>
          <section class="card"><h2>Operating expenses by category</h2>${hbars(d.expensesByCategory, (x) => x.category, (x) => x.totalCents)}</section>
          <section class="card"><h2>Needs restocking <a class="small" href="#/restock">view all (${d.restocking.count})</a></h2>
            ${d.restocking.top.length ? html`<table><tbody>${d.restocking.top.map((r) => html`<tr><td>${r.title}<div class="muted small">${r.reasons[0]}</div></td><td>${badge(r.urgency, r.urgency === 'critical' ? 'critical' : 'warn')}</td><td class="num">order ${r.suggestedQty}</td></tr>`)}</tbody></table>` : html`<div class="empty">All stocked up.</div>`}</section>
          <section class="card"><h2>Low stock <a class="small" href="#/inventory">inventory</a></h2>
            ${d.lowStock.items.length ? html`<table><tbody>${d.lowStock.items.map((b) => html`<tr><td>${b.title}</td><td class="num ${b.availableQty <= 0 ? 'bad' : 'warn'}">${b.availableQty} left</td></tr>`)}</tbody></table>${d.lowStock.count > d.lowStock.items.length ? html`<p class="muted small">+${d.lowStock.count - d.lowStock.items.length} more</p>` : ''}` : html`<div class="empty">No low-stock titles.</div>`}</section>
        </div>
        <div class="tiles" style="margin-top:14px">
          ${tile('Open phone orders', d.openPhoneOrders.count, `${fmt(d.openPhoneOrders.valueCents)} to be billed`)}
          ${tile('Open purchase orders', d.openPurchaseOrders, 'awaiting delivery')}
          ${tile('Stock on hand', `${d.inventory.units} units`, `${fmt(d.inventory.valueAtCostCents)} at cost · ${fmt(d.inventory.valueAtPriceCents)} at price`)}
        </div>`);
    } catch (e) { render(body, html`<div class="error-box">${e.message}</div>`); }
  }
  view.querySelector('.toolbar').addEventListener('change', (e) => {
    f.from = document.getElementById('from').value; f.to = document.getElementById('to').value; f.group = document.getElementById('grp').value; load();
  });
  view.querySelector('.toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    f.from = daysAgo(+b.dataset.r); f.to = today();
    document.getElementById('from').value = f.from; document.getElementById('to').value = f.to; load();
  });
  load();
}
