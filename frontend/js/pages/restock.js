import { state, html, render, get, qs, fmt, badge, fail, toast } from '../core.js';

export default async function restock(view) {
  const p = { lookbackDays: state.settings.restockLookbackDays || 30, coverDays: state.settings.restockCoverDays || 21 };
  render(view, html`<h1>Restocking Recommendations</h1>
    <p class="muted">Rule-based and fully explained: each suggestion shows the sales and stock figures behind it. Nothing is ordered automatically.</p>
    <div class="toolbar">
      <div><label for="lb">Sales analysed over (days)</label><input id="lb" type="number" min="7" max="365" value="${p.lookbackDays}"></div>
      <div><label for="cv">Order enough to cover (days)</label><input id="cv" type="number" min="1" max="365" value="${p.coverDays}"></div>
      <div><button id="go">Recalculate</button></div>
    </div><div id="notes"></div><div id="list"></div>`);
  let data = null;
  const load = async () => {
    const list = document.getElementById('list');
    try {
      data = await get(`/restock${qs({ lookbackDays: document.getElementById('lb').value, coverDays: document.getElementById('cv').value })}`);
      render(document.getElementById('notes'), data.dataNotes.map((n) => html`<div class="notice warn">${n}</div>`));
      draw();
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  function draw() {
    const items = data.items;
    render(document.getElementById('list'), items.length ? html`
      <div class="row between" style="margin-bottom:8px"><span class="muted">${items.length} title(s) need attention. Tick the ones to order.</span>
        <button class="primary" id="mkpo">Create purchase order from selected…</button></div>
      <div class="table-wrap"><table><thead><tr><th></th><th>Book</th><th>Why it was flagged</th><th class="num">Suggested</th><th>Best supplier</th></tr></thead>
      <tbody>${items.map((r, i) => html`<tr>
        <td><input type="checkbox" data-i="${i}" aria-label="Select ${r.title}"></td>
        <td><strong>${r.title}</strong>${r.edition ? html` <em class="muted">(${r.edition})</em>` : ''}<div>${badge(r.urgency, r.urgency === 'critical' ? 'critical' : r.urgency === 'high' ? 'bad' : 'warn')}
          ${r.confidence === 'low' ? badge('low confidence', 'muted') : ''}</div><div class="muted small">${r.location}</div></td>
        <td><ul class="reasons">${r.reasons.map((x) => html`<li>${x}</li>`)}</ul>
          ${r.caveats.map((c) => html`<div class="caveat">⚠ ${c}</div>`)}
          <div class="metrics"><span>Sold <b>${r.metrics.unitsSold}</b> in ${r.metrics.observedDays}d (<b>${r.metrics.velocityPerDay}</b>/day)</span>
            <span>Available <b>${r.metrics.availableQty}</b>${r.metrics.reservedQty ? ` (+${r.metrics.reservedQty} reserved)` : ''}</span><span>On order <b>${r.metrics.onOrderQty}</b></span>
            <span>Cover <b>${r.metrics.daysOfCover ?? '—'}</b> d</span><span>Lead time <b>${r.metrics.leadTimeDays}</b> d</span><span>Alert at <b>${r.metrics.threshold}</b></span></div></td>
        <td class="num"><input type="number" min="1" value="${r.suggestedQty}" data-qty="${i}" style="width:5em"><div class="muted small">target ${r.metrics.targetStock}</div></td>
        <td>${r.suppliers.length ? html`${r.suppliers[0].name}<div class="small">${fmt(r.suppliers[0].unitCostCents)} · ${r.suppliers[0].leadTimeDays}d
          ${r.estimatedCostCents != null ? html`<div class="muted">≈ ${fmt(r.estimatedCostCents)}</div>` : ''}</div>
          ${r.suppliers.length > 1 ? html`<div class="muted small">+${r.suppliers.length - 1} other supplier(s): ${r.suppliers.slice(1).map((s) => `${s.name} ${fmt(s.unitCostCents)}`).join(', ')}</div>` : ''}`
          : html`<span class="muted">No supplier linked</span>`}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty">Nothing needs restocking right now. 🎉</div>`);
  }
  document.getElementById('go').onclick = load;
  document.getElementById('list').addEventListener('click', (e) => {
    if (e.target.id !== 'mkpo') return;
    const picked = [...view.querySelectorAll('input[data-i]:checked')].map((c) => {
      const r = data.items[+c.dataset.i];
      return { bookId: r.bookId, title: r.title + (r.edition ? ` (${r.edition})` : ''), quantity: Math.max(1, Number(view.querySelector(`input[data-qty="${c.dataset.i}"]`).value) || r.suggestedQty), supplierId: r.suppliers[0]?.supplierId };
    });
    if (!picked.length) return toast('Tick at least one book first', 'bad');
    // Pre-select the supplier that is cheapest for the most selected books.
    const tally = {};
    picked.forEach((x) => { if (x.supplierId) tally[x.supplierId] = (tally[x.supplierId] || 0) + 1; });
    const supplierId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    sessionStorage.setItem('poPrefill', JSON.stringify({ supplierId, items: picked }));
    location.hash = '#/purchases';
  });
  load();
}
