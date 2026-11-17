import { useState } from 'react';
import { get, qs } from '../lib/api';
import { fmt, fmtDate, fmtDateTime, today } from '../lib/format';
import { useCached } from '../lib/hooks';
import { Async, PageTitle } from '../lib/ui';
import { Printer } from 'lucide-react';

// Date helpers for the range presets (local calendar).
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function preset(name) {
  const now = new Date();
  if (name === 'today') return { from: today(), to: today() };
  if (name === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: iso(d), to: today() }; }
  if (name === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today() };
  if (name === 'lastMonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return null;
}
const PRESETS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['lastMonth', 'Last month']];
const METHOD_LABEL = { cash: 'Cash', card: 'Card', upi: 'UPI', other: 'Other' };

// One amount cell. `neg` prints the figure as a deduction.
function Amt({ v, neg, strong }) {
  if (v === null || v === undefined) return <td className="num px-2 py-1 border-l border-red-200">—</td>;
  const text = neg && v !== 0 ? `− ${fmt(Math.abs(v))}` : fmt(v);
  return <td className={`num px-2 py-1 border-l border-red-200 whitespace-nowrap ${strong ? 'font-bold' : ''} ${v < 0 && !neg ? 'text-[#BE123C]' : ''}`}>{text}</td>;
}

function Row({ label, cols, get: pick, neg, strong, count, note }) {
  return (
    <tr className={strong ? 'border-t border-red-700 bg-red-50/40' : 'border-t border-red-100'}>
      <td className={`px-3 py-1 ${strong ? 'font-bold' : ''}`}>{label}{note && <span className="text-muted text-[.75rem]"> {note}</span>}</td>
      {cols.map((c) => (count
        ? <td key={c.key} className="num px-2 py-1 border-l border-red-200">{pick(c)}</td>
        : <Amt key={c.key} v={pick(c)} neg={neg} strong={strong} />))}
    </tr>
  );
}

function Section({ title, span }) {
  return (
    <tr className="border-t-2 border-red-700 bg-red-50/70">
      <th colSpan={span} className="text-left px-3 py-1 text-[11px] font-black uppercase tracking-wider text-red-800">{title}</th>
    </tr>
  );
}

function Paper({ s }) {
  const cols = s.columns;
  const span = cols.length + 1;
  const single = s.shops.length === 1 ? s.shops[0] : null;
  const unknown = cols.at(-1).unknownCostUnits;
  return (
    <div className="statement-paper bg-white border-2 border-red-700 p-5 max-w-[900px] mx-auto shadow-hard print:shadow-none print:border-red-700 print:max-w-none">
      <div className="flex items-center justify-between text-[12px] font-bold text-red-700 tracking-wider border-b border-red-200 pb-1 mb-2">
        <span>FINANCIAL STATEMENT</span>
        <span className="font-mono">{s.statementNo}</span>
      </div>
      <div className="text-center my-2">
        <h1 className="!border-0 !mb-0 text-3xl font-black tracking-[2px] text-red-700 font-serif uppercase leading-none">{s.business.name}</h1>
        <div className="text-xs font-semibold text-gray-700 mt-1.5">
          {single
            ? [single.name, [single.address, single.city].filter(Boolean).join(', '), single.phone && `Ph: ${single.phone}`].filter(Boolean).join(' · ')
            : `All shops: ${s.shops.map((x) => `${x.code} ${x.name}`).join(' · ')}`}
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-[13px] my-3">
        <div><span className="font-bold text-red-700">Period:</span> <span className="font-mono border-b border-dotted border-gray-600 px-1">{fmtDate(s.from)} to {fmtDate(s.to)}</span></div>
        <div><span className="font-bold text-red-700">Prepared:</span> <span className="font-mono border-b border-dotted border-gray-600 px-1">{fmtDateTime(s.generatedAt)}</span></div>
      </div>

      <div className="overflow-x-auto border-2 border-red-700">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-red-50/40 text-red-800 text-xs font-black uppercase">
              <th className="text-left px-3 py-1.5">Particulars</th>
              {cols.map((c) => (
                <th key={c.key} className="num px-2 py-1.5 border-l border-red-700 min-w-[110px]">
                  {c.label}{c.key !== 'total' && c.name && <div className="font-normal normal-case text-[10px] text-gray-600 truncate max-w-[160px] ml-auto">{c.name}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Section title="Sales" span={span} />
            <Row label="Bills issued" cols={cols} get={(c) => c.bills} count />
            <Row label="Books sold (net of returns)" cols={cols} get={(c) => c.unitsSold} count />
            <Row label="Sales at list price" cols={cols} get={(c) => c.grossSalesCents} />
            <Row label="Less: discounts" cols={cols} get={(c) => c.discountCents} neg />
            <Row label="Less: returned books" cols={cols} get={(c) => c.refundCents} neg note={cols.some((c) => c.refundCount) ? `(${cols.at(-1).refundCount} refunds)` : ''} />
            <Row label="Add: exchange replacements" cols={cols} get={(c) => c.exchangeReplacementCents} />
            <Row label="Net sales" cols={cols} get={(c) => c.netSalesCents} strong />
            <Row label="Add: tax collected" cols={cols} get={(c) => c.taxCents} />
            <Row label="Received from customers" cols={cols} get={(c) => c.receivedCents} strong />
            <Row label="Exchanges" cols={cols} get={(c) => c.exchangeCount} count />
            <Row label="Exchange settlement (collected / paid)" cols={cols} get={(c) => c.exchangeSettlementCents} />

            <Section title="Received by payment method" span={span} />
            {s.paymentMethods.map((m) => <Row key={m} label={METHOD_LABEL[m] || m} cols={cols} get={(c) => c.payments[m]} />)}

            <Section title="Profit and loss" span={span} />
            <Row label="Net sales" cols={cols} get={(c) => c.netSalesCents} />
            <Row label="Less: cost of books sold" cols={cols} get={(c) => c.cogsCents} neg />
            <Row label="Gross profit" cols={cols} get={(c) => c.grossProfitCents} strong />
            <Row label="Gross margin" cols={cols} get={(c) => (c.grossMarginPercent === null ? '—' : `${c.grossMarginPercent}%`)} count />
            {s.expenseCategories.map((cat) => <Row key={cat} label={`Less: ${cat}`} cols={cols} get={(c) => c.expenses[cat] || 0} neg />)}
            <Row label="Total expenses" cols={cols} get={(c) => c.expensesCents} neg />
            <Row label="Operating profit" cols={cols} get={(c) => c.operatingProfitCents} strong />

            <Section title="Stock bought" span={span} />
            <Row label="Goods received from suppliers" cols={cols} get={(c) => c.purchasesCents} note="(paid out; reaches profit when the books sell)" />
          </tbody>
        </table>
      </div>

      {unknown > 0 && <p className="text-[12px] text-[#B45309] mt-2">{unknown} book(s) sold had no recorded cost, so gross profit may be overstated.</p>}
      <div className="flex items-end justify-between mt-4 text-xs">
        <div className="text-gray-600 max-w-[60%]">Voided bills are excluded. Net sales are after discounts and refunds, before tax. Prepared by {s.generatedBy}.</div>
        <div className="text-right">
          <div className="font-extrabold text-red-700 uppercase">For {s.business.name}</div>
          <div className="mt-6 pt-1 border-t border-dashed border-gray-500 text-[11px] text-gray-600">Authorised signatory</div>
        </div>
      </div>
    </div>
  );
}

export default function Statement() {
  const shops = useCached(['admin', 'shops'], () => get('/shops'));
  const [f, setF] = useState({ ...preset('month'), outlet: 'all' });
  const [which, setWhich] = useState('month');
  const st = useCached(['dashboard', 'statement', f], () => get(`/reports/statement${qs(f)}`));
  const pick = (name) => { setWhich(name); setF((x) => ({ ...x, ...preset(name) })); };
  const setDate = (k) => (e) => { setWhich('custom'); setF((x) => ({ ...x, [k]: e.target.value })); };

  return (
    <div>
      <div className="print:hidden">
        <PageTitle actions={<button className="btn btn-primary flex items-center gap-1.5" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print / Save PDF</button>}>
          Financial statement
        </PageTitle>
        <div className="toolbar">
          <div className="flex flex-wrap gap-1.5 items-end">
            {PRESETS.map(([k, l]) => <button key={k} className={`btn btn-sm ${which === k ? 'btn-primary' : ''}`} onClick={() => pick(k)}>{l}</button>)}
          </div>
          <div><label htmlFor="st-from">From</label><input id="st-from" type="date" className="input font-mono" value={f.from} max={f.to} onChange={setDate('from')} /></div>
          <div><label htmlFor="st-to">To</label><input id="st-to" type="date" className="input font-mono" value={f.to} min={f.from} onChange={setDate('to')} /></div>
          <div><label htmlFor="st-shop">Shop</label>
            <select id="st-shop" className="input" value={f.outlet} onChange={(e) => setF((x) => ({ ...x, outlet: e.target.value }))}>
              <option value="all">All my shops (one column each)</option>
              {(shops.data || []).filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </div>
        </div>
      </div>
      <Async state={st}>{(s) => <Paper s={s} />}</Async>
    </div>
  );
}
