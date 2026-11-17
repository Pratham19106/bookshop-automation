const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('adjustments settle price differences, retain the original bill and accept safe retries', async () => {
  const t = await setup();
  try {
    const original = await t.addBook({ title:'Original', priceCents:10000, openingStock:5 });
    const replacement = await t.addBook({ title:'Replacement', priceCents:15000, openingStock:5 });
    const sale = await t.asStaff.post('/api/sales', { items:[{bookId:original.id,quantity:2}], paymentMethod:'cash' });
    assert.equal(sale.status,201);
    const body={ returns:[{saleItemId:sale.body.items[0].id,quantity:1}], replacements:[{bookId:replacement.id,quantity:1}], paymentMethod:'card', idempotencyKey:'adjustment-1' };
    const adjustment=await t.asStaff.post(`/api/sales/${sale.body.id}/adjustments`,body);
    assert.equal(adjustment.status,201,adjustment.text);
    assert.equal(adjustment.body.adjustment.netCents,5000);
    assert.equal(adjustment.body.adjustment.paymentMethod,'card');
    const report = await t.asOwner.get('/api/dashboard');
    assert.equal(report.status,200,report.text);
    assert.equal(report.body.summary.netSalesCents,25000);
    const statement = await t.asOwner.get('/api/reports/statement');
    assert.equal(statement.status,200,statement.text);
    assert.equal(statement.body.columns.at(-1).netSalesCents,25000);
    assert.equal(statement.body.columns.at(-1).payments.card,5000);
    assert.match(adjustment.body.adjustment.adjustmentNo,/^ADJ-/);
    const listed = await t.asStaff.get(`/api/adjustments?q=${encodeURIComponent(adjustment.body.adjustment.adjustmentNo)}`);
    assert.equal(listed.status,200,listed.text);
    assert.equal(listed.body.items.length,1);
    assert.equal(listed.body.items[0].billNo,sale.body.billNo);
    assert.equal((await t.asOther.get(`/api/adjustments?q=${encodeURIComponent(adjustment.body.adjustment.adjustmentNo)}`)).body.items.length,0);
    assert.equal((await t.asStaff.get('/api/adjustments?status=voided')).body.items.length,0);
    const retry=await t.asStaff.post(`/api/sales/${sale.body.id}/adjustments`,body);
    assert.equal(retry.status,200); assert.equal(retry.body.adjustment.id,adjustment.body.adjustment.id);
    assert.equal((await t.asStaff.get(`/api/sales/${sale.body.id}`)).body.totalCents,sale.body.totalCents);
    assert.equal((await t.asOther.get(`/api/adjustments/${adjustment.body.adjustment.id}`)).status,404);
    const repl=adjustment.body.adjustment.items.find(i=>i.sign===1);
    const second=await t.asStaff.post(`/api/sales/${sale.body.id}/adjustments`,{
      returns:[{adjustmentItemId:repl.id,quantity:1}], replacements:[], paymentMethod:'cash', idempotencyKey:'adjustment-2' });
    assert.equal(second.status,201,second.text); assert.equal(second.body.adjustment.netCents,-15000);
    assert.equal((await t.stock(original.id)).s,4); assert.equal((await t.stock(replacement.id)).s,5);
  } finally { await t.close(); }
});
