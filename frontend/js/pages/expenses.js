import { state, html, render, get, post, del, qs, fmt, fmtDate, parseMoney, toast, fail, guarded, today, daysAgo, confirmBox } from '../core.js';

export default async function expenses(view) {
  const f = { from: daysAgo(89), to: today() };
  render(view, html`<h1>Operating Expenses</h1>
    <p class="muted">Record rent, wages, utilities and similar costs. Stock purchases are recorded automatically through purchase orders and goods receipts — do not enter them here.</p>
    <form class="card" id="nf"><div class="toolbar" style="margin:0">
      <div><label for="d">Date</label><input id="d" type="date" value="${today()}" required></div>
      <div><label for="c">Category</label><input id="c" list="cats" maxlength="60" required placeholder="Rent, Wages…"><datalist id="cats"><option>Rent</option><option>Wages</option><option>Utilities</option><option>Transport</option><option>Packaging</option><option>Repairs</option><option>Other</option></datalist></div>
      <div class="grow"><label for="ds">Description</label><input id="ds" maxlength="300" style="width:100%"></div>
      <div><label for="a">Amount (${state.settings.currencySymbol})</label><input id="a" inputmode="decimal" required style="width:9em"></div>
      <div><button class="primary">Add expense</button></div></div></form>
    <div class="toolbar" style="margin-top:14px"><div><label for="from">From</label><input id="from" type="date" value="${f.from}"></div><div><label for="to">To</label><input id="to" type="date" value="${f.to}"></div></div>
    <div id="list"></div>`);
  const load = async () => {
    const list = document.getElementById('list');
    try {
      const rows = await get(`/expenses${qs(f)}`);
      const total = rows.reduce((s, r) => s + r.amountCents, 0);
      render(list, rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${rows.map((r) => html`<tr><td>${fmtDate(r.date)}</td><td>${r.category}</td><td>${r.description}</td><td class="num">${fmt(r.amountCents)}</td>
          <td><button class="small danger" data-del="${r.id}">Delete</button></td></tr>`)}
          <tr class="total-row"><td colspan="3">Total</td><td class="num">${fmt(total)}</td><td></td></tr></tbody></table></div>` : html`<div class="empty">No expenses recorded in this range.</div>`);
    } catch (e) { render(list, html`<div class="error-box">${e.message}</div>`); }
  };
  document.getElementById('nf').onsubmit = (e) => {
    e.preventDefault();
    guarded(e.target.querySelector('button'), async () => {
      const cents = parseMoney(document.getElementById('a').value);
      if (!cents) throw new Error('Enter an amount like 1500 or 1500.50');
      await post('/expenses', { date: document.getElementById('d').value, category: document.getElementById('c').value, description: document.getElementById('ds').value, amountCents: cents });
      toast('Expense added'); document.getElementById('a').value = ''; document.getElementById('ds').value = ''; load();
    });
  };
  view.querySelectorAll('#from,#to').forEach((i) => i.addEventListener('change', () => { f.from = document.getElementById('from').value; f.to = document.getElementById('to').value; load(); }));
  document.getElementById('list').onclick = (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    guarded(b, async () => { if (await confirmBox('Delete this expense?')) { await del(`/expenses/${b.dataset.del}`); toast('Deleted'); load(); } });
  };
  load();
}
