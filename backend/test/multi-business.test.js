const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Multi-business / multi-shop behaviour: registration, shops, tenant isolation, per-shop stock and numbering, roles.

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const sell = (client, items, extra = {}) => client.post('/api/sales', { items, paymentMethod: 'cash', ...extra });

test('registering a business creates its HQ shop and signs the owner in (no session token in the body)', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Solo Bookshop Venture', ownerName: 'Solo Owner', username: 'solo_owner', password: 'password123', email: 'solo@example.com',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.business.name, 'Solo Bookshop Venture');
  assert.equal(res.body.user.role, 'owner');
  assert.equal(res.body.shops.length, 1);
  assert.equal(res.body.shops[0].isHq, true);
  assert.ok(!('token' in res.body));
  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.shops.length, 1);

  const added = await client.post('/api/shops', { name: 'Second Street', city: 'Pune', address: '1 FC Road' });
  assert.equal(added.status, 201);
  assert.equal(added.body.code, 'S02');
  assert.equal(added.body.isHq, false);
  assert.equal((await client.get('/api/shops')).body.length, 2);
});

test('registration with several shops keeps their details; duplicate usernames are refused', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Chain Books', ownerName: 'Chain Owner', username: 'chain_owner', password: 'password123', email: 'c@example.com',
    shops: [{ name: 'North', city: 'Delhi', address: 'CP' }, { name: 'South', city: 'Chennai', address: 'T Nagar', isHq: true }],
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.shops.map((s) => [s.name, s.city, s.isHq]), [['North', 'Delhi', false], ['South', 'Chennai', true]]);
  const dup = await t.client().post('/api/auth/register-business', {
    businessName: 'X', ownerName: 'Y', username: 'CHAIN_OWNER', password: 'password123', email: 'z@example.com',
  });
  assert.equal(dup.status, 409);
});

test('businesses are isolated: another business cannot see or touch our books, bills or suppliers', async () => {
  const book = await t.addBook({ title: 'Ours Only', openingStock: 3 });
  const bill = (await sell(t.asOwner, [{ bookId: book.id, quantity: 1 }])).body;
  const sup = (await t.asOwner.post('/api/suppliers', { name: 'Our Supplier' })).body;

  assert.equal((await t.asOther.get(`/api/books/${book.id}`)).status, 404);
  assert.equal((await t.asOther.get('/api/books?q=ours')).body.total, 0);
  assert.equal((await t.asOther.put(`/api/books/${book.id}`, { title: 'Hijack', priceCents: 1 })).status, 404);
  assert.equal((await sell(t.asOther, [{ bookId: book.id, quantity: 1 }])).status, 404);
  assert.equal((await t.asOther.get(`/api/sales/${bill.id}`)).status, 404);
  assert.equal((await t.asOther.post(`/api/sales/${bill.id}/void`, { reason: 'x' })).status, 404);
  assert.equal((await t.asOther.get(`/api/suppliers/${sup.id}`)).status, 404);
  assert.ok(!(await t.asOther.get('/api/suppliers')).body.some((s) => s.id === sup.id));
  assert.equal((await t.asOther.get('/api/users')).body.some((u) => u.username === 'staff'), false);
  // Same ISBN can exist independently in two businesses.
  assert.equal((await t.asOwner.post('/api/books', { title: 'Shared ISBN', isbn: '9780306406157', priceCents: 100 })).status, 201);
  assert.equal((await t.asOther.post('/api/books', { title: 'Shared ISBN', isbn: '9780306406157', priceCents: 100 })).status, 201);
  // Using another business's shop id is refused.
  assert.equal((await t.asOwner.shop(t.otherShop).get('/api/orders')).status, 403);
  t.asOwner.shop(null);
});

test('staff are confined to their assigned shop', async () => {
  assert.equal((await t.asStaff.shop(t.shop2).get('/api/orders')).status, 403);
  t.asStaff.shop(null);
  assert.equal((await t.asStaff.get('/api/orders')).status, 200); // defaults to their own shop
  const me = (await t.asStaff.get('/api/auth/me')).body.user;
  assert.deepEqual(me.shops.map((s) => s.id), [t.shop1]);
});

test('stock is per shop: selling in shop 1 does not touch shop 2', async () => {
  const book = await t.addBook({ title: 'Two Shop Title', openingStock: 5 }); // opening stock goes to shop 1
  // Shop 2 receives its own copies through purchasing.
  const sup = (await t.asOwner.post('/api/suppliers', { name: 'Shop2 Supplier' })).body;
  t.asManager.shop(t.shop2);
  const po = (await t.asManager.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 3, unitCostCents: 100 }] })).body;
  await t.asManager.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 3 }] });
  t.asManager.shop(null);

  assert.equal((await sell(t.asStaff, [{ bookId: book.id, quantity: 2 }])).status, 201);
  assert.equal((await t.stock(book.id, t.shop1)).s, 3);
  assert.equal((await t.stock(book.id, t.shop2)).s, 3);
  // Shop 2 cannot sell more than it holds, whatever shop 1 has.
  assert.equal((await sell(t.asStaff2, [{ bookId: book.id, quantity: 4 }])).status, 409);
  const view2 = (await t.asStaff2.get(`/api/books/${book.id}`)).body;
  assert.equal(view2.stockQty, 3);
});

test('bill numbers are independent per shop and carry the shop code', async () => {
  const book = await t.addBook({ openingStock: 2 });
  const sup = (await t.asOwner.post('/api/suppliers', { name: 'Numbering Supplier' })).body;
  t.asOwner.shop(t.shop2);
  const po = (await t.asOwner.post('/api/purchase-orders', { supplierId: sup.id, items: [{ bookId: book.id, quantity: 2, unitCostCents: 100 }] })).body;
  await t.asOwner.post(`/api/purchase-orders/${po.id}/receive`, { items: [{ poItemId: po.items[0].id, quantity: 2 }] });
  const b2 = (await sell(t.asOwner, [{ bookId: book.id, quantity: 1 }])).body;
  t.asOwner.shop(null);
  const b1 = (await sell(t.asOwner, [{ bookId: book.id, quantity: 1 }])).body;
  assert.match(b1.billNo, /^INV-S01-/);
  assert.match(b2.billNo, /^INV-S02-/);
  // Shop 2 staff see shop 2 bills only; the owner can list across shops.
  const staff2Bills = (await t.asStaff2.get('/api/sales')).body.items;
  assert.ok(staff2Bills.every((s) => s.shopId === t.shop2));
  assert.equal((await t.asStaff2.get(`/api/sales/${b1.id}`)).status, 404);
  const all = (await t.asOwner.get('/api/sales?shop=all')).body.items;
  assert.ok(all.some((s) => s.id === b1.id) && all.some((s) => s.id === b2.id));
});

test('role matrix: staff sell, managers run stock and purchasing, only the owner manages people, shops and settings', async () => {
  for (const path of ['/api/suppliers', '/api/purchase-orders', '/api/restock', '/api/dashboard', '/api/expenses', '/api/sales-report']) {
    assert.equal((await t.asStaff.get(path)).status, 403, `staff ${path}`);
    assert.equal((await t.asManager.get(path)).status, 200, `manager ${path}`);
  }
  for (const path of ['/api/users']) {
    assert.equal((await t.asManager.get(path)).status, 403, `manager ${path}`);
    assert.equal((await t.asOwner.get(path)).status, 200, `owner ${path}`);
  }
  assert.equal((await t.asManager.put('/api/settings', { taxPercent: 1 })).status, 403);
  assert.equal((await t.asManager.post('/api/shops', { name: 'Rogue' })).status, 403);
  assert.equal((await t.asManager.post('/api/users', { username: 'x1x', fullName: 'X', password: 'password-1', role: 'staff', shopIds: [t.shop1] })).status, 403);
});

test('owner manages users: managers/staff need a shop from this business; roles and shops can change', async () => {
  assert.equal((await t.asOwner.post('/api/users', { username: 'noshop', fullName: 'N', password: 'password-1', role: 'staff' })).status, 400);
  assert.equal((await t.asOwner.post('/api/users', { username: 'wrongshop', fullName: 'W', password: 'password-1', role: 'staff', shopIds: [t.otherShop] })).status, 400);
  const u = await t.asOwner.post('/api/users', { username: 'newstaff', fullName: 'New', password: 'password-1', role: 'staff', shopIds: [t.shop2] });
  assert.equal(u.status, 201);
  assert.deepEqual(u.body.shopIds, [t.shop2]);
  const promoted = await t.asOwner.put(`/api/users/${u.body.id}`, { role: 'manager', shopIds: [t.shop1, t.shop2] });
  assert.equal(promoted.body.role, 'manager');
  const c = await t.signedIn('newstaff', 'password-1');
  assert.equal((await c.get('/api/suppliers')).status, 200);
  assert.equal((await c.get('/api/auth/me')).body.user.shops.length, 2);
});

test('dashboard: the owner sees all shops or one; a manager only their shops', async () => {
  const all = await t.asOwner.get('/api/dashboard');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.byShop.map((s) => s.shopId).sort(), [t.shop1, t.shop2].sort());
  const one = await t.asOwner.get(`/api/dashboard?outlet=${t.shop2}`);
  assert.deepEqual(one.body.byShop.map((s) => s.shopId), [t.shop2]);
  assert.equal((await t.asOwner.get(`/api/dashboard?outlet=${t.otherShop}`)).status, 403);
  const report = await t.asOwner.get(`/api/sales-report?outlet=${t.shop2}`);
  assert.equal(report.status, 200);
  assert.ok(report.body.items.every((i) => i.outlet === 'Second Shop'));
});

test('deactivating a shop: the HQ cannot be deactivated, another shop can and is no longer selectable', async () => {
  assert.equal((await t.asOwner.put(`/api/shops/${t.shop1}`, { active: false })).status, 400);
  const s3 = (await t.asOwner.post('/api/shops', { name: 'Pop-up', code: 'POP' })).body;
  assert.equal((await t.asOwner.put(`/api/shops/${s3.id}`, { active: false })).body.active, false);
  assert.equal((await t.asOwner.shop(s3.id).get('/api/orders')).status, 403);
  t.asOwner.shop(null);
});
