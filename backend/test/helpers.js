const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const users = require('../src/services/users');

// Fresh in-memory database + running HTTP server on an ephemeral port, with ready-made owner/staff clients.
async function setup({ tz = 0 } = {}) {
  const db = openDatabase(':memory:');
  users.createUser(db, { username: 'owner', fullName: 'Olivia Owner', password: 'owner-pass-1', role: 'owner' });
  users.createUser(db, { username: 'staff', fullName: 'Sam Staff', password: 'staff-pass-1', role: 'staff' });
  const server = await new Promise((resolve) => { const s = createApp(db, { tzOffsetMinutes: tz }).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bookshop', ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set && set.startsWith('sid=')) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
      return { status: res.status, body: json, text, headers: Object.fromEntries(res.headers.entries()) };
    };
    return {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      put: (p, b) => call('PUT', p, b),
      del: (p) => call('DELETE', p),
      raw: call,
      login: async (username, password) => call('POST', '/api/auth/login', { username, password }),
    };
  }
  const asOwner = client();
  const asStaff = client();
  await asOwner.login('owner', 'owner-pass-1');
  await asStaff.login('staff', 'staff-pass-1');

  let n = 0;
  // Create a book directly via the API as owner; returns the book JSON.
  async function addBook(overrides = {}) {
    n += 1;
    const res = await asOwner.post('/api/books', {
      title: `Book ${n}`, author: 'Some Author', priceCents: 10000, openingStock: 10, ...overrides,
    });
    if (res.status !== 201) throw new Error(`addBook failed: ${res.text}`);
    return res.body;
  }

  return {
    db, base, asOwner, asStaff, client, addBook,
    stock: (id) => db.prepare('SELECT stock_qty s, reserved_qty r FROM books WHERE id = ?').get(id),
    close: () => new Promise((r) => server.close(() => { db.close(); r(); })),
  };
}

module.exports = { setup };
