const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const vm = require('node:vm');

// 操作上报：身份只取门户会话，前端只说做了什么；前端分类只在成功时报一次。
const ROOT = path.join(__dirname, '..');
const secret = 'oplog-test-secret';
let root, base, child, logFile;
const cookie = (extra = {}) => {
  const body = Buffer.from(JSON.stringify({ portalUid: '1042', tenantId: 'T000001', name: '会话里的名字', exp: Date.now() + 60000, ...extra })).toString('base64url');
  return `t4_session=${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const post = (body, headers = {}) => fetch(`${base}/api/oplog`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie(), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const lines = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-oplog-'));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(root, 'server.js'));
  fs.cpSync(path.join(ROOT, 'server'), path.join(root, 'server'), { recursive: true });
  logFile = path.join(root, 'oplog', 'oplog.jsonl');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js'), String(port)],
    { env: { ...process.env, T4_SESSION_SECRET: secret, FINANCE_OPLOG_FILE: logFile }, stdio: 'ignore' });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited early (${child.exitCode})`);
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('test server did not start within 30s');
});
after(() => { child?.kill(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

test('oplog writes one line per action with the portal session identity, not the posted name', async () => {
  const r = await post({ action: '保存 · T1 资金日报', name: '冒名', portalUid: '1' });
  assert.equal(r.status, 204);
  const [line] = lines();
  assert.deepEqual(Object.keys(line).sort(), ['action', 'at', 'name', 'portalUid', 'tenantId']);
  assert.equal(line.portalUid, '1042');
  assert.equal(line.tenantId, 'T000001');
  assert.equal(line.name, '会话里的名字');
  assert.equal(line.action, '保存 · T1 资金日报');
  assert.ok(Math.abs(Date.parse(line.at) - Date.now()) < 60000);
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
});

test('oplog rejects anonymous, expired, non-JSON and empty posts without writing', async () => {
  const before = lines().length;
  assert.equal((await fetch(`${base}/api/oplog`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"保存"}' })).status, 401);
  assert.equal((await post({ action: '保存' }, { Cookie: cookie({ exp: 1 }) })).status, 401);
  assert.equal((await post('action=保存', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post({ action: '   ' })).status, 400);
  assert.equal((await post({ action: 42 })).status, 400);
  assert.equal((await post('{bad')).status, 400);
  assert.equal(lines().length, before);
});

test('oplog keeps actions short and on one line', async () => {
  assert.equal((await post({ action: '导入\n伪造一行\r' + 'x'.repeat(200) })).status, 204);
  const last = lines().pop();
  assert.equal(last.action.length, 80);
  assert.doesNotMatch(last.action, /[\r\n]/);
});

function loadApp(fetchImpl) {
  const c = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {} }, textContent: '' }) },
    window: { addEventListener() {}, removeEventListener() {}, scrollTo() {} },
    S: {}, go() {}, confirm() { return false; }, navigator: {}, fetch: fetchImpl,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), c);
  vm.runInContext("CURS = 't1'", c);
  return c;
}

test('front end reports completed saves, imports, reports and deletes, never failures or prompts', () => {
  const c = loadApp(() => Promise.resolve({}));
  const kind = m => vm.runInContext(`oplogKind(${JSON.stringify(m)})`, c);
  assert.equal(kind('已保存 3 个账户余额'), '保存');
  assert.equal(kind('✓ 参数已保存，损益表已按新规则重算'), '保存');
  assert.equal(kind('已新增 1002 银行存款'), '保存');
  assert.equal(kind('导入完成：新增 3 张、按单据编号覆盖 1 张'), '导入');
  assert.equal(kind('导入数据与记录已保存'), '导入');
  assert.equal(kind('套表已生成：全部 · 10 月 · 12 个渠道'), '生成报表');
  assert.equal(kind('已删除'), '删除');
  for (const m of ['保存失败', '规则保存失败：浏览器存储空间不足', '请填写：SMTP 服务器', '正在生成套表工作簿…', '已导出',
    '已导出 3 人。扣缴端 → 导入 → 选这个文件', '已更新到最新共享数据', '金额为零，本期无需生成凭证', '', null]) {
    assert.equal(kind(m), null, String(m));
  }
  assert.equal(vm.runInContext("oplogFileKind('T4日损益套表_全部_2026-10.xlsx')", c), '生成报表');
  assert.equal(vm.runInContext("oplogFileKind('凭证_2026-10.csv')", c), '导出');
  assert.equal(vm.runInContext("oplogFileKind('吉客云销售单明细账模版.xlsx')", c), null);
});

test('one click is reported once and a failed report never reaches the business flow', async () => {
  const sent = [];
  const c = loadApp((url, opts) => { sent.push({ url, ...opts, body: JSON.parse(opts.body) }); return Promise.reject(new Error('offline')); });
  vm.runInContext("toast('已保存 3 个账户余额')", c);
  vm.runInContext("toast('已保存 3 个账户余额')", c);   // 同一次保存的重复提示
  vm.runInContext("toast('保存失败')", c);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/oplog');
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].keepalive, true);
  assert.deepEqual(sent[0].body, { action: '保存 · T1 资金日报' });
  assert.equal(Object.keys(sent[0].body).length, 1, 'no identity is sent from the browser');
  vm.runInContext("CURS = 't4'; window.financeOplog('T4 同步', true); toast('已保存 2 个变更')", c);
  assert.deepEqual(sent.slice(1).map(s => s.body.action), ['T4 同步 · T4 日损益']);
  const broken = loadApp(() => { throw new Error('no fetch'); });
  assert.doesNotThrow(() => vm.runInContext("toast('已保存')", broken));
  await new Promise(r => setTimeout(r, 10));   // 被拒绝的上报不能变成未处理的 rejection
});
