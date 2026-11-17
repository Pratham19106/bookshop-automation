const crypto = require('node:crypto');
const config = require('../src/config');
const { createDb } = require('../src/db');
const { migrate } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const users = require('../src/services/users');

/*
 * Each test file gets a fresh, isolated Postgres schema (t_<random>) in TEST_DATABASE_URL (falls back to
 * DATABASE_URL), migrated from supabase/migrations, plus a running HTTP server on an ephemeral port.
 * Use a direct / session-pooler connection string (port 5432) for tests: search_path is set per connection.
 *
 * Seeded tenant: business "Test Books" with shops S01 (HQ) and S02, and logins
 *   owner / owner-pass-1      (owner, every shop)
 *   manager / manager-pass-1  (manager, S01 + S02)
 *   staff / staff-pass-1      (staff, S01 only)
 *   staff2 / staff-pass-2     (staff, S02 only)
 * plus a second, unrelated business "Other Books" (owner `other` / other-pass-1) for isolation tests.
 */
async function setup({ tz = 0 } = {}) {
  if (!config.testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) in backend/.env to run the tests.');
  const schema = `t_${crypto.randomBytes(5).toString('hex')}`;
  const db = createDb({ connectionString: config.testDatabaseUrl, schema, max: 5 });
  await migrate(db);

  const reg = await users.registerBusiness(db, {
    businessName: 'Test Books', ownerName: 'Olivia Owner', username: 'owner', password: 'owner-pass-1', email: 'o@test.example',
    shops: [{ name: 'Main Shop', code: 'S01', isHq: true }, { name: 'Second Shop', code: 'S02' }],
  });
  const businessId = reg.business.id;
  const [shop1, shop2] = reg.shops.map((s) => s.id);
  const ownerRow = await db.one('SELECT * FROM users WHERE username = $1', ['owner']);
  const ownerCtx = { db, user: ownerRow, businessId, shopIds: [shop1, shop2], shopId: shop1, tz };
  await users.createUser(ownerCtx, { username: 'manager', fullName: 'Max Manager', password: 'manager-pass-1', role: 'manager', shopIds: [shop1, shop2] });
  await users.createUser(ownerCtx, { username: 'staff', fullName: 'Sam Staff', password: 'staff-pass-1', role: 'staff', shopIds: [shop1] });
  await users.createUser(ownerCtx, { username: 'staff2', fullName: 'Sia Staff', password: 'staff-pass-2', role: 'staff', shopIds: [shop2] });
  const other = await users.registerBusiness(db, {
    businessName: 'Other Books', ownerName: 'Oscar Other', username: 'other', password: 'other-pass-1', email: 'x@test.example',
  });

  const server = await new Promise((resolve) => { const s = createApp(db, { tzOffsetMinutes: tz }).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  // HTTP client with its own cookie jar. shop(id) sets the X-Shop-Id header for later calls.
  function client() {
    let cookie = '';
    let shopId = null;
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json', 'X-Requested-With': 'bookshop',
          ...(cookie ? { Cookie: cookie } : {}), ...(shopId ? { 'X-Shop-Id': String(shopId) } : {}), ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set && set.startsWith('sid=')) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
      return { status: res.status, body: json, text, headers: Object.fromEntries(res.headers.entries()) };
    };
    const c = {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      put: (p, b) => call('PUT', p, b),
      del: (p) => call('DELETE', p),
      raw: call,
      login: async (username, password) => call('POST', '/api/auth/login', { username, password }),
      shop: (id) => { shopId = id; return c; },
      // Open the live-update stream; returns { events, waitFor(pred), close() }. Close it before the test ends.
      stream: async () => {
        const ac = new AbortController();
        const res = await fetch(`${base}/api/events`, { headers: cookie ? { Cookie: cookie } : {}, signal: ac.signal });
        const events = [];
        const out = {
          status: res.status, events,
          close: () => ac.abort(),
          waitFor: async (pred, ms = 5000) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
              const hit = events.find(pred);
              if (hit) return hit;
              await new Promise((r) => setTimeout(r, 25));
            }
            return null;
          },
        };
        if (res.ok) {
          (async () => {
            const decoder = new TextDecoder();
            let buf = '';
            try {
              for await (const chunk of res.body) {
                buf += decoder.decode(chunk, { stream: true });
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                  const block = buf.slice(0, i); buf = buf.slice(i + 2);
                  const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
                  if (data) events.push(JSON.parse(data));
                }
              }
            } catch { /* aborted */ }
          })();
        }
        return out;
      },
    };
    return c;
  }
  const signedIn = async (u, p) => { const c = client(); await c.login(u, p); return c; };
  const asOwner = await signedIn('owner', 'owner-pass-1');
  const asManager = await signedIn('manager', 'manager-pass-1');
  const asStaff = await signedIn('staff', 'staff-pass-1');
  const asStaff2 = await signedIn('staff2', 'staff-pass-2');
  const asOther = await signedIn('other', 'other-pass-1');

  let n = 0;
  // Create a book in shop 1 via the API as owner; returns the book JSON.
  async function addBook(overrides = {}, as = asOwner) {
    n += 1;
    const res = await as.post('/api/books', { title: `Book ${n}`, author: 'Some Author', priceCents: 10000, openingStock: 10, ...overrides });
    if (res.status !== 201) throw new Error(`addBook failed: ${res.text}`);
    return res.body;
  }

  // Service-level context for white-box tests: ctx(username, shopId?) mirrors what app.js builds per request.
  async function ctx(username, shopId) {
    const user = await db.one('SELECT * FROM users WHERE username = $1', [username]);
    const shops = await users.shopsForUser(db, user, { includeInactive: user.role === 'owner' });
    const shopIds = shops.map((s) => s.id);
    return { db, user, businessId: user.business_id, shopIds, shopId: shopId ?? shopIds[0], tz };
  }

  return {
    db, base, schema, businessId, shop1, shop2, otherBusinessId: other.business.id, otherShop: other.shops[0].id,
    asOwner, asManager, asStaff, asStaff2, asOther, client, signedIn, addBook, ctx,
    // Stock of a book in a shop (default shop 1): { s: stock, r: reserved }.
    stock: async (bookId, shopId = shop1) => {
      const row = await db.one('SELECT stock_qty AS s, reserved_qty AS r FROM shop_stock WHERE book_id = $1 AND shop_id = $2', [bookId, shopId]);
      return row || { s: 0, r: 0 };
    },
    close: async () => {
      await new Promise((r) => server.close(r));
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.close();
    },
  };
}

module.exports = { setup };
