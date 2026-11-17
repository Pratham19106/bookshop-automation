import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, qs } from '../lib/api';
import { daysAgo, fmt, fmtDateTime, today } from '../lib/format';
import { useCached } from '../lib/hooks';
import { Async, Empty, PageTitle, Tile } from '../lib/ui';

export default function SalesReport() {
  const franchises = useCached(['admin', 'shops'], () => get('/shops'));
  const [filters, setFilters] = useState({ from: daysAgo(29), to: today(), outlet: 'all', page: 1 });
  const report = useCached(['dashboard', 'sales-report', filters], () => get(`/sales-report${qs(filters)}`));
  const set = (key) => (event) => setFilters((old) => ({ ...old, [key]: event.target.value, page: 1 }));
  return <div>
    <PageTitle actions={<Link className="btn" to="/statement">Financial statement</Link>}>Sales Report by Shop</PageTitle>
    <div className="toolbar">
      <div><label htmlFor="report-from">From</label><input className="input" type="date" id="report-from" value={filters.from} onChange={set('from')} /></div>
      <div><label htmlFor="report-to">To</label><input className="input" type="date" id="report-to" value={filters.to} onChange={set('to')} /></div>
      <div><label htmlFor="report-outlet">Outlet</label><select className="input" id="report-outlet" value={filters.outlet} onChange={set('outlet')}>
        <option value="all">All my shops</option>
        {(franchises.data || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select></div>
    </div>
    <p className="text-sm text-muted mb-4">Sales and adjustments appear on their transaction dates. Adjustment bills reference the original sale.</p>
    <Async state={report}>{(d) => <>
      <div className="tiles"><Tile k="Sales bills" v={d.summary.bills} /><Tile k="Billed (completed)" v={fmt(d.summary.gross)} /><Tile k="Returned value" v={fmt(d.summary.refunds)} /><Tile k="Net sales after adjustments" v={fmt(d.summary.netAfterAdjustments)} /></div>
      <section className="card my-4"><h2>Sales by shop</h2><div className="table-wrap"><table className="ledger"><thead><tr><th>Outlet</th><th>Bills</th><th>Completed billed</th></tr></thead><tbody>{d.outlets.map((o) => <tr key={o.id}><td><button className="underline" onClick={() => setFilters((f) => ({ ...f, outlet: o.id, page: 1 }))}>{o.name}</button></td><td>{o.bills}</td><td>{fmt(o.total)}</td></tr>)}</tbody></table></div>{!d.outlets.length && <Empty>No sales in this period.</Empty>}</section>
      <section className="card"><h2>Sales register</h2><div className="table-wrap"><table className="ledger"><thead><tr><th>Bill</th><th>Date</th><th>Outlet</th><th>Customer</th><th>Payment</th><th>Units</th><th>Settlement</th><th>Status</th></tr></thead><tbody>{d.items.map((s) => <tr key={`${s.type}-${s.id}`}><td><Link to={s.type==='adjustment'?`/adjustment/${s.id}`:`/receipt/${s.id}`} target="_blank">{s.billNo}</Link>{s.originalBillNo && <div className="text-xs text-muted">Against {s.originalBillNo}</div>}</td><td>{fmtDateTime(s.createdAt)}</td><td>{s.outlet}</td><td>{s.customer || '—'}</td><td>{s.payment || '—'}</td><td>{s.units}</td><td>{fmt(s.totalCents)}</td><td>{s.status}</td></tr>)}</tbody></table></div>{!d.items.length && <Empty>No sales in this period.</Empty>}
        <div className="flex gap-3 items-center mt-4"><button className="btn" disabled={d.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: d.page - 1 }))}>Previous</button><span>Page {d.page} of {d.pages} · {d.total} bills</span><button className="btn" disabled={d.page >= d.pages} onClick={() => setFilters((f) => ({ ...f, page: d.page + 1 }))}>Next</button></div>
      </section>
    </>}</Async>
  </div>;
}
