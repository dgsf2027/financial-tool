const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, child, base, localBase;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  const port = await new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(() => resolve(p)); }); });
  localBase = `http://127.0.0.1:${port}`;
  base = process.env.FINANCE_BROWSER_BASE_URL || localBase;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${localBase}/healthz`)).ok) return; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('local return test server did not start');
});
after(async () => { await browser?.close(); child?.kill(); });

test('return module is served by the actual local gateway static allowlist', { skip: !chromium }, async () => {
  // Kept local even when FINANCE_BROWSER_BASE_URL points at a deployed frontend.
  const response = await fetch(`${localBase}/t4-returns.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /function t4ReturnValues/);
});

for (const width of [1440, 390]) test(`rebate income deduction, zero and failed save retry at ${width}px`, { skip: !chromium }, async t => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  t.after(() => page.close()); page.setDefaultTimeout(7000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let document = { periods: { '2026-09': { tm_orange: { '2026-09-12': {
    retailIncome: 1000, retailCost: 400, refundAmount: -100, rebateIncome: 20, salesReceipt: 800, _src: 'file',
  } } } },
    cfg: {}, cfgByPeriod: { '2026-09': { tm_orange: { platformFeeRate: 0.05 } } },
    channels: [], expenseItems: [], periodLocks: { '2026-09': false } };
  let version = 1, failNext = false, writes = 0, mailCalls = 0;
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, name: '返款测试用户' } }));
  await page.route('**/api/t4/workspace', async route => {
    if (route.request().method() === 'PUT') {
      writes++;
      if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: '模拟共享保存失败' } }); }
      for (const change of route.request().postDataJSON().changes) {
        let value = document;
        for (const key of change.path.slice(0, -1)) value = value[key] ||= {};
        const key = change.path.at(-1);
        if (change.newExists) value[key] = change.value; else delete value[key];
      }
      version++;
    }
    return route.fulfill({ json: { found: true, version, document } });
  });
  await page.route('**/api/t4/mail', route => { mailCalls++; return route.abort(); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { T4.period = '2026-09'; go('t4'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  await page.getByRole('button', { name: '瑞眠 / 橘农返款', exact: true }).click();
  const channel = page.locator('[data-return-field="channel"]'), date = page.locator('[data-return-field="date"]');
  const amount = page.locator('[data-return-field="amount"]');
  const save = page.getByRole('button', { name: '保存返款', exact: true });
  assert.equal(await page.locator('[data-return-field="type"]').count(), 0);
  assert.match(await page.locator('#view').innerText(), /扣减.*收入/);
  await channel.selectOption('tm_orange');
  await date.fill('2026-09-12'); await date.press('Tab');
  // Invalid input is rejected before the shared API sees a write.
  await amount.fill('-1'); await save.click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('返款未保存'));
  assert.equal(writes, 0); assert.equal(await amount.inputValue(), '-1');
  await amount.fill('50'); await save.click();
  await page.waitForFunction(() => !T4_SERVER_SAVING && t4InputValue(t4Raw('tm_orange','2026-09-12'),'rebateAmount') === -50);
  const row = () => page.evaluate(() => { const r=t4Row('tm_orange','2026-09-12');return {sales:r.salesIncome,fee:r.platformFee,profit:r.netProfit,rebate:r.rebateAmount,refund:r.refundAmount,legacyRebate:r.rebateIncome,receipt:r.salesReceipt}; });
  assert.deepEqual(await row(), { sales: 850, fee: 42.5, profit: 427.5, rebate: -50, refund: -100, legacyRebate: 20, receipt: 800 });
  assert.equal(document.periods['2026-09'].tm_orange['2026-09-12'].rebateAmount, -50);
  await amount.fill('0'); await save.click();
  await page.waitForFunction(() => !T4_SERVER_SAVING && t4InputValue(t4Raw('tm_orange','2026-09-12'),'rebateAmount') === 0);
  assert.deepEqual(await row(), { sales: 900, fee: 45, profit: 475, rebate: 0, refund: -100, legacyRebate: 20, receipt: 800 });
  failNext = true;
  await amount.fill('30'); await save.click();
  await page.waitForFunction(() => !T4_SERVER_SAVING && document.getElementById('toast').textContent.includes('返款未保存'));
  assert.equal(await amount.inputValue(), '30');
  assert.equal((await row()).rebate, 0);
  assert.equal(document.periods['2026-09'].tm_orange['2026-09-12'].rebateAmount, 0);
  assert.equal(await save.isEnabled(), true);
  await save.click();
  await page.waitForFunction(() => !T4_SERVER_SAVING && t4InputValue(t4Raw('tm_orange','2026-09-12'),'rebateAmount') === -30);
  assert.equal((await row()).profit, 446.5);
  const exported = await page.evaluate(() => {
    T4.projFilter='orange';T4.viewFrom='2026-09-12';T4.viewTo='2026-09-12';
    const payload=t4SuitePayload({useViewRange:true});
    return {daily:payload.dailyByCh.tm_orange[0],total:payload.monthByCh.tm_orange,raw:t4RawExportRows().rows,fields:T4_INPUTS};
  });
  for (const value of [exported.daily, exported.total]) {
    assert.equal(value.salesIncome, 870); assert.equal(value.platformFee, 43.5); assert.equal(value.netProfit, 446.5);
    assert.equal(value.rebateAmount, -30); assert.equal(value.refundAmount, -100);
    assert.equal(value.salesReceipt, 800); assert.equal(value.rebateIncome, 20);
  }
  // An entry into an old import must not relabel its original inputs as manual.
  const column = key => exported.raw[0].indexOf(exported.fields.find(f => f.k === key).n);
  const sourceColumn = exported.raw[0].indexOf('来源代码');
  assert.equal(exported.raw.length, 3);
  const legacy = exported.raw.find(r => r[sourceColumn] === 'legacy-file');
  const manual = exported.raw.find(r => r[sourceColumn] === 'manual');
  assert.ok(legacy); assert.ok(manual);
  for (const [key, value] of Object.entries({retailIncome:1000,retailCost:400,refundAmount:-100,rebateIncome:20,salesReceipt:800})) {
    assert.equal(legacy[column(key)], value); assert.equal(manual[column(key)], '');
  }
  assert.equal(legacy[column('rebateAmount')], ''); assert.equal(manual[column('rebateAmount')], -30);
  assert.deepEqual(document.periods['2026-09'].tm_orange['2026-09-12']._manualFields, { rebateAmount: true });
  await page.screenshot({ path: `/tmp/finance-returns-${width}.png`, fullPage: true });

  const beforeLock = JSON.stringify(document);
  await page.evaluate(() => { T4.periodLocks['2026-09']=true; go('t4-returns'); });
  assert.equal(await save.isDisabled(), true); assert.equal(await amount.isDisabled(), true);
  assert.equal(JSON.stringify(document), beforeLock); assert.equal(writes, 4);
  await page.evaluate(() => { T4.periodLocks['2026-09']=false; go('t4-returns'); });

  // A rebate-only day is still included in reports and exports, despite no sales input.
  await date.fill('2026-09-13'); await date.press('Tab');
  await amount.fill('75'); await save.click();
  await page.waitForFunction(() => !T4_SERVER_SAVING && t4InputValue(t4Raw('tm_orange','2026-09-13'),'rebateAmount') === -75);
  await page.evaluate(() => { T4.projFilter='orange'; T4.viewFrom='2026-09-13'; T4.viewTo='2026-09-13'; go('t4'); });
  const overviewRow = page.locator('tr').filter({ has: page.locator('[data-t4go="man:tm_orange"]') });
  assert.equal(await overviewRow.locator('td').nth(6).innerText(), '-75.00');
  assert.equal(await overviewRow.locator('td').nth(7).innerText(), '-71.25');
  const rebatePayload = await page.evaluate(() => t4SuitePayload({ useViewRange: true }));
  assert.equal(rebatePayload.channels.find(c => c.id === 'tm_orange').filled, 0);
  assert.equal(rebatePayload.dailyByCh.tm_orange[0].has, true);
  assert.equal(rebatePayload.dailyByCh.tm_orange[0].salesIncome, -75);
  assert.equal(rebatePayload.dailyByCh.tm_orange[0].platformFee, -3.75);
  assert.equal(rebatePayload.dailyByCh.tm_orange[0].netProfit, -71.25);
  assert.equal(rebatePayload.monthByCh.tm_orange.netProfit, -71.25);
  await page.getByRole('button', { name: '看损益表', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本表', exact: true }).click();
  const downloaded = await downloadEvent;
  assert.match(downloaded.suggestedFilename(), /橘农项目_2026-09-13_2026-09-13\.csv$/);
  const csvText = await fs.readFile(await downloaded.path(), 'utf8');
  const csv = await page.evaluate(text => XLSXLite.parseCSV(text), csvText);
  const profitColumn = csv[0].indexOf('净利润'), salesColumn = csv[0].indexOf('销售收入');
  const basisColumn = csv[0].indexOf('取数口径');
  for (const summaryName of ['橘农事业部汇总', '橘农项目汇总']) {
    const summary = csv.find(r => r[1] === summaryName);
    assert.ok(summary, `missing ${summaryName}`);
    assert.equal(summary[profitColumn], '-71.25');
    assert.equal(summary[salesColumn], '-75.00');
    assert.match(summary[basisColumn], /按已保存数据汇总；渠道收入取数天数极差 0 天/);
    assert.ok(!summary.includes('禁用'));
  }
  const daily = csv.find(r => r[3] === '2026-09-13');
  assert.ok(daily); assert.equal(daily[profitColumn], '-71.25');
  assert.equal(writes, 5); assert.equal(mailCalls, 0); assert.deepEqual(errors, []);
});
