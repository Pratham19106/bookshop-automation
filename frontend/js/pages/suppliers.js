import { state, html, render, raw, get, post, put, del, qs, fmt, fmtDate, fmtDateTime, parseMoney, money, modal, toast, fail, debounce, guarded, badge, statusKind, bookPicker, formData } from '../core.js';

const f = (name, lbl, value = '', attrs = '') => html`<div class="field"><label for="s-${name}">${lbl}</label><input id="s-${name}" name="${name}" value="${value ?? ''}" ${raw(attrs)}></div>`;

export function supplierForm(s, onSaved) {
  const dlg = modal(s ? `Edit ${s.name}` : 'Add supplier', html`<form id="sf">
    <div class="grid g2">${f('name', 'Supplier name *', s?.name, 'required maxlength="150"')}${f('contactPerson', 'Contact person', s?.contactPerson, 'maxlength="100"')}
      ${f('phone', 'Phone', s?.phone, 'maxlength="40"')}${f('email', 'Email', s?.email, 'type="email" maxlength="200"')}
      ${f('categories', 'Categories / genres supplied', s?.categories, 'maxlength="300"')}${f('leadTimeDays', 'Typical lead time (days)', s?.leadTimeDays ?? 7, 'type="number" min="0" max="120"')}</div>
    ${f('address', 'Address', s?.address, 'maxlength="400"')}${f('notes', 'Notes (terms, payment, etc.)', s?.notes, 'maxlength="1000"')}
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary" id="save">Save</button></div></form>`, { wide: true });
  dlg.querySelector('#sf').onsubmit = (e) => {
    e.preventDefault();
    guarded(dlg.querySelector('#save'), async () => {
      const d = formData(dlg.querySelector('#sf'));
      d.leadTimeDays = Number(d.leadTimeDays);
      const saved = s ? await put(`/suppliers/${s.id}`, d) : await post('/suppliers', d);
      toast('Supplier saved'); dlg.close(); onSaved && onSaved(saved);
    });
  };
}

async function supplierDetail(id, onChange) {
  const s = await get(`/suppliers/${id}`);
  const dlg = modal(s.name, html`
    <dl class="kv"><dt>Contact</dt><dd>${s.contactPerson || '—'}</dd><dt>Phone</dt><dd>${s.phone || '—'}</dd><dt>Email</dt><dd>${s.email || '—'}</dd>
      <dt>Address</dt><dd>${s.address || '—'}</dd><dt>Supplies</dt><dd>${s.categories || '—'}</dd><dt>Lead time</dt><dd>${s.leadTimeDays} days</dd>
      ${s.notes ? html`<dt>Notes</dt><dd>${s.notes}</dd>` : ''}<dt>Total bought</dt><dd><strong>${fmt(s.totalPurchasedCents)}</strong> (goods received)</dd>
      <dt>Status</dt><dd>${s.active ? badge('active', 'ok') : badge('inactive', 'bad')}</dd></dl>
    <div class="row"><button id="edit">Edit</button><button id="toggle">${s.active ? 'Deactivate' : 'Reactivate'}</button></div>
    <h3>Books and quoted prices</h3>
    <div class="row"><div class="grow" id="bp"></div></div>
    <div id="bk"></div>
    <h3>Purchase history</h3>
    ${s.purchaseOrders.length ? html`<div class="table-wrap"><table><thead><tr><th>PO</th><th>Date</th><th>Status</th><th class="num">Ordered</th><th class="num">Received</th></tr></thead>
      <tbody>${s.purchaseOrders.map((o) => html`<tr><td>${o.poNo}</td><td>${fmtDate(o.createdAt)}</td><td>${badge(o.status, statusKind(o.status))}</td><td class="num">${fmt(o.orderedCents)}</td><td class="num">${fmt(o.receivedCents)}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">No purchase orders yet.</p>`}`, { wide: true });
  const drawBooks = (list) => render(dlg.querySelector('#bk'), list.length ? html`<div class="table-wrap"><table><thead><tr><th>Book</th><th class="num">Quoted cost</th><th>Updated</th><th></th></tr></thead>
    <tbody>${list.map((b) => html`<tr><td>${b.title}${b.edition ? html` <em class="muted">(${b.edition})</em>` : ''}<div class="muted small">${b.author}</div></td><td class="num">${fmt(b.unitCostCents)}</td><td>${fmtDate(b.updatedAt)}</td>
      <td class="nowrap"><button class="small" data-edit="${b.bookId}" data-cost="${b.unitCostCents}">Change price</button> <button class="small danger" data-rm="${b.bookId}">Remove</button></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">No books linked yet. Search above to add one with this supplier’s price.</p>`);
  drawBooks(s.books);
  bookPicker(dlg.querySelector('#bp'), (b) => {
    const d = modal(`Quote for “${b.title}”`, html`<div class="field"><label for="c">${s.name}’s cost per copy (${state.settings.currencySymbol})</label><input id="c" inputmode="decimal"></div>
      <div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Save quote</button></div>`);
    d.querySelector('#go').onclick = (e) => guarded(e.target, async () => {
      const c = parseMoney(d.querySelector('#c').value); if (c === null) throw new Error('Enter a price like 120 or 120.50');
      const r = await put(`/suppliers/${id}/books/${b.id}`, { unitCostCents: c }); drawBooks(r.books); d.close(); toast('Quote saved');
    });
  }, { placeholder: 'Add a book this supplier provides — search title or ISBN…', includeStock: false });
  dlg.querySelector('#bk').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rm) guarded(b, async () => { drawBooks((await del(`/suppliers/${id}/books/${b.dataset.rm}`)).books); });
    if (b.dataset.edit) {
      const d = modal('Change quoted price', html`<div class="field"><label for="c">New cost (${state.settings.currencySymbol})</label><input id="c" value="${money(+b.dataset.cost)}" inputmode="decimal"></div>
        <div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Save</button></div>`);
      d.querySelector('#go').onclick = (ev) => guarded(ev.target, async () => {
        const c = parseMoney(d.querySelector('#c').value); if (c === null) throw new Error('Enter a valid price');
        drawBooks((await put(`/suppliers/${id}/books/${b.dataset.edit}`, { unitCostCents: c })).books); d.close();
      });
    }
  };
  dlg.querySelector('#edit').onclick = () => { dlg.close(); supplierForm(s, () => { onChange && onChange(); supplierDetail(id, onChange).catch(fail); }); };
  dlg.querySelector('#toggle').onclick = (e) => guarded(e.target, async () => { await post(`/suppliers/${id}/active`, { active: !s.active }); dlg.close(); onChange && onChange(); });
}

export default async function suppliers(view) {
  const st = { q: '', inactive: false };
  render(view, html`<div class="row between"><h1>Suppliers</h1><button class="primary" id="add">+ Add supplier</button></div>
    <div class="toolbar"><div class="grow"><label for="q">Search name, contact or category</label><input id="q" type="search" style="width:100%"></div>
      <div><label><input type="checkbox" id="inactive"> Show inactive</label></div></div>
    <div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const rows = await get(`/suppliers${qs({ q: st.q, inactive: st.inactive })}`);
      render(list, rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Contact</th><th>Supplies</th><th class="num">Books</th><th class="num">Lead time</th><th class="num">Total bought</th></tr></thead>
        <tbody>${rows.map((s) => html`<tr class="clickable" data-id="${s.id}"><td><strong>${s.name}</strong>${s.active ? '' : html` ${badge('inactive', 'bad')}`}</td>
          <td>${s.contactPerson}<div class="muted small">${s.phone} ${s.email}</div></td><td>${s.categories}</td><td class="num">${s.bookCount}</td>
          <td class="num">${s.leadTimeDays} d</td><td class="num">${fmt(s.totalPurchasedCents)}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No suppliers yet.</div>`);
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  document.getElementById('add').onclick = () => supplierForm(null, load);
  const reload = debounce(() => { st.q = document.getElementById('q').value; st.inactive = document.getElementById('inactive').checked; load(); });
  view.querySelector('.toolbar').addEventListener('input', reload);
  document.getElementById('list').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) supplierDetail(tr.dataset.id, load).catch(fail); };
  load();
}
