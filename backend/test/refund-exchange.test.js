const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

describe('Refund and Exchange Policies', () => {
  it('refunds an item within 1 week, restoring physical stock', async () => {
    const { asOwner, addBook, stock, close } = await setup();
    try {
      const book = await addBook({ priceCents: 1299, openingStock: 10 });

      // Buy 2 copies
      const saleRes = await asOwner.post('/api/sales', {
        items: [{ bookId: book.id, quantity: 2 }],
        paymentMethod: 'cash',
      });
      assert.equal(saleRes.status, 201);
      const sale = saleRes.body;
      const saleItem = sale.items.find((i) => i.bookId === book.id);
      assert.ok(saleItem);

      // Stock should now be 8
      assert.equal((await stock(book.id)).s, 8);

      // Refund 1 copy
      const refRes = await asOwner.post(`/api/sales/${sale.id}/refund`, {
        itemId: saleItem.id,
        quantity: 1,
        reason: 'Customer changed mind',
      });
      assert.equal(refRes.status, 200);
      const refundedSale = refRes.body;

      // Item should show returnedQty = 1
      const updatedItem = refundedSale.items.find((i) => i.id === saleItem.id);
      assert.equal(updatedItem.returnedQty, 1);

      // Stock restored to 9
      assert.equal((await stock(book.id)).s, 9);

      // Return history recorded
      assert.equal(refundedSale.returns.length, 1);
      assert.equal(refundedSale.returns[0].type, 'refund');
      assert.equal(refundedSale.returns[0].quantity, 1);

      // An adjusted bill cannot be voided: reverse the remaining items with another adjustment.
      const voidRes = await asOwner.post(`/api/sales/${sale.id}/void`, { reason: 'Test reversal' });
      assert.equal(voidRes.status, 409);
      assert.equal((await stock(book.id)).s, 9);
    } finally {
      await close();
    }
  });

  it('a refund hands back the tax charged on the copies and reverses it in the figures', async () => {
    const { asOwner, addBook, close } = await setup();
    try {
      assert.equal((await asOwner.put('/api/settings', { taxPercent: 18 })).status, 200);
      const book = await addBook({ priceCents: 10000, openingStock: 5 });
      const sale = (await asOwner.post('/api/sales', { items: [{ bookId: book.id, quantity: 2 }], discountPercent: 10, paymentMethod: 'cash' })).body;
      // Whole rupees: 2 x 100 = 200, 10% off = 180, 18% tax = 32.40 -> 32, total 212
      assert.equal(sale.totalCents, 21200);
      const r = await asOwner.post(`/api/sales/${sale.id}/refund`, { itemId: sale.items[0].id, quantity: 1 });
      assert.equal(r.status, 200);
      const ret = r.body.returns[0];
      assert.equal(ret.amountCents, 9000);      // revenue reversed: 100 less 10%
      assert.equal(ret.taxCents, 1600);         // 18% of 90 = 16.20 -> 16
      assert.equal(ret.paidBackCents, 10600);   // what the customer gets back = half the bill
      const d = (await asOwner.get('/api/dashboard?outlet=all')).body.summary;
      assert.equal(d.netSalesCents, 9000);
      assert.equal(d.taxCents, 1600);
      assert.equal(d.grossBilledCents, 10600);
    } finally {
      await close();
    }
  });

  it('rejects refund if quantity exceeds eligible remaining quantity', async () => {
    const { asOwner, addBook, close } = await setup();
    try {
      const book = await addBook({ priceCents: 1299, openingStock: 10 });
      const saleRes = await asOwner.post('/api/sales', {
        items: [{ bookId: book.id, quantity: 1 }],
        paymentMethod: 'cash',
      });
      const sale = saleRes.body;
      const saleItem = sale.items[0];

      // Try refunding 2 copies when only 1 was purchased
      const refRes = await asOwner.post(`/api/sales/${sale.id}/refund`, {
        itemId: saleItem.id,
        quantity: 2,
      });
      assert.equal(refRes.status, 400);
    } finally {
      await close();
    }
  });

  it('rejects refund if sale is older than 1 week (7 days)', async () => {
    const { asOwner, db, addBook, close } = await setup();
    try {
      const book = await addBook({ priceCents: 1299, openingStock: 10 });
      const saleRes = await asOwner.post('/api/sales', {
        items: [{ bookId: book.id, quantity: 1 }],
        paymentMethod: 'cash',
      });
      const sale = saleRes.body;
      const saleItem = sale.items[0];

      // Artificially age the sale by 8 days
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await db.query('UPDATE sales SET created_at = $1 WHERE id = $2', [eightDaysAgo, sale.id]);

      const refRes = await asOwner.post(`/api/sales/${sale.id}/refund`, {
        itemId: saleItem.id,
        quantity: 1,
      });
      assert.equal(refRes.status, 400);
      assert.match(refRes.body.error.message, /7 days/i);
    } finally {
      await close();
    }
  });

  it('exchanges an item within 1 week for a book of the exact same price', async () => {
    const { asOwner, addBook, stock, close } = await setup();
    try {
      const book1 = await addBook({ title: 'Book 1', priceCents: 1500, openingStock: 10 });
      const book2 = await addBook({ title: 'Book 2', priceCents: 1500, openingStock: 10 });

      // Buy 1 copy of book 1
      const saleRes = await asOwner.post('/api/sales', {
        items: [{ bookId: book1.id, quantity: 1 }],
        paymentMethod: 'cash',
      });
      const sale = saleRes.body;
      const saleItem = sale.items[0];

      assert.equal((await stock(book1.id)).s, 9);
      assert.equal((await stock(book2.id)).s, 10);

      // Exchange book 1 for book 2 (same price 1500)
      const exRes = await asOwner.post(`/api/sales/${sale.id}/exchange`, {
        itemId: saleItem.id,
        replacementBookId: book2.id,
        quantity: 1,
        reason: 'Customer preferred alternative title',
      });
      assert.equal(exRes.status, 200);
      const exchangedSale = exRes.body;

      // Book 1 returned -> stock goes back from 9 to 10
      assert.equal((await stock(book1.id)).s, 10);

      // Book 2 handed out -> stock goes from 10 to 9
      assert.equal((await stock(book2.id)).s, 9);

      // Item marked as returnedQty = 1
      const updatedItem = exchangedSale.items.find((i) => i.id === saleItem.id);
      assert.equal(updatedItem.returnedQty, 1);

      // Exchange history logged
      assert.equal(exchangedSale.returns.length, 1);
      assert.equal(exchangedSale.returns[0].type, 'exchange');
      assert.equal(exchangedSale.returns[0].replacementBookId, book2.id);
    } finally {
      await close();
    }
  });

  it('strictly rejects exchange if replacement book has a different price', async () => {
    const { asOwner, addBook, close } = await setup();
    try {
      const book1 = await addBook({ title: 'Book 1', priceCents: 1200, openingStock: 10 });
      const book2 = await addBook({ title: 'Book 2', priceCents: 1800, openingStock: 10 });

      // Buy book 1 (1200)
      const saleRes = await asOwner.post('/api/sales', {
        items: [{ bookId: book1.id, quantity: 1 }],
        paymentMethod: 'cash',
      });
      const sale = saleRes.body;
      const saleItem = sale.items[0];

      // Attempt to exchange for book 2 (1800)
      const exRes = await asOwner.post(`/api/sales/${sale.id}/exchange`, {
        itemId: saleItem.id,
        replacementBookId: book2.id,
        quantity: 1,
      });
      assert.equal(exRes.status, 400);
      assert.match(exRes.body.error.message, /exact same price/i);
    } finally {
      await close();
    }
  });
});
