import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { bookName, fmt } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Async, Badge, Empty, PageTitle } from '../lib/ui';

export default function Restock() {
  const { settings } = useAuth();
  const nav = useNavigate();
  const [p, setP] = useState({ lookbackDays: settings.restockLookbackDays || 30, coverDays: settings.restockCoverDays || 21 });
  const [applied, setApplied] = useState(p);
  const [picked, setPicked] = useState({}); // index -> quantity
  const st = useLoad(() => get(`/restock${qs(applied)}`), [applied]);

  const createPo = (items) => {
    const chosen = Object.entries(picked).map(([i, quantity]) => ({ r: items[Number(i)], quantity }));
    if (!chosen.length) return toast('Tick at least one book first', 'bad');
    // Pre-select the supplier that is cheapest for the most selected books.
    const tally = {};
    chosen.forEach(({ r }) => { const s = r.suppliers[0]?.supplierId; if (s) tally[s] = (tally[s] || 0) + 1; });
    const supplierId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    nav('/purchases', { state: { poPrefill: { supplierId, items: chosen.map(({ r, quantity }) => ({ bookId: r.bookId, title: bookName(r), quantity })) } } });
    return undefined;
  };

  return (
    <div>
      <PageTitle>Restocking Recommendations</PageTitle>
      <p className="text-muted mb-2">Rule-based and fully explained: each suggestion shows the sales and stock figures behind it. Nothing is ordered automatically.</p>
      <div className="toolbar">
        <div><label htmlFor="lb">Sales analysed over (days)</label><input id="lb" type="number" min="7" max="365" className="input font-mono" value={p.lookbackDays} onChange={(e) => setP({ ...p, lookbackDays: e.target.value })} /></div>
        <div><label htmlFor="cv">Order enough to cover (days)</label><input id="cv" type="number" min="1" max="365" className="input font-mono" value={p.coverDays} onChange={(e) => setP({ ...p, coverDays: e.target.value })} /></div>
        <button className="btn" onClick={() => { setApplied({ ...p }); setPicked({}); }}>Recalculate</button>
      </div>
      <Async state={st}>
        {(d) => (
          <>
            {d.dataNotes.map((n) => <div key={n} className="notice notice-warn">{n}</div>)}
            {d.items.length === 0 ? <Empty>Nothing needs restocking right now.</Empty> : (
              <>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted">{d.items.length} title(s) need attention. Tick the ones to order.</span>
                  <button id="mkpo" className="btn btn-primary" onClick={() => createPo(d.items)}>Create purchase order from selected…</button>
                </div>
                <div className="table-wrap"><table className="ledger">
                  <thead><tr><th /><th>Book</th><th>Why it was flagged</th><th className="num">Suggested</th><th>Best supplier</th></tr></thead>
                  <tbody>{d.items.map((r, i) => (
                    <tr key={`${r.bookId}`}>
                      <td><input type="checkbox" aria-label={`Select ${r.title}`} checked={i in picked} onChange={(e) => setPicked((s) => { const n = { ...s }; if (e.target.checked) n[i] = r.suggestedQty; else delete n[i]; return n; })} /></td>
                      <td><strong>{r.title}</strong>{r.edition && <em className="text-muted"> ({r.edition})</em>}
                        <div className="flex gap-1 mt-0.5"><Badge kind={r.urgency === 'critical' ? 'critical' : r.urgency === 'high' ? 'bad' : 'warn'}>{r.urgency}</Badge>{r.confidence === 'low' && <Badge>low confidence</Badge>}</div>
                        <div className="text-muted text-[.8rem]">{r.location}</div></td>
                      <td>
                        <ul className="list-disc pl-4">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                        {r.caveats.map((c) => <div key={c} className="text-ochre text-[.82rem]">⚠ {c}</div>)}
                        <div className="text-muted text-[.8rem] font-mono flex flex-wrap gap-x-3.5 mt-0.5">
                          <span>Sold <b className="text-ink">{r.metrics.unitsSold}</b> in {r.metrics.observedDays}d (<b className="text-ink">{r.metrics.velocityPerDay}</b>/day)</span>
                          <span>Available <b className="text-ink">{r.metrics.availableQty}</b>{r.metrics.reservedQty ? ` (+${r.metrics.reservedQty} reserved)` : ''}</span>
                          <span>On order <b className="text-ink">{r.metrics.onOrderQty}</b></span><span>Cover <b className="text-ink">{r.metrics.daysOfCover ?? '—'}</b> d</span>
                          <span>Lead time <b className="text-ink">{r.metrics.leadTimeDays}</b> d</span><span>Alert at <b className="text-ink">{r.metrics.threshold}</b></span>
                        </div></td>
                      <td className="num">
                        <input type="number" min="1" className="input !w-20 font-mono" value={i in picked ? picked[i] : r.suggestedQty} onChange={(e) => setPicked((s) => (i in s ? { ...s, [i]: Math.max(1, Number(e.target.value) || 1) } : s))} />
                        <div className="text-muted text-[.8rem]">target {r.metrics.targetStock}</div></td>
                      <td>{r.suppliers.length === 0 ? <span className="text-muted">No supplier linked</span> : (
                        <>{r.suppliers[0].name}<div className="text-[.85rem] font-mono">{fmt(r.suppliers[0].unitCostCents)} · {r.suppliers[0].leadTimeDays}d{r.estimatedCostCents != null && <div className="text-muted">≈ {fmt(r.estimatedCostCents)}</div>}</div>
                          {r.suppliers.length > 1 && <div className="text-muted text-[.8rem]">+{r.suppliers.length - 1} other: {r.suppliers.slice(1).map((s) => `${s.name} ${fmt(s.unitCostCents)}`).join(', ')}</div>}</>
                      )}</td>
                    </tr>))}
                  </tbody>
                </table></div>
              </>
            )}
          </>
        )}
      </Async>
    </div>
  );
}
