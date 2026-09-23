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
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
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
  baseURL = process.env.FINANCE_BROWSER_BASE_URL || `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openPage(t, viewport) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(30000);
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no browser exceptions'));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, name: '测试同事', loginUrl: '/sso/login' } }));
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
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { T4.period = '2026-09'; go('t4-cfg'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  return page;
}

for (const width of [1440, 390]) {
  test(`Douyin shipping insurance can be added, saved, reloaded and removed at ${width}px`, { skip: !chromium }, async t => {
    const page = await openPage(t, { width, height: 900 });
    const card = page.locator('#view .card').filter({ has: page.locator('[data-t4cfgadd="dycreator"]') });
    const select = card.locator('.t4addsel');
    const field = card.locator('[data-t4cfg="dycreator:shippingInsuranceRate"]');
    for (const channel of ['dycreator', 'dy_zzzrest', 'dy_orange']) {
      assert.equal(await page.locator(`.t4addsel[data-ch="${channel}"] option[value="shippingInsuranceRate"]`).textContent(), '运费险（%）');
    }
    assert.equal(await field.count(), 0, 'insurance must stay opt-in');
    await select.selectOption('shippingInsuranceRate');
    await card.locator('[data-t4cfgadd]').click();
    await field.waitFor();
    await field.fill('1.25');
    await card.locator('[data-t4act="cfgSave"]').click();
    await page.waitForFunction(() => !T4_SERVER_SAVING && T4_SERVER_DOCUMENT.cfgByPeriod['2026-09'].dycreator.shippingInsuranceRate === 0.0125);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { T4.period = '2026-09'; go('t4-cfg'); });
    await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
    assert.equal(await field.inputValue(), '1.25');
    const result = await page.evaluate(() => {
      T4.data.dycreator['2026-09-01'] = { retailIncome: 1000, retailCost: 400, refundAmount: -100 };
      const r = t4Row('dycreator', '2026-09-01');
      delete T4.data.dycreator['2026-09-01'];
      return { insurance: r.shippingInsurance, operating: r.operating, netProfit: r.netProfit };
    });
    assert.deepEqual(result, { insurance: 12.5, operating: 12.5, netProfit: 487.5 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `/tmp/finance-shipping-insurance-${width}.png` });
    await card.locator('[data-t4cfgdel="dycreator:shippingInsuranceRate"]').click();
    await field.waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { T4.period = '2026-09'; go('t4-cfg'); });
    await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
    assert.equal(await field.count(), 0, 'deleted insurance rule must stay deleted after reload');
    assert.equal(await select.locator('option[value="shippingInsuranceRate"]').count(), 1);
  });
}

test('direct visitors see a usable login link after a workspace 401', { skip: !chromium }, async t => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.close());
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: false, loginUrl: '/sso/login' } }));
  await page.route('**/api/t4/workspace', route => route.fulfill({ status: 401, body: '需要门户登录' }));
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => go('t4-channels'));
  await page.waitForFunction(() => !T4_SERVER_LOADING && T4_SERVER_LAST_KEY.startsWith('error:'));
  assert.equal(await page.locator('#uNm').innerText(), '未登录');
  const view = await page.locator('#view').innerText();
  assert.match(view, /请先登录财务中心/);
  assert.doesNotMatch(view, /<span|连接中/);
  assert.equal(await page.locator('#view a[href="/sso/login"]').count(), 1);
  let chosenFile = false;
  page.on('filechooser', async chooser => { chosenFile = true; await chooser.setFiles([]); });
  await page.getByRole('button', { name: '导入渠道列表', exact: true }).click();
  // The guard must run before opening the picker so login failure is visible immediately.
  assert.equal(chosenFile, false);
  assert.match(await page.locator('#toast').innerText(), /登录/);
  await page.screenshot({ path: '/tmp/finance-login-required.png', fullPage: true });
});

test('an authenticated colleague sees their own name and no login button', { skip: !chromium }, async t => {
  const page = await openPage(t, { width: 1440, height: 900 });
  await page.waitForFunction(() => document.getElementById('uNm').textContent === '测试同事');
  assert.equal(await page.locator('#financeLogin').isVisible(), false);
  await page.evaluate(() => go('t4-channels'));
  assert.match(await page.locator('#view').innerText(), /已连接财务中心，可保存/);
  assert.doesNotMatch(await page.locator('#view').innerText(), /<span/);
});

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


for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`channel workbook uploads create persistent field tabs and channel pages (${viewport.width}px)`, { skip: !chromium }, async t => {
    const page = await openPage(t, viewport);
    await page.evaluate(() => go('t4-channels'));
    const workbook = await page.evaluate(async () => Array.from(new Uint8Array(await XLSXWrite.build([
      { name: '说明', rows: [['请维护渠道列表']] },
      { name: '新渠道', rows: [['渠道列表'], ['负责人', '渠道汇总', '销售渠道', '归属事业部', '预算', '备注'],
        ['张三', '测试新增渠道', '测试新店', '大电商', 0, '<img src=x onerror="window.importInjected=1">']] },
      { name: '第二张渠道表', rows: [['销售渠道', '归属事业部', '所在地区'], ['测试第二店', '经销', '杭州']] },
    ]).arrayBuffer())));
    const upload = async () => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '导入渠道列表', exact: true }).click();
      await (await chooser).setFiles({ name: '灵活渠道.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) });
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已识别 2 张渠道表'));
    };
    await upload();
    assert.equal(await page.evaluate(() => T4_CH.filter(c => c.custom).length), 2);
    await page.getByRole('button', { name: '负责人', exact: true }).click();
    assert.equal(await page.locator('#view tbody tr').count(), 1);
    assert.match(await page.locator('#view tbody').innerText(), /张三/);
    await page.getByRole('button', { name: '备注', exact: true }).click();
    assert.match(await page.locator('#view tbody').innerText(), /<img src=x/);
    assert.equal(await page.locator('#view tbody img').count(), 0);
    assert.equal(await page.evaluate(() => window.importInjected), undefined);
    await page.getByRole('button', { name: '预算', exact: true }).click();
    assert.equal(await page.locator('#view tbody td').nth(3).innerText(), '0');
    await page.getByRole('button', { name: '明细', exact: true }).click();
    assert.equal(await page.locator('#t4DayCh option:checked').textContent(), '测试新增渠道');
    await page.evaluate(() => go('t4-channels'));
    await page.getByRole('button', { name: '负责人', exact: true }).click();
    await page.getByRole('button', { name: '录入', exact: true }).click();
    assert.equal(await page.locator('#t4chSel option:checked').textContent(), '测试新增渠道');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => go('t4-channels'));
    await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
    await page.getByRole('button', { name: '负责人', exact: true }).click();
    assert.match(await page.locator('#view tbody').innerText(), /张三/);
    await upload();
    assert.equal(await page.evaluate(() => T4_CH.filter(c => c.custom).length), 2, 'reimport retains identity');
    await page.getByRole('button', { name: '所在地区', exact: true }).click();
    assert.match(await page.locator('#view tbody').innerText(), /杭州/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'tabs and tables scroll inside the page');
    await page.screenshot({ path: `/tmp/finance-t4-channel-${viewport.width}.png`, fullPage: true });
    const downloaded = await page.evaluate(async () => {
      let blob;
      const original = downloadBlob;
      downloadBlob = (_, value) => { blob = value; };
      try { await t4ChTemplate(); } finally { downloadBlob = original; }
      return XLSXLite.readTable(new File([blob], '渠道列表.xlsx'));
    });
    assert.ok(downloaded[0].includes('负责人'));
    assert.ok(downloaded.some(row => row.includes('测试新店') && row.includes('张三')));
  });
}
