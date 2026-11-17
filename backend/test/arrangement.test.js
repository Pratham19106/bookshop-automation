const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

test('shop shelf placement is scoped, capacity checked, and reduced by sales', async () => {
  const t=await setup();
  try {
    assert.equal((await t.asStaff.post('/api/shelves/layout',{aisles:1,racks:1,shelves:2,capacity:3})).status,403);
    assert.equal((await t.asManager.post('/api/shelves/layout',{aisles:1,racks:1,shelves:2,capacity:3})).status,201);
    const shelves=(await t.asStaff.get('/api/shelves')).body;
    const book=await t.addBook({title:'Shelf test',openingStock:5});
    const queue=(await t.asStaff.get('/api/arrangement')).body.filter(x=>x.bookId===book.id);
    assert.equal(queue.reduce((n,x)=>n+x.qty,0),5);
    assert.equal(queue.length,2);
    const result=await t.asStaff.post('/api/arrangement/confirm',{items:queue.map(x=>({id:x.id,shelfId:x.proposedShelfId,quantity:x.qty}))});
    assert.equal(result.status,200,result.text); assert.equal(result.body.confirmed,2);
    assert.equal((await t.asStaff2.get('/api/arrangement')).body.length,0);
    assert.equal((await t.asOther.get(`/api/shelves/${shelves[0].id}/books`)).status,404);
    const sale=await t.asStaff.post('/api/sales',{items:[{bookId:book.id,quantity:2}],paymentMethod:'cash'});
    assert.equal(sale.status,201,sale.text);
    const after=(await t.asStaff.get('/api/shelves')).body;
    assert.equal(after.reduce((n,x)=>n+x.occupied,0),3);
    const occupied=after.find(x=>x.occupied>1);
    assert.ok(occupied);
    const edit=await t.asManager.put(`/api/shelves/${occupied.id}`,{...occupied,capacity:1});
    assert.equal(edit.status,409);
  } finally { await t.close(); }
});

test('partial and concurrent confirmation retain the unplaced remainder without duplicates', async () => {
  const t=await setup();
  try {
    await t.asManager.post('/api/shelves/layout',{aisles:1,racks:1,shelves:1,capacity:10});
    const book=await t.addBook({title:'Partial placement',openingStock:5});
    const task=(await t.asStaff.get('/api/arrangement')).body.find(x=>x.bookId===book.id);
    const body={items:[{id:task.id,shelfId:task.proposedShelfId,quantity:2}]};
    const [a,b]=await Promise.all([t.asStaff.post('/api/arrangement/confirm',body),t.asManager.post('/api/arrangement/confirm',body)]);
    assert.equal(a.status,200,a.text); assert.equal(b.status,200,b.text);
    assert.equal(a.body.confirmed+b.body.confirmed,1);
    assert.equal(a.body.skipped+b.body.skipped,1);
    const remaining=(await t.asStaff.get('/api/arrangement')).body.filter(x=>x.bookId===book.id);
    assert.equal(remaining.reduce((n,x)=>n+x.qty,0),3);
    const shelves=(await t.asStaff.get('/api/shelves')).body;
    assert.equal(shelves.reduce((n,s)=>n+s.occupied,0),2);
    const correction=await t.asManager.post(`/api/books/${book.id}/adjust`,{countedQty:1,reason:'Counted'});
    assert.equal(correction.status,200,correction.text);
    assert.equal((await t.asStaff.get('/api/arrangement')).body.filter(x=>x.bookId===book.id).length,0);
    assert.equal((await t.asStaff.get('/api/shelves')).body.reduce((n,s)=>n+s.occupied,0),1);
  } finally { await t.close(); }
});

test('managers can suggest migration shelves without confirming physical placement', async () => {
  const t=await setup();
  try {
    const book=await t.addBook({title:'Migrated stock',openingStock:5});
    await t.db.query("UPDATE arrangement_tasks SET source='migration' WHERE shop_id=$1 AND book_id=$2",[t.shop1,book.id]);
    await t.asManager.post('/api/shelves/layout',{aisles:1,racks:1,shelves:2,capacity:2});
    assert.equal((await t.asStaff.post('/api/arrangement/suggest-migration')).status,403);
    const res=await t.asManager.post('/api/arrangement/suggest-migration');
    assert.equal(res.status,200,res.text);
    assert.equal(res.body.assigned,4); assert.equal(res.body.remaining,1);
    const tasks=(await t.asStaff.get('/api/arrangement')).body.filter(x=>x.bookId===book.id);
    assert.equal(tasks.filter(x=>x.proposedShelfId).reduce((n,x)=>n+x.qty,0),4);
    assert.equal(tasks.filter(x=>!x.proposedShelfId).reduce((n,x)=>n+x.qty,0),1);
    assert.equal((await t.asManager.post('/api/arrangement/suggest-migration')).body.assigned,0);
    assert.equal((await t.asStaff.get('/api/shelves')).body.reduce((n,s)=>n+s.occupied,0),0);
  } finally { await t.close(); }
});
