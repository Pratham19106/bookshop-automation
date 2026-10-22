import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { get, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { bookName, fmt, fmtDate, fmtDateTime, money, parseMoney, uuid } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { confirmBox, toast } from '../lib/overlays';
import { Actions, Async, Badge, BookPicker, Button, Empty, Field, Modal, PageTitle, Tabs, useAction } from '../lib/ui';

// New purchase order. `prefill` = { supplierId, items: [{ bookId, title, quantity }] } when coming from restocking.
function PoForm({ prefill, onClose, onSaved }) {
  const { settings } = useAuth();
  const suppliers = useLoad(() => get('/suppliers'), []);
  const [supplierId, setSupplierId] = useState(prefill?.supplierId ? String(prefill.supplierId) : '');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState((prefill?.items ?? []).map((i) => ({ bookId: i.bookId, title: i.title, quantity: i.quantity, cost: '' })));
  const quotes = useLoad(async () => {
    if (!supplierId) return {};
    const s = await get(`/suppliers/${supplierId}`);
    return Object.fromEntries(s.books.map((b) => [b.bookId, b.unitCostCents]));
  }, [supplierId]);
  const q = quotes.data || {};
  const costOf = (l) => (l.cost.trim() !== '' ? parseMoney(l.cost) : q[l.bookId] ?? null);
  const total = lines.reduce((s, l) => s + (costOf(l) ?? 0) * l.quantity, 0);
  const patch = (id, p) => setLines((ls) => ls.map((l) => (l.bookId === id ? { ...l, ...p } : l)));

  const [save, busy] = useAction(async () => {
    if (!supplierId) throw new Error('Choose a supplier');
    if (!lines.length) throw new Error('Add at least one book');
    const po = await post('/purchase-orders', {
      supplierId: Number(supplierId), expectedDate: expected || null, notes,
      items: lines.map((l) => { const c = costOf(l); return { bookId: l.bookId, quantity: l.quantity, ...(c !== null ? { unitCostCents: c } : {}) }; }),
    });
    toast(`Purchase order ${po.poNo} placed`); onSaved?.(); onClose();
  });

  return (
    <Modal title="New purchase order" wide onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid sm:grid-cols-2 gap-x-2.5">
          <Field label="Supplier *" htmlFor="sup">
            <select id="sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>{(suppliers.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Expected delivery" htmlFor="exp"><input id="exp" type="date" className="input" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        </div>
        <Field label="Notes" htmlFor="nt"><input id="nt" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <h3>Books</h3>
        <BookPicker placeholder="Add a book — search title or ISBN…" onPick={(b) => setLines((ls) => (ls.some((l) => l.bookId === b.id) ? ls.map((l) => (l.bookId === b.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { bookId: b.id, title: bookName(b), quantity: 1, cost: '' }]))} />
        {lines.length === 0 ? <div className="empty mt-2">Search for books to order.</div> : (
          <>
            <div className="table-wrap mt-2"><table className="ledger">
              <thead><tr><th>Book</th><th>Qty</th><th>Unit cost ({settings.currencySymbol})</th><th className="num">Line total</th><th /></tr></thead>
              <tbody>{lines.map((l) => {
                const c = costOf(l);
                return (
                  <tr key={l.bookId}><td>{l.title}</td>
                    <td><input type="number" min="1" className="input !w-16 font-mono" value={l.quantity} onChange={(e) => patch(l.bookId, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} /></td>
                    <td><input className="input !w-28 font-mono" inputMode="decimal" placeholder={q[l.bookId] != null ? money(q[l.bookId]) : 'required'} value={l.cost} onChange={(e) => patch(l.bookId, { cost: e.target.value })} />
                      {supplierId && q[l.bookId] == null && l.cost.trim() === '' && <div className="text-ochre text-[.8rem]">No quote on file</div>}</td>
                    <td className="num">{c !== null ? fmt(c * l.quantity) : '—'}</td>
                    <td><button type="button" className="btn btn-sm btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.bookId !== l.bookId))}>✕</button></td></tr>
                );
              })}</tbody>
            </table></div>
            <p className="text-right mt-1"><strong>Order value: <span className="font-mono">{fmt(total)}</span></strong></p>
          </>
        )}
        <Actions><button type="button" className="btn" onClick={onClose}>Cancel</button><button id="place-po" className="btn btn-primary" disabled={busy}>Place order</button></Actions>
      </form>
    </Modal>
  );
}

function PoDetail({ id, onClose, onChange }) {
  const st = useLoad(() => get(`/purchase-orders/${id}`), [id]);
  const key = useRef(uuid()); // a double-clicked "Receive" can never receive twice
  const [qty, setQty] = useState({});
  const [note, setNote] = useState('');
  const po = st.data;
  useEffect(() => { if (po) setQty(Object.fromEntries(po.items.map((i) => [i.id, i.qtyOutstanding]))); }, [po]);
  if (!po) return <Modal title="Purchase order" wide onClose={onClose}><Async state={st}>{() => null}</Async></Modal>;
  const canReceive = ['ordered', 'partially_received'].includes(po.status);

  const receive = async () => {
    const items = po.items.map((i) => ({ poItemId: i.id, quantity: Number(qty[i.id]) || 0 })).filter((i) => i.quantity > 0);
    if (!items.length) throw new Error('Enter a received quantity for at least one line');
    await post(`/purchase-orders/${id}/receive`, { items, note, idempotencyKey: key.current });
    toast('Stock updated from goods received'); onChange?.(); onClose();
  };
  const cancel = async () => {
    if (!(await confirmBox(`Cancel ${po.poNo}? Nothing further can be received against it.`))) return;
    await post(`/purchase-orders/${id}/cancel`); toast('Order cancelled'); onChange?.(); onClose();
  };

  return (
    <Modal title={`${po.poNo} · ${po.supplier.name}`} wide onClose={onClose}>
      <div className="flex items-center gap-2"><Badge status={po.status} /><span className="text-muted text-[.85rem]">Placed {fmtDate(po.createdAt)}{po.expectedDate && ` · expected ${fmtDate(po.expectedDate)}`}</span></div>
      {po.notes && <p className="mt-1.5">{po.notes}</p>}
      <div className="table-wrap mt-2"><table className="ledger">
        <thead><tr><th>Book</th><th className="num">Unit cost</th><th className="num">Ordered</th><th className="num">Received</th>{canReceive && <th>Receive now</th>}</tr></thead>
        <tbody>{po.items.map((i) => (
          <tr key={i.id}><td><strong>{i.title}</strong>{i.edition && <em className="text-muted"> ({i.edition})</em>}</td>
            <td className="num">{fmt(i.unitCostCents)}</td><td className="num">{i.qtyOrdered}</td><td className="num">{i.qtyReceived}</td>
            {canReceive && <td>{i.qtyOutstanding > 0
              ? <><input type="number" min="0" max={i.qtyOutstanding} className="input !w-16 font-mono" value={qty[i.id] ?? ''} onChange={(e) => setQty((s) => ({ ...s, [i.id]: e.target.value }))} /> <span className="text-muted text-[.8rem]">of {i.qtyOutstanding}</span></>
              : '✓'}</td>}
          </tr>))}
        </tbody>
      </table></div>
      <p className="text-right mt-1.5">Ordered value <span className="font-mono">{fmt(po.orderedCents)}</span> · Received value <strong className="font-mono">{fmt(po.receivedCents)}</strong></p>
      {canReceive && (
        <>
          <p className="text-muted text-[.85rem] mb-1.5">Enter the quantity that actually arrived (it can be less than ordered). The remainder stays outstanding. Stock and cost update when you confirm.</p>
          <Field label="Receipt note (challan no., damages…)" htmlFor="rn"><input id="rn" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </>
      )}
      {po.receipts.length > 0 && (
        <><h3>Goods receipts</h3><div className="table-wrap"><table className="ledger"><tbody>
          {po.receipts.map((r) => <tr key={r.id}><td>{fmtDateTime(r.receivedAt)}</td><td>{r.note}</td><td>{r.user}</td><td className="num">{fmt(r.totalCents)}</td></tr>)}
        </tbody></table></div></>
      )}
      {canReceive && <Actions><Button variant="danger" onClick={cancel}>Cancel order</Button><Button variant="primary" id="receive" onClick={receive}>Confirm goods received</Button></Actions>}
    </Modal>
  );
}

export default function Purchases() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null); // null | { prefill }
  const st = useLoad(() => get(`/purchase-orders${qs({ status })}`), [status]);
  const { state } = useLocation();
  const prefill = useMemo(() => state?.poPrefill, [state]);
  useEffect(() => { if (prefill) { setForm({ prefill }); window.history.replaceState({}, ''); } }, [prefill]);

  return (
    <div>
      <PageTitle actions={<button id="new-po" className="btn btn-primary" onClick={() => setForm({})}>+ New purchase order</button>}>Purchase Orders</PageTitle>
      <Tabs tabs={[['', 'All'], ['open', 'Open'], ['received', 'Received'], ['cancelled', 'Cancelled']]} value={status} onChange={setStatus} />
      <Async state={st}>
        {(rows) => rows.length === 0 ? <Empty>No purchase orders.</Empty> : (
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>PO</th><th>Supplier</th><th>Placed</th><th>Expected</th><th className="num">Units</th><th className="num">Value</th><th>Status</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className="row-click" onClick={() => setOpen(p.id)}>
                <td className="font-mono font-bold">{p.poNo}</td><td>{p.supplier}</td><td>{fmtDate(p.createdAt)}</td><td>{p.expectedDate ? fmtDate(p.expectedDate) : '—'}</td>
                <td className="num">{p.unitsReceived}/{p.unitsOrdered}</td><td className="num">{fmt(p.orderedCents)}</td><td><Badge status={p.status} /></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Async>
      {form && <PoForm prefill={form.prefill} onClose={() => setForm(null)} onSaved={st.reload} />}
      {open && <PoDetail id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
    </div>
  );
}
