const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { tx } = require('../db');
const v = require('../lib/validate');
const { badRequest, unauthorized, conflict, notFound, AppError } = require('../lib/errors');
const { syncBusinessToSupabase } = require('../lib/supabase');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD = 8;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const publicUser = (u) => {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role,
    active: !!u.active,
    businessId: u.business_id || null,
    franchiseId: u.franchise_id || null,
  };
};

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

function login(db, { username, password }, ip = '') {
  const name = v.str(username, 'username', { required: true, max: 50 });
  if (typeof password !== 'string' || !password) throw badRequest('password is required');
  const key = `${name.toLowerCase()}|${ip}`;
  checkLimit(key);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
  // Compare even for unknown users to keep timing roughly constant.
  const ok = bcrypt.compareSync(password, user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!user || !ok || !user.active) {
    noteFailure(key);
    throw unauthorized('Invalid username or password');
  }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600 * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, expires);

  const business = user.business_id ? db.prepare('SELECT * FROM businesses WHERE id = ?').get(user.business_id) : null;
  const franchises = user.business_id ? db.prepare("SELECT * FROM franchises WHERE business_id = ? AND status = 'active'").all(user.business_id) : [];

  return {
    token,
    user: {
      ...publicUser(user),
      business: business ? { id: business.id, name: business.name, slug: business.slug } : null,
      franchises: franchises.length > 0 ? franchises : null,
    },
  };
}

function userForToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(hashToken(token), new Date().toISOString());
  return row || null;
}

function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function createUser(db, input) {
  v.object(input);
  const username = v.str(input.username, 'username', { required: true, max: 50 });
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) throw badRequest('username may only contain letters, digits, . _ - and must be 3+ characters');
  const fullName = v.str(input.fullName, 'fullName', { required: true, max: 100 });
  const role = v.oneOf(input.role, 'role', ['owner', 'staff']);
  const businessId = input.businessId || 'biz_default';
  const franchiseId = input.franchiseId || null;
  const hash = bcrypt.hashSync(validatePassword(input.password), BCRYPT_ROUNDS);
  try {
    const r = db.prepare('INSERT INTO users(username, full_name, password_hash, role, business_id, franchise_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(username, fullName, hash, role, businessId, franchiseId);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw conflict(`Username "${username}" is already taken`);
    throw e;
  }
}

/**
 * Multi-Business Registration
 * Registers a new bookshop business/chain, creates its >= 2 outlets, creates the owner user,
 * and generates an active authenticated session token.
 */
function registerBusiness(db, input) {
  v.object(input);
  const businessName = v.str(input.businessName, 'businessName', { required: true, max: 100 });
  const ownerName = v.str(input.ownerName, 'ownerName', { required: true, max: 100 });
  const username = v.str(input.username, 'username', { required: true, max: 50 });
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) throw badRequest('username may only contain letters, digits, . _ - and must be 3+ characters');
  const email = v.str(input.email, 'email', { required: true, max: 100 });
  const phone = input.phone ? String(input.phone).trim() : '';
  const outlets = Array.isArray(input.outlets) ? input.outlets : [];

  if (outlets.length < 2) {
    throw badRequest('Constraint Requirement: A minimum of 2 outlets/franchises is required to register a bookshop chain.');
  }

  for (let i = 0; i < outlets.length; i++) {
    const o = outlets[i];
    if (!o || typeof o !== 'object' || !o.name || !String(o.name).trim()) {
      throw badRequest(`Outlet #${i + 1} must have a valid branch name.`);
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    throw conflict(`Username "${username}" is already taken. Please choose another username.`);
  }

  const businessId = 'biz_' + crypto.randomBytes(6).toString('hex');
  const slug = (businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'shop') + '-' + businessId.slice(4, 8);
  const passwordHash = bcrypt.hashSync(validatePassword(input.password), BCRYPT_ROUNDS);

  const res = tx(db, () => {
    // 1. Insert Business
    db.prepare('INSERT INTO businesses(id, name, slug, owner_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)')
      .run(businessId, businessName, slug, ownerName, email, phone);

    // 2. Insert Outlets (minimum 2)
    const insertedOutlets = [];
    outlets.forEach((o, idx) => {
      const franchiseId = `${businessId}_fr_${idx + 1}`;
      const code = `FR-${String(idx + 1).padStart(3, '0')}`;
      const name = String(o.name).trim();
      const city = o.city ? String(o.city).trim() : 'Hyderabad';
      const address = o.address ? String(o.address).trim() : '';
      const outletPhone = o.phone ? String(o.phone).trim() : phone;
      const isHq = (idx === 0 || !!o.isHeadquarters) ? 1 : 0;

      db.prepare(`INSERT INTO franchises(id, business_id, code, name, city, address, phone, email, is_headquarters, status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
        .run(franchiseId, businessId, code, name, city, address, outletPhone, email, isHq);

      insertedOutlets.push({
        id: franchiseId,
        businessId,
        code,
        name,
        city,
        address,
        phone: outletPhone,
        isHeadquarters: !!isHq,
        status: 'active',
      });
    });

    // 3. Insert Owner User
    const r = db.prepare(`INSERT INTO users(username, full_name, password_hash, role, active, business_id, franchise_id)
                          VALUES (?, ?, ?, 'owner', 1, ?, NULL)`)
      .run(username, ownerName, passwordHash, businessId);
    const userId = Number(r.lastInsertRowid);
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    // 4. Starter catalogue for new chain
    const starterBooks = [
      ['Atomic Habits', 'James Clear', 'Self-Help', 49900, 25, 'A', '1', '1'],
      ['The Psychology of Money', 'Morgan Housel', 'Finance', 39900, 20, 'A', '1', '2'],
      ['Deep Work', 'Cal Newport', 'Self-Help', 45000, 15, 'A', '2', '1'],
      ['Sapiens', 'Yuval Noah Harari', 'History', 55000, 18, 'B', '1', '1'],
      ['Clean Code', 'Robert C. Martin', 'Science & Tech', 89900, 12, 'B', '2', '1'],
      ['The Alchemist', 'Paulo Coelho', 'Fiction', 29900, 30, 'C', '1', '1'],
    ];

    starterBooks.forEach(([title, author, genre, priceCents, qty, aisle, rack, shelf], idx) => {
      const isbn = `978${String(8000000000 + idx * 1337).slice(0, 10)}`;
      db.prepare(`INSERT INTO books(title, author, isbn, genre, price_cents, cost_cents, stock_qty, aisle, rack, shelf, business_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(title, author, isbn, genre, priceCents, Math.round(priceCents * 0.6), qty, aisle, rack, shelf, businessId);
    });

    // 5. Generate Session Token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + config.sessionHours * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);

    const business = {
      id: businessId,
      name: businessName,
      slug,
      ownerName,
      email,
      phone,
    };

    return {
      ok: true,
      token,
      user: {
        ...publicUser(userRow),
        business,
        franchises: insertedOutlets,
      },
      business,
      outlets: insertedOutlets,
    };
  });

  // Background sync to Supabase if configured
  syncBusinessToSupabase(res).catch(() => {});

  return res;
}

function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);
}

function setActive(db, actor, id, active) {
  return tx(db, () => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('User');
    if (!active) {
      if (user.id === actor.id) throw badRequest('You cannot deactivate your own account');
      const owners = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'owner' AND active = 1 AND id <> ?").get(id).c;
      if (user.role === 'owner' && owners === 0) throw badRequest('At least one active owner is required');
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  });
}

function changePassword(db, user, { currentPassword, newPassword }) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (typeof currentPassword !== 'string' || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    throw badRequest('Current password is incorrect');
  }
  const hash = bcrypt.hashSync(validatePassword(newPassword), BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
}

function resetPassword(db, id, newPassword) {
  const hash = bcrypt.hashSync(validatePassword(newPassword), BCRYPT_ROUNDS);
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  if (!r.changes) throw notFound('User');
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

module.exports = {
  login,
  logout,
  userForToken,
  createUser,
  registerBusiness,
  listUsers,
  setActive,
  changePassword,
  resetPassword,
  publicUser,
};
