import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgo, fmt, fmtDateTime, label, today } from '../lib/format';
import { useCached, useDebounced } from '../lib/hooks';
import { toast } from '../lib/overlays';
import { Actions, Async, Badge, Button, Empty, Field, Modal, PageTitle, BookPicker } from '../lib/ui';
import { broadcastEvent } from '../lib/events';
import { CheckCircle2, Clock, RotateCcw, ArrowLeftRight } from 'lucide-react';
import AdjustmentDialog from './AdjustmentDialog';
import { useShop } from '../lib/shop';

function RefundModal({ sale, item, onClose, onSuccess }) {
  const eligibleQty = item.quantity - (item.returnedQty || 0);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Same arithmetic as the server: discounted price of the copies plus the tax charged on it.
  // Whole rupees, same rounding as the server.
  const refundNet = Math.round((item.unitPriceCents * qty * (1 - (sale.discountPercent || 0) / 100)) / 100) * 100;
  const refundTotal = refundNet + Math.round((refundNet * (sale.taxPercent || 0)) / 100 / 100) * 100;

  const doRefund = async () => {
    setBusy(true);
    try {
      await post(`/sales/${sale.id}/refund`, {
        itemId: item.id,
        quantity: qty,
        reason,
      });
      broadcastEvent('return', { saleId: sale.id, type: 'refund' });
      toast(`Refund of ${fmt(refundTotal)} processed for ${qty}x ${item.title}`);
      onSuccess();
      onClose();
    } catch (e) {
      toast(e.message || 'Refund failed', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Process Refund — ${item.title}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3.5 bg-[#EFF6FF] border border-[#3B82F6] text-sm">
          <strong>Item:</strong> {item.title} ({item.author})
          <div className="text-xs text-muted mt-1 font-mono">
            Original Unit Price: {fmt(item.unitPriceCents)} · Eligible for refund: {eligibleQty} {eligibleQty === 1 ? 'copy' : 'copies'}
          </div>
        </div>

        <Field label="Return Quantity">
          <input
            type="number"
            min="1"
            max={eligibleQty}
            className="input !w-24 font-mono"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(eligibleQty, Number(e.target.value) || 1)))}
          />
        </Field>

        <Field label="Reason for Refund">
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Damaged copy, bought twice"
          />
        </Field>

        <div className="p-3.5 bg-[#FAF9F5] border-2 border-black font-mono">
          <div className="flex justify-between text-sm">
            <span>Refund Amount Due:</span>
            <strong className="text-base text-[#BE123C]">{fmt(refundTotal)}</strong>
          </div>
          <div className="text-xs text-muted mt-1">
            Physical stock for "{item.title}" will increase by +{qty} immediately.
          </div>
        </div>

        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={doRefund}>
            {busy ? 'Processing…' : `Confirm Refund (${fmt(refundTotal)})`}
          </Button>
        </Actions>
      </div>
    </Modal>
  );
}

function ExchangeModal({ sale, item, onClose, onSuccess }) {
  const eligibleQty = item.quantity - (item.returnedQty || 0);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [replacementBook, setReplacementBook] = useState(null);
  const [busy, setBusy] = useState(false);

  const priceMatches = replacementBook && replacementBook.priceCents === item.unitPriceCents;
  const availableStock = replacementBook
    ? (replacementBook.availableQty !== undefined ? replacementBook.availableQty : (replacementBook.stockQty - (replacementBook.reservedQty || 0)))
    : 0;
  const hasStock = replacementBook && availableStock >= qty;

  const doExchange = async () => {
    if (!replacementBook) return toast('Please select a replacement book', 'bad');
    if (!priceMatches) return toast('Exchange policy requires exact same price', 'bad');
    if (!hasStock) return toast('Insufficient stock for replacement book', 'bad');

    setBusy(true);
    try {
      await post(`/sales/${sale.id}/exchange`, {
        itemId: item.id,
        replacementBookId: replacementBook.id,
        quantity: qty,
        reason,
      });
      broadcastEvent('return', { saleId: sale.id, type: 'exchange' });
      toast(`Exchanged ${qty}x ${item.title} for ${replacementBook.title}`);
      onSuccess();
      onClose();
    } catch (e) {
      toast(e.message || 'Exchange failed', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Process Exchange — ${item.title}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3.5 bg-[#FAF5FF] border border-[#9333EA] text-sm">
          <strong>Original Item:</strong> {item.title}
          <div className="text-xs text-muted mt-1 font-mono">
            Original Price: <strong className="text-black">{fmt(item.unitPriceCents)}</strong> · Eligible for exchange: {eligibleQty} copies
          </div>
        </div>

        <div className="p-3 bg-[#FEFCE8] border-2 border-black text-xs font-mono">
          <strong className="text-[#B45309]">Exchange Policy Rule:</strong>
          <p className="mt-1 text-[#4B5563]">
            Replacement book must have the <strong>exact same unit price of {fmt(item.unitPriceCents)}</strong> and be available in inventory.
          </p>
        </div>

        <Field label="Exchange Quantity">
          <input
            type="number"
            min="1"
            max={eligibleQty}
            className="input !w-24 font-mono"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(eligibleQty, Number(e.target.value) || 1)))}
          />
        </Field>

        <div>
          <label className="block text-xs font-mono font-bold uppercase mb-1">
            Select Replacement Book (Price must match {fmt(item.unitPriceCents)})
          </label>
          <BookPicker
            placeholder={`Search title, author or ISBN for a ${fmt(item.unitPriceCents)} book…`}
            onPick={(b) => setReplacementBook(b)}
          />
        </div>

        {replacementBook && (
          <div className={`p-3.5 border-2 ${priceMatches ? 'border-[#15803D] bg-[#DCFCE7]/50' : 'border-[#BE123C] bg-[#FFE4E6]'}`}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <strong>Selected: {replacementBook.title}</strong>
                <div className="text-xs font-mono mt-1">
                  Replacement Price: <strong>{fmt(replacementBook.priceCents)}</strong> · Available Stock: {availableStock}
                </div>
              </div>
              <button
                type="button"
                className="text-xs font-mono font-bold text-muted hover:text-black underline"
                onClick={() => setReplacementBook(null)}
              >
                Change Book
              </button>
            </div>

            {priceMatches ? (
              <div className="text-xs font-mono font-bold text-[#15803D] mt-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Exact price matched ({fmt(item.unitPriceCents)}). Eligible for 1-to-1 exchange!</span>
              </div>
            ) : (
              <div className="text-xs font-mono font-bold text-[#BE123C] mt-2">
                ⚠ Price mismatch! Replacement is {fmt(replacementBook.priceCents)}, but exchange policy strictly requires {fmt(item.unitPriceCents)}.
              </div>
            )}
          </div>
        )}

        <Field label="Reason / Notes">
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer requested alternate edition"
          />
        </Field>

        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !priceMatches || !hasStock}
            onClick={doExchange}
          >
            {busy ? 'Processing…' : 'Complete Exchange'}
          </Button>
        </Actions>
      </div>
    </Modal>
  );
}

export function BillDialog({ id, onClose, onChange }) {
  const { isOwner, isManager } = useAuth();
  const { currentShop } = useShop();
  const st = useCached(['bills', 'detail', id], () => get(`/sales/${id}`));
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [refundTarget, setRefundTarget] = useState(null);
  const [exchangeTarget, setExchangeTarget] = useState(null);
  const [adjusting, setAdjusting] = useState(false);

  const b = st.data;
  if (!b) return <Modal title="Bill" onClose={onClose}><Async state={st}>{() => null}</Async></Modal>;

  const doVoid = async () => {
    await post(`/sales/${id}/void`, { reason });
    broadcastEvent('void', { saleId: id });
    toast('Bill voided');
    onChange?.();
    onClose();
  };

  return (
    <Modal title={`Bill ${b.billNo}`} wide onClose={onClose}>
      {/* Return window (days come from the business settings) */}
      {b.status === 'completed' && <div className="flex items-center gap-2 mb-3">
        {b.isReturnEligible ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#DCFCE7] text-[#15803D] border border-[#15803D] text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Returns and exchanges open: {b.returnDaysRemaining} day{b.returnDaysRemaining === 1 ? '' : 's'} left
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FEF3C7] text-[#B45309] border border-[#B45309] text-xs font-bold">
            <Clock className="w-3.5 h-3.5" />
            Return period over{b.returnWindowDays ? ` (${b.returnWindowDays} days from purchase)` : ''}
          </span>
        )}
      </div>}
      {currentShop?.id !== b.shopId && <p className="notice notice-warn">Switch to this bill's shop before processing a return or exchange.</p>}

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
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Price</th>
              <th className="num">Qty</th>
              <th className="num">Total</th>
              {isManager && <th className="num">Cost</th>}
              <th className="text-center">Returns / Policy</th>
            </tr>
          </thead>
          <tbody>
            {b.items.map((i) => {
              const returnedQty = i.returnedQty || 0;
              const eligibleQty = i.quantity - returnedQty;

              return (
                <tr key={i.id || i.bookId}>
                  <td>
                    <strong>{i.title}</strong>{i.edition && <em className="text-muted"> ({i.edition})</em>}
                    <div className="text-muted text-xs">{i.author}{i.isbn && <> · <span className="font-mono">{i.isbn}</span></>}</div>
                  </td>
                  <td className="num">{fmt(i.unitPriceCents)}</td>
                  <td className="num">
                    {i.quantity}
                    {returnedQty > 0 && (
                      <span className="block text-[11px] font-mono font-bold text-[#BE123C]">
                        ({returnedQty} returned)
                      </span>
                    )}
                  </td>
                  <td className="num">{fmt(i.lineTotalCents)}</td>
                  {isManager && <td className="num">{i.unitCostCents ? fmt(i.unitCostCents) : '—'}</td>}
                  <td className="text-center whitespace-nowrap">
                    {b.isReturnEligible && currentShop?.id === b.shopId && eligibleQty > 0 ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <button type="button" className="btn btn-sm" onClick={() => setAdjusting(true)}>Return / exchange</button>
                      </div>
                    ) : returnedQty >= i.quantity ? (
                      <span className="badge badge-bad font-mono text-[10px]">Fully Returned</span>
                    ) : (
                      <span className="text-muted text-xs font-mono">Expired</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {b.adjustments?.length > 0 && <section className="mt-4"><h3>Adjustment bills</h3><div className="table-wrap"><table className="ledger"><thead><tr><th>Adjustment</th><th>Date</th><th>Type</th><th>Settlement</th><th /></tr></thead><tbody>{b.adjustments.map(a=><tr key={a.id}><td>{a.adjustmentNo}</td><td>{fmtDateTime(a.createdAt)}</td><td>{a.type}</td><td>{a.netCents>0?'Collected':a.netCents<0?'Returned':'Even'} {fmt(Math.abs(a.netCents))}</td><td><Link className="btn btn-sm" to={`/adjustment/${a.id}`} target="_blank">View / print</Link></td></tr>)}</tbody></table></div></section>}
      {b.isReturnEligible && currentShop?.id === b.shopId && b.adjustments?.some(a=>a.items.some(i=>i.sign===1 && i.returnedQty<i.quantity)) && <button className="btn mt-3" onClick={()=>setAdjusting(true)}>Return a replacement</button>}

      <div className="sum mt-3">
        <div><span>Subtotal</span><span>{fmt(b.subtotalCents)}</span></div>
        {b.discountCents > 0 && <div><span>Discount ({b.discountPercent}%)</span><span>− {fmt(b.discountCents)}</span></div>}
        {b.taxCents > 0 && <div><span>Tax ({b.taxPercent}%)</span><span>{fmt(b.taxCents)}</span></div>}
        <div className="grand"><span>Total</span><span>{fmt(b.totalCents)}</span></div>
      </div>

      {/* Return & Exchange Audit Trail */}
      {b.returns?.some(r=>!b.adjustments?.some(a=>a.legacyReturnId===r.id)) && (
        <div className="mt-4 pt-3.5 border-t-2 border-black">
          <h3 className="!mt-0 !mb-2.5 text-xs uppercase font-mono font-bold tracking-wider text-black">
            Return & Exchange Audit Log ({b.returns.length})
          </h3>
          <div className="space-y-2">
            {b.returns.filter(r=>!b.adjustments?.some(a=>a.legacyReturnId===r.id)).map((r) => (
              <div
                key={r.id}
                className="p-3 bg-[#FAF9F5] border-2 border-black shadow-[2px_2px_0px_0px_#1A1A1A] text-xs font-mono flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className={`inline-block px-2 py-0.5 font-bold uppercase text-[10px] border border-black mr-2 ${
                    r.type === 'refund' ? 'bg-[#FFE4E6] text-[#BE123C]' : 'bg-[#FAF5FF] text-[#6B21A8]'
                  }`}>
                    {r.type}
                  </span>
                  <strong>Qty: {r.quantity}</strong> · <span>{r.reason}</span>
                  {r.type === 'exchange' && (
                    <div className="text-black font-semibold mt-1">
                      ⇄ Exchanged for: <em>{r.replacementTitle || `Book #${r.replacementBookId}`}</em> {r.replacementIsbn && `(${r.replacementIsbn})`}
                    </div>
                  )}
                  {r.type === 'refund' && (
                    <div className="text-[#BE123C] font-semibold mt-1">
                      ↩ Refunded to customer: {fmt(r.paidBackCents ?? r.amountCents)}{r.taxCents > 0 && <span className="text-muted font-normal"> (incl. {fmt(r.taxCents)} tax)</span>}
                    </div>
                  )}
                </div>
                <div className="text-right text-muted text-[11px]">
                  <div>{fmtDateTime(r.createdAt)}</div>
                  {r.processedBy && <div>By {r.processedBy}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {voiding ? (
        <div className="mt-4 border-2 border-[#BE123C] bg-[#FFE4E6]/40 p-3.5 shadow-[3px_3px_0px_0px_#BE123C]">
          <p className="mb-2 text-sm font-semibold text-[#9F1239]">
            Voiding returns all unreturned items to stock and removes this bill from all reports. This cannot be undone.
          </p>
          <Field label="Reason (required)" htmlFor="reason">
            <input id="reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Actions>
            <Button onClick={() => setVoiding(false)}>Cancel</Button>
            <Button variant="danger" onClick={doVoid}>Confirm Void Bill</Button>
          </Actions>
        </div>
      ) : (
        <Actions>
          {isOwner && b.status === 'completed' && !b.orderId && !b.adjustments?.length && !b.returns?.length && (
            <Button variant="danger" onClick={() => setVoiding(true)}>
              Void bill…
            </Button>
          )}
          <Link className="btn btn-primary" to={`/receipt/${b.id}`} target="_blank">
            Print receipt
          </Link>
        </Actions>
      )}

      {/* Refund Item Modal */}
      {adjusting && <AdjustmentDialog sale={b} onClose={()=>setAdjusting(false)} onSuccess={()=>{st.reload();onChange?.();}} />}
      {refundTarget && (
        <RefundModal
          sale={b}
          item={refundTarget}
          onClose={() => setRefundTarget(null)}
          onSuccess={() => {
            st.reload();
            onChange?.();
          }}
        />
      )}

      {/* Exchange Item Modal */}
      {exchangeTarget && (
        <ExchangeModal
          sale={b}
          item={exchangeTarget}
          onClose={() => setExchangeTarget(null)}
          onSuccess={() => {
            st.reload();
            onChange?.();
          }}
        />
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
  // Cached between visits; a new bill, return or void anywhere in this browser marks it stale (lib/queryClient.js).
  const st = useCached(['bills', 'list', dq, from, to, status], async () => {
    const params = qs({ q: dq, from, to, status, limit: 100 });
    const [sales, adjustments] = await Promise.all([get(`/sales${params}`), get(`/adjustments${params}`)]);
    const items = [
      ...sales.items.map(s => ({ ...s, kind: 'sale' })),
      ...adjustments.items.map(a => ({ ...a, kind: 'adjustment' })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
    return { items, total: Number(sales.total) + Number(adjustments.total) };
  });

  return (
    <div>
      <PageTitle>
        Bills
      </PageTitle>

      <div className="toolbar">
        <div className="grow flex-1 min-w-[200px]">
          <label htmlFor="q">Search bill or adjustment no., customer, title or ISBN</label>
          <input id="q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor="from">From</label>
          <input id="from" type="date" className="input font-mono" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="to">To</label>
          <input id="to" type="date" className="input font-mono" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="st">Status</label>
          <select id="st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
          </select>
        </div>
      </div>

      <Async state={st}>
        {(r) =>
          r.items.length === 0 ? (
            <Empty>No bills match.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Bill</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Payment</th>
                      <th className="num">Units</th>
                      <th className="num">Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((s) => (
                      <tr key={`${s.kind}-${s.id}`} className={s.kind === 'sale' ? 'row-click' : ''} onClick={() => s.kind === 'sale' && setOpen(s.id)}>
                        <td className="font-mono font-bold">{s.kind === 'sale' ? s.billNo : <><Link className="underline" to={`/adjustment/${s.id}`}>{s.adjustmentNo}</Link><div className="text-xs text-muted font-normal">Against {s.billNo}</div></>}</td>
                        <td>{s.kind === 'sale' ? 'Sale' : <span className="badge badge-bad">{s.type === 'refund' ? 'Refund' : 'Exchange'}</span>}</td>
                        <td>{fmtDateTime(s.createdAt)}</td>
                        <td>{s.customerName || '—'}</td>
                        <td>{s.paymentMethod ? label(s.paymentMethod) : '—'}</td>
                        <td className="num">{s.units}</td>
                        <td className="num">{s.kind === 'sale' ? fmt(s.totalCents) : `${s.netCents < 0 ? '−' : s.netCents > 0 ? '+' : ''}${fmt(Math.abs(s.netCents))}`}</td>
                        <td>{s.kind === 'sale' ? <Badge status={s.status} /> : <Link className="btn btn-sm" to={`/adjustment/${s.id}`}>View / print</Link>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted text-sm font-mono mt-2">
                {r.total > r.items.length ? `Showing ${r.items.length} of ${r.total}. Narrow the dates or search.` : `${r.total} bill(s)`}
              </p>
            </>
          )
        }
      </Async>
      {open && <BillDialog id={open} onClose={() => setOpen(null)} onChange={st.reload} />}
    </div>
  );
}
