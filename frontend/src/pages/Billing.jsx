import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BookCover } from '../lib/cover';
import { fmt, uuid } from '../lib/format';
import { confirmBox, fail, toast } from '../lib/overlays';
import { Actions, BookPicker, Button, Field, Modal, PageTitle } from '../lib/ui';
import PhysicalCashMemo from '../components/PhysicalCashMemo';

const STORAGE_KEY_ACTIVE = 'bookshop_active_bill';
const STORAGE_KEY_DRAFTS = 'bookshop_bill_drafts';

function loadStoredActive() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.cart)) return parsed;
  } catch {}
  return null;
}

function loadStoredDrafts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DRAFTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

export default function Billing() {
  const { isOwner, settings } = useAuth();

  // Load initial persistent state if available
  const initialActive = loadStoredActive();
  const [cart, setCart] = useState(initialActive?.cart || []);
  const [discount, setDiscount] = useState(initialActive?.discount ?? '');
  const [method, setMethod] = useState(initialActive?.method || 'cash');
  const [customer, setCustomer] = useState(initialActive?.customer || '');
  const [lastBill, setLastBill] = useState(null);
  const [finalizedSale, setFinalizedSale] = useState(null);
  const [drafts, setDrafts] = useState(loadStoredDrafts);
  const [showDraftsList, setShowDraftsList] = useState(false);

  const key = useRef(initialActive?.key || uuid());

  // Auto-save active bill to localStorage whenever cart/discount/method/customer changes
  useEffect(() => {
    if (cart.length > 0 || customer || discount) {
      const stateToSave = {
        cart,
        discount,
        method,
        customer,
        key: key.current,
        updatedAt: Date.now()
      };
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(stateToSave));
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    }
  }, [cart, discount, method, customer]);

  // Persist drafts list to localStorage
  const saveDraftsList = (newDrafts) => {
    setDrafts(newDrafts);
    localStorage.setItem(STORAGE_KEY_DRAFTS, JSON.stringify(newDrafts));
  };

  // Synchronize across tabs or when refocusing the window
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY_DRAFTS) {
        setDrafts(loadStoredDrafts());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const maxDisc = isOwner ? 100 : settings.staffMaxDiscountPercent;
  const sub = cart.reduce((s, l) => s + l.book.priceCents * l.quantity, 0);
  const disc = Math.round((sub * Math.round((Number(discount) || 0) * 100)) / 10000);
  const tax = Math.round(((sub - disc) * Math.round(settings.taxPercent * 100)) / 10000);
  const total = sub - disc + tax;

  const add = (book) => {
    if (book.availableQty <= 0) toast(`“${book.title}” is out of stock`, 'bad');
    setCart((c) => (c.some((l) => l.book.id === book.id)
      ? c.map((l) => (l.book.id === book.id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...c, { book, quantity: 1 }]));
  };

  const setQty = (id, q) => setCart((c) => c.map((l) => (l.book.id === id ? { ...l, quantity: Math.max(1, Math.floor(Number(q)) || 1) } : l)));
  const remove = (id) => setCart((c) => c.filter((l) => l.book.id !== id));
  
  const reset = () => {
    setCart([]);
    setDiscount('');
    setCustomer('');
    key.current = uuid();
    localStorage.removeItem(STORAGE_KEY_ACTIVE);
  };

  const refreshStock = async (cartToRefresh = cart) => {
    const fresh = await Promise.all(cartToRefresh.map((l) => get(`/books/${l.book.id}`).catch(() => l.book)));
    const updated = cartToRefresh.map((l, i) => ({ ...l, book: fresh[i] || l.book }));
    setCart(updated);
    return updated;
  };

  // Hold / Save current bill as a draft
  const saveAsDraft = () => {
    if (cart.length === 0) {
      return toast('Cannot save empty bill as draft. Add items first.', 'bad');
    }

    const draftName = customer.trim()
      ? `Customer: ${customer.trim()}`
      : `Draft #${drafts.length + 1} (${cart.reduce((s, l) => s + l.quantity, 0)} items)`;

    const newDraft = {
      id: uuid(),
      name: draftName,
      customer: customer.trim(),
      cart,
      discount,
      method,
      totalCents: total,
      itemCount: cart.reduce((s, l) => s + l.quantity, 0),
      key: key.current,
      savedAt: new Date().toISOString()
    };

    const nextDrafts = [newDraft, ...drafts];
    saveDraftsList(nextDrafts);
    reset();
    toast(`Bill parked as draft: "${draftName}". Ready for next customer!`);
    setShowDraftsList(true);
  };

  // Resume a saved draft
  const resumeDraft = async (draftId) => {
    const target = drafts.find((d) => d.id === draftId);
    if (!target) return;

    // If current cart already has items, auto-park it into drafts so nothing is lost!
    let nextDrafts = drafts.filter((d) => d.id !== draftId);
    if (cart.length > 0) {
      const autoParkedName = customer.trim()
        ? `Customer: ${customer.trim()}`
        : `Parked Draft (${cart.reduce((s, l) => s + l.quantity, 0)} items)`;
      
      const autoParked = {
        id: uuid(),
        name: autoParkedName,
        customer: customer.trim(),
        cart,
        discount,
        method,
        totalCents: total,
        itemCount: cart.reduce((s, l) => s + l.quantity, 0),
        key: key.current,
        savedAt: new Date().toISOString()
      };
      nextDrafts = [autoParked, ...nextDrafts];
      toast(`Current cart parked as draft. Resuming "${target.name}".`);
    } else {
      toast(`Resumed draft: "${target.name}".`);
    }

    saveDraftsList(nextDrafts);
    setCart(target.cart);
    setDiscount(target.discount || '');
    setMethod(target.method || 'cash');
    setCustomer(target.customer || '');
    key.current = target.key || uuid();

    // Verify stock availability upon resuming
    await refreshStock(target.cart);
  };

  // Discard a draft
  const discardDraft = async (draftId, e) => {
    e?.stopPropagation?.();
    if (await confirmBox('Permanently delete this saved draft?')) {
      const nextDrafts = drafts.filter((d) => d.id !== draftId);
      saveDraftsList(nextDrafts);
      toast('Draft deleted');
    }
  };

  const finalize = async () => {
    const bad = cart.find((l) => l.quantity > l.book.availableQty);
    if (bad) return toast(`Not enough stock for “${bad.book.title}”`, 'bad');
    try {
      const sale = await post('/sales', {
        items: cart.map((l) => ({ bookId: l.book.id, quantity: l.quantity })),
        discountPercent: Number(discount) || 0,
        paymentMethod: method,
        customerName: customer,
        idempotencyKey: key.current,
      });
      setLastBill(sale);
      setFinalizedSale(sale);
      reset();
      toast(`Sale ${sale.billNo} saved`);
    } catch (e) {
      fail(e);
      if (e.status === 409) await refreshStock(); // stock changed under us
    }
    return undefined;
  };

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex items-center gap-2">
            <span className="bg-[#DCFCE7] text-[#15803D] font-mono text-xs font-bold px-2.5 py-1 border border-[#15803D] shadow-[2px_2px_0px_0px_#15803D] hidden sm:inline-block">
              01 · POS Counter
            </span>
            {drafts.length > 0 && (
              <button
                type="button"
                className={`btn btn-sm flex items-center gap-1.5 font-bold ${
                  showDraftsList ? 'bg-[#1A1A1A] text-[#CCFF00]' : 'border-black text-black bg-[#FEF3C7]'
                }`}
                onClick={() => setShowDraftsList(!showDraftsList)}
              >
                <span>📁 Parked Drafts ({drafts.length})</span>
                <span>{showDraftsList ? '▲' : '▼'}</span>
              </button>
            )}
            {cart.length > 0 && (
              <button
                type="button"
                className="btn btn-sm border-black hover:bg-[#CCFF00] hover:text-black"
                onClick={saveAsDraft}
                title="Save this bill as draft and clear the counter for another customer"
              >
                Hold / Save Draft
              </button>
            )}
          </div>
        }
      >
        Billing
      </PageTitle>

      {/* Parked Drafts Drawer / Banner */}
      {drafts.length > 0 && showDraftsList && (
        <section className="bg-[#FEFCE8] border-2 border-black mb-4 p-3.5 shadow-[4px_4px_0px_0px_#B45309] animate-slide-up">
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b-2 border-black">
            <div className="flex items-center gap-2">
              <span className="badge badge-warn font-bold">Multi-Customer Queue</span>
              <strong className="text-sm font-serif font-black text-black">Parked Bill Drafts ({drafts.length})</strong>
            </div>
            <span className="text-[.75rem] text-[#4B5563] font-mono">
              Click "Resume" to load a draft back into the counter register.
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="bg-white border-2 border-black p-3 flex flex-col justify-between hover:shadow-[3px_3px_0px_0px_#1A1A1A] transition-all shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <strong className="text-[.9rem] text-black font-serif truncate">
                      {d.name}
                    </strong>
                    <button
                      type="button"
                      className="text-[#BE123C] text-xs font-bold hover:bg-[#FFE4E6] px-1.5 py-0.5 border border-transparent hover:border-[#BE123C]"
                      title="Discard draft"
                      onClick={(e) => discardDraft(d.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="text-[.78rem] text-muted font-mono mb-2">
                    {d.itemCount} {d.itemCount === 1 ? 'item' : 'items'} ·{' '}
                    <strong className="text-black font-bold">{fmt(d.totalCents)}</strong> ·{' '}
                    {new Date(d.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-[.75rem] text-muted line-clamp-1 italic">
                    {d.cart.map((l) => `${l.book.title} (${l.quantity})`).join(', ')}
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-[#E5E7EB] flex items-center justify-between">
                  <span className="badge text-[.68rem] uppercase">{d.method}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary text-xs font-bold"
                    onClick={() => resumeDraft(d.id)}
                  >
                    Resume Draft →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] items-start">
        {/* Book Finder Column */}
        <section className="card">
          <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
            <h2 className="!mb-0">Find a book</h2>
            <span className="badge badge-info">Barcode / ISBN Search</span>
          </div>
          <BookPicker onPick={add} autoFocus />
          <p className="text-muted text-xs font-mono mt-2.5">
            Tip: scan or type a full ISBN and press Enter to add it straight away.
          </p>
        </section>

        {/* Current Bill Column */}
        <section className="card relative">
          <div className="flex items-center justify-between pb-2 mb-3 border-b-2 border-black">
            <div className="flex items-center gap-2">
              <h2 className="!mb-0">Current bill</h2>
              {cart.length > 0 && (
                <span className="bg-[#CCFF00] text-black font-mono font-bold text-[.68rem] px-2 py-0.5 border border-black shadow-[1px_1px_0px_0px_#1A1A1A] tracking-wider" title="Active cart is saved locally in real-time">
                  ● Auto-Saved
                </span>
              )}
            </div>
            {drafts.length > 0 && !showDraftsList && (
              <button
                type="button"
                className="btn btn-sm bg-[#FEF3C7] text-black border-black text-xs font-bold"
                onClick={() => setShowDraftsList(true)}
              >
                📁 {drafts.length} Parked {drafts.length === 1 ? 'Draft' : 'Drafts'}
              </button>
            )}
          </div>

          {lastBill && (
            <div className="notice mb-3 flex flex-wrap items-center justify-between gap-1">
              <div>
                Bill <strong>{lastBill.billNo}</strong> saved — <span className="font-mono">{fmt(lastBill.totalCents)}</span>.{' '}
                <button
                  type="button"
                  onClick={() => setFinalizedSale(lastBill)}
                  className="font-bold underline ml-1 text-ink hover:text-navy cursor-pointer"
                >
                  View Cash Memo Modal
                </button>
              </div>
              <Link to={`/receipt/${lastBill.id}`} target="_blank" className="font-mono text-xs underline text-muted">
                Direct Tab ↗
              </Link>
            </div>
          )}

          {cart.length === 0 ? (
            <div>
              <div className="empty">The bill is empty. Search for a book and click it to add.</div>
              {drafts.length > 0 && (
                <div className="mt-4 p-3 bg-[#FEFCE8] border-2 border-black text-center shadow-[3px_3px_0px_0px_#B45309]">
                  <span className="text-sm font-serif font-bold mr-2 text-black">
                    You have {drafts.length} parked customer bill drafts.
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => setShowDraftsList(true)}
                  >
                    View Parked Drafts →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Price</th>
                      <th>Qty</th>
                      <th className="num">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map(({ book, quantity }) => (
                      <tr key={book.id}>
                        <td><div className="flex gap-3 items-center"><BookCover book={book} w={32} /><div><strong>{book.title}</strong>{book.edition && <em className="text-muted"> ({book.edition})</em>}
                          <div className="text-muted text-[.8rem]">{book.location || 'No location'} · {book.availableQty} available</div></div></div></td>
                        <td className="num">{fmt(book.priceCents)}</td>
                        <td>
                          <span className="inline-flex items-center gap-0.5">
                            <button
                              className="btn btn-sm"
                              aria-label="Decrease"
                              onClick={() => setQty(book.id, quantity - 1)}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="1"
                              className="input !w-14 text-center font-mono"
                              aria-label="Quantity"
                              value={quantity}
                              onChange={(e) => setQty(book.id, e.target.value)}
                            />
                            <button
                              className="btn btn-sm"
                              aria-label="Increase"
                              onClick={() => setQty(book.id, quantity + 1)}
                            >
                              +
                            </button>
                          </span>
                          {quantity > book.availableQty && (
                            <div className="text-brick text-[.8rem]">Only {book.availableQty} in stock</div>
                          )}
                        </td>
                        <td className="num">{fmt(book.priceCents * quantity)}</td>
                        <td>
                          <button
                            className="btn btn-sm btn-danger"
                            aria-label="Remove"
                            onClick={() => remove(book.id)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-2.5 mt-3">
                <Field label={`Discount %${isOwner ? '' : ` (max ${maxDisc}%)`}`} htmlFor="disc">
                  <input
                    id="disc"
                    type="number"
                    min="0"
                    max={maxDisc}
                    step="0.5"
                    className="input font-mono"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </Field>
                <Field label="Payment method" htmlFor="method">
                  <select
                    id="method"
                    className="input font-mono"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    {['cash', 'upi', 'card', 'other'].map((m) => (
                      <option key={m} value={m}>
                        {m.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Customer name (optional)" htmlFor="cust">
                <input
                  id="cust"
                  className="input"
                  maxLength={100}
                  value={customer}
                  placeholder="e.g. Ramesh Kumar"
                  onChange={(e) => setCustomer(e.target.value)}
                />
              </Field>

              <div className="sum">
                <div>
                  <span>Subtotal</span>
                  <span>{fmt(sub)}</span>
                </div>
                {disc > 0 && (
                  <div>
                    <span>Discount</span>
                    <span>− {fmt(disc)}</span>
                  </div>
                )}
                {settings.taxPercent > 0 && (
                  <div>
                    <span>Tax ({settings.taxPercent}%)</span>
                    <span>{fmt(tax)}</span>
                  </div>
                )}
                <div className="grand">
                  <span>Total</span>
                  <span>{fmt(total)}</span>
                </div>
              </div>

              <Actions>
                <Button
                  onClick={async () => {
                    if (await confirmBox('Discard this active bill?')) reset();
                  }}
                >
                  Clear
                </Button>
                <Button
                  onClick={saveAsDraft}
                  title="Park this bill into saved drafts and clear the counter for another customer"
                >
                  Hold / Save Draft
                </Button>
                <Button variant="primary" id="finalize" onClick={finalize}>
                  Finalize sale
                </Button>
              </Actions>
            </>
          )}
        </section>
      </div>

      {/* Authentic Bookshop Cash Memo Modal */}
      {finalizedSale && (
        <Modal
          title={`Cash Memo — ${finalizedSale.billNo}`}
          wide
          onClose={() => setFinalizedSale(null)}
        >
          <div className="space-y-3">
            <div className="p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center justify-between rounded">
              <span className="flex items-center gap-1.5">
                <span className="text-emerald-700 font-bold">✓</span>
                <span>Sale <strong>{finalizedSale.billNo}</strong> saved successfully. Inventory updated.</span>
              </span>
              <span className="font-mono">{finalizedSale.items?.length || 0} items · {fmt(finalizedSale.totalCents)}</span>
            </div>

            <PhysicalCashMemo
              bill={finalizedSale}
              onPrint={() => window.print()}
            />

            <div className="pt-3 border-t border-ink flex items-center justify-between print:hidden">
              <span className="text-xs text-muted">
                Press <kbd className="px-1.5 py-0.5 border border-hair bg-paper text-ink font-mono text-[11px] rounded">Esc</kbd> to close and ring up the next customer
              </span>
              <Button variant="primary" onClick={() => setFinalizedSale(null)}>
                Done / Next Customer (Esc)
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
