const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const mkSupplier = async (name, extra = {}) => (await t.asOwner.post('/api/suppliers', { name, leadTimeDays: 5, ...extra })).body;
const cost = async (bookId) => (await t.db.one('SELECT cost_cents AS c FROM shop_stock WHERE book_id = $1 AND shop_id = $2', [bookId, t.shop1])).c;
const quote = (sid, bid, cost) => t.asOwner.put(`/api/suppliers/${sid}/books/${bid}`, { unitCostCents: cost });

test('supplier CRUD, unique names, and manager/owner-only access', async () => {
  const s = await mkSupplier('Acme Books', { phone: '123', email: 'a@acme.example', categories: 'Fiction' });
  assert.ok(s.id);
  assert.equal((await t.asOwner.post('/api/suppliers', { name: 'acme books' })).status, 409);
  assert.equal((await t.asOwner.post('/api/suppliers', { name: 'Bad', email: 'nope' })).status, 400);
  assert.equal((await t.asStaff.get(`/api/suppliers/${s.id}`)).status, 403);
  const upd = await t.asOwner.put(`/api/suppliers/${s.id}`, { name: 'Acme Books Ltd', phone: '999' });
  assert.equal(upd.body.phone, '999');
});

test('multiple suppliers for one book are listed cheapest first with history', async () => {
  const book = await t.addBook({ openingStock: 0 });
  const dear = await mkSupplier('Dear Dist', { leadTimeDays: 2 });
  const cheap = await mkSupplier('Cheap Dist', { leadTimeDays: 9 });
  await quote(dear.id, book.id, 7000);
  await quote(cheap.id, book.id, 5500);
  const list = (await t.asOwner.get(`/api/books/${book.id}/suppliers`)).body;
  assert.deepEqual(list.map((x) => x.name), ['Cheap Dist', 'Dear Dist']);
  assert.equal(list[0].isCheapest, true);
  assert.equal(list[1].isCheapest, false);
  assert.equal((await t.asStaff.get(`/api/books/${book.id}/suppliers`)).status, 403);
});

test('PO defaults the cost to the supplier quote and requires one when there is none', async () => {
  const sup = await mkSupplier('Quote Co');
  const quoted = await t.addBook({ openingStock: 0 });
  const unquoted = await t.addBook({ openingStock: 0 });
  await quote(sup.id, quoted.id, 4200);
  const po = await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: quoted.id, quantity: 5 }] });
  assert.equal(po.status, 201);
  assert.equal(po.body.items[0].unitCostCents, 4200);
  assert.equal(po.body.orderedCents, 21000);
  assert.equal((await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: unquoted.id, quantity: 1 }] })).status, 400);
  assert.equal((await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: unquoted.id, quantity: 1, unitCostCents: 100 }] })).status, 201);
});

test('goods receipt adds exactly the received quantity, updates cost, supports partial receipts', async () => {
  const sup = await mkSupplier('Receiver Co');
  const book = await t.addBook({ openingStock: 0 });
  const po = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 10, unitCostCents: 6000 }] })).body;
  const line = po.items[0].id;

  const r1 = await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: line, quantity: 4 }] });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.purchaseOrder.status, 'partially_received');
  assert.equal((await t.stock(book.id)).s, 4);
  assert.equal((await cost(book.id)), 6000);

  // Over-receipt is refused and changes nothing.
  const over = await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: line, quantity: 7 }] });
  assert.equal(over.status, 409);
  assert.equal((await t.stock(book.id)).s, 4);

  const r2 = await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: line, quantity: 6, unitCostCents: 7000 }] });
  assert.equal(r2.body.purchaseOrder.status, 'received');
  assert.equal((await t.stock(book.id)).s, 10);
  // weighted average: (4*6000 + 6*7000) / 10 = 6600
  assert.equal((await cost(book.id)), 6600);
  assert.equal(r2.body.purchaseOrder.receivedCents, 4 * 6000 + 6 * 7000);
  // supplier price list picks up the latest actual cost
  const sp = (await t.asOwner.get(`/api/suppliers/${sup.id}`)).body;
  assert.equal(sp.books[0].unitCostCents, 7000);
  assert.equal(sp.totalPurchasedCents, 4 * 6000 + 6 * 7000);
  // a fully received PO cannot receive again
  assert.equal((await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: line, quantity: 1 }] })).status, 409);
  assert.equal((await t.stock(book.id)).s, 10);
  const moves = (await t.asOwner.get(`/api/books/${book.id}/movements`)).body.filter((m) => m.reason === 'receipt');
  assert.deepEqual(moves.map((m) => m.delta).sort(), [4, 6]);
});

test('retrying a receipt with the same idempotency key does not double-receive', async () => {
  const sup = await mkSupplier('Idem Co');
  const book = await t.addBook({ openingStock: 0 });
  const po = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 10, unitCostCents: 100 }] })).body;
  const body = { idempotencyKey: 'rcpt-1', items: [{ poItemId: po.items[0].id, quantity: 3 }] };
  const a = await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, body);
  const b = await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicate, true);
  assert.equal((await t.stock(book.id)).s, 3);
});

test('a receipt that fails on one line leaves no partial stock or receipt', async () => {
  const sup = await mkSupplier('Atomic Co');
  const a = await t.addBook({ openingStock: 0 });
  const b = await t.addBook({ openingStock: 0 });
  const po = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: a.id, quantity: 5, unitCostCents: 100 }, { bookId: b.id, quantity: 2, unitCostCents: 100 }] })).body;
  const res = await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 5 }, { poItemId: po.items[1].id, quantity: 3 }] });
  assert.equal(res.status, 409);
  assert.equal((await t.stock(a.id)).s, 0);
  assert.equal((await t.db.one('SELECT COUNT(*) AS c FROM goods_receipts WHERE po_id = $1', [po.id])).c, 0);
  assert.equal((await t.asOwner.get(`/api/purchase-orders/${po.id}`)).body.status, 'ordered');
});

test('receiving into a title that has stock averages the cost; unknown cost is replaced', async () => {
  const sup = await mkSupplier('Avg Co');
  const book = await t.addBook({ openingStock: 10 }); // cost unknown (0)
  const po = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 10, unitCostCents: 3000 }] })).body;
  await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 10 }] });
  assert.equal((await cost(book.id)), 3000);
  const po2 = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 20, unitCostCents: 3600 }] })).body;
  await t.asOwner.post(`/api/purchase-orders/${po2.id}/receive`, { items: [{ poItemId: po2.items[0].id, quantity: 20 }] });
  assert.equal((await cost(book.id)), 3300); // (20*3000 + 20*3600) / 40
});

test('cancelled POs cannot receive; PO listing and filters', async () => {
  const sup = await mkSupplier('Cancel Co');
  const book = await t.addBook({ openingStock: 0 });
  const po = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 2, unitCostCents: 100 }] })).body;
  assert.equal((await t.asOwner.post(`/api/purchase-orders/${po.id}/cancel`)).body.status, 'cancelled');
  assert.equal((await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 1 }] })).status, 409);
  assert.equal((await t.asOwner.post(`/api/purchase-orders/${po.id}/cancel`)).status, 409);
  const open = (await t.asOwner.get('/api/purchase-orders?status=open')).body;
  assert.ok(!open.some((p) => p.id === po.id));
  assert.equal((await t.asStaff.get('/api/purchase-orders')).status, 403);
});

test('a manager can run purchasing; receipts land in the receiving shop only', async () => {
  const sup = (await t.asManager.post('/api/suppliers', { name: 'Manager Co', leadTimeDays: 3 })).body;
  const book = await t.addBook({ openingStock: 0 });
  t.asManager.shop(t.shop2);
  try {
    const po = await t.asManager.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 4, unitCostCents: 250 }] });
    assert.equal(po.status, 201);
    assert.match(po.body.poNo, /^PO-S02-\d{5}$/);
    const r = await t.asManager.post(`/api/purchase-orders/${po.body.id}/receive`, { items: [{ poItemId: po.body.items[0].id, quantity: 4 }] });
    assert.equal(r.status, 201);
  } finally {
    t.asManager.shop(null);
  }
  assert.equal((await t.stock(book.id, t.shop2)).s, 4);
  assert.equal((await t.stock(book.id, t.shop1)).s, 0);
  // The PO belongs to shop 2, so it is not listed in shop 1.
  const list = (await t.asOwner.get('/api/purchase-orders')).body;
  assert.ok(!list.some((p) => p.supplier === 'Manager Co'));
});
