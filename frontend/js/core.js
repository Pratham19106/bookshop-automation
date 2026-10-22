// Shared helpers: API client, safe HTML templating, formatting, dialogs, toasts.

export const state = { user: null, settings: { currencySymbol: '₹', taxPercent: 0, staffMaxDiscountPercent: 10, shopName: '' } };

// ---- safe templating: interpolated values are escaped unless wrapped in raw()
class Raw { constructor(s) { this.s = s; } }
export const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function part(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
  return new Raw(out);
}
export const render = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); };

// ---- API
export class ApiError extends Error {
  constructor(status, body) { super(body?.error?.message || `Request failed (${status})`); this.status = status; this.code = body?.error?.code; this.details = body?.error?.details; }
}
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bookshop' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: { message: 'Cannot reach the server. Check that it is running.' } });
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && state.user) { state.user = null; location.hash = '#/login'; }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined && v !== false) p.set(k, v === true ? '1' : v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---- formatting
export const fmt = (cents) => {
  const n = (cents ?? 0) / 100;
  return `${state.settings.currencySymbol}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
// "199.50" -> 19950 ; returns null for blank/invalid
export function parseMoney(s) {
  const t = String(s ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const money = (cents) => (cents / 100).toFixed(2);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const label = (s) => String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export const badge = (text, kind = '') => html`<span class="badge ${kind}">${label(text)}</span>`;
export const statusKind = (s) => ({ completed: 'ok', paid: 'ok', received: 'ok', ready: 'info', partial: 'warn', placed: 'info', ordered: 'info', partially_received: 'warn',
  out_for_delivery: 'warn', cancelled: 'bad', voided: 'bad', refund_due: 'bad', unpaid: 'muted', refunded: 'muted' }[s] || '');

// ---- toasts & dialogs
export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
export const fail = (e) => toast(e.message || 'Something went wrong', 'bad');

export function modal(title, body, { wide = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = wide ? 'wide' : '';
  dlg.innerHTML = `<div class="dlg-head"><h2></h2><button class="icon" data-close aria-label="Close">✕</button></div><div class="dlg-body"></div>`;
  dlg.querySelector('h2').textContent = title;
  const bodyEl = dlg.querySelector('.dlg-body');
  render(bodyEl, body);
  dlg.addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.setBody = (b) => render(bodyEl, b);
  dlg.bodyEl = bodyEl;
  return dlg;
}

export function confirmBox(message) {
  return new Promise((resolve) => {
    const dlg = modal('Please confirm', html`<p>${message}</p><div class="actions"><button data-close>Cancel</button><button class="primary" id="yes">Confirm</button></div>`);
    dlg.querySelector('#yes').onclick = () => { resolve(true); dlg.close(); };
    dlg.addEventListener('close', () => resolve(false));
  });
}

// Form helper: gather named fields from a container into an object of strings.
export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value;
  });
  return out;
}

// Run an async action with a disabled button to prevent double submits.
export async function guarded(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); } catch (e) { fail(e); } finally { btn.disabled = false; }
}

// Reusable book picker: search box + clickable results. onPick(book) is called on selection (Enter picks a sole result).
export function bookPicker(container, onPick, { placeholder = 'Search title, author or ISBN…', includeStock = true } = {}) {
  container.innerHTML = `<input type="search" class="picker-q" placeholder="" autocomplete="off"><div class="picker-results" role="listbox"></div>`;
  const input = container.querySelector('input');
  input.placeholder = placeholder;
  const results = container.querySelector('.picker-results');
  let items = [];
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; items = []; return; }
    try {
      const r = await get(`/books${qs({ q, limit: 12 })}`);
      items = r.items;
      render(results, html`${items.length ? '' : html`<div class="empty">No books match “${q}”.</div>`}${items.map((b, i) => html`
        <button type="button" class="result" data-i="${i}" ${b.availableQty <= 0 && includeStock ? raw('data-oos="1"') : ''}>
          <span class="r-title">${b.title}${b.edition ? html` <em>(${b.edition})</em>` : ''}</span>
          <span class="r-sub">${b.author}${b.publisher ? ` · ${b.publisher}` : ''}${b.isbn ? ` · ISBN ${b.isbn}` : ''}</span>
          <span class="r-meta"><strong>${fmt(b.priceCents)}</strong>
            ${includeStock ? html`<span class="${b.availableQty <= 0 ? 'bad' : b.isLowStock ? 'warn' : ''}">${b.availableQty} in stock${b.reservedQty ? ` (${b.reservedQty} reserved)` : ''}</span>` : ''}
            <span class="loc">${b.location || 'No location set'}</span></span>
        </button>`)}`);
    } catch (e) { fail(e); }
  });
  input.addEventListener('input', run);
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    // Always re-query on Enter (a typed/scanned ISBN) so a stale result list can never pick the wrong book.
    const r = await get(`/books${qs({ q, limit: 12 })}`).catch(() => ({ items: [] }));
    if (r.items.length === 1) { onPick(r.items[0]); input.value = ''; results.innerHTML = ''; items = []; }
  });
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('.result');
    if (!btn) return;
    onPick(items[Number(btn.dataset.i)]);
    input.value = '';
    results.innerHTML = '';
    items = [];
    input.focus();
  });
  return { focus: () => input.focus() };
}
