import { state, html, render, raw, get, post, fmt, toast, fail, bookPicker, guarded, uuid, confirmBox } from '../core.js';

export default async function billing(view) {
  const cart = new Map(); // bookId -> { book, quantity }
  const form = { discount: '', method: 'cash', customer: '' };
  let key = uuid(); // one key per cart: a repeated submit of the same cart can never create two bills
  let lastBill = null;

  render(view, html`
    <h1>Billing</h1>
    <div class="pos">
      <section class="card"><h2>Find a book</h2><div id="picker"></div>
        <p class="muted small">Tip: scan or type a full ISBN and press Enter to add it straight away.</p></section>
      <section class="card" id="cart"></section>
    </div>`);

  const totals = () => {
    const lines = [...cart.values()];
    const sub = lines.reduce((s, l) => s + l.book.priceCents * l.quantity, 0);
    const bp = Math.round((Number(form.discount) || 0) * 100);
    const disc = Math.round((sub * bp) / 10000);
    const tax = Math.round(((sub - disc) * Math.round(state.settings.taxPercent * 100)) / 10000);
    return { sub, disc, tax, total: sub - disc + tax };
  };

  function draw() {
    const lines = [...cart.values()];
    const t = totals();
    const isOwner = state.user.role === 'owner';
    const maxDisc = isOwner ? 100 : state.settings.staffMaxDiscountPercent;
    render(document.getElementById('cart'), html`
      <h2>Current bill</h2>
      ${lastBill ? html`<div class="notice">Bill <strong>${lastBill.billNo}</strong> saved — ${fmt(lastBill.totalCents)}.
        <a href="/receipt.html?id=${lastBill.id}" target="_blank" rel="noopener">Print receipt</a></div>` : ''}
      ${lines.length ? html`
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">Price</th><th>Qty</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${lines.map((l) => html`<tr>
          <td><strong>${l.book.title}</strong>${l.book.edition ? html` <em class="muted">(${l.book.edition})</em>` : ''}<div class="muted small">${l.book.location || 'No location'} · ${l.book.availableQty} available</div></td>
          <td class="num">${fmt(l.book.priceCents)}</td>
          <td><span class="qty"><button class="small" data-dec="${l.book.id}" aria-label="Decrease">−</button>
            <input type="number" min="1" max="${l.book.availableQty}" value="${l.quantity}" data-qty="${l.book.id}" aria-label="Quantity">
            <button class="small" data-inc="${l.book.id}" aria-label="Increase">+</button></span>
            ${l.quantity > l.book.availableQty ? html`<div class="bad small">Only ${l.book.availableQty} in stock</div>` : ''}</td>
          <td class="num">${fmt(l.book.priceCents * l.quantity)}</td>
          <td><button class="small danger" data-rm="${l.book.id}" aria-label="Remove">✕</button></td></tr>`)}</tbody></table></div>
      <div class="grid g2" style="margin-top:12px">
        <div class="field"><label for="disc">Discount % ${isOwner ? '' : html`(max ${maxDisc}%)`}</label>
          <input id="disc" type="number" min="0" max="${maxDisc}" step="0.5" value="${form.discount}"></div>
        <div class="field"><label for="method">Payment method</label>
          <select id="method">${['cash', 'upi', 'card', 'other'].map((m) => html`<option value="${m}" ${m === form.method ? raw('selected') : ''}>${m.toUpperCase()}</option>`)}</select></div>
      </div>
      <div class="field"><label for="cust">Customer name (optional)</label><input id="cust" value="${form.customer}" maxlength="100"></div>
      <div class="sum">
        <div><span>Subtotal</span><span>${fmt(t.sub)}</span></div>
        ${t.disc ? html`<div><span>Discount</span><span>− ${fmt(t.disc)}</span></div>` : ''}
        ${state.settings.taxPercent ? html`<div><span>Tax (${state.settings.taxPercent}%)</span><span>${fmt(t.tax)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${fmt(t.total)}</span></div>
      </div>
      <div class="actions"><button id="clear">Clear</button><button class="primary" id="finalize">Finalize sale</button></div>
      ` : html`<div class="empty">The bill is empty. Search for a book and click it to add.</div>`}`);
  }

  const add = (book) => {
    const cur = cart.get(book.id);
    if (cur) cur.quantity += 1; else cart.set(book.id, { book, quantity: 1 });
    if (book.availableQty <= 0) toast(`“${book.title}” is out of stock`, 'bad');
    draw();
  };
  bookPicker(document.getElementById('picker'), add).focus();

  const cartEl = document.getElementById('cart');
  const readForm = () => {
    const d = document.getElementById('disc'); if (d) form.discount = d.value;
    const m = document.getElementById('method'); if (m) form.method = m.value;
    const c = document.getElementById('cust'); if (c) form.customer = c.value;
  };
  cartEl.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    readForm();
    if (b.dataset.inc) { cart.get(+b.dataset.inc).quantity += 1; draw(); }
    if (b.dataset.dec) { const l = cart.get(+b.dataset.dec); if (l.quantity > 1) l.quantity -= 1; draw(); }
    if (b.dataset.rm) { cart.delete(+b.dataset.rm); draw(); }
    if (b.id === 'clear' && (await confirmBox('Discard this bill?'))) { cart.clear(); form.discount = ''; form.customer = ''; draw(); }
    if (b.id === 'finalize') {
      const bad = [...cart.values()].find((l) => l.quantity > l.book.availableQty);
      if (bad) return toast(`Not enough stock for “${bad.book.title}”`, 'bad');
      await guarded(b, async () => {
        try {
          const sale = await post('/sales', {
            items: [...cart.values()].map((l) => ({ bookId: l.book.id, quantity: l.quantity })),
            discountPercent: Number(form.discount) || 0, paymentMethod: form.method, customerName: form.customer, idempotencyKey: key,
          });
          lastBill = sale; cart.clear(); form.discount = ''; form.customer = ''; key = uuid();
          toast(`Sale ${sale.billNo} saved`);
          draw();
        } catch (err) {
          fail(err);
          // Stock may have changed under us; refresh the cart's availability.
          if (err.status === 409) await refresh();
        }
      });
    }
  });
  cartEl.addEventListener('change', (e) => {
    readForm();
    if (e.target.dataset.qty) {
      const l = cart.get(+e.target.dataset.qty);
      const n = Math.floor(Number(e.target.value));
      l.quantity = n >= 1 ? n : 1;
    }
    draw();
  });
  cartEl.addEventListener('input', (e) => { if (e.target.id === 'disc' || e.target.id === 'cust') readForm(); });

  async function refresh() {
    for (const l of cart.values()) {
      try { l.book = await get(`/books/${l.book.id}`); } catch { /* keep old */ }
    }
    draw();
  }
  draw();
}
