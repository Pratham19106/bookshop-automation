import { useState } from 'react';
import { del, get, post, put, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { bookName, fmt, fmtDate, money, parseMoney } from '../lib/format';
import { useCached, useDebounced } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Actions, Async, Badge, BookPicker, Button, Empty, Field, Modal, PageTitle, useAction } from '../lib/ui';

function SupplierForm({ supplier: s, onClose, onSaved }) {
  const [f, setF] = useState({
    name: s?.name ?? '', contactPerson: s?.contactPerson ?? '', phone: s?.phone ?? '', email: s?.email ?? '', categories: s?.categories ?? '',
    leadTimeDays: String(s?.leadTimeDays ?? 7), address: s?.address ?? '', notes: s?.notes ?? '',
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [save, busy] = useAction(async () => {
    const body = { ...f, leadTimeDays: Number(f.leadTimeDays) };
    s ? await put(`/suppliers/${s.id}`, body) : await post('/suppliers', body);
    toast('Supplier saved'); onSaved?.(); onClose();
  });
  const inp = (k, label, extra = {}) => <Field label={label} htmlFor={`s-${k}`}><input id={`s-${k}`} className="input" value={f[k]} onChange={set(k)} {...extra} /></Field>;
  return (
    <Modal title={s ? `Edit ${s.name}` : 'Add supplier'} wide onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid sm:grid-cols-2 gap-x-2.5">
          {inp('name', 'Supplier name *', { required: true, maxLength: 150 })}{inp('contactPerson', 'Contact person', { maxLength: 100 })}
          {inp('phone', 'Phone', { maxLength: 40 })}{inp('email', 'Email', { type: 'email', maxLength: 200 })}
          {inp('categories', 'Categories / genres supplied', { maxLength: 300 })}{inp('leadTimeDays', 'Typical lead time (days)', { type: 'number', min: 0, max: 120 })}
        </div>
        {inp('address', 'Address', { maxLength: 400 })}{inp('notes', 'Notes (terms, payment, etc.)', { maxLength: 1000 })}
        <Actions><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save</button></Actions>
      </form>
    </Modal>
  );
}

function PriceDialog({ title, label, initial, onSave, onClose }) {
  const { settings } = useAuth();
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <Field label={`${label} (${settings.currencySymbol})`} htmlFor="c"><input id="c" className="input font-mono" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
      <Actions><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => { const c = parseMoney(v); if (c === null) throw new Error('Enter a price in rupees, like 120'); await onSave(c); toast('Quote saved'); onClose(); }}>Save</Button></Actions>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onChange }) {
  const st = useCached(['purchasing', 'supplier', id], () => get(`/suppliers/${id}`));
  const [sub, setSub] = useState(null); // 'edit' | { book } for new quote | { edit: row }
  const s = st.data;
  const refresh = () => { st.reload(); onChange?.(); };
  const saveQuote = (bookId) => async (c) => { await put(`/suppliers/${id}/books/${bookId}`, { unitCostCents: c }); refresh(); };

  return (
    <>
      <Modal title={s?.name ?? 'Supplier'} wide onClose={onClose}>
        <Async state={st}>
          {(d) => (
            <>
              <dl className="kv">
                <dt>Contact</dt><dd>{d.contactPerson || '—'}</dd><dt>Phone</dt><dd className="font-mono">{d.phone || '—'}</dd><dt>Email</dt><dd>{d.email || '—'}</dd>
                <dt>Address</dt><dd>{d.address || '—'}</dd><dt>Supplies</dt><dd>{d.categories || '—'}</dd><dt>Lead time</dt><dd>{d.leadTimeDays} days</dd>
                {d.notes && <><dt>Notes</dt><dd>{d.notes}</dd></>}
                <dt>Total bought</dt><dd><strong className="font-mono">{fmt(d.totalPurchasedCents)}</strong> (goods received)</dd>
                <dt>Status</dt><dd>{d.active ? <Badge kind="ok">active</Badge> : <Badge kind="bad">inactive</Badge>}</dd>
              </dl>
              <div className="flex gap-1.5">
                <button className="btn" onClick={() => setSub('edit')}>Edit</button>
                <Button onClick={async () => { await post(`/suppliers/${id}/active`, { active: !d.active }); refresh(); }}>{d.active ? 'Deactivate' : 'Reactivate'}</Button>
              </div>
              <h3>Books and quoted prices</h3>
              <BookPicker showStock={false} placeholder="Add a book this supplier provides — search title or ISBN…" onPick={(book) => setSub({ book })} />
              {d.books.length === 0 ? <p className="text-muted mt-2">No books linked yet. Search above to add one with this supplier’s price.</p> : (
                <div className="table-wrap mt-2"><table className="ledger">
                  <thead><tr><th>Book</th><th className="num">Quoted cost</th><th>Updated</th><th /></tr></thead>
                  <tbody>{d.books.map((b) => (
                    <tr key={b.bookId}><td><strong>{b.title}</strong>{b.edition && <em className="text-muted"> ({b.edition})</em>}<div className="text-muted text-[.8rem]">{b.author}</div></td>
                      <td className="num">{fmt(b.unitCostCents)}</td><td>{fmtDate(b.updatedAt)}</td>
                      <td className="whitespace-nowrap"><button className="btn btn-sm" onClick={() => setSub({ edit: b })}>Change price</button>{' '}
                        <Button small variant="danger" onClick={async () => { await del(`/suppliers/${id}/books/${b.bookId}`); refresh(); }}>Remove</Button></td></tr>))}
                  </tbody>
                </table></div>
              )}
              <h3>Purchase history</h3>
              {d.purchaseOrders.length === 0 ? <p className="text-muted">No purchase orders yet.</p> : (
                <div className="table-wrap"><table className="ledger">
                  <thead><tr><th>PO</th><th>Date</th><th>Status</th><th className="num">Ordered</th><th className="num">Received</th></tr></thead>
                  <tbody>{d.purchaseOrders.map((o) => <tr key={o.id}><td className="font-mono">{o.poNo}</td><td>{fmtDate(o.createdAt)}</td><td><Badge status={o.status} /></td><td className="num">{fmt(o.orderedCents)}</td><td className="num">{fmt(o.receivedCents)}</td></tr>)}</tbody>
                </table></div>
              )}
            </>
          )}
        </Async>
      </Modal>
      {sub === 'edit' && s && <SupplierForm supplier={s} onClose={() => setSub(null)} onSaved={refresh} />}
      {sub?.book && <PriceDialog title={`Quote for “${sub.book.title}”`} label={`${s.name}’s cost per copy`} initial="" onSave={saveQuote(sub.book.id)} onClose={() => setSub(null)} />}
      {sub?.edit && <PriceDialog title="Change quoted price" label="New cost" initial={money(sub.edit.unitCostCents)} onSave={saveQuote(sub.edit.bookId)} onClose={() => setSub(null)} />}
    </>
  );
}

export default function Suppliers() {
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const st = useCached(['purchasing', 'suppliers', dq, inactive], () => get(`/suppliers${qs({ q: dq, inactive })}`));
  return (
    <div>
      <PageTitle
        actions={
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              + Add supplier
            </button>
          </div>
        }
      >
        Suppliers
      </PageTitle>
      <div className="toolbar">
        <div className="flex-1 min-w-[200px]"><label htmlFor="q">Search name, contact or category</label><input id="q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="!normal-case !font-normal !tracking-normal !text-[.9rem] !text-ink flex items-center gap-1"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive</label>
      </div>
      <Async state={st}>
        {(rows) => rows.length === 0 ? <Empty>No suppliers yet.</Empty> : (
          <div className="table-wrap"><table className="ledger">
            <thead><tr><th>Supplier</th><th>Contact</th><th>Supplies</th><th className="num">Books</th><th className="num">Lead time</th><th className="num">Total bought</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className="row-click" onClick={() => setOpen(s.id)}>
                <td><strong>{s.name}</strong> {!s.active && <Badge kind="bad">inactive</Badge>}</td>
                <td>{s.contactPerson}<div className="text-muted text-[.8rem]">{s.phone} {s.email}</div></td><td>{s.categories}</td>
                <td className="num">{s.bookCount}</td><td className="num">{s.leadTimeDays} d</td><td className="num">{fmt(s.totalPurchasedCents)}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Async>
      {adding && <SupplierForm onClose={() => setAdding(false)} onSaved={st.reload} />}
      {open && <SupplierDetail id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
    </div>
  );
}
