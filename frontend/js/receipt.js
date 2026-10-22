import { state, get, html, render, fmt, fmtDateTime, label } from './core.js';

const el = document.getElementById('receipt');
document.getElementById('print').onclick = () => window.print();

(async () => {
  try {
    const id = new URLSearchParams(location.search).get('id');
    state.settings = await get('/settings');
    const b = await get(`/sales/${Number(id)}`);
    const s = state.settings;
    document.title = `Receipt ${b.billNo}`;
    render(el, html`
      <h1>${s.shopName}</h1>
      ${s.shopAddress ? html`<div class="c">${s.shopAddress}</div>` : ''}
      <hr>
      <div>Bill: ${b.billNo}</div><div>Date: ${fmtDateTime(b.createdAt)}</div>
      <div>Cashier: ${b.cashier}</div>${b.customerName ? html`<div>Customer: ${b.customerName}</div>` : ''}
      ${b.status === 'voided' ? html`<div class="void">*** VOIDED ***</div>` : ''}
      <hr>
      <table>${b.items.map((i) => html`<tr><td colspan="2">${i.title}${i.edition ? ` (${i.edition})` : ''}</td></tr>
        <tr><td>&nbsp;&nbsp;${i.quantity} x ${fmt(i.unitPriceCents)}</td><td class="r">${fmt(i.lineTotalCents)}</td></tr>`)}</table>
      <hr>
      <table>
        <tr><td>Subtotal</td><td class="r">${fmt(b.subtotalCents)}</td></tr>
        ${b.discountCents ? html`<tr><td>Discount (${b.discountPercent}%)</td><td class="r">-${fmt(b.discountCents)}</td></tr>` : ''}
        ${b.taxCents ? html`<tr><td>Tax (${b.taxPercent}%)</td><td class="r">${fmt(b.taxCents)}</td></tr>` : ''}
        <tr class="tot"><td>TOTAL</td><td class="r">${fmt(b.totalCents)}</td></tr>
        <tr><td>Paid by</td><td class="r">${label(b.paymentMethod)}</td></tr>
      </table>
      <hr><div class="c">Thank you for shopping with us!</div>`);
  } catch (e) {
    render(el, html`<p>Could not load this bill: ${e.message}</p><p><a href="/">Sign in</a> first if you are signed out.</p>`);
  }
})();
