const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allocate, originalAllocations, returnPortion } = require('../src/lib/adjustment-money');

test('invoice discount and tax are conserved across separate partial returns', () => {
  const allocations = originalAllocations([{ quantity: 3, unitPriceCents: 101 }, { quantity: 1, unitPriceCents: 99 }], 33, 66);
  const returns = [returnPortion(allocations[0], 0, 1), returnPortion(allocations[0], 1, 2), returnPortion(allocations[1], 0, 1)];
  assert.equal(returns.reduce((n, item) => n + item.netCents, 0), 369);
  assert.equal(returns.reduce((n, item) => n + item.taxCents, 0), 66);
});

test('allocations are deterministic and cannot return extra copies', () => {
  assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  assert.throws(() => returnPortion({ net: [1], tax: [0] }, 1, 1), /Invalid return quantity/);
});
