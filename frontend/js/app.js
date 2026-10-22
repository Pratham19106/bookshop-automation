import { state, get, post, html, render, esc, fail, toast } from './core.js';

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');

// path -> { group (sidebar section), title, owner?: true, mod: () => import(page module) }
const ROUTES = {
  '/billing': { group: 'Sales', title: 'Billing', mod: () => import('./pages/billing.js') },
  '/bills': { group: 'Sales', title: 'Bills', mod: () => import('./pages/bills.js') },
  '/orders': { group: 'Sales', title: 'Phone Orders', mod: () => import('./pages/orders.js') },
  '/catalogue': { group: 'Stock', title: 'Catalogue', mod: () => import('./pages/catalogue.js') },
  '/inventory': { group: 'Stock', title: 'Inventory', mod: () => import('./pages/inventory.js') },
  '/restock': { group: 'Stock', title: 'Restocking', owner: true, mod: () => import('./pages/restock.js') },
  '/suppliers': { group: 'Stock', title: 'Suppliers', owner: true, mod: () => import('./pages/suppliers.js') },
  '/purchases': { group: 'Stock', title: 'Purchases', owner: true, mod: () => import('./pages/purchases.js') },
  '/dashboard': { group: 'Reports', title: 'Dashboard', owner: true, mod: () => import('./pages/dashboard.js') },
  '/expenses': { group: 'Reports', title: 'Expenses', owner: true, mod: () => import('./pages/expenses.js') },
  '/settings': { group: 'Admin', title: 'Settings', mod: () => import('./pages/settings.js') },
};
const GROUPS = ['Sales', 'Stock', 'Reports', 'Admin'];

function home() { return state.user.role === 'owner' ? '/dashboard' : '/billing'; }

function renderNav(current) {
  const links = Object.entries(ROUTES).filter(([, r]) => !r.owner || state.user.role === 'owner');
  render(document.getElementById('nav'), html`${GROUPS.map((g) => {
    const items = links.filter(([, r]) => r.group === g);
    return items.length ? html`<div class="nav-h">${g}</div>${items.map(([path, r]) => html`<a href="#${path}" class="${path === current ? 'active' : ''}">${r.title}</a>`)}` : '';
  })}`);
  document.getElementById('pagetitle').textContent = ROUTES[current].title;
}

// Sidebar + header only exist when signed in.
function chrome(on) {
  topbar.hidden = !on;
  document.getElementById('sidebar').hidden = !on;
  document.body.classList.toggle('authed', on);
}

async function route() {
  if (!state.user) {
    try { state.user = (await get('/auth/me')).user; } catch { /* not signed in */ }
  }
  const path = location.hash.replace(/^#/, '') || '/';
  if (!state.user) return showLogin();
  if (!state.settingsLoaded) {
    state.settings = await get('/settings').catch(() => state.settings);
    state.settingsLoaded = true;
  }
  chrome(true);
  document.getElementById('shopname').textContent = state.settings.shopName || 'Bookshop';
  document.getElementById('whoami').textContent = `${state.user.fullName} (${state.user.role})`;
  if (path === '/' || !ROUTES[path]) { location.hash = `#${home()}`; return; }
  const r = ROUTES[path];
  if (r.owner && state.user.role !== 'owner') { location.hash = `#${home()}`; return; }
  renderNav(path);
  document.title = `${r.title} · ${state.settings.shopName || 'Bookshop'}`;
  render(view, html`<div class="loading">Loading…</div>`);
  try {
    const mod = await r.mod();
    const token = (state.routeToken = Symbol());
    await mod.default(view, { isStale: () => state.routeToken !== token });
  } catch (e) {
    render(view, html`<div class="error-box"><strong>Could not load this page.</strong><br>${e.message}</div>`);
  }
}

function showLogin() {
  chrome(false);
  document.title = 'Sign in · Bookshop';
  render(view, html`<div class="login"><div class="card">
    <h1>Sign in</h1>
    <form id="login">
      <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      <div id="login-err" class="notice bad" hidden></div>
      <button class="primary" style="width:100%">Sign in</button>
    </form></div></div>`);
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('login-err');
    err.hidden = true;
    try {
      const f = new FormData(e.target);
      const r = await post('/auth/login', { username: f.get('username'), password: f.get('password') });
      state.user = r.user;
      state.settingsLoaded = false;
      location.hash = `#${home()}`;
      route();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
}

document.getElementById('logout').onclick = async () => {
  try { await post('/auth/logout'); } catch (e) { fail(e); }
  state.user = null;
  state.settingsLoaded = false;
  location.hash = '#/login';
  route();
};

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message) toast(e.reason.message, 'bad'); });
route();
export { esc };
