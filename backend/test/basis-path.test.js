const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const users = require('../src/services/users');
const sales = require('../src/services/sales');
const orders = require('../src/services/orders');
const inventory = require('../src/services/inventory');

// White-box basis-path tests (see the project report). Services are called directly with the same request
// context (ctx) that app.js builds: { db, user, businessId, shopIds, shopId, tz }.

let t;
let ownerCtx;
let staffCtx;

before(async () => {
  t = await setup();
  ownerCtx = await t.ctx('owner', t.shop1);
  staffCtx = await t.ctx('staff', t.shop1);
});

after(async () => {
  await t.close();
});

const stock = (id) => t.stock(id, t.shop1);

// ============================================================================
// MODULE 1A: User Authentication (users.login)
// ============================================================================
test('Module 1A - Basis Path Testing: users.login', async (suite) => {
  await suite.test('TC-BPT-A1 (Path A1): Missing or empty password', async () => {
    await assert.rejects(
      users.login(t.db, { username: 'owner', password: '' }, '127.0.0.1'),
      (err) => err.status === 400 && /password is required/.test(err.message),
    );
  });

  await suite.test('TC-BPT-A2 (Path A2): Exceeded rate limit (brute force lockout)', async () => {
    const ip = '10.0.0.99';
    const uname = 'brute_target';
    for (let i = 0; i < 5; i++) {
      await users.login(t.db, { username: uname, password: 'wrongpassword' }, ip).catch(() => {});
    }
    // 6th attempt must trigger rate limit (429)
    await assert.rejects(
      users.login(t.db, { username: uname, password: 'anypassword' }, ip),
      (err) => err.status === 429 && /Too many failed sign-in attempts/.test(err.message),
    );
  });

  await suite.test('TC-BPT-A3 (Path A3): Invalid credentials (wrong password)', async () => {
    await assert.rejects(
      users.login(t.db, { username: 'owner', password: 'incorrect_password' }, '127.0.0.2'),
      (err) => err.status === 401 && /Invalid username or password/.test(err.message),
    );
  });

  await suite.test('TC-BPT-A4 (Path A4): Valid credentials for active user -> session token issued', async () => {
    const res = await users.login(t.db, { username: 'owner', password: 'owner-pass-1' }, '127.0.0.3');
    assert.ok(res.token && typeof res.token === 'string');
    assert.equal(res.user.username, 'owner');
    assert.equal(res.user.role, 'owner');
    assert.equal(res.user.active, true);
    assert.equal(res.user.shops.length, 2); // the owner works across every shop of the business
  });

  await suite.test('TC-BPT-A5 (Structural): Non-existent username', async () => {
    await assert.rejects(
      users.login(t.db, { username: 'nonexistent_user', password: 'somepassword' }, '127.0.0.4'),
      (err) => err.status === 401 && /Invalid username or password/.test(err.message),
    );
  });

  await suite.test('TC-BPT-A6 (Structural): Inactive user blocked from login', async () => {
    const u = await users.createUser(ownerCtx, { username: 'disabled_user', fullName: 'Disabled User', password: 'valid-pass-123', role: 'staff', shopIds: [t.shop1] });
    await t.db.query('UPDATE users SET active = false WHERE id = $1', [u.id]);
    await assert.rejects(
      users.login(t.db, { username: 'disabled_user', password: 'valid-pass-123' }, '127.0.0.5'),
      (err) => err.status === 401 && /Invalid username or password/.test(err.message),
    );
  });
});

// ============================================================================
// MODULE 1B: Role-Based Authorization Gate (userForToken & RBAC)
// ============================================================================
test('Module 1B - Basis Path Testing: Authorization Gate', async (suite) => {
  await suite.test('TC-BPT-B1 (Path B1): Null or undefined token header', async () => {
    assert.equal(await users.userForToken(t.db, null), null);
  });

  await suite.test('TC-BPT-B2 (Path B2): Unknown or expired token', async () => {
    assert.equal(await users.userForToken(t.db, 'deadbeef'.repeat(8)), null);
  });

  await suite.test('TC-BPT-B3 (Path B3): Staff user blocked at Owner-restricted API', async () => {
    const res = await t.asStaff.get('/api/users');
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /limited to the business owner/);
  });

  await suite.test('TC-BPT-B4 (Path B4): Owner user granted access to Owner-restricted API', async () => {
    const res = await t.asOwner.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.summary !== undefined);
  });

  await suite.test('TC-BPT-B5 (Structural): Active session lookup returns valid authenticated user', async () => {
    const loginRes = await users.login(t.db, { username: 'staff', password: 'staff-pass-1' }, '127.0.0.6');
    const u = await users.userForToken(t.db, loginRes.token);
    assert.ok(u);
    assert.equal(u.username, 'staff');
    assert.equal(u.role, 'staff');
  });

  await suite.test('TC-BPT-B6 (Structural): Manager sits between staff and owner', async () => {
    assert.equal((await t.asManager.get('/api/suppliers')).status, 200);
    const res = await t.asManager.get('/api/users');
    assert.equal(res.status, 403);
  });
});

// ============================================================================
// MODULE 2: Sales & Inventory Deduction Engine (sales.createSale)
// ============================================================================
test('Module 2 - Basis Path Testing: sales.createSale', async (suite) => {
  let bookAlpha;
  let bookBeta;

  await suite.test('Setup books for Module 2 tests', async () => {
    bookAlpha = await t.addBook({ title: 'Algorithmic Systems', priceCents: 50000, openingStock: 10 });
    bookBeta = await t.addBook({ title: 'Distributed Kernels', priceCents: 80000, openingStock: 5 });
  });

  await suite.test('TC-BPT-C01 (Path C1): Idempotency key replay returns cached sale', async () => {
    const key = 'idem-unique-key-101';
    const s1 = await sales.createSale(ownerCtx, { items: [{ bookId: bookAlpha.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: key });
    assert.equal(s1.duplicate, false);
    const s2 = await sales.createSale(ownerCtx, { items: [{ bookId: bookAlpha.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: key });
    assert.equal(s2.duplicate, true);
    assert.equal(s1.sale.id, s2.sale.id);
  });

  await suite.test('TC-BPT-C02 (Path C2): Staff discount barrier (exceeds max threshold)', async () => {
    // Default staff ceiling is 10%
    await assert.rejects(
      sales.createSale(staffCtx, { items: [{ bookId: bookAlpha.id, quantity: 1 }], discountPercent: 15, paymentMethod: 'cash' }),
      (err) => err.status === 403 && /Staff may give at most/.test(err.message),
    );
  });

  await suite.test('TC-BPT-C03 (Path C3): Non-existent book ID in cart', async () => {
    await assert.rejects(
      sales.createSale(staffCtx, { items: [{ bookId: 999999, quantity: 1 }], paymentMethod: 'cash' }),
      (err) => err.status === 404 && /Book #999999/.test(err.message),
    );
  });

  await suite.test('TC-BPT-C04 (Path C4): Inactive / discontinued book', async () => {
    await t.db.query('UPDATE books SET active = false WHERE id = $1', [bookBeta.id]);
    try {
      await assert.rejects(
        sales.createSale(staffCtx, { items: [{ bookId: bookBeta.id, quantity: 1 }], paymentMethod: 'cash' }),
        (err) => err.status === 400 && /no longer sold/.test(err.message),
      );
    } finally {
      await t.db.query('UPDATE books SET active = true WHERE id = $1', [bookBeta.id]);
    }
  });

  await suite.test('TC-BPT-C05 (Path C5): Stock deficit check (requested > available)', async () => {
    await assert.rejects(
      sales.createSale(staffCtx, { items: [{ bookId: bookBeta.id, quantity: 999 }], paymentMethod: 'cash' }),
      (err) => err.status === 409 && /Insufficient stock/.test(err.message),
    );
  });

  await suite.test('TC-BPT-C06 (Path C6): Valid sale with staff within discount limit', async () => {
    const beforeStock = (await stock(bookAlpha.id)).s;
    const res = await sales.createSale(staffCtx, {
      items: [{ bookId: bookAlpha.id, quantity: 2 }], discountPercent: 5, paymentMethod: 'upi', customerName: 'Aarav Patel',
    });
    assert.equal(res.duplicate, false);
    assert.equal(res.sale.customerName, 'Aarav Patel');
    assert.equal(res.sale.paymentMethod, 'upi');
    assert.equal((await stock(bookAlpha.id)).s, beforeStock - 2);
  });

  await suite.test('TC-BPT-C07 (Structural): Owner discount exempt from staff discount limit', async () => {
    const res = await sales.createSale(ownerCtx, { items: [{ bookId: bookAlpha.id, quantity: 1 }], discountPercent: 50, paymentMethod: 'card' });
    assert.equal(res.sale.discountPercent, 50);
  });

  await suite.test('TC-BPT-C08 (Structural): Multi-item purchase loop verification', async () => {
    const res = await sales.createSale(ownerCtx, {
      items: [{ bookId: bookAlpha.id, quantity: 1 }, { bookId: bookBeta.id, quantity: 1 }], paymentMethod: 'cash',
    });
    assert.equal(res.sale.items.length, 2);
  });

  await suite.test('TC-BPT-C09 (Structural): Reserved stock boundary evaluation', async () => {
    // Reserve 3 copies of bookBeta (as a phone order would)
    await t.db.query('UPDATE shop_stock SET reserved_qty = 3 WHERE book_id = $1 AND shop_id = $2', [bookBeta.id, t.shop1]);
    try {
      const b = await stock(bookBeta.id);
      const avail = b.s - b.r;
      await assert.rejects(
        sales.createSale(ownerCtx, { items: [{ bookId: bookBeta.id, quantity: avail + 1 }], paymentMethod: 'cash' }),
        (err) => err.status === 409 && /reserved for phone orders/.test(err.message),
      );
    } finally {
      await t.db.query('UPDATE shop_stock SET reserved_qty = 0 WHERE book_id = $1 AND shop_id = $2', [bookBeta.id, t.shop1]);
    }
  });

  await suite.test('TC-BPT-C10 (Structural): Duplicate book in items list merged into single line', async () => {
    const beforeStock = (await stock(bookAlpha.id)).s;
    await sales.createSale(ownerCtx, {
      items: [{ bookId: bookAlpha.id, quantity: 1 }, { bookId: bookAlpha.id, quantity: 2 }], paymentMethod: 'cash',
    });
    assert.equal((await stock(bookAlpha.id)).s, beforeStock - 3);
  });

  await suite.test('TC-BPT-C11 (Structural): A shop the user is not assigned to is refused', async () => {
    await assert.rejects(
      sales.createSale({ ...staffCtx, shopId: null }, { items: [{ bookId: bookAlpha.id, quantity: 1 }], paymentMethod: 'cash' }),
      (err) => err.status === 403,
    );
  });
});

// ============================================================================
// MODULE 3: Order Lifecycle Gate (orders.setStatus & cancelOrder)
// ============================================================================
test('Module 3 - Basis Path Testing: orders.setStatus & Lifecycle', async (suite) => {
  let testBook;
  let pickupOrder;
  let deliveryOrder;

  await suite.test('Setup orders for Module 3 tests', async () => {
    testBook = await t.addBook({ title: 'Microkernel Arch', priceCents: 30000, openingStock: 20 });
    pickupOrder = await orders.createOrder(staffCtx, {
      customerName: 'Priya Sharma', customerPhone: '9820011223', deliveryType: 'pickup', items: [{ bookId: testBook.id, quantity: 2 }],
    });
    deliveryOrder = await orders.createOrder(staffCtx, {
      customerName: 'Devendra Joshi', customerPhone: '9820044556', deliveryType: 'delivery', deliveryAddress: '402 Sunset Tower, Mumbai',
      items: [{ bookId: testBook.id, quantity: 3 }],
    });
  });

  await suite.test('TC-BPT-S1 (Path S1): Non-existent order ID', async () => {
    await assert.rejects(orders.setStatus(staffCtx, 999999, { status: 'ready' }), (err) => err.status === 404 && /Order/.test(err.message));
  });

  await suite.test('TC-BPT-S2 (Path S2): Illegal status transition (placed -> out_for_delivery)', async () => {
    await assert.rejects(
      orders.setStatus(staffCtx, pickupOrder.id, { status: 'out_for_delivery' }),
      (err) => err.status === 409 && /Cannot move an order from "placed" to "out for delivery"/.test(err.message),
    );
  });

  await suite.test('TC-BPT-S3 (Path S3): Out for delivery blocked on pickup order', async () => {
    await orders.setStatus(staffCtx, pickupOrder.id, { status: 'ready' });
    await assert.rejects(
      orders.setStatus(staffCtx, pickupOrder.id, { status: 'out_for_delivery' }),
      (err) => err.status === 409 && /Only delivery orders can be sent out for delivery/.test(err.message),
    );
  });

  await suite.test('TC-BPT-S4 (Path S4): Valid transition (placed -> ready -> out_for_delivery)', async () => {
    assert.equal((await orders.setStatus(staffCtx, deliveryOrder.id, { status: 'ready' })).status, 'ready');
    assert.equal((await orders.setStatus(staffCtx, deliveryOrder.id, { status: 'out_for_delivery' })).status, 'out_for_delivery');
  });

  await suite.test('TC-BPT-S5 (Structural): Order cancellation releases reserved stock', async () => {
    const beforeReserved = (await stock(testBook.id)).r;
    const ord = await orders.createOrder(staffCtx, {
      customerName: 'Anil Mehta', customerPhone: '9820099887', deliveryType: 'pickup', items: [{ bookId: testBook.id, quantity: 4 }],
    });
    assert.equal((await stock(testBook.id)).r, beforeReserved + 4);
    await orders.cancelOrder(staffCtx, ord.id, { reason: 'Customer changed mind' });
    assert.equal((await stock(testBook.id)).r, beforeReserved);
  });

  await suite.test('TC-BPT-S6 (Structural): Re-cancellation of already cancelled order rejected', async () => {
    const ord = await orders.createOrder(staffCtx, {
      customerName: 'Sunita Rao', customerPhone: '9820077665', deliveryType: 'pickup', items: [{ bookId: testBook.id, quantity: 1 }],
    });
    await orders.cancelOrder(staffCtx, ord.id, { reason: 'Initial cancel' });
    await assert.rejects(
      orders.cancelOrder(staffCtx, ord.id, { reason: 'Second cancel' }),
      (err) => err.status === 409 && /already cancelled/.test(err.message),
    );
  });
});

// ============================================================================
// SYSTEM REGRESSION SUITE: Quality Assurance (TC-01 to TC-12)
// ============================================================================
test('System Regression Suite: Quality Assurance (TC-01 to TC-12)', async (suite) => {
  let regBook;

  await suite.test('TC-01: Catalogue CRUD relational integrity', async () => {
    regBook = await t.addBook({ title: 'Operating Systems Conc', author: 'Silberschatz', priceCents: 45000, openingStock: 15 });
    assert.equal(regBook.title, 'Operating Systems Conc');
    assert.equal(regBook.stockQty, 15);
  });

  await suite.test('TC-02: Negative stock prevention constraint', async () => {
    await assert.rejects(
      ownerCtx.db.tx((q) => inventory.applyStock(q, ownerCtx, { bookId: regBook.id, stockDelta: -999, reason: 'adjustment' })),
      (err) => err.status === 409 && /Insufficient stock/.test(err.message),
    );
  });

  await suite.test('TC-03: Idempotent sale generation determinism', async () => {
    const res1 = await sales.createSale(ownerCtx, { items: [{ bookId: regBook.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: 'reg-idem-1' });
    const res2 = await sales.createSale(ownerCtx, { items: [{ bookId: regBook.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: 'reg-idem-1' });
    assert.equal(res1.sale.id, res2.sale.id);
    assert.equal(res2.duplicate, true);
  });

  await suite.test('TC-04: Staff discount ceiling enforcement (10%)', async () => {
    await assert.rejects(
      sales.createSale(staffCtx, { items: [{ bookId: regBook.id, quantity: 1 }], discountPercent: 12, paymentMethod: 'cash' }),
      (err) => err.status === 403,
    );
  });

  await suite.test('TC-05: Phone order reservation barrier', async () => {
    const ord = await orders.createOrder(staffCtx, {
      customerName: 'Reg Cust', customerPhone: '9800012345', deliveryType: 'pickup', items: [{ bookId: regBook.id, quantity: 5 }],
    });
    assert.ok(ord.id > 0);
    assert.equal((await stock(regBook.id)).r, 5);
  });

  await suite.test('TC-06: Phone order fulfilment deducts reserved stock', async () => {
    const ord = await orders.createOrder(staffCtx, {
      customerName: 'Fulfil Cust', customerPhone: '9800054321', deliveryType: 'pickup', items: [{ bookId: regBook.id, quantity: 2 }],
    });
    await orders.setStatus(staffCtx, ord.id, { status: 'ready' });
    const before = await stock(regBook.id);
    await orders.fulfilOrder(staffCtx, ord.id, { paymentMethod: 'cash' });
    const after = await stock(regBook.id);
    assert.equal(after.s, before.s - 2);
    assert.equal(after.r, before.r - 2);
  });

  await suite.test('TC-07: Low stock threshold calculation', async () => {
    const overview = await inventory.stockOverview(ownerCtx, { lowOnly: false });
    assert.ok(overview.length > 0);
    const target = overview.find((b) => b.id === regBook.id);
    assert.ok(target !== undefined);
    assert.equal(target.isLowStock, target.availableQty <= target.threshold);
  });

  await suite.test('TC-08: Stock adjustment audit note logging', async () => {
    await inventory.adjustStock(ownerCtx, regBook.id, { countedQty: 25, reason: 'Physical inventory recount' });
    const moves = await inventory.movements(ownerCtx, regBook.id, 5);
    assert.equal(moves[0].reason, 'adjustment');
    assert.equal(moves[0].note, 'Physical inventory recount');
  });

  await suite.test('TC-09: Voiding sale restores inventory', async () => {
    const before = (await stock(regBook.id)).s;
    const made = await sales.createSale(staffCtx, { items: [{ bookId: regBook.id, quantity: 3 }], paymentMethod: 'cash' });
    assert.equal((await stock(regBook.id)).s, before - 3);
    await sales.voidSale(ownerCtx, made.sale.id, { reason: 'Customer returned book' });
    assert.equal((await stock(regBook.id)).s, before);
  });

  await suite.test('TC-10: Re-voiding already voided sale rejected (409)', async () => {
    const made = await sales.createSale(staffCtx, { items: [{ bookId: regBook.id, quantity: 1 }], paymentMethod: 'cash' });
    await sales.voidSale(ownerCtx, made.sale.id, { reason: 'First void' });
    await assert.rejects(
      sales.voidSale(ownerCtx, made.sale.id, { reason: 'Second void' }),
      (err) => err.status === 409 && /already been voided/.test(err.message),
    );
  });

  await suite.test('TC-11: Revenue computation discount and tax arithmetic', () => {
    const { computeTotals } = require('../src/lib/money');
    const res = computeTotals([{ unitPriceCents: 10000, quantity: 2 }], 1000, 500); // 10% disc, 5% tax
    assert.equal(res.subtotalCents, 20000);
    assert.equal(res.discountCents, 2000);
    assert.equal(res.taxCents, 900); // 5% of 18000
    assert.equal(res.totalCents, 18900);
  });

  await suite.test('TC-12: Cash memo HTML generation format validation', () => {
    const { renderBillHtml } = require('../src/services/billPrinter');
    const mockSale = {
      id: 99, billNo: 'INV-S01-000099', paymentMethod: 'cash', customerName: 'Regression Tester',
      items: [{ title: 'Design Patterns', quantity: 1, unitPriceCents: 15000, lineTotalCents: 15000 }],
      totalCents: 15000, subtotalCents: 15000,
    };
    const html = renderBillHtml(mockSale, { shopName: 'PRATHAM BOOKSHOP' });
    assert.match(html, /PRATHAM BOOKSHOP/);
    assert.match(html, /CASH PAID/);
    assert.match(html, /INV-S01-000099/);
    assert.match(html, /TOTAL/);
  });
});
