const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup } = require('./helpers');
const { openDatabase } = require('../src/db');
const sales = require('../src/services/sales');
const users = require('../src/services/users');
const { computeTotals } = require('../src/lib/money');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const sell = (client, items, extra = {}) => client.post('/api/sales', { items, paymentMethod: 'cash', ...extra });

test('computeTotals: discount then tax, rounded to whole cents', () => {
  const r = computeTotals([{ unitPriceCents: 9999, quantity: 3 }, { unitPriceCents: 2550, quantity: 1 }], 1250, 500);
  assert.equal(r.subtotalCents, 32547);
  assert.equal(r.discountCents, 4068); // 32547 * 12.5% = 4068.375
  assert.equal(r.taxCents, Math.round((32547 - 4068) * 0.05));
  assert.equal(r.totalCents, 32547 - 4068 + r.taxCents);
});

test('a sale persists the bill, snapshots price/cost, and deducts stock', async () => {
  const a = await t.addBook({ title: 'Alpha', priceCents: 25000, openingStock: 10 });
  const b = await t.addBook({ title: 'Beta', priceCents: 12050, openingStock: 5 });
  const res = await sell(t.asStaff, [{ bookId: a.id, quantity: 2 }, { bookId: b.id, quantity: 1 }], { customerName: 'Walk-in' });
  assert.equal(res.status, 201);
  assert.equal(res.body.subtotalCents, 62050);
  assert.equal(res.body.totalCents, 62050);
  assert.match(res.body.billNo, /^INV-\d{6}$/);
  assert.equal(t.stock(a.id).s, 8);
  assert.equal(t.stock(b.id).s, 4);

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

test('staff discount is capped by settings; owner may exceed it', async () => {
  const a = await t.addBook({ priceCents: 10000 });
  const staff = await sell(t.asStaff, [{ bookId: a.id, quantity: 1 }], { discountPercent: 25 });
  assert.equal(staff.status, 403);
  const owner = await sell(t.asOwner, [{ bookId: a.id, quantity: 1 }], { discountPercent: 25 });
  assert.equal(owner.status, 201);
  assert.equal(owner.body.totalCents, 7500);
  assert.equal((await sell(t.asOwner, [{ bookId: a.id, quantity: 1 }], { discountPercent: 101 })).status, 400);
});

test('insufficient stock fails the whole sale and leaves no partial records', async () => {
  const ok = await t.addBook({ openingStock: 5 });
  const scarce = await t.addBook({ openingStock: 1 });
  const before = t.db.prepare('SELECT COUNT(*) c FROM sales').get().c;
  const res = await sell(t.asStaff, [{ bookId: ok.id, quantity: 2 }, { bookId: scarce.id, quantity: 2 }]);
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /Insufficient stock/);
  assert.equal(t.db.prepare('SELECT COUNT(*) c FROM sales').get().c, before);
  assert.equal(t.stock(ok.id).s, 5); // first line was not deducted
  assert.equal(t.stock(scarce.id).s, 1);
});

test('mid-transaction failure rolls back everything (stock + bill)', () => {
  const db = openDatabase(':memory:');
  const owner = users.createUser(db, { username: 'owner1', fullName: 'O', password: 'password-1', role: 'owner' });
  const mk = (title, stock) => Number(db.prepare("INSERT INTO books(title, author, price_cents, stock_qty) VALUES (?, 'A', 100, ?)").run(title, stock).lastInsertRowid);
  const good = mk('Good', 5);
  const bad = mk('Bad', 5);
  // Force the second stock deduction to fail at the database level.
  db.exec(`CREATE TRIGGER boom BEFORE UPDATE OF stock_qty ON books WHEN NEW.id = ${bad} BEGIN SELECT RAISE(ABORT, 'disk on fire'); END;`);
  assert.throws(() => sales.createSale(db, { id: owner.id, role: 'owner' }, { items: [{ bookId: good, quantity: 1 }, { bookId: bad, quantity: 1 }], paymentMethod: 'cash' }));
  assert.equal(db.prepare('SELECT stock_qty s FROM books WHERE id = ?').get(good).s, 5);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sales').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sale_items').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM stock_movements').get().c, 0);
  db.close();
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
  assert.equal(t.stock(a.id).s, 3);
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

test('concurrent sales of the last copy: exactly one succeeds, stock never goes negative', async () => {
  const a = await t.addBook({ openingStock: 1 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => sell(i % 2 ? t.asStaff : t.asOwner, [{ bookId: a.id, quantity: 1 }])));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 7);
  assert.equal(t.stock(a.id).s, 0);
});

test('two separate database connections cannot oversell (cross-process safety)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')), 'shared.db');
  const d1 = openDatabase(file);
  const d2 = openDatabase(file);
  const u = users.createUser(d1, { username: 'owner1', fullName: 'O', password: 'password-1', role: 'owner' });
  const user = { id: u.id, role: 'owner' };
  const id = Number(d1.prepare("INSERT INTO books(title, author, price_cents, stock_qty) VALUES ('Last', 'A', 100, 1)").run().lastInsertRowid);
  const req = { items: [{ bookId: id, quantity: 1 }], paymentMethod: 'cash' };
  sales.createSale(d1, user, req);
  assert.throws(() => sales.createSale(d2, user, req), /Insufficient stock/);
  assert.equal(d1.prepare('SELECT stock_qty s FROM books WHERE id = ?').get(id).s, 0);
  assert.throws(() => d1.prepare('UPDATE books SET stock_qty = -1 WHERE id = ?').run(id), /CHECK/); // DB-level guard
  d1.close(); d2.close();
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
  assert.ok(!('unitCostCents' in full.body.items[0])); // staff never see cost
  assert.ok('unitCostCents' in (await t.asOwner.get(`/api/sales/${made.body.id}`)).body.items[0]);
});

test('voiding is owner-only, restores stock once, and is blocked a second time', async () => {
  const a = await t.addBook({ openingStock: 4 });
  const made = await sell(t.asStaff, [{ bookId: a.id, quantity: 3 }]);
  assert.equal((await t.asStaff.post(`/api/sales/${made.body.id}/void`, { reason: 'oops' })).status, 403);
  assert.equal((await t.asOwner.post(`/api/sales/${made.body.id}/void`, {})).status, 400); // reason required
  const v = await t.asOwner.post(`/api/sales/${made.body.id}/void`, { reason: 'Customer returned' });
  assert.equal(v.status, 200);
  assert.equal(v.body.status, 'voided');
  assert.equal(t.stock(a.id).s, 4);
  assert.equal((await t.asOwner.post(`/api/sales/${made.body.id}/void`, { reason: 'again' })).status, 409);
  assert.equal(t.stock(a.id).s, 4);
});

test('unknown book, zero quantity and empty cart are rejected', async () => {
  assert.equal((await sell(t.asStaff, [{ bookId: 999999, quantity: 1 }])).status, 404);
  const a = await t.addBook();
  assert.equal((await sell(t.asStaff, [{ bookId: a.id, quantity: 0 }])).status, 400);
  assert.equal((await sell(t.asStaff, [])).status, 400);
});

test('owner can correct stock after a count; reason required; cannot go below reserved', async () => {
  const a = await t.addBook({ openingStock: 10 });
  assert.equal((await t.asStaff.post(`/api/books/${a.id}/adjust`, { countedQty: 8, reason: 'x' })).status, 403);
  assert.equal((await t.asOwner.post(`/api/books/${a.id}/adjust`, { countedQty: 8 })).status, 400);
  const r = await t.asOwner.post(`/api/books/${a.id}/adjust`, { countedQty: 8, reason: 'Two copies damaged' });
  assert.equal(r.status, 200);
  assert.equal(t.stock(a.id).s, 8);
  const m = (await t.asOwner.get(`/api/books/${a.id}/movements`)).body[0];
  assert.deepEqual([m.reason, m.delta, m.note], ['adjustment', -2, 'Two copies damaged']);
  // Reserve 5 via a phone order, then try to count below the reservation.
  await t.asStaff.post('/api/orders', { customerName: 'C', customerPhone: '9999999999', deliveryType: 'pickup', items: [{ bookId: a.id, quantity: 5 }] });
  assert.equal((await t.asOwner.post(`/api/books/${a.id}/adjust`, { countedQty: 3, reason: 'recount' })).status, 409);
});
