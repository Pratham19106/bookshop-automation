const { badRequest } = require('./errors');

function str(v, field, { required = false, max = 200 } = {}) {
  if (v === undefined || v === null) {
    if (required) throw badRequest(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw badRequest(`${field} must be text`);
  const s = v.trim();
  if (required && !s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return s;
}

function int(v, field, { min = 0, max = 1e9, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw badRequest(`${field} must be a whole number`);
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}`);
  return n;
}

function oneOf(v, field, allowed, { required = true, fallback } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return fallback;
  }
  if (!allowed.includes(v)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

function date(v, field, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw badRequest(`${field} must be a date in YYYY-MM-DD format`);
  }
  return v;
}

function array(v, field, { min = 1, max = 500 } = {}) {
  if (!Array.isArray(v)) throw badRequest(`${field} must be a list`);
  if (v.length < min) throw badRequest(`${field} must contain at least ${min} item(s)`);
  if (v.length > max) throw badRequest(`${field} must contain at most ${max} items`);
  return v;
}

function object(v, field = 'body') {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${field} must be an object`);
  return v;
}

// ISBN-10 / ISBN-13: strip hyphens/spaces, validate length and checksum. Returns normalised string or null when blank.
function isbn(v, field = 'isbn') {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${field} must be text`);
  const s = v.replace(/[\s-]/g, '').toUpperCase();
  if (!s) return null;
  if (/^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
    if ((10 - (sum % 10)) % 10 !== Number(s[12])) throw badRequest(`${field} has an invalid ISBN-13 check digit`);
    return s;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    if (sum % 11 !== 0) throw badRequest(`${field} has an invalid ISBN-10 check digit`);
    return s;
  }
  throw badRequest(`${field} must be a valid ISBN-10 or ISBN-13`);
}

module.exports = { str, int, oneOf, date, array, object, isbn };
