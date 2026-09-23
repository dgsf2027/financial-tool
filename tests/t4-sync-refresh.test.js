const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.join(__dirname, '..');
const PERIOD = '2099-12', DAY = '2099-12-01';
const copy = value => JSON.parse(JSON.stringify(value));

async function service(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't4-refresh-test-'));
  const proc = spawn('python3', ['-u', '-c',
    "import sync_api; server=sync_api.ThreadingHTTPServer(('127.0.0.1',0),sync_api.Handler); print(server.server_port,flush=True); server.serve_forever()"], {
    cwd: ROOT, env: { ...process.env, T4_DB: path.join(dir, 'workspace.sqlite3'), T4_AUTH_MODE: 'allow' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, 'exit'); proc.kill('SIGTERM'); await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sync API did not start: ${stderr}`)), 10000);
    proc.once('error', error => { clearTimeout(timer); reject(error); });
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`sync API exited (${code}): ${stderr}`)); });
    proc.stdout.once('data', chunk => { clearTimeout(timer); resolve(Number(String(chunk).trim())); });
  });
  const url = `http://127.0.0.1:${port}/api/t4/workspace`;
  const document = { periods: { [PERIOD]: { tmall: { [DAY]: { retailIncome: 20, retailCost: 10 } } } }, cfg: {}, channels: [] };
  const initial = await fetch(url, { method: 'PUT', body: JSON.stringify({ baseVersion: 0, document }) });
  assert.equal(initial.status, 200);
  return { url };
}

function client(server, storage = new Map()) {
  const requests = [], listeners = {}, intervals = [], notifications = [], renders = [];
  let nextGate, nextFailure;
  const dom = { hidden: false, activeElement: null, fields: [],
    addEventListener(name, handler) { (listeners[`document:${name}`] ||= []).push(handler); },
    querySelectorAll(selector) { return selector === '#view input, #view textarea, #view select' ? this.fields : []; },
    getElementById() { return null; },
  };
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl, CURS: 't4',
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET'; requests.push(method);
      if (method === 'GET' && nextFailure) {
        const failure = nextFailure; nextFailure = null;
        if (failure instanceof Error) throw failure;
        return { ok: false, status: failure, json: async () => ({ error: 'authentication_required' }) };
      }
      const gate = nextGate?.method === method ? nextGate : null;
      if (gate) nextGate = null;
      const response = await fetch(new URL(url, server.url), options);
      if (gate) { gate.reached(); await gate.resumed; }
      return response;
    },
    window: {
      addEventListener(name, handler) { (listeners[`window:${name}`] ||= []).push(handler); },
      setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
      financeSessionExpired() { notifications.push('expired'); },
    },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: dom, S: {}, go(route) { renders.push(route); }, toast(message) { notifications.push(message); },
    H: String, pill: String, money: String,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4-sync.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4-returns.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run(`T4.period='${PERIOD}'`);
  return { shared: context.window.T4Shared, run, dom, requests, intervals, notifications, renders,
    failNextGet(error) { nextFailure = error; },
    gate(method = 'GET') {
      let reached, release;
      const arrived = new Promise(resolve => { reached = resolve; });
      const resumed = new Promise(resolve => { release = resolve; });
      nextGate = { method, reached, resumed };
      return { arrived, release };
    },
    emit(target, event) { (listeners[`${target}:${event}`] || []).forEach(handler => handler({})); },
  };
}

async function pair(t) {
  const server = await service(t), a = client(server), b = client(server);
  await Promise.all([a.run('t4LoadServer()'), b.run('t4LoadServer()')]);
  return { a, b };
}
const row = `T4.data.tmall['${DAY}']`;
const baseline = app => copy(app.run('T4_SERVER_BASELINE'));
const acknowledged = app => copy(app.shared.state);
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('condition did not become true');
}

test('an idle second client receives saved amounts, configuration and catalogs without writing', async t => {
  const { a, b } = await pair(t);
  b.run(`${row}.retailIncome=100; T4.cfg.tmall.feeRate=0.2`);
  await b.run('t4Save()');
  await b.run("t4SaveCatalog('channels', [{id:'tmall',n:'新的渠道名称',bu:'ecom'}])");
  await b.run("t4SaveCatalog('expenseItems', [{k:'expense_test',n:'共享费用'}])");
  assert.equal(await a.run('t4RefreshServer()'), true);
  assert.equal(a.run(`${row}.retailIncome`), 100);
  assert.equal(a.run('T4.cfg.tmall.feeRate'), 0.2);
  assert.equal(a.run('T4_CHM.tmall.n'), '新的渠道名称');
  assert.equal(a.run('T4.expenseItems[0].n'), '共享费用');
  assert.equal(a.run('T4_SERVER_VERSION'), b.run('T4_SERVER_VERSION'));
  assert.deepEqual(acknowledged(a), acknowledged(b));
  assert.equal(a.requests.includes('PUT'), false);
  const renders = a.renders.length;
  await a.run('t4RefreshServer()');
  assert.equal(a.renders.length, renders, 'an unchanged version does not redraw the page');
});

test('a local draft keeps its old baseline and still conflicts with another user on save', async t => {
  const { a, b } = await pair(t), before = baseline(a), sharedBefore = acknowledged(a);
  a.run(`${row}.retailIncome=200`);
  b.run(`${row}.retailIncome=100`); await b.run('t4Save()');
  const reads = a.requests.length;
  assert.equal(await a.run('t4RefreshServer(true)'), false);
  assert.equal(a.requests.length, reads);
  assert.equal(a.run(`${row}.retailIncome`), 200);
  assert.deepEqual(baseline(a), before); assert.deepEqual(acknowledged(a), sharedBefore);
  assert.match(a.notifications.at(-1), /先保存/);
  await assert.rejects(a.run('t4Save()'), error => error.code === 'field_conflict');
  await a.run('t4RefreshServer()');
  await assert.rejects(a.run('t4Save()'), error => error.code === 'field_conflict');
  assert.deepEqual(baseline(a), before);
});

test('blurred DOM-only edits, focused controls and pending import/catalog editors defer refresh', async t => {
  const { a } = await pair(t), before = baseline(a), reads = a.requests.length;
  a.dom.fields = [{ tagName: 'INPUT', type: 'number', value: '0.25', defaultValue: '0.1' }];
  assert.equal(await a.run('t4RefreshServer()'), false);
  a.dom.fields = [];
  a.dom.activeElement = { matches: () => true };
  assert.equal(await a.run('t4RefreshServer()'), false);
  a.dom.activeElement = null;
  for (const setup of ['T4.imp={rows:[]}', 'T4.allocImport={rows:[]}', "CURS='t4-channel-edit'", "CURS='t4-source-edit'", "T4.expenseDraft={n:'草稿'}", "T4.expenseEdits={day:{expense_test:'2'}}"]) {
    a.run(setup); assert.equal(await a.run('t4RefreshServer()'), false);
    a.run("T4.imp=null; T4.allocImport=null; T4.expenseDraft=null; T4.expenseEdits={}; CURS='t4'");
  }
  assert.equal(a.requests.length, reads); assert.deepEqual(baseline(a), before);
});

test('an edit begun during GET discards the snapshot and preserves CAS conflict protection', async t => {
  const { a, b } = await pair(t), before = baseline(a), sharedBefore = acknowledged(a);
  b.run(`${row}.retailIncome=100`); await b.run('t4Save()');
  const gate = a.gate(); t.after(gate.release);
  const refreshing = a.run('t4RefreshServer()'); await gate.arrived;
  a.run(`${row}.retailIncome=200`); gate.release();
  assert.equal(await refreshing, false);
  assert.deepEqual(baseline(a), before); assert.deepEqual(acknowledged(a), sharedBefore);
  await assert.rejects(a.run('t4Save()'), error => error.code === 'field_conflict');
});

test('an old GET cannot roll back a newer acknowledged save', async t => {
  const { a } = await pair(t), gate = a.gate(); t.after(gate.release);
  const refreshing = a.run('t4RefreshServer()'); await gate.arrived;
  a.run(`${row}.retailIncome=200`); await a.run('t4Save()');
  const before = baseline(a), sharedBefore = acknowledged(a);
  gate.release(); assert.equal(await refreshing, false);
  assert.equal(a.run(`${row}.retailIncome`), 200);
  assert.deepEqual(baseline(a), before); assert.deepEqual(acknowledged(a), sharedBefore);
});

test('a GET returning during PUT cannot change either acknowledged baseline', async t => {
  const { a } = await pair(t), before = baseline(a), sharedBefore = acknowledged(a), readGate = a.gate(); t.after(readGate.release);
  const refreshing = a.run('t4RefreshServer()'); await readGate.arrived;
  a.run(`${row}.retailIncome=200`);
  const saveGate = a.gate('PUT'); t.after(saveGate.release);
  const saving = a.run('t4Save()'); await saveGate.arrived;
  readGate.release(); assert.equal(await refreshing, false);
  assert.deepEqual(baseline(a), before);
  assert.equal(a.shared.state.version, sharedBefore.version);
  assert.deepEqual(copy(a.shared.state.document), sharedBefore.document);
  saveGate.release(); await saving;
  assert.equal(a.run(`${row}.retailIncome`), 200);
});

test('navigation and month changes during GET discard that response', async t => {
  const { a, b } = await pair(t), before = baseline(a);
  b.run(`${row}.retailIncome=100`); await b.run('t4Save()');
  for (const change of ["CURS='t4-sheet'", "T4.period='2099-11'"]) {
    const gate = a.gate(); t.after(gate.release);
    const refreshing = a.run('t4RefreshServer()'); await gate.arrived;
    a.run(change); gate.release(); assert.equal(await refreshing, false);
    assert.deepEqual(baseline(a), before);
    a.run(`CURS='t4'; T4.period='${PERIOD}'`);
  }
});

test('failed background reads retain data and report connection or login state, then recover', async t => {
  const { a } = await pair(t), before = baseline(a), sharedBefore = acknowledged(a);
  a.failNextGet(new Error('offline'));
  assert.equal(await a.run('t4RefreshServer()'), false);
  assert.match(a.run('t4SyncStatus()'), /连接中断/);
  assert.deepEqual(baseline(a), before); assert.deepEqual(acknowledged(a), sharedBefore);
  a.failNextGet(401);
  assert.equal(await a.run('t4RefreshServer()'), false);
  assert.match(a.run('t4SyncStatus()'), /登录财务中心/);
  assert.ok(a.notifications.includes('expired'));
  assert.deepEqual(baseline(a), before); assert.deepEqual(acknowledged(a), sharedBefore);
  assert.equal(await a.run('t4RefreshServer()'), true);
  assert.equal(a.run('T4_SERVER_ERROR'), null);
});

test('focus, returning to a visible page, online and the 15-second timer refresh without duplicate timers', async t => {
  const { a } = await pair(t);
  a.run('t4StartAutoRefresh()');
  assert.equal(a.intervals.length, 1); assert.equal(a.intervals[0].delay, 15000);
  for (const trigger of [() => a.emit('window', 'focus'), () => a.emit('window', 'online'),
    () => a.emit('document', 'visibilitychange'), () => a.intervals[0].callback()]) {
    const reads = a.requests.length; trigger();
    await until(() => !a.run('T4_SERVER_REFRESHING'));
    assert.equal(a.requests.length, reads + 1);
  }
  const reads = a.requests.length;
  a.dom.hidden = true; a.intervals[0].callback(); a.emit('document', 'visibilitychange');
  assert.equal(a.requests.length, reads);
  a.dom.hidden = false; a.run("CURS='home'"); a.intervals[0].callback();
  assert.equal(a.requests.length, reads);
});

test('acknowledging a refresh refuses stale, loading or saving snapshots', async t => {
  const { a } = await pair(t), state = acknowledged(a), snapshot = await a.shared.readSnapshot();
  assert.equal(a.shared.acceptRefresh(snapshot, snapshot.version - 1), false);
  assert.equal(a.shared.acceptRefresh({ ...snapshot, version: snapshot.version - 1 }, snapshot.version), false);
  a.shared.state.saving = true;
  assert.equal(a.shared.acceptRefresh(snapshot, snapshot.version), false);
  a.shared.state.saving = false; a.shared.state.loading = true;
  assert.equal(a.shared.acceptRefresh(snapshot, snapshot.version), false);
  a.shared.state.loading = false;
  assert.deepEqual(acknowledged(a), state);
});

test('reads use a bounded request and a timeout releases the load for retry', async () => {
  const signal = {}, durations = [], requests = [];
  const context = vm.createContext({ window: {}, AbortSignal: { timeout(ms) { durations.push(ms); return signal; } },
    fetch: async (url, options) => {
      requests.push(options);
      if (requests.length === 1) throw new Error('request timed out');
      return { ok: true, json: async () => ({ version: 1, document: { periods: {}, cfg: {}, channels: [] } }) };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4-sync.js'), 'utf8'), context);
  const shared = context.window.T4Shared;
  await assert.rejects(shared.load(), /timed out/);
  assert.equal(shared.state.loading, false); assert.equal(shared.state.ready, false);
  await shared.load();
  assert.equal(shared.state.ready, true);
  assert.deepEqual(durations, [15000, 15000]); assert.equal(requests[0].signal, signal);
});

async function returnPair(t) {
  const { a, b } = await pair(t);
  b.run(`T4.data.tm_zzzrest['${DAY}']={rebateAmount:-100,_manualFields:{rebateAmount:true}}`);
  await b.run('t4Save()'); await a.run('t4RefreshServer()');
  a.run(`T4.returnEntry={period:'${PERIOD}',channel:'tm_zzzrest',date:'${DAY}',amount:'100'}`);
  return { a, b };
}

test('clean return prefills follow a new snapshot on the form, off the form and across months', async t => {
  const { a, b } = await returnPair(t);
  for (const setup of ["CURS='t4-returns'", "CURS='t4'", "CURS='t4'; T4.period='2099-11'; t4Load()"] ) {
    a.run(setup);
    const next = b.run(`-T4.data.tm_zzzrest['${DAY}'].rebateAmount`) + 100;
    b.run(`T4.data.tm_zzzrest['${DAY}'].rebateAmount=-${next}`); await b.run('t4Save()');
    assert.equal(await a.run('t4RefreshServer()'), true);
    assert.equal(a.run('T4.returnEntry.amount'), String(next));
    a.run(`T4.period='${PERIOD}'; t4Load()`);
    await a.run('t4SaveReturn()');
    assert.equal(a.run(`T4_SERVER_DOCUMENT.periods['${PERIOD}'].tm_zzzrest['${DAY}'].rebateAmount`), -next);
  }
});

test('a dirty return amount off the form or in another month retains its baseline and conflicts on save', async t => {
  const { a, b } = await returnPair(t);
  a.run("T4.returnEntry.amount='150'; CURS='t4'; T4.period='2099-11'; t4Load()");
  const before = baseline(a);
  b.run(`T4.data.tm_zzzrest['${DAY}'].rebateAmount=-200`); await b.run('t4Save()');
  assert.equal(await a.run('t4RefreshServer(true)'), false);
  assert.equal(a.run('T4.returnEntry.amount'), '150'); assert.deepEqual(baseline(a), before);
  assert.match(a.run('t4SyncStatus()'), /2099-12.*返款录入/);
  a.run(`T4.period='${PERIOD}'; t4Load()`);
  await assert.rejects(a.run('t4SaveReturn()'), error => error.code === 'field_conflict');
});

test('another successful save also updates a clean return prefill from the merged server response', async t => {
  const { a, b } = await returnPair(t);
  b.run(`T4.data.tm_zzzrest['${DAY}'].rebateAmount=-200`); await b.run('t4Save()');
  a.run(`${row}.retailIncome=300`); await a.run('t4Save()');
  assert.equal(a.run('T4.returnEntry.amount'), '200');
  await a.run('t4SaveReturn()');
  assert.equal(a.run(`T4_SERVER_DOCUMENT.periods['${PERIOD}'].tm_zzzrest['${DAY}'].rebateAmount`), -200);
});

test('another tab writing the channel cache neither creates a local draft nor stages a catalog write', async t => {
  const server = await service(t), storage = new Map(), a = client(server, storage), b = client(server, storage);
  await Promise.all([a.run('t4LoadServer()'), b.run('t4LoadServer()')]);
  await b.run("t4SaveCatalog('channels', [{id:'tmall',n:'别的标签已保存',bu:'ecom'}])");
  assert.equal(a.run('t4ChOverrides().length'), 0);
  assert.equal(a.run('t4RefreshBlockedReason()'), '');
  assert.equal(await a.run('t4RefreshServer()'), true);
  assert.equal(a.run('T4_CHM.tmall.n'), '别的标签已保存');
  assert.equal(a.requests.includes('PUT'), false);
});

test('a dirty page can verify restored login without accepting a new baseline or bypassing CAS', async t => {
  const { a, b } = await pair(t), before = baseline(a), sharedBefore = acknowledged(a);
  a.failNextGet(401); await a.run('t4RefreshServer()');
  a.run(`${row}.retailIncome=200`);
  b.run(`${row}.retailIncome=100`); await b.run('t4Save()');
  const reads = a.requests.length;
  assert.equal(await a.run('t4RefreshServer(true)'), false);
  assert.equal(a.requests.length, reads + 1);
  assert.equal(a.run('T4_SERVER_ERROR'), null);
  assert.equal(a.run(`${row}.retailIncome`), 200);
  assert.deepEqual(baseline(a), before); assert.deepEqual(acknowledged(a), sharedBefore);
  await assert.rejects(a.run('t4Save()'), error => error.code === 'field_conflict');
});
