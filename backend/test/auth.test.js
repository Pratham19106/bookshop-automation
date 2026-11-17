const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

test('unauthenticated requests are rejected', async () => {
  const anon = t.client();
  assert.equal((await anon.get('/api/books')).status, 401);
  assert.equal((await anon.get('/api/dashboard')).status, 401);
});

test('wrong password and unknown user both give the same 401', async () => {
  const c = t.client();
  const a = await c.login('owner', 'nope-nope-1');
  const b = await c.login('ghost', 'nope-nope-1');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
});

test('passwords are stored hashed, never in plain text', async () => {
  const row = await t.db.one("SELECT password_hash FROM users WHERE username = 'owner'");
  assert.notEqual(row.password_hash, 'owner-pass-1');
  assert.match(row.password_hash, /^\$2[aby]\$/);
});

test('staff cannot reach owner-only endpoints', async () => {
  for (const path of ['/api/dashboard', '/api/restock', '/api/suppliers', '/api/purchase-orders', '/api/expenses', '/api/users']) {
    const r = await t.asStaff.get(path);
    assert.equal(r.status, 403, `${path} should be forbidden for staff`);
  }
  assert.equal((await t.asStaff.put('/api/settings', { shopName: 'Hacked' })).status, 403);
});

test('owner can reach owner-only endpoints', async () => {
  for (const path of ['/api/dashboard', '/api/restock', '/api/suppliers', '/api/purchase-orders', '/api/expenses', '/api/users']) {
    assert.equal((await t.asOwner.get(path)).status, 200, path);
  }
});

test('state-changing requests without the custom header are refused (CSRF guard)', async () => {
  const r = await fetch(`${t.base}/api/auth/logout`, { method: 'POST' });
  assert.equal(r.status, 403);
});

test('supplier cost is hidden from staff in catalogue responses', async () => {
  const book = await t.addBook();
  const owner = await t.asOwner.get(`/api/books/${book.id}`);
  const staff = await t.asStaff.get(`/api/books/${book.id}`);
  assert.ok('costCents' in owner.body);
  assert.ok(!('costCents' in staff.body));
});

test('logout invalidates the session', async () => {
  const c = t.client();
  await c.login('staff', 'staff-pass-1');
  assert.equal((await c.get('/api/auth/me')).status, 200);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('repeated failed logins are rate limited', async () => {
  const c = t.client();
  let last;
  for (let i = 0; i < 7; i++) last = await c.login('limited-user', 'wrong-password');
  assert.equal(last.status, 429);
});

test('deactivated users cannot sign in or keep their session', async () => {
  const created = await t.asOwner.post('/api/users', { username: 'temp', fullName: 'Temp', password: 'temp-pass-1', role: 'staff', shopIds: [t.shop1] });
  assert.equal(created.status, 201);
  const c = t.client();
  assert.equal((await c.login('temp', 'temp-pass-1')).status, 200);
  await t.asOwner.post(`/api/users/${created.body.id}/active`, { active: false });
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await t.client().login('temp', 'temp-pass-1')).status, 401);
});

test('the last active owner cannot be deactivated', async () => {
  const me = (await t.asOwner.get('/api/auth/me')).body.user;
  const r = await t.asOwner.post(`/api/users/${me.id}/active`, { active: false });
  assert.equal(r.status, 400);
});
