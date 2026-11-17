// Database socket that survives flaky DNS.
//
// Some networks (home routers, college Wi-Fi) intermittently fail to look up the Supabase pooler hostname
// (ENOTFOUND / EAI_AGAIN) even though the database is up, and Windows then caches the failure for minutes.
// Every lookup that succeeds is remembered (in memory and in a small file in the OS temp folder, so it
// survives restarts). When a lookup fails, it is retried briefly and then the last known addresses are used.
// TLS still verifies against the hostname (pg sets servername from the host), so nothing about security changes.

const dns = require('node:dns');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const CACHE_FILE = path.join(os.tmpdir(), 'bookshop-db-dns-cache.json');
const RETRYABLE = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT', 'ESERVFAIL']);
const memory = new Map(); // hostname -> [{ address, family }]
const warned = new Set();

function readFileCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}
function remember(hostname, addresses) {
  memory.set(hostname, addresses);
  try {
    const all = readFileCache();
    all[hostname] = { addresses, savedAt: new Date().toISOString() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(all));
  } catch { /* cache is best effort */ }
}
function lastKnown(hostname) {
  return memory.get(hostname) || readFileCache()[hostname]?.addresses || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lookupAll = (hostname) => new Promise((resolve, reject) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
});

async function resolveHost(hostname) {
  let lastErr;
  for (const wait of [0, 300, 900]) {
    if (wait) await sleep(wait);
    try {
      const addresses = await lookupAll(hostname);
      if (addresses.length) {
        remember(hostname, addresses);
        warned.delete(hostname);
        return addresses;
      }
    } catch (err) {
      lastErr = err;
      if (!RETRYABLE.has(err.code)) throw err;
    }
  }
  const cached = lastKnown(hostname);
  if (cached && cached.length) {
    if (!warned.has(hostname)) {
      warned.add(hostname);
      console.warn(`DNS lookup for ${hostname} failed (${lastErr?.code}); using its last known address. Check this computer's DNS.`);
    }
    return cached;
  }
  throw lastErr;
}

// net.connect lookup hook: (hostname, options, callback) with options.all for Happy Eyeballs.
function lookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolveHost(hostname).then((addresses) => {
    const family = typeof options === 'number' ? options : options?.family;
    const list = family ? addresses.filter((a) => a.family === family) : addresses;
    const usable = list.length ? list : addresses;
    if (options?.all) callback(null, usable);
    else callback(null, usable[0].address, usable[0].family);
  }, (err) => callback(err));
}

class ResilientSocket extends net.Socket {
  connect(...args) {
    // pg calls connect(port, host); hostnames (not IPs or socket paths) get the resilient lookup.
    const [port, host] = args;
    if (typeof port === 'number' && typeof host === 'string' && host && !net.isIP(host) && !host.startsWith('/')) {
      return super.connect({ port, host, lookup });
    }
    return super.connect(...args);
  }
}

module.exports = { ResilientSocket, resolveHost, CACHE_FILE };
