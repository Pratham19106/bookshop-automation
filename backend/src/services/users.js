const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const v = require('../lib/validate');
const { badRequest, unauthorized, conflict, notFound, AppError } = require('../lib/errors');
const { ROLES } = require('../lib/tenant');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD = 8;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,50}$/;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const publicUser = (u, shopIds = null) => (u ? {
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  role: u.role,
  active: u.active,
  businessId: u.business_id,
  ...(shopIds ? { shopIds } : {}),
} : null);

const shopToApi = (s) => ({ id: s.id, code: s.code, name: s.name, city: s.city, address: s.address, phone: s.phone, isHq: s.is_hq, active: s.active });

// Naive in-memory brute-force limiter: 5 failures per username/ip per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
function checkLimit(key) {
  const rec = failures.get(key);
  if (rec && Date.now() - rec.first < WINDOW_MS && rec.count >= 5) {
    throw new AppError(429, 'too_many_attempts', 'Too many failed sign-in attempts. Try again in a few minutes.');
  }
}
function noteFailure(key) {
  const rec = failures.get(key);
  if (!rec || Date.now() - rec.first >= WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else rec.count += 1;
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw badRequest(`Password must be at least ${MIN_PASSWORD} characters`);
  if (pw.length > 200) throw badRequest('Password is too long');
  return pw;
}

function validUsername(input) {
  const username = v.str(input, 'username', { required: true, max: 50 });
  if (!USERNAME_RE.test(username)) throw badRequest('username may only contain letters, digits, . _ - and must be 3+ characters');
  return username;
}

async function startSession(q, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q.query('DELETE FROM sessions WHERE expires_at < now()');
  await q.query(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), userId, config.sessionHours]);
  return token;
}

// Shops a user can act in: every shop of the business for an owner, the assigned ones otherwise.
async function shopsForUser(q, user, { includeInactive = false } = {}) {
  const rows = user.role === 'owner'
    ? await q.many(`SELECT * FROM shops WHERE business_id = $1 ${includeInactive ? '' : 'AND active'} ORDER BY is_hq DESC, name`, [user.business_id])
    : await q.many(`SELECT s.* FROM shops s JOIN user_shops us ON us.shop_id = s.id
                     WHERE us.user_id = $1 ${includeInactive ? '' : 'AND s.active'} ORDER BY s.is_hq DESC, s.name`, [user.id]);
  return rows;
}

// Everything the frontend needs after sign-in: user, business, and the shops they may switch between.
async function profile(q, user) {
  const business = await q.one('SELECT id, name, slug FROM businesses WHERE id = $1', [user.business_id]);
  const shops = (await shopsForUser(q, user)).map(shopToApi);
  return { ...publicUser(user, shops.map((s) => s.id)), business, shops };
}

async function login(db, { username, password }, ip = '') {
  const name = v.str(username, 'username', { required: true, max: 50 });
  if (typeof password !== 'string' || !password) throw badRequest('password is required');
  const key = `${name.toLowerCase()}|${ip}`;
  checkLimit(key);
  const user = await db.one('SELECT * FROM users WHERE lower(username) = lower($1)', [name]);
  // Compare even for unknown users to keep timing roughly constant.
  const ok = await bcrypt.compare(password, user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!user || !ok || !user.active) {
    noteFailure(key);
    throw unauthorized('Invalid username or password');
  }
  failures.delete(key);
  const token = await startSession(db, user.id);
  return { token, user: await profile(db, user) };
}

async function userForToken(db, token) {
  if (!token) return null;
  return db.one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [hashToken(token)]);
}

async function logout(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

async function assertShopsInBusiness(q, businessId, shopIds) {
  if (!shopIds.length) return;
  const rows = await q.many('SELECT id FROM shops WHERE business_id = $1 AND id = ANY($2::bigint[])', [businessId, shopIds]);
  if (rows.length !== new Set(shopIds).size) throw badRequest('One or more shops do not belong to this business');
}

function parseShopIds(input, role) {
  if (role === 'owner') return [];
  const ids = v.array(input ?? [], 'shopIds', { min: 1, max: 100 }).map((x) => v.int(x, 'shopId', { min: 1 }));
  return [...new Set(ids)];
}

async function insertUser(q, businessId, { username, fullName, password, role }) {
  const hash = await bcrypt.hash(validatePassword(password), BCRYPT_ROUNDS);
  try {
    return await q.one(`INSERT INTO users(business_id, username, full_name, password_hash, role)
                        VALUES ($1, $2, $3, $4, $5) RETURNING *`, [businessId, username, fullName, hash, role]);
  } catch (e) {
    if (e.code === '23505') throw conflict(`Username "${username}" is already taken`);
    throw e;
  }
}

async function setUserShops(q, businessId, userId, shopIds) {
  await q.query('DELETE FROM user_shops WHERE user_id = $1', [userId]);
  for (const shopId of shopIds) {
    await q.query('INSERT INTO user_shops(business_id, user_id, shop_id) VALUES ($1, $2, $3)', [businessId, userId, shopId]);
  }
}

// Owner adds a manager / staff member (assigned to one or more shops) or a co-owner.
async function createUser(ctx, input) {
  v.object(input);
  const username = validUsername(input.username);
  const fullName = v.str(input.fullName, 'fullName', { required: true, max: 100 });
  const role = v.oneOf(input.role, 'role', ROLES);
  const shopIds = parseShopIds(input.shopIds, role);
  return ctx.db.tx(async (q) => {
    await assertShopsInBusiness(q, ctx.businessId, shopIds);
    const user = await insertUser(q, ctx.businessId, { username, fullName, password: input.password, role });
    await setUserShops(q, ctx.businessId, user.id, shopIds);
    return publicUser(user, shopIds);
  });
}

async function listUsers(ctx) {
  const rows = await ctx.db.many(`SELECT u.*, COALESCE(array_agg(us.shop_id ORDER BY us.shop_id) FILTER (WHERE us.shop_id IS NOT NULL), '{}') AS shop_ids
                                    FROM users u LEFT JOIN user_shops us ON us.user_id = u.id
                                   WHERE u.business_id = $1 GROUP BY u.id ORDER BY lower(u.username)`, [ctx.businessId]);
  return rows.map((u) => publicUser(u, u.shop_ids.map(Number)));
}

async function loadUser(q, ctx, id) {
  const user = await q.one('SELECT * FROM users WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, ctx.businessId]);
  if (!user) throw notFound('User');
  return user;
}

async function activeOwnersOtherThan(q, ctx, id) {
  return (await q.one(`SELECT COUNT(*) AS c FROM users WHERE business_id = $1 AND role = 'owner' AND active AND id <> $2`, [ctx.businessId, id])).c;
}

// Change role and / or shop assignments.
async function updateUser(ctx, id, input) {
  v.object(input);
  return ctx.db.tx(async (q) => {
    const user = await loadUser(q, ctx, id);
    const role = input.role === undefined ? user.role : v.oneOf(input.role, 'role', ROLES);
    const fullName = input.fullName === undefined ? user.full_name : v.str(input.fullName, 'fullName', { required: true, max: 100 });
    const username = input.username === undefined ? user.username : validUsername(input.username);
    if (user.role === 'owner' && role !== 'owner') {
      if (user.id === ctx.user.id) throw badRequest('You cannot remove your own owner role');
      if (await activeOwnersOtherThan(q, ctx, id) === 0) throw badRequest('At least one active owner is required');
    }
    try {
      await q.query('UPDATE users SET role = $2, full_name = $3, username = $4 WHERE id = $1', [id, role, fullName, username]);
    } catch (e) {
      if (e.code === '23505') throw conflict(`Username "${username}" is already taken`);
      throw e;
    }
    let shopIds = [];
    if (role !== 'owner') {
      shopIds = input.shopIds === undefined
        ? (await q.many('SELECT shop_id FROM user_shops WHERE user_id = $1', [id])).map((r) => r.shop_id)
        : parseShopIds(input.shopIds, role);
      if (!shopIds.length) throw badRequest('Managers and staff must be assigned to at least one shop');
      await assertShopsInBusiness(q, ctx.businessId, shopIds);
    }
    await setUserShops(q, ctx.businessId, id, shopIds);
    return publicUser({ ...user, role, full_name: fullName, username }, shopIds);
  });
}

async function setActive(ctx, id, active) {
  return ctx.db.tx(async (q) => {
    const user = await loadUser(q, ctx, id);
    if (!active) {
      if (user.id === ctx.user.id) throw badRequest('You cannot deactivate your own account');
      if (user.role === 'owner' && await activeOwnersOtherThan(q, ctx, id) === 0) throw badRequest('At least one active owner is required');
    }
    await q.query('UPDATE users SET active = $2 WHERE id = $1', [id, !!active]);
    if (!active) await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return publicUser({ ...user, active: !!active });
  });
}

async function changePassword(ctx, { currentPassword, newPassword }) {
  const row = await ctx.db.one('SELECT password_hash FROM users WHERE id = $1', [ctx.user.id]);
  if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, row.password_hash))) {
    throw badRequest('Current password is incorrect');
  }
  const hash = await bcrypt.hash(validatePassword(newPassword), BCRYPT_ROUNDS);
  await ctx.db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [ctx.user.id, hash]);
}

async function resetPassword(ctx, id, newPassword) {
  const hash = await bcrypt.hash(validatePassword(newPassword), BCRYPT_ROUNDS);
  await ctx.db.tx(async (q) => {
    if (!(await q.run('UPDATE users SET password_hash = $3 WHERE id = $1 AND business_id = $2', [id, ctx.businessId, hash]))) throw notFound('User');
    await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  });
}

// ---------------------------------------------------------------- shops

function parseShop(input, { partial = false } = {}) {
  v.object(input);
  const out = {};
  if (!partial || input.name !== undefined) out.name = v.str(input.name, 'name', { required: true, max: 100 });
  for (const [k, max] of [['city', 80], ['address', 300], ['phone', 60]]) {
    if (!partial || input[k] !== undefined) out[k] = v.str(input[k], k, { max });
  }
  if (input.code !== undefined && input.code !== '') {
    out.code = v.str(input.code, 'code', { max: 12 }).toUpperCase();
    if (!/^[A-Z0-9-]{1,12}$/.test(out.code)) throw badRequest('code may only contain letters, digits and -');
  }
  return out;
}

async function insertShop(q, businessId, s, isHq) {
  const { n } = await q.one('SELECT COUNT(*) AS n FROM shops WHERE business_id = $1', [businessId]);
  const code = s.code || `S${String(n + 1).padStart(2, '0')}`;
  try {
    return await q.one(`INSERT INTO shops(business_id, code, name, city, address, phone, is_hq) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [businessId, code, s.name, s.city || '', s.address || '', s.phone || '', isHq]);
  } catch (e) {
    if (e.code === '23505') throw conflict(`Shop code "${code}" is already used in this business`);
    throw e;
  }
}

async function listShops(ctx) {
  return (await shopsForUser(ctx.db, ctx.user, { includeInactive: ctx.user.role === 'owner' })).map(shopToApi);
}

async function createShop(ctx, input) {
  const s = parseShop(input);
  return ctx.db.tx(async (q) => {
    const { n } = await q.one('SELECT COUNT(*) AS n FROM shops WHERE business_id = $1', [ctx.businessId]);
    return shopToApi(await insertShop(q, ctx.businessId, s, n === 0));
  });
}

async function updateShop(ctx, id, input) {
  const s = parseShop(input, { partial: true });
  return ctx.db.tx(async (q) => {
    const shop = await q.one('SELECT * FROM shops WHERE id = $1 AND business_id = $2 FOR UPDATE', [id, ctx.businessId]);
    if (!shop) throw notFound('Shop');
    if (input.isHq === true && !shop.is_hq) {
      await q.query('UPDATE shops SET is_hq = false WHERE business_id = $1', [ctx.businessId]);
      await q.query('UPDATE shops SET is_hq = true WHERE id = $1', [id]);
    }
    if (input.active !== undefined) {
      if (!input.active && shop.is_hq) throw badRequest('The head-office shop cannot be deactivated; make another shop the HQ first');
      s.active = !!input.active;
    }
    const cols = Object.keys(s);
    if (cols.length) {
      try {
        await q.query(`UPDATE shops SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => s[c])]);
      } catch (e) {
        if (e.code === '23505') throw conflict(`Shop code "${s.code}" is already used in this business`);
        throw e;
      }
    }
    return shopToApi(await q.one('SELECT * FROM shops WHERE id = $1', [id]));
  });
}

// ---------------------------------------------------------------- business registration

function slugify(name) {
  return (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'shop').slice(0, 40);
}

/**
 * Sign-up: creates the business, its settings, its shops (at least one; the first is HQ) and the owner,
 * then signs the owner in. One transaction.
 */
async function registerBusiness(db, input) {
  v.object(input);
  const businessName = v.str(input.businessName, 'businessName', { required: true, max: 100 });
  const ownerName = v.str(input.ownerName, 'ownerName', { required: true, max: 100 });
  const username = validUsername(input.username);
  const email = v.str(input.email, 'email', { required: true, max: 100 });
  const phone = v.str(input.phone, 'phone', { max: 40 });
  const rawShops = Array.isArray(input.shops) ? input.shops : Array.isArray(input.outlets) ? input.outlets : [];
  const shops = rawShops.map((s, i) => {
    if (!s || typeof s !== 'object' || !String(s.name || '').trim()) throw badRequest(`Shop #${i + 1} must have a name`);
    return { ...parseShop(s), isHq: !!(s.isHq ?? s.isHeadquarters) };
  });
  if (!shops.length) shops.push({ name: businessName, city: '', address: '', phone, isHq: true });
  let hq = shops.findIndex((s) => s.isHq);
  if (hq < 0) hq = 0;
  validatePassword(input.password);

  return db.tx(async (q) => {
    if (await q.one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) {
      throw conflict(`Username "${username}" is already taken. Please choose another username.`);
    }
    const slug = `${slugify(businessName)}-${crypto.randomBytes(3).toString('hex')}`;
    const business = await q.one('INSERT INTO businesses(name, slug, email, phone) VALUES ($1, $2, $3, $4) RETURNING id, name, slug',
      [businessName, slug, email, phone]);
    await q.query('INSERT INTO business_settings(business_id) VALUES ($1)', [business.id]);
    const created = [];
    for (const [i, s] of shops.entries()) created.push(await insertShop(q, business.id, s, i === hq));
    const owner = await insertUser(q, business.id, { username, fullName: ownerName, password: input.password, role: 'owner' });
    const token = await startSession(q, owner.id);
    return { ok: true, token, business, shops: created.map(shopToApi), user: await profile(q, owner) };
  });
}

module.exports = {
  login, logout, userForToken, profile, shopsForUser,
  createUser, listUsers, updateUser, setActive, changePassword, resetPassword,
  listShops, createShop, updateShop, registerBusiness,
  publicUser, shopToApi, hashToken,
};
