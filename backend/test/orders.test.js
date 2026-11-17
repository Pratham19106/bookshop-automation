const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const cust = { customerName: 'Anita Rao', customerPhone: '+91 98200 12345' };
const place = (client, items, extra = {}) => client.post('/api/orders', { ...cust, deliveryType: 'pickup', items, ...extra });
const sale = (client, items) => client.post('/api/sales', { items, paymentMethod: 'cash' });

test('placing an order reserves stock without deducting it; billing respects reservations', async () => {
  const b = await t.addBook({ openingStock: 5, priceCents: 10000 });
  const o = await place(t.asStaff, [{ bookId: b.id, quantity: 3 }]);
  assert.equal(o.status, 201);
  assert.equal(o.body.status, 'placed');
  assert.equal(o.body.paymentStatus, 'unpaid');
  assert.equal(o.body.totalCents, 30000);
  assert.deepEqual((await t.stock(b.id)), { s: 5, r: 3 });
  // Only 2 are available to counter customers now.
  assert.equal((await sale(t.asStaff, [{ bookId: b.id, quantity: 3 }])).status, 409);
  assert.equal((await sale(t.asStaff, [{ bookId: b.id, quantity: 2 }])).status, 201);
  assert.deepEqual((await t.stock(b.id)), { s: 3, r: 3 });
  const view = (await t.asStaff.get(`/api/books/${b.id}`)).body;
  assert.equal(view.availableQty, 0);
});

test('orders cannot reserve more than is available, and nothing is reserved on failure', async () => {
  const a = await t.addBook({ openingStock: 5 });
  const b = await t.addBook({ openingStock: 1 });
  const r = await place(t.asStaff, [{ bookId: a.id, quantity: 2 }, { bookId: b.id, quantity: 2 }]);
  assert.equal(r.status, 409);
  assert.deepEqual((await t.stock(a.id)), { s: 5, r: 0 });
  assert.equal((await t.db.one('SELECT COUNT(*) AS c FROM phone_orders WHERE customer_name = $1 AND total_cents = 0', ['Anita Rao'])).c, 0);
});

test('delivery orders require an address; phone number is validated', async () => {
  const b = await t.addBook();
  assert.equal((await place(t.asStaff, [{ bookId: b.id, quantity: 1 }], { deliveryType: 'delivery' })).status, 400);
  assert.equal((await place(t.asStaff, [{ bookId: b.id, quantity: 1 }], { customerPhone: 'abc' })).status, 400);
  assert.equal((await place(t.asStaff, [{ bookId: b.id, quantity: 1 }], { deliveryType: 'delivery', deliveryAddress: '1 Main St' })).status, 201);
});

test('full lifecycle (pickup): place → ready → fulfil creates exactly one bill and deducts exactly once', async () => {
  const b = await t.addBook({ openingStock: 6, priceCents: 20000 });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 2 }], { advancePayment: { amountCents: 10000, method: 'upi' } })).body;
  assert.equal(o.paymentStatus, 'partial');
  assert.equal(o.balanceCents, 30000);
  // can't skip "ready"
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/fulfil`, { paymentMethod: 'cash' })).status, 409);
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/status`, { status: 'ready' })).status, 200);
  // balance must be collected
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/fulfil`, {})).status, 400);
  const done = await t.asStaff.post(`/api/orders/${o.id}/fulfil`, { paymentMethod: 'cash' });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.paymentStatus, 'paid');
  assert.equal(done.body.paidCents, 40000);
  assert.deepEqual((await t.stock(b.id)), { s: 4, r: 0 });

  const bill = (await t.asStaff.get(`/api/sales/${done.body.saleId}`)).body;
  assert.equal(bill.totalCents, 40000);
  assert.equal(bill.orderId, o.id);

  // Double click / retry: no second bill, no second deduction, no second charge.
  const again = await t.asStaff.post(`/api/orders/${o.id}/fulfil`, { paymentMethod: 'cash' });
  assert.equal(again.status, 409);
  assert.deepEqual((await t.stock(b.id)), { s: 4, r: 0 });
  assert.equal((await t.db.one('SELECT COUNT(*) AS c FROM sales WHERE order_id = $1', [o.id])).c, 1);
  assert.equal((await t.asStaff.get(`/api/orders/${o.id}`)).body.paidCents, 40000);
});

test('parallel fulfil requests produce one bill', async () => {
  const b = await t.addBook({ openingStock: 3, priceCents: 1000 });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 1 }])).body;
  await t.asStaff.post(`/api/orders/${o.id}/status`, { status: 'ready' });
  const rs = await Promise.all(Array.from({ length: 5 }, () => t.asStaff.post(`/api/orders/${o.id}/fulfil`, { paymentMethod: 'cash' })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal((await t.stock(b.id)).s, 2);
  assert.equal((await t.db.one('SELECT COUNT(*) AS c FROM sales WHERE order_id = $1', [o.id])).c, 1);
});

test('delivery lifecycle: ready → out_for_delivery → fulfil; pickups cannot go out for delivery', async () => {
  const b = await t.addBook({ openingStock: 3 });
  const d = (await place(t.asStaff, [{ bookId: b.id, quantity: 1 }], { deliveryType: 'delivery', deliveryAddress: '5 Lane' })).body;
  assert.equal((await t.asStaff.post(`/api/orders/${d.id}/status`, { status: 'out_for_delivery' })).status, 409); // not ready yet
  await t.asStaff.post(`/api/orders/${d.id}/status`, { status: 'ready' });
  assert.equal((await t.asStaff.post(`/api/orders/${d.id}/fulfil`, { paymentMethod: 'cash' })).status, 409); // must be sent out first
  assert.equal((await t.asStaff.post(`/api/orders/${d.id}/status`, { status: 'out_for_delivery' })).status, 200);
  assert.equal((await t.asStaff.post(`/api/orders/${d.id}/fulfil`, { paymentMethod: 'cash' })).status, 200);
  const p = (await place(t.asStaff, [{ bookId: b.id, quantity: 1 }])).body;
  await t.asStaff.post(`/api/orders/${p.id}/status`, { status: 'ready' });
  assert.equal((await t.asStaff.post(`/api/orders/${p.id}/status`, { status: 'out_for_delivery' })).status, 409);
});

test('modifying an order adjusts reservations, keeps agreed prices, and recalculates totals', async () => {
  const a = await t.addBook({ openingStock: 5, priceCents: 10000 });
  const b = await t.addBook({ openingStock: 5, priceCents: 5000 });
  const o = (await place(t.asStaff, [{ bookId: a.id, quantity: 2 }])).body;
  await t.asOwner.put(`/api/books/${a.id}`, { title: 'A', author: 'Z', priceCents: 20000 }); // price rises after the call
  const m = await t.asStaff.put(`/api/orders/${o.id}`, { ...cust, deliveryType: 'pickup', items: [{ bookId: a.id, quantity: 3 }, { bookId: b.id, quantity: 1 }] });
  assert.equal(m.status, 200);
  assert.equal(m.body.items.find((i) => i.bookId === a.id).unitPriceCents, 10000); // old agreed price kept
  assert.equal(m.body.items.find((i) => i.bookId === b.id).unitPriceCents, 5000);
  assert.equal(m.body.totalCents, 35000);
  assert.deepEqual((await t.stock(a.id)), { s: 5, r: 3 });
  assert.deepEqual((await t.stock(b.id)), { s: 5, r: 1 });
  // reduce: removing a book releases its reservation
  const m2 = await t.asStaff.put(`/api/orders/${o.id}`, { ...cust, deliveryType: 'pickup', items: [{ bookId: b.id, quantity: 1 }] });
  assert.equal(m2.status, 200);
  assert.deepEqual((await t.stock(a.id)), { s: 5, r: 0 });
  // growing beyond availability fails and leaves reservations as they were
  const big = await t.asStaff.put(`/api/orders/${o.id}`, { ...cust, deliveryType: 'pickup', items: [{ bookId: b.id, quantity: 9 }] });
  assert.equal(big.status, 409);
  assert.deepEqual((await t.stock(b.id)), { s: 5, r: 1 });
});

test('cancelling releases the reservation once; cancelled/completed orders cannot be changed', async () => {
  const b = await t.addBook({ openingStock: 4 });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 3 }])).body;
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/cancel`, {})).status, 400); // reason required
  const c = await t.asStaff.post(`/api/orders/${o.id}/cancel`, { reason: 'Customer changed mind' });
  assert.equal(c.body.status, 'cancelled');
  assert.deepEqual((await t.stock(b.id)), { s: 4, r: 0 });
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/cancel`, { reason: 'again' })).status, 409);
  assert.deepEqual((await t.stock(b.id)), { s: 4, r: 0 });
  assert.equal((await t.asStaff.put(`/api/orders/${o.id}`, { ...cust, deliveryType: 'pickup', items: [{ bookId: b.id, quantity: 1 }] })).status, 409);
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/status`, { status: 'ready' })).status, 409);
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/fulfil`, { paymentMethod: 'cash' })).status, 409);
  assert.equal((await t.stock(b.id)).s, 4);
});

test('a completed order cannot be cancelled or have its bill voided (no double reversal)', async () => {
  const b = await t.addBook({ openingStock: 2 });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 1 }])).body;
  await t.asStaff.post(`/api/orders/${o.id}/status`, { status: 'ready' });
  const done = (await t.asStaff.post(`/api/orders/${o.id}/fulfil`, { paymentMethod: 'cash' })).body;
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/cancel`, { reason: 'late' })).status, 409);
  assert.equal((await t.asOwner.post(`/api/sales/${done.saleId}/void`, { reason: 'x' })).status, 409);
  assert.equal((await t.stock(b.id)).s, 1);
});

test('payment status is independent of fulfilment: pay in parts, no overpayment, refund after cancel', async () => {
  const b = await t.addBook({ openingStock: 3, priceCents: 10000 });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 2 }])).body; // total 20000
  assert.equal(o.paymentStatus, 'unpaid');
  let r = await t.asStaff.post(`/api/orders/${o.id}/payments`, { amountCents: 5000, method: 'cash' });
  assert.equal(r.body.paymentStatus, 'partial');
  assert.equal(r.body.status, 'placed'); // fulfilment unaffected
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/payments`, { amountCents: 15100, method: 'cash' })).status, 400); // 1 rupee too much
  r = await t.asStaff.post(`/api/orders/${o.id}/payments`, { amountCents: 15000, method: 'card' });
  assert.equal(r.body.paymentStatus, 'paid');
  assert.equal(r.body.balanceCents, 0);
  // ready & paid can still be cancelled; refund then due
  const c = await t.asStaff.post(`/api/orders/${o.id}/cancel`, { reason: 'No longer needed' });
  assert.equal(c.body.paymentStatus, 'refund_due');
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/payments`, { amountCents: 100, method: 'cash' })).status, 409);
  const rf = await t.asStaff.post(`/api/orders/${o.id}/refund`, { method: 'card' });
  assert.equal(rf.body.paymentStatus, 'refunded');
  assert.equal(rf.body.paidCents, 0);
  assert.equal((await t.asStaff.post(`/api/orders/${o.id}/refund`, { method: 'card' })).status, 409); // nothing left to refund
});

test('an order cannot be reduced below what has already been paid without refunding first', async () => {
  const b = await t.addBook({ openingStock: 5, priceCents: 10000 });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 3 }], { advancePayment: { amountCents: 25000, method: 'cash' } })).body;
  const m = await t.asStaff.put(`/api/orders/${o.id}`, { ...cust, deliveryType: 'pickup', items: [{ bookId: b.id, quantity: 1 }] });
  assert.equal(m.status, 409);
  assert.deepEqual((await t.stock(b.id)), { s: 5, r: 3 }); // rolled back
  await t.asStaff.post(`/api/orders/${o.id}/refund`, { method: 'cash', amountCents: 20000 });
  assert.equal((await t.asStaff.put(`/api/orders/${o.id}`, { ...cust, deliveryType: 'pickup', items: [{ bookId: b.id, quantity: 1 }] })).status, 200);
});

test('advance payment larger than the total is rejected and the order is not created', async () => {
  const b = await t.addBook({ openingStock: 5, priceCents: 1000 });
  const r = await place(t.asStaff, [{ bookId: b.id, quantity: 1 }], { advancePayment: { amountCents: 5000, method: 'cash' } });
  assert.equal(r.status, 400);
  assert.deepEqual((await t.stock(b.id)), { s: 5, r: 0 });
});

test('a book with reserved copies cannot be retired; list filters work', async () => {
  const b = await t.addBook({ openingStock: 5, title: 'Reserved Thing' });
  const o = (await place(t.asStaff, [{ bookId: b.id, quantity: 1 }])).body;
  assert.equal((await t.asOwner.post(`/api/books/${b.id}/active`, { active: false })).status, 409);
  const open = await t.asStaff.get('/api/orders?status=open&q=Anita');
  assert.ok(open.body.items.some((x) => x.id === o.id));
  await t.asStaff.post(`/api/orders/${o.id}/payments`, { amountCents: 100, method: 'cash' });
  const partial = await t.asStaff.get('/api/orders?payment=partial');
  assert.ok(partial.body.items.some((x) => x.id === o.id));
});
