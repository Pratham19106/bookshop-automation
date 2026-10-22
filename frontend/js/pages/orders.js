import { state, html, render, raw, get, post, put, qs, fmt, fmtDate, fmtDateTime, parseMoney, money, label, modal, toast, fail, debounce, guarded, badge, statusKind, bookPicker, confirmBox, today } from '../core.js';

const METHODS = ['cash', 'upi', 'card', 'other'];
const methodSelect = (id) => html`<select id="${id}">${METHODS.map((m) => html`<option value="${m}">${m.toUpperCase()}</option>`)}</select>`;

// Create/edit form. `order` is null when creating.
function orderForm(order, onSaved) {
  const lines = new Map((order?.items || []).map((i) => [i.bookId, { bookId: i.bookId, title: i.title, unitPriceCents: i.unitPriceCents, quantity: i.quantity }]));
  const edit = !!order;
  const dlg = modal(edit ? `Edit order ${order.orderNo}` : 'New phone order', html`
    <form id="of">
      <div class="grid g2">
        <div class="field"><label for="cn">Customer name *</label><input id="cn" value="${order?.customerName}" maxlength="100" required></div>
        <div class="field"><label for="cp">Phone *</label><input id="cp" value="${order?.customerPhone}" maxlength="30" required inputmode="tel"></div>
        <div class="field"><label for="dt">Fulfilment</label><select id="dt"><option value="pickup" ${order?.deliveryType !== 'delivery' ? raw('selected') : ''}>Customer picks up</option>
          <option value="delivery" ${order?.deliveryType === 'delivery' ? raw('selected') : ''}>Deliver to customer</option></select></div>
        <div class="field"><label for="pd">Promised date</label><input id="pd" type="date" value="${order?.promisedDate || ''}"></div>
      </div>
      <div class="field" id="addr-wrap"><label for="addr">Delivery address *</label><textarea id="addr" maxlength="400">${order?.deliveryAddress || ''}</textarea></div>
      <div class="field"><label for="nt">Notes</label><input id="nt" value="${order?.notes}" maxlength="500"></div>
      <h3>Books</h3><div id="op"></div><div id="ol"></div>
      <div class="grid g2" style="margin-top:8px">
        <div class="field"><label for="od">Discount %${state.user.role === 'owner' ? '' : ` (max ${state.settings.staffMaxDiscountPercent}%)`}</label><input id="od" type="number" min="0" max="100" step="0.5" value="${order?.discountPercent || ''}"></div>
        ${edit ? '' : html`<div class="field"><label for="adv">Advance payment (${state.settings.currencySymbol}, optional)</label>
          <div class="row"><input id="adv" inputmode="decimal" style="flex:1"> ${methodSelect('advm')}</div></div>`}
      </div>
      <div id="ot"></div>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary" id="save">${edit ? 'Save changes' : 'Place order & reserve stock'}</button></div>
    </form>`, { wide: true });

  const q = (s) => dlg.querySelector(s);
  const drawLines = () => {
    const arr = [...lines.values()];
    const sub = arr.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const bp = Math.round((Number(q('#od').value) || 0) * 100);
    const disc = Math.round((sub * bp) / 10000);
    const tax = Math.round(((sub - disc) * Math.round((order ? order.taxPercent : state.settings.taxPercent) * 100)) / 10000);
    render(q('#ol'), arr.length ? html`<div class="table-wrap"><table><thead><tr><th>Book</th><th class="num">Price</th><th>Qty</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${arr.map((l) => html`<tr><td>${l.title}</td><td class="num">${fmt(l.unitPriceCents)}</td>
        <td><input type="number" min="1" value="${l.quantity}" data-q="${l.bookId}" style="width:5em"></td>
        <td class="num">${fmt(l.unitPriceCents * l.quantity)}</td><td><button type="button" class="small danger" data-rm="${l.bookId}">✕</button></td></tr>`)}</tbody></table></div>`
      : html`<div class="empty">Add the books the customer asked for.</div>`);
    render(q('#ot'), html`<div class="sum"><div><span>Subtotal</span><span>${fmt(sub)}</span></div>${disc ? html`<div><span>Discount</span><span>− ${fmt(disc)}</span></div>` : ''}
      ${tax ? html`<div><span>Tax</span><span>${fmt(tax)}</span></div>` : ''}<div class="grand"><span>Total</span><span>${fmt(sub - disc + tax)}</span></div></div>`);
  };
  bookPicker(q('#op'), (b) => {
    const cur = lines.get(b.id);
    if (cur) cur.quantity += 1; else lines.set(b.id, { bookId: b.id, title: b.title + (b.edition ? ` (${b.edition})` : ''), unitPriceCents: b.priceCents, quantity: 1 });
    drawLines();
  });
  const syncAddr = () => { q('#addr-wrap').hidden = q('#dt').value !== 'delivery'; };
  q('#dt').onchange = syncAddr; syncAddr();
  q('#od').oninput = drawLines;
  q('#ol').addEventListener('change', (e) => { if (e.target.dataset.q) { lines.get(+e.target.dataset.q).quantity = Math.max(1, Math.floor(Number(e.target.value)) || 1); drawLines(); } });
  q('#ol').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { lines.delete(+b.dataset.rm); drawLines(); } });
  drawLines();

  q('#of').onsubmit = (e) => {
    e.preventDefault();
    guarded(q('#save'), async () => {
      if (!lines.size) throw new Error('Add at least one book');
      const body = {
        customerName: q('#cn').value, customerPhone: q('#cp').value, deliveryType: q('#dt').value, deliveryAddress: q('#addr').value,
        promisedDate: q('#pd').value || null, notes: q('#nt').value, discountPercent: Number(q('#od').value) || 0,
        items: [...lines.values()].map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
      };
      if (!edit && q('#adv').value.trim()) {
        const cents = parseMoney(q('#adv').value);
        if (cents === null || cents <= 0) throw new Error('Enter the advance like 200 or 200.50');
        body.advancePayment = { amountCents: cents, method: q('#advm').value };
      }
      const saved = edit ? await put(`/orders/${order.id}`, body) : await post('/orders', body);
      toast(edit ? 'Order updated' : `Order ${saved.orderNo} placed`);
      dlg.close(); onSaved && onSaved(saved);
    });
  };
}

async function orderDetail(id, onChange) {
  const o = await get(`/orders/${id}`);
  const open = ['placed', 'ready', 'out_for_delivery'].includes(o.status);
  const dlg = modal(`Order ${o.orderNo}`, html`
    <div class="row">${badge(o.status, statusKind(o.status))} ${badge(o.paymentStatus, statusKind(o.paymentStatus))}
      <span class="muted small">Fulfilment and payment are tracked separately.</span></div>
    <dl class="kv" style="margin-top:10px">
      <dt>Customer</dt><dd>${o.customerName} · <a href="tel:${o.customerPhone}">${o.customerPhone}</a></dd>
      <dt>Fulfilment</dt><dd>${o.deliveryType === 'delivery' ? html`Delivery to ${o.deliveryAddress}` : 'Pickup at shop'}</dd>
      <dt>Promised</dt><dd>${o.promisedDate ? fmtDate(o.promisedDate) : '—'}</dd>
      ${o.notes ? html`<dt>Notes</dt><dd>${o.notes}</dd>` : ''}
      <dt>Taken</dt><dd>${fmtDateTime(o.createdAt)}</dd>
      ${o.saleId ? html`<dt>Bill</dt><dd><a href="/receipt.html?id=${o.saleId}" target="_blank" rel="noopener">View receipt</a></dd>` : ''}
      ${o.status === 'cancelled' ? html`<dt>Cancelled</dt><dd>${o.cancelReason}</dd>` : ''}
    </dl>
    <div class="table-wrap"><table><thead><tr><th>Book</th><th>Pick from</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th></tr></thead>
      <tbody>${o.items.map((i) => html`<tr><td>${i.title}</td><td class="small">${i.location || '—'}</td><td class="num">${fmt(i.unitPriceCents)}</td><td class="num">${i.quantity}</td><td class="num">${fmt(i.lineTotalCents)}</td></tr>`)}</tbody></table></div>
    <div class="sum" style="margin-top:8px">
      <div><span>Subtotal</span><span>${fmt(o.subtotalCents)}</span></div>
      ${o.discountCents ? html`<div><span>Discount (${o.discountPercent}%)</span><span>− ${fmt(o.discountCents)}</span></div>` : ''}
      ${o.taxCents ? html`<div><span>Tax</span><span>${fmt(o.taxCents)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${fmt(o.totalCents)}</span></div>
      <div><span>Paid so far</span><span>${fmt(o.paidCents)}</span></div>
      ${open ? html`<div><span>Balance due</span><strong>${fmt(o.balanceCents)}</strong></div>` : ''}</div>
    ${o.payments.length ? html`<h3>Payments</h3><div class="table-wrap"><table><tbody>${o.payments.map((p) => html`<tr><td>${fmtDateTime(p.createdAt)}</td><td>${label(p.method)}</td><td>${p.note}</td>
      <td class="num ${p.amountCents < 0 ? 'bad' : ''}">${fmt(p.amountCents)}</td></tr>`)}</tbody></table></div>` : ''}
    ${o.paymentStatus === 'refund_due' ? html`<div class="notice bad" style="margin-top:10px">This order was cancelled after ${fmt(o.paidCents)} was paid. Refund the customer and record it below.</div>` : ''}
    <div class="actions" id="acts">
      ${open && o.balanceCents > 0 ? html`<button id="pay">Record payment</button>` : ''}
      ${o.paidCents > 0 && o.status !== 'completed' ? html`<button id="refund">Record refund</button>` : ''}
      ${['placed', 'ready'].includes(o.status) ? html`<button id="edit">Edit</button>` : ''}
      ${open ? html`<button class="danger" id="cancel">Cancel order</button>` : ''}
      ${o.status === 'placed' ? html`<button class="primary" id="ready">Mark ready</button>` : ''}
      ${o.status === 'ready' && o.deliveryType === 'delivery' ? html`<button class="primary" id="out">Out for delivery</button>` : ''}
      ${o.status === 'out_for_delivery' ? html`<button id="back">Delivery failed – back to ready</button>` : ''}
      ${(o.status === 'ready' && o.deliveryType === 'pickup') || o.status === 'out_for_delivery' ? html`<button class="primary" id="fulfil">${o.deliveryType === 'delivery' ? 'Delivered' : 'Handed over'} – complete & bill</button>` : ''}
    </div>`, { wide: true });
  const done = (msg) => { if (msg) toast(msg); dlg.close(); onChange && onChange(); };
  const on = (sel, fn) => { const b = dlg.querySelector(sel); if (b) b.onclick = () => guarded(b, fn); };
  on('#ready', async () => { await post(`/orders/${id}/status`, { status: 'ready' }); done('Marked ready'); });
  on('#out', async () => { await post(`/orders/${id}/status`, { status: 'out_for_delivery' }); done('Out for delivery'); });
  on('#back', async () => { await post(`/orders/${id}/status`, { status: 'ready' }); done('Back to ready'); });
  on('#edit', async () => { dlg.close(); orderForm(o, onChange); });
  on('#cancel', async () => {
    const d = modal('Cancel order', html`<p>Reserved copies go back on the shelf${o.paidCents ? '; a refund will be due' : ''}.</p>
      <div class="field"><label for="why">Reason (required)</label><input id="why" maxlength="300"></div>
      <div class="actions"><button data-close>Keep order</button><button class="danger" id="go">Cancel order</button></div>`);
    d.querySelector('#go').onclick = (e) => guarded(e.target, async () => { await post(`/orders/${id}/cancel`, { reason: d.querySelector('#why').value }); d.close(); done('Order cancelled'); });
  });
  on('#pay', async () => {
    const d = modal('Record payment', html`<p>Balance due: <strong>${fmt(o.balanceCents)}</strong></p>
      <div class="grid g2"><div class="field"><label for="amt">Amount (${state.settings.currencySymbol})</label><input id="amt" value="${money(o.balanceCents)}" inputmode="decimal"></div>
      <div class="field"><label for="m">Method</label>${methodSelect('m')}</div></div>
      <div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Save payment</button></div>`);
    d.querySelector('#go').onclick = (e) => guarded(e.target, async () => {
      const cents = parseMoney(d.querySelector('#amt').value);
      if (!cents) throw new Error('Enter a valid amount');
      await post(`/orders/${id}/payments`, { amountCents: cents, method: d.querySelector('#m').value }); d.close(); done('Payment recorded');
    });
  });
  on('#refund', async () => {
    const d = modal('Record refund', html`<p>Paid so far: <strong>${fmt(o.paidCents)}</strong></p>
      <div class="grid g2"><div class="field"><label for="amt">Refund amount (${state.settings.currencySymbol})</label><input id="amt" value="${money(o.paidCents)}" inputmode="decimal"></div>
      <div class="field"><label for="m">Method</label>${methodSelect('m')}</div></div>
      <div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Record refund</button></div>`);
    d.querySelector('#go').onclick = (e) => guarded(e.target, async () => {
      const cents = parseMoney(d.querySelector('#amt').value);
      if (!cents) throw new Error('Enter a valid amount');
      await post(`/orders/${id}/refund`, { amountCents: cents, method: d.querySelector('#m').value }); d.close(); done('Refund recorded');
    });
  });
  on('#fulfil', async () => {
    const d = modal('Complete order', html`<p>This creates the bill and removes ${o.items.reduce((s, i) => s + i.quantity, 0)} item(s) from stock. It can only be done once.</p>
      ${o.balanceCents > 0 ? html`<p>Collect the balance of <strong>${fmt(o.balanceCents)}</strong> now.</p><div class="field"><label for="m">Payment method</label>${methodSelect('m')}</div>` : html`<p class="ok">Fully paid already.</p>`}
      <div class="actions"><button data-close>Not yet</button><button class="primary" id="go">Complete & bill</button></div>`);
    d.querySelector('#go').onclick = (e) => guarded(e.target, async () => {
      const m = d.querySelector('#m');
      const r = await post(`/orders/${id}/fulfil`, m ? { paymentMethod: m.value } : {});
      d.close(); done(`Order completed`); window.open(`/receipt.html?id=${r.saleId}`, '_blank', 'noopener');
    });
  });
}

export default async function orders(view) {
  const f = { status: 'open', q: '' };
  const tabs = [['open', 'Open'], ['placed', 'New'], ['ready', 'Ready'], ['out_for_delivery', 'Out for delivery'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['', 'All']];
  render(view, html`<div class="row between"><h1>Phone Orders</h1><button class="primary" id="new">+ New order</button></div>
    <div class="tabs" id="tabs">${tabs.map(([v, l]) => html`<button data-s="${v}" class="${v === f.status ? 'active' : ''}">${l}</button>`)}</div>
    <div class="toolbar"><div class="grow"><label for="q">Search order no., name or phone</label><input id="q" type="search" style="width:100%"></div>
      <div><label for="pay">Payment</label><select id="pay"><option value="">Any</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="refund_due">Refund due</option></select></div></div>
    <div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const r = await get(`/orders${qs({ status: f.status, q: f.q, payment: document.getElementById('pay').value, limit: 100 })}`);
      render(list, r.items.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Promised</th><th class="num">Total</th><th>Fulfilment</th><th>Payment</th></tr></thead>
        <tbody>${r.items.map((o) => html`<tr class="clickable" data-id="${o.id}"><td><strong>${o.orderNo}</strong></td><td>${o.customerName}<div class="muted small">${o.customerPhone}</div></td>
          <td>${label(o.deliveryType)}</td><td>${o.promisedDate ? fmtDate(o.promisedDate) : '—'}${o.promisedDate && o.promisedDate < today() && ['placed', 'ready', 'out_for_delivery'].includes(o.status) ? html` ${badge('overdue', 'bad')}` : ''}</td>
          <td class="num">${fmt(o.totalCents)}</td><td>${badge(o.status, statusKind(o.status))}</td><td>${badge(o.paymentStatus, statusKind(o.paymentStatus))}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No orders here.</div>`);
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  document.getElementById('tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    f.status = b.dataset.s; view.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); load();
  };
  const reload = debounce(() => { f.q = document.getElementById('q').value; load(); });
  view.querySelector('.toolbar').addEventListener('input', reload);
  document.getElementById('new').onclick = () => orderForm(null, load);
  document.getElementById('list').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) orderDetail(tr.dataset.id, load).catch(fail); };
  load();
}
