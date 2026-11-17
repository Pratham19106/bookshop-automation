import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { billTotals, bookName, fmt, fmtDate, fmtDateTime, label, money, parseMoney, roundRupee, today } from '../lib/format';
import { useCached, useDebounced } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { broadcastEvent } from '../lib/events';
import { Actions, Async, Badge, BookPicker, Button, Empty, Field, Modal, PageTitle, Tabs, useAction } from '../lib/ui';

const METHODS = ['cash', 'upi', 'card', 'other'];
const OPEN = ['placed', 'ready', 'out_for_delivery'];
const MethodSelect = ({ value, onChange, id }) => (
  <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select>
);

function OrderForm({ order, onClose, onSaved }) {
  const { isOwner, settings, maxDiscountPercent } = useAuth();
  const edit = !!order;
  const [f, setF] = useState({
    name: order?.customerName ?? '', phone: order?.customerPhone ?? '', type: order?.deliveryType ?? 'pickup', address: order?.deliveryAddress ?? '',
    promised: order?.promisedDate ?? '', notes: order?.notes ?? '', discount: order?.discountPercent ? String(order.discountPercent) : '', adv: '', advMethod: 'cash',
  });
  const [lines, setLines] = useState((order?.items ?? []).map((i) => ({ bookId: i.bookId, title: i.title, price: i.unitPriceCents, quantity: i.quantity })));
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const add = (b) => setLines((l) => (l.some((x) => x.bookId === b.id) ? l.map((x) => (x.bookId === b.id ? { ...x, quantity: x.quantity + 1 } : x)) : [...l, { bookId: b.id, title: bookName(b), price: b.priceCents, quantity: 1 }]));
  // Whole rupees, same rounding as the server.
  const { sub, disc, tax } = billTotals(lines.reduce((s, l) => s + roundRupee(l.price) * l.quantity, 0), f.discount, order ? order.taxPercent : settings.taxPercent);

  const [save, busy] = useAction(async () => {
    if (!lines.length) throw new Error('Add at least one book');
    const body = {
      customerName: f.name, customerPhone: f.phone, deliveryType: f.type, deliveryAddress: f.address, promisedDate: f.promised || null, notes: f.notes,
      discountPercent: Number(f.discount) || 0, items: lines.map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
    };
    if (!edit && f.adv.trim()) {
      const cents = parseMoney(f.adv);
      if (!cents) throw new Error('Enter the advance in rupees, like 200');
      body.advancePayment = { amountCents: cents, method: f.advMethod };
    }
    const saved = edit ? await put(`/orders/${order.id}`, body) : await post('/orders', body);
    toast(edit ? 'Order updated' : `Order ${saved.orderNo} placed`);
    onSaved?.(); onClose();
  });

  return (
    <Modal title={edit ? `Edit order ${order.orderNo}` : 'New phone order'} wide onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid sm:grid-cols-2 gap-x-2.5">
          <Field label="Customer name *" htmlFor="cn"><input id="cn" className="input" value={f.name} onChange={set('name')} maxLength={100} required /></Field>
          <Field label="Phone *" htmlFor="cp"><input id="cp" className="input font-mono" value={f.phone} onChange={set('phone')} maxLength={30} required inputMode="tel" /></Field>
          <Field label="Fulfilment" htmlFor="dt"><select id="dt" className="input" value={f.type} onChange={set('type')}><option value="pickup">Customer picks up</option><option value="delivery">Deliver to customer</option></select></Field>
          <Field label="Promised date" htmlFor="pd"><input id="pd" type="date" className="input" value={f.promised} onChange={set('promised')} /></Field>
        </div>
        {f.type === 'delivery' && <Field label="Delivery address *" htmlFor="addr"><textarea id="addr" className="input" maxLength={400} value={f.address} onChange={set('address')} /></Field>}
        <Field label="Notes" htmlFor="nt"><input id="nt" className="input" maxLength={500} value={f.notes} onChange={set('notes')} /></Field>
        <h3>Books</h3>
        <BookPicker onPick={add} />
        {lines.length === 0 ? <div className="empty mt-2">Add the books the customer asked for.</div> : (
          <div className="table-wrap mt-2">
            <table className="ledger">
              <thead><tr><th>Book</th><th className="num">Price</th><th>Qty</th><th className="num">Total</th><th /></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.bookId}><td>{l.title}</td><td className="num">{fmt(l.price)}</td>
                  <td><input type="number" min="1" className="input !w-16 font-mono" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.bookId === l.bookId ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : x)))} /></td>
                  <td className="num">{fmt(l.price * l.quantity)}</td>
                  <td><button type="button" className="btn btn-sm btn-danger" onClick={() => setLines((ls) => ls.filter((x) => x.bookId !== l.bookId))}>✕</button></td></tr>))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-x-2.5 mt-2">
          <Field label={`Discount %${isOwner ? '' : ` (max ${maxDiscountPercent}%)`}`} htmlFor="od"><input id="od" type="number" min="0" max="100" step="0.5" className="input font-mono" value={f.discount} onChange={set('discount')} /></Field>
          {!edit && (
            <Field label={`Advance payment (${settings.currencySymbol}, optional)`} htmlFor="adv">
              <div className="flex gap-1.5"><input id="adv" className="input font-mono" inputMode="decimal" value={f.adv} onChange={set('adv')} /><MethodSelect value={f.advMethod} onChange={(v) => setF((s) => ({ ...s, advMethod: v }))} /></div>
            </Field>
          )}
        </div>
        <div className="sum">
          <div><span>Subtotal</span><span>{fmt(sub)}</span></div>{disc > 0 && <div><span>Discount</span><span>− {fmt(disc)}</span></div>}
          {tax > 0 && <div><span>Tax</span><span>{fmt(tax)}</span></div>}<div className="grand"><span>Total</span><span>{fmt(sub - disc + tax)}</span></div>
        </div>
        <Actions><button type="button" className="btn" onClick={onClose}>Cancel</button><button id="save-order" className="btn btn-primary" disabled={busy}>{edit ? 'Save changes' : 'Place order & reserve stock'}</button></Actions>
      </form>
    </Modal>
  );
}

function MoneyDialog({ title, intro, initial, action, done, onClose, children }) {
  const { settings } = useAuth();
  const [amt, setAmt] = useState(money(initial));
  const [m, setM] = useState('cash');
  const go = async () => {
    const cents = parseMoney(amt);
    if (!cents) throw new Error('Enter a valid amount');
    await action(cents, m); toast(done); onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-2">{intro}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={`Amount (${settings.currencySymbol})`} htmlFor="amt"><input id="amt" className="input font-mono" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Method" htmlFor="m"><MethodSelect id="m" value={m} onChange={setM} /></Field>
      </div>
      {children}
      <Actions><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>Save</Button></Actions>
    </Modal>
  );
}

function OrderDetail({ id, onClose, onChange }) {
  const st = useCached(['orders', 'detail', id], () => get(`/orders/${id}`));
  const [sub, setSub] = useState(null);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const o = st.data;
  const refresh = () => { st.reload(); onChange?.(); };
  const step = (status, msg) => async () => { await post(`/orders/${id}/status`, { status }); toast(msg); refresh(); };

  if (!o) return <Modal title="Order" wide onClose={onClose}><Async state={st}>{() => null}</Async></Modal>;
  const open = OPEN.includes(o.status);
  const units = o.items.reduce((s, i) => s + i.quantity, 0);
  const canHandOver = (o.status === 'ready' && o.deliveryType === 'pickup') || o.status === 'out_for_delivery';

  return (
    <>
      <Modal title={`Order ${o.orderNo}`} wide onClose={onClose}>
        <div className="flex flex-wrap items-center gap-1.5"><Badge status={o.status} /><Badge status={o.paymentStatus} /><span className="text-muted text-[.85rem]">Fulfilment and payment are tracked separately.</span></div>
        <dl className="kv mt-2.5">
          <dt>Customer</dt><dd>{o.customerName} · <a href={`tel:${o.customerPhone}`} className="font-mono">{o.customerPhone}</a></dd>
          <dt>Fulfilment</dt><dd>{o.deliveryType === 'delivery' ? `Delivery to ${o.deliveryAddress}` : 'Pickup at shop'}</dd>
          <dt>Promised</dt><dd>{o.promisedDate ? fmtDate(o.promisedDate) : '—'}</dd>
          {o.notes && <><dt>Notes</dt><dd>{o.notes}</dd></>}
          <dt>Taken</dt><dd>{fmtDateTime(o.createdAt)}</dd>
          {o.saleId && <><dt>Bill</dt><dd><Link to={`/receipt/${o.saleId}`} target="_blank">View receipt</Link></dd></>}
          {o.status === 'cancelled' && <><dt>Cancelled</dt><dd>{o.cancelReason}</dd></>}
        </dl>
        <div className="table-wrap">
          <table className="ledger">
            <thead><tr><th>Book</th><th>Pick from</th><th className="num">Price</th><th className="num">Qty</th><th className="num">Total</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.bookId}><td>{i.title}</td><td className="text-[.85rem]">{i.location || '—'}</td><td className="num">{fmt(i.unitPriceCents)}</td><td className="num">{i.quantity}</td><td className="num">{fmt(i.lineTotalCents)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="sum mt-2">
          <div><span>Subtotal</span><span>{fmt(o.subtotalCents)}</span></div>
          {o.discountCents > 0 && <div><span>Discount ({o.discountPercent}%)</span><span>− {fmt(o.discountCents)}</span></div>}
          {o.taxCents > 0 && <div><span>Tax</span><span>{fmt(o.taxCents)}</span></div>}
          <div className="grand"><span>Total</span><span>{fmt(o.totalCents)}</span></div>
          <div><span>Paid so far</span><span>{fmt(o.paidCents)}</span></div>
          {open && <div><span>Balance due</span><strong>{fmt(o.balanceCents)}</strong></div>}
        </div>
        {o.payments.length > 0 && (
          <><h3>Payments</h3><div className="table-wrap"><table className="ledger"><tbody>
            {o.payments.map((p) => <tr key={p.id}><td>{fmtDateTime(p.createdAt)}</td><td>{label(p.method)}</td><td>{p.note}</td><td className={`num ${p.amountCents < 0 ? 'text-brick' : ''}`}>{fmt(p.amountCents)}</td></tr>)}
          </tbody></table></div></>
        )}
        {o.paymentStatus === 'refund_due' && <div className="notice notice-bad mt-2.5">This order was cancelled after {fmt(o.paidCents)} was paid. Refund the customer and record it below.</div>}
        <Actions>
          {open && o.balanceCents > 0 && <button className="btn" onClick={() => setSub('pay')}>Record payment</button>}
          {o.paidCents > 0 && o.status !== 'completed' && <button className="btn" onClick={() => setSub('refund')}>Record refund</button>}
          {['placed', 'ready'].includes(o.status) && <button className="btn" onClick={() => setSub('edit')}>Edit</button>}
          {open && <button className="btn btn-danger" onClick={() => setSub('cancel')}>Cancel order</button>}
          {o.status === 'placed' && <Button variant="primary" id="ready" onClick={step('ready', 'Marked ready')}>Mark ready</Button>}
          {o.status === 'ready' && o.deliveryType === 'delivery' && <Button variant="primary" onClick={step('out_for_delivery', 'Out for delivery')}>Out for delivery</Button>}
          {o.status === 'out_for_delivery' && <Button onClick={step('ready', 'Back to ready')}>Delivery failed – back to ready</Button>}
          {canHandOver && <button id="fulfil" className="btn btn-primary" onClick={() => setSub('fulfil')}>{o.deliveryType === 'delivery' ? 'Delivered' : 'Handed over'} – complete &amp; bill</button>}
        </Actions>
      </Modal>

      {sub === 'edit' && <OrderForm order={o} onClose={() => setSub(null)} onSaved={refresh} />}
      {sub === 'pay' && <MoneyDialog title="Record payment" intro={<>Balance due: <strong>{fmt(o.balanceCents)}</strong></>} initial={o.balanceCents} done="Payment recorded"
        action={(amountCents, m) => post(`/orders/${id}/payments`, { amountCents, method: m })} onClose={() => { setSub(null); refresh(); }} />}
      {sub === 'refund' && <MoneyDialog title="Record refund" intro={<>Paid so far: <strong>{fmt(o.paidCents)}</strong></>} initial={o.paidCents} done="Refund recorded"
        action={(amountCents, m) => post(`/orders/${id}/refund`, { amountCents, method: m })} onClose={() => { setSub(null); refresh(); }} />}
      {sub === 'cancel' && (
        <Modal title="Cancel order" onClose={() => setSub(null)}>
          <p className="mb-2">Reserved copies go back on the shelf{o.paidCents ? '; a refund will be due' : ''}.</p>
          <Field label="Reason (required)" htmlFor="why"><input id="why" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Actions><Button onClick={() => setSub(null)}>Keep order</Button>
            <Button variant="danger" onClick={async () => { await post(`/orders/${id}/cancel`, { reason }); toast('Order cancelled'); setSub(null); refresh(); }}>Cancel order</Button></Actions>
        </Modal>
      )}
      {sub === 'fulfil' && (
        <Modal title="Complete order" onClose={() => setSub(null)}>
          <p className="mb-2">This creates the bill and removes {units} item(s) from stock. It can only be done once.</p>
          {o.balanceCents > 0
            ? <><p className="mb-2">Collect the balance of <strong>{fmt(o.balanceCents)}</strong> now.</p><Field label="Payment method" htmlFor="m"><MethodSelect id="m" value={method} onChange={setMethod} /></Field></>
            : <p className="text-olive mb-2">Fully paid already.</p>}
          <Actions><Button onClick={() => setSub(null)}>Not yet</Button>
            <Button variant="primary" id="complete" onClick={async () => { await post(`/orders/${id}/fulfil`, o.balanceCents > 0 ? { paymentMethod: method } : {}); broadcastEvent('sale', { orderId: id }); toast('Order completed and billed'); setSub(null); refresh(); }}>Complete &amp; bill</Button></Actions>
        </Modal>
      )}
    </>
  );
}

export default function Orders() {
  const [status, setStatus] = useState('open');
  const [payment, setPayment] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const st = useCached(['orders', 'list', status, payment, dq], () => get(`/orders${qs({ status, payment, q: dq, limit: 100 })}`));
  const tabs = [['open', 'Open'], ['placed', 'New'], ['ready', 'Ready'], ['out_for_delivery', 'Out for delivery'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['', 'All']];

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex items-center gap-2">
            <button id="new" className="btn btn-primary" onClick={() => setAdding(true)}>
              + New order
            </button>
          </div>
        }
      >
        Phone Orders
      </PageTitle>
      <Tabs tabs={tabs} value={status} onChange={setStatus} />
      <div className="toolbar">
        <div className="flex-1 min-w-[200px]"><label htmlFor="q">Search order no., name or phone</label><input id="q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label htmlFor="pay">Payment</label>
          <select id="pay" className="input" value={payment} onChange={(e) => setPayment(e.target.value)}><option value="">Any</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="refund_due">Refund due</option></select></div>
      </div>
      <Async state={st}>
        {(r) => r.items.length === 0 ? <Empty>No orders here.</Empty> : (
          <div className="table-wrap">
            <table className="ledger">
              <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Promised</th><th className="num">Total</th><th>Fulfilment</th><th>Payment</th></tr></thead>
              <tbody>{r.items.map((o) => (
                <tr key={o.id} className="row-click" onClick={() => setOpen(o.id)}>
                  <td className="font-mono font-bold">{o.orderNo}</td>
                  <td>{o.customerName}<div className="text-muted text-[.8rem] font-mono">{o.customerPhone}</div></td>
                  <td>{label(o.deliveryType)}</td>
                  <td>{o.promisedDate ? fmtDate(o.promisedDate) : '—'} {o.promisedDate && o.promisedDate < today() && OPEN.includes(o.status) && <Badge kind="bad">overdue</Badge>}</td>
                  <td className="num">{fmt(o.totalCents)}</td><td><Badge status={o.status} /></td><td><Badge status={o.paymentStatus} /></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      {adding && <OrderForm onClose={() => setAdding(false)} onSaved={st.reload} />}
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
    </div>
  );
}
