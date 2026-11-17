const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { recommendations } = require('../src/services/restock');
const { dashboard } = require('../src/services/dashboard');

let t;
const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
let seq = 0;

before(async () => { t = await setup({ tz: 0 }); });
after(async () => { await t.close(); });

// Direct inserts let us backdate history deterministically; the services under test only read these tables.
async function mkBook(env, { title, stock, price = 10000, cost = 6000, createdDaysAgo = 90, threshold = null, reserved = 0, shopId = env.shop1 }) {
  seq += 1;
  const { id } = await env.db.one(`INSERT INTO books(business_id, title, author, price_cents, created_at) VALUES ($1, $2, 'Auth', $3, $4) RETURNING id`,
    [env.businessId, `${title} ${seq}`, price, ago(createdDaysAgo)]);
  await env.db.query(`INSERT INTO shop_stock(business_id, shop_id, book_id, stock_qty, reserved_qty, cost_cents, low_stock_threshold)
                      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [env.businessId, shopId, id, stock, reserved, cost, threshold]);
  return id;
}
async function ownerId(env) {
  return (await env.db.one(`SELECT id FROM users WHERE username = 'owner'`)).id;
}
async function mkSale(env, { daysAgo, lines, discount = 0, tax = 0, status = 'completed', at, shopId = env.shop1 }) {
  seq += 1;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const { id } = await env.db.one(`INSERT INTO sales(business_id, shop_id, bill_no, status, payment_method, subtotal_cents, discount_cents, tax_cents, total_cents, user_id, created_at)
    VALUES ($1, $2, $3, $4, 'cash', $5, $6, $7, $8, $9, $10) RETURNING id`,
  [env.businessId, shopId, `T-${seq}`, status, subtotal, discount, tax, subtotal - discount + tax, await ownerId(env), at || ago(daysAgo)]);
  for (const l of lines) {
    await env.db.query(`INSERT INTO sale_items(sale_id, book_id, title, quantity, unit_price_cents, unit_cost_cents, line_total_cents)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, l.bookId, l.title || 'x', l.qty, l.price, l.cost, l.qty * l.price]);
  }
  return id;
}
async function mkSupplier(env, name, leadTime = 7) {
  return (await env.db.one('INSERT INTO suppliers(business_id, name, lead_time_days) VALUES ($1, $2, $3) RETURNING id', [env.businessId, name, leadTime])).id;
}
const rec = async (opts = {}) => recommendations(await t.ctx('owner', t.shop1), { now: NOW, ...opts });

// ---------------- outlet scoping -----------------
const range = { from: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10), to: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10) };
test('sales report attributes counter sales to the selling shop and refuses foreign shops', async () => {
  const book = await t.addBook({ openingStock: 5 });
  const sale = await t.asOwner.shop(t.shop1).post('/api/sales', { items: [{ bookId: book.id, quantity: 1 }], paymentMethod: 'cash' });
  t.asOwner.shop(null);
  assert.equal(sale.status, 201);
  const report = await t.asOwner.get(`/api/sales-report?outlet=${t.shop1}&from=${range.from}&to=${range.to}`);
  assert.equal(report.status, 200);
  assert.ok(report.body.items.some((i) => i.billNo === sale.body.billNo && i.outlet === 'Main Shop'));
  assert.ok(!(await t.asOwner.get(`/api/sales-report?outlet=${t.shop2}&from=${range.from}&to=${range.to}`)).body.items.some((i) => i.billNo === sale.body.billNo));
  assert.equal((await t.asOwner.get('/api/sales-report?outlet=not-a-shop')).status, 403);
  assert.equal((await t.asOwner.get(`/api/sales-report?outlet=${t.otherShop}`)).status, 403);
  assert.equal((await t.asStaff.get('/api/sales-report')).status, 403);
});

test('dashboard filters sales, refunds, periods and charts by shop', async () => {
  const fresh = await setup({ tz: 0 });
  try {
    const book = await fresh.addBook({ openingStock: 10, priceCents: 10000 });
    // Give shop 2 stock too, through purchasing.
    const sup = (await fresh.asOwner.post('/api/suppliers', { name: 'S' })).body;
    fresh.asOwner.shop(fresh.shop2);
    const po = (await fresh.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 5, unitCostCents: 100 }] })).body;
    await fresh.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 5 }] });
    const a = await fresh.asOwner.post('/api/sales', { items: [{ bookId: book.id, quantity: 1 }], paymentMethod: 'cash' });
    fresh.asOwner.shop(null);
    const b = await fresh.asOwner.post('/api/sales', { items: [{ bookId: book.id, quantity: 1 }], paymentMethod: 'cash' });
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    fresh.asOwner.shop(fresh.shop2);
    await fresh.asOwner.post(`/api/sales/${a.body.id}/refund`, { itemId: a.body.items[0].id, quantity: 1 });
    fresh.asOwner.shop(null);

    const s2 = await fresh.asOwner.get(`/api/dashboard?outlet=${fresh.shop2}`);
    assert.equal(s2.status, 200);
    assert.equal(s2.body.summary.netSalesCents, 0);
    assert.equal(s2.body.periods.today.netSalesCents, 0);
    assert.equal(s2.body.salesSeries[0].netSalesCents, 0);
    assert.equal(s2.body.bestSellers.length, 0);
    const s1 = await fresh.asOwner.get(`/api/dashboard?outlet=${fresh.shop1}`);
    assert.equal(s1.body.summary.netSalesCents, 10000);
    assert.equal(s1.body.bestSellers[0].units, 1);
    const all = await fresh.asOwner.get('/api/dashboard');
    assert.equal(all.body.summary.netSalesCents, 10000);
    assert.deepEqual(all.body.byShop.map((x) => x.netSalesCents), [10000, 0]); // refunds follow their transaction date
    // Another business sees none of it.
    assert.equal((await fresh.asOther.get('/api/dashboard')).body.summary.netSalesCents, 0);
    assert.equal((await fresh.asOther.get(`/api/dashboard?outlet=${fresh.shop1}`)).status, 403);
  } finally { await fresh.close(); }
});

test('dashboard records a refund on its date and reverses revenue and cost', async () => {
  const fresh = await setup({ tz: 0 });
  try {
    const book = await fresh.addBook({ priceCents: 10000, openingStock: 5 });
    await fresh.db.query('UPDATE shop_stock SET cost_cents = 6000 WHERE book_id = $1', [book.id]);
    const sale = (await fresh.asOwner.post('/api/sales', { items: [{ bookId: book.id, quantity: 1 }], paymentMethod: 'cash' })).body;
    const refund = await fresh.asOwner.post(`/api/sales/${sale.id}/refund`, { itemId: sale.items[0].id, quantity: 1 });
    assert.equal(refund.status, 200);
    await fresh.db.query('UPDATE sales SET created_at = $1 WHERE id = $2', ['2026-06-14T12:00:00.000Z', sale.id]);
    await fresh.db.query('UPDATE sale_returns SET created_at = $1 WHERE sale_id = $2', ['2026-06-15T12:00:00.000Z', sale.id]);
    const report = await dashboard(await fresh.ctx('owner'), { now: NOW, from: '2026-06-15', to: '2026-06-15' });
    assert.equal(report.summary.netSalesCents, -10000);
    assert.equal(report.summary.cogsCents, -6000);
    assert.equal(report.summary.grossProfitCents, -4000);
    assert.equal(report.periods.today.netSalesCents, -10000);
    assert.equal(report.salesSeries[0].netSalesCents, -10000);
  } finally { await fresh.close(); }
});

// ---------------- restock -----------------
test('restock: fast seller close to running out is flagged with explainable numbers', async () => {
  const book = await mkBook(t, { title: 'Hot', stock: 6, threshold: 3 });
  // 30 sold over the last 30 days = 1/day. Stock 6 => 6 days of cover; lead time default 7 days.
  for (let d = 1; d <= 30; d++) await mkSale(t, { daysAgo: d, lines: [{ bookId: book, qty: 1, price: 10000, cost: 6000 }] });
  const r = (await rec()).items.find((i) => i.bookId === book);
  assert.ok(r, 'book should be recommended');
  assert.equal(r.urgency, 'high');
  assert.equal(r.metrics.unitsSold, 30);
  assert.equal(r.metrics.velocityPerDay, 1);
  assert.equal(r.metrics.daysOfCover, 6);
  assert.equal(r.metrics.leadTimeDays, 7);
  assert.equal(r.metrics.targetStock, 21 + 3); // ceil(1*21) + threshold
  assert.equal(r.suggestedQty, 24 - 6);
  assert.equal(r.confidence, 'normal');
  assert.ok(r.reasons.some((x) => /6 days of stock left/.test(x)));
});

test('restock: out of stock with recent sales is critical and ranks above everything else', async () => {
  const gone = await mkBook(t, { title: 'Gone', stock: 0, threshold: 2 });
  for (let d = 1; d <= 10; d++) await mkSale(t, { daysAgo: d * 2, lines: [{ bookId: gone, qty: 1, price: 10000, cost: 6000 }] });
  const items = (await rec()).items;
  assert.equal(items[0].bookId, gone);
  assert.equal(items[0].urgency, 'critical');
  assert.ok(items[0].caveats.some((c) => /understate/.test(c)));
});

test('restock: healthy stock is not flagged; voided sales and old sales do not count', async () => {
  const calm = await mkBook(t, { title: 'Calm', stock: 100, threshold: 3 });
  for (let d = 1; d <= 5; d++) await mkSale(t, { daysAgo: d, lines: [{ bookId: calm, qty: 1, price: 10000, cost: 6000 }] });
  const voided = await mkBook(t, { title: 'Voided hit', stock: 4, threshold: 1 });
  for (let d = 1; d <= 20; d++) await mkSale(t, { daysAgo: d, status: 'voided', lines: [{ bookId: voided, qty: 3, price: 10000, cost: 6000 }] });
  const old = await mkBook(t, { title: 'Old hit', stock: 4, threshold: 1 });
  for (let d = 1; d <= 20; d++) await mkSale(t, { daysAgo: 60 + d, lines: [{ bookId: old, qty: 3, price: 10000, cost: 6000 }] });
  const ids = (await rec()).items.map((i) => i.bookId);
  assert.ok(!ids.includes(calm));
  assert.ok(!ids.includes(voided));
  assert.ok(!ids.includes(old));
  const rv = (await rec({ lookbackDays: 90 })).items.find((i) => i.bookId === old);
  assert.ok(rv, 'a longer analysis period should pick the older sales up');
});

test('restock is per shop: sales in another shop do not drive this shop\'s velocity', async () => {
  const book = await mkBook(t, { title: 'Elsewhere', stock: 50, threshold: 1 });
  await t.db.query(`INSERT INTO shop_stock(business_id, shop_id, book_id, stock_qty) VALUES ($1, $2, $3, 1)`, [t.businessId, t.shop2, book]);
  for (let d = 1; d <= 20; d++) await mkSale(t, { daysAgo: d, shopId: t.shop2, lines: [{ bookId: book, qty: 1, price: 10000, cost: 6000 }] });
  assert.ok(!(await rec()).items.some((i) => i.bookId === book));
  const inShop2 = (await recommendations(await t.ctx('owner', t.shop2), { now: NOW })).items.find((i) => i.bookId === book);
  assert.equal(inShop2.urgency, 'high'); // 1 left at 1/day, less than the 7-day lead time
  assert.equal(inShop2.metrics.unitsSold, 20);
});

test('restock: stock already on order is counted, reserved copies are not available', async () => {
  const book = await mkBook(t, { title: 'Ordered', stock: 4, threshold: 5, reserved: 3 }); // available 1
  const sup = await mkSupplier(t, 'RS Supplier');
  const { id: po } = await t.db.one(`INSERT INTO purchase_orders(business_id, shop_id, po_no, supplier_id, created_by) VALUES ($1, $2, 'PO-RS', $3, $4) RETURNING id`,
    [t.businessId, t.shop1, sup, await ownerId(t)]);
  await t.db.query('INSERT INTO purchase_order_items(po_id, book_id, qty_ordered, qty_received, unit_cost_cents) VALUES ($1, $2, 20, 5, 100)', [po, book]);
  // 15 still outstanding => available 1 + 15 = 16 > threshold 5, so the low-stock rule is satisfied by the incoming order
  assert.ok(!(await rec()).items.some((i) => i.bookId === book));
  await t.db.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1`, [po]);
  const afterCancel = (await rec()).items.find((i) => i.bookId === book);
  assert.equal(afterCancel.metrics.availableQty, 1);
  assert.equal(afterCancel.metrics.onOrderQty, 0);
});

test('restock: a brand-new title with one sale is flagged low-confidence, not extrapolated from the full window', async () => {
  const fresh = await mkBook(t, { title: 'Fresh', stock: 1, threshold: 2, createdDaysAgo: 2 });
  await mkSale(t, { daysAgo: 1, lines: [{ bookId: fresh, qty: 2, price: 10000, cost: 6000 }] });
  const r = (await rec()).items.find((i) => i.bookId === fresh);
  assert.equal(r.confidence, 'low');
  assert.ok(r.metrics.observedDays <= 2);
  assert.ok(r.caveats.some((c) => /history/.test(c)));
});

test('restock: no sales history at all produces a note and only threshold rules', async () => {
  const fresh = await setup();
  try {
    await mkBook(fresh, { title: 'Lonely', stock: 1, price: 100 });
    const r = await recommendations(await fresh.ctx('owner'), { now: NOW });
    assert.match(r.dataNotes[0], /No sales/);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].metrics.velocityPerDay, 0);
    assert.equal(r.items[0].urgency, 'medium');
  } finally { await fresh.close(); }
});

test('restock: cheapest supplier and estimated cost are attached; endpoint is manager/owner-only', async () => {
  const book = await mkBook(t, { title: 'Supplied', stock: 0, threshold: 1 });
  await mkSale(t, { daysAgo: 3, lines: [{ bookId: book, qty: 3, price: 10000, cost: 6000 }] });
  const s1 = await mkSupplier(t, 'Pricey', 2);
  const s2 = await mkSupplier(t, 'Thrifty', 6);
  await t.db.query('INSERT INTO supplier_books(business_id, supplier_id, book_id, unit_cost_cents) VALUES ($1, $2, $4, 8000), ($1, $3, $4, 5000)', [t.businessId, s1, s2, book]);
  const r = (await rec()).items.find((i) => i.bookId === book);
  assert.equal(r.suppliers[0].name, 'Thrifty');
  assert.equal(r.estimatedCostCents, r.suggestedQty * 5000);
  assert.equal(r.metrics.leadTimeDays, 2); // shortest lead time among suppliers
  assert.equal((await t.asStaff.get('/api/restock')).status, 403);
  assert.equal((await t.asManager.get('/api/restock')).status, 200);
  assert.equal((await t.asOwner.get('/api/restock')).status, 200);
});

// ---------------- dashboard -----------------
test('dashboard: revenue, COGS, profit, tax and discount are computed from persisted bills and kept distinct', async () => {
  const fresh = await setup({ tz: 0 });
  try {
    const b1 = await mkBook(fresh, { title: 'B1', stock: 50, price: 10000, cost: 6000 });
    const b2 = await mkBook(fresh, { title: 'B2', stock: 50, price: 5000, cost: 0 });
    const t1 = (await fresh.db.one('SELECT title FROM books WHERE id = $1', [b1])).title;
    const t2 = (await fresh.db.one('SELECT title FROM books WHERE id = $1', [b2])).title;
    const addSale = (at, lines, discount, tax, status = 'completed') => mkSale(fresh, {
      at, discount, tax, status, lines: lines.map((l) => ({ bookId: l.b, title: l.b === b1 ? t1 : t2, qty: l.q, price: l.p, cost: l.c })),
    });
    // 2026-06-15 (today): 2x B1 (20000) with 10% discount (2000) and 5% tax on 18000 (900)
    await addSale('2026-06-15T09:00:00.000Z', [{ b: b1, q: 2, p: 10000, c: 6000 }], 2000, 900);
    // 2026-06-10: 1x B1 + 4x B2 (unknown cost) = 10000 + 20000
    await addSale('2026-06-10T09:00:00.000Z', [{ b: b1, q: 1, p: 10000, c: 6000 }, { b: b2, q: 4, p: 5000, c: 0 }], 0, 0);
    // voided bill and an out-of-range bill must not count
    await addSale('2026-06-12T09:00:00.000Z', [{ b: b1, q: 9, p: 10000, c: 6000 }], 0, 0, 'voided');
    await addSale('2026-05-01T09:00:00.000Z', [{ b: b1, q: 9, p: 10000, c: 6000 }], 0, 0);
    const sup = await mkSupplier(fresh, 'S');
    const uid = await ownerId(fresh);
    const { id: po } = await fresh.db.one(`INSERT INTO purchase_orders(business_id, shop_id, po_no, supplier_id, created_by) VALUES ($1, $2, 'P1', $3, $4) RETURNING id`,
      [fresh.businessId, fresh.shop1, sup, uid]);
    await fresh.db.query(`INSERT INTO goods_receipts(business_id, shop_id, po_id, supplier_id, total_cents, user_id, received_at) VALUES
      ($1, $2, $3, $4, 50000, $5, '2026-06-11T10:00:00.000Z'), ($1, $2, $3, $4, 99999, $5, '2026-04-11T10:00:00.000Z')`, [fresh.businessId, fresh.shop1, po, sup, uid]);
    await fresh.db.query(`INSERT INTO expenses(business_id, shop_id, expense_date, category, amount_cents, user_id) VALUES
      ($1, $2, '2026-06-01', 'Rent', 7000, $3), ($1, $2, '2026-06-14', 'Wages', 3000, $3), ($1, $2, '2026-03-01', 'Rent', 7000, $3)`, [fresh.businessId, fresh.shop1, uid]);

    const ctx = await fresh.ctx('owner');
    const d = await dashboard(ctx, { from: '2026-06-01', to: '2026-06-15', now: NOW });
    const s = d.summary;
    assert.equal(s.bills, 2);
    assert.equal(s.netSalesCents, 18000 + 30000);         // subtotal - discount, excludes tax
    assert.equal(s.taxCents, 900);
    assert.equal(s.discountCents, 2000);
    assert.equal(s.grossBilledCents, 18900 + 30000);
    assert.equal(s.cogsCents, 2 * 6000 + 1 * 6000 + 0);   // unknown-cost lines contribute 0
    assert.equal(s.grossProfitCents, 48000 - 18000);
    assert.equal(s.unknownCostUnits, 4);                  // flagged so profit isn't silently overstated
    assert.equal(s.unknownCostRevenueCents, 20000);
    assert.equal(s.purchaseSpendCents, 50000);            // only the in-range receipt
    assert.equal(s.operatingExpensesCents, 10000);
    assert.equal(s.operatingProfitCents, 30000 - 10000);  // purchases are not deducted again
    assert.equal(s.netCashMovementCents, 48000 + 900 - 50000 - 10000);
    assert.deepEqual(d.periods.today, { from: '2026-06-15', to: '2026-06-15', bills: 1, netSalesCents: 18000 });
    assert.equal(d.periods.week.netSalesCents, 18000);    // week starts Monday 2026-06-15
    assert.equal(d.periods.month.netSalesCents, 48000);
    assert.deepEqual(d.bestSellers.map((x) => [x.title, x.units]), [[t2, 4], [t1, 3]]);
    assert.equal(d.spendBySupplier[0].spendCents, 50000);
    assert.deepEqual(d.expensesByCategory.map((x) => x.category), ['Rent', 'Wages']);
    assert.deepEqual(d.salesSeries.map((x) => [x.bucket, x.netSalesCents]), [['2026-06-10', 30000], ['2026-06-15', 18000]]);

    const weekly = await dashboard(ctx, { from: '2026-06-01', to: '2026-06-15', group: 'week', now: NOW });
    assert.deepEqual(weekly.salesSeries.map((x) => [x.bucket, x.netSalesCents]), [['2026-06-08', 30000], ['2026-06-15', 18000]]);
    const monthly = await dashboard(ctx, { from: '2026-05-01', to: '2026-06-15', group: 'month', now: NOW });
    assert.deepEqual(monthly.salesSeries.map((x) => [x.bucket, x.netSalesCents]), [['2026-05', 90000], ['2026-06', 48000]]);

    // The HTTP endpoint is manager/owner-only and returns the same numbers.
    assert.equal((await fresh.asStaff.get('/api/dashboard')).status, 403);
    const http = await fresh.asOwner.get('/api/dashboard?from=2026-01-01&to=2026-12-31');
    assert.equal(http.status, 200);
    assert.ok(http.body.summary.netSalesCents > 0);
  } finally { await fresh.close(); }
});

test('dashboard: local-day bucketing honours the shop timezone offset', async () => {
  const fresh = await setup({ tz: 330 }); // IST
  try {
    const b = await mkBook(fresh, { title: 'Z', stock: 5, price: 100 });
    // 2026-06-14T20:00Z is 2026-06-15 01:30 in IST: belongs to the 15th locally.
    await mkSale(fresh, { at: '2026-06-14T20:00:00.000Z', lines: [{ bookId: b, qty: 1, price: 100, cost: 0 }] });
    const ctx = await fresh.ctx('owner');
    const on15 = await dashboard(ctx, { from: '2026-06-15', to: '2026-06-15', now: NOW });
    const on14 = await dashboard(ctx, { from: '2026-06-14', to: '2026-06-14', now: NOW });
    assert.equal(on15.summary.bills, 1);
    assert.equal(on14.summary.bills, 0);
    assert.equal(on15.salesSeries[0].bucket, '2026-06-15');
  } finally { await fresh.close(); }
});

test('dashboard reflects the same records created through billing, receipts and expenses (integration)', async () => {
  const fresh = await setup({ tz: 0 });
  try {
    const { asOwner, asStaff } = fresh;
    const book = await fresh.addBook({ title: 'Integrated', priceCents: 10000, openingStock: 0 });
    const sup = (await asOwner.post('/api/suppliers', { name: 'Int Supplier' })).body;
    const po = (await asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 10, unitCostCents: 6000 }] })).body;
    await asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 10 }] });
    await asStaff.post('/api/sales', { items: [{ bookId: book.id, quantity: 3 }], paymentMethod: 'cash' });
    await asOwner.post('/api/expenses', { date: new Date().toISOString().slice(0, 10), category: 'Rent', amountCents: 5000 });
    const d = (await asOwner.get('/api/dashboard')).body;
    assert.equal(d.summary.netSalesCents, 30000);
    assert.equal(d.summary.cogsCents, 18000);
    assert.equal(d.summary.grossProfitCents, 12000);
    assert.equal(d.summary.purchaseSpendCents, 60000);
    assert.equal(d.summary.operatingExpensesCents, 5000);
    assert.equal(d.bestSellers[0].units, 3);
    assert.equal(d.inventory.units, 7);
    assert.equal(d.inventory.valueAtCostCents, 7 * 6000);
  } finally { await fresh.close(); }
});

test('dashboard validates its date inputs', async () => {
  assert.equal((await t.asOwner.get('/api/dashboard?from=2026-06-10&to=2026-06-01')).status, 400);
  assert.equal((await t.asOwner.get('/api/dashboard?from=garbage')).status, 400);
  assert.equal((await t.asOwner.get('/api/dashboard?group=year')).status, 400);
});
