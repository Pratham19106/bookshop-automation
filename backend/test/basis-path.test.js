const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const users = require('../src/services/users');
const sales = require('../src/services/sales');
const orders = require('../src/services/orders');
const inventory = require('../src/services/inventory');
const { getSettings } = require('../src/services/settings');

let t;
let ownerUser;
let staffUser;

before(async () => {
  t = await setup();
  ownerUser = t.db.prepare("SELECT * FROM users WHERE username = 'owner'").get();
  staffUser = t.db.prepare("SELECT * FROM users WHERE username = 'staff'").get();
});

after(async () => {
  await t.close();
});

// ============================================================================
// MODULE 1A: User Authentication (users.login)
// ============================================================================
test('Module 1A - Basis Path Testing: users.login', async (suite) => {
  await suite.test('TC-BPT-A1 (Path A1): Missing or empty password', () => {
    assert.throws(
      () => users.login(t.db, { username: 'owner', password: '' }, '127.0.0.1'),
      (err) => err.status === 400 && /password is required/.test(err.message)
    );
  });

  await suite.test('TC-BPT-A2 (Path A2): Exceeded rate limit (brute force lockout)', () => {
    const ip = '10.0.0.99';
    const uname = 'brute_target';
    // Trigger 5 failures
    for (let i = 0; i < 5; i++) {
      try { users.login(t.db, { username: uname, password: 'wrongpassword' }, ip); } catch {}
    }
    // 6th attempt must trigger rate limit (429)
    assert.throws(
      () => users.login(t.db, { username: uname, password: 'anypassword' }, ip),
      (err) => err.status === 429 && /Too many failed sign-in attempts/.test(err.message)
    );
  });

  await suite.test('TC-BPT-A3 (Path A3): Invalid credentials (wrong password)', () => {
    assert.throws(
      () => users.login(t.db, { username: 'owner', password: 'incorrect_password' }, '127.0.0.2'),
      (err) => err.status === 401 && /Invalid username or password/.test(err.message)
    );
  });

  await suite.test('TC-BPT-A4 (Path A4): Valid credentials for active user -> session token issued', () => {
    const res = users.login(t.db, { username: 'owner', password: 'owner-pass-1' }, '127.0.0.3');
    assert.ok(res.token && typeof res.token === 'string');
    assert.equal(res.user.username, 'owner');
    assert.equal(res.user.role, 'owner');
    assert.equal(res.user.active, true);
  });

  // Additional structural decisions:
  await suite.test('TC-BPT-A5 (Structural): Non-existent username', () => {
    assert.throws(
      () => users.login(t.db, { username: 'nonexistent_user', password: 'somepassword' }, '127.0.0.4'),
      (err) => err.status === 401 && /Invalid username or password/.test(err.message)
    );
  });

  await suite.test('TC-BPT-A6 (Structural): Inactive user blocked from login', () => {
    users.createUser(t.db, { username: 'disabled_user', fullName: 'Disabled User', password: 'valid-pass-123', role: 'staff' });
    const u = t.db.prepare("SELECT id FROM users WHERE username = 'disabled_user'").get();
    t.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(u.id);

    assert.throws(
      () => users.login(t.db, { username: 'disabled_user', password: 'valid-pass-123' }, '127.0.0.5'),
      (err) => err.status === 401 && /Invalid username or password/.test(err.message)
    );
  });
});

// ============================================================================
// MODULE 1B: Role-Based Authorization Gate (userForToken & RBAC)
// ============================================================================
test('Module 1B - Basis Path Testing: Authorization Gate', async (suite) => {
  await suite.test('TC-BPT-B1 (Path B1): Null or undefined token header', () => {
    const u = users.userForToken(t.db, null);
    assert.equal(u, null);
  });

  await suite.test('TC-BPT-B2 (Path B2): Unknown or expired token', () => {
    const u = users.userForToken(t.db, 'deadbeef'.repeat(8));
    assert.equal(u, null);
  });

  await suite.test('TC-BPT-B3 (Path B3): Staff user blocked at Owner-restricted API', async () => {
    // Attempting to access an owner-only endpoint (e.g. GET /api/dashboard) as staff
    const res = await t.asStaff.get('/api/dashboard');
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /limited to the shop owner/);
  });

  await suite.test('TC-BPT-B4 (Path B4): Owner user granted access to Owner-restricted API', async () => {
    const res = await t.asOwner.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.summary !== undefined);
  });

  await suite.test('TC-BPT-B5 (Structural): Active session lookup returns valid authenticated user', () => {
    const loginRes = users.login(t.db, { username: 'staff', password: 'staff-pass-1' }, '127.0.0.6');
    const u = users.userForToken(t.db, loginRes.token);
    assert.ok(u);
    assert.equal(u.username, 'staff');
    assert.equal(u.role, 'staff');
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

  await suite.test('TC-BPT-C01 (Path C1): Idempotency key replay returns cached sale', () => {
    const key = 'idem-unique-key-101';
    const s1 = sales.createSale(t.db, ownerUser, {
      items: [{ bookId: bookAlpha.id, quantity: 1 }],
      paymentMethod: 'cash',
      idempotencyKey: key
    });
    assert.equal(s1.duplicate, false);

    const s2 = sales.createSale(t.db, ownerUser, {
      items: [{ bookId: bookAlpha.id, quantity: 1 }],
      paymentMethod: 'cash',
      idempotencyKey: key
    });
    assert.equal(s2.duplicate, true);
    assert.equal(s1.sale.id, s2.sale.id);
  });

  await suite.test('TC-BPT-C02 (Path C2): Staff discount barrier (exceeds max threshold)', () => {
    // Default staffMaxDiscount is 10%
    assert.throws(
      () => sales.createSale(t.db, staffUser, {
        items: [{ bookId: bookAlpha.id, quantity: 1 }],
        discountPercent: 15,
        paymentMethod: 'cash'
      }),
      (err) => err.status === 403 && /Staff may give at most/.test(err.message)
    );
  });

  await suite.test('TC-BPT-C03 (Path C3): Non-existent book ID in cart', () => {
    assert.throws(
      () => sales.createSale(t.db, staffUser, {
        items: [{ bookId: 999999, quantity: 1 }],
        paymentMethod: 'cash'
      }),
      (err) => err.status === 404 && /Book #999999/.test(err.message)
    );
  });

  await suite.test('TC-BPT-C04 (Path C4): Inactive / discontinued book', () => {
    const inactiveBook = t.db.prepare("SELECT * FROM books WHERE id = ?").get(bookBeta.id);
    t.db.prepare("UPDATE books SET active = 0 WHERE id = ?").run(inactiveBook.id);

    assert.throws(
      () => sales.createSale(t.db, staffUser, {
        items: [{ bookId: inactiveBook.id, quantity: 1 }],
        paymentMethod: 'cash'
      }),
      (err) => err.status === 400 && /no longer sold/.test(err.message)
    );

    // Restore active status
    t.db.prepare("UPDATE books SET active = 1 WHERE id = ?").run(inactiveBook.id);
  });

  await suite.test('TC-BPT-C05 (Path C5): Stock deficit check (requested > available)', () => {
    assert.throws(
      () => sales.createSale(t.db, staffUser, {
        items: [{ bookId: bookBeta.id, quantity: 999 }],
        paymentMethod: 'cash'
      }),
      (err) => err.status === 409 && /Insufficient stock/.test(err.message)
    );
  });

  await suite.test('TC-BPT-C06 (Path C6): Valid sale with staff within discount limit', () => {
    const beforeStock = t.stock(bookAlpha.id).s;
    const res = sales.createSale(t.db, staffUser, {
      items: [{ bookId: bookAlpha.id, quantity: 2 }],
      discountPercent: 5,
      paymentMethod: 'upi',
      customerName: 'Aarav Patel'
    });
    assert.equal(res.duplicate, false);
    assert.equal(res.sale.customerName, 'Aarav Patel');
    assert.equal(res.sale.paymentMethod, 'upi');
    assert.equal(t.stock(bookAlpha.id).s, beforeStock - 2);
  });

  // Additional structural decision tests:
  await suite.test('TC-BPT-C07 (Structural): Owner discount exempt from staff discount limit', () => {
    const res = sales.createSale(t.db, ownerUser, {
      items: [{ bookId: bookAlpha.id, quantity: 1 }],
      discountPercent: 50,
      paymentMethod: 'card'
    });
    assert.equal(res.sale.discountPercent, 50);
  });

  await suite.test('TC-BPT-C08 (Structural): Multi-item purchase loop verification', () => {
    const res = sales.createSale(t.db, ownerUser, {
      items: [
        { bookId: bookAlpha.id, quantity: 1 },
        { bookId: bookBeta.id, quantity: 1 }
      ],
      paymentMethod: 'cash'
    });
    assert.equal(res.sale.items.length, 2);
  });

  await suite.test('TC-BPT-C09 (Structural): Reserved stock boundary evaluation', () => {
    // Reserve 3 copies of bookBeta via phone order
    t.db.prepare("UPDATE books SET reserved_qty = 3 WHERE id = ?").run(bookBeta.id);
    const b = t.db.prepare("SELECT stock_qty, reserved_qty FROM books WHERE id = ?").get(bookBeta.id);
    const avail = b.stock_qty - b.reserved_qty;

    // Requesting avail + 1 must fail
    assert.throws(
      () => sales.createSale(t.db, ownerUser, {
        items: [{ bookId: bookBeta.id, quantity: avail + 1 }],
        paymentMethod: 'cash'
      }),
      (err) => err.status === 409 && /reserved for phone orders/.test(err.message)
    );
    // Cleanup reserved
    t.db.prepare("UPDATE books SET reserved_qty = 0 WHERE id = ?").run(bookBeta.id);
  });

  await suite.test('TC-BPT-C10 (Structural): Duplicate book in items list merged into single line', () => {
    const beforeStock = t.stock(bookAlpha.id).s;
    const res = sales.createSale(t.db, ownerUser, {
      items: [
        { bookId: bookAlpha.id, quantity: 1 },
        { bookId: bookAlpha.id, quantity: 2 }
      ],
      paymentMethod: 'cash'
    });
    // Should be merged into quantity: 3
    assert.equal(t.stock(bookAlpha.id).s, beforeStock - 3);
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
    
    pickupOrder = orders.createOrder(t.db, staffUser, {
      customerName: 'Priya Sharma',
      customerPhone: '9820011223',
      deliveryType: 'pickup',
      items: [{ bookId: testBook.id, quantity: 2 }]
    });

    deliveryOrder = orders.createOrder(t.db, staffUser, {
      customerName: 'Devendra Joshi',
      customerPhone: '9820044556',
      deliveryType: 'delivery',
      deliveryAddress: '402 Sunset Tower, Mumbai',
      items: [{ bookId: testBook.id, quantity: 3 }]
    });
  });

  await suite.test('TC-BPT-S1 (Path S1): Non-existent order ID', () => {
    assert.throws(
      () => orders.setStatus(t.db, 999999, { status: 'ready' }),
      (err) => err.status === 404 && /Order/.test(err.message)
    );
  });

  await suite.test('TC-BPT-S2 (Path S2): Illegal status transition (placed -> out_for_delivery)', () => {
    assert.throws(
      () => orders.setStatus(t.db, pickupOrder.id, { status: 'out_for_delivery' }),
      (err) => err.status === 409 && /Cannot move an order from "placed" to "out for delivery"/.test(err.message)
    );
  });

  await suite.test('TC-BPT-S3 (Path S3): Out for delivery blocked on pickup order', () => {
    // First move to ready
    orders.setStatus(t.db, pickupOrder.id, { status: 'ready' });
    // Now attempt out_for_delivery on pickup order
    assert.throws(
      () => orders.setStatus(t.db, pickupOrder.id, { status: 'out_for_delivery' }),
      (err) => err.status === 409 && /Only delivery orders can be sent out for delivery/.test(err.message)
    );
  });

  await suite.test('TC-BPT-S4 (Path S4): Valid transition (placed -> ready -> out_for_delivery)', () => {
    const s1 = orders.setStatus(t.db, deliveryOrder.id, { status: 'ready' });
    assert.equal(s1.status, 'ready');

    const s2 = orders.setStatus(t.db, deliveryOrder.id, { status: 'out_for_delivery' });
    assert.equal(s2.status, 'out_for_delivery');
  });

  await suite.test('TC-BPT-S5 (Structural): Order cancellation releases reserved stock', () => {
    const beforeReserved = t.stock(testBook.id).r;
    const ord = orders.createOrder(t.db, staffUser, {
      customerName: 'Anil Mehta',
      customerPhone: '9820099887',
      deliveryType: 'pickup',
      items: [{ bookId: testBook.id, quantity: 4 }]
    });
    assert.equal(t.stock(testBook.id).r, beforeReserved + 4);

    orders.cancelOrder(t.db, staffUser, ord.id, { reason: 'Customer changed mind' });
    assert.equal(t.stock(testBook.id).r, beforeReserved);
  });

  await suite.test('TC-BPT-S6 (Structural): Re-cancellation of already cancelled order rejected', () => {
    const ord = orders.createOrder(t.db, staffUser, {
      customerName: 'Sunita Rao',
      customerPhone: '9820077665',
      deliveryType: 'pickup',
      items: [{ bookId: testBook.id, quantity: 1 }]
    });
    orders.cancelOrder(t.db, staffUser, ord.id, { reason: 'Initial cancel' });

    assert.throws(
      () => orders.cancelOrder(t.db, staffUser, ord.id, { reason: 'Second cancel' }),
      (err) => err.status === 409 && /already cancelled/.test(err.message)
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

  await suite.test('TC-02: Negative stock prevention constraint', () => {
    assert.throws(
      () => inventory.applyStock(t.db, { bookId: regBook.id, stockDelta: -999, reason: 'illegal_sub' }),
      (err) => err.status === 409 && /Insufficient stock/.test(err.message)
    );
  });

  await suite.test('TC-03: Idempotent sale generation determinism', () => {
    const res1 = sales.createSale(t.db, ownerUser, { items: [{ bookId: regBook.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: 'reg-idem-1' });
    const res2 = sales.createSale(t.db, ownerUser, { items: [{ bookId: regBook.id, quantity: 1 }], paymentMethod: 'cash', idempotencyKey: 'reg-idem-1' });
    assert.equal(res1.sale.id, res2.sale.id);
    assert.equal(res2.duplicate, true);
  });

  await suite.test('TC-04: Staff discount ceiling enforcement (10%)', () => {
    assert.throws(
      () => sales.createSale(t.db, staffUser, { items: [{ bookId: regBook.id, quantity: 1 }], discountPercent: 12, paymentMethod: 'cash' }),
      (err) => err.status === 403
    );
  });

  await suite.test('TC-05: Phone order reservation barrier', () => {
    const ord = orders.createOrder(t.db, staffUser, {
      customerName: 'Reg Cust',
      customerPhone: '9800012345',
      deliveryType: 'pickup',
      items: [{ bookId: regBook.id, quantity: 5 }]
    });
    assert.ok(ord.id > 0);
    assert.equal(t.stock(regBook.id).r, 5);
  });

  await suite.test('TC-06: Phone order fulfilment deducts reserved stock', () => {
    const ord = orders.createOrder(t.db, staffUser, {
      customerName: 'Fulfil Cust',
      customerPhone: '9800054321',
      deliveryType: 'pickup',
      items: [{ bookId: regBook.id, quantity: 2 }]
    });
    orders.setStatus(t.db, ord.id, { status: 'ready' });
    const beforeStock = t.stock(regBook.id).s;
    const beforeRes = t.stock(regBook.id).r;

    orders.fulfilOrder(t.db, staffUser, ord.id, { paymentMethod: 'cash' });
    assert.equal(t.stock(regBook.id).s, beforeStock - 2);
    assert.equal(t.stock(regBook.id).r, beforeRes - 2);
  });

  await suite.test('TC-07: Low stock threshold calculation', () => {
    const overview = inventory.stockOverview(t.db, { lowOnly: false });
    assert.ok(overview.length > 0);
    const target = overview.find((b) => b.id === regBook.id);
    assert.ok(target !== undefined);
    assert.equal(target.isLowStock, target.availableQty <= target.threshold);
  });

  await suite.test('TC-08: Stock adjustment audit note logging', () => {
    inventory.adjustStock(t.db, ownerUser, regBook.id, { countedQty: 25, reason: 'Physical inventory recount' });
    const moves = inventory.movements(t.db, regBook.id, 5);
    assert.equal(moves[0].reason, 'adjustment');
    assert.equal(moves[0].note, 'Physical inventory recount');
  });

  await suite.test('TC-09: Voiding sale restores inventory', () => {
    const before = t.stock(regBook.id).s;
    const made = sales.createSale(t.db, staffUser, { items: [{ bookId: regBook.id, quantity: 3 }], paymentMethod: 'cash' });
    assert.equal(t.stock(regBook.id).s, before - 3);

    sales.voidSale(t.db, ownerUser, made.sale.id, { reason: 'Customer returned book' });
    assert.equal(t.stock(regBook.id).s, before);
  });

  await suite.test('TC-10: Re-voiding already voided sale rejected (409)', () => {
    const made = sales.createSale(t.db, staffUser, { items: [{ bookId: regBook.id, quantity: 1 }], paymentMethod: 'cash' });
    sales.voidSale(t.db, ownerUser, made.sale.id, { reason: 'First void' });

    assert.throws(
      () => sales.voidSale(t.db, ownerUser, made.sale.id, { reason: 'Second void' }),
      (err) => err.status === 409 && /already been voided/.test(err.message)
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
      id: 99,
      billNo: 'INV-000099',
      paymentMethod: 'cash',
      customerName: 'Regression Tester',
      items: [{ title: 'Design Patterns', quantity: 1, unitPriceCents: 15000, lineTotalCents: 15000 }],
      totalCents: 15000,
      subtotalCents: 15000
    };
    const html = renderBillHtml(mockSale, { shopName: 'PRATHAM BOOKSHOP' });
    assert.match(html, /PRATHAM BOOKSHOP/);
    assert.match(html, /CASH PAID/);
    assert.match(html, /INV-000099/);
    assert.match(html, /TOTAL/);
  });
});
