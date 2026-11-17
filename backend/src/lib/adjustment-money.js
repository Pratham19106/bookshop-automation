const { badRequest } = require('./errors');

// Allocate an integer amount by weight; ties are settled by the original input order.
// Used to preserve the exact amount charged on the original invoice across partial returns.
function allocate(total, weights) {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some((n) => !Number.isSafeInteger(n) || n < 0)) throw badRequest('Invalid amount');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const denominator = BigInt(sum);
  const shares = weights.map((weight, index) => {
    const product = BigInt(total) * BigInt(weight);
    return { index, value: Number(product / denominator), remainder: product % denominator };
  });
  let left = total - shares.reduce((n, x) => n + x.value, 0);
  const ordered = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; i < left; i++) ordered[i].value++;
  return shares.map((x) => x.value);
}

// Per-copy allocations keep repeated partial returns equal to one complete return, including rounding.
// Split an amount in whole rupees (no paise) when it is a whole number of rupees, which every bill made since
// rupee rounding is; older bills that still carry paise are split to the paisa so their totals stay exact.
function allocateMoney(total, weights) {
  if (total % 100 === 0) return allocate(total / 100, weights).map((x) => x * 100);
  return allocate(total, weights);
}

function originalAllocations(items, discountCents, taxCents) {
  const gross = items.map((item) => item.quantity * item.unitPriceCents);
  const discounts = allocateMoney(discountCents, gross);
  const net = gross.map((value, i) => value - discounts[i]);
  const taxes = allocateMoney(taxCents, net);
  return items.map((item, i) => ({
    net: allocateMoney(net[i], Array(item.quantity).fill(1)),
    tax: allocateMoney(taxes[i], Array(item.quantity).fill(1)),
  }));
}

function returnPortion(allocation, alreadyReturned, quantity) {
  if (!Number.isInteger(alreadyReturned) || !Number.isInteger(quantity) || alreadyReturned < 0 || quantity < 1 || alreadyReturned + quantity > allocation.net.length) throw badRequest('Invalid return quantity');
  const sum = (values) => values.slice(alreadyReturned, alreadyReturned + quantity).reduce((a, b) => a + b, 0);
  return { netCents: sum(allocation.net), taxCents: sum(allocation.tax) };
}

module.exports = { allocate, allocateMoney, originalAllocations, returnPortion };
