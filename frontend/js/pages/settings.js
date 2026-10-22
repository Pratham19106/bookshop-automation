import { state, html, render, get, post, put, modal, toast, fail, guarded, badge } from '../core.js';

export default async function settings(view) {
  const owner = state.user.role === 'owner';
  render(view, html`<h1>Settings</h1>
    <div class="grid g2">
      <section class="card"><h2>Change my password</h2>
        <form id="pw"><div class="field"><label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="new">New password (8+ characters)</label><input id="new" type="password" autocomplete="new-password" minlength="8" required></div>
        <button class="primary">Change password</button></form></section>
      ${owner ? html`<section class="card"><h2>Shop &amp; business rules</h2><form id="sf"></form></section>` : ''}
    </div>
    ${owner ? html`<section class="card" style="margin-top:14px"><div class="row between"><h2>Users</h2><button id="adduser">+ Add user</button></div><div id="users"></div></section>` : ''}`);

  document.getElementById('pw').onsubmit = (e) => {
    e.preventDefault();
    guarded(e.target.querySelector('button'), async () => {
      await post('/auth/password', { currentPassword: document.getElementById('cur').value, newPassword: document.getElementById('new').value });
      toast('Password changed'); e.target.reset();
    });
  };
  if (!owner) return;

  const s = await get('/settings');
  const num = (id, lbl, v, extra = '') => html`<div class="field"><label for="${id}">${lbl}</label><input id="${id}" type="number" step="any" value="${v}" ${extra}></div>`;
  render(document.getElementById('sf'), html`
    <div class="field"><label for="shopName">Shop name (printed on receipts)</label><input id="shopName" value="${s.shopName}" maxlength="100"></div>
    <div class="field"><label for="shopAddress">Address</label><input id="shopAddress" value="${s.shopAddress}" maxlength="300"></div>
    <div class="grid g2"><div class="field"><label for="currencySymbol">Currency symbol</label><input id="currencySymbol" value="${s.currencySymbol}" maxlength="5"></div>
      ${num('taxPercent', 'Tax on bills (%)', s.taxPercent, 'min="0" max="100"')}
      ${num('staffMaxDiscountPercent', 'Max discount for staff (%)', s.staffMaxDiscountPercent, 'min="0" max="100"')}
      ${num('defaultLowStockThreshold', 'Default low-stock alert (copies)', s.defaultLowStockThreshold, 'min="0"')}
      ${num('restockLookbackDays', 'Restock: sales analysed over (days)', s.restockLookbackDays, 'min="7" max="365"')}
      ${num('restockCoverDays', 'Restock: order to cover (days)', s.restockCoverDays, 'min="1" max="365"')}
      ${num('restockDefaultLeadTimeDays', 'Restock: default lead time (days)', s.restockDefaultLeadTimeDays, 'min="0"')}</div>
    <p class="muted small">Tax and discount changes apply to new bills and orders only; existing bills keep what they were saved with.</p>
    <button class="primary">Save settings</button>`);
  document.getElementById('sf').onsubmit = (e) => {
    e.preventDefault();
    guarded(e.target.querySelector('button'), async () => {
      const g = (id) => document.getElementById(id).value;
      const body = { shopName: g('shopName'), shopAddress: g('shopAddress'), currencySymbol: g('currencySymbol') };
      ['taxPercent', 'staffMaxDiscountPercent', 'defaultLowStockThreshold', 'restockLookbackDays', 'restockCoverDays', 'restockDefaultLeadTimeDays'].forEach((k) => { body[k] = Number(g(k)); });
      state.settings = await put('/settings', body);
      document.getElementById('shopname').textContent = state.settings.shopName;
      toast('Settings saved');
    });
  };

  const loadUsers = async () => {
    const us = await get('/users');
    render(document.getElementById('users'), html`<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${us.map((u) => html`<tr><td><strong>${u.fullName}</strong><div class="muted small">${u.username}</div></td><td>${u.role}</td><td>${u.active ? badge('active', 'ok') : badge('disabled', 'bad')}</td>
        <td class="nowrap"><button class="small" data-reset="${u.id}">Reset password</button>
          ${u.id !== state.user.id ? html`<button class="small ${u.active ? 'danger' : ''}" data-toggle="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`)}</tbody></table></div>`);
  };
  document.getElementById('users').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.toggle) guarded(b, async () => { await post(`/users/${b.dataset.toggle}/active`, { active: b.dataset.active === '1' }); loadUsers(); });
    if (b.dataset.reset) {
      const d = modal('Reset password', html`<div class="field"><label for="np">New password (8+ characters)</label><input id="np" type="password" minlength="8" autocomplete="new-password"></div>
        <p class="muted small">The user will be signed out everywhere.</p><div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Reset</button></div>`);
      d.querySelector('#go').onclick = (ev) => guarded(ev.target, async () => { await post(`/users/${b.dataset.reset}/password`, { newPassword: d.querySelector('#np').value }); toast('Password reset'); d.close(); });
    }
  };
  document.getElementById('adduser').onclick = () => {
    const d = modal('Add user', html`<div class="grid g2"><div class="field"><label for="un">Username</label><input id="un" maxlength="50" autocomplete="off"></div>
      <div class="field"><label for="fn">Full name</label><input id="fn" maxlength="100"></div>
      <div class="field"><label for="pwd">Password (8+ characters)</label><input id="pwd" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="rl">Role</label><select id="rl"><option value="staff">Staff</option><option value="owner">Owner</option></select></div></div>
      <div class="actions"><button data-close>Cancel</button><button class="primary" id="go">Create user</button></div>`);
    d.querySelector('#go').onclick = (ev) => guarded(ev.target, async () => {
      await post('/users', { username: d.querySelector('#un').value, fullName: d.querySelector('#fn').value, password: d.querySelector('#pwd').value, role: d.querySelector('#rl').value });
      toast('User created'); d.close(); loadUsers();
    });
  };
  loadUsers();
}
