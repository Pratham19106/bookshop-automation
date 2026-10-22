const { badRequest } = require('./errors');

// Percent (e.g. 12.5) -> basis points (1250).
function percentToBp(value, field = 'percent') {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw badRequest(`${field} must be a number`);
  if (n < 0 || n > 100) throw badRequest(`${field} must be between 0 and 100`);
  const bp = Math.round(n * 100);
  if (Math.abs(bp / 100 - n) > 1e-9) throw badRequest(`${field} can have at most 2 decimal places`);
  return bp;
}

// Single place where bill arithmetic lives (used by billing and phone orders).
// lines: [{ unitPriceCents, quantity }]. Discount applies to the subtotal, tax to the discounted amount.
function computeTotals(lines, discountBp, taxBp) {
  const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const discount = Math.round((subtotal * discountBp) / 10000);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * taxBp) / 10000);
  return { subtotalCents: subtotal, discountCents: discount, taxCents: tax, totalCents: taxable + tax };
}

module.exports = { percentToBp, computeTotals };
