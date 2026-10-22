const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { tx } = require('../db');
const v = require('../lib/validate');
const { badRequest, unauthorized, conflict, notFound, AppError } = require('../lib/errors');

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD = 8;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const publicUser = (u) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, active: !!u.active });

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
  return { token, user: publicUser(user) };
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
  const hash = bcrypt.hashSync(validatePassword(input.password), BCRYPT_ROUNDS);
  try {
    const r = db.prepare('INSERT INTO users(username, full_name, password_hash, role) VALUES (?, ?, ?, ?)').run(username, fullName, hash, role);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw conflict(`Username "${username}" is already taken`);
    throw e;
  }
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

module.exports = { login, logout, userForToken, createUser, listUsers, setActive, changePassword, resetPassword, publicUser };
