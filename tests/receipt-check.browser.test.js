'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, baseURL;
before(async () => {
  if (!chromium) return;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  server = http.createServer(async (req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname;
    if (!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(file)) return res.writeHead(404).end();
    try {
      const data = await fs.readFile(path.join(__dirname, '..', file === '/' ? 'index.html' : file.slice(1)));
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(data);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
const options = { skip: !chromium, timeout: 60000 };
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const n of bytes) c = crcTable[(c ^ n) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], directory = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), raw = zlib.deflateRawSync(bytes), filename = Buffer.from(name), crc = crc32(bytes);
    const local = Buffer.alloc(30 + filename.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(2048, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26); filename.copy(local, 30);
    const central = Buffer.alloc(46 + filename.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(2048, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42); filename.copy(central, 46);
    parts.push(local, raw); directory.push(central); offset += local.length + raw.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length, 8); end.writeUInt16LE(directory.length, 10); end.writeUInt32LE(directory.reduce((n, b) => n + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}
function unzip(bytes) {
  const out = new Map(), end = bytes.length - 22, count = bytes.readUInt16LE(end + 10); let p = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const n = bytes.readUInt16LE(p + 28), extra = bytes.readUInt16LE(p + 30), comment = bytes.readUInt16LE(p + 32), name = bytes.subarray(p + 46, p + 46 + n).toString(), at = bytes.readUInt32LE(p + 42), size = bytes.readUInt32LE(p + 20), method = bytes.readUInt16LE(p + 10);
    const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28), raw = bytes.subarray(start, start + size);
    out.set(name, { raw, content: method === 8 ? zlib.inflateRawSync(raw) : raw }); p += 46 + n + extra + comment;
  }
  return out;
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(value)}</t></is></c>`;
async function fixture(page, rows) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', relns = 'http://schemas.openxmlformats.org/package/2006/relationships', rns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const names = [...new Set(rows.map(r => r.image))], images = new Map();
  for (const name of names) {
    const dataUrl = await page.evaluate(name => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 460;
      const c = canvas.getContext('2d'); c.fillStyle = '#f7f8fa'; c.fillRect(0, 0, 400, 460); c.fillStyle = '#15956a'; c.font = 'bold 26px sans-serif'; c.fillText('付款成功 · 测试凭证', 48, 70);
      c.fillStyle = '#15212e'; c.font = 'bold 40px sans-serif'; c.fillText('¥ 2.50', 124, 150); c.font = '18px sans-serif'; c.fillText('付款日期：2026-09-23', 42, 235); c.fillText('凭证编号：' + name, 42, 285); c.fillStyle = '#67717b'; c.font = '14px sans-serif'; c.fillText('仅用于自动化测试，非真实交易', 42, 390); return canvas.toDataURL('image/png');
    }, name);
    images.set(name, dataUrl);
  }
  const heads = ['日期', '类别', '支出项目', '支出金额', '备用金', '收入', '余额', '支付截图', '备注', '补', '订单号', '月份', '核对'];
  const worksheet = `<worksheet xmlns="${ns}" xmlns:r="${rns}"><sheetData><row r="1">${cell('A1', '测试费用')}</row><row r="2">${heads.map((h, i) => cell(String.fromCharCode(65 + i) + '2', h)).join('')}</row>${rows.map((r, i) => { const n = i + 3; return `<row r="${n}">${cell('C' + n, r.label)}<c r="D${n}"><v>${r.amount}</v></c><c r="H${n}" t="str"><f>_xlfn.DISPIMG("${r.image}",1)</f><v/></c>${r.month ? cell('L' + n, r.month) : ''}${r.status ? cell('M' + n, r.status) : ''}<c r="N${n}"><f>D${n}*2</f><v>${Number(r.amount) * 2}</v></c></row>`; }).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': `<Relationships xmlns="${relns}"><Relationship Id="wb" Type="${rns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${rns}"><sheets><sheet name="测试" sheetId="1" r:id="sheet"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relns}"><Relationship Id="sheet" Type="${rns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="images" Type="http://www.wps.cn/officeDocument/2020/cellImage" Target="cellimages.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': worksheet,
    'xl/cellimages.xml': `<etc:cellImages xmlns:etc="urn:wps" xmlns:xdr="urn:drawing" xmlns:a="urn:a" xmlns:r="${rns}">${names.map(name => `<etc:cellImage><xdr:pic><xdr:cNvPr name="${name}"/><a:blip r:embed="${name}"/></xdr:pic></etc:cellImage>`).join('')}</etc:cellImages>`,
    'xl/_rels/cellimages.xml.rels': `<Relationships xmlns="${relns}">${names.map(name => `<Relationship Id="${name}" Type="${rns}/image" Target="media/${name}.png"/>`).join('')}</Relationships>`,
    'customXml/preserve.xml': '<keep original="true"/>'
  };
  for (const [name, dataUrl] of images) files[`xl/media/${name}.png`] = Buffer.from(dataUrl.split(',')[1], 'base64');
  return { buffer: zip(files), images, files };
}
const recognized = (amount, patch = {}) => ({ result: { amount: String(amount), currency: 'CNY', payment_status: 'success', payment_date: '2026-09-23', multiple_transactions: false, needs_review: false, reason: '付款记录清晰', ...patch }, usage: { total_tokens: 123 }, callId: 'mock-call-id', model: 'mock-vision', cached: false });
async function setup(t, opts = {}) {
  const context = await browser.newContext({ viewport: { width: opts.width || 1440, height: 1000 }, acceptDownloads: true }); t.after(() => context.close());
  const page = await context.newPage(), errors = [], calls = [], callTimes = [], configCalls = []; page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname === '/api/session') return route.fulfill({ json: { authenticated: opts.auth !== false, name: '本地验收', loginUrl: '/sso/login' } });
    if (url.pathname === '/api/receipt-check/config') {
      configCalls.push(Date.now());
      return route.fulfill({ json: { configured: opts.configured !== false, model: 'mock-vision', maxConcurrency: 2, requestsPerMinute: 30, requestIntervalMs: 2200, ...(typeof opts.config === 'function' ? opts.config(configCalls.length) : opts.config || {}) } });
    }
    if (url.pathname === '/api/receipt-check/recognize') { calls.push(route.request().postDataJSON()); callTimes.push(Date.now()); return opts.recognize ? opts.recognize(route, calls.length) : route.fulfill({ status: 500, json: { error: 'Unexpected recognition request' } }); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { found: false, version: 0, document: {}, configured: false } });
    return route.continue();
  });
  await page.goto(baseURL + '/?tool=receipt-check', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.rc') && !document.querySelector('.rc').textContent.includes('模型 连接中'));
  return { page, calls, errors, callTimes, configCalls };
}
async function upload(page, input) { await page.locator('#rc-file').setInputFiles({ name: '费用测试.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: input.buffer }); await page.locator('#rc-sheet').waitFor(); }
const row = (page, label) => page.locator('.rc-results tbody tr').filter({ has: page.locator('.rc-label', { hasText: label }) });
async function finished(page) { await page.waitForFunction(() => !document.querySelector('[data-rc="pause"]')); }
async function download(page) { const got = page.waitForEvent('download'); await page.locator('[data-rc="export"]').click(); const result = await got; return { bytes: await fs.readFile(await result.path()), name: result.suggestedFilename() }; }
async function screenshot(page, name) { if (process.env.RECEIPT_SCREENSHOT_DIR) { await fs.mkdir(process.env.RECEIPT_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.RECEIPT_SCREENSHOT_DIR, name + '.png'), fullPage: !name.includes('dialog') }); } }

test('receipt UI evaluates evidence, preserves protected rows, exports original package, changes month and opens image dialog', options, async t => {
  let input;
  const { page, calls, errors } = await setup(t, { recognize: async route => {
    const payload = route.request().postDataJSON(); assert.deepEqual(Object.keys(payload), ['imageDataUrl']);
    const name = [...input.images].find(([, url]) => url === payload.imageDataUrl)?.[0];
    const replies = { pass: recognized('2.50'), diff: recognized('21'), pending: recognized('30', { payment_status: 'pending' }), conflict: recognized('70'), noDate: recognized('90', { payment_date: null, reason: '<img src=x onerror=alert(1)>' }) };
    assert.ok(replies[name], 'protected rows must not call AI: ' + name); return route.fulfill({ json: replies[name] });
  } });
  input = await fixture(page, [
    { label: '金额一致', amount: '2.5', image: 'pass' }, { label: '金额差异项目', amount: '20', image: 'diff' }, { label: '等待收款项目', amount: '30', image: 'pending' },
    { label: '重复凭证甲', amount: '40', image: 'duplicate' }, { label: '重复凭证乙', amount: '50', image: 'duplicate' },
    { label: '已经核对项目', amount: '60', image: 'reviewed', month: '2608', status: '已核对' }, { label: '月份冲突项目', amount: '70', image: 'conflict', month: '2608' },
    { label: '原有文字项目', amount: '80', image: 'existing', status: '待确认' }, { label: '无日期项目', amount: '90', image: 'noDate' }
  ]);
  await upload(page, input); assert.match(await row(page, '已经核对项目').innerText(), /原已核对/); assert.match(await row(page, '重复凭证甲').innerText(), /多行/);
  await page.locator('[data-rc="start"]').click(); await finished(page);
  assert.equal(calls.length, 5); assert.match(await row(page, '金额一致').innerText(), /一致 · 可回填[\s\S]*2609/); assert.match(await row(page, '金额差异项目').innerText(), /金额差异/);
  assert.match(await row(page, '等待收款项目').innerText(), /尚未完成收款/); assert.match(await row(page, '月份冲突项目').innerText(), /原有月份/); assert.match(await row(page, '无日期项目').innerText(), /完整付款日期/);
  assert.match(await page.locator('.rc-meta').first().innerText(), /成功调用 5 次.*615/);
  const output = await download(page); assert.equal(output.name, '费用测试_已核对.xlsx'); assert.ok(output.bytes.subarray(0, input.buffer.length).equals(input.buffer));
  const original = unzip(input.buffer), updated = unzip(output.bytes); const xml = updated.get('xl/worksheets/sheet1.xml').content.toString();
  const restored = xml.replace(cell('L3', '2609'), '').replace(cell('M3', '已核对'), ''); assert.equal(restored, original.get('xl/worksheets/sheet1.xml').content.toString(), 'only the two passing target cells changed');
  for (const [name, entry] of original) if (name !== 'xl/worksheets/sheet1.xml') assert.ok(entry.raw.equals(updated.get(name).raw), name + ' preserved');
  await row(page, '金额一致').locator('[data-rc-detail]').click(); await page.waitForFunction(() => { const i = document.querySelector('dialog img'); return i?.complete && i.naturalWidth === 400; });
  assert.match(await page.locator('dialog').innerText(), /mock-call-id/); await screenshot(page, 'receipt-dialog-1440'); await page.locator('dialog [data-close]').click(); await page.locator('dialog').waitFor({ state: 'detached' });
  await page.locator('#rc-month-mode').selectOption('fixed'); await page.locator('#rc-fixed-month').fill('2026-08'); await page.locator('#rc-fixed-month').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('[data-rc="export"]').textContent.includes('（3）'));
  assert.match(await row(page, '月份冲突项目').innerText(), /一致 · 可回填/); assert.match(await row(page, '无日期项目').innerText(), /一致 · 可回填/); assert.equal(calls.length, 5, 'month changes reuse evidence');
  const fixed = unzip((await download(page)).bytes).get('xl/worksheets/sheet1.xml').content.toString(); assert.ok(fixed.includes(cell('M9', '已核对'))); assert.ok(fixed.includes(cell('L11', '2608'))); assert.ok(fixed.includes(cell('M8', '已核对'))); assert.ok(fixed.includes(cell('M10', '待确认')));
  await screenshot(page, 'receipt-review-1440');
  await page.locator('#rc-filter').selectOption('review'); await page.waitForFunction(() => document.querySelectorAll('.rc-results tbody tr').length === 4); assert.equal(await page.locator('.rc-results tbody tr').count(), 4);
  await page.locator('#rc-filter').selectOption('all'); await page.waitForFunction(() => document.querySelectorAll('.rc-results tbody tr').length === 9); await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'receipt-review-390');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page must not overflow horizontally');
  const table = page.locator('.rc-results .tw'); assert.ok(await table.evaluate(el => el.scrollWidth > el.clientWidth), 'table uses local horizontal scrolling');
  await row(page, '金额一致').locator('[data-rc-detail]').click(); await page.waitForFunction(() => document.querySelector('dialog img')?.complete); await screenshot(page, 'receipt-dialog-390');
  assert.ok(await page.locator('dialog').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })); await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({ state: 'detached' }); assert.deepEqual(errors, []);
});

test('pause waits for active request; a rate limit leaves rows retryable and successful retry exports', options, async t => {
  let firstRoute, ready; const requested = new Promise(resolve => { ready = resolve; });
  const { page, calls, errors } = await setup(t, { recognize: (route, number) => {
    if (number === 1) { firstRoute = route; ready(); return; } return route.fulfill({ json: recognized('2.5') });
  } });
  const input = await fixture(page, ['one', 'two', 'three'].map(image => ({ image, amount: '2.5', label: image }))); await upload(page, input);
  await page.locator('[data-rc="start"]').click(); await requested; await page.locator('[data-rc="pause"]').click(); assert.match(await page.locator('.rc-progress').innerText(), /等待当前请求结束后暂停/);
  await firstRoute.fulfill({ status: 429, json: { error: { message: '测试频率限制，请稍后重试' } } }); await finished(page);
  assert.equal(calls.length, 1); assert.match(await row(page, 'one').innerText(), /识别失败[\s\S]*测试频率限制/); assert.ok(await page.locator('[data-rc="export"]').isDisabled());
  await page.locator('[data-rc="start"]').click(); await finished(page); assert.equal(calls.length, 4); assert.match(await page.locator('[data-rc="export"]').innerText(), /（3）/); assert.equal(await page.locator('.rc-results tbody tr').filter({ hasText: '一致 · 可回填' }).count(), 3); assert.deepEqual(errors, []);
});

test('latest config enables six actual concurrent requests with shared pacing; pause and retry retain prior evidence', options, async t => {
  const held = []; let sixEntered;
  const entered = new Promise(resolve => { sixEntered = resolve; });
  let latest = { model: 'old-model', maxConcurrency: 2, requestsPerMinute: 30, requestIntervalMs: 2200 };
  const { page, calls, callTimes, configCalls, errors } = await setup(t, { config: () => latest, recognize: (route, number) => {
    if (number <= 6) { held.push(route); if (number === 6) sixEntered(); return; }
    if (number === 7) return route.fulfill({ status: 500, json: { error: { message: '一次性测试故障' } } });
    return route.fulfill({ json: { ...recognized('2.5'), model: 'actual-flash' } });
  } });
  await upload(page, await fixture(page, Array.from({ length: 8 }, (_, i) => ({ image: 'batch' + i, amount: '2.5', label: 'batch' + i }))));
  await page.waitForFunction(() => document.querySelector('.rc-meta')?.textContent.includes('old-model'));
  latest = { model: 'fresh-flash', maxConcurrency: 6, requestsPerMinute: 120, requestIntervalMs: 550 };
  await page.locator('[data-rc="start"]').click();
  const deadline = setTimeout(() => sixEntered('timeout'), 8000); const outcome = await entered; clearTimeout(deadline);
  assert.notEqual(outcome, 'timeout', 'six requests must all arrive before any response is released'); assert.equal(held.length, 6); assert.equal(calls.length, 6);
  assert.equal(configCalls.length, 2, 'starting reloads the initial config');
  assert.match(await page.locator('.rc-meta').first().innerText(), /fresh-flash/); assert.match(await page.locator('.rc').innerText(), /同时处理 6 张/);
  for (let i = 1; i < callTimes.length; i++) assert.ok(callTimes[i] - callTimes[i - 1] >= 500, 'global request pacing between workers: ' + (callTimes[i] - callTimes[i - 1]) + 'ms');
  await page.locator('[data-rc="pause"]').click();
  await Promise.all(held.slice(0, 3).map(route => route.fulfill({ json: { ...recognized('2.5'), model: 'actual-flash' } })));
  await page.waitForFunction(() => document.querySelector('.rc')?.textContent.includes('预计还需'));
  assert.match(await page.locator('.rc').innerText(), /约 \d+ 张\/分钟/); assert.match(await page.locator('.rc-meta').first().innerText(), /actual-flash/);
  await Promise.all(held.slice(3).map(route => route.fulfill({ json: { ...recognized('2.5'), model: 'actual-flash' } })));
  await finished(page); assert.equal(calls.length, 6, 'paused queue must not start either remaining row');
  assert.equal(await page.locator('.rc-results tbody tr').filter({ hasText: '一致 · 可回填' }).count(), 6);
  latest = { model: 'second-config-flash', maxConcurrency: 4, requestsPerMinute: 120, requestIntervalMs: 550 };
  await page.locator('[data-rc="start"]').click(); await finished(page);
  assert.equal(configCalls.length, 3); assert.equal(calls.length, 8, 'resume starts only the two unprocessed rows');
  assert.equal(await page.locator('.rc-results tbody tr').filter({ hasText: '一致 · 可回填' }).count(), 7);
  assert.match(await row(page, 'batch6').innerText(), /一次性测试故障/);
  await page.locator('[data-rc="start"]').click(); await finished(page);
  assert.equal(configCalls.length, 4); assert.equal(calls.length, 9); assert.deepEqual(calls[8], calls[6], 'only the failed image is retried');
  assert.equal(await page.locator('.rc-results tbody tr').filter({ hasText: '一致 · 可回填' }).count(), 8); assert.match(await page.locator('[data-rc="export"]').innerText(), /（8）/);
  assert.match(await page.locator('.rc-meta').first().innerText(), /actual-flash.*成功调用 8 次/); assert.deepEqual(errors, []);
});

test('pausing six workers cancels every paced request that has not started and preserves the completed row', options, async t => {
  let firstRoute, firstEntered; const entered = new Promise(resolve => { firstEntered = resolve; });
  const { page, calls, errors } = await setup(t, { config: { maxConcurrency: 6, requestsPerMinute: 120, requestIntervalMs: 550 }, recognize: route => { firstRoute = route; firstEntered(); } });
  await upload(page, await fixture(page, Array.from({ length: 7 }, (_, i) => ({ image: 'pause' + i, amount: '2.5', label: 'pause' + i }))));
  await page.locator('[data-rc="start"]').click(); await entered; await page.locator('[data-rc="pause"]').click();
  await firstRoute.fulfill({ json: recognized('2.5') }); await finished(page);
  assert.equal(calls.length, 1, 'five scheduled worker delays must finish without sending requests');
  assert.equal(await page.locator('.rc-results tbody tr').filter({ hasText: '一致 · 可回填' }).count(), 1); assert.match(await page.locator('[data-rc="start"]').innerText(), /（6）/);
  assert.match(await page.locator('[data-rc="export"]').innerText(), /（1）/); assert.deepEqual(errors, []);
});

test('unconfigured or unauthenticated clients can inspect files but cannot start recognition', options, async t => {
  for (const flags of [{ configured: false }, { auth: false }]) {
    const { page, calls, errors } = await setup(t, flags); await upload(page, await fixture(page, [{ image: 'one', amount: '2.5', label: '未识别' }]));
    assert.ok(await page.locator('[data-rc="start"]').isDisabled()); assert.equal(calls.length, 0); assert.deepEqual(errors, []);
  }
});

test('optional real workbook imports in the UI locally without making any recognition call', { ...options, skip: !chromium || !process.env.RECEIPT_TEST_XLSX, timeout: 90000 }, async t => {
  const { page, calls, errors } = await setup(t); await page.locator('#rc-file').setInputFiles(process.env.RECEIPT_TEST_XLSX); await page.locator('#rc-sheet').waitFor({ timeout: 60000 });
  const sheets = await page.locator('#rc-sheet option').allTextContents(); assert.equal(sheets.length, 3); assert.ok(sheets.slice(1).every(s => /\d+ 条/.test(s))); assert.equal(calls.length, 0);
  assert.equal(await page.locator('.rc-results tbody tr').count(), 30); await page.locator('[data-rc="next"]').click(); assert.match(await page.locator('.rc-pagination').innerText(), /第 2/);
  await page.locator('#rc-sheet').selectOption({ index: 2 }); await page.waitForFunction(() => document.querySelector('.rc-pagination').textContent.includes('共 1227 条 · 第 1')); assert.match(await page.locator('.rc-pagination').innerText(), /第 1/); assert.equal(calls.length, 0); assert.deepEqual(errors, []); console.log('Real receipt workbook UI import:', sheets);
});
