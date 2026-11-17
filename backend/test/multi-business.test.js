const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

test('POST /api/auth/register-business registers a business with 0 outlets initially', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Solo Bookshop Venture',
    ownerName: 'Solo Owner',
    username: 'solo_owner',
    password: 'password123',
    email: 'solo@example.com',
    outlets: [] // No outlets yet
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.business.name, 'Solo Bookshop Venture');
  assert.equal(res.body.user.username, 'solo_owner');
  assert.equal(res.body.user.role, 'owner');
  assert.equal(res.body.outlets.length, 0);
  assert.ok(res.body.token);

  // Authenticated owner can now add an outlet with distinct address
  const addShop = await client.post('/api/franchises', {
    name: 'First Street Flagship Store',
    city: 'Mumbai',
    address: '42 Marine Drive, Mumbai - 400 020',
    phone: '022-2288 1122',
    isHeadquarters: true
  });
  assert.equal(addShop.status, 201);
  assert.equal(addShop.body.name, 'First Street Flagship Store');
  assert.equal(addShop.body.city, 'Mumbai');

  // Can query its franchises
  const fr = await client.get('/api/franchises');
  assert.equal(fr.status, 200);
  assert.equal(fr.body.length, 1);
});

test('POST /api/auth/register-business registers a business with multiple outlets having distinct addresses', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Crossword Heritage Chains',
    ownerName: 'Vikram Patel',
    username: 'vpatel',
    password: 'Password123',
    email: 'vikram@crossword.example',
    phone: '+91 98765 00000',
    outlets: [
      { name: 'Crossword Flagship Kemps Corner', city: 'Mumbai', address: 'B Warden Road, Kemps Corner', isHeadquarters: true },
      { name: 'Crossword Bandra Branch', city: 'Mumbai', address: 'Linking Road, Bandra West', isHeadquarters: false }
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

  // Owner adds a 3rd shop with different address
  // Owner adds a 3rd shop with different address and custom code
  const shop3 = await client.post('/api/franchises', {
    name: 'Crossword Pune Pavilion',
    code: 'PUN-001',
    city: 'Pune',
    address: 'SB Road, Pune - 411 016',
    phone: '020-6600 4455'
  });
  assert.equal(shop3.status, 201);
  assert.equal(shop3.body.name, 'Crossword Pune Pavilion');
  assert.equal(shop3.body.code, 'PUN-001');
  assert.equal(shop3.body.address, 'SB Road, Pune - 411 016');
  assert.equal(shop3.body.phone, '020-6600 4455');

  const fr = await client.get('/api/franchises');
  assert.equal(fr.status, 200);
  assert.equal(fr.body.length, 3);
});

test('duplicate username in registration is rejected', async () => {
  const client = t.client();
  const res = await client.post('/api/auth/register-business', {
    businessName: 'Another Chain',
    ownerName: 'Another Owner',
    username: 'vpatel', // already taken above
    password: 'Password123',
    email: 'another@example.com',
    outlets: []
  });

  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /already taken/i);
});
