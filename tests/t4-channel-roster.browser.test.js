const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

// Live-site runs load deployed assets only: every API request is mocked, and
// service workers are blocked. Optional customer fixtures stay outside git.
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, baseURL;
const outputDir = process.env.FINANCE_CHANNEL_SCREENSHOTS;
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

function shared(channels = []) {
  return { version: 1, puts: 0, reject: false, document: {
    periods: { '2026-09': { gift: { '2026-09-20': { retailIncome: 123.45 } } } },
    cfg: {}, channels: structuredClone(channels), periodLocks: { '2026-09': false },
  } };
}
async function openClient(t, api, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no browser exceptions'));
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await context.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/session') {
      return route.fulfill({ json: { authenticated: true, name: '渠道验收同事', loginUrl: '/sso/login' } });
    }
    if (pathname !== '/api/t4/workspace') {
      return route.fulfill({ status: 404, json: { error: 'API disabled by channel browser fixture' } });
    }
    if (route.request().method() === 'PUT') {
      api.puts++;
      if (api.reject) return route.fulfill({ status: 503, json: { error: '渠道保存测试失败' } });
      for (const change of route.request().postDataJSON().changes) {
        let value = api.document;
        for (const key of change.path.slice(0, -1)) value = value[key] ||= {};
        const key = change.path.at(-1);
        if (change.newExists) value[key] = change.value; else delete value[key];
      }
      api.version++;
    }
    return route.fulfill({ json: { version: api.version, found: true, document: api.document } });
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await enterChannels(page);
  return page;
}
async function enterChannels(page) {
  await page.evaluate(() => { T4.period = '2026-09'; go('t4-channels'); });
  await page.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING && !T4_SERVER_SAVING);
  assert.equal(await page.getByRole('button', { name: '销售渠道', exact: true }).getAttribute('aria-pressed'), 'true');
}
async function reloadChannels(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterChannels(page);
}
async function importWorkbook(page, file) {
  const previousVersion = await page.evaluate(() => T4_SERVER_VERSION);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入渠道列表', exact: true }).click();
  await (await chooser).setFiles(file);
  await page.waitForFunction(previous => T4_SERVER_VERSION > previous && !T4_SERVER_SAVING && /已识别.*张渠道表/.test(document.getElementById('toast').textContent), previousVersion);
}
async function workbook(page, rows) {
  const bytes = await page.evaluate(async rows => Array.from(new Uint8Array(await XLSXWrite.build([{ name: '渠道列表', rows }]).arrayBuffer())), rows);
  return { name: 'channel-roster.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) };
}
function sourceButton(page, name) {
  return page.getByRole('button', { name: `修改销售渠道 ${name}`, exact: true });
}
async function sourceRows(page) {
  return page.locator('#view tbody tr').evaluateAll(rows => rows.filter(row => row.querySelector('[data-t4sourceedit]')).map(row => {
    const cells = [...row.cells].map(cell => cell.textContent.trim());
    return { source: cells[0], target: cells[2], number: cells[3], status: cells[4] };
  }));
}
async function saveSource(page) {
  await page.getByRole('button', { name: '保存销售渠道', exact: true }).click();
  await page.waitForFunction(() => CURS === 't4-channels' && !T4_SERVER_SAVING);
}
const detailRows = document => document.channels.flatMap(c => (c.details || []).map(row => ({ ...row, channel: c.id })));

test('xlsx import survives fresh clients; editing one shop and adding shops or aliases preserves its peers and financial data', { skip: !chromium }, async t => {
  const api = shared(), financial = structuredClone(api.document.periods);
  const page = await openClient(t, api);
  await importWorkbook(page, await workbook(page, [
    ['渠道ID', '销售渠道', '归属事业部', '渠道汇总', '编号', '负责人'],
    ['gift', '回归礼品甲店', '经销事业部', '分销-澳乐礼品单', '0001', '甲'],
    ['gift', '回归礼品乙店', '经销事业部', '分销-澳乐礼品单', '0002', '乙'],
    ['jdpop', '京东-澳乐官方旗舰店', '大电商', '京东POP', '0003', '丙'],
  ]));
  assert.equal(detailRows(api.document).length, 3);
  assert.equal(await sourceButton(page, '京东-澳乐官方旗舰店').count(), 1, 'a mapped built-in name has no duplicate fallback row');
  await reloadChannels(page);
  const colleague = await openClient(t, api);
  assert.deepEqual(await sourceRows(colleague), await sourceRows(page), 'separate local storage loads the same shared roster');

  const peerBefore = structuredClone(detailRows(api.document).find(row => row.source === '回归礼品乙店'));
  const summaryBefore = await page.evaluate(() => ({ n: T4_CHM.gift.n, bu: T4_CHM.gift.bu }));
  await sourceButton(page, '回归礼品甲店').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const formFits = await page.locator('.t4-catalog-form').evaluate(form => {
    const bounds = form.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && form.scrollWidth <= form.clientWidth + 1;
  });
  assert.equal(formFits, true, 'single-shop editor fits a phone viewport');
  if (outputDir) await page.screenshot({ path: path.join(outputDir, 'channel-source-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('销售渠道名称', { exact: true }).fill('回归礼品甲店新名');
  await page.getByLabel('编号（可留空）', { exact: true }).fill('0101');
  await saveSource(page);
  assert.deepEqual(detailRows(api.document).find(row => row.source === '回归礼品乙店'), peerBefore, 'same-summary peer stays unchanged');
  assert.deepEqual(await page.evaluate(() => ({ n: T4_CHM.gift.n, bu: T4_CHM.gift.bu })), summaryBefore, 'editing a shop never renames its summary');
  assert.equal(await sourceButton(page, '回归礼品甲店').count(), 0);
  assert.equal(await sourceButton(page, '回归礼品甲店新名').count(), 1);
  assert.equal(await page.evaluate(() => t4ResolveChannel('回归礼品甲店')), 'gift', 'old source files still resolve');
  assert.equal(detailRows(api.document).find(row => row.source === '回归礼品甲店新名').fields.find(field => field.name === '负责人').value, '甲');

  await page.getByRole('button', { name: '新增销售渠道', exact: true }).click();
  await page.getByLabel('销售渠道名称', { exact: true }).fill('回归礼品丙店');
  await page.getByLabel('归集渠道', { exact: true }).selectOption('gift');
  await page.getByLabel('编号（可留空）', { exact: true }).fill('0103');
  await saveSource(page);
  assert.equal(await sourceButton(page, '回归礼品丙店').count(), 1);
  await page.getByRole('button', { name: '归集渠道', exact: true }).click();
  await page.locator('[data-t4chedit="gift"]').click();
  await page.getByLabel('新增销售渠道别名', { exact: true }).fill('回归别名门店');
  await page.getByRole('button', { name: '保存渠道', exact: true }).click();
  await page.waitForFunction(() => CURS === 't4-channels' && !T4_SERVER_SAVING);
  await page.getByRole('button', { name: '销售渠道', exact: true }).click();
  assert.equal(await sourceButton(page, '回归别名门店').count(), 1);
  await reloadChannels(colleague);
  assert.deepEqual(await sourceRows(colleague), await sourceRows(page), 'all completed edits survive another client reload');
  assert.equal(detailRows(api.document).length, 5);
  assert.deepEqual(api.document.periods, financial, 'roster edits preserve historical financial records');

  api.reject = true;
  const saved = structuredClone(api.document.channels);
  await sourceButton(page, '回归礼品丙店').click();
  await page.getByLabel('销售渠道名称', { exact: true }).fill('回归保存失败草稿');
  await page.getByRole('button', { name: '保存销售渠道', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /渠道保存测试失败/);
  assert.equal(await page.getByLabel('销售渠道名称', { exact: true }).inputValue(), '回归保存失败草稿');
  assert.deepEqual(api.document.channels, saved, 'failed write never changes shared roster');
  await reloadChannels(colleague);
  assert.equal(await sourceButton(colleague, '回归礼品丙店').count(), 1);
  assert.equal(await sourceButton(colleague, '回归保存失败草稿').count(), 0);
  api.reject = false;
  await saveSource(page);
  await sourceButton(page, '回归保存失败草稿').click();
  await page.getByLabel('归集渠道', { exact: true }).selectOption('jdpop');
  await saveSource(page);
  await reloadChannels(colleague);
  assert.equal(await sourceButton(colleague, '回归保存失败草稿').count(), 1);
  assert.equal(await colleague.evaluate(() => t4ResolveChannel('回归礼品丙店')), 'jdpop', 'moving a renamed shop moves its historical matching name');
  assert.deepEqual(detailRows(api.document).find(row => row.source === '回归礼品乙店'), peerBefore);
  assert.deepEqual(api.document.periods, financial);
});

test('real 77-row customer workbook uploads through the browser and survives a fresh colleague session', {
  skip: !chromium || !process.env.FINANCE_CHANNEL_ROSTER_XLSX,
}, async t => {
  const api = shared(), financial = structuredClone(api.document.periods);
  const page = await openClient(t, api);
  await importWorkbook(page, process.env.FINANCE_CHANNEL_ROSTER_XLSX);
  const details = detailRows(api.document);
  assert.equal(details.length, 77);
  // Independent ZIP/XML inspection of this supplied file found no 0054 row,
  // and its 快手 row has an empty number. Preserve those source values exactly.
  assert.deepEqual(details.map(row => row.fields.find(field => field.name === '编号')?.value).sort(),
    ['', ...Array.from({ length: 77 }, (_, i) => String(i + 1).padStart(4, '0')).filter(number => number !== '0054')]);
  assert.equal(details.find(row => row.source === '快手')?.fields.find(field => field.name === '编号')?.value, '');
  for (const [source, channel] of [['京东-澳乐官方旗舰店', 'jdpop'], ['分销-澳乐自营（零售）', 'supply'], ['分销-澳乐自营（1688）', 'supply']]) {
    assert.equal(details.find(row => row.source === source)?.channel, channel);
    assert.equal(await sourceButton(page, source).count(), 1);
  }
  for (const row of details) assert.equal(await sourceButton(page, row.source).count(), 1, `${row.source} appears exactly once`);
  const expected = await sourceRows(page);
  await reloadChannels(page);
  assert.deepEqual(await sourceRows(page), expected);
  const colleague = await openClient(t, api);
  assert.deepEqual(await sourceRows(colleague), expected);
  assert.deepEqual(api.document.periods, financial);
  assert.equal(api.puts, 1, 'fresh views do not rewrite imported metadata');

  const original = details.find(row => row.channel === 'gift');
  const peers = structuredClone(details.filter(row => row.channel === 'gift' && row.source !== original.source));
  const editedName = `${original.source}（验收改名）`;
  await sourceButton(page, original.source).click();
  await page.getByLabel('销售渠道名称', { exact: true }).fill(editedName);
  await page.getByLabel('编号（可留空）', { exact: true }).fill('CHECK-01');
  await saveSource(page);
  assert.deepEqual(detailRows(api.document).filter(row => row.channel === 'gift' && row.source !== editedName), peers);
  assert.equal(await sourceButton(page, original.source).count(), 0);
  assert.equal(await sourceButton(page, editedName).count(), 1);

  await page.getByRole('button', { name: '新增销售渠道', exact: true }).click();
  await page.getByLabel('销售渠道名称', { exact: true }).fill('原表验收新增门店');
  await page.getByLabel('归集渠道', { exact: true }).selectOption('gift');
  await saveSource(page);
  await page.getByRole('button', { name: '归集渠道', exact: true }).click();
  await page.locator('[data-t4chedit="gift"]').click();
  await page.getByLabel('新增销售渠道别名', { exact: true }).fill('原表验收别名门店');
  await page.getByRole('button', { name: '保存渠道', exact: true }).click();
  await page.waitForFunction(() => CURS === 't4-channels' && !T4_SERVER_SAVING);
  assert.equal(await sourceButton(page, '原表验收别名门店').count(), 1);
  await reloadChannels(colleague);
  assert.deepEqual(await sourceRows(colleague), await sourceRows(page));
  assert.equal(await sourceButton(colleague, editedName).count(), 1);
  assert.equal(await sourceButton(colleague, '原表验收新增门店').count(), 1);
  assert.equal(detailRows(api.document).length, 79);
  assert.deepEqual(api.document.periods, financial);
});

test('production metadata opens on all 79 registered sales rows without duplicate fallback shops on desktop and mobile', {
  skip: !chromium || !process.env.FINANCE_CHANNEL_METADATA,
}, async t => {
  const metadata = JSON.parse(await fs.readFile(process.env.FINANCE_CHANNEL_METADATA, 'utf8'));
  const api = shared(metadata.channels), original = structuredClone(api.document);
  assert.equal(detailRows(api.document).length, 79, 'fixture is the observed production roster');
  const page = await openClient(t, api);
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    await page.setViewportSize(viewport);
    const rows = await sourceRows(page);
    assert.equal(rows.length, 79);
    const normalized = rows.map(row => row.source.toLowerCase().replace(/[\s\-_—（）()]/g, ''));
    assert.equal(new Set(normalized).size, rows.length);
    assert.equal(rows.filter(row => /未登记|未导入/.test(row.status)).length, 0);
    assert.match(await page.locator('#view').innerText(), /已登记 79 条/);
    assert.equal(await page.getByRole('button', { name: '销售渠道', exact: true }).getAttribute('aria-pressed'), 'true');
    if (outputDir) await page.screenshot({ path: path.join(outputDir, `channel-roster-${name}.png`), fullPage: false });
  }
  await page.getByRole('button', { name: '归集渠道', exact: true }).click();
  assert.equal(await page.locator('[data-t4chedit]').count(), 27);
  await reloadChannels(page);
  assert.equal((await sourceRows(page)).length, 79, 'reopening returns to the sales roster');
  assert.deepEqual(api.document, original);
  assert.equal(api.puts, 0, 'read-only production fixture validation sends no writes');
});

test('alternate roster headers and added parameter cards stay consistent across desktop and mobile clients', { skip: !chromium }, async t => {
  const api = shared(), financial = structuredClone(api.document.periods);
  const desktop = await openClient(t, api);
  const mobile = await openClient(t, api, { width: 390, height: 844 });
  await importWorkbook(desktop, await workbook(desktop, [
    ['销售渠道', '渠道汇总', '归属事业部', '编号', '预算'],
    ['参数验收甲店', '分销-澳乐礼品单', '经销', '0001', 0],
    ['参数验收乙店', '分销-澳乐礼品单', '经销', '0002', 20],
    ['参数验收新店', '参数验收新归集', '橘农', '0003', 30],
  ]));
  const channel = await desktop.evaluate(() => t4ResolveChannel('参数验收新店'));
  await importWorkbook(desktop, await workbook(desktop, [['渠道名称', '编号'], ['参数验收甲店', '0101']]));
  assert.equal(await desktop.evaluate(() => T4_CHM.gift.n), '分销-澳乐礼品单', 'a supported source heading must not rename the whole group');
  await mobile.getByRole('button', { name: '更新共享数据', exact: true }).click();
  await mobile.waitForFunction(version => T4_SERVER_VERSION === version && !T4_SERVER_REFRESHING, api.version, { timeout: 22000 });
  await sourceButton(mobile, '参数验收新店').waitFor();
  assert.deepEqual(await sourceRows(mobile), await sourceRows(desktop));
  for (const [name, page] of [['desktop', desktop], ['mobile', mobile]]) {
    await page.getByRole('button', { name: '预算', exact: true }).click();
    assert.match(await page.locator('#view tbody').innerText(), /参数验收新店/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (outputDir) await page.screenshot({ path: path.join(outputDir, `channel-fields-${name}.png`), fullPage: false });
    await page.evaluate(() => go('t4-cfg'));
    assert.equal(await page.locator(`[data-view-key="t4-cfg:${channel}"]`).count(), 1, 'the new aggregate has a parameter card');
  }
  const card = page => page.locator(`[data-view-key="t4-cfg:${channel}"]`);
  const field = page => page.locator(`[data-t4cfg="${channel}:shippingInsuranceRate"]`);
  const updateMobile = async () => {
    await mobile.getByRole('button', { name: '更新共享数据', exact: true }).click();
    // Window focus can already have fetched this version; wait for the actual
    // shared fixture version rather than requiring one more change afterward.
    await mobile.waitForFunction(version => T4_SERVER_VERSION === version && !T4_SERVER_REFRESHING, api.version, { timeout: 22000 });
  };
  await card(desktop).locator('.t4addsel').selectOption('shippingInsuranceRate');
  await card(desktop).getByRole('button', { name: '添加', exact: true }).click();
  await field(desktop).waitFor();
  await updateMobile();
  assert.equal(await field(mobile).inputValue(), '0', 'the added zero rule is loaded on the second client');
  await field(desktop).fill('1.25');
  await card(desktop).getByRole('button', { name: '保存参数', exact: true }).click();
  await desktop.waitForFunction(ch => !T4_SERVER_SAVING && T4_SERVER_DOCUMENT.cfgByPeriod['2026-09'][ch].shippingInsuranceRate === 0.0125, channel);
  await updateMobile();
  assert.equal(await field(mobile).inputValue(), '1.25');
  for (const [name, page] of [['desktop', desktop], ['mobile', mobile]]) {
    await card(page).scrollIntoViewIfNeeded();
    if (outputDir) await card(page).screenshot({ path: path.join(outputDir, `parameters-shared-${name}.png`) });
  }
  await card(desktop).locator(`[data-t4cfgdel="${channel}:shippingInsuranceRate"]`).click();
  await field(desktop).waitFor({ state: 'detached' });
  await updateMobile();
  assert.equal(await field(mobile).count(), 0);
  await desktop.locator('[data-t4cfgdel="tmall:platformFeeRate"]').click();
  await desktop.locator('[data-t4cfg="tmall:platformFeeRate"]').waitFor({ state: 'detached' });
  await updateMobile();
  assert.equal(await mobile.locator('[data-t4cfg="tmall:platformFeeRate"]').count(), 0, 'a deleted built-in rule also stays absent');
  for (const page of [desktop, mobile]) {
    await reloadChannels(page);
    await page.evaluate(() => go('t4-cfg'));
    assert.equal(await field(page).count(), 0);
    assert.equal(await page.locator('[data-t4cfg="tmall:platformFeeRate"]').count(), 0);
    assert.equal(await card(page).locator('.t4addsel option[value="shippingInsuranceRate"]').count(), 1);
  }
  assert.deepEqual(api.document.periods, financial, 'catalog and parameter changes leave imported financial history intact');
});
