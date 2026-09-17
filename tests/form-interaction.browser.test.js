const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

// Optional browser suite: NODE_PATH may point to an existing Playwright install.
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { /* Runtime stays dependency-free. */ }
let browser, server, baseURL;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true });
  server = http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(name)) {
      res.writeHead(404).end(); return;
    }
    try {
      const file = path.join(__dirname, '..', name === '/' ? 'index.html' : name.slice(1));
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(file));
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openPage(t, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no browser exceptions'));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  // Keep the real shared-workspace client; only the remote API is a fixture.
  let document = { periods: {}, cfg: { pdd_aole: { platformFeeRate: 0.05 } }, channels: [], periodLocks: { '2026-09': false } };
  let version = 1;
  await page.route('**/api/t4/workspace', async route => {
    if (route.request().method() === 'PUT') {
      for (const change of route.request().postDataJSON().changes) {
        let value = document;
        for (const key of change.path.slice(0, -1)) value = value[key] ||= {};
        const key = change.path.at(-1);
        if (change.newExists) value[key] = change.value; else delete value[key];
      }
      version++;
    }
    await route.fulfill({ json: { version, document, found: true } });
  });
  await page.goto(baseURL);
  await page.evaluate(() => { T4.period = '2026-09'; go('t4-cfg'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  return page;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`T4 parameter saves and rule edits retain the current position (${viewport.width}px)`, { skip: !chromium && 'Install Playwright to run browser interaction tests' }, async t => {
    const page = await openPage(t, viewport);
    const card = page.locator('#view .card').filter({ has: page.locator('[data-t4cfg^="pdd_aole:"]') });
    const input = card.locator('[data-t4cfg]').first();
    const field = await input.getAttribute('data-t4cfg');
    await input.fill('12.34');
    const save = card.locator('[data-t4act="cfgSave"]');
    await save.scrollIntoViewIfNeeded();
    const beforeSave = await page.evaluate(() => window.scrollY);
    assert.ok(beforeSave > 500, 'exercise a channel well below the page header');
    await save.click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('参数已保存'));
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - beforeSave) <= 2, 'saving must not jump to the header');
    assert.equal(await page.locator(`[data-t4cfg="${field}"]`).inputValue(), '12.34');

    const select = card.locator('.t4addsel');
    const key = await select.locator('option').nth(1).getAttribute('value');
    const channel = await select.getAttribute('data-ch');
    await select.selectOption(key);
    const beforeAdd = await page.evaluate(() => window.scrollY);
    await card.locator('[data-t4cfgadd]').click();
    await page.locator(`[data-t4cfg="${channel}:${key}"]`).waitFor();
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - beforeAdd) <= 2, 'adding a rule must stay at this channel');
    await page.locator(`[data-t4cfgdel="${channel}:${key}"]`).click();
    await page.locator(`[data-t4cfg="${channel}:${key}"]`).waitFor({ state: 'detached' });
    assert.ok(await page.evaluate(() => window.scrollY) > 500, 'deleting a rule must stay below the header');
    await page.locator('[data-t4go="overview"]').click();
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'navigation to another page starts at the top');
  });
}

test('same-page refresh retains table scroll, focused cell and text selection', { skip: !chromium }, async t => {
  const page = await openPage(t, { width: 680, height: 800 });
  await page.evaluate(() => go('t4-man'));
  const state = await page.evaluate(() => {
    const table = document.querySelector('#view .tw');
    const cell = table.querySelectorAll('input')[100];
    cell.focus();
    table.scrollTop = 210; table.scrollLeft = 380;
    window.scrollTo(0, 160);
    const before = { top: table.scrollTop, left: table.scrollLeft, y: window.scrollY, field: cell.dataset.t4cell };
    go(CURS);
    const updated = document.querySelector('#view .tw');
    return { before, after: { top: updated.scrollTop, left: updated.scrollLeft, y: window.scrollY, field: document.activeElement.dataset.t4cell } };
  });
  assert.ok(state.before.top > 0 && state.before.left > 0, 'exercise both table scroll axes');
  assert.deepEqual(state.after, state.before);
  const selection = await page.evaluate(() => {
    T2.rows = [['日期', '摘要', '金额'], ['2026-09-01', '测试', 100]];
    T2.file = new File(['日期,摘要,金额\n2026-09-01,测试,100'], 'test.csv');
    T2.step = 2; go('t2');
    const input = document.getElementById('vchWord');
    input.value = '记账凭证'; T2.vchWord = input.value;
    input.focus(); input.setSelectionRange(1, 3);
    go(CURS);
    const active = document.activeElement;
    return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
  });
  assert.deepEqual(selection, { id: 'vchWord', start: 1, end: 3 });
});

test('tax form supports consecutive Tab and pointer edits without losing focus or scrolling to the top', { skip: !chromium }, async t => {
  const page = await openPage(t, { width: 1100, height: 700 });
  await page.evaluate(() => { pickEnt('youqi'); go('iv-cit'); });
  await page.locator('#citStaff').fill('23');
  await page.locator('#citStaff').evaluate(el => el.scrollIntoView({ block: 'center' }));
  const originalStaff = await page.locator('#citStaff').elementHandle();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Tab');
  await page.waitForFunction(el => !el.isConnected, originalStaff);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'citAssets');
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - before) <= 2);
  await page.keyboard.type('1200');
  const originalAssets = await page.locator('#citAssets').elementHandle();
  await page.locator('#citStaff').click();
  await page.waitForFunction(el => !el.isConnected, originalAssets);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'citStaff');
  assert.equal(await page.locator('#citAssets').inputValue(), '1200');
  assert.ok(await page.evaluate(() => window.scrollY) > 0);
});

test('a blur refresh does not swallow a held navigation click or repaint after leaving the form', { skip: !chromium }, async t => {
  const page = await openPage(t, { width: 1440, height: 900 });
  await page.evaluate(() => { pickEnt('youqi'); go('iv-cit'); });
  await page.locator('#citStaff').fill('27');
  const box = await page.locator('[data-d="tools"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A person may hold the mouse/touch down for multiple frames before releasing.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.up();
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await page.evaluate(() => CURS), 'tool-list');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
});

test('opening an existing entity still brings its edit form into view', { skip: !chromium }, async t => {
  const page = await openPage(t, { width: 1100, height: 700 });
  await page.evaluate(() => go('p-entity'));
  const edit = page.locator('[data-enedit="youqi"]');
  await edit.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => window.scrollY) > 300);
  await edit.click();
  assert.equal(await page.locator('#enId').inputValue(), 'youqi');
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'opening an edit form is navigation, not an in-place refresh');
});
