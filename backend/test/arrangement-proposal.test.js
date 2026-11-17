const { test } = require('node:test');
const assert = require('node:assert/strict');
const { propose, suggestMigrationShelves } = require('../src/services/arrangement');

test('random shelf proposals reserve free capacity, split copies, and leave overflow unassigned', async () => {
  const writes = [];
  const q = {
    one: async () => ({ id: 7 }),
    many: async () => [
      { id: 1, capacity: 3, occupied: 1, pending: 1 },
      { id: 2, capacity: 2, occupied: 0, pending: 0 },
    ],
    query: async (sql, params) => writes.push({ sql, params }),
  };
  await propose(q, { businessId: 1, shopId: 2, user: { id: 3 } }, 7, 5, 'receipt', 9);
  const assigned = writes.filter(x => x.sql.includes('proposed_shelf_id'));
  assert.deepEqual(assigned.map(x => [x.params[3], x.params[4]]).sort(), [[1, 1], [2, 2]]);
  const overflow = writes.find(x => !x.sql.includes('proposed_shelf_id'));
  assert.equal(overflow.params[3], 2);
});

test('migration suggestions split tasks without placing books and preserve overflow', async () => {
  const writes=[];
  const q={
    many:async sql=>{
      if(sql.includes('SELECT DISTINCT book_id')) return [{book_id:7}];
      if(sql.startsWith('SELECT id FROM shelves')) return [{id:1},{id:2}];
      if(sql.includes('SELECT s.id,s.capacity')) return [{id:1,capacity:3,occupied:1,pending:1},{id:2,capacity:2,occupied:0,pending:0}];
      if(sql.includes('SELECT * FROM arrangement_tasks')) return [{id:10,book_id:7,qty:5,source:'migration',source_ref:null,created_by:null,created_at:'2026-01-01T00:00:00Z'}];
      throw Error('Unexpected query');
    },
    query:async (sql,params)=>writes.push({sql,params}),
  };
  const result=await suggestMigrationShelves({businessId:1,shopId:2,db:{tx:fn=>fn(q)}});
  assert.deepEqual(result,{assigned:3,remaining:2});
  assert.equal(writes.filter(x=>x.sql.startsWith('UPDATE arrangement_tasks')).length,1);
  assert.equal(writes.filter(x=>x.sql.includes('INSERT INTO arrangement_tasks')).length,2);
  assert.ok(!writes.some(x=>/INSERT INTO shelf_stock/.test(x.sql)));
});
