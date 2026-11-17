const { forbidden } = require('./errors');

// Role hierarchy: owner > manager > staff.
const RANK = { staff: 0, manager: 1, owner: 2 };
const ROLES = Object.keys(RANK);

const atLeast = (role, min) => RANK[role] >= RANK[min];

// Cost / supplier pricing is visible to managers and owners, never to counter staff.
const canSeeCost = (ctx) => atLeast(ctx.user.role, 'manager');

// Discount ceiling for the acting user (basis points). Owners are unrestricted.
function maxDiscountBp(ctx, settings) {
  if (ctx.user.role === 'owner') return 10000;
  if (ctx.user.role === 'manager') return settings.managerMaxDiscountBp;
  return settings.staffMaxDiscountBp;
}

function checkDiscount(ctx, settings, discountBp) {
  const max = maxDiscountBp(ctx, settings);
  if (discountBp > max) {
    const who = ctx.user.role === 'manager' ? 'Managers' : 'Staff';
    throw forbidden(`${who} may give at most ${max / 100}% discount; ask the owner for more`);
  }
}

// The shop a request acts on. Every shop-level service calls this, so a missing shop is caught early.
function requireShop(ctx) {
  if (!ctx.shopId) throw forbidden('No shop selected, or you are not assigned to any shop');
  return ctx.shopId;
}

module.exports = { RANK, ROLES, atLeast, canSeeCost, maxDiscountBp, checkDiscount, requireShop };
