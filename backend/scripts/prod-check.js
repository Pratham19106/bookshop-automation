// Read-only check of a deployed site. Usage:
//   node scripts/prod-check.js https://your-site.vercel.app <username> <password>
// Checks: the site loads, /api/health reaches the database, sign-in works through the same origin (cookie),
// shops / dashboard / financial statement answer, and the live-update stream opens and stays open.
// It changes nothing except creating (and then ending) one login session.
const [base, username, password] = process.argv.slice(2);
if (!base || !username || !password) {
  console.error('Usage: node scripts/prod-check.js <site-url> <username> <password>');
  process.exit(2);
}
const url = (p) => base.replace(/\/+$/, '') + p;
let cookie = '';
const results = [];

async function call(method, p, body) {
  const res = await fetch(url(p), {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bookshop', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set && set.startsWith('sid=')) cookie = set.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push(true);
    console.log(`  ok    ${name} (${Date.now() - t0} ms)${note ? ` - ${note}` : ''}`);
  } catch (e) {
    results.push(false);
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  console.log(`Checking ${base}\n(the first request can take ~30 s if the free Render service was asleep)\n`);
  await step('site loads', async () => {
    const r = await fetch(url('/'));
    expect(r.ok, `HTTP ${r.status}`);
    expect(/<div id="root">/.test(await r.text()), 'not the app page');
  });
  await step('API reachable and database up (/api/health)', async () => {
    const r = await call('GET', '/api/health');
    expect(r.status === 200 && r.json?.db === 'ok', `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  });
  await step('sign in (session cookie on this site)', async () => {
    const r = await call('POST', '/api/auth/login', { username, password });
    expect(r.status === 200, `HTTP ${r.status} ${r.json?.error?.message || ''}`);
    expect(cookie, 'no session cookie came back: the /api rewrite or cookie settings are wrong');
    const set = r.headers.get('set-cookie') || '';
    if (base.startsWith('https:')) expect(/secure/i.test(set), 'cookie is not Secure: set COOKIE_SECURE=1 on Render');
    return `signed in as ${r.json.user.username} (${r.json.user.role})`;
  });
  await step('profile and shops', async () => {
    const r = await call('GET', '/api/shops');
    expect(r.status === 200 && Array.isArray(r.json), `HTTP ${r.status}`);
    return r.json.map((s) => s.code).join(', ');
  });
  await step('dashboard', async () => {
    const r = await call('GET', '/api/dashboard?outlet=all');
    expect(r.status === 200, `HTTP ${r.status} ${r.json?.error?.message || ''}`);
    return `net sales (30 days) ${(r.json.summary.netSalesCents / 100).toFixed(2)}`;
  });
  await step('financial statement', async () => {
    const r = await call('GET', '/api/reports/statement?outlet=all');
    expect(r.status === 200, `HTTP ${r.status} ${r.json?.error?.message || ''}`);
    return `${r.json.statementNo}, columns ${r.json.columns.map((c) => c.label).join(' / ')}`;
  });
  await step('live updates stream opens and stays open', async () => {
    const ac = new AbortController();
    const res = await fetch(url('/api/events'), { headers: { Cookie: cookie }, signal: ac.signal });
    expect(res.status === 200, `HTTP ${res.status}`);
    expect(/text\/event-stream/.test(res.headers.get('content-type') || ''), 'not an event stream');
    const reader = res.body.getReader();
    const first = await Promise.race([reader.read(), new Promise((_, rej) => setTimeout(() => rej(new Error('no data within 10 s (proxy buffering?)')), 10000))]);
    const text = new TextDecoder().decode(first.value || new Uint8Array());
    expect(/retry|ready/.test(text), `unexpected first chunk: ${text.slice(0, 80)}`);
    ac.abort();
  });
  await step('sign out', async () => {
    const r = await call('POST', '/api/auth/logout', {});
    expect(r.status === 200, `HTTP ${r.status}`);
  });
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
})();
