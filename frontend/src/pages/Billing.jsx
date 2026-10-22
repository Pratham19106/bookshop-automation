import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmt, uuid } from '../lib/format';
import { confirmBox, fail, toast } from '../lib/overlays';
import { Actions, BookPicker, Button, Field, PageTitle } from '../lib/ui';

export default function Billing() {
  const { isOwner, settings } = useAuth();
  const [cart, setCart] = useState([]); // [{ book, quantity }]
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState('cash');
  const [customer, setCustomer] = useState('');
  const [lastBill, setLastBill] = useState(null);
  const key = useRef(uuid()); // one key per cart: a repeated submit of the same cart can never create two bills

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
  const reset = () => { setCart([]); setDiscount(''); setCustomer(''); key.current = uuid(); };

  const refreshStock = async () => {
    const fresh = await Promise.all(cart.map((l) => get(`/books/${l.book.id}`).catch(() => l.book)));
    setCart((c) => c.map((l, i) => ({ ...l, book: fresh[i] || l.book })));
  };

  const finalize = async () => {
    const bad = cart.find((l) => l.quantity > l.book.availableQty);
    if (bad) return toast(`Not enough stock for “${bad.book.title}”`, 'bad');
    try {
      const sale = await post('/sales', {
        items: cart.map((l) => ({ bookId: l.book.id, quantity: l.quantity })),
        discountPercent: Number(discount) || 0, paymentMethod: method, customerName: customer, idempotencyKey: key.current,
      });
      setLastBill(sale); reset(); toast(`Sale ${sale.billNo} saved`);
    } catch (e) {
      fail(e);
      if (e.status === 409) await refreshStock(); // stock changed under us
    }
    return undefined;
  };

  return (
    <div>
      <PageTitle>Billing</PageTitle>
      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr] items-start">
        <section className="card">
          <h2>Find a book</h2>
          <BookPicker onPick={add} autoFocus />
          <p className="text-muted text-[.85rem] mt-2">Tip: scan or type a full ISBN and press Enter to add it straight away.</p>
        </section>
        <section className="card">
          <h2>Current bill</h2>
          {lastBill && (
            <div className="notice">Bill <strong>{lastBill.billNo}</strong> saved — <span className="font-mono">{fmt(lastBill.totalCents)}</span>.{' '}
              <Link to={`/receipt/${lastBill.id}`} target="_blank">Print receipt</Link></div>
          )}
          {cart.length === 0 ? <div className="empty">The bill is empty. Search for a book and click it to add.</div> : (
            <>
              <div className="table-wrap">
                <table className="ledger">
                  <thead><tr><th>Item</th><th className="num">Price</th><th>Qty</th><th className="num">Total</th><th /></tr></thead>
                  <tbody>
                    {cart.map(({ book, quantity }) => (
                      <tr key={book.id}>
                        <td><strong>{book.title}</strong>{book.edition && <em className="text-muted"> ({book.edition})</em>}
                          <div className="text-muted text-[.8rem]">{book.location || 'No location'} · {book.availableQty} available</div></td>
                        <td className="num">{fmt(book.priceCents)}</td>
                        <td>
                          <span className="inline-flex items-center gap-0.5">
                            <button className="btn btn-sm" aria-label="Decrease" onClick={() => setQty(book.id, quantity - 1)}>−</button>
                            <input type="number" min="1" className="input !w-14 text-center font-mono" aria-label="Quantity" value={quantity} onChange={(e) => setQty(book.id, e.target.value)} />
                            <button className="btn btn-sm" aria-label="Increase" onClick={() => setQty(book.id, quantity + 1)}>+</button>
                          </span>
                          {quantity > book.availableQty && <div className="text-brick text-[.8rem]">Only {book.availableQty} in stock</div>}
                        </td>
                        <td className="num">{fmt(book.priceCents * quantity)}</td>
                        <td><button className="btn btn-sm btn-danger" aria-label="Remove" onClick={() => remove(book.id)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-2.5 mt-3">
                <Field label={`Discount %${isOwner ? '' : ` (max ${maxDisc}%)`}`} htmlFor="disc">
                  <input id="disc" type="number" min="0" max={maxDisc} step="0.5" className="input font-mono" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </Field>
                <Field label="Payment method" htmlFor="method">
                  <select id="method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {['cash', 'upi', 'card', 'other'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Customer name (optional)" htmlFor="cust"><input id="cust" className="input" maxLength={100} value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>
              <div className="sum">
                <div><span>Subtotal</span><span>{fmt(sub)}</span></div>
                {disc > 0 && <div><span>Discount</span><span>− {fmt(disc)}</span></div>}
                {settings.taxPercent > 0 && <div><span>Tax ({settings.taxPercent}%)</span><span>{fmt(tax)}</span></div>}
                <div className="grand"><span>Total</span><span>{fmt(total)}</span></div>
              </div>
              <Actions>
                <Button onClick={async () => { if (await confirmBox('Discard this bill?')) reset(); }}>Clear</Button>
                <Button variant="primary" id="finalize" onClick={finalize}>Finalize sale</Button>
              </Actions>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
