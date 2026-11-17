const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { createDb } = require('../src/db');
const { setup } = require('./helpers');
const sales = require('../src/services/sales');
const { computeTotals } = require('../src/lib/money');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const sell = (client, items, extra = {}) => client.post('/api/sales', { items, paymentMethod: 'cash', ...extra });
const count = async (table) => (await t.db.one(`SELECT COUNT(*) AS c FROM ${table}`)).c;

test('computeTotals: discount then tax, every amount rounded to the nearest rupee (no paise)', () => {
  // Prices with paise are treated as the nearest rupee: 99.99 -> 100, 25.50 -> 26.
  const r = computeTotals([{ unitPriceCents: 9999, quantity: 3 }, { unitPriceCents: 2550, quantity: 1 }], 1250, 500);
  assert.equal(r.subtotalCents, 32600);   // 3 x 100 + 26
  assert.equal(r.discountCents, 4100);    // 326 x 12.5% = 40.75 -> 41
  assert.equal(r.taxCents, 1400);         // (326 - 41) x 5% = 14.25 -> 14
  assert.equal(r.totalCents, 32600 - 4100 + 1400);
  for (const k of ['subtotalCents', 'discountCents', 'taxCents', 'totalCents']) assert.equal(r[k] % 100, 0, k);
});

test('a sale persists the bill, snapshots price/cost, and deducts stock', async () => {
  const a = await t.addBook({ title: 'Alpha', priceCents: 25000, openingStock: 10 });
  const b = await t.addBook({ title: 'Beta', priceCents: 12050, openingStock: 5 }); // 120.50 is saved as 121
  assert.equal(b.priceCents, 12100);
  const res = await sell(t.asStaff, [{ bookId: a.id, quantity: 2 }, { bookId: b.id, quantity: 1 }], { customerName: 'Walk-in' });
  assert.equal(res.status, 201);
  assert.equal(res.body.subtotalCents, 62100);
  assert.equal(res.body.totalCents, 62100);
  assert.match(res.body.billNo, /^INV-S01-\d{6}$/);
  assert.equal((await t.stock(a.id)).s, 8);
  assert.equal((await t.stock(b.id)).s, 4);

  // Later price changes must not alter the historical bill.
  await t.asOwner.put(`/api/books/${a.id}`, { title: 'Alpha', author: 'Some Author', priceCents: 99999 });
  const bill = await t.asStaff.get(`/api/sales/${res.body.id}`);
  assert.equal(bill.body.items.find((i) => i.title === 'Alpha').unitPriceCents, 25000);
  assert.equal(bill.body.items.length, 2);
  const moves = await t.asOwner.get(`/api/books/${a.id}/movements`);
  assert.equal(moves.body[0].reason, 'sale');
  assert.equal(moves.body[0].delta, -2);
});

test('the server computes prices itself and ignores client-supplied ones', async () => {
  const a = await t.addBook({ priceCents: 5000 });
  const res = await sell(t.asStaff, [{ bookId: a.id, quantity: 1, unitPriceCents: 1 }]);
  assert.equal(res.body.totalCents, 5000);
});

test('tax comes from settings and is stored on the bill', async () => {
  await t.asOwner.put('/api/settings', { taxPercent: 5 });
  const a = await t.addBook({ priceCents: 20000 });
  const res = await sell(t.asStaff, [{ bookId: a.id, quantity: 1 }], { discountPercent: 10 });
  await t.asOwner.put('/api/settings', { taxPercent: 0 });
  assert.equal(res.body.discountCents, 2000);
  assert.equal(res.body.taxCents, 900); // 5% of 18000
  assert.equal(res.body.totalCents, 18900);
  assert.equal(res.body.taxPercent, 5);
});

test('discount ceilings: staff 10%, manager 25%, owner unrestricted', async () => {
  const a = await t.addBook({ priceCents: 10000 });
  assert.equal((await sell(t.asStaff, [{ bookId: a.id, quantity: 1 }], { discountPercent: 15 })).status, 403);
  assert.equal((await sell(t.asManager, [{ bookId: a.id, quantity: 1 }], { discountPercent: 15 })).status, 201);
  assert.equal((await sell(t.asManager, [{ bookId: a.id, quantity: 1 }], { discountPercent: 30 })).status, 403);
  const owner = await sell(t.asOwner, [{ bookId: a.id, quantity: 1 }], { discountPercent: 30 });
  assert.equal(owner.status, 201);
  assert.equal(owner.body.totalCents, 7000);
  assert.equal((await sell(t.asOwner, [{ bookId: a.id, quantity: 1 }], { discountPercent: 101 })).status, 400);
});

test('insufficient stock fails the whole sale and leaves no partial records', async () => {
  const ok = await t.addBook({ openingStock: 5 });
  const scarce = await t.addBook({ openingStock: 1 });
  const before = await count('sales');
  const res = await sell(t.asStaff, [{ bookId: ok.id, quantity: 2 }, { bookId: scarce.id, quantity: 2 }]);
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /Insufficient stock/);
  assert.equal(await count('sales'), before);
  assert.equal((await t.stock(ok.id)).s, 5); // first line was not deducted
  assert.equal((await t.stock(scarce.id)).s, 1);
});

test('mid-transaction failure rolls back everything (stock + bill)', async () => {
  const good = await t.addBook({ title: 'Good', openingStock: 5 });
  const bad = await t.addBook({ title: 'Bad', openingStock: 5 });
  // Force the second stock deduction to fail at the database level.
  await t.db.query(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'disk on fire'; END $$`);
  await t.db.query(`CREATE TRIGGER boom BEFORE UPDATE OF stock_qty ON shop_stock FOR EACH ROW WHEN (NEW.book_id = ${bad.id}) EXECUTE FUNCTION boom()`);
  const before = { sales: await count('sales'), items: await count('sale_items'), moves: await count('stock_movements') };
  try {
    await assert.rejects(sales.createSale(await t.ctx('owner', t.shop1), {
      items: [{ bookId: good.id, quantity: 1 }, { bookId: bad.id, quantity: 1 }], paymentMethod: 'cash',
    }), /disk on fire/);
  } finally {
    await t.db.query('DROP TRIGGER boom ON shop_stock; DROP FUNCTION boom()');
  }
  assert.equal((await t.stock(good.id)).s, 5);
  assert.equal(await count('sales'), before.sales);
  assert.equal(await count('sale_items'), before.items);
  assert.equal(await count('stock_movements'), before.moves);
});

test('duplicate submission with the same idempotency key creates one bill and deducts once', async () => {
  const a = await t.addBook({ openingStock: 5 });
  const key = 'abc-123-unique';
  const first = await sell(t.asStaff, [{ bookId: a.id, quantity: 2 }], { idempotencyKey: key });
  const second = await sell(t.asStaff, [{ bookId: a.id, quantity: 2 }], { idempotencyKey: key });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.id, first.body.id);
  assert.equal((await t.stock(a.id)).s, 3);
});

test('the same idempotency key sent concurrently still yields one bill', async () => {
  const a = await t.addBook({ openingStock: 10 });
  const results = await Promise.all(Array.from({ length: 5 }, () => sell(t.asStaff, [{ bookId: a.id, quantity: 1 }], { idempotencyKey: 'race-key' })));
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal((await t.stock(a.id)).s, 9);
});

test('repeated lines for one book are merged and checked together', async () => {
  const a = await t.addBook({ openingStock: 3 });
  const over = await sell(t.asStaff, [{ bookId: a.id, quantity: 2 }, { bookId: a.id, quantity: 2 }]);
  assert.equal(over.status, 409);
  const fine = await sell(t.asStaff, [{ bookId: a.id, quantity: 1 }, { bookId: a.id, quantity: 2 }]);
  assert.equal(fine.status, 201);
  assert.equal(fine.body.items.length, 1);
  assert.equal(fine.body.items[0].quantity, 3);
});

test('concurrent sales of the last copies: never oversold, stock never goes negative', async () => {
  const a = await t.addBook({ openingStock: 5 });
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => sell(i % 2 ? t.asStaff : t.asOwner, [{ bookId: a.id, quantity: 1 }])));
  assert.equal(results.filter((r) => r.status === 201).length, 5);
  assert.equal(results.filter((r) => r.status === 409).length, 5);
  assert.equal((await t.stock(a.id)).s, 0);
  // Bill numbers stay unique under concurrency.
  const nos = results.filter((r) => r.status === 201).map((r) => r.body.billNo);
  assert.equal(new Set(nos).size, 5);
});

test('two separate connection pools cannot oversell (cross-process safety)', async () => {
  const a = await t.addBook({ openingStock: 1 });
  const other = createDb({ connectionString: config.testDatabaseUrl, schema: t.schema, max: 2 });
  try {
    const c1 = await t.ctx('owner', t.shop1);
    const c2 = { ...c1, db: other };
    const req = { items: [{ bookId: a.id, quantity: 1 }], paymentMethod: 'cash' };
    const r = await Promise.allSettled([sales.createSale(c1, req), sales.createSale(c2, req)]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.match(r.find((x) => x.status === 'rejected').reason.message, /Insufficient stock/);
  } finally {
    await other.close();
  }
  assert.equal((await t.stock(a.id)).s, 0);
  // DB-level guard: the stock CHECK constraint, or the shelf-placement trigger that runs before it.
  await assert.rejects(t.db.query('UPDATE shop_stock SET stock_qty = -1 WHERE book_id = $1', [a.id]), /check constraint|cannot be lower than placed copies/);
});

test('bills can be retrieved by id, listed, and searched by bill number and title', async () => {
  const a = await t.addBook({ title: 'Searchable Receipt Title' });
  const made = await sell(t.asStaff, [{ bookId: a.id, quantity: 1 }], { customerName: 'Zed Zebra' });
  const byNo = await t.asStaff.get(`/api/sales?q=${made.body.billNo}`);
  assert.equal(byNo.body.items[0].id, made.body.id);
  assert.equal((await t.asStaff.get('/api/sales?q=receipt%20title')).body.total, 1);
  assert.equal((await t.asStaff.get('/api/sales?q=zed')).body.total, 1);
  const full = await t.asStaff.get(`/api/sales/${made.body.id}`);
  assert.equal(full.body.cashier, 'Sam Staff');
  assert.equal(full.body.shopName, 'Main Shop');
  assert.ok(!('unitCostCents' in full.body.items[0])); // staff never see cost
  assert.ok('unitCostCents' in (await t.asOwner.get(`/api/sales/${made.body.id}`)).body.items[0]);
  assert.ok('unitCostCents' in (await t.asManager.get(`/api/sales/${made.body.id}`)).body.items[0]);
});

test('voiding is owner-only, restores stock once, and is blocked a second time', async () => {
  const a = await t.addBook({ openingStock: 4 });
  const made = await sell(t.asStaff, [{ bookId: a.id, quantity: 3 }]);
  assert.equal((await t.asStaff.post(`/api/sales/${made.body.id}/void`, { reason: 'oops' })).status, 403);
  assert.equal((await t.asManager.post(`/api/sales/${made.body.id}/void`, { reason: 'oops' })).status, 403);
  assert.equal((await t.asOwner.post(`/api/sales/${made.body.id}/void`, {})).status, 400); // reason required
  const v = await t.asOwner.post(`/api/sales/${made.body.id}/void`, { reason: 'Customer returned' });
  assert.equal(v.status, 200);
  assert.equal(v.body.status, 'voided');
  assert.equal((await t.stock(a.id)).s, 4);
  assert.equal((await t.asOwner.post(`/api/sales/${made.body.id}/void`, { reason: 'again' })).status, 409);
  assert.equal((await t.stock(a.id)).s, 4);
});

test('unknown book, zero quantity and empty cart are rejected', async () => {
  assert.equal((await sell(t.asStaff, [{ bookId: 999999, quantity: 1 }])).status, 404);
  const a = await t.addBook();
  assert.equal((await sell(t.asStaff, [{ bookId: a.id, quantity: 0 }])).status, 400);
  assert.equal((await sell(t.asStaff, [])).status, 400);
});

test('managers can correct stock after a count; reason required; cannot go below reserved', async () => {
  const a = await t.addBook({ openingStock: 10 });
  assert.equal((await t.asStaff.post(`/api/books/${a.id}/adjust`, { countedQty: 8, reason: 'x' })).status, 403);
  assert.equal((await t.asManager.post(`/api/books/${a.id}/adjust`, { countedQty: 8 })).status, 400);
  const r = await t.asManager.post(`/api/books/${a.id}/adjust`, { countedQty: 8, reason: 'Two copies damaged' });
  assert.equal(r.status, 200);
  assert.equal((await t.stock(a.id)).s, 8);
  const m = (await t.asOwner.get(`/api/books/${a.id}/movements`)).body[0];
  assert.deepEqual([m.reason, m.delta, m.note], ['adjustment', -2, 'Two copies damaged']);
  // Reserve 5 via a phone order, then try to count below the reservation.
  await t.asStaff.post('/api/orders', { customerName: 'C', customerPhone: '9999999999', deliveryType: 'pickup', items: [{ bookId: a.id, quantity: 5 }] });
  assert.equal((await t.asOwner.post(`/api/books/${a.id}/adjust`, { countedQty: 3, reason: 'recount' })).status, 409);
});

test('cash memo endpoints: standalone HTML and Puppeteer PDF render successfully', async (ctx) => {
  const a = await t.addBook({ title: 'Design Patterns', priceCents: 45000 });
  const res = await sell(t.asStaff, [{ bookId: a.id, quantity: 1 }], { customerName: 'Ramesh Sharma', paymentMethod: 'upi' });
  const htmlRes = await t.asStaff.get(`/api/sales/${res.body.id}/html`);
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.text, /Ramesh Sharma/);
  assert.match(htmlRes.text, /UPI PAID/);
  assert.match(htmlRes.text, /TOTAL/);

  const pdfRes = await t.asStaff.get(`/api/sales/${res.body.id}/pdf`);
  if (pdfRes.status === 500) return ctx.skip('no Chrome/Edge available for PDF rendering on this machine');
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers['content-type'], 'application/pdf');
  assert.match(pdfRes.headers['content-disposition'], /inline; filename="bill-INV-S01-\d+\.pdf"/);
  assert.ok(pdfRes.text.length > 1000);
});
