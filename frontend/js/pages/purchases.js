import { state, html, render, raw, get, post, qs, fmt, fmtDate, fmtDateTime, parseMoney, money, modal, toast, fail, guarded, badge, statusKind, bookPicker, uuid, confirmBox } from '../core.js';

// New purchase order. `prefill` = { supplierId, items: [{ bookId, title, quantity }] } when coming from restocking.
export async function poForm(prefill, onSaved) {
  const suppliers = await get('/suppliers');
  const lines = new Map((prefill?.items || []).map((i) => [i.bookId, { bookId: i.bookId, title: i.title, quantity: i.quantity, cost: null }]));
  const dlg = modal('New purchase order', html`<form id="pf">
    <div class="grid g2"><div class="field"><label for="sup">Supplier *</label><select id="sup"><option value="">Choose…</option>
      ${suppliers.map((s) => html`<option value="${s.id}" ${String(s.id) === String(prefill?.supplierId) ? raw('selected') : ''}>${s.name}</option>`)}</select></div>
      <div class="field"><label for="exp">Expected delivery</label><input id="exp" type="date"></div></div>
    <div class="field"><label for="nt">Notes</label><input id="nt" maxlength="500"></div>
    <h3>Books</h3><div id="pk"></div><div id="pl"></div>
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary" id="save">Place order</button></div></form>`, { wide: true });
  const q = (s) => dlg.querySelector(s);
  let quotes = new Map(); // bookId -> quoted cost for the selected supplier

  async function loadQuotes() {
    quotes = new Map();
    const sid = q('#sup').value;
    if (!sid) return draw();
    const s = await get(`/suppliers/${sid}`);
    s.books.forEach((b) => quotes.set(b.bookId, b.unitCostCents));
    draw();
  }
  function draw() {
    const arr = [...lines.values()];
    let total = 0;
    render(q('#pl'), arr.length ? html`<div class="table-wrap"><table><thead><tr><th>Book</th><th>Qty</th><th>Unit cost (${state.settings.currencySymbol})</th><th class="num">Line total</th><th></th></tr></thead>
      <tbody>${arr.map((l) => {
        const cost = l.cost ?? quotes.get(l.bookId) ?? null;
        if (cost !== null) total += cost * l.quantity;
        return html`<tr><td>${l.title}</td><td><input type="number" min="1" value="${l.quantity}" data-q="${l.bookId}" style="width:5em"></td>
          <td><input data-c="${l.bookId}" value="${l.cost !== null ? money(l.cost) : quotes.has(l.bookId) ? money(quotes.get(l.bookId)) : ''}" inputmode="decimal" style="width:7em" placeholder="required">
            ${quotes.has(l.bookId) ? '' : html`<div class="warn small">${q('#sup').value ? 'No quote on file' : ''}</div>`}</td>
          <td class="num">${cost !== null ? fmt(cost * l.quantity) : '—'}</td><td><button type="button" class="small danger" data-rm="${l.bookId}">✕</button></td></tr>`;
      })}</tbody></table></div><p class="right"><strong>Order value: ${fmt(total)}</strong></p>` : html`<div class="empty">Search for books to order.</div>`);
  }
  bookPicker(q('#pk'), (b) => {
    const cur = lines.get(b.id);
    if (cur) cur.quantity += 1; else lines.set(b.id, { bookId: b.id, title: b.title + (b.edition ? ` (${b.edition})` : ''), quantity: 1, cost: null });
    draw();
  }, { placeholder: 'Add a book — search title or ISBN…', includeStock: true });
  q('#sup').onchange = () => loadQuotes().catch(fail);
  q('#pl').addEventListener('change', (e) => {
    if (e.target.dataset.q) lines.get(+e.target.dataset.q).quantity = Math.max(1, Math.floor(Number(e.target.value)) || 1);
    if (e.target.dataset.c) lines.get(+e.target.dataset.c).cost = e.target.value.trim() === '' ? null : parseMoney(e.target.value);
    draw();
  });
  q('#pl').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { lines.delete(+b.dataset.rm); draw(); } });
  q('#pf').onsubmit = (e) => {
    e.preventDefault();
    guarded(q('#save'), async () => {
      if (!q('#sup').value) throw new Error('Choose a supplier');
      if (!lines.size) throw new Error('Add at least one book');
      const po = await post('/purchase-orders', {
        supplierId: Number(q('#sup').value), expectedDate: q('#exp').value || null, notes: q('#nt').value,
        items: [...lines.values()].map((l) => ({ bookId: l.bookId, quantity: l.quantity, ...(l.cost !== null ? { unitCostCents: l.cost } : {}) })),
      });
      toast(`Purchase order ${po.poNo} placed`); dlg.close(); onSaved && onSaved(po);
    });
  };
  await loadQuotes();
}

async function poDetail(id, onChange) {
  const po = await get(`/purchase-orders/${id}`);
  const canReceive = ['ordered', 'partially_received'].includes(po.status);
  const key = uuid(); // a double-clicked "Receive" can never receive twice
  const dlg = modal(`${po.poNo} · ${po.supplier.name}`, html`
    <div class="row">${badge(po.status, statusKind(po.status))}<span class="muted small">Placed ${fmtDate(po.createdAt)}${po.expectedDate ? ` · expected ${fmtDate(po.expectedDate)}` : ''}</span></div>
    ${po.notes ? html`<p>${po.notes}</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Book</th><th class="num">Unit cost</th><th class="num">Ordered</th><th class="num">Received</th>${canReceive ? html`<th>Receive now</th>` : ''}</tr></thead>
      <tbody>${po.items.map((i) => html`<tr><td>${i.title}${i.edition ? html` <em class="muted">(${i.edition})</em>` : ''}</td><td class="num">${fmt(i.unitCostCents)}</td><td class="num">${i.qtyOrdered}</td><td class="num">${i.qtyReceived}</td>
        ${canReceive ? html`<td>${i.qtyOutstanding > 0 ? html`<input type="number" min="0" max="${i.qtyOutstanding}" value="${i.qtyOutstanding}" data-item="${i.id}" data-cost="${money(i.unitCostCents)}" style="width:5em"> <span class="muted small">of ${i.qtyOutstanding}</span>` : '✓'}</td>` : ''}</tr>`)}</tbody></table></div>
    <p class="right">Ordered value ${fmt(po.orderedCents)} · Received value <strong>${fmt(po.receivedCents)}</strong></p>
    ${canReceive ? html`<p class="muted small">Enter the quantity that actually arrived (it can be less than ordered). The remainder stays outstanding. Stock and cost are updated when you confirm.</p>
      <div class="field"><label for="rn">Receipt note (delivery challan no., damages…)</label><input id="rn" maxlength="300"></div>` : ''}
    ${po.receipts.length ? html`<h3>Goods receipts</h3><div class="table-wrap"><table><tbody>${po.receipts.map((r) => html`<tr><td>${fmtDateTime(r.receivedAt)}</td><td>${r.note}</td><td>${r.user || ''}</td><td class="num">${fmt(r.totalCents)}</td></tr>`)}</tbody></table></div>` : ''}
    <div class="actions">${canReceive ? html`<button class="danger" id="cancel">Cancel order</button><button class="primary" id="recv">Confirm goods received</button>` : ''}</div>`, { wide: true });
  const recv = dlg.querySelector('#recv');
  if (recv) recv.onclick = () => guarded(recv, async () => {
    const items = [...dlg.querySelectorAll('input[data-item]')].map((i) => ({ poItemId: Number(i.dataset.item), quantity: Number(i.value) || 0 })).filter((i) => i.quantity > 0);
    if (!items.length) throw new Error('Enter a received quantity for at least one line');
    await post(`/purchase-orders/${id}/receive`, { items, note: dlg.querySelector('#rn').value, idempotencyKey: key });
    toast('Stock updated from goods received'); dlg.close(); onChange && onChange();
  });
  const cancel = dlg.querySelector('#cancel');
  if (cancel) cancel.onclick = () => guarded(cancel, async () => {
    if (!(await confirmBox(`Cancel ${po.poNo}? Nothing further can be received against it.`))) return;
    await post(`/purchase-orders/${id}/cancel`); toast('Order cancelled'); dlg.close(); onChange && onChange();
  });
}

export default async function purchases(view) {
  const st = { status: '' };
  render(view, html`<div class="row between"><h1>Purchase Orders</h1><button class="primary" id="new">+ New purchase order</button></div>
    <div class="tabs" id="tabs">${[['', 'All'], ['open', 'Open'], ['received', 'Received'], ['cancelled', 'Cancelled']].map(([v, l]) => html`<button data-s="${v}" class="${v === st.status ? 'active' : ''}">${l}</button>`)}</div>
    <div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const rows = await get(`/purchase-orders${qs({ status: st.status })}`);
      render(list, rows.length ? html`<div class="table-wrap"><table><thead><tr><th>PO</th><th>Supplier</th><th>Placed</th><th>Expected</th><th class="num">Units</th><th class="num">Value</th><th>Status</th></tr></thead>
        <tbody>${rows.map((p) => html`<tr class="clickable" data-id="${p.id}"><td><strong>${p.poNo}</strong></td><td>${p.supplier}</td><td>${fmtDate(p.createdAt)}</td><td>${p.expectedDate ? fmtDate(p.expectedDate) : '—'}</td>
          <td class="num">${p.unitsReceived}/${p.unitsOrdered}</td><td class="num">${fmt(p.orderedCents)}</td><td>${badge(p.status, statusKind(p.status))}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No purchase orders.</div>`);
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  document.getElementById('tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.status = b.dataset.s; view.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); load(); };
  document.getElementById('new').onclick = () => poForm(null, load).catch(fail);
  document.getElementById('list').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) poDetail(tr.dataset.id, load).catch(fail); };
  // Arriving from the restocking page with a prepared order.
  if (sessionStorage.getItem('poPrefill')) {
    const pre = JSON.parse(sessionStorage.getItem('poPrefill')); sessionStorage.removeItem('poPrefill');
    poForm(pre, load).catch(fail);
  }
  load();
}
