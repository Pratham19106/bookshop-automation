import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { get, qs } from '../lib/api';
import { BookCover } from '../lib/cover';
import { bookName, daysAgo, fmt, fmtDate, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { EASE, Reveal, Stagger, StaggerItem } from '../lib/motion';
import { Async, Badge, Empty, PageTitle, Tile, tone } from '../lib/ui';

// Net sales over time. The line draws itself in (slowly), then the area beneath it fades up.
function LineChart({ series }) {
  if (!series.length) return <Empty>No sales in this period.</Empty>;
  const W = 600; const H = 190; const PAD = { l: 8, r: 8, t: 14, b: 8 };
  const max = Math.max(...series.map((s) => s.netSalesCents), 1);
  const x = (i) => PAD.l + (series.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (series.length - 1));
  const y = (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const pts = series.map((s, i) => [x(i), y(s.netSalesCents)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD.b} L${pts[0][0].toFixed(1)},${H - PAD.b} Z`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Net sales over time">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(max * g)} y2={y(max * g)} stroke="#D8CFBF" strokeWidth="1" strokeDasharray="2 4" />)}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#2B2825" strokeOpacity=".35" strokeWidth="1" />
        <motion.path d={area} fill="#B0553A" fillOpacity="0.09" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.4, delay: 1.2, ease: EASE }} />
        <motion.path d={line} fill="none" stroke="#B0553A" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.2, ease: 'easeInOut' }} />
        {series.length <= 62 && pts.map(([px, py], i) => (
          <circle key={series[i].bucket} cx={px} cy={py} r="6" fill="transparent"><title>{`${series[i].bucket}: ${fmt(series[i].netSalesCents)} (${series[i].bills} bills)`}</title></circle>
        ))}
      </svg>
      <div className="flex justify-between text-muted text-xs mt-1 font-mono"><span>{series[0].bucket}</span><span>peak {fmt(max)}</span><span>{series[series.length - 1].bucket}</span></div>
    </>
  );
}

function RuledBars({ rows, name, value, format = fmt }) {
  if (!rows.length) return <Empty>Nothing in this period.</Empty>;
  const max = Math.max(...rows.map(value), 1);
  return rows.map((r, i) => (
    <div key={i} className="grid grid-cols-[minmax(80px,34%)_1fr_auto] gap-3 items-center py-1.5 border-b border-hair text-[.9rem]">
      <span className="truncate" title={name(r)}>{name(r)}</span>
      <span className="h-px bg-line relative"><motion.span className="absolute left-0 -top-[1.5px] h-[4px] bg-sage origin-left block" style={{ width: `${(value(r) / max) * 100}%` }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.2, ease: EASE, delay: 0.2 + i * 0.05 }} /></span>
      <span className="font-mono">{format(value(r))}</span>
    </div>
  ));
}

// Magazine-style feature: the top seller large, the next few as a row of covers resting on a shelf line.
function Showcase({ books }) {
  if (!books.length) return <Empty>No sales in this period yet.</Empty>;
  const [lead, ...rest] = books;
  return (
    <Stagger className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,1.6fr)] gap-x-12 gap-y-8 items-end">
      <StaggerItem className="flex gap-6 items-end">
        <BookCover book={lead} w={150} />
        <div className="pb-1 min-w-0">
          <div className="text-[.66rem] uppercase tracking-[.2em] text-terracotta font-semibold">Best seller</div>
          <div className="font-serif text-[1.9rem] leading-[1.05] mt-1.5">{lead.title}</div>
          <div className="italic font-serif text-muted mt-1">{lead.author}{lead.edition ? ` · ${lead.edition}` : ''}</div>
          <div className="mt-3 font-mono text-[.9rem]"><strong className="text-[1.4rem] font-medium">{lead.units}</strong> copies · {fmt(lead.revenueCents)}</div>
        </div>
      </StaggerItem>
      <div className="relative">
        <div className="flex gap-5 items-end pb-3 overflow-x-auto">
          {rest.slice(0, 5).map((b, i) => (
            <StaggerItem key={b.bookId} className="w-[92px] shrink-0">
              <BookCover book={b} w={92} />
              <div className="mt-2.5 text-[.8rem] leading-tight font-serif line-clamp-2" title={b.title}><span className="text-muted font-sans text-[.7rem]">{i + 2}. </span>{b.title}</div>
              <div className="font-mono text-[.75rem] text-muted">{b.units} sold</div>
            </StaggerItem>
          ))}
        </div>
        <div className="absolute left-0 right-0 bottom-[3.9rem] h-px bg-ink/25 -z-10" aria-hidden="true" />
      </div>
    </Stagger>
  );
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
        <div className="flex gap-1.5">{[['Today', 0], ['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([l, n]) => <button key={l} className="btn" onClick={() => range(n)}>{l}</button>)}</div>
      </div>
      <Async state={st}>
        {(d) => {
          const s = d.summary;
          return (
            <>
              <section className="grid lg:grid-cols-[1.5fr_1fr] gap-x-14 gap-y-8 mb-10">
                <Reveal>
                  <div className="text-[.66rem] uppercase tracking-[.2em] text-muted font-semibold">Net sales · {fmtDate(s.from)} – {fmtDate(s.to)}</div>
                  <div className="font-serif text-[4.2rem] leading-none mt-2 tracking-tight">{fmt(s.netSalesCents)}</div>
                  <p className="italic font-serif text-muted text-[1.05rem] mt-3 max-w-[34rem]">
                    {s.bills} bills and {s.unitsSold} books sold, after {fmt(s.discountCents)} of discounts and before tax.
                    {s.netSalesCents > 0 && <> Gross profit {fmt(s.grossProfitCents)}, a {((s.grossProfitCents / s.netSalesCents) * 100).toFixed(1)}% margin.</>}
                  </p>
                </Reveal>
                <Reveal delay={0.15} className="self-end">
                  {[['Today', d.periods.today], ['This week', d.periods.week], ['This month', d.periods.month]].map(([l, p]) => (
                    <div key={l} className="flex justify-between items-baseline py-2.5 border-t border-line">
                      <span className="text-[.66rem] uppercase tracking-[.16em] text-muted font-semibold">Sales {l.toLowerCase()}</span>
                      <span><span className="font-mono text-[1.3rem]">{fmt(p.netSalesCents)}</span> <span className="text-muted text-[.78rem]">{p.bills} bills</span></span>
                    </div>
                  ))}
                </Reveal>
              </section>

              <section className="mb-10">
                <h2>On the shelf this period</h2>
                <div className="border-t border-line pt-6"><Showcase books={d.bestSellers.slice(0, 6)} /></div>
              </section>

              {s.unknownCostUnits > 0 && <div className="notice notice-warn">{s.unknownCostUnits} unit(s) sold in this period have no recorded purchase cost ({fmt(s.unknownCostRevenueCents)} of sales). Gross profit counts their cost as zero, so it is overstated until costs are recorded through goods receipts.</div>}
              <Stagger className="tiles">
                {[
                  ['Net sales (revenue)', fmt(s.netSalesCents), `${s.bills} bills · ${s.unitsSold} units · before tax`],
                  ['Cost of goods sold', fmt(s.cogsCents), 'cost of the books actually sold'],
                  ['Gross profit', fmt(s.grossProfitCents), s.netSalesCents ? `${((s.grossProfitCents / s.netSalesCents) * 100).toFixed(1)}% margin` : '', tone(s.grossProfitCents)],
                  ['Operating expenses', fmt(s.operatingExpensesCents), 'rent, wages, utilities…'],
                  ['Operating profit', fmt(s.operatingProfitCents), 'gross profit − operating expenses', tone(s.operatingProfitCents)],
                  ['Stock purchases', fmt(s.purchaseSpendCents), 'value of goods received from suppliers'],
                  ['Tax collected', fmt(s.taxCents), 'passed on, not revenue'],
                  ['Net cash movement', fmt(s.netCashMovementCents), 'sales + tax − purchases − expenses', tone(s.netCashMovementCents)],
                ].map(([k, v, sub, t]) => <StaggerItem key={k}><Tile k={k} v={v} s={sub} tone={t} /></StaggerItem>)}
              </Stagger>
              <p className="text-muted text-[.85rem] mb-8 max-w-[52rem]">Revenue, purchases, cost of goods sold and profit are different measures: buying stock is not an expense of the period until the books are sold (it then appears as cost of goods sold).</p>

              <div className="grid lg:grid-cols-2 gap-x-14 gap-y-10">
                <section><h2>Net sales by {d.range.group}</h2><div className="border-t border-line pt-4"><LineChart series={d.salesSeries} /></div></section>
                <section><h2>Best-selling titles</h2><div className="border-t border-line pt-2"><RuledBars rows={d.bestSellers} name={bookName} value={(b) => b.units} format={(n) => `${n} sold`} /></div></section>
                <section><h2>Stock purchases by supplier</h2><div className="border-t border-line pt-2"><RuledBars rows={d.spendBySupplier} name={(x) => x.name} value={(x) => x.spendCents} /></div></section>
                <section><h2>Operating expenses by category</h2><div className="border-t border-line pt-2"><RuledBars rows={d.expensesByCategory} name={(x) => x.category} value={(x) => x.totalCents} /></div></section>
                <section>
                  <h2>Needs restocking <Link className="text-[.8rem] font-sans" to="/restock">view all ({d.restocking.count})</Link></h2>
                  <div className="border-t border-line">
                    {d.restocking.top.length === 0 ? <Empty>All stocked up.</Empty> : (
                      <table className="ledger !min-w-0"><tbody>{d.restocking.top.map((r) => (
                        <tr key={r.bookId}><td>{r.title}<div className="text-muted text-[.8rem]">{r.reasons[0]}</div></td><td><Badge kind={r.urgency === 'critical' ? 'critical' : 'warn'}>{r.urgency}</Badge></td><td className="num">order {r.suggestedQty}</td></tr>))}</tbody></table>
                    )}
                  </div>
                </section>
                <section>
                  <h2>Low stock <Link className="text-[.8rem] font-sans" to="/inventory">inventory</Link></h2>
                  <div className="border-t border-line">
                    {d.lowStock.items.length === 0 ? <Empty>No low-stock titles.</Empty> : (
                      <>
                        <table className="ledger !min-w-0"><tbody>{d.lowStock.items.map((b) => <tr key={b.id}><td>{bookName(b)}</td><td className={`num ${b.availableQty <= 0 ? 'text-terracotta' : 'text-ochre'}`}>{b.availableQty} left</td></tr>)}</tbody></table>
                        {d.lowStock.count > d.lowStock.items.length && <p className="text-muted text-[.85rem] mt-1">+{d.lowStock.count - d.lowStock.items.length} more</p>}
                      </>
                    )}
                  </div>
                </section>
              </div>
              <div className="tiles mt-10">
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
