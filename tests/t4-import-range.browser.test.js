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


test('combined import history and distinct daily entry work through the browser', {skip: !chromium}, async t => {
  const page = await openPage(t, {width:1440,height:900});
  await page.evaluate(() => go('t4'));
  await page.getByRole('button', {name:'收入成本导入',exact:true}).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'选择汇总文件',exact:true}).click();
  await (await chooser).setFiles({name:'收入成本.csv',mimeType:'text/csv',buffer:Buffer.from('销售渠道,发货时间,分摊后金额,货品成本\n天猫-澳乐旗舰店,2026-09-01,100,40\n未知店铺,2026-09-01,50,20\n')});
  await page.getByRole('button', {name:'导入全部渠道',exact:true}).click();
  await page.waitForFunction(() => CURS === 't4-history' && !T4_SERVER_SAVING);
  assert.match(await page.locator('#view').innerText(), /有效 1 行、跳过 1 行/);
  assert.equal(await page.evaluate(() => Object.values(T4.importHistory).length),1);
  await page.evaluate(() => {T4.sumScope='both'; go('t4-summan')});
  await page.locator('#t4SumTo').fill('2026-09-02');
  await page.locator('#t4SumTo').blur();
  const first = page.locator('[data-t4sumcell="2026-09-01:tmall:retailIncome"]');
  const second = page.locator('[data-t4sumcell="2026-09-02:tmall:retailCost"]');
  await first.fill('123'); await second.fill('0');
  await page.getByRole('button', {name:'保存全部渠道',exact:true}).click();
  await page.waitForFunction(() => CURS === 't4' && !T4_SERVER_SAVING);
  assert.deepEqual(await page.evaluate(() => ({a:T4.data.tmall['2026-09-01'].retailIncome,b:T4.data.tmall['2026-09-02'].retailCost,c:T4.data.tmall['2026-09-02'].retailIncome ?? null})),{a:123,b:0,c:null});
  await page.evaluate(() => go('t4-clear'));
  await page.locator('#t4ClearFrom').fill('2026-09-02'); await page.locator('#t4ClearTo').fill('2026-09-02');
  await page.locator('#t4ClearScope').selectOption('cost');
  page.once('dialog', dialog => dialog.accept('2026-09'));
  await page.getByRole('button', {name:'清空所选板块',exact:true}).click();
  await page.waitForFunction(() => CURS === 't4' && !T4_SERVER_SAVING);
  assert.equal(await page.evaluate(() => T4.data.tmall['2026-09-01'].retailIncome),123);
  assert.equal(await page.evaluate(() => T4.data.tmall['2026-09-02'] ?? null),null);
});
