import { state, html, render, raw, get, post, put, qs, fmt, fmtDateTime, parseMoney, money, label, modal, toast, fail, debounce, guarded, formData, badge, confirmBox } from '../core.js';

const field = (name, lbl, value = '', attrs = '') => html`<div class="field"><label for="f-${name}">${lbl}</label><input id="f-${name}" name="${name}" value="${value ?? ''}" ${raw(attrs)}></div>`;

// Add/edit form. Stock is deliberately not editable here: it only changes through sales, receipts and counted adjustments.
export function bookForm(book, onSaved) {
  const edit = !!book;
  const dlg = modal(edit ? `Edit: ${book.title}` : 'Add a book', html`
    <form id="bf">
      <div class="grid g2">
        ${field('title', 'Title *', book?.title, 'required maxlength="300"')}
        ${field('author', 'Author *', book?.author, 'required maxlength="200"')}
        ${field('isbn', 'ISBN (10 or 13 digits)', book?.isbn, 'maxlength="20"')}
        ${field('publisher', 'Publisher', book?.publisher, 'maxlength="200"')}
        ${field('edition', 'Edition (e.g. 2nd, Paperback 2021)', book?.edition, 'maxlength="100"')}
        ${field('genre', 'Genre', book?.genre, 'maxlength="100" list="genres"')}
        ${field('price', `Selling price (${state.settings.currencySymbol}) *`, book ? money(book.priceCents) : '', 'required inputmode="decimal"')}
        ${field('lowStockThreshold', `Low-stock alert at (blank = shop default ${state.settings.defaultLowStockThreshold})`, book && !book.thresholdIsDefault ? book.lowStockThreshold : '', 'type="number" min="0"')}
        ${edit ? '' : field('openingStock', 'Opening stock', '0', 'type="number" min="0"')}
      </div>
      <h3>Shelf location</h3>
      <div class="grid g3">${field('aisle', 'Aisle', book?.aisle, 'maxlength="30"')}${field('rack', 'Rack', book?.rack, 'maxlength="30"')}${field('shelf', 'Shelf', book?.shelf, 'maxlength="30"')}</div>
      <datalist id="genres"></datalist>
      <p class="muted small">A different edition of the same title is a separate record with its own ISBN and stock.</p>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary" id="save">${edit ? 'Save changes' : 'Add book'}</button></div>
    </form>`, { wide: true });
  get('/books/genres').then((g) => { dlg.querySelector('#genres').innerHTML = g.map((x) => `<option value="${x.replace(/"/g, '&quot;')}">`).join(''); }).catch(() => {});
  dlg.querySelector('#bf').onsubmit = (e) => {
    e.preventDefault();
    guarded(dlg.querySelector('#save'), async () => {
      const f = formData(dlg.querySelector('#bf'));
      const price = parseMoney(f.price);
      if (price === null) throw new Error('Enter the price like 199 or 199.50');
      const body = { title: f.title, author: f.author, isbn: f.isbn, publisher: f.publisher, edition: f.edition, genre: f.genre,
        priceCents: price, aisle: f.aisle, rack: f.rack, shelf: f.shelf,
        lowStockThreshold: f.lowStockThreshold === '' ? null : Number(f.lowStockThreshold) };
      if (!edit) body.openingStock = Number(f.openingStock || 0);
      const saved = edit ? await put(`/books/${book.id}`, body) : await post('/books', body);
      toast(edit ? 'Book updated' : 'Book added');
      dlg.close();
      onSaved && onSaved(saved);
    });
  };
}

const reasonLabel = { sale: 'Sale', sale_void: 'Sale voided', receipt: 'Goods received', adjustment: 'Stock count correction', opening: 'Opening stock' };

export async function bookDetail(id, onChange) {
  const owner = state.user.role === 'owner';
  const [b, moves, sup] = await Promise.all([
    get(`/books/${id}`), get(`/books/${id}/movements?limit=30`), owner ? get(`/books/${id}/suppliers`) : Promise.resolve(null),
  ]);
  const dlg = modal(b.title, html`
    <dl class="kv">
      <dt>Author</dt><dd>${b.author}</dd>
      <dt>Edition</dt><dd>${b.edition || '—'} ${b.publisher ? html`· ${b.publisher}` : ''}</dd>
      <dt>ISBN</dt><dd>${b.isbn || '—'}</dd><dt>Genre</dt><dd>${b.genre || '—'}</dd>
      <dt>Location</dt><dd><strong>${b.location || 'Not set'}</strong></dd>
      <dt>Price</dt><dd>${fmt(b.priceCents)} ${owner ? html`<span class="muted small">· avg cost ${b.costCents ? fmt(b.costCents) : 'unknown'}</span>` : ''}</dd>
      <dt>Stock</dt><dd><strong>${b.stockQty}</strong> on hand · ${b.reservedQty} reserved · <strong class="${b.isLowStock ? 'warn' : ''}">${b.availableQty} available</strong>
        <span class="muted small">(alert at ${b.lowStockThreshold}${b.thresholdIsDefault ? ', shop default' : ''})</span></dd>
      <dt>Status</dt><dd>${b.active ? badge('active', 'ok') : badge('retired', 'bad')}</dd>
    </dl>
    <div class="row"><button id="edit">Edit details</button>
      ${owner ? html`<button id="adjust">Correct stock…</button><button id="toggle" class="${b.active ? 'danger' : ''}">${b.active ? 'Retire title' : 'Restore title'}</button>` : ''}</div>
    ${owner ? html`<h3>Suppliers for this book</h3>${sup.length ? html`<div class="table-wrap"><table><thead><tr><th>Supplier</th><th class="num">Quoted cost</th><th class="num">Last paid</th><th class="num">Bought</th><th class="num">Lead time</th></tr></thead>
      <tbody>${sup.map((s) => html`<tr><td>${s.name} ${s.isCheapest && sup.length > 1 ? badge('cheapest', 'ok') : ''}<div class="muted small">${s.phone} ${s.email}</div></td>
      <td class="num">${fmt(s.unitCostCents)}</td><td class="num">${s.lastPaidCents != null ? fmt(s.lastPaidCents) : '—'}</td><td class="num">${s.qtyPurchased}</td><td class="num">${s.leadTimeDays} d</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">No supplier is linked yet. Add quotes from the Suppliers page.</p>`}` : ''}
    <h3>Recent stock movements</h3>
    ${moves.length ? html`<div class="table-wrap"><table><thead><tr><th>When</th><th>Reason</th><th class="num">Change</th><th>Note</th></tr></thead>
      <tbody>${moves.map((m) => html`<tr><td class="nowrap">${fmtDateTime(m.createdAt)}</td><td>${reasonLabel[m.reason] || m.reason}</td>
        <td class="num ${m.delta < 0 ? 'bad' : 'ok'}">${m.delta > 0 ? '+' : ''}${m.delta}</td><td>${m.note}${m.user ? html` <span class="muted small">(${m.user})</span>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">No movements yet.</p>`}`, { wide: true });

  dlg.querySelector('#edit').onclick = () => { dlg.close(); bookForm(b, () => { onChange && onChange(); bookDetail(id, onChange).catch(fail); }); };
  const adj = dlg.querySelector('#adjust');
  if (adj) adj.onclick = () => adjustDialog(b, () => { dlg.close(); onChange && onChange(); bookDetail(id, onChange).catch(fail); });
  const tog = dlg.querySelector('#toggle');
  if (tog) tog.onclick = () => guarded(tog, async () => {
    if (b.active && !(await confirmBox(`Retire “${b.title}”? It will disappear from billing and search but keep its history.`))) return;
    await post(`/books/${id}/active`, { active: !b.active });
    toast(b.active ? 'Title retired' : 'Title restored'); dlg.close(); onChange && onChange();
  });
}

export function adjustDialog(b, onDone) {
  const dlg = modal(`Correct stock: ${b.title}`, html`
    <p>System shows <strong>${b.stockQty}</strong> on hand${b.reservedQty ? ` (${b.reservedQty} of them reserved for phone orders)` : ''}. Enter the quantity you physically counted.</p>
    <div class="field"><label for="cnt">Counted quantity</label><input id="cnt" type="number" min="${b.reservedQty}" value="${b.stockQty}"></div>
    <div class="field"><label for="why">Reason (required, kept in the audit trail)</label><input id="why" maxlength="300" placeholder="e.g. 2 copies damaged, found 1 miscounted"></div>
    <div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Apply correction</button></div>`);
  dlg.querySelector('#go').onclick = (e) => guarded(e.target, async () => {
    await post(`/books/${b.id}/adjust`, { countedQty: Number(dlg.querySelector('#cnt').value), reason: dlg.querySelector('#why').value });
    toast('Stock corrected'); dlg.close(); onDone && onDone();
  });
}

export default async function catalogue(view) {
  const f = { q: '', genre: '', low: false, inactive: false };
  const genres = await get('/books/genres');
  render(view, html`<div class="row between"><h1>Catalogue</h1><button class="primary" id="add">+ Add book</button></div>
    <div class="toolbar">
      <div class="grow"><label for="q">Search title, author, ISBN, publisher</label><input id="q" type="search" style="width:100%" autofocus></div>
      <div><label for="genre">Genre</label><select id="genre"><option value="">All</option>${genres.map((g) => html`<option>${g}</option>`)}</select></div>
      <div><label><input type="checkbox" id="low"> Low stock only</label></div>
      ${state.user.role === 'owner' ? html`<div><label><input type="checkbox" id="inactive"> Show retired</label></div>` : ''}
    </div><div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const r = await get(`/books${qs({ q: f.q, genre: f.genre, low: f.low, inactive: f.inactive, limit: 100 })}`);
      render(list, r.items.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Author</th><th>ISBN</th><th class="num">Price</th><th class="num">In stock</th><th>Location</th></tr></thead>
        <tbody>${r.items.map((b) => html`<tr class="clickable" data-id="${b.id}">
          <td><strong>${b.title}</strong>${b.edition ? html` <em class="muted">(${b.edition})</em>` : ''}${b.active ? '' : html` ${badge('retired', 'bad')}`}<div class="muted small">${b.publisher}</div></td>
          <td>${b.author}</td><td class="nowrap small mono">${b.isbn || html`<span class="muted">none</span>`}</td><td class="num">${fmt(b.priceCents)}</td>
          <td class="num"><span class="${b.availableQty <= 0 ? 'bad' : b.isLowStock ? 'warn' : ''}">${b.availableQty}</span>${b.reservedQty ? html`<div class="muted small">${b.reservedQty} reserved</div>` : ''}</td>
          <td>${b.location || html`<span class="muted">not set</span>`}</td></tr>`)}</tbody></table></div>
        <p class="muted small">${r.total > r.items.length ? `Showing ${r.items.length} of ${r.total} — refine your search.` : `${r.total} title(s)`}</p>`
        : html`<div class="empty">No books found. ${f.q ? 'Try fewer words, or ' : ''}<button class="link" id="add2">add a new book</button>.</div>`);
      const a2 = document.getElementById('add2'); if (a2) a2.onclick = openAdd;
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  const openAdd = () => bookForm(null, load);
  document.getElementById('add').onclick = openAdd;
  const reload = debounce(() => {
    f.q = document.getElementById('q').value; f.genre = document.getElementById('genre').value;
    f.low = document.getElementById('low').checked; const i = document.getElementById('inactive'); f.inactive = !!(i && i.checked); load();
  });
  view.querySelector('.toolbar').addEventListener('input', reload);
  document.getElementById('list').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) bookDetail(tr.dataset.id, load).catch(fail);
  });
  load();
}
