const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, baseURL;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  server = http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(name)) return res.writeHead(404).end();
    try {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(path.join(__dirname, '..', name === '/' ? 'index.html' : name.slice(1))));
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

test('channel and custom expense forms save to shared state and show failed writes without applying them', { skip: !chromium }, async t => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.close());
  const errors = []; page.on('pageerror', err => errors.push(err.message));
  let remote = { periods: {}, cfg: {}, channels: [], expenseItems: [], periodLocks: { '2026-09': false } }, version = 1, reject = false;
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, name: '测试同事', loginUrl: '/sso/login' } }));
  await page.route('**/api/t4/workspace', async route => {
    if (route.request().method() === 'PUT') {
      if (reject) return route.fulfill({ status: 503, json: { error: '测试保存失败' } });
      for (const change of route.request().postDataJSON().changes) {
        let value = remote;
        for (const key of change.path.slice(0, -1)) value = value[key] ||= {};
        const key = change.path.at(-1);
        if (change.newExists) value[key] = change.value; else delete value[key];
      }
      version++;
    }
    return route.fulfill({ json: { version, found: true, document: remote } });
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { T4.period = '2026-09'; go('t4-channels'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  await page.getByRole('button', { name: '新增归集渠道', exact: true }).click();
  await page.getByLabel('归集渠道名称', { exact: true }).fill('财务测试门店');
  await page.getByLabel('归属事业部', { exact: true }).selectOption('orange');
  await page.getByLabel('新增销售渠道别名', { exact: true }).fill('平台原门店');
  await page.screenshot({ path: '/tmp/finance-channel-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/finance-channel-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '保存渠道', exact: true }).click();
  await page.waitForFunction(() => CURS === 't4-channels');
  const original = remote.channels.find(c => c.n === '财务测试门店');
  assert.ok(original?.id);
  await page.getByRole('button', { name: '归集渠道', exact: true }).click();
  await page.locator(`[data-t4chedit="${original.id}"]`).click();
  await page.getByLabel('归集渠道名称', { exact: true }).fill('财务新门店');
  await page.getByRole('button', { name: '保存渠道', exact: true }).click();
  await page.waitForFunction(() => CURS === 't4-channels');
  assert.equal(remote.channels.find(c => c.n === '财务新门店').id, original.id);
  assert.equal(await page.evaluate(() => t4ResolveChannel('财务测试门店')), original.id);
  assert.equal(await page.evaluate(() => t4ResolveChannel('平台原门店')), original.id);

  await page.evaluate(() => go('t4'));
  await page.getByRole('button', { name: '运营费用', exact: true }).click();
  await page.getByRole('button', { name: '新增费用科目', exact: true }).click();
  await page.getByLabel('科目名称', { exact: true }).fill('直播服务费');
  await page.getByRole('button', { name: '保存科目', exact: true }).click();
  await page.getByLabel('直播服务费金额', { exact: true }).waitFor();
  const expenseKey = remote.expenseItems[0].k;
  await page.getByLabel('直播服务费金额', { exact: true }).fill('123.45');
  await page.getByRole('button', { name: '修改名称', exact: true }).click();
  await page.getByLabel('科目名称', { exact: true }).fill('直播服务费用');
  await page.getByRole('button', { name: '保存科目', exact: true }).click();
  await page.getByLabel('直播服务费用金额', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('直播服务费用金额', { exact: true }).inputValue(), '123.45');
  await page.getByRole('button', { name: '保存当日费用', exact: true }).click();
  await page.waitForFunction(() => !T4_SERVER_SAVING && document.getElementById('toast').textContent.includes('当日费用'));
  assert.equal(remote.periods['2026-09'].tmall['2026-09-01'][expenseKey], 123.45);
  assert.equal(await page.evaluate(() => t4Row('tmall', '2026-09-01').netProfit), -123.45);
  await page.getByLabel('日期', { exact: true }).fill('2026-09-02');
  await page.getByLabel('直播服务费用金额', { exact: true }).fill('0');
  await page.getByRole('button', { name: '保存当日费用', exact: true }).click();
  await page.waitForFunction(() => t4Raw('tmall', '2026-09-02') !== null && !T4_SERVER_SAVING);
  assert.equal(remote.periods['2026-09'].tmall['2026-09-02'][expenseKey], 0);
  await page.waitForFunction(() => !document.getElementById('toast').classList.contains('on'));
  await page.screenshot({ path: '/tmp/finance-catalog-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/finance-catalog-mobile.png', fullPage: true });

  reject = true;
  await page.getByRole('button', { name: '新增费用科目', exact: true }).click();
  await page.getByLabel('科目名称', { exact: true }).fill('未保存费用');
  await page.getByRole('button', { name: '保存科目', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /测试保存失败/);
  assert.equal(await page.getByLabel('科目名称', { exact: true }).inputValue(), '未保存费用');
  assert.equal(remote.expenseItems.length, 1);
  assert.equal(await page.evaluate(() => T4.expenseItems.length), 1);
  assert.deepEqual(errors, []);
});
