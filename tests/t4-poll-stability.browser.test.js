const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

// Optional live-site runs load deployed assets but mock every API and block
// service workers, so no production financial data is read or written.
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, baseURL;
const outputDir = process.env.FINANCE_POLL_SCREENSHOTS;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  if (!process.env.FINANCE_BROWSER_BASE_URL) {
    server = http.createServer(async (req, res) => {
      const name = new URL(req.url, 'http://localhost').pathname;
      if (!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(name)) return res.writeHead(404).end();
      try {
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(await fs.readFile(path.join(__dirname, '..', name === '/' ? 'index.html' : name.slice(1))));
      } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  }
  baseURL = process.env.FINANCE_BROWSER_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  if (outputDir) await fs.mkdir(outputDir, { recursive: true });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openClient(t, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no browser exceptions'));
  // Exercise the registered 15-second callback deterministically, including
  // several repeated ticks and a tick with a deliberately delayed response.
  await context.addInitScript(() => {
    const original = window.setInterval;
    window.setInterval = function (fn, delay, ...args) {
      if (delay === 15000) { window.__financePoll = () => fn(...args); return 2147480000; }
      return original.call(this, fn, delay, ...args);
    };
  });
  const api = { version: 1, reads: 0, puts: 0, document: {
    periods: { '2099-12': { tmall: { '2099-12-01': { retailIncome: 123 } } } },
    cfg: { tmall: { platformFeeRate: 0.0123 } }, channels: [], periodLocks: { '2099-12': false },
  } };
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await context.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/session') return route.fulfill({ json: { authenticated: true, name: '同步稳定性验收' } });
    if (pathname !== '/api/t4/workspace') return route.fulfill({ status: 404, json: { error: 'API disabled by poll fixture' } });
    if (route.request().method() !== 'GET') {
      api.puts++;
      return route.fulfill({ status: 405, json: { error: 'Unexpected write during poll fixture' } });
    }
    api.reads++;
    if (api.hold) { const hold = api.hold; delete api.hold; hold.started(); await hold.release; }
    return route.fulfill({ json: { version: api.version, found: true, document: api.document } });
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { T4.period = '2099-12'; go('t4-cfg'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING && !!window.__financePoll);
  await page.evaluate(() => {
    T4.editCh = 'tmall'; T4.expenseCh = 'tmall'; T4.expenseDate = '2099-12-01';
    T4.manFrom = T4.manTo = T4.sumDate = T4.sumTo = '2099-12-01';
    T4.mail.loaded = true; T4.mail.loading = false; T4.mail.error = null;
    T4.mail.status = { configured: false };
  });
  t.after(() => assert.equal(api.puts, 0, 'background checks never submit financial data'));
  return { page, api };
}

async function tick(page) {
  await page.evaluate(() => { window.__financePoll(); });
  await page.waitForFunction(() => !T4_SERVER_REFRESHING);
}
function holdNextRead(api) {
  let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  api.hold = { started, release: new Promise(resolve => { release = resolve; }) };
  return { entered, release };
}
async function remember(page, selector = '[data-t4cfg]') {
  return page.evaluate(selector => {
    const status = document.querySelector('[data-t4-sync-status]');
    window.__pollRefs = {
      status, label: status.firstElementChild,
      button: status.querySelector('[data-t4act="refreshSync"]'),
      field: document.querySelector(selector), baseline: T4_SERVER_BASELINE,
      workspace: T4_SERVER_DOCUMENT, viewChild: document.getElementById('view').firstElementChild,
    };
    window.__pollGeometry = () => {
      const rect = element => {
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const refs = window.__pollRefs;
      return { status: rect(refs.status), field: rect(refs.field),
        button: rect(document.querySelector('[data-t4-sync-status] [data-t4act="refreshSync"]')),
        scroll: [scrollX, scrollY, ...[...document.querySelectorAll('#view, #view .tw')].flatMap(el => [el.scrollLeft, el.scrollTop])],
        sameStatus: refs.status === document.querySelector('[data-t4-sync-status]'),
        sameLabel: refs.label === document.querySelector('[data-t4-sync-status]').firstElementChild,
        sameButton: refs.button === document.querySelector('[data-t4-sync-status] [data-t4act="refreshSync"]'),
        sameField: refs.field === document.querySelector(selector),
        sameView: refs.viewChild === document.getElementById('view').firstElementChild,
        sameBaseline: refs.baseline === T4_SERVER_BASELINE,
        sameWorkspace: refs.workspace === T4_SERVER_DOCUMENT,
      };
    };
    return window.__pollGeometry();
  }, selector);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`unchanged 15-second poll keeps status nodes and field coordinates (${viewport.width}px)`, { skip: !chromium }, async t => {
    const { page, api } = await openClient(t, viewport);
    const before = await remember(page);
    if (outputDir) await page.screenshot({ path: path.join(outputDir, `poll-${viewport.width}-before.png`) });
    const statusText = await page.locator('[data-t4-sync-status]').innerText();
    const held = holdNextRead(api);
    await page.evaluate(() => { window.__financePoll(); });
    await held.entered;
    const during = await page.evaluate(() => window.__pollGeometry());
    if (outputDir) await page.screenshot({ path: path.join(outputDir, `poll-${viewport.width}-pending.png`) });
    held.release();
    await page.waitForFunction(() => !T4_SERVER_REFRESHING);
    const after = await page.evaluate(() => window.__pollGeometry());
    if (outputDir) await page.screenshot({ path: path.join(outputDir, `poll-${viewport.width}-after.png`) });
    assert.deepEqual(during, before, `pending read preserves toolbar/form geometry: ${JSON.stringify({ before, during })}`);
    assert.deepEqual(after, before, 'unchanged response leaves all status and form nodes intact');
    assert.equal(await page.locator('[data-t4-sync-status]').innerText(), statusText);
    for (let i = 0; i < 3; i++) await tick(page);
    assert.deepEqual(await page.evaluate(() => window.__pollGeometry()), before, 'repeated checks stay quiet');
  });

  test(`typing, selection, focus and scroll survive repeated ticks (${viewport.width}px)`, { skip: !chromium }, async t => {
    const { page, api } = await openClient(t, viewport);
    await page.evaluate(() => go('t4-source-edit'));
    const field = page.locator('#t4SourceName');
    await field.fill('财务连续输入中的门店');
    await field.evaluate(el => el.setSelectionRange(2, 6));
    const before = await remember(page, '#t4SourceName');
    const reads = api.reads;
    api.version++;
    api.document.cfg.tmall.platformFeeRate = 0.0456;
    for (let i = 0; i < 4; i++) await tick(page);
    assert.deepEqual(await page.evaluate(() => window.__pollGeometry()), before, 'typing does not move or replace the form');
    assert.deepEqual(await field.evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el })),
      { value: '财务连续输入中的门店', start: 2, end: 6, focused: true });
    assert.equal(api.reads, reads, 'active input defers background reads');
    await page.keyboard.type('继续');
    assert.equal(await field.inputValue(), '财务继续中的门店', 'typing continues at the preserved selection');
    if (outputDir) await page.screenshot({ path: path.join(outputDir, `poll-${viewport.width}-typing.png`) });
  });
}

test('a scrolled long entry table keeps its row, input and horizontal position during repeated ticks', { skip: !chromium }, async t => {
  const { page } = await openClient(t, { width: 390, height: 844 });
  await page.evaluate(() => { T4.manTo = '2099-12-31'; go('t4-man'); });
  const selector = '[data-t4cell="2099-12-20:promotion"]';
  const field = page.locator(selector);
  await field.fill('1234.56');
  await field.evaluate(el => {
    const table = el.closest('.tw');
    table.scrollLeft = 200;
  });
  const before = await remember(page, selector);
  assert.ok(before.scroll.some(value => value > 100), 'fixture has a meaningful scrolled position');
  for (let i = 0; i < 4; i++) await tick(page);
  assert.deepEqual(await page.evaluate(() => window.__pollGeometry()), before);
  assert.equal(await field.inputValue(), '1234.56');
  assert.equal(await field.evaluate(el => document.activeElement === el), true);
});

test('a remote update stays pending on a clean parameter form until an explicit refresh', { skip: !chromium }, async t => {
  const { page, api } = await openClient(t, { width: 1440, height: 1000 });
  const before = await remember(page, '[data-t4cfg="tmall:platformFeeRate"]');
  api.version++;
  api.document.cfg.tmall.platformFeeRate = 0.0456;
  await tick(page);
  assert.deepEqual(await page.evaluate(() => window.__pollGeometry()), before, 'remote changes preserve the open form and its acknowledged baseline');
  assert.equal(await page.locator('[data-t4cfg="tmall:platformFeeRate"]').inputValue(), '1.23');
  assert.equal(await page.evaluate(() => T4_SERVER_VERSION), 1);
  assert.match(await page.locator('[data-t4-sync-status]').innerText(), /新|更新/);
  await page.getByRole('button', { name: '更新共享数据', exact: true }).click();
  await page.waitForFunction(() => T4_SERVER_VERSION === 2 && !T4_SERVER_REFRESHING);
  assert.ok(Math.abs(Number(await page.locator('[data-t4cfg="tmall:platformFeeRate"]').inputValue()) - 4.56) < 1e-9);
});

test('automatic remote changes never replace any open editing route', { skip: !chromium }, async t => {
  const { page, api } = await openClient(t, { width: 1440, height: 1000 });
  for (const route of ['cfg', 'mgmt', 'man', 'summan', 'expenses', 'returns', 'channel-edit', 'source-edit', 'mail', 'contacts', 'clear', 'imp', 'sumimp']) {
    await page.evaluate(route => { T4.imp = null; go(`t4-${route}`); }, route);
    const before = await remember(page, '#view input, #view textarea, #view select');
    api.version++;
    api.document.cfg.tmall.platformFeeRate += 0.001;
    await tick(page);
    assert.deepEqual(await page.evaluate(() => window.__pollGeometry()), before, `${route}: timer must preserve form nodes, coordinates and baseline`);
  }
});
