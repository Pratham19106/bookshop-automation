const express = require('express');
const config = require('./config');
const { AppError, unauthorized, forbidden, badRequest } = require('./lib/errors');
const { atLeast } = require('./lib/tenant');
const users = require('./services/users');
const settings = require('./services/settings');
const books = require('./services/books');
const catalog = require('./services/catalog');
const inventory = require('./services/inventory');
const arrangement = require('./services/arrangement');
const sales = require('./services/sales');
const adjustments = require('./services/adjustments');
const orders = require('./services/orders');
const suppliers = require('./services/suppliers');
const purchasing = require('./services/purchasing');
const restock = require('./services/restock');
const dashboard = require('./services/dashboard');
const expenses = require('./services/expenses');
const billPrinter = require('./services/billPrinter');
const { createHub, eventsFor } = require('./lib/hub');

const idParam = (req, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${name}`);
  return n;
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split(/=(.*)/s)).filter((p) => p[0]).map((p) => [p[0], decodeURIComponent(p[1] || '')]));
}

// Postgres error codes that mean "the change conflicts with existing data / rules".
const PG_CONFLICT = new Set(['23505', '23503', '23514', '23P01', '40001', '40P01']);

/**
 * createApp(db): db is the handle from db/index.js (createDb).
 * Every authenticated request gets req.ctx = { db, user, businessId, shopIds, shopId, tz }:
 *   shopIds - shops the user may read (owner: every shop of the business; others: assigned shops)
 *   shopId  - the shop this request acts in, from the X-Shop-Id header (must be an active shop in shopIds),
 *             defaulting to the user's first active shop.
 */
function createApp(db, { tzOffsetMinutes = config.tzOffsetMinutes, corsOrigins = process.env.CORS_ORIGINS, heartbeatMs = 20000 } = {}) {
  const app = express();
  const hub = createHub();
  app.locals.hub = hub;
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Optional CORS for a frontend served from another origin (comma-separated allow-list). Same-origin needs none.
  const allowed = new Set(String(corsOrigins || '').split(',').map((s) => s.trim()).filter(Boolean));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-Shop-Id');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(config.publicDir));

  const api = express.Router();
  api.get('/health', async (req, res) => {
    await db.one('SELECT 1 AS ok');
    res.status(200).json({ status: 'ok', db: 'ok', uptime: process.uptime() });
  });

  api.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // CSRF defence in depth (cookie is also SameSite=Strict): state-changing calls must carry a custom header,
    // which browsers will not attach to cross-site form posts.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'bookshop') {
      return next(forbidden('Missing X-Requested-With header'));
    }
    req.token = parseCookies(req.headers.cookie).sid;
    const user = await users.userForToken(db, req.token);
    if (user) {
      const shops = await users.shopsForUser(db, user, { includeInactive: user.role === 'owner' });
      const activeIds = shops.filter((s) => s.active).map((s) => s.id);
      const header = req.get('X-Shop-Id');
      let shopId = activeIds[0] ?? null;
      if (header) {
        const wanted = Number(header);
        // A shop the user may not use is refused at the point a shop is needed (requireShop -> 403).
        shopId = activeIds.includes(wanted) ? wanted : null;
      }
      req.user = user;
      req.ctx = { db, user, businessId: user.business_id, shopIds: shops.map((s) => s.id), shopId, tz: tzOffsetMinutes };
    }
    next();
  });

  // Live updates: after a successful change, tell every open screen of this business what changed.
  // The shop is taken from the response when it names one (a refund on another shop's bill), else the active shop;
  // business-wide changes (titles, suppliers, people) carry no shop and reach every shop's screens.
  const SHOP_WIDE = new Set(['sale', 'return', 'void', 'orders', 'stock', 'purchasing', 'expenses', 'layout', 'arrangement']);
  api.use((req, res, next) => {
    if (!req.ctx || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const events = eventsFor(req.method, req.path);
    if (!events.length) return next();
    let body;
    const json = res.json.bind(res);
    res.json = (b) => { body = b; return json(b); };
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
        const bodyShop = Number.isInteger(body?.shopId) ? body.shopId : (Number.isInteger(body?.adjustment?.shopId) ? body.adjustment.shopId : null);
      for (const event of events) {
        hub.publish({
          event, businessId: req.ctx.businessId, shopId: SHOP_WIDE.has(event) ? (bodyShop ?? req.ctx.shopId) : null,
          by: req.user.id, at: new Date().toISOString(),
        });
      }
    });
    next();
  });

  const authed = (req, res, next) => (req.user ? next() : next(unauthorized()));
  const role = (min) => (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (atLeast(req.user.role, min)) return next();
    return next(forbidden(min === 'owner' ? 'This action is limited to the business owner' : 'This action needs a manager or the owner'));
  };
  const manager = role('manager');
  const owner = role('owner');
  const ok = (res, data, status = 200) => res.status(status).json(data);
  const setSession = (res, token) => res.cookie('sid', token, {
    httpOnly: true, sameSite: 'strict', secure: config.secureCookies, maxAge: config.sessionHours * 3600 * 1000, path: '/',
  });

  // ---- auth
  api.post('/auth/register-business', async (req, res) => {
    const result = await users.registerBusiness(db, req.body || {});
    setSession(res, result.token);
    const { token, ...rest } = result;
    ok(res, rest, 201);
  });
  api.post('/auth/login', async (req, res) => {
    const { token, user } = await users.login(db, req.body || {}, req.ip);
    setSession(res, token);
    ok(res, { user });
  });
  api.post('/auth/logout', async (req, res) => {
    await users.logout(db, req.token);
    res.clearCookie('sid', { path: '/' });
    ok(res, { ok: true });
  });
  api.get('/auth/me', authed, async (req, res) => ok(res, { user: await users.profile(db, req.user) }));

  // ---- live updates (Server-Sent Events). Only events of the user's business and shops are forwarded.
  api.get('/events', authed, (req, res) => {
    const { businessId, shopIds } = req.ctx;
    req.socket.setTimeout(0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // do not buffer in proxies
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify({ event: 'ready' })}\n\n`);
    const unsubscribe = hub.subscribe((evt) => {
      if (evt.businessId !== businessId) return;
      if (evt.shopId != null && !shopIds.includes(evt.shopId)) return;
      const { businessId: _b, ...out } = evt;
      res.write(`data: ${JSON.stringify(out)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    req.on('close', () => { clearInterval(ping); unsubscribe(); });
  });
  api.post('/auth/password', owner, async (req, res) => { await users.changePassword(req.ctx, req.body || {}); ok(res, { ok: true }); });

  // ---- shops & users (owner manages; everyone can list the shops they work in)
  api.get('/shops', authed, async (req, res) => ok(res, await users.listShops(req.ctx)));
  api.post('/shops', owner, async (req, res) => ok(res, await users.createShop(req.ctx, req.body || {}), 201));
  api.put('/shops/:id', owner, async (req, res) => ok(res, await users.updateShop(req.ctx, idParam(req), req.body || {})));
  api.get('/users', owner, async (req, res) => ok(res, await users.listUsers(req.ctx)));
  api.post('/users', owner, async (req, res) => ok(res, await users.createUser(req.ctx, req.body), 201));
  api.put('/users/:id', owner, async (req, res) => ok(res, await users.updateUser(req.ctx, idParam(req), req.body)));
  api.post('/users/:id/active', owner, async (req, res) => ok(res, await users.setActive(req.ctx, idParam(req), !!(req.body && req.body.active))));
  api.post('/users/:id/password', owner, async (req, res) => { await users.resetPassword(req.ctx, idParam(req), req.body && req.body.newPassword); ok(res, { ok: true }); });

  // ---- settings
  api.get('/settings', authed, async (req, res) => ok(res, await settings.publicSettings(req.ctx)));
  api.put('/settings', owner, async (req, res) => ok(res, await settings.updateSettings(req.ctx, req.body)));

  // ---- global ISBN catalogue
  api.get('/catalog/search', authed, async (req, res) => ok(res, await catalog.search(req.ctx, req.query)));
  api.get('/catalog/categories', authed, async (req, res) => ok(res, await catalog.categories(req.ctx)));
  api.get('/catalog/:isbn', authed, async (req, res) => ok(res, await catalog.getByIsbn(req.ctx, req.params.isbn)));

  // ---- business titles + stock in the active shop
  api.get('/books', authed, async (req, res) => ok(res, await books.search(req.ctx, {
    q: req.query.q, genre: req.query.genre, lowOnly: req.query.low === '1',
    includeInactive: req.query.inactive === '1', limit: req.query.limit, offset: req.query.offset,
  })));
  api.get('/books/genres', authed, async (req, res) => ok(res, await books.genres(req.ctx)));
  api.post('/books/from-catalog', manager, async (req, res) => ok(res, await books.createFromCatalog(req.ctx, req.body), 201));
  api.post('/books/batch-location', manager, async (req, res) => ok(res, await books.batchAssignLocation(req.ctx, req.body)));
  api.get('/books/:id', authed, async (req, res) => ok(res, await books.get(req.ctx, idParam(req))));
  api.post('/books', manager, async (req, res) => ok(res, await books.create(req.ctx, req.body), 201));
  api.put('/books/:id', manager, async (req, res) => ok(res, await books.update(req.ctx, idParam(req), req.body)));
  api.put('/books/:id/location', manager, async (req, res) => ok(res, await books.setLocation(req.ctx, idParam(req), req.body)));
  api.post('/books/:id/active', manager, async (req, res) => ok(res, await books.setActive(req.ctx, idParam(req), !!(req.body && req.body.active))));
  api.get('/books/:id/movements', authed, async (req, res) => ok(res, await inventory.movements(req.ctx, idParam(req), req.query.limit)));
  api.post('/books/:id/adjust', manager, async (req, res) => ok(res, await inventory.adjustStock(req.ctx, idParam(req), req.body)));
  api.get('/books/:id/suppliers', manager, async (req, res) => ok(res, await suppliers.suppliersForBook(req.ctx, idParam(req))));
  api.get('/inventory', authed, async (req, res) => ok(res, await inventory.stockOverview(req.ctx, { lowOnly: req.query.low === '1', q: String(req.query.q || '') })));
  api.get('/shelves', authed, async (req,res) => ok(res,await arrangement.listShelves(req.ctx)));
  api.post('/shelves/layout', manager, async (req,res) => ok(res,await arrangement.createLayout(req.ctx,req.body),201));
  api.post('/arrangement/suggest-migration', manager, async (req,res) => ok(res,await arrangement.suggestMigrationShelves(req.ctx)));
  api.put('/shelves/:id', manager, async (req,res) => ok(res,await arrangement.updateShelf(req.ctx,idParam(req),req.body)));
  api.get('/shelves/:id/books', authed, async (req,res) => ok(res,await arrangement.shelfContents(req.ctx,idParam(req))));
  api.get('/arrangement', authed, async (req,res) => ok(res,await arrangement.listTasks(req.ctx)));
  api.post('/arrangement/confirm', authed, async (req,res) => ok(res,await arrangement.confirmTasks(req.ctx,req.body)));

  // ---- billing
  api.post('/sales', authed, async (req, res) => {
    const { sale, duplicate } = await sales.createSale(req.ctx, req.body);
    ok(res, { ...sale, duplicate }, duplicate ? 200 : 201);
  });
  api.get('/sales', authed, async (req, res) => ok(res, await sales.listSales(req.ctx, req.query)));
  api.get('/sales/:id', authed, async (req, res) => ok(res, await sales.getSale(req.ctx, idParam(req))));
  api.get('/sales/:id/pdf', authed, async (req, res) => {
    const sale = await sales.getSale(req.ctx, idParam(req));
    const pdf = await billPrinter.generateBillPdf(sale, await settings.publicSettings({ ...req.ctx, shopId: sale.shopId }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bill-${sale.billNo}.pdf"`);
    res.send(pdf);
  });
  api.get('/sales/:id/html', authed, async (req, res) => {
    const sale = await sales.getSale(req.ctx, idParam(req));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(billPrinter.renderBillHtml(sale, await settings.publicSettings({ ...req.ctx, shopId: sale.shopId })));
  });
  api.post('/sales/:id/void', owner, async (req, res) => ok(res, await sales.voidSale(req.ctx, idParam(req), req.body)));
  api.post('/sales/:id/refund', authed, async (req, res) => ok(res, await sales.refundItem(req.ctx, idParam(req), req.body)));
  api.post('/sales/:id/exchange', authed, async (req, res) => ok(res, await sales.exchangeItem(req.ctx, idParam(req), req.body)));
  api.post('/sales/:id/adjustments', authed, async (req, res) => {
    const result = await adjustments.createAdjustment(req.ctx, idParam(req), req.body);
    ok(res, result, result.duplicate ? 200 : 201);
  });
  api.get('/adjustments', authed, async (req, res) => ok(res, await adjustments.listAdjustments(req.ctx, req.query)));
  api.get('/adjustments/:id', authed, async (req, res) => ok(res, await adjustments.getAdjustment(req.ctx, idParam(req))));

  // ---- phone orders (active shop)
  api.get('/orders', authed, async (req, res) => ok(res, await orders.listOrders(req.ctx, req.query)));
  api.post('/orders', authed, async (req, res) => ok(res, await orders.createOrder(req.ctx, req.body), 201));
  api.get('/orders/:id', authed, async (req, res) => ok(res, await orders.getOrder(req.ctx, idParam(req))));
  api.put('/orders/:id', authed, async (req, res) => ok(res, await orders.modifyOrder(req.ctx, idParam(req), req.body)));
  api.post('/orders/:id/status', authed, async (req, res) => ok(res, await orders.setStatus(req.ctx, idParam(req), req.body)));
  api.post('/orders/:id/cancel', authed, async (req, res) => ok(res, await orders.cancelOrder(req.ctx, idParam(req), req.body)));
  api.post('/orders/:id/payments', authed, async (req, res) => ok(res, await orders.addPayment(req.ctx, idParam(req), req.body), 201));
  api.post('/orders/:id/refund', authed, async (req, res) => ok(res, await orders.refund(req.ctx, idParam(req), req.body)));
  api.post('/orders/:id/fulfil', authed, async (req, res) => ok(res, await orders.fulfilOrder(req.ctx, idParam(req), req.body)));

  // ---- suppliers & purchasing (managers and owner: contains supplier pricing)
  api.get('/suppliers', manager, async (req, res) => ok(res, await suppliers.list(req.ctx, { q: String(req.query.q || ''), includeInactive: req.query.inactive === '1' })));
  api.post('/suppliers', manager, async (req, res) => ok(res, await suppliers.create(req.ctx, req.body), 201));
  api.get('/suppliers/:id', manager, async (req, res) => ok(res, await suppliers.get(req.ctx, idParam(req))));
  api.put('/suppliers/:id', manager, async (req, res) => ok(res, await suppliers.update(req.ctx, idParam(req), req.body)));
  api.post('/suppliers/:id/active', manager, async (req, res) => ok(res, await suppliers.setActive(req.ctx, idParam(req), !!(req.body && req.body.active))));
  api.put('/suppliers/:id/books/:bookId', manager, async (req, res) => ok(res, await suppliers.setBookPrice(req.ctx, idParam(req), idParam(req, 'bookId'), req.body)));
  api.delete('/suppliers/:id/books/:bookId', manager, async (req, res) => ok(res, await suppliers.removeBook(req.ctx, idParam(req), idParam(req, 'bookId'))));
  api.get('/purchase-orders', manager, async (req, res) => ok(res, await purchasing.listPos(req.ctx, { status: req.query.status, supplierId: req.query.supplierId })));
  api.post('/purchase-orders', manager, async (req, res) => ok(res, await purchasing.createPo(req.ctx, req.body), 201));
  api.get('/purchase-orders/:id', manager, async (req, res) => ok(res, await purchasing.getPo(req.ctx, idParam(req))));
  api.post('/purchase-orders/:id/cancel', manager, async (req, res) => ok(res, await purchasing.cancelPo(req.ctx, idParam(req))));
  api.post('/purchase-orders/:id/receive', manager, async (req, res) => {
    const r = await purchasing.receive(req.ctx, idParam(req), req.body);
    ok(res, r, r.duplicate ? 200 : 201);
  });

  // ---- insights (managers see their own shops; the owner sees every shop)
  api.get('/restock', manager, async (req, res) => ok(res, await restock.recommendations(req.ctx, {
    lookbackDays: req.query.lookbackDays === undefined ? undefined : Number(req.query.lookbackDays),
    coverDays: req.query.coverDays === undefined ? undefined : Number(req.query.coverDays),
  })));
  api.get('/dashboard', manager, async (req, res) => ok(res, await dashboard.dashboard(req.ctx, req.query)));
  api.get('/sales-report', manager, async (req, res) => ok(res, await dashboard.salesReport(req.ctx, req.query)));
  api.get('/reports/statement', manager, async (req, res) => ok(res, await dashboard.statement(req.ctx, req.query)));
  api.get('/expenses', manager, async (req, res) => ok(res, await expenses.list(req.ctx, req.query)));
  api.post('/expenses', manager, async (req, res) => ok(res, await expenses.create(req.ctx, req.body), 201));
  api.delete('/expenses/:id', manager, async (req, res) => { await expenses.remove(req.ctx, idParam(req)); ok(res, { ok: true }); });

  api.use((req, res, next) => next(new AppError(404, 'not_found', 'Unknown API endpoint')));
  app.use('/api', api);
  // Some hosts (Vercel services) forward /api/* with the prefix stripped; serve the same routes there too.
  app.use(api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large' } });
    if (PG_CONFLICT.has(err.code)) return res.status(409).json({ error: { code: 'conflict', message: 'The change conflicts with existing data' } });
    if (err.code === '22P02' || err.code === '22003') return res.status(400).json({ error: { code: 'bad_request', message: 'A value in the request is invalid' } });
    if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '08006', '08001'].includes(err.code)
        || /timeout exceeded when trying to connect|Connection terminated/i.test(err.message || '')) {
      console.error(`Database unreachable (${err.code || err.message})`);
      return res.status(503).json({ error: { code: 'db_unavailable', message: 'Cannot reach the database right now. Please try again in a moment.' } });
    }
    console.error('Unhandled error:', err.message); // never log request bodies (may contain passwords)
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server' } });
  });

  return app;
}

module.exports = { createApp };
