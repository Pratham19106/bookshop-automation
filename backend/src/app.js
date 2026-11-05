const express = require('express');
const config = require('./config');
const { AppError, unauthorized, forbidden, badRequest } = require('./lib/errors');
const users = require('./services/users');
const settings = require('./services/settings');
const books = require('./services/books');
const inventory = require('./services/inventory');
const sales = require('./services/sales');
const orders = require('./services/orders');
const suppliers = require('./services/suppliers');
const purchasing = require('./services/purchasing');
const restock = require('./services/restock');
const dashboard = require('./services/dashboard');
const expenses = require('./services/expenses');
const billPrinter = require('./services/billPrinter');

const idParam = (req, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${name}`);
  return n;
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split(/=(.*)/s)).filter((p) => p[0]).map((p) => [p[0], decodeURIComponent(p[1] || '')]));
}

function createApp(db, { tzOffsetMinutes = config.tzOffsetMinutes } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(config.publicDir));

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // CSRF defence in depth (cookie is also SameSite=Strict): state-changing calls must carry a custom header,
    // which browsers will not attach to cross-site form posts.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'bookshop') {
      return next(forbidden('Missing X-Requested-With header'));
    }
    const token = parseCookies(req.headers.cookie).sid;
    req.token = token;
    req.user = users.userForToken(db, token);
    next();
  });

  const authed = (req, res, next) => (req.user ? next() : next(unauthorized()));
  const owner = (req, res, next) => {
    if (!req.user) return next(unauthorized());
    return req.user.role === 'owner' ? next() : next(forbidden('This action is limited to the shop owner'));
  };
  const ok = (res, data, status = 200) => res.status(status).json(data);

  // ---- auth
  api.post('/auth/login', (req, res) => {
    const { token, user } = users.login(db, req.body || {}, req.ip);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: config.sessionHours * 3600 * 1000, path: '/' });
    ok(res, { user });
  });
  api.post('/auth/logout', (req, res) => {
    users.logout(db, req.token);
    res.clearCookie('sid', { path: '/' });
    ok(res, { ok: true });
  });
  api.get('/auth/me', authed, (req, res) => ok(res, { user: users.publicUser(req.user) }));
  api.post('/auth/password', authed, (req, res) => { users.changePassword(db, req.user, req.body || {}); ok(res, { ok: true }); });

  // ---- settings & users
  api.get('/settings', authed, (req, res) => ok(res, settings.publicSettings(db)));
  api.put('/settings', owner, (req, res) => ok(res, settings.updateSettings(db, req.body)));
  api.get('/users', owner, (req, res) => ok(res, users.listUsers(db)));
  api.post('/users', owner, (req, res) => ok(res, users.createUser(db, req.body), 201));
  api.post('/users/:id/active', owner, (req, res) => ok(res, users.setActive(db, req.user, idParam(req), !!(req.body && req.body.active))));
  api.post('/users/:id/password', owner, (req, res) => { users.resetPassword(db, idParam(req), req.body && req.body.newPassword); ok(res, { ok: true }); });

  // ---- catalogue
  api.get('/books', authed, (req, res) => ok(res, books.search(db, req.user, {
    q: req.query.q, genre: req.query.genre, lowOnly: req.query.low === '1',
    includeInactive: req.query.inactive === '1', limit: req.query.limit, offset: req.query.offset,
  })));
  api.get('/books/genres', authed, (req, res) => ok(res, books.genres(db)));
  api.post('/books/batch-location', authed, (req, res) => ok(res, books.batchAssignLocation(db, req.user, req.body)));
  api.get('/books/:id', authed, (req, res) => ok(res, books.get(db, req.user, idParam(req))));
  api.post('/books', authed, (req, res) => ok(res, books.create(db, req.user, req.body), 201));
  api.put('/books/:id', authed, (req, res) => ok(res, books.update(db, req.user, idParam(req), req.body)));
  api.put('/books/:id/location', authed, (req, res) => ok(res, books.setLocation(db, req.user, idParam(req), req.body)));
  api.post('/books/:id/active', owner, (req, res) => ok(res, books.setActive(db, req.user, idParam(req), !!(req.body && req.body.active))));
  api.get('/books/:id/movements', authed, (req, res) => ok(res, inventory.movements(db, idParam(req), req.query.limit)));
  api.post('/books/:id/adjust', owner, (req, res) => ok(res, inventory.adjustStock(db, req.user, idParam(req), req.body)));
  api.get('/books/:id/suppliers', owner, (req, res) => ok(res, suppliers.suppliersForBook(db, idParam(req))));
  api.get('/inventory', authed, (req, res) => ok(res, inventory.stockOverview(db, { lowOnly: req.query.low === '1', q: String(req.query.q || '') })));

  // ---- billing
  api.post('/sales', authed, (req, res) => {
    const { sale, duplicate } = sales.createSale(db, req.user, req.body);
    ok(res, { ...sale, duplicate }, duplicate ? 200 : 201);
  });
  api.get('/sales', authed, (req, res) => ok(res, sales.listSales(db, tzOffsetMinutes, req.query)));
  api.get('/sales/:id', authed, (req, res) => ok(res, sales.getSale(db, req.user, idParam(req))));
  api.get('/sales/:id/pdf', authed, async (req, res, next) => {
    try {
      const sale = sales.getSale(db, req.user, idParam(req));
      const shopSettings = settings.getSettings(db);
      const pdf = await billPrinter.generateBillPdf(sale, shopSettings);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="bill-${sale.billNo}.pdf"`);
      res.send(pdf);
    } catch (e) {
      next(e);
    }
  });
  api.get('/sales/:id/html', authed, (req, res, next) => {
    try {
      const sale = sales.getSale(db, req.user, idParam(req));
      const shopSettings = settings.getSettings(db);
      const html = billPrinter.renderBillHtml(sale, shopSettings);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) {
      next(e);
    }
  });
  api.post('/sales/:id/void', owner, (req, res) => ok(res, sales.voidSale(db, req.user, idParam(req), req.body)));

  // ---- phone orders
  api.get('/orders', authed, (req, res) => ok(res, orders.listOrders(db, req.query)));
  api.post('/orders', authed, (req, res) => ok(res, orders.createOrder(db, req.user, req.body), 201));
  api.get('/orders/:id', authed, (req, res) => ok(res, orders.getOrder(db, idParam(req))));
  api.put('/orders/:id', authed, (req, res) => ok(res, orders.modifyOrder(db, req.user, idParam(req), req.body)));
  api.post('/orders/:id/status', authed, (req, res) => ok(res, orders.setStatus(db, idParam(req), req.body)));
  api.post('/orders/:id/cancel', authed, (req, res) => ok(res, orders.cancelOrder(db, req.user, idParam(req), req.body)));
  api.post('/orders/:id/payments', authed, (req, res) => ok(res, orders.addPayment(db, req.user, idParam(req), req.body), 201));
  api.post('/orders/:id/refund', authed, (req, res) => ok(res, orders.refund(db, req.user, idParam(req), req.body)));
  api.post('/orders/:id/fulfil', authed, (req, res) => ok(res, orders.fulfilOrder(db, req.user, idParam(req), req.body)));

  // ---- suppliers, purchasing (owner only: contains supplier pricing)
  api.get('/suppliers', owner, (req, res) => ok(res, suppliers.list(db, { q: String(req.query.q || ''), includeInactive: req.query.inactive === '1' })));
  api.post('/suppliers', owner, (req, res) => ok(res, suppliers.create(db, req.body), 201));
  api.get('/suppliers/:id', owner, (req, res) => ok(res, suppliers.get(db, idParam(req))));
  api.put('/suppliers/:id', owner, (req, res) => ok(res, suppliers.update(db, idParam(req), req.body)));
  api.post('/suppliers/:id/active', owner, (req, res) => ok(res, suppliers.setActive(db, idParam(req), !!(req.body && req.body.active))));
  api.put('/suppliers/:id/books/:bookId', owner, (req, res) => ok(res, suppliers.setBookPrice(db, idParam(req), idParam(req, 'bookId'), req.body)));
  api.delete('/suppliers/:id/books/:bookId', owner, (req, res) => ok(res, suppliers.removeBook(db, idParam(req), idParam(req, 'bookId'))));
  api.get('/purchase-orders', owner, (req, res) => ok(res, purchasing.listPos(db, { status: req.query.status, supplierId: req.query.supplierId })));
  api.post('/purchase-orders', owner, (req, res) => ok(res, purchasing.createPo(db, req.user, req.body), 201));
  api.get('/purchase-orders/:id', owner, (req, res) => ok(res, purchasing.getPo(db, idParam(req))));
  api.post('/purchase-orders/:id/cancel', owner, (req, res) => ok(res, purchasing.cancelPo(db, idParam(req))));
  api.post('/purchase-orders/:id/receive', owner, (req, res) => {
    const r = purchasing.receive(db, req.user, idParam(req), req.body);
    ok(res, r, r.duplicate ? 200 : 201);
  });

  // ---- insights
  api.get('/restock', owner, (req, res) => ok(res, restock.recommendations(db, {
    lookbackDays: req.query.lookbackDays === undefined ? undefined : Number(req.query.lookbackDays),
    coverDays: req.query.coverDays === undefined ? undefined : Number(req.query.coverDays),
  })));
  api.get('/dashboard', owner, (req, res) => ok(res, dashboard.dashboard(db, tzOffsetMinutes, { from: req.query.from, to: req.query.to, group: req.query.group })));
  api.get('/expenses', owner, (req, res) => ok(res, expenses.list(db, req.query)));
  api.post('/expenses', owner, (req, res) => ok(res, expenses.create(db, req.user, req.body), 201));
  api.delete('/expenses/:id', owner, (req, res) => { expenses.remove(db, idParam(req)); ok(res, { ok: true }); });

  api.use((req, res, next) => next(new AppError(404, 'not_found', 'Unknown API endpoint')));
  app.use('/api', api);
  app.use(api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large' } });
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: { code: 'conflict', message: 'The change conflicts with existing data' } });
    }
    console.error('Unhandled error:', err.message); // never log request bodies (may contain passwords)
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server' } });
  });

  return app;
}

module.exports = { createApp };
