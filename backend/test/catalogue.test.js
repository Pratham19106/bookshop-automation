const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const VALID_ISBN13 = '9780306406157';
const VALID_ISBN10 = '0306406152';

test('book can be created with location, threshold and opening stock', async () => {
  const r = await t.asStaff.post('/api/books', {
    title: 'Dune', author: 'Frank Herbert', isbn: '978-0-306-40615-7', publisher: 'Ace', edition: '1st', genre: 'Sci-Fi',
    priceCents: 45000, lowStockThreshold: 3, aisle: 'A', rack: '2', shelf: '4', openingStock: 7,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.isbn, VALID_ISBN13); // hyphens stripped
  assert.equal(r.body.location, 'Aisle A · Rack 2 · Shelf 4');
  assert.equal(r.body.stockQty, 7);
  assert.equal(r.body.lowStockThreshold, 3);
  const moves = await t.asOwner.get(`/api/books/${r.body.id}/movements`);
  assert.equal(moves.body[0].reason, 'opening');
  assert.equal(moves.body[0].delta, 7);
});

test('duplicate ISBN is rejected with a clear message', async () => {
  const r = await t.asOwner.post('/api/books', { title: 'Another', author: 'X', isbn: VALID_ISBN13, priceCents: 100 });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /already belongs to "Dune"/);
});

test('invalid ISBN checksum is rejected; ISBN-10 is accepted', async () => {
  const bad = await t.asOwner.post('/api/books', { title: 'Bad', author: 'X', isbn: '9780306406158', priceCents: 100 });
  assert.equal(bad.status, 400);
  const ok = await t.asOwner.post('/api/books', { title: 'Ten', author: 'X', isbn: VALID_ISBN10, priceCents: 100 });
  assert.equal(ok.status, 201);
});

test('different editions are separate records with separate stock', async () => {
  const a = await t.addBook({ title: 'Algorithms', author: 'Cormen', edition: '3rd', openingStock: 4 });
  const b = await t.addBook({ title: 'Algorithms', author: 'Cormen', edition: '4th', openingStock: 9 });
  assert.notEqual(a.id, b.id);
  const found = await t.asStaff.get('/api/books?q=algorithms');
  assert.equal(found.body.total, 2);
  assert.deepEqual(found.body.items.map((i) => i.edition).sort(), ['3rd', '4th']);
  assert.equal(found.body.items.find((i) => i.edition === '3rd').stockQty, 4);
});

test('books without ISBN: same title/author/edition/publisher is a duplicate, a new edition is not', async () => {
  await t.asOwner.post('/api/books', { title: 'Local Poems', author: 'A. Poet', edition: '1st', publisher: 'Small Press', priceCents: 100 });
  const dup = await t.asOwner.post('/api/books', { title: 'local poems', author: 'a. poet', edition: '1st', publisher: 'small press', priceCents: 100 });
  assert.equal(dup.status, 409);
  const next = await t.asOwner.post('/api/books', { title: 'Local Poems', author: 'A. Poet', edition: '2nd', publisher: 'Small Press', priceCents: 100 });
  assert.equal(next.status, 201);
});

test('search matches title, author, ISBN (with or without hyphens) and partial text; ranks exact ISBN first', async () => {
  await t.addBook({ title: 'The Hobbit', author: 'J. R. R. Tolkien' });
  await t.addBook({ title: 'Tolkien: A Biography', author: 'Humphrey Carpenter' });
  assert.equal((await t.asStaff.get('/api/books?q=hobb')).body.total, 1);
  assert.equal((await t.asStaff.get('/api/books?q=tolkien')).body.total, 2);
  assert.equal((await t.asStaff.get('/api/books?q=tolkien%20hobbit')).body.total, 1); // all tokens must match
  assert.equal((await t.asStaff.get('/api/books?q=978-0-306-40615-7')).body.items[0].title, 'Dune');
  assert.equal((await t.asStaff.get('/api/books?q=0306406157')).body.items[0].title, 'Dune');
});

test('search treats SQL wildcards and quotes as plain text', async () => {
  const r = await t.asStaff.get(`/api/books?q=${encodeURIComponent("%' OR 1=1 --")}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 0);
  assert.equal((await t.asStaff.get('/api/books?q=%25')).body.total, 0);
});

test('search results carry location and availability for finding the book', async () => {
  await t.addBook({ title: 'Findable', aisle: 'C', rack: '9', shelf: '1', openingStock: 3 });
  const r = (await t.asStaff.get('/api/books?q=findable')).body.items[0];
  assert.equal(r.location, 'Aisle C · Rack 9 · Shelf 1');
  assert.equal(r.availableQty, 3);
});

test('validation: negative price, missing title, non-integer stock', async () => {
  assert.equal((await t.asOwner.post('/api/books', { title: 'X', author: 'Y', priceCents: -5 })).status, 400);
  assert.equal((await t.asOwner.post('/api/books', { author: 'Y', priceCents: 5 })).status, 400);
  assert.equal((await t.asOwner.post('/api/books', { title: 'X', author: 'Y', priceCents: 5, openingStock: 1.5 })).status, 400);
});

test('editing a book cannot change stock, and ISBN clashes are blocked on edit', async () => {
  const b = await t.addBook({ title: 'Editable', openingStock: 5 });
  const edited = await t.asStaff.put(`/api/books/${b.id}`, { title: 'Editable 2', author: 'Z', priceCents: 777, stockQty: 999 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.priceCents, 777);
  assert.equal(edited.body.stockQty, 5);
  const clash = await t.asStaff.put(`/api/books/${b.id}`, { title: 'Editable 2', author: 'Z', priceCents: 777, isbn: VALID_ISBN13 });
  assert.equal(clash.status, 409);
});

test('low-stock flag respects per-book and default thresholds', async () => {
  const lowCustom = await t.addBook({ title: 'Low custom', openingStock: 2, lowStockThreshold: 2 });
  const okCustom = await t.addBook({ title: 'Fine custom', openingStock: 3, lowStockThreshold: 2 });
  const lowDefault = await t.addBook({ title: 'Low default', openingStock: 5 }); // default threshold is 5
  const lowOnly = (await t.asStaff.get('/api/inventory?low=1')).body.map((b) => b.id);
  assert.ok(lowOnly.includes(lowCustom.id));
  assert.ok(lowOnly.includes(lowDefault.id));
  assert.ok(!lowOnly.includes(okCustom.id));
});

test('retiring a book hides it from search but keeps it findable when asked', async () => {
  const b = await t.addBook({ title: 'Retire me' });
  await t.asOwner.post(`/api/books/${b.id}/active`, { active: false });
  assert.equal((await t.asStaff.get('/api/books?q=retire%20me')).body.total, 0);
  assert.equal((await t.asStaff.get('/api/books?q=retire%20me&inactive=1')).body.total, 1);
});
