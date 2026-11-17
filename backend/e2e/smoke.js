// Quick UI smoke test: signs in, opens every page, rings up one sale, places a phone order, switches shop,
// and checks manager / staff limits. Needs a built frontend (npm run build), Chrome/Edge (CHROME_PATH if not
// found automatically) and TEST_DATABASE_URL (it runs in a throwaway schema that is dropped afterwards).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const { createDb } = require('../src/db');
const { migrate } = require('../src/db/migrate');
const { seedDemo } = require('../src/db/seed');
const { createApp } = require('../src/app');
const config = require('../src/config');

const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .filter(Boolean).find((p) => fs.existsSync(p));

async function main() {
  if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  if (!fs.existsSync(path.join(config.publicDir, 'index.html'))) throw new Error('Frontend not built; run: npm run build');
  if (!config.testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL');

  const schema = `ui_${crypto.randomBytes(4).toString('hex')}`;
  const db = createDb({ connectionString: config.testDatabaseUrl, schema, max: 4 });
  await migrate(db);
  await seedDemo(db);
  // Stock of a title in the HQ shop (S01), where the owner works by default.
  const stockOf = (title) => db.one(`SELECT ss.stock_qty AS s, ss.reserved_qty AS r FROM shop_stock ss JOIN books b ON b.id = ss.book_id
                                      JOIN shops sh ON sh.id = ss.shop_id WHERE b.title = $1 AND sh.code = 'S01'`, [title]);

  const server = await new Promise((r) => { const s = createApp(db).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  let current = null; // page of the latest check, dumped on failure to make failures diagnosable
  const checks = [];

  const open = async (context = browser) => {
    const page = await context.newPage();
    current = page;
    // A hosted database (e.g. Supabase in another region) adds network latency to every query.
    page.setDefaultTimeout(/localhost|127\.0\.0\.1/.test(config.testDatabaseUrl) ? 6000 : 30000);
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/401|403/.test(m.text())) errors.push(m.text()); });
    return page;
  };
  const login = async (page, u, p) => {
    await page.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#u');
    await page.type('#u', u); await page.type('#p', p);
    await Promise.all([page.waitForSelector('nav a'), page.click('form button')]);
  };
  const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction((h) => location.hash === h, {}, hash); };
  const check = async (name, fn) => {
    try { await fn(); } catch (e) {
      const seen = await current.evaluate(() => document.body.innerText.slice(-500)).catch(() => '');
      throw new Error(`${name}: ${e.message}\n--- page text ---\n${seen}`);
    }
    checks.push(name); console.log(`  ok  ${name}`);
  };
  const bodyText = (page) => page.$eval('main', (e) => e.innerText);

  try {
    const owner = await open();
    await check('landing page links to sign-in without exposing demo credentials', async () => {
      await owner.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await owner.waitForFunction(() => document.body.innerText.includes('Bookshop Automation System'));
      await owner.goto(`${base}/#/login`, { waitUntil: 'domcontentloaded' });
      await owner.waitForSelector('#u');
      const t = await owner.evaluate(() => document.body.innerText);
      assert.ok(!/Credential|Terminal|API Online|Owner \(Full\)|Password123/i.test(t), t);
      assert.equal(await owner.$eval('#u', (e) => e.value), '');
    });

    await check('owner signs in and sees real dashboard figures', async () => {
      await login(owner, 'owner', 'owner12345');
      await owner.waitForFunction(() => /NET SALES|Net sales/i.test(document.querySelector('main').innerText));
      assert.ok(!/NaN|undefined/.test(await bodyText(owner)));
      assert.match(await bodyText(owner), /Net sales by shop/i);
    });

    await check('all pages render without errors', async () => {
      for (const h of ['#/billing', '#/bills', '#/orders', '#/catalogue', '#/inventory', '#/shelves', '#/restock', '#/suppliers', '#/purchases', '#/dashboard', '#/statement', '#/sales-report', '#/expenses', '#/settings', '#/help']) {
        await go(owner, h);
        // Wait until no "Loading data…" placeholder is left anywhere on the page (a page title can render before its data).
        await owner.waitForFunction(() => document.querySelector('main h1') && !/Loading data/.test(document.querySelector('main').innerText));
        const t = await bodyText(owner);
        assert.ok(!/NaN|undefined|\[object/.test(t), `${h} shows NaN/undefined`);
        if (h === '#/restock') assert.match(t, /why it was flagged/i);
      }
    });

    await check('catalogue search shows author and ISBN', async () => {
      await go(owner, '#/catalogue');
      await owner.type('#q', 'atomic');
      await owner.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
      assert.match(await bodyText(owner), /Atomic Habits[\s\S]*James Clear/);
    });

    await check('shop layout and arrangement queue place copies', async () => {
      await go(owner, '#/shelves');
      await owner.waitForFunction(() => [...document.querySelectorAll('main button')].some(b => /Create layout/i.test(b.innerText)));
      await owner.evaluate(() => [...document.querySelectorAll('main button')].find(b => /Create layout/i.test(b.innerText)).click());
      await owner.waitForFunction(() => document.body.innerText.includes('shelves created'));
      await go(owner, '#/arrangement');
      await owner.waitForSelector('tbody tr select');
      await owner.waitForFunction(() => [...document.querySelectorAll('tbody tr select option')].some(o => o.textContent.includes('A1 · R1 · S1')));
      const shelf = await owner.$eval('tbody tr select', s => [...s.options].find(o => o.textContent.includes('A1 · R1 · S1'))?.value);
      assert.ok(shelf, 'new shelf is available');
      await owner.select('tbody tr select', shelf);
      await owner.click('tbody tr input[type=number]', { clickCount: 3 });
      await owner.keyboard.press('Backspace');
      await owner.type('tbody tr input[type=number]', '1');
      await owner.click('tbody tr input[type=checkbox]');
      await owner.evaluate(() => [...document.querySelectorAll('main button')].find(b => /Confirm arrangement/i.test(b.innerText)).click());
      await owner.waitForFunction(() => document.body.innerText.includes('1 arranged'));
    });

    await check('billing: add a book, change quantity, finalize; stock and bill are persisted', async () => {
      const before = (await stockOf('Atomic Habits')).s;
      await go(owner, '#/billing');
      await owner.type('input[aria-label="Search books"]', 'atomic');
      await owner.waitForSelector('.result');
      await owner.click('.result');
      await owner.waitForSelector('input[aria-label="Quantity"]');
      await owner.click('button[aria-label="Increase"]');
      await owner.waitForFunction(() => /₹998\.00/.test(document.querySelector('main').innerText));
      await owner.click('#finalize');
      await owner.waitForFunction(() => /INV-S01-\d+ saved/.test(document.querySelector('main').innerText));
      assert.equal((await stockOf('Atomic Habits')).s, before - 2);
      assert.equal((await db.one('SELECT total_cents AS t FROM sales ORDER BY id DESC LIMIT 1')).t, 99800);
    });

    await check('receipt page is printable', async () => {
      const { id } = await db.one('SELECT MAX(id) AS id FROM sales');
      await go(owner, `#/receipt/${id}`);
      await owner.waitForFunction(() => /TOTAL/.test(document.querySelector('main').innerText));
    });

    await check('phone order: place, ready, complete -> stock deducted once', async () => {
      const stock = () => stockOf('Sapiens');
      const before = await stock();
      await go(owner, '#/orders');
      await owner.click('#new');
      await owner.waitForSelector('#cn');
      await owner.type('#cn', 'Smoke Customer'); await owner.type('#cp', '9876543210');
      await owner.type('dialog input[aria-label="Search books"]', 'sapiens');
      await owner.waitForSelector('dialog .result');
      await owner.click('dialog .result');
      await owner.click('#save-order');
      await owner.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.deepEqual(await stock(), { s: before.s, r: before.r + 1 });
      await owner.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((r) => /Smoke Customer/.test(r.innerText)));
      await owner.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => /Smoke Customer/.test(r.innerText)).click());
      await owner.waitForSelector('#ready'); await owner.click('#ready');
      await owner.waitForSelector('#fulfil'); await owner.click('#fulfil');
      await owner.waitForSelector('#complete'); await owner.click('#complete');
      await owner.waitForFunction(() => /COMPLETED/i.test(document.querySelector('dialog[open]').innerText));
      assert.deepEqual(await stock(), { s: before.s - 1, r: before.r });
      assert.equal((await db.one("SELECT COUNT(*) AS c FROM sales WHERE customer_name = 'Smoke Customer'")).c, 1);
    });

    await check('owner can switch shops from the header', async () => {
      await go(owner, '#/inventory');
      await owner.waitForSelector('select[aria-label="Active shop"]');
      const ids = await owner.$$eval('select[aria-label="Active shop"] option', (os) => os.map((o) => o.value));
      assert.equal(ids.length, 2);
      await owner.select('select[aria-label="Active shop"]', ids[1]);
      await owner.waitForFunction(() => /FC Road/.test(document.querySelector('aside').innerText));
    });

    // Owner is now working in FC Road (S02). A FC Road staff member sells on another device: the owner's open
    // Bills page must show the new bill with no reload (Server-Sent Events -> cache refresh).
    const pune = await open(await browser.createBrowserContext());
    let liveBillNo = null;
    await check('live: a sale on another device appears on the owner\'s screen without reloading', async () => {
      await go(owner, '#/bills');
      await owner.waitForFunction(() => document.querySelector('main h1') && !/Loading data/.test(document.querySelector('main').innerText));
      await login(pune, 'punestaff', 'staff12345');
      const { id: bookId } = await db.one(`SELECT ss.book_id AS id FROM shop_stock ss JOIN shops sh ON sh.id = ss.shop_id
                                            WHERE sh.code = 'S02' AND ss.stock_qty - ss.reserved_qty >= 2 ORDER BY ss.book_id LIMIT 1`);
      const sale = await pune.evaluate(async (bid) => {
        const r = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bookshop' },
          body: JSON.stringify({ items: [{ bookId: bid, quantity: 1 }], paymentMethod: 'cash', customerName: 'Live Customer' }) });
        return r.json();
      }, bookId);
      assert.match(sale.billNo || '', /^INV-S02-/);
      liveBillNo = sale.billNo;
      await owner.waitForFunction((no) => document.querySelector('main').innerText.includes(no), { timeout: 15000 }, liveBillNo);
    });

    await check('refund from the bill dialog puts the copy back and shows on the financial statement', async () => {
      current = owner;
      const row = await db.one(`SELECT s.id, i.book_id AS "bookId" FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE s.bill_no = $1`, [liveBillNo]);
      const before = (await db.one(`SELECT ss.stock_qty AS s FROM shop_stock ss JOIN shops sh ON sh.id = ss.shop_id WHERE sh.code = 'S02' AND ss.book_id = $1`, [row.bookId])).s;
      await owner.evaluate((no) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(no)).click(), liveBillNo);
      await owner.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].some((b) => /Return \/ exchange/i.test(b.innerText)));
      await owner.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => /Return \/ exchange/i.test(b.innerText)).click());
      await owner.waitForSelector('input[aria-label^="Return quantity"]');
      await owner.click('input[aria-label^="Return quantity"]', { clickCount: 3 });
      await owner.keyboard.press('Backspace');
      await owner.type('input[aria-label^="Return quantity"]', '1');
      await owner.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => /Confirm adjustment/i.test(b.innerText)).click());
      await owner.waitForFunction(() => [...document.querySelectorAll('dialog[open]')].some((d) => /Adjustment bills/i.test(d.innerText)));
      const after = (await db.one(`SELECT ss.stock_qty AS s FROM shop_stock ss JOIN shops sh ON sh.id = ss.shop_id WHERE sh.code = 'S02' AND ss.book_id = $1`, [row.bookId])).s;
      assert.equal(after, before + 1);
      await owner.keyboard.press('Escape');

      await go(owner, '#/statement');
      await owner.waitForFunction(() => /FINANCIAL STATEMENT/.test(document.querySelector('main').innerText) && !/Loading data/.test(document.querySelector('main').innerText));
      const t = await bodyText(owner);
      assert.match(t, /S01[\s\S]*S02[\s\S]*TOTAL/i, 'one column per shop plus total');
      assert.match(t, /Less: returned books/);
      assert.match(t, /Operating profit/);
      assert.ok(!/NaN|undefined/.test(t));
    });

    const manager = await open(await browser.createBrowserContext());
    await check('manager sees stock and purchasing pages but not people management', async () => {
      await login(manager, 'manager', 'manager12345');
      const nav = await manager.$eval('nav', (e) => e.innerText);
      assert.ok(/Suppliers/.test(nav) && /Purchases/.test(nav) && /Dashboard/.test(nav), nav);
      assert.equal(await manager.evaluate(async () => (await fetch('/api/users')).status), 403);
    });

    const staff = await open(await browser.createBrowserContext()); // separate cookies from the other sessions
    await check('staff has no manager pages; server refuses manager APIs', async () => {
      await login(staff, 'staff', 'staff12345');
      const nav = await staff.$eval('nav', (e) => e.innerText);
      assert.ok(!/Dashboard|Suppliers|Purchases|Restocking|Expenses/.test(nav), nav);
      await staff.evaluate(() => { location.hash = '#/dashboard'; });
      await staff.waitForFunction(() => location.hash === '#/billing');
      assert.equal(await staff.evaluate(async () => (await fetch('/api/suppliers')).status), 403);
    });

    assert.deepEqual([...new Set(errors)], [], 'browser console/page errors');
    console.log(`\nUI smoke test passed (${checks.length} checks).`);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.close();
  }
}

main().catch((e) => { console.error(`\nUI smoke test FAILED: ${e.message}`); process.exit(1); });
