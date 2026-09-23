const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, base;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true });
  server = http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(name)) return res.writeHead(404).end();
    try {
      const bytes = await fs.readFile(path.join(__dirname, '..', name === '/' ? 'index.html' : name.slice(1)));
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(bytes);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = process.env.FINANCE_BROWSER_BASE_URL || `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function clients(t, sameBrowser = false) {
  const doc = { periods: { '2026-09': { tm_zzzrest: { '2026-09-20': { rebateAmount: -100 } } } }, cfg: {}, cfgByPeriod: { '2026-09': { tmall: { platformFeeRate: 0.05 } } }, channels: [], periodLocks: { '2026-09': false } };
  let version = 1;
  const pages = [], puts = [0, 0];
  const context = sameBrowser ? await browser.newContext() : null;
  if (context) t.after(() => context.close());
  for (let i = 0; i < 2; i++) {
    const page = context ? await context.newPage() : await browser.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(30000);
    pages.push(page);
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    // Block every business API before the two explicit isolated fixtures below.
    await page.route('**/api/**', route => route.fulfill({ status: 404, json: { error: 'test fixture only' } }));
    await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, name: '同步回归同事', loginUrl: '/sso/login' } }));
    await page.route('**/api/t4/workspace', async route => {
      if (route.request().method() === 'PUT') {
        puts[i]++;
        const body = route.request().postDataJSON();
        if (body.baseVersion !== version) return route.fulfill({ status: 409, json: { error: 'version_conflict', version } });
        for (const change of body.changes) {
          let obj = doc;
          for (const key of change.path.slice(0, -1)) obj = obj[key] ||= {};
          if (change.newExists) obj[change.path.at(-1)] = change.value;
          else delete obj[change.path.at(-1)];
        }
        version++;
      }
      await route.fulfill({ json: { version, document: doc, found: true } });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { T4.period = '2026-09'; go('t4-cfg'); });
    await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  }
  return { a: pages[0], b: pages[1], puts };
}

test('a channel saved in one tab does not make the other tab falsely dirty', { skip: !chromium }, async t => {
  const { a, b, puts } = await clients(t, true);
  await a.evaluate(async () => { await t4SaveChannel({ id: 'tmall', n: '同步回归渠道', bu: T4_CHM.tmall.bu, aliases: '' }); });
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await b.waitForFunction(() => T4_CHM.tmall.n === '同步回归渠道', null, { timeout: 5000 });
  assert.equal(puts[1], 0);
});

test('an idle second browser receives a colleague save through the real polling timer', { skip: !chromium }, async t => {
  const { a, b, puts } = await clients(t);
  await a.evaluate(async () => { T4.cfg.tmall.platformFeeRate = 0.08; await t4SaveCfg(); });
  await b.waitForFunction(() => T4.cfg.tmall.platformFeeRate === 0.08, null, { timeout: 22000 });
  assert.equal(await b.locator('[data-t4cfg="tmall:platformFeeRate"]').inputValue(), '8');
  assert.equal(puts[1], 0, 'receiving updates must not write to the workspace');
});

test('focus refresh preserves a dirty second browser and the same-field conflict remains visible', { skip: !chromium }, async t => {
  const { a, b } = await clients(t);
  await b.evaluate(() => { T4.cfg.tmall.platformFeeRate = 0.12; });
  await a.evaluate(async () => { T4.cfg.tmall.platformFeeRate = 0.08; await t4SaveCfg(); });
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await b.waitForTimeout(250);
  assert.deepEqual(await b.evaluate(() => ({ local: T4.cfg.tmall.platformFeeRate, version: T4_SERVER_VERSION })), { local: 0.12, version: 1 });
  const message = await b.evaluate(async () => { try { await t4SaveCfg(); return 'unexpected success'; } catch (e) { return e.message; } });
  assert.match(message, /冲突/);
  assert.equal(await b.evaluate(() => T4.cfg.tmall.platformFeeRate), 0.12);
});

test('refresh cannot replace a focused input before its change event is committed', { skip: !chromium }, async t => {
  const { a, b } = await clients(t);
  const field = b.locator('[data-t4cfg="tmall:platformFeeRate"]');
  await field.fill('12');
  await a.evaluate(async () => { T4.cfg.tmall.platformFeeRate = 0.08; await t4SaveCfg(); });
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await b.waitForTimeout(250);
  assert.equal(await field.inputValue(), '12');
  assert.equal(await b.evaluate(() => T4_SERVER_VERSION), 1);
});

for (const leavePage of ['', 'another page', 'another month']) {
  test(`prefilled return amount cannot overwrite a colleague after refresh${leavePage ? ' on ' + leavePage : ''}`, { skip: !chromium }, async t => {
    const { a, b } = await clients(t);
    await b.evaluate(() => go('t4-returns'));
    await b.locator('[data-t4return-edit="tm_zzzrest:2026-09-20"]').click();
    assert.equal(await b.locator('[data-return-field="amount"]').inputValue(), '100');
    if (leavePage) await b.evaluate(otherMonth => { if (otherMonth) T4.period = '2026-10'; go('t4'); }, leavePage === 'another month');
    await a.evaluate(async () => { T4.data.tm_zzzrest['2026-09-20'].rebateAmount = -200; await t4Save(); });
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b.waitForTimeout(250);
    if (leavePage) await b.evaluate(() => { T4.period = '2026-09'; go('t4-returns'); });
    const state = await b.evaluate(() => ({ version: T4_SERVER_VERSION, amount: T4.returnEntry.amount }));
    assert(state.version === 1 || Number(state.amount) === 200, 'accepting the latest baseline must also update a clean prefilled return');
    await b.locator('[data-t4return-save]').click();
    await b.waitForFunction(() => !T4_SERVER_SAVING);
    assert.equal(await a.evaluate(async () => (await (await fetch('/api/t4/workspace')).json()).document.periods['2026-09'].tm_zzzrest['2026-09-20'].rebateAmount), -200);
  });
}
