const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { requireShop } = require('../lib/tenant');

// Operating expenses (rent, wages, ...) recorded against a shop.

const toApi = (r) => ({ id: r.id, shopId: r.shop_id, date: r.expense_date, category: r.category, description: r.description, amountCents: r.amount_cents, createdAt: r.created_at });

async function list(ctx, { from, to } = {}) {
  const f = v.date(from, 'from', { required: false });
  const t = v.date(to, 'to', { required: false });
  return (await ctx.db.many(`SELECT * FROM expenses WHERE business_id = $1 AND shop_id = $2
                               AND ($3::date IS NULL OR expense_date >= $3) AND ($4::date IS NULL OR expense_date <= $4)
                             ORDER BY expense_date DESC, id DESC LIMIT 500`, [ctx.businessId, requireShop(ctx), f, t])).map(toApi);
}

async function create(ctx, input) {
  v.object(input);
  const row = await ctx.db.one(`INSERT INTO expenses(business_id, shop_id, expense_date, category, description, amount_cents, user_id)
                                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [
    ctx.businessId, requireShop(ctx),
    v.date(input.date, 'date'),
    v.str(input.category, 'category', { required: true, max: 60 }),
    v.str(input.description, 'description', { max: 300 }),
    v.money(input.amountCents, 'amountCents', { min: 1, max: 1e11 }),
    ctx.user.id,
  ]);
  return toApi(row);
}

async function remove(ctx, id) {
  if (!(await ctx.db.run('DELETE FROM expenses WHERE id = $1 AND business_id = $2 AND shop_id = $3', [id, ctx.businessId, requireShop(ctx)]))) {
    throw notFound('Expense');
  }
}

module.exports = { list, create, remove };
