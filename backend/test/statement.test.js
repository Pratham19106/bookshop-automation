const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Financial statement: one column per shop + total, same figures as the dashboard, tenant/role scoped.
describe('financial statement', () => {
  let t;
  let st;
  before(async () => {
    t = await setup();
    const a = await t.addBook({ title: 'Statement A', priceCents: 10000, openingStock: 10 });
    const b = await t.addBook({ title: 'Statement B', priceCents: 10000, openingStock: 10 });
    assert.equal((await t.asOwner.shop(t.shop2).post(`/api/books/${a.id}/adjust`, { countedQty: 5, reason: 'count' })).status, 200);
    t.asOwner.shop(null);

    // Shop 1: 2 copies cash, then 1 refunded and 1 exchanged for B.
    const s1 = (await t.asStaff.post('/api/sales', { items: [{ bookId: a.id, quantity: 2 }], paymentMethod: 'cash' })).body;
    assert.equal((await t.asStaff.post(`/api/sales/${s1.id}/refund`, { itemId: s1.items[0].id, quantity: 1 })).status, 200);
    assert.equal((await t.asStaff.post(`/api/sales/${s1.id}/exchange`, { itemId: s1.items[0].id, quantity: 1, replacementBookId: b.id })).status, 200);
    // Shop 2: 1 copy by UPI, and rent.
    assert.equal((await t.asStaff2.post('/api/sales', { items: [{ bookId: a.id, quantity: 1 }], paymentMethod: 'upi' })).status, 201);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await t.asManager.shop(t.shop2).post('/api/expenses', { date: today, category: 'Rent', amountCents: 5000 })).status, 201);
    t.asManager.shop(null);

    const res = await t.asOwner.get('/api/reports/statement?outlet=all');
    assert.equal(res.status, 200, res.text);
    st = res.body;
  });
  after(async () => { await t.close(); });

  it('has one column per shop plus a total, in shop order', () => {
    assert.deepEqual(st.columns.map((c) => c.label), ['S01', 'S02', 'Total']);
    assert.match(st.statementNo, /^STM-ALL-\d{8}-\d{8}$/);
    assert.equal(st.business.name, 'Test Books');
    assert.deepEqual(st.expenseCategories, ['Rent']);
  });

  it('shows sales, refunds, exchanges and payments per shop', () => {
    const [s1, s2] = st.columns;
    assert.equal(s1.bills, 1);
    assert.equal(s1.grossSalesCents, 20000);
    assert.equal(s1.refundCount, 1);
    assert.equal(s1.refundCents, 10000);
    assert.equal(s1.netSalesCents, 10000);
    assert.equal(s1.exchangeCount, 1);
    assert.equal(s1.payments.cash, 10000); // 200.00 taken, 100.00 handed back
    assert.equal(s1.payments.upi, 0);
    assert.equal(s2.payments.upi, 10000);
    assert.equal(s2.expenses.Rent, 5000);
    assert.equal(s2.operatingProfitCents, s2.grossProfitCents - 5000);
  });

  it('total column is the sum of the shop columns', () => {
    const [s1, s2, total] = st.columns;
    for (const k of ['bills', 'grossSalesCents', 'discountCents', 'refundCents', 'netSalesCents', 'taxCents', 'receivedCents',
      'cogsCents', 'grossProfitCents', 'expensesCents', 'operatingProfitCents', 'purchasesCents', 'exchangeCount']) {
      assert.equal(total[k], s1[k] + s2[k], k);
    }
    for (const m of st.paymentMethods) assert.equal(total.payments[m], s1.payments[m] + s2.payments[m], m);
  });

  it('matches the dashboard figures', async () => {
    const d = (await t.asOwner.get('/api/dashboard?outlet=all')).body.summary;
    const total = st.columns.at(-1);
    assert.equal(total.netSalesCents, d.netSalesCents);
    assert.equal(total.grossProfitCents, d.grossProfitCents);
    assert.equal(total.operatingProfitCents, d.operatingProfitCents);
  });

  it('a single shop gives a single column', async () => {
    const r = await t.asManager.get(`/api/reports/statement?outlet=${t.shop1}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.columns.map((c) => c.label), ['S01']);
    assert.equal(r.body.columns[0].netSalesCents, st.columns[0].netSalesCents);
  });

  it('is limited to managers and owners, and to their own shops and business', async () => {
    assert.equal((await t.asStaff.get('/api/reports/statement')).status, 403);
    assert.equal((await t.asOther.get(`/api/reports/statement?outlet=${t.shop1}`)).status, 403);
    const other = (await t.asOther.get('/api/reports/statement?outlet=all')).body;
    assert.equal(other.columns.at(-1).bills, 0);
    assert.equal((await t.asOwner.get('/api/reports/statement?from=2026-05-02&to=2026-05-01')).status, 400);
  });
});
