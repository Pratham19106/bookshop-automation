import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../lib/api';
import { bookName, daysAgo, fmt, fmtDate, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { Async, Badge, Empty, PageTitle, Tile, tone } from '../lib/ui';

function Bars({ series }) {
  if (!series.length) return <Empty>No sales in this period.</Empty>;
  const max = Math.max(...series.map((s) => s.netSalesCents), 1);
  return (
    <>
      <div className="flex items-end gap-0.5 h-[150px] pt-1.5 border-b border-ink" role="img" aria-label="Net sales per period">
        {series.map((s) => <div key={s.bucket} className="flex-1 min-w-[2px] bg-ink hover:bg-brick" style={{ height: `${Math.max(2, (s.netSalesCents / max) * 100)}%` }} title={`${s.bucket}: ${fmt(s.netSalesCents)} (${s.bills} bills)`} />)}
      </div>
      <div className="flex justify-between text-muted text-xs font-mono mt-0.5"><span>{series[0].bucket}</span><span>peak {fmt(max)}</span><span>{series[series.length - 1].bucket}</span></div>
    </>
  );
}

function HBars({ rows, name, value, format = fmt }) {
  if (!rows.length) return <Empty>Nothing in this period.</Empty>;
  const max = Math.max(...rows.map(value), 1);
  return rows.map((r, i) => (
    <div key={i} className="grid grid-cols-[minmax(80px,32%)_1fr_auto] gap-2 items-center my-0.5 text-[.9rem]">
      <span className="truncate" title={name(r)}>{name(r)}</span>
      <span className="bg-tint h-2.5 border border-ink"><span className="block h-full bg-ink" style={{ width: `${(value(r) / max) * 100}%` }} /></span>
      <span className="font-mono">{format(value(r))}</span>
    </div>
  ));
}

export default function Dashboard() {
  const [f, setF] = useState({ from: daysAgo(29), to: today(), group: 'day' });
  const st = useLoad(() => get(`/dashboard${qs(f)}`), [f]);
  const range = (n) => setF((x) => ({ ...x, from: daysAgo(n), to: today() }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div>
      <PageTitle>Dashboard</PageTitle>
      <div className="toolbar">
        <div><label htmlFor="from">From</label><input id="from" type="date" className="input" value={f.from} onChange={set('from')} /></div>
        <div><label htmlFor="to">To</label><input id="to" type="date" className="input" value={f.to} onChange={set('to')} /></div>
        <div><label htmlFor="grp">Chart by</label><select id="grp" className="input" value={f.group} onChange={set('group')}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>
        <div className="flex gap-1">{[['Today', 0], ['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([l, n]) => <button key={l} className="btn" onClick={() => range(n)}>{l}</button>)}</div>
      </div>
      <Async state={st}>
        {(d) => {
          const s = d.summary;
          return (
            <>
              <div className="tiles">
                <Tile k="Sales today" v={fmt(d.periods.today.netSalesCents)} s={`${d.periods.today.bills} bills`} />
                <Tile k="Sales this week" v={fmt(d.periods.week.netSalesCents)} s={`${d.periods.week.bills} bills · since ${fmtDate(d.periods.week.from)}`} />
                <Tile k="Sales this month" v={fmt(d.periods.month.netSalesCents)} s={`${d.periods.month.bills} bills`} />
              </div>
              <h2>{fmtDate(s.from)} – {fmtDate(s.to)}</h2>
              {s.unknownCostUnits > 0 && <div className="notice notice-warn">{s.unknownCostUnits} unit(s) sold in this period have no recorded purchase cost ({fmt(s.unknownCostRevenueCents)} of sales). Gross profit counts their cost as zero, so it is overstated until costs are recorded through goods receipts.</div>}
              <div className="tiles">
                <Tile k="Net sales (revenue)" v={fmt(s.netSalesCents)} s={`${s.bills} bills · ${s.unitsSold} units · after ${fmt(s.discountCents)} discounts, before tax`} />
                <Tile k="Cost of goods sold" v={fmt(s.cogsCents)} s="cost of the books actually sold" />
                <Tile k="Gross profit" v={fmt(s.grossProfitCents)} s={s.netSalesCents ? `${((s.grossProfitCents / s.netSalesCents) * 100).toFixed(1)}% margin` : ''} tone={tone(s.grossProfitCents)} />
                <Tile k="Operating expenses" v={fmt(s.operatingExpensesCents)} s="rent, wages, utilities…" />
                <Tile k="Operating profit" v={fmt(s.operatingProfitCents)} s="gross profit − operating expenses" tone={tone(s.operatingProfitCents)} />
                <Tile k="Stock purchases" v={fmt(s.purchaseSpendCents)} s="value of goods received from suppliers" />
                <Tile k="Tax collected" v={fmt(s.taxCents)} s="passed on, not revenue" />
                <Tile k="Net cash movement" v={fmt(s.netCashMovementCents)} s="sales + tax − purchases − expenses" tone={tone(s.netCashMovementCents)} />
              </div>
              <p className="text-muted text-[.85rem] mb-3">Revenue, purchases, cost of goods sold and profit are different measures: buying stock is not an expense of the period until the books are sold (it then appears as cost of goods sold).</p>
              <div className="grid lg:grid-cols-2 gap-3">
                <section className="card"><h2>Net sales by {d.range.group}</h2><Bars series={d.salesSeries} /></section>
                <section className="card"><h2>Best-selling titles</h2><HBars rows={d.bestSellers} name={bookName} value={(b) => b.units} format={(n) => `${n} sold`} /></section>
                <section className="card"><h2>Stock purchases by supplier</h2><HBars rows={d.spendBySupplier} name={(x) => x.name} value={(x) => x.spendCents} /></section>
                <section className="card"><h2>Operating expenses by category</h2><HBars rows={d.expensesByCategory} name={(x) => x.category} value={(x) => x.totalCents} /></section>
                <section className="card">
                  <h2>Needs restocking <Link className="text-[.85rem] font-normal" to="/restock">view all ({d.restocking.count})</Link></h2>
                  {d.restocking.top.length === 0 ? <Empty>All stocked up.</Empty> : (
                    <table className="ledger !min-w-0"><tbody>{d.restocking.top.map((r) => (
                      <tr key={r.bookId}><td>{r.title}<div className="text-muted text-[.8rem]">{r.reasons[0]}</div></td><td><Badge kind={r.urgency === 'critical' ? 'critical' : 'warn'}>{r.urgency}</Badge></td><td className="num">order {r.suggestedQty}</td></tr>))}</tbody></table>
                  )}
                </section>
                <section className="card">
                  <h2>Low stock <Link className="text-[.85rem] font-normal" to="/inventory">inventory</Link></h2>
                  {d.lowStock.items.length === 0 ? <Empty>No low-stock titles.</Empty> : (
                    <>
                      <table className="ledger !min-w-0"><tbody>{d.lowStock.items.map((b) => <tr key={b.id}><td>{bookName(b)}</td><td className={`num ${b.availableQty <= 0 ? 'text-brick' : 'text-ochre'}`}>{b.availableQty} left</td></tr>)}</tbody></table>
                      {d.lowStock.count > d.lowStock.items.length && <p className="text-muted text-[.85rem] mt-1">+{d.lowStock.count - d.lowStock.items.length} more</p>}
                    </>
                  )}
                </section>
              </div>
              <div className="tiles mt-3.5">
                <Tile k="Open phone orders" v={d.openPhoneOrders.count} s={`${fmt(d.openPhoneOrders.valueCents)} to be billed`} />
                <Tile k="Open purchase orders" v={d.openPurchaseOrders} s="awaiting delivery" />
                <Tile k="Stock on hand" v={`${d.inventory.units} units`} s={`${fmt(d.inventory.valueAtCostCents)} at cost · ${fmt(d.inventory.valueAtPriceCents)} at price`} />
              </div>
            </>
          );
        }}
      </Async>
    </div>
  );
}
