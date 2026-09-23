const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, baseURL;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  server = http.createServer(async (req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(file)) return res.writeHead(404).end();
    try {
      const data = await fs.readFile(path.join(__dirname, '..', file === '/' ? 'index.html' : file.slice(1)));
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(data);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = process.env.FINANCE_BROWSER_BASE_URL || `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

for (const width of [1440, 390]) {
  test(`allocation labels remain visible during horizontal and vertical scrolling (${width}px)`, { skip: !chromium }, async t => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, name: '验收测试' } }));
    await page.route('**/api/t4/workspace', route => route.fulfill({ json: {
      version: 1, found: true, document: { periods: {}, channels: [], cfgByPeriod: { '2026-09': { tmall: { directLaborMonth: 3000 } } }, periodLocks: { '2026-09': false } }
    } }));
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { T4.period = '2026-09'; go('t4-mgmt'); });
    await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
    const grid = page.locator('.t4-pinned-two');
    const rects = () => grid.evaluate(el => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; };
      return { grid: rect(el), a: rect(el.querySelector('tbody tr>:first-child')), b: rect(el.querySelector('tbody tr>:nth-child(2)')), h: rect(el.querySelector('thead tr>:first-child')), scroll: el.scrollLeft, overflows: el.scrollWidth > el.clientWidth };
    });
    const before = await rects();
    await grid.evaluate(el => { el.scrollLeft = 650; el.scrollTop = 250; });
    const after = await rects();
    if (before.overflows) assert.ok(after.scroll > 0, 'wide table can be scrolled');
    assert.ok(Math.abs(after.a.x - before.a.x) < 1, 'business unit stays in place');
    assert.ok(Math.abs(after.b.x - before.b.x) < 1, 'channel stays in place');
    assert.ok(after.b.x >= after.a.x + after.a.width - 1, 'frozen columns never overlap');
    assert.ok(Math.abs(after.h.y - after.grid.y) < 1, 'header stays in place');
    await page.screenshot({ path: `/tmp/finance-yellow-allocation-${width}.png`, fullPage: true });
    await page.evaluate(() => { T4.sheetMode = 'matrix'; go('t4-sheet'); });
    const sheet = page.locator('.t4-pinned-one');
    const x = await sheet.locator('tbody tr>:first-child').first().evaluate(el => el.getBoundingClientRect().x);
    await sheet.evaluate(el => { el.scrollLeft = 650; });
    assert.ok(Math.abs(await sheet.locator('tbody tr>:first-child').first().evaluate(el => el.getBoundingClientRect().x) - x) < 1, 'report metric stays in place');
    assert.deepEqual(errors, []);
  });
}
