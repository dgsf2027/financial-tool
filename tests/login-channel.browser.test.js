const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}

test('two portal-authenticated browsers share an imported channel through the real database', { skip: !chromium }, async t => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-login-import-'));
  const processes = [];
  let portal, browser;
  t.after(async () => {
    if (browser) await browser.close();
    for (const child of processes.reverse()) {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit'); child.kill(); await ended;
      }
    }
    if (portal) await new Promise(resolve => portal.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const proxySecret = 'local-integration-proxy';
  const sync = spawn('python3', ['-u', '-c',
    "import sync_api; s=sync_api.ThreadingHTTPServer(('127.0.0.1',0),sync_api.Handler); print(s.server_port,flush=True); s.serve_forever()"], {
    cwd: root, env: { ...process.env, T4_DB: path.join(dir, 'workspace.sqlite3'), T4_AUTH_MODE: 'proxy', T4_PROXY_SECRET: proxySecret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(sync);
  const syncPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync startup timed out')), 10000);
    sync.once('error', e => { clearTimeout(timer); reject(e); });
    sync.once('exit', code => { clearTimeout(timer); reject(new Error('sync exited: ' + code)); });
    sync.stdout.once('data', data => { clearTimeout(timer); resolve(Number(String(data).trim())); });
  });
  portal = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || '{}');
    const uid = ['colleague-a', 'colleague-b'].includes(input.authCode) ? input.authCode : null;
    const allowed = req.url === '/api/v1/sso/verify' && input.appId === 'finance' && uid;
    res.writeHead(allowed ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allowed ? { code: 200, data: { portalUid: uid, tenantId: 'test-tenant', name: uid } } : { code: 401 }));
  });
  await new Promise(resolve => portal.listen(0, '127.0.0.1', resolve));
  // server.js logs the requested port, so discover its ephemeral listening port
  // via a test-only launcher instead of assuming a free fixed port.
  const node = spawn(process.execPath, ['-e',
    "const http=require('http'); const original=http.Server.prototype.listen; http.Server.prototype.listen=function(...args){this.once('listening',()=>console.log('PORT='+this.address().port));return original.apply(this,args)};process.argv[2]='0';require('./server.js');"], {
    cwd: root, env: { ...process.env, NODE_ENV: 'test', T4_SESSION_SECRET: 'local-integration-session', T4_PROXY_SECRET: proxySecret,
      T4_SYNC_HOST: '127.0.0.1', T4_SYNC_PORT: String(syncPort), T4_PORTAL_SSO_BASE: `http://127.0.0.1:${portal.address().port}/api` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(node);
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('app startup timed out')), 10000);
    node.once('error', e => { clearTimeout(timer); reject(e); });
    node.once('exit', code => { clearTimeout(timer); reject(new Error('app exited: ' + code)); });
    node.stdout.on('data', data => { output += data; const match = output.match(/PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base + '/api/t4/workspace')).status, 401);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = [];
  for (const [i, context] of contexts.entries()) {
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    const page = await context.newPage();
    await page.goto(`${base}/sso/callback?auth_code=colleague-${i === 0 ? 'a' : 'b'}&app_id=finance`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('uNm').textContent.startsWith('colleague-'));
    pages.push(page);
  }
  const [first, second] = pages;
  await first.evaluate(() => go('t4-channels'));
  await first.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  const workbook = await first.evaluate(async () => Array.from(new Uint8Array(await XLSXWrite.build([
    { name: '渠道', rows: [['销售渠道', '渠道汇总', '归属事业部', '负责人'], ['跨同事测试店', '跨同事测试渠道', '大电商', '测试负责人']] },
  ]).arrayBuffer())));
  const chooser = first.waitForEvent('filechooser');
  await first.getByRole('button', { name: '导入渠道列表', exact: true }).click();
  await (await chooser).setFiles({ name: '渠道.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) });
  await first.waitForFunction(() => document.getElementById('toast').textContent.includes('已识别 1 张渠道表'));
  await second.evaluate(() => go('t4-channels'));
  await second.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  assert.match(await second.locator('#view tbody').innerText(), /跨同事测试渠道/);
  await second.reload({ waitUntil: 'domcontentloaded' });
  await second.evaluate(() => go('t4-channels'));
  await second.waitForFunction(() => T4_SERVER_READY && !T4_SERVER_LOADING);
  await second.getByRole('button', { name: '负责人', exact: true }).click();
  assert.match(await second.locator('#view tbody').innerText(), /测试负责人/);
  assert.equal(fs.existsSync(path.join(dir, 'workspace.sqlite3')), true);
});
