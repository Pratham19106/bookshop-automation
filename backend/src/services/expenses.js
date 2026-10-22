const v = require('../lib/validate');
const { notFound } = require('../lib/errors');

const toApi = (r) => ({ id: r.id, date: r.expense_date, category: r.category, description: r.description, amountCents: r.amount_cents, createdAt: r.created_at });

function list(db, { from, to } = {}) {
  const f = v.date(from, 'from', { required: false });
  const t = v.date(to, 'to', { required: false });
  return db.prepare(`SELECT * FROM expenses WHERE (@f IS NULL OR expense_date >= @f) AND (@t IS NULL OR expense_date <= @t)
                     ORDER BY expense_date DESC, id DESC LIMIT 500`).all({ f, t }).map(toApi);
}

function create(db, user, input) {
  v.object(input);
  const row = {
    date: v.date(input.date, 'date'),
    category: v.str(input.category, 'category', { required: true, max: 60 }),
    description: v.str(input.description, 'description', { max: 300 }),
    amount: v.int(input.amountCents, 'amountCents', { min: 1, max: 1e11 }),
  };
  const r = db.prepare('INSERT INTO expenses(expense_date, category, description, amount_cents, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(row.date, row.category, row.description, row.amount, user.id);
  return toApi(db.prepare('SELECT * FROM expenses WHERE id = ?').get(r.lastInsertRowid));
}

function remove(db, id) {
  if (!db.prepare('DELETE FROM expenses WHERE id = ?').run(id).changes) throw notFound('Expense');
}

module.exports = { list, create, remove };
