const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const PERIOD = '2099-12';
const DAY = '2099-12-01';
const copy = value => JSON.parse(JSON.stringify(value));

async function service(t, initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't4-client-test-'));
  const proc = spawn('python3', ['-u', '-c',
    "import sync_api; server=sync_api.ThreadingHTTPServer(('127.0.0.1',0),sync_api.Handler); print(server.server_port,flush=True); server.serve_forever()"], {
    cwd: ROOT, env: { ...process.env, T4_DB: path.join(dir, 'workspace.sqlite3'), T4_AUTH_MODE: 'allow' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, 'exit');
      proc.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sync API did not start: ${stderr}`)), 5000);
    proc.once('error', error => { clearTimeout(timer); reject(error); });
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`sync API exited (${code}): ${stderr}`)); });
    proc.stdout.once('data', chunk => { clearTimeout(timer); resolve(Number(String(chunk).trim())); });
  });
  const url = `http://127.0.0.1:${port}/api/t4/workspace`;
  async function request(method = 'GET', body) {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-T4-User': 'fixture' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  if (initial) await request('PUT', { baseVersion: 0, document: initial });
  return { url, request };
}

function client(server, withApp = false) {
  const requests = [];
  const storage = new Map();
  let nextSaveGate = null;
  function pauseNextSaveResponse() {
    let reached, release;
    const arrived = new Promise(resolve => { reached = resolve; });
    const resumed = new Promise(resolve => { release = resolve; });
    nextSaveGate = { reached, resumed };
    return { arrived, release };
  }
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl,
    fetch: async (url, options = {}) => {
      requests.push({ method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
      const gate = options.method === 'PUT' ? nextSaveGate : null;
      if (gate) nextSaveGate = null;
      const response = await fetch(new URL(url, server.url), options);
      if (gate) { gate.reached(); await gate.resumed; }
      return response;
    },
    window: {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4-sync.js'), 'utf8'), context);
  if (withApp) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 't4.js'), 'utf8'), context);
    vm.runInContext(`T4.period='${PERIOD}'`, context);
  }
  return { shared: context.window.T4Shared, requests, pauseNextSaveResponse, run: code => vm.runInContext(code, context) };
}

function workspace(row = { retailIncome: 20, retailCost: 10 }) {
  return { periods: { [PERIOD]: { tmall: { [DAY]: row } } }, cfg: {}, channels: [] };
}

test('two clients save different fields and receive the complete merged workspace', async t => {
  const server = await service(t, workspace());
  const a = client(server), b = client(server);
  await Promise.all([a.shared.load(), b.shared.load()]);
  const adoc = copy(a.shared.state.document), bdoc = copy(b.shared.state.document);
  adoc.periods[PERIOD].tmall[DAY].retailIncome = 100;
  bdoc.periods[PERIOD].tmall[DAY].retailCost = 200;
  await a.shared.save(adoc, 'A');
  const saved = await b.shared.save(bdoc, 'B');
  assert.deepEqual(copy(saved.document.periods[PERIOD].tmall[DAY]), { retailIncome: 100, retailCost: 200 });
  assert.deepEqual(copy(b.shared.state.document), saved.document);
  assert.deepEqual((await server.request()).document, saved.document);
  for (const request of [...a.requests, ...b.requests].filter(r => r.method === 'PUT')) {
    assert.equal(Object.hasOwn(request.body, 'document'), false, 'shared saves must not replace a complete workspace');
    assert.ok(Array.isArray(request.body.changes));
  }
});

test('real app defaults do not make edits to separate channels conflict', async t => {
  const server = await service(t);
  const a = client(server, true), b = client(server, true);
  await Promise.all([a.run('t4LoadServer()'), b.run('t4LoadServer()')]);
  assert.equal(a.run('T4_SERVER_READY'), true);
  assert.equal(b.run('T4_SERVER_READY'), true);
  await a.run('T4.cfg.tmall.directLaborMonth=100; t4SaveCfg()');
  await b.run('T4.cfg.jdpop.directLaborMonth=200; t4SaveCfg()');
  const document = (await server.request()).document;
  assert.equal(document.cfgByPeriod[PERIOD].tmall.directLaborMonth, 100);
  assert.equal(document.cfgByPeriod[PERIOD].jdpop.directLaborMonth, 200);
  assert.equal(b.run('T4.cfg.tmall.directLaborMonth'), 100);
  assert.equal(b.run('T4.cfg.jdpop.directLaborMonth'), 200);
  assert.equal(b.run(`T4_SERVER_DOCUMENT.cfgByPeriod['${PERIOD}'].tmall.directLaborMonth`), 100);
});

test('a real app field conflict retains the entered value and cannot be overwritten by repeated save', async t => {
  const server = await service(t);
  const a = client(server, true), b = client(server, true);
  await Promise.all([a.run('t4LoadServer()'), b.run('t4LoadServer()')]);
  const originalState = copy(b.shared.state);
  const originalViewBaseline = b.run('JSON.stringify(T4_SERVER_BASELINE)');
  await a.run('T4.cfg.tmall.directLaborMonth=100; t4SaveCfg()');
  b.run('T4.cfg.tmall.directLaborMonth=200');
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(b.run('t4SaveCfg()'), error => {
      assert.equal(error.code, 'field_conflict');
      assert.match(error.message, /tmall|天猫/);
      assert.match(error.message, /directLaborMonth|直接人工/);
      assert.match(error.message, /保留/);
      return true;
    });
    assert.equal(b.run('T4.cfg.tmall.directLaborMonth'), 200);
    assert.equal(b.run('T4_SERVER_SAVING'), false);
    assert.equal(b.run('JSON.stringify(T4_SERVER_BASELINE)'), originalViewBaseline);
    assert.deepEqual(copy(b.shared.state), originalState);
    assert.equal((await server.request()).document.cfgByPeriod[PERIOD].tmall.directLaborMonth, 100);
  }
});

test('an unrelated stale edit cannot restore another user’s deleted value', async t => {
  const server = await service(t, workspace());
  const a = client(server), b = client(server);
  await Promise.all([a.shared.load(), b.shared.load()]);
  const adoc = copy(a.shared.state.document), bdoc = copy(b.shared.state.document);
  delete adoc.periods[PERIOD].tmall[DAY].retailIncome;
  bdoc.periods[PERIOD].tmall[DAY].promotion = 12;
  await a.shared.save(adoc, 'A');
  await b.shared.save(bdoc, 'B');
  assert.deepEqual((await server.request()).document.periods[PERIOD].tmall[DAY], { retailCost: 10, promotion: 12 });
});

test('independent values inside an imported source merge without losing either edit', async t => {
  const server = await service(t, workspace({ _fileParts: { sales: { retailIncome: 20, retailCost: 10 } } }));
  const a = client(server), b = client(server);
  await Promise.all([a.shared.load(), b.shared.load()]);
  const adoc = copy(a.shared.state.document), bdoc = copy(b.shared.state.document);
  adoc.periods[PERIOD].tmall[DAY]._fileParts.sales.retailIncome = 100;
  bdoc.periods[PERIOD].tmall[DAY]._fileParts.sales.retailCost = 200;
  await a.shared.save(adoc, 'A');
  const saved = await b.shared.save(bdoc, 'B');
  assert.deepEqual(copy(saved.document.periods[PERIOD].tmall[DAY]._fileParts.sales), { retailIncome: 100, retailCost: 200 });
  assert.deepEqual((await server.request()).document, saved.document);
});

test('channel changes merge with data edits but competing channel lists conflict atomically', async t => {
  const server = await service(t, workspace());
  const a = client(server), b = client(server), c = client(server);
  await Promise.all([a.shared.load(), b.shared.load(), c.shared.load()]);
  const adoc = copy(a.shared.state.document), bdoc = copy(b.shared.state.document), cdoc = copy(c.shared.state.document);
  const channels = [{ id: 'custom_a', name: '自定义渠道 A', bu: '大电商' }];
  adoc.channels = channels;
  bdoc.periods[PERIOD].tmall[DAY].retailIncome = 55;
  cdoc.channels = [{ id: 'custom_c', name: '自定义渠道 C', bu: '大电商' }];
  await a.shared.save(adoc, 'A');
  const merged = await b.shared.save(bdoc, 'B');
  assert.deepEqual(copy(merged.document.channels), channels);
  assert.equal(merged.document.periods[PERIOD].tmall[DAY].retailIncome, 55);
  await assert.rejects(c.shared.save(cdoc, 'C'), error => error.code === 'field_conflict');
  assert.deepEqual((await server.request()).document.channels, channels);
});

test('a remote month lock still rejects stale saves and preserves the local draft', async t => {
  const server = await service(t, workspace());
  const a = client(server), b = client(server);
  await Promise.all([a.shared.load(), b.shared.load()]);
  const adoc = copy(a.shared.state.document), bdoc = copy(b.shared.state.document);
  adoc.periodLocks = { [PERIOD]: true };
  bdoc.periods[PERIOD].tmall[DAY].retailIncome = 100;
  const originalState = copy(b.shared.state);
  await a.shared.save(adoc, 'A');
  await assert.rejects(b.shared.save(bdoc, 'B'), error => error.code === 'period_locked');
  assert.equal(bdoc.periods[PERIOD].tmall[DAY].retailIncome, 100);
  assert.deepEqual(copy(b.shared.state), originalState);
  const saved = (await server.request()).document;
  assert.equal(saved.periodLocks[PERIOD], true);
  assert.equal(saved.periods[PERIOD].tmall[DAY].retailIncome, 20);
});

test('adding a new field cannot resurrect a row another client deleted', async t => {
  const server = await service(t, workspace());
  const a = client(server), b = client(server);
  await Promise.all([a.shared.load(), b.shared.load()]);
  const adoc = copy(a.shared.state.document), bdoc = copy(b.shared.state.document);
  delete adoc.periods[PERIOD].tmall[DAY];
  bdoc.periods[PERIOD].tmall[DAY].promotion = 12;
  const originalState = copy(b.shared.state);
  await a.shared.save(adoc, 'A');
  await assert.rejects(b.shared.save(bdoc, 'B'), error => error.code === 'field_conflict');
  assert.deepEqual(copy(b.shared.state), originalState);
  assert.equal(Object.hasOwn((await server.request()).document.periods[PERIOD].tmall, DAY), false);
});

test('lock and channel-only saves preserve unsaved data and configuration for a later save', async t => {
  const initial = workspace();
  initial.cfgByPeriod = { [PERIOD]: { tmall: { directLaborMonth: 10 } } };
  const server = await service(t, initial);
  const a = client(server, true);
  await a.run('t4LoadServer()');
  a.run(`T4.data.tmall['${DAY}'].retailIncome=100; T4.cfg.tmall.directLaborMonth=200`);
  await a.run('t4SetPeriodLock(false)');
  let saved = (await server.request()).document;
  assert.equal(saved.periodLocks[PERIOD], false);
  assert.equal(saved.periods[PERIOD].tmall[DAY].retailIncome, 20);
  assert.equal(saved.cfgByPeriod[PERIOD].tmall.directLaborMonth, 10);
  assert.equal(a.run(`T4.data.tmall['${DAY}'].retailIncome`), 100);
  assert.equal(a.run('T4.cfg.tmall.directLaborMonth'), 200);
  assert.equal(a.run(`T4_SERVER_BASELINE.periods['${PERIOD}'].tmall['${DAY}'].retailIncome`), 20);
  assert.equal(a.run(`T4_SERVER_BASELINE.cfgByPeriod['${PERIOD}'].tmall.directLaborMonth`), 10);

  await a.run("t4SaveChOverrides([{id:'tmall',n:'天猫测试渠道',bu:'ecom'}]); t4RebuildChannels(); t4SaveServer(true)");
  saved = (await server.request()).document;
  assert.deepEqual(saved.channels, [{ id: 'tmall', n: '天猫测试渠道', bu: 'ecom' }]);
  assert.equal(saved.periods[PERIOD].tmall[DAY].retailIncome, 20);
  assert.equal(saved.cfgByPeriod[PERIOD].tmall.directLaborMonth, 10);
  assert.equal(a.run(`T4.data.tmall['${DAY}'].retailIncome`), 100);
  assert.equal(a.run('T4.cfg.tmall.directLaborMonth'), 200);

  await a.run('t4Save()');
  saved = (await server.request()).document;
  assert.equal(saved.periods[PERIOD].tmall[DAY].retailIncome, 100);
  assert.equal(saved.cfgByPeriod[PERIOD].tmall.directLaborMonth, 200);
  assert.deepEqual(saved.channels, [{ id: 'tmall', n: '天猫测试渠道', bu: 'ecom' }]);
});

test('edits made while a save response is pending remain drafts against only acknowledged values', { timeout: 5000 }, async t => {
  const initial = workspace();
  initial.cfgByPeriod = { [PERIOD]: { tmall: { directLaborMonth: 10 } } };
  const server = await service(t, initial);
  const a = client(server, true), b = client(server);
  await Promise.all([a.run('t4LoadServer()'), b.shared.load()]);
  const bdoc = copy(b.shared.state.document);
  bdoc.periods[PERIOD].tmall[DAY].retailCost = 40;
  await b.shared.save(bdoc, 'B');
  a.run(`T4.data.tmall['${DAY}'].retailIncome=100; T4.cfg.tmall.directLaborMonth=200`);
  const gate = a.pauseNextSaveResponse();
  t.after(gate.release);
  const saving = a.run('t4Save()');
  await gate.arrived;
  assert.equal(a.run('T4_SERVER_SAVING'), true);
  a.run(`T4.data.tmall['${DAY}'].retailIncome=150; T4.data.tmall['${DAY}'].promotion=12; T4.cfg.tmall.directLaborMonth=250`);
  gate.release();
  await saving;

  const acknowledged = (await server.request()).document;
  assert.deepEqual(acknowledged.periods[PERIOD].tmall[DAY], { retailIncome: 100, retailCost: 40 });
  assert.equal(acknowledged.cfgByPeriod[PERIOD].tmall.directLaborMonth, 200);
  assert.deepEqual(copy(a.shared.state.document), acknowledged);
  assert.deepEqual(JSON.parse(a.run(`JSON.stringify(T4_SERVER_BASELINE.periods['${PERIOD}'].tmall['${DAY}'])`)), { retailIncome: 100, retailCost: 40 });
  assert.equal(a.run(`T4_SERVER_BASELINE.cfgByPeriod['${PERIOD}'].tmall.directLaborMonth`), 200);
  assert.deepEqual(JSON.parse(a.run(`JSON.stringify(T4.data.tmall['${DAY}'])`)), { retailIncome: 150, retailCost: 40, promotion: 12 });
  assert.equal(a.run('T4.cfg.tmall.directLaborMonth'), 250);

  await a.run('t4Save()');
  const saved = (await server.request()).document;
  assert.deepEqual(saved.periods[PERIOD].tmall[DAY], { retailIncome: 150, retailCost: 40, promotion: 12 });
  assert.equal(saved.cfgByPeriod[PERIOD].tmall.directLaborMonth, 250);
});

test('flexible channel uploads persist new field pages for another client without changing financial data', async t => {
  const initial = workspace();
  const server = await service(t, initial);
  const a = client(server, true);
  await a.run('t4LoadServer()');
  a.run("t4ChApplyRows([['销售渠道','归属事业部','负责人'],['同步新增店','大电商','张三']])");
  await a.run('t4SaveServer(true)');
  const saved = (await server.request()).document;
  assert.deepEqual(saved.periods, initial.periods);
  assert.deepEqual(saved.cfg, initial.cfg);
  const b = client(server, true);
  await b.run('t4LoadServer()');
  assert.equal(b.run("T4_CHM[t4ResolveChannel('同步新增店')].bu"), 'ecom');
  assert.deepEqual(copy(b.run("t4ChFieldRows('负责人').map(r=>[r.source,r.value])")), [['同步新增店', '张三']]);
});

test('combined day import commits both partitions and an audit record in one CAS and survives reload', async t => {
  const initial = workspace({ _fileParts: { summaryIncome: { retailIncome: 80 }, summaryCost: { retailCost: 40 } } });
  initial.periods[PERIOD].tmall['2099-12-02'] = { _fileParts: { summaryIncome: { retailIncome: 90 }, summaryCost: { retailCost: 50 } } };
  const server = await service(t, initial), a = client(server, true);
  await a.run('t4LoadServer()');
  a.run(`T4.sumScope='both';T4.imp={mode:'summary',fileK:'summaryDaily',fileName:'combined.xlsx',headRow:0,
    map:{channel:0,date:1,retailIncome:2,retailCost:3},rows:[[],['天猫-澳乐旗舰店','${DAY}',110,55]]}`);
  await a.run('t4SummaryImpRun()');
  const writes = a.requests.filter(x => x.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].body.changes.some(x => x.path[0] === 'importHistory'));
  assert.ok(writes[0].body.changes.some(x => x.path.includes('summaryIncome')));
  assert.ok(writes[0].body.changes.some(x => x.path.includes('summaryCost')));
  const saved = (await server.request()).document;
  assert.equal(saved.periods[PERIOD].tmall['2099-12-02']._fileParts.summaryIncome.retailIncome, 90);
  assert.equal(saved.periods[PERIOD].tmall[DAY]._fileParts.summaryCost.retailCost, 55);
  assert.equal(Object.values(saved.importHistory)[0].fileName, 'combined.xlsx');
  const b = client(server, true); await b.run('t4LoadServer()');
  assert.equal(b.run('Object.values(T4.importHistory)[0].used'), 1);
  assert.equal(b.run(`t4InputValue(T4.data.tmall['${DAY}'],'retailIncome')`), 110);
});

test('conflicting combined import persists neither its new cost nor success record', async t => {
  const initial = workspace({ _fileParts: { summaryIncome: { retailIncome: 80 }, summaryCost: { retailCost: 40 } } });
  const server = await service(t, initial), a = client(server, true), b = client(server, true);
  await Promise.all([a.run('t4LoadServer()'), b.run('t4LoadServer()')]);
  const make = income => `T4.sumScope='both';T4.imp={mode:'summary',fileK:'summaryDaily',fileName:'combined.xlsx',headRow:0,
    map:{channel:0,date:1,retailIncome:2,retailCost:3},rows:[[],['天猫-澳乐旗舰店','${DAY}',${income},55]]};t4SummaryImpRun()`;
  await a.run(make(110)); await b.run(make(120));
  const saved = (await server.request()).document;
  assert.equal(Object.keys(saved.importHistory).length, 1);
  assert.equal(saved.periods[PERIOD].tmall[DAY]._fileParts.summaryIncome.retailIncome, 110);
  assert.equal(b.run('Object.keys(T4.importHistory).length'), 0);
  assert.equal(b.run(`t4InputValue(T4.data.tmall['${DAY}'],'retailCost')`), 40);
  assert.match(b.run('T4.importFeedback.message'), /未同步/);
});
