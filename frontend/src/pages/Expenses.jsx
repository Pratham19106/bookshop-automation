import { useState } from 'react';
import { del, get, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgo, fmt, fmtDate, parseMoney, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { confirmBox, toast } from '../lib/overlays';
import { Async, Button, Empty, PageTitle, useAction } from '../lib/ui';

export default function Expenses() {
  const { settings } = useAuth();
  const [range, setRange] = useState({ from: daysAgo(89), to: today() });
  const [f, setF] = useState({ date: today(), category: '', description: '', amount: '' });
  const st = useLoad(() => get(`/expenses${qs(range)}`), [range]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [add, busy] = useAction(async () => {
    const cents = parseMoney(f.amount);
    if (!cents) throw new Error('Enter an amount like 1500 or 1500.50');
    await post('/expenses', { date: f.date, category: f.category, description: f.description, amountCents: cents });
    toast('Expense added'); setF((x) => ({ ...x, amount: '', description: '' })); st.reload();
  });

  return (
    <div>
      <PageTitle
        actions={
          <span className="bg-[#FEF3C7] text-[#B45309] font-mono text-xs font-bold px-2.5 py-1 border border-[#B45309] shadow-[2px_2px_0px_0px_#B45309]">
            Overhead Accounting
          </span>
        }
      >
        Operating Expenses
      </PageTitle>
      <p className="text-muted mb-2">Record rent, wages, utilities and similar costs. Stock purchases are recorded automatically through purchase orders and goods receipts — do not enter them here.</p>
      <form className="toolbar" onSubmit={add}>
        <div><label htmlFor="d">Date</label><input id="d" type="date" className="input" value={f.date} onChange={set('date')} required /></div>
        <div><label htmlFor="c">Category</label><input id="c" className="input" list="cats" maxLength={60} required placeholder="Rent, Wages…" value={f.category} onChange={set('category')} />
          <datalist id="cats">{['Rent', 'Wages', 'Utilities', 'Transport', 'Packaging', 'Repairs', 'Other'].map((c) => <option key={c} value={c} />)}</datalist></div>
        <div className="flex-1 min-w-[160px]"><label htmlFor="ds">Description</label><input id="ds" className="input" maxLength={300} value={f.description} onChange={set('description')} /></div>
        <div><label htmlFor="a">Amount ({settings.currencySymbol})</label><input id="a" className="input !w-36 font-mono" inputMode="decimal" required value={f.amount} onChange={set('amount')} /></div>
        <button className="btn btn-primary" disabled={busy}>Add expense</button>
      </form>
      <div className="toolbar">
        <div><label htmlFor="from">From</label><input id="from" type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
        <div><label htmlFor="to">To</label><input id="to" type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <Async state={st}>
        {(rows) => rows.length === 0 ? <Empty>No expenses recorded in this range.</Empty> : (
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.category}</td><td>{r.description}</td><td className="num">{fmt(r.amountCents)}</td>
                  <td><Button small variant="danger" onClick={async () => { if (await confirmBox('Delete this expense?')) { await del(`/expenses/${r.id}`); toast('Deleted'); st.reload(); } }}>Delete</Button></td></tr>
              ))}
              <tr className="bg-tint font-bold"><td colSpan={3}>Total</td><td className="num">{fmt(rows.reduce((s, r) => s + r.amountCents, 0))}</td><td /></tr>
            </tbody>
          </table></div>
        )}
      </Async>
    </div>
  );
}
