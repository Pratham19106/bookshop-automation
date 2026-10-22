// Quick UI smoke test (about 10 s): signs in, opens every page, rings up one sale, checks staff restrictions.
// Needs a built frontend (npm run build) and Chrome/Edge. Set CHROME_PATH if it is not found automatically.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const { openDatabase } = require('../src/db');
const { seedDemo } = require('../src/db/seed');
const { createApp } = require('../src/app');
const config = require('../src/config');

const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .filter(Boolean).find((p) => fs.existsSync(p));

async function main() {
  if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  if (!fs.existsSync(path.join(config.publicDir, 'index.html'))) throw new Error('Frontend not built; run: npm run build');

  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-ui-')), 'ui.db'));
  seedDemo(db);
  const server = await new Promise((r) => { const s = createApp(db).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  let current = null; // page of the latest check, dumped on failure to make failures diagnosable
  const checks = [];

  const open = async (context = browser) => {
    const page = await context.newPage();
    current = page;
    page.setDefaultTimeout(4000);
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/401|403/.test(m.text())) errors.push(m.text()); });
    return page;
  };
  const login = async (page, u, p) => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.type('#u', u); await page.type('#p', p);
    await Promise.all([page.waitForSelector('nav a'), page.click('form button')]);
  };
  const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction((h) => location.hash === h, {}, hash); };
  const check = async (name, fn) => {
    try { await fn(); } catch (e) {
      const seen = await current.evaluate(() => document.body.innerText.slice(-500)).catch(() => '');
      throw new Error(`${name}: ${e.message}
--- page text ---
${seen}`);
    }
    checks.push(name); console.log(`  ok  ${name}`);
  };
  const bodyText = (page) => page.$eval('main', (e) => e.innerText);

  try {
    const owner = await open();
    await check('owner signs in and sees real dashboard figures', async () => {
      await login(owner, 'owner', 'owner12345');
      await owner.waitForFunction(() => /NET SALES|Net sales/i.test(document.querySelector('main').innerText));
      assert.ok(!/NaN|undefined/.test(await bodyText(owner)));
    });

    await check('all 11 pages render without errors', async () => {
      for (const h of ['#/billing', '#/bills', '#/orders', '#/catalogue', '#/inventory', '#/restock', '#/suppliers', '#/purchases', '#/dashboard', '#/expenses', '#/settings']) {
        await go(owner, h);
        await owner.waitForFunction(() => document.querySelector('main h1') && !/^Loading/.test(document.querySelector('main').innerText.trim()));
        const t = await bodyText(owner);
        assert.ok(!/NaN|undefined|\[object/.test(t), `${h} shows NaN/undefined`);
        if (h === '#/restock') assert.match(t, /why it was flagged/i);
      }
    });

    await check('catalogue search shows author, ISBN and shelf location', async () => {
      await go(owner, '#/catalogue');
      await owner.type('#q', 'atomic');
      await owner.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
      assert.match(await bodyText(owner), /Atomic Habits[\s\S]*James Clear[\s\S]*Aisle B/);
    });

    await check('billing: add a book, change quantity, finalize; stock and bill are persisted', async () => {
      const before = db.prepare("SELECT stock_qty s FROM books WHERE title = 'Atomic Habits'").get().s;
      await go(owner, '#/billing');
      await owner.type('input[aria-label="Search books"]', 'atomic');
      await owner.waitForSelector('.result');
      await owner.click('.result');
      await owner.waitForSelector('input[aria-label="Quantity"]');
      await owner.click('button[aria-label="Increase"]');
      await owner.waitForFunction(() => /₹998\.00/.test(document.querySelector('main').innerText));
      await owner.click('#finalize');
      await owner.waitForFunction(() => /INV-\d+ saved/.test(document.querySelector('main').innerText));
      assert.equal(db.prepare("SELECT stock_qty s FROM books WHERE title = 'Atomic Habits'").get().s, before - 2);
      assert.equal(db.prepare('SELECT total_cents t FROM sales ORDER BY id DESC LIMIT 1').get().t, 99800);
    });

    await check('receipt page is printable', async () => {
      const id = db.prepare('SELECT MAX(id) id FROM sales').get().id;
      await go(owner, `#/receipt/${id}`);
      await owner.waitForFunction(() => /TOTAL/.test(document.querySelector('main').innerText));
    });

    await check('phone order: place, ready, complete -> stock deducted once', async () => {
      const stock = () => db.prepare("SELECT stock_qty s, reserved_qty r FROM books WHERE title = 'Sapiens'").get();
      const before = stock();
      await go(owner, '#/orders');
      await owner.click('#new');
      await owner.waitForSelector('#cn');
      await owner.type('#cn', 'Smoke Customer'); await owner.type('#cp', '9876543210');
      await owner.type('dialog input[aria-label="Search books"]', 'sapiens');
      await owner.waitForSelector('dialog .result');
      await owner.click('dialog .result');
      await owner.click('#save-order');
      await owner.waitForFunction(() => !document.querySelector('dialog[open]'));
      assert.deepEqual(stock(), { s: before.s, r: before.r + 1 });
      await owner.evaluate(() => [...document.querySelectorAll('tbody tr')].find((r) => /Smoke Customer/.test(r.innerText)).click());
      await owner.waitForSelector('#ready'); await owner.click('#ready');
      await owner.waitForSelector('#fulfil'); await owner.click('#fulfil');
      await owner.waitForSelector('#complete'); await owner.click('#complete');
      await owner.waitForFunction(() => /COMPLETED/i.test(document.querySelector('dialog[open]').innerText));
      assert.deepEqual(stock(), { s: before.s - 1, r: before.r });
      assert.equal(db.prepare("SELECT COUNT(*) c FROM sales WHERE customer_name = 'Smoke Customer'").get().c, 1);
    });

    const staff = await open(await browser.createBrowserContext()); // separate cookies from the owner session
    await check('staff has no owner pages; server refuses owner APIs', async () => {
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
    db.close();
  }
}

main().catch((e) => { console.error(`\nUI smoke test FAILED: ${e.message}`); process.exit(1); });
