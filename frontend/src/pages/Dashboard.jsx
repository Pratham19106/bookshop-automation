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
      <div className="flex items-end gap-1 h-[160px] pt-2 border-b-2 border-black" role="img" aria-label="Net sales per period">
        {series.map((s) => (
          <div
            key={s.bucket}
            className="flex-1 min-w-[3px] bg-[#1A1A1A] hover:bg-[#CCFF00] hover:border-black transition-colors border-t border-x border-black"
            style={{ height: `${Math.max(3, (s.netSalesCents / max) * 100)}%` }}
            title={`${s.bucket}: ${fmt(s.netSalesCents)} (${s.bills} bills)`}
          />
        ))}
      </div>
      <div className="flex justify-between text-muted text-xs font-mono mt-1 font-bold">
        <span>{series[0].bucket}</span>
        <span className="text-[#15803D]">peak {fmt(max)}</span>
        <span>{series[series.length - 1].bucket}</span>
      </div>
    </>
  );
}

function HBars({ rows, name, value, format = fmt }) {
  if (!rows.length) return <Empty>Nothing in this period.</Empty>;
  const max = Math.max(...rows.map(value), 1);
  return rows.map((r, i) => (
    <div key={i} className="grid grid-cols-[minmax(90px,32%)_1fr_auto] gap-2.5 items-center my-1.5 text-xs font-mono">
      <span className="truncate font-sans font-medium text-black" title={name(r)}>
        {name(r)}
      </span>
      <span className="bg-[#F1F5F9] h-3 border border-black shadow-[1px_1px_0px_0px_#1A1A1A]">
        <span
          className="block h-full bg-[#4F46E5]"
          style={{ width: `${(value(r) / max) * 100}%` }}
        />
      </span>
      <span className="font-bold text-black">{format(value(r))}</span>
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
      <PageTitle
        actions={
          <span className="bg-[#DBEAFE] text-[#1D4ED8] font-mono text-xs font-bold px-2.5 py-1 border border-[#1D4ED8] shadow-[2px_2px_0px_0px_#1D4ED8]">
            07 · Financial Engine
          </span>
        }
      >
        Dashboard
      </PageTitle>

      <div className="toolbar">
        <div>
          <label htmlFor="from">From</label>
          <input id="from" type="date" className="input font-mono" value={f.from} onChange={set('from')} />
        </div>
        <div>
          <label htmlFor="to">To</label>
          <input id="to" type="date" className="input font-mono" value={f.to} onChange={set('to')} />
        </div>
        <div>
          <label htmlFor="grp">Chart by</label>
          <select id="grp" className="input font-mono font-bold" value={f.group} onChange={set('group')}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>
        <div className="flex gap-1.5">
          {[
            ['Today', 0],
            ['7 days', 6],
            ['30 days', 29],
            ['90 days', 89],
          ].map(([l, n]) => (
            <button key={l} className="btn" onClick={() => range(n)}>
              {l}
            </button>
          ))}
        </div>
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

              <div className="flex items-center gap-2 mb-2 mt-4">
                <h2 className="!mb-0 text-xl font-serif font-black">{fmtDate(s.from)} – {fmtDate(s.to)}</h2>
                <span className="badge badge-info">Accounting Period</span>
              </div>

              {s.unknownCostUnits > 0 && (
                <div className="notice notice-warn">
                  {s.unknownCostUnits} unit(s) sold in this period have no recorded purchase cost ({fmt(s.unknownCostRevenueCents)} of sales). Gross profit counts their cost as zero, so it is overstated until costs are recorded through goods receipts.
                </div>
              )}

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

              <p className="text-muted text-xs mb-4 font-mono">
                ℹ Revenue, purchases, cost of goods sold and profit are different measures: buying stock is not an expense of the period until the books are sold (it then appears as cost of goods sold).
              </p>

              <div className="grid lg:grid-cols-2 gap-4">
                <section className="card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
                    <h2 className="!mb-0">Net sales by {d.range.group}</h2>
                    <span className="badge badge-info">Trendline</span>
                  </div>
                  <Bars series={d.salesSeries} />
                </section>

                <section className="card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
                    <h2 className="!mb-0">Best-selling titles</h2>
                    <span className="badge badge-ok">Top Velocity</span>
                  </div>
                  <HBars rows={d.bestSellers} name={bookName} value={(b) => b.units} format={(n) => `${n} sold`} />
                </section>

                <section className="card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
                    <h2 className="!mb-0">Stock purchases by supplier</h2>
                    <span className="badge badge-warn">Spend</span>
                  </div>
                  <HBars rows={d.spendBySupplier} name={(x) => x.name} value={(x) => x.spendCents} />
                </section>

                <section className="card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
                    <h2 className="!mb-0">Operating expenses by category</h2>
                    <span className="badge badge-bad">Overheads</span>
                  </div>
                  <HBars rows={d.expensesByCategory} name={(x) => x.category} value={(x) => x.totalCents} />
                </section>

                <section className="card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
                    <h2 className="!mb-0">
                      Needs restocking <Link className="text-xs font-mono font-bold ml-1" to="/restock">view all ({d.restocking.count}) →</Link>
                    </h2>
                    <span className="badge badge-critical">Action Required</span>
                  </div>
                  {d.restocking.top.length === 0 ? (
                    <Empty>All stocked up.</Empty>
                  ) : (
                    <div className="table-wrap">
                      <table className="ledger !min-w-0">
                        <tbody>
                          {d.restocking.top.map((r) => (
                            <tr key={r.bookId}>
                              <td>
                                <strong>{r.title}</strong>
                                <div className="text-muted text-[.8rem]">{r.reasons[0]}</div>
                              </td>
                              <td>
                                <Badge kind={r.urgency === 'critical' ? 'critical' : 'warn'}>{r.urgency}</Badge>
                              </td>
                              <td className="num font-mono font-bold text-black">order {r.suggestedQty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
                    <h2 className="!mb-0">
                      Low stock <Link className="text-xs font-mono font-bold ml-1" to="/inventory">inventory →</Link>
                    </h2>
                    <span className="badge badge-warn">Watchlist</span>
                  </div>
                  {d.lowStock.items.length === 0 ? (
                    <Empty>No low-stock titles.</Empty>
                  ) : (
                    <>
                      <div className="table-wrap">
                        <table className="ledger !min-w-0">
                          <tbody>
                            {d.lowStock.items.map((b) => (
                              <tr key={b.id}>
                                <td>{bookName(b)}</td>
                                <td className={`num font-mono font-bold ${b.availableQty <= 0 ? 'text-[#BE123C]' : 'text-[#B45309]'}`}>
                                  {b.availableQty} left
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {d.lowStock.count > d.lowStock.items.length && (
                        <p className="text-muted text-xs mt-2 font-mono">
                          +{d.lowStock.count - d.lowStock.items.length} more in catalogue
                        </p>
                      )}
                    </>
                  )}
                </section>
              </div>

              <div className="tiles mt-4">
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
