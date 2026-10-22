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
function mkBook({ title, stock, price = 10000, cost = 6000, createdDaysAgo = 90, threshold = null, reserved = 0 }) {
  seq += 1;
  return Number(t.db.prepare(`INSERT INTO books(title, author, price_cents, cost_cents, stock_qty, reserved_qty, low_stock_threshold, created_at)
    VALUES (?, 'Auth', ?, ?, ?, ?, ?, ?)`).run(`${title} ${seq}`, price, cost, stock, reserved, threshold, ago(createdDaysAgo)).lastInsertRowid);
}
function mkSale({ daysAgo, lines, discount = 0, tax = 0, status = 'completed', at }) {
  seq += 1;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const total = subtotal - discount + tax;
  const id = Number(t.db.prepare(`INSERT INTO sales(bill_no, status, payment_method, subtotal_cents, discount_cents, tax_cents, total_cents, user_id, created_at)
    VALUES (?, ?, 'cash', ?, ?, ?, ?, 1, ?)`).run(`T-${seq}`, status, subtotal, discount, tax, total, at || ago(daysAgo)).lastInsertRowid);
  for (const l of lines) {
    t.db.prepare(`INSERT INTO sale_items(sale_id, book_id, title, quantity, unit_price_cents, unit_cost_cents, line_total_cents) VALUES (?, ?, 'x', ?, ?, ?, ?)`)
      .run(id, l.bookId, l.qty, l.price, l.cost, l.qty * l.price);
  }
  return id;
}

test('restock: fast seller close to running out is flagged with explainable numbers', () => {
  const book = mkBook({ title: 'Hot', stock: 6, threshold: 3 });
  // 30 sold over the last 30 days = 1/day. Stock 6 => 6 days of cover; lead time default 7 days.
  for (let d = 1; d <= 30; d++) mkSale({ daysAgo: d, lines: [{ bookId: book, qty: 1, price: 10000, cost: 6000 }] });
  const r = recommendations(t.db, { now: NOW }).items.find((i) => i.bookId === book);
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

test('restock: out of stock with recent sales is critical and ranks above everything else', () => {
  const gone = mkBook({ title: 'Gone', stock: 0, threshold: 2 });
  for (let d = 1; d <= 10; d++) mkSale({ daysAgo: d * 2, lines: [{ bookId: gone, qty: 1, price: 10000, cost: 6000 }] });
  const items = recommendations(t.db, { now: NOW }).items;
  assert.equal(items[0].bookId, gone);
  assert.equal(items[0].urgency, 'critical');
  assert.ok(items[0].caveats.some((c) => /understate/.test(c)));
});

test('restock: healthy stock is not flagged; voided sales and old sales do not count', () => {
  const calm = mkBook({ title: 'Calm', stock: 100, threshold: 3 });
  for (let d = 1; d <= 5; d++) mkSale({ daysAgo: d, lines: [{ bookId: calm, qty: 1, price: 10000, cost: 6000 }] });
  const voided = mkBook({ title: 'Voided hit', stock: 4, threshold: 1 });
  for (let d = 1; d <= 20; d++) mkSale({ daysAgo: d, status: 'voided', lines: [{ bookId: voided, qty: 3, price: 10000, cost: 6000 }] });
  const old = mkBook({ title: 'Old hit', stock: 4, threshold: 1 });
  for (let d = 1; d <= 20; d++) mkSale({ daysAgo: 60 + d, lines: [{ bookId: old, qty: 3, price: 10000, cost: 6000 }] });
  const ids = recommendations(t.db, { now: NOW }).items.map((i) => i.bookId);
  assert.ok(!ids.includes(calm));
  assert.ok(!ids.includes(voided));
  assert.ok(!ids.includes(old));
  const rv = recommendations(t.db, { now: NOW, lookbackDays: 90 }).items.find((i) => i.bookId === old);
  assert.ok(rv, 'a longer analysis period should pick the older sales up');
});

test('restock: stock already on order is counted, reserved copies are not available', () => {
  const book = mkBook({ title: 'Ordered', stock: 4, threshold: 5, reserved: 3 }); // available 1
  const sup = Number(t.db.prepare("INSERT INTO suppliers(name) VALUES ('RS Supplier')").run().lastInsertRowid);
  const po = Number(t.db.prepare("INSERT INTO purchase_orders(po_no, supplier_id, created_by) VALUES ('PO-RS', ?, 1)").run(sup).lastInsertRowid);
  t.db.prepare('INSERT INTO purchase_order_items(po_id, book_id, qty_ordered, qty_received, unit_cost_cents) VALUES (?, ?, 20, 5, 100)').run(po, book);
  const item = recommendations(t.db, { now: NOW }).items;
  // 15 still outstanding => available 1 + 15 = 16 > threshold 5, so the low-stock rule is satisfied by the incoming order
  assert.ok(!item.some((i) => i.bookId === book));
  t.db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(po);
  const after = recommendations(t.db, { now: NOW }).items.find((i) => i.bookId === book);
  assert.equal(after.metrics.availableQty, 1);
  assert.equal(after.metrics.onOrderQty, 0);
});

test('restock: a brand-new title with one sale is flagged low-confidence, not extrapolated from the full window', () => {
  const fresh = mkBook({ title: 'Fresh', stock: 1, threshold: 2, createdDaysAgo: 2 });
  mkSale({ daysAgo: 1, lines: [{ bookId: fresh, qty: 2, price: 10000, cost: 6000 }] });
  const r = recommendations(t.db, { now: NOW }).items.find((i) => i.bookId === fresh);
  assert.equal(r.confidence, 'low');
  assert.ok(r.metrics.observedDays <= 2);
  assert.ok(r.caveats.some((c) => /history/.test(c)));
});

test('restock: no sales history at all produces a note and only threshold rules', async () => {
  const fresh = await setup();
  try {
    fresh.db.prepare("INSERT INTO books(title, author, price_cents, stock_qty) VALUES ('Lonely', 'A', 100, 1)").run();
    const r = recommendations(fresh.db, { now: NOW });
    assert.match(r.dataNotes[0], /No sales/);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].metrics.velocityPerDay, 0);
    assert.equal(r.items[0].urgency, 'medium');
  } finally { await fresh.close(); }
});

test('restock: cheapest supplier and estimated cost are attached; endpoint is owner-only', async () => {
  const book = mkBook({ title: 'Supplied', stock: 0, threshold: 1 });
  mkSale({ daysAgo: 3, lines: [{ bookId: book, qty: 3, price: 10000, cost: 6000 }] });
  const s1 = Number(t.db.prepare("INSERT INTO suppliers(name, lead_time_days) VALUES ('Pricey', 2)").run().lastInsertRowid);
  const s2 = Number(t.db.prepare("INSERT INTO suppliers(name, lead_time_days) VALUES ('Thrifty', 6)").run().lastInsertRowid);
  t.db.prepare('INSERT INTO supplier_books(supplier_id, book_id, unit_cost_cents) VALUES (?, ?, 8000), (?, ?, 5000)').run(s1, book, s2, book);
  const r = recommendations(t.db, { now: NOW }).items.find((i) => i.bookId === book);
  assert.equal(r.suppliers[0].name, 'Thrifty');
  assert.equal(r.estimatedCostCents, r.suggestedQty * 5000);
  assert.equal(r.metrics.leadTimeDays, 2); // shortest lead time among suppliers
  assert.equal((await t.asStaff.get('/api/restock')).status, 403);
  assert.equal((await t.asOwner.get('/api/restock')).status, 200);
});

// ---------------- dashboard -----------------
test('dashboard: revenue, COGS, profit, tax and discount are computed from persisted bills and kept distinct', async () => {
  const fresh = await setup({ tz: 0 });
  try {
    const db = fresh.db;
    const b1 = Number(db.prepare("INSERT INTO books(title, author, price_cents, cost_cents, stock_qty) VALUES ('B1', 'A', 10000, 6000, 50)").run().lastInsertRowid);
    const b2 = Number(db.prepare("INSERT INTO books(title, author, price_cents, cost_cents, stock_qty) VALUES ('B2', 'A', 5000, 0, 50)").run().lastInsertRowid);
    const addSale = (at, lines, discount, tax, status = 'completed') => {
      const subtotal = lines.reduce((s, l) => s + l.q * l.p, 0);
      const id = Number(db.prepare(`INSERT INTO sales(bill_no, status, payment_method, subtotal_cents, discount_cents, tax_cents, total_cents, user_id, created_at)
        VALUES (?, ?, 'cash', ?, ?, ?, ?, 1, ?)`).run(`D-${at}-${Math.random()}`, status, subtotal, discount, tax, subtotal - discount + tax, at).lastInsertRowid);
      for (const l of lines) db.prepare(`INSERT INTO sale_items(sale_id, book_id, title, quantity, unit_price_cents, unit_cost_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, l.b, l.b === b1 ? 'B1' : 'B2', l.q, l.p, l.c, l.q * l.p);
    };
    // 2026-06-15 (today): 2x B1 (20000) with 10% discount (2000) and 5% tax on 18000 (900)
    addSale('2026-06-15T09:00:00.000Z', [{ b: b1, q: 2, p: 10000, c: 6000 }], 2000, 900);
    // 2026-06-10: 1x B1 + 4x B2 (unknown cost) = 10000 + 20000
    addSale('2026-06-10T09:00:00.000Z', [{ b: b1, q: 1, p: 10000, c: 6000 }, { b: b2, q: 4, p: 5000, c: 0 }], 0, 0);
    // voided bill and an out-of-range bill must not count
    addSale('2026-06-12T09:00:00.000Z', [{ b: b1, q: 9, p: 10000, c: 6000 }], 0, 0, 'voided');
    addSale('2026-05-01T09:00:00.000Z', [{ b: b1, q: 9, p: 10000, c: 6000 }], 0, 0);
    const sup = Number(db.prepare("INSERT INTO suppliers(name) VALUES ('S')").run().lastInsertRowid);
    const po = Number(db.prepare("INSERT INTO purchase_orders(po_no, supplier_id, created_by) VALUES ('P1', ?, 1)").run(sup).lastInsertRowid);
    db.prepare("INSERT INTO goods_receipts(po_id, supplier_id, total_cents, user_id, received_at) VALUES (?, ?, 50000, 1, '2026-06-11T10:00:00.000Z')").run(po, sup);
    db.prepare("INSERT INTO goods_receipts(po_id, supplier_id, total_cents, user_id, received_at) VALUES (?, ?, 99999, 1, '2026-04-11T10:00:00.000Z')").run(po, sup);
    db.prepare("INSERT INTO expenses(expense_date, category, amount_cents, user_id) VALUES ('2026-06-01', 'Rent', 7000, 1), ('2026-06-14', 'Wages', 3000, 1), ('2026-03-01', 'Rent', 7000, 1)").run();

    const d = dashboard(db, 0, { from: '2026-06-01', to: '2026-06-15', now: NOW });
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
    assert.deepEqual(d.bestSellers.map((x) => [x.title, x.units]), [['B2', 4], ['B1', 3]]);
    assert.equal(d.spendBySupplier[0].spendCents, 50000);
    assert.deepEqual(d.expensesByCategory.map((x) => x.category), ['Rent', 'Wages']);
    assert.deepEqual(d.salesSeries.map((x) => [x.bucket, x.netSalesCents]), [['2026-06-10', 30000], ['2026-06-15', 18000]]);

    const weekly = dashboard(db, 0, { from: '2026-06-01', to: '2026-06-15', group: 'week', now: NOW });
    assert.deepEqual(weekly.salesSeries.map((x) => [x.bucket, x.netSalesCents]), [['2026-06-08', 30000], ['2026-06-15', 18000]]);
    const monthly = dashboard(db, 0, { from: '2026-05-01', to: '2026-06-15', group: 'month', now: NOW });
    assert.deepEqual(monthly.salesSeries.map((x) => [x.bucket, x.netSalesCents]), [['2026-05', 90000], ['2026-06', 48000]]);

    // The HTTP endpoint is owner-only and returns the same numbers.
    assert.equal((await fresh.asStaff.get('/api/dashboard')).status, 403);
    const http = await fresh.asOwner.get('/api/dashboard?from=2026-01-01&to=2026-12-31');
    assert.equal(http.status, 200);
    assert.ok(http.body.summary.netSalesCents > 0);
  } finally { await fresh.close(); }
});

test('dashboard: local-day bucketing honours the shop timezone offset', async () => {
  const fresh = await setup({ tz: 330 }); // IST
  try {
    const db = fresh.db;
    const b = Number(db.prepare("INSERT INTO books(title, author, price_cents, stock_qty) VALUES ('Z', 'A', 100, 5)").run().lastInsertRowid);
    // 2026-06-14T20:00Z is 2026-06-15 01:30 in IST: belongs to the 15th locally.
    const id = Number(db.prepare(`INSERT INTO sales(bill_no, payment_method, subtotal_cents, total_cents, user_id, created_at)
      VALUES ('TZ-1', 'cash', 100, 100, 1, '2026-06-14T20:00:00.000Z')`).run().lastInsertRowid);
    db.prepare("INSERT INTO sale_items(sale_id, book_id, title, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, 'Z', 1, 100, 100)").run(id, b);
    const on15 = dashboard(db, 330, { from: '2026-06-15', to: '2026-06-15', now: NOW });
    const on14 = dashboard(db, 330, { from: '2026-06-14', to: '2026-06-14', now: NOW });
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
    assert.equal(d.summary.operatingProfitCents, 7000);
    assert.equal(d.bestSellers[0].units, 3);
    assert.equal(d.inventory.units, 7);
  } finally { await fresh.close(); }
});

test('dashboard validates its date inputs', async () => {
  assert.equal((await t.asOwner.get('/api/dashboard?from=2026-06-10&to=2026-06-01')).status, 400);
  assert.equal((await t.asOwner.get('/api/dashboard?from=garbage')).status, 400);
  assert.equal((await t.asOwner.get('/api/dashboard?group=year')).status, 400);
});
