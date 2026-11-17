const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { eventsFor } = require('../src/lib/hub');

describe('live updates (Server-Sent Events)', () => {
  let t;
  before(async () => { t = await setup(); });
  after(async () => { await t.close(); });

  it('maps API writes to events', () => {
    assert.deepEqual(eventsFor('POST', '/sales'), ['sale','arrangement']);
    assert.deepEqual(eventsFor('POST', '/sales/12/refund'), ['return','arrangement']);
    assert.deepEqual(eventsFor('POST', '/sales/12/exchange'), ['return','arrangement']);
    assert.deepEqual(eventsFor('POST', '/sales/12/adjustments'), ['return','arrangement']);
    assert.deepEqual(eventsFor('POST', '/sales/12/void'), ['void','arrangement']);
    assert.deepEqual(eventsFor('POST', '/orders/3/fulfil'), ['sale', 'orders','arrangement']);
    assert.deepEqual(eventsFor('POST', '/orders'), ['orders']);
    assert.deepEqual(eventsFor('POST', '/purchase-orders/4/receive'), ['stock', 'purchasing','arrangement']);
    assert.deepEqual(eventsFor('PUT', '/books/9/location'), ['books']);
    assert.deepEqual(eventsFor('DELETE', '/expenses/2'), ['expenses']);
    assert.deepEqual(eventsFor('POST', '/auth/login'), []);
  });

  it('refuses the stream without a session', async () => {
    const s = await t.client().stream();
    assert.equal(s.status, 401);
  });

  it('a sale in shop 1 reaches the owner and shop-1 staff, not shop-2 staff or another business', async () => {
    const book = await t.addBook({ openingStock: 5 });
    const owner = await t.asOwner.stream();
    const staff2 = await t.asStaff2.stream();
    const other = await t.asOther.stream();
    const staff = await (await t.signedIn('staff', 'staff-pass-1')).stream();
    try {
      for (const s of [owner, staff2, other, staff]) {
        assert.equal(s.status, 200);
        assert.ok(await s.waitFor((e) => e.event === 'ready'), 'stream opens with a ready event');
      }
      const beforeDashboard = await t.asOwner.get('/api/dashboard');
      const beforeReport = await t.asOwner.get('/api/sales-report');
      const beforeStatement = await t.asOwner.get('/api/reports/statement');
      assert.equal(beforeDashboard.status, 200);
      assert.equal(beforeReport.status, 200);
      assert.equal(beforeStatement.status, 200);
      const sale = await t.asStaff.post('/api/sales', { items: [{ bookId: book.id, quantity: 1 }], paymentMethod: 'cash' });
      assert.equal(sale.status, 201);

      const seen = await owner.waitFor((e) => e.event === 'sale');
      assert.ok(seen, 'owner receives the sale');
      assert.equal(seen.shopId, t.shop1);
      assert.equal(typeof seen.by, 'number');
      assert.ok(await staff.waitFor((e) => e.event === 'sale'), 'staff of the same shop receives it');
      const afterDashboard = await t.asOwner.get('/api/dashboard');
      const afterReport = await t.asOwner.get('/api/sales-report');
      const afterStatement = await t.asOwner.get('/api/reports/statement');
      assert.equal(afterDashboard.body.summary.netSalesCents - beforeDashboard.body.summary.netSalesCents, sale.body.subtotalCents - sale.body.discountCents);
      assert.equal(afterReport.body.summary.netAfterAdjustments - beforeReport.body.summary.netAfterAdjustments, sale.body.subtotalCents - sale.body.discountCents);
      assert.equal(afterStatement.body.columns.at(-1).netSalesCents - beforeStatement.body.columns.at(-1).netSalesCents, sale.body.subtotalCents - sale.body.discountCents);

      // Give stray events time to arrive, then check nobody else got them.
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(staff2.events.filter((e) => e.event === 'sale').length, 0, 'other shop staff does not');
      assert.equal(other.events.filter((e) => e.event !== 'ready').length, 0, 'other business receives nothing');
    } finally {
      for (const s of [owner, staff2, other, staff]) s.close();
    }
  });

  it('business-wide changes (a title edit) reach every shop of the business, failed writes publish nothing', async () => {
    const book = await t.addBook();
    const staff2 = await t.asStaff2.stream();
    try {
      await staff2.waitFor((e) => e.event === 'ready');
      assert.equal((await t.asOwner.put(`/api/books/${book.id}`, { title: 'Renamed', priceCents: 12000 })).status, 200);
      const e = await staff2.waitFor((x) => x.event === 'books');
      assert.ok(e);
      assert.equal(e.shopId, null);

      const before = staff2.events.length;
      assert.ok((await t.asStaff.post('/api/sales', { items: [{ bookId: book.id, quantity: 999 }] })).status >= 400);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(staff2.events.length, before);
    } finally {
      staff2.close();
    }
  });

  it('a refund on a shop-2 bill is announced for shop 2 even when the owner is working in shop 1', async () => {
    const book = await t.addBook({ openingStock: 0 });
    const adj = await t.asOwner.shop(t.shop2).post(`/api/books/${book.id}/adjust`, { countedQty: 3, reason: 'count' });
    assert.equal(adj.status, 200, adj.text);
    const res = await t.asStaff2.post('/api/sales', { items: [{ bookId: book.id, quantity: 1 }], paymentMethod: 'cash' });
    assert.equal(res.status, 201, res.text);
    const sale = res.body;
    const staff2 = await t.asStaff2.stream();
    try {
      await staff2.waitFor((e) => e.event === 'ready');
      const r = await t.asOwner.shop(t.shop1).post(`/api/sales/${sale.id}/refund`, { itemId: sale.items[0].id, quantity: 1 });
      assert.equal(r.status, 200);
      const e = await staff2.waitFor((x) => x.event === 'return');
      assert.ok(e, 'shop-2 staff hears about the refund on their bill');
      assert.equal(e.shopId, t.shop2);
    } finally {
      staff2.close();
      t.asOwner.shop(null);
    }
  });
});
