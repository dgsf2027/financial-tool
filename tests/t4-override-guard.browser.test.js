const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

// Run with an existing Playwright install via NODE_PATH. Every API, including
// writes, is intercepted even when FINANCE_BROWSER_BASE_URL points at a server.
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { /* Optional suite. */ }
let browser, server, baseURL;
const channel = 'tm_zzzrest', day = '2026-09-20', nextDay = '2026-09-21';
const outputDir = path.resolve(__dirname, '../../outputs/tmall-zzzrest-audit-20260923');
const importedDay = {
  _src: 'file',
  _fileParts: { summaryIncome: { retailIncome: 32129.21, returnAmount: -21468.19 }, summaryCost: { retailCost: 5033 } },
};
const importedNextDay = {
  _src: 'file',
  _fileParts: { summaryIncome: { retailIncome: 21584.36, returnAmount: -5497.88 }, summaryCost: { retailCost: 4059.78 } },
};

before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  if (!process.env.FINANCE_BROWSER_BASE_URL) {
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
  }
  baseURL = process.env.FINANCE_BROWSER_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  await fs.mkdir(outputDir, { recursive: true });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openPage(t, viewport, override) {
  const page = await browser.newPage({ viewport, colorScheme: 'light', serviceWorkers: 'block' });
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(30000);
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no browser exceptions'));
  const row = structuredClone(importedDay);
  if (override !== undefined) row.retailIncome = override;
  const document = {
    periods: { '2026-09': { [channel]: { [day]: row, [nextDay]: structuredClone(importedNextDay) } } },
    cfg: {}, channels: [], periodLocks: { '2026-09': false },
  };
  const api = { document, puts: 0, version: 1 };
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/session') {
      await route.fulfill({ json: { authenticated: true, name: '测试同事', loginUrl: '/sso/login' } });
    } else if (pathname === '/api/t4/workspace') {
      if (route.request().method() === 'PUT') {
        api.puts++;
        for (const change of route.request().postDataJSON().changes) {
          let value = document;
          for (const key of change.path.slice(0, -1)) value = value[key] ||= {};
          const key = change.path.at(-1);
          if (change.newExists) value[key] = change.value; else delete value[key];
        }
        api.version++;
      }
      await route.fulfill({ json: { version: api.version, document, found: true } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'API disabled by browser fixture' } });
    }
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { T4.period = '2026-09'; go('t4-cfg'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  await page.evaluate(() => { T4.dayCh = 'tm_zzzrest'; T4.projFilter = 'all'; go('t4-chday'); });
  return { page, api };
}

async function assertNoticeFits(page) {
  const note = page.locator('.t4-override-note');
  assert.equal(await note.isVisible(), true);
  const geometry = await note.evaluate(el => {
    const r = el.getBoundingClientRect();
    const button = el.querySelector('[data-t4review]').getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth, client: el.clientWidth, scroll: el.scrollWidth,
      buttonLeft: button.left, buttonRight: button.right };
  });
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.width + 1, 'warning stays inside the viewport');
  assert.ok(geometry.scroll <= geometry.client + 1, 'warning text wraps without clipping');
  assert.ok(geometry.buttonLeft >= geometry.left && geometry.buttonRight <= geometry.right, 'review action is within the warning');
}

for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 1000 }]]) {
  test(`${name}: historic duplicate deduction is visible and clearing the override repairs only September 20`, { skip: !chromium }, async t => {
    const { page, api } = await openPage(t, viewport, 10661.02);
    for (const view of ['t4', 't4-sheet', 't4-chday']) {
      await page.evaluate(view => go(view), view);
      assert.match(await page.locator('.t4-override-note').innerText(), /疑似重复扣退/);
      assert.match(await page.locator('.t4-override-note').innerText(), /2026-09-20.*天猫-zzzrest旗舰店/);
      assert.match(await page.locator('.t4-override-note').innerText(), /10,661\.02.*32,129\.21/);
      assert.equal(await page.locator('[data-t4review]').count(), 1, 'September 21 is not flagged');
    }
    await assertNoticeFits(page);
    await page.locator('.t4-override-note').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDir, `guard-ui-${name}.png`), fullPage: false });
    await page.locator(`[data-t4review="${channel}:${day}"]`).click();
    assert.equal(await page.locator('#t4ManFrom').inputValue(), day);
    assert.equal(await page.locator('#t4ManTo').inputValue(), day);
    const input = page.locator(`[data-t4cell="${day}:retailIncome"]`);
    assert.equal(await input.inputValue(), '10661.02');
    const hintId = await input.getAttribute('aria-describedby');
    assert.ok(hintId);
    assert.match(await page.locator(`[id="${hintId}"]`).innerText(), /人工覆盖.*32,129\.21[\s\S]*留空并保存可恢复导入值/);
    await input.fill('');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(() => CURS === 't4' && !T4_SERVER_SAVING);
    assert.equal(api.puts, 1);
    const stored = api.document.periods['2026-09'][channel];
    assert.equal(Object.hasOwn(stored[day], 'retailIncome'), false);
    assert.deepEqual(stored[day]._fileParts, importedDay._fileParts);
    assert.deepEqual(stored[nextDay], importedNextDay, 'clearing one day preserves September 21');
    assert.equal(await page.evaluate(() => Math.round(t4Row('tm_zzzrest', '2026-09-20').salesIncome * 100)), 1066102);
    assert.equal(await page.locator('.t4-override-note').count(), 0);
  });

  test(`${name}: channel and summary forms reject net income without losing any unsaved values`, { skip: !chromium }, async t => {
    for (const summary of [false, true]) {
      const { page, api } = await openPage(t, viewport);
      await page.evaluate(summary => {
        T4.editCh = 'tm_zzzrest'; T4.manFrom = T4.manTo = T4.sumDate = T4.sumTo = '2026-09-20';
        T4.sumScope = 'both'; go(summary ? 't4-summan' : 't4-man');
      }, summary);
      const selector = key => summary ? `[data-t4sumcell="${day}:${channel}:${key}"]` : `[data-t4cell="${day}:${key}"]`;
      await page.locator(selector('retailIncome')).fill('10661.02');
      await page.locator(selector('retailCost')).fill('5000');
      await page.getByRole('button', { name: summary ? '保存全部渠道' : '保存', exact: true }).click();
      const error = page.locator('#t4EntryError');
      await error.waitFor({ state: 'visible' });
      assert.match(await error.innerText(), /2026-09-20[\s\S]*重复扣退[\s\S]*本页输入已保留/);
      assert.equal(await error.getAttribute('role'), 'alert');
      assert.equal(await page.locator(selector('retailIncome')).inputValue(), '10661.02');
      assert.equal(await page.locator(selector('retailCost')).inputValue(), '5000');
      assert.equal(api.puts, 0);
      assert.deepEqual(api.document.periods['2026-09'][channel][day], importedDay, 'rejected batch leaves the API document unchanged');
      // The alert is a persistent part of the form, independent of the toast.
      await page.locator(selector('retailIncome')).fill('32129.21');
      assert.equal(await error.isVisible(), true);
      await page.getByRole('button', { name: summary ? '保存全部渠道' : '保存', exact: true }).click();
      await page.waitForFunction(() => CURS === 't4' && !T4_SERVER_SAVING);
      assert.equal(api.puts, 1);
      assert.equal(api.document.periods['2026-09'][channel][day].retailCost, 5000);
      assert.deepEqual(api.document.periods['2026-09'][channel][nextDay], importedNextDay);
    }
  });
}

test('reimport requires native confirmation, cancellation keeps the draft, and accepted import records the retained override', { skip: !chromium }, async t => {
  const { page, api } = await openPage(t, { width: 1440, height: 1000 }, 30000);
  await page.evaluate(() => go('t4'));
  await page.getByRole('button', { name: '收入成本导入', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择汇总文件', exact: true }).click();
  await (await chooser).setFiles({ name: 'sales-override.csv', mimeType: 'text/csv',
    buffer: Buffer.from('销售渠道,发货时间,分摊后金额,货品成本\n天猫-zzzrest旗舰店,2026-09-20,33000,5100\n') });
  const before = structuredClone(api.document);
  let canceledMessage;
  page.once('dialog', async dialog => { canceledMessage = dialog.message(); assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
  await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
  await page.waitForFunction(() => T4.imp && /已取消导入/.test(document.querySelector('#view').innerText));
  assert.match(canceledMessage, /2026-09-20[\s\S]*人工/);
  assert.equal(api.puts, 0);
  assert.deepEqual(api.document, before);
  assert.equal(await page.evaluate(() => Object.keys(T4.importHistory).length), 0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '导入全部渠道', exact: true }).click();
  await page.waitForFunction(() => CURS === 't4-history' && !T4_SERVER_SAVING);
  assert.equal(api.puts, 1);
  assert.equal(api.document.periods['2026-09'][channel][day].retailIncome, 30000);
  assert.equal(api.document.periods['2026-09'][channel][day]._fileParts.summaryIncome.retailIncome, 33000);
  assert.deepEqual(api.document.periods['2026-09'][channel][nextDay], importedNextDay);
  const history = await page.evaluate(() => Object.values(T4.importHistory));
  assert.equal(history.length, 1);
  assert.ok(history[0].issues.some(issue => /人工/.test(issue) && /覆盖/.test(issue)));
  assert.match(await page.locator('#view').innerText(), /人工/);
});
