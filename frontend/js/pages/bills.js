import { state, html, render, get, post, qs, fmt, fmtDateTime, badge, statusKind, label, modal, fail, debounce, daysAgo, today, guarded, toast, formData, raw } from '../core.js';

export async function showBill(id, onChange) {
  const b = await get(`/sales/${id}`);
  const owner = state.user.role === 'owner';
  const dlg = modal(`Bill ${b.billNo}`, html`
    <dl class="kv">
      <dt>Date</dt><dd>${fmtDateTime(b.createdAt)}</dd>
      <dt>Status</dt><dd>${badge(b.status, statusKind(b.status))} ${b.status === 'voided' ? html`<span class="muted small">${b.voidReason}</span>` : ''}</dd>
      <dt>Cashier</dt><dd>${b.cashier}</dd>
      <dt>Customer</dt><dd>${b.customerName || '—'}</dd>
      <dt>Payment</dt><dd>${label(b.paymentMethod)}</dd>
      ${b.orderId ? html`<dt>Source</dt><dd>Phone order <a href="#/orders">#${b.orderId}</a></dd>` : ''}
    </dl>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th>${owner ? html`<th class="num">Cost</th>` : ''}</tr></thead>
      <tbody>${b.items.map((i) => html`<tr><td>${i.title}${i.edition ? html` <em class="muted">(${i.edition})</em>` : ''}<div class="muted small">${i.author}${i.isbn ? ` · ${i.isbn}` : ''}</div></td>
        <td class="num">${fmt(i.unitPriceCents)}</td><td class="num">${i.quantity}</td><td class="num">${fmt(i.lineTotalCents)}</td>
        ${owner ? html`<td class="num">${i.unitCostCents ? fmt(i.unitCostCents) : '—'}</td>` : ''}</tr>`)}</tbody></table></div>
    <div class="sum" style="margin-top:10px">
      <div><span>Subtotal</span><span>${fmt(b.subtotalCents)}</span></div>
      ${b.discountCents ? html`<div><span>Discount (${b.discountPercent}%)</span><span>− ${fmt(b.discountCents)}</span></div>` : ''}
      ${b.taxCents ? html`<div><span>Tax (${b.taxPercent}%)</span><span>${fmt(b.taxCents)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${fmt(b.totalCents)}</span></div></div>
    <div class="actions">
      ${owner && b.status === 'completed' && !b.orderId ? html`<button class="danger" id="void">Void bill…</button>` : ''}
      <a class="btn primary" href="/receipt.html?id=${b.id}" target="_blank" rel="noopener">Print receipt</a></div>`, { wide: true });
  const voidBtn = dlg.querySelector('#void');
  if (voidBtn) voidBtn.onclick = () => {
    const d2 = modal('Void bill', html`<p>Voiding returns the items to stock and removes this bill from all reports. This cannot be undone.</p>
      <div class="field"><label for="reason">Reason (required)</label><input id="reason" name="reason" maxlength="300"></div>
      <div class="actions"><button data-close>Cancel</button><button class="danger" id="go">Void bill</button></div>`);
    d2.querySelector('#go').onclick = (e) => guarded(e.target, async () => {
      await post(`/sales/${id}/void`, { reason: d2.querySelector('#reason').value });
      toast('Bill voided'); d2.close(); dlg.close(); onChange && onChange();
    });
  };
}

export default async function bills(view) {
  const f = { q: '', from: daysAgo(30), to: today(), status: '' };
  render(view, html`<h1>Bills</h1>
    <div class="toolbar">
      <div class="grow"><label for="q">Search bill no., customer, title or ISBN</label><input id="q" type="search" style="width:100%"></div>
      <div><label for="from">From</label><input id="from" type="date" value="${f.from}"></div>
      <div><label for="to">To</label><input id="to" type="date" value="${f.to}"></div>
      <div><label for="st">Status</label><select id="st"><option value="">All</option><option value="completed">Completed</option><option value="voided">Voided</option></select></div>
    </div><div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const r = await get(`/sales${qs({ q: f.q, from: f.from, to: f.to, status: f.status, limit: 100 })}`);
      render(list, r.items.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Payment</th><th class="num">Units</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${r.items.map((s) => html`<tr class="clickable" data-id="${s.id}"><td><strong>${s.billNo}</strong></td><td>${fmtDateTime(s.createdAt)}</td>
          <td>${s.customerName || '—'}</td><td>${label(s.paymentMethod)}</td><td class="num">${s.units}</td><td class="num">${fmt(s.totalCents)}</td>
          <td>${badge(s.status, statusKind(s.status))}</td></tr>`)}</tbody></table></div>
        <p class="muted small">${r.total > r.items.length ? `Showing ${r.items.length} of ${r.total}. Narrow the dates or search.` : `${r.total} bill(s)`}</p>`
        : html`<div class="empty">No bills match.</div>`);
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  const reload = debounce(() => {
    f.q = document.getElementById('q').value; f.from = document.getElementById('from').value;
    f.to = document.getElementById('to').value; f.status = document.getElementById('st').value; load();
  });
  view.querySelector('.toolbar').addEventListener('input', reload);
  document.getElementById('list').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) showBill(tr.dataset.id, load).catch(fail);
  });
  load();
}
