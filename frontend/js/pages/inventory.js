import { state, html, render, get, qs, debounce, badge, fail } from '../core.js';
import { bookDetail, adjustDialog } from './catalogue.js';

export default async function inventory(view) {
  const f = { q: '', low: false };
  const owner = state.user.role === 'owner';
  render(view, html`<h1>Inventory</h1>
    <div class="toolbar">
      <div class="grow"><label for="q">Search</label><input id="q" type="search" style="width:100%"></div>
      <div><label><input type="checkbox" id="low"> Low stock only</label></div>
    </div><div id="summary"></div><div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const rows = await get(`/inventory${qs({ q: f.q, low: f.low })}`);
      const low = rows.filter((r) => r.isLowStock).length;
      render(document.getElementById('summary'), low && !f.low ? html`<div class="notice warn">${low} title(s) are at or below their low-stock threshold.</div>` : '');
      render(list, rows.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Location</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th><th class="num">Alert at</th><th>Status</th>${owner ? html`<th></th>` : ''}</tr></thead>
        <tbody>${rows.map((r) => html`<tr class="clickable" data-id="${r.id}">
          <td><strong>${r.title}</strong>${r.edition ? html` <em class="muted">(${r.edition})</em>` : ''}<div class="muted small">${r.author}</div></td>
          <td>${[r.aisle && `Aisle ${r.aisle}`, r.rack && `Rack ${r.rack}`, r.shelf && `Shelf ${r.shelf}`].filter(Boolean).join(' · ') || '—'}</td>
          <td class="num">${r.stockQty}</td><td class="num">${r.reservedQty}</td><td class="num"><strong>${r.availableQty}</strong></td>
          <td class="num">${r.threshold}${r.thresholdIsDefault ? html`<span class="muted small"> (default)</span>` : ''}</td>
          <td>${r.availableQty <= 0 ? badge('out of stock', 'bad') : r.isLowStock ? badge('low', 'warn') : badge('ok', 'ok')}</td>
          ${owner ? html`<td><button class="small" data-adjust="${r.id}">Correct…</button></td>` : ''}</tr>`)}</tbody></table></div>`
        : html`<div class="empty">Nothing to show.</div>`);
      rowsById = new Map(rows.map((r) => [r.id, r]));
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  let rowsById = new Map();
  const reload = debounce(() => { f.q = document.getElementById('q').value; f.low = document.getElementById('low').checked; load(); });
  view.querySelector('.toolbar').addEventListener('input', reload);
  document.getElementById('list').addEventListener('click', (e) => {
    const adj = e.target.closest('[data-adjust]');
    if (adj) { const r = rowsById.get(+adj.dataset.adjust); return adjustDialog({ id: r.id, title: r.title, stockQty: r.stockQty, reservedQty: r.reservedQty }, load); }
    const tr = e.target.closest('tr[data-id]');
    if (tr) bookDetail(tr.dataset.id, load).catch(fail);
  });
  load();
}
