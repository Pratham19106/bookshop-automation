// Browser end-to-end check of the real UI against a seeded temporary database.
// Run: npm run test:e2e   (needs Chrome/Edge; set CHROME_PATH if it is not in a standard location)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const { openDatabase } = require('../src/db');
const { seedDemo } = require('../src/db/seed');
const { createApp } = require('../src/app');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

(async () => {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-e2e-'));
  const db = openDatabase(path.join(dir, 'e2e.db'));
  seedDemo(db);
  const server = await new Promise((r) => { const s = createApp(db).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const problems = [];
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); problems.push(name); }
    console.log(results[results.length - 1]);
  };

  const newPage = async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('dialog', (d) => d.accept());
    return page;
  };
  const login = async (page, u, p) => {
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login');
    await page.type('#u', u); await page.type('#p', p);
    await Promise.all([page.waitForSelector('#nav a'), page.click('#login button')]);
  };
  const text = (page, sel) => page.$eval(sel, (e) => e.innerText);
  const goto = async (page, hash, sel) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector(sel, { timeout: 8000 }); };

  const owner = await newPage();
  await step('owner signs in and lands on the dashboard with real figures', async () => {
    await login(owner, 'owner', 'owner12345');
    await owner.waitForSelector('.tiles .tile');
    const t = await text(owner, '#body');
    assert.match(t, /net sales \(revenue\)/i);
    assert.match(t, /gross profit/i);
    assert.ok(!/NaN|undefined/.test(t), 'dashboard shows NaN/undefined');
  });

  for (const [hash, sel, title] of [
    ['#/catalogue', '#list table', 'catalogue'], ['#/inventory', '#list table', 'inventory'], ['#/bills', '#list table', 'bills'],
    ['#/orders', '#list table', 'orders'], ['#/restock', '#list table', 'restock'], ['#/suppliers', '#list table', 'suppliers'],
    ['#/purchases', '#list table', 'purchases'], ['#/expenses', '#list table', 'expenses'], ['#/settings', '#sf', 'settings'],
  ]) {
    await step(`${title} page renders`, async () => {
      await goto(owner, hash, sel);
      const t = await text(owner, '#view');
      assert.ok(!/NaN|undefined|\[object/.test(t), `${title} contains NaN/undefined`);
    });
  }

  await step('catalogue search finds a title and shows its location', async () => {
    await goto(owner, '#/catalogue', '#q');
    await owner.type('#q', 'atomic');
    await owner.waitForFunction(() => document.querySelectorAll('#list tbody tr').length === 1);
    assert.match(await text(owner, '#list tbody'), /Atomic Habits/);
    assert.match(await text(owner, '#list tbody'), /Aisle B/);
  });

  await step('add a new book through the form, then it is searchable', async () => {
    await goto(owner, '#/catalogue', '#add');
    await owner.$eval('#q', (e) => { e.value = ''; });
    await owner.click('#add');
    await owner.waitForSelector('#bf');
    await owner.type('#f-title', 'E2E Test Book'); await owner.type('#f-author', 'Test Author');
    await owner.type('#f-price', '123.50'); await owner.type('#f-aisle', 'Z'); await owner.type('#f-rack', '9');
    await owner.$eval('#f-openingStock', (e) => { e.value = ''; }); await owner.type('#f-openingStock', '5');
    await owner.click('#save');
    await owner.waitForFunction(() => !document.querySelector('dialog'));
    await owner.type('#q', 'e2e test');
    await owner.waitForFunction(() => /E2E Test Book/.test(document.querySelector('#list').innerText));
    assert.match(await text(owner, '#list'), /₹123\.50/);
  });

  await step('billing: search, add to bill, change quantity, finalize, stock drops, bill is retrievable', async () => {
    await goto(owner, '#/billing', '#picker input');
    await owner.type('#picker input', 'e2e test');
    await owner.waitForSelector('.result');
    await owner.click('.result');
    await owner.waitForSelector('#cart table');
    await owner.$eval('[data-qty]', (e) => { e.value = '2'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await owner.waitForFunction(() => /₹247\.00/.test(document.querySelector('#cart').innerText));
    await owner.click('#finalize');
    await owner.waitForFunction(() => /INV-\d+/.test(document.querySelector('#cart').innerText));
    const row = db.prepare("SELECT stock_qty s FROM books WHERE title = 'E2E Test Book'").get();
    assert.equal(row.s, 3);
    const sale = db.prepare('SELECT * FROM sales ORDER BY id DESC LIMIT 1').get();
    assert.equal(sale.total_cents, 24700);
    await goto(owner, '#/bills', '#list table');
    assert.match(await text(owner, '#list tbody tr'), /₹247\.00/);
  });

  await step('billing: overselling is blocked with a clear message', async () => {
    await goto(owner, '#/billing', '#picker input');
    await owner.type('#picker input', 'e2e test');
    await owner.waitForSelector('.result');
    await owner.click('.result');
    await owner.waitForSelector('#cart table');
    await owner.$eval('[data-qty]', (e) => { e.value = '9'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await owner.waitForFunction(() => /Only 3 in stock/.test(document.querySelector('#cart').innerText));
    await owner.click('#finalize');
    await owner.waitForFunction(() => /Not enough stock/.test(document.getElementById('toasts')?.innerText || ''));
    assert.equal(db.prepare("SELECT stock_qty s FROM books WHERE title = 'E2E Test Book'").get().s, 3);
  });

  await step('receipt page renders a printable bill', async () => {
    const id = db.prepare('SELECT id FROM sales ORDER BY id DESC LIMIT 1').get().id;
    const page = await newPage();
    await page.setCookie(...(await owner.cookies()));
    await page.goto(`${base}/receipt.html?id=${id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /TOTAL/.test(document.getElementById('receipt').innerText));
    assert.match(await text(page, '#receipt'), /E2E Test Book/);
    await page.close();
  });

  await step('phone order: create, mark ready, complete → one bill, stock deducted once', async () => {
    await goto(owner, '#/orders', '#new');
    await owner.click('#new');
    await owner.waitForSelector('#of');
    await owner.type('#cn', 'E2E Customer'); await owner.type('#cp', '9876543210');
    await owner.type('#op input', 'e2e test');
    await owner.waitForSelector('#op .result');
    await owner.click('#op .result');
    await owner.waitForSelector('#ol table');
    await owner.click('#save');
    await owner.waitForFunction(() => !document.querySelector('dialog'));
    assert.deepEqual(db.prepare("SELECT stock_qty s, reserved_qty r FROM books WHERE title = 'E2E Test Book'").get(), { s: 3, r: 1 });
    await owner.waitForSelector('#list tbody tr');
    const rows = await owner.$$('#list tbody tr');
    let target = null;
    for (const r of rows) { if (/E2E Customer/.test(await r.evaluate((e) => e.innerText))) target = r; }
    await target.click();
    await owner.waitForSelector('#ready');
    await owner.click('#ready');
    await owner.waitForFunction(() => !document.querySelector('dialog'));
    const row2 = (await owner.$$('#list tbody tr'));
    for (const r of row2) { if (/E2E Customer/.test(await r.evaluate((e) => e.innerText))) { await r.click(); break; } }
    await owner.waitForSelector('#fulfil');
    await owner.click('#fulfil');
    await owner.waitForSelector('#go');
    await owner.click('#go');
    await owner.waitForFunction(() => !document.querySelector('dialog'));
    assert.deepEqual(db.prepare("SELECT stock_qty s, reserved_qty r FROM books WHERE title = 'E2E Test Book'").get(), { s: 2, r: 0 });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM sales WHERE order_id IS NOT NULL AND customer_name = 'E2E Customer'").get().c, 1);
  });

  await step('restocking shows reasons and metrics, and builds a purchase order draft', async () => {
    await goto(owner, '#/restock', '#list table');
    const t = await text(owner, '#list');
    assert.match(t, /Why it was flagged|Sold/);
    await owner.click('input[data-i="0"]');
    await owner.click('#mkpo');
    await owner.waitForSelector('#pf');
    assert.ok(await owner.$eval('#sup', (e) => e.value) !== '', 'supplier preselected');
    await owner.waitForFunction(() => document.querySelectorAll('#pl tbody tr').length === 1);
    await owner.click('#save');
    await owner.waitForFunction(() => !document.querySelector('dialog'), { timeout: 8000 });
    assert.ok(db.prepare("SELECT COUNT(*) c FROM purchase_orders WHERE status = 'ordered'").get().c >= 2);
  });

  const staff = await newPage();
  await step('staff sees only permitted navigation and is bounced from owner pages', async () => {
    await login(staff, 'staff', 'staff12345');
    const nav = await text(staff, '#nav');
    assert.ok(!/Dashboard|Suppliers|Purchases|Restocking|Expenses/.test(nav), `staff nav leaked: ${nav}`);
    assert.match(nav, /Billing/);
    await staff.evaluate(() => { location.hash = '#/dashboard'; });
    await staff.waitForFunction(() => location.hash === '#/billing');
  });

  await step('staff catalogue view does not expose cost; API refuses owner endpoints', async () => {
    await goto(staff, '#/catalogue', '#list table');
    await staff.click('#list tbody tr');
    await staff.waitForSelector('dialog .kv');
    assert.ok(!/avg cost/.test(await text(staff, 'dialog')));
    const status = await staff.evaluate(async () => (await fetch('/api/suppliers')).status);
    assert.equal(status, 403);
  });

  await step('layout works at phone width (no horizontal page scroll)', async () => {
    await owner.setViewport({ width: 390, height: 800 });
    for (const h of ['#/billing', '#/catalogue', '#/dashboard']) {
      await owner.evaluate((x) => { location.hash = x; }, h);
      await new Promise((r) => setTimeout(r, 700));
      const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 2, `${h} overflows by ${over}px`);
    }
  });

  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
  console.log(results.join('\n'));
  const uniqueProblems = [...new Set(problems)];
  if (uniqueProblems.length) { console.log('\nProblems:\n' + uniqueProblems.join('\n')); process.exit(1); }
  console.log(`\nAll ${results.length} UI checks passed.`);
})().catch((e) => { console.error(e); process.exit(1); });
