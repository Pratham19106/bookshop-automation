const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

test('POST /api/auth/register-business rejects registration with fewer than 2 outlets', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Solo Bookshop',
    ownerName: 'Solo Owner',
    username: 'solo_owner',
    password: 'password123',
    email: 'solo@example.com',
    outlets: [
      { name: 'Only One Outlet', city: 'Mumbai', address: 'Street 1' }
    ]
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /minimum of 2 outlets/i);
});

test('POST /api/auth/register-business registers a new bookshop chain with >= 2 outlets and signs in', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Crossword Heritage Chains',
    ownerName: 'Vikram Patel',
    username: 'vpatel',
    password: 'Password123',
    email: 'vikram@crossword.example',
    phone: '+91 98765 00000',
    outlets: [
      { name: 'Crossword Flagship Kemps Corner', city: 'Mumbai', address: 'B Warden Road', isHeadquarters: true },
      { name: 'Crossword Bandra Branch', city: 'Mumbai', address: 'Linking Road', isHeadquarters: false }
    ]
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.business.name, 'Crossword Heritage Chains');
  assert.equal(res.body.user.username, 'vpatel');
  assert.equal(res.body.user.role, 'owner');
  assert.equal(res.body.outlets.length, 2);
  assert.ok(res.body.token);

  // Authenticated state is preserved through the session cookie
  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'vpatel');
  assert.equal(me.body.user.business.name, 'Crossword Heritage Chains');
  assert.equal(me.body.user.franchises.length, 2);

  // Can query its franchises
  const fr = await client.get('/api/franchises');
  assert.equal(fr.status, 200);
  assert.equal(fr.body.length, 2);
});

test('duplicate username in registration is rejected', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Another Chain',
    ownerName: 'Another Owner',
    username: 'vpatel', // already taken above
    password: 'Password123',
    email: 'another@example.com',
    outlets: [
      { name: 'Branch 1', city: 'Delhi' },
      { name: 'Branch 2', city: 'Delhi' }
    ]
  });

  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /already taken/i);
});
