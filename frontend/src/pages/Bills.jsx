import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgo, fmt, fmtDateTime, label, today } from '../lib/format';
import { useDebounced, useLoad } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Actions, Async, Badge, Button, Empty, Field, Modal, PageTitle } from '../lib/ui';

export function BillDialog({ id, onClose, onChange }) {
  const { isOwner } = useAuth();
  const st = useLoad(() => get(`/sales/${id}`), [id]);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const b = st.data;
  if (!b) return <Modal title="Bill" onClose={onClose}><Async state={st}>{() => null}</Async></Modal>;

  const doVoid = async () => {
    await post(`/sales/${id}/void`, { reason });
    toast('Bill voided'); onChange?.(); onClose();
  };

  return (
    <Modal title={`Bill ${b.billNo}`} wide onClose={onClose}>
      <dl className="kv">
        <dt>Date</dt><dd>{fmtDateTime(b.createdAt)}</dd>
        <dt>Status</dt><dd><Badge status={b.status} /> {b.status === 'voided' && <span className="text-muted text-[.85rem]">{b.voidReason}</span>}</dd>
        <dt>Cashier</dt><dd>{b.cashier}</dd>
        <dt>Customer</dt><dd>{b.customerName || '—'}</dd>
        <dt>Payment</dt><dd>{label(b.paymentMethod)}</dd>
        {b.orderId && <><dt>Source</dt><dd>Phone order #{b.orderId}</dd></>}
      </dl>
      <div className="table-wrap">
        <table className="ledger">
          <thead><tr><th>Item</th><th className="num">Price</th><th className="num">Qty</th><th className="num">Total</th>{isOwner && <th className="num">Cost</th>}</tr></thead>
          <tbody>
            {b.items.map((i) => (
              <tr key={i.bookId}>
                <td><strong>{i.title}</strong>{i.edition && <em className="text-muted"> ({i.edition})</em>}
                  <div className="text-muted text-[.8rem]">{i.author}{i.isbn && <> · <span className="font-mono">{i.isbn}</span></>}</div></td>
                <td className="num">{fmt(i.unitPriceCents)}</td><td className="num">{i.quantity}</td><td className="num">{fmt(i.lineTotalCents)}</td>
                {isOwner && <td className="num">{i.unitCostCents ? fmt(i.unitCostCents) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sum mt-2.5">
        <div><span>Subtotal</span><span>{fmt(b.subtotalCents)}</span></div>
        {b.discountCents > 0 && <div><span>Discount ({b.discountPercent}%)</span><span>− {fmt(b.discountCents)}</span></div>}
        {b.taxCents > 0 && <div><span>Tax ({b.taxPercent}%)</span><span>{fmt(b.taxCents)}</span></div>}
        <div className="grand"><span>Total</span><span>{fmt(b.totalCents)}</span></div>
      </div>
      {voiding ? (
        <div className="mt-3 border border-brick p-2.5">
          <p className="mb-1.5">Voiding returns the items to stock and removes this bill from all reports. It cannot be undone.</p>
          <Field label="Reason (required)" htmlFor="reason"><input id="reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Actions><Button onClick={() => setVoiding(false)}>Cancel</Button><Button variant="danger" onClick={doVoid}>Void bill</Button></Actions>
        </div>
      ) : (
        <Actions>
          {isOwner && b.status === 'completed' && !b.orderId && <Button variant="danger" onClick={() => setVoiding(true)}>Void bill…</Button>}
          <Link className="btn btn-primary" to={`/receipt/${b.id}`} target="_blank">Print receipt</Link>
        </Actions>
      )}
    </Modal>
  );
}

export default function Bills() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);
  const dq = useDebounced(q);
  const st = useLoad(() => get(`/sales${qs({ q: dq, from, to, status, limit: 100 })}`), [dq, from, to, status]);

  return (
    <div>
      <PageTitle
        actions={
          <span className="bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold px-2.5 py-1 border border-[#15803D] shadow-[2px_2px_0px_0px_#15803D]">
            Sales Register
          </span>
        }
      >
        Bills
      </PageTitle>
      <div className="toolbar">
        <div className="grow flex-1 min-w-[180px]"><label htmlFor="q">Search bill no., customer, title or ISBN</label><input id="q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label htmlFor="from">From</label><input id="from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor="to">To</label><input id="to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label htmlFor="st">Status</label>
          <select id="st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="completed">Completed</option><option value="voided">Voided</option></select></div>
      </div>
      <Async state={st}>
        {(r) => r.items.length === 0 ? <Empty>No bills match.</Empty> : (
          <>
            <div className="table-wrap">
              <table className="ledger">
                <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Payment</th><th className="num">Units</th><th className="num">Total</th><th>Status</th></tr></thead>
                <tbody>
                  {r.items.map((s) => (
                    <tr key={s.id} className="row-click" onClick={() => setOpen(s.id)}>
                      <td className="font-mono font-bold">{s.billNo}</td><td>{fmtDateTime(s.createdAt)}</td><td>{s.customerName || '—'}</td><td>{label(s.paymentMethod)}</td>
                      <td className="num">{s.units}</td><td className="num">{fmt(s.totalCents)}</td><td><Badge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted text-[.85rem] mt-1">{r.total > r.items.length ? `Showing ${r.items.length} of ${r.total}. Narrow the dates or search.` : `${r.total} bill(s)`}</p>
          </>
        )}
      </Async>
      {open && <BillDialog id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
    </div>
  );
}
