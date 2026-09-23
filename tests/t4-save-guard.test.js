const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

// Run both production modules. Only HTTP and browser storage are simulated.
function app() {
  const storage = new Map(), requests = [], messages = [];
  let failure = '', version = 7;
  let remote = { periods: {}, cfg: {}, channels: [], periodLocks: { '2026-09': false } };
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    window: {}, S: {}, go() {}, toast: message => messages.push(message), H: String, pill: String, money: String,
    fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      if (failure === 'network') throw new Error('网络连接失败');
      if (failure === '401') return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
      if (options.method === 'PUT') {
        const input = JSON.parse(options.body);
        assert.equal(input.baseVersion, version);
        for (const change of input.changes) {
          let target = remote;
          for (const key of change.path.slice(0, -1)) target = target[key] ||= {};
          const key = change.path.at(-1);
          if (change.newExists) target[key] = clone(change.value); else delete target[key];
        }
        version++;
      }
      return { ok: true, json: async () => ({ found: true, version, document: clone(remote) }) };
    },
  });
  for (const file of ['t4-sync.js', 't4.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  const run = code => vm.runInContext(code, context);
  run("T4.period='2026-09'; t4CurrentMonth=()=> '2026-09'; T4.periodLocks={'2026-09':false};");
  return { run, json: code => clone(run(code)), storage, requests, messages,
    fail: value => { failure = value; }, remote: () => clone(remote) };
}

function editDraft(a) {
  a.run(`T4.data.tmall={'2026-09-01':{retailIncome:321}};
    T4.cfg.tmall={directLaborMonth:654};
    T4.imp={fileName:'未提交.xlsx',rows:[['日期','金额'],['2026-09-01',321]]};
    T4.allocImport={type:'payroll',fileName:'待导入工资.xlsx'};
    T4_PENDING_DRAFT={period:T4.period,data:t4Clone(T4.data),cfg:t4Clone(T4.cfg)};`);
}

const draft = a => a.json('({data:T4.data,cfg:T4.cfg,imp:T4.imp,allocation:T4.allocImport,pending:T4_PENDING_DRAFT,locks:T4.periodLocks})');
const saves = [
  ['daily data', 't4Save()'],
  ['monthly parameters', 't4SaveCfg()'],
  ['month lock', 't4SetPeriodLock(true)'],
  ['direct workspace', 't4SaveServer()'],
];

for (const state of ['not loaded', '401', 'network']) {
  for (const [label, operation] of saves) {
    test(`${label} save rejects when shared data is ${state} and retains every draft`, async () => {
      const a = app();
      if (state !== 'not loaded') {
        a.fail(state);
        await a.run('t4LoadServer()');
      }
      editDraft(a);
      const before = draft(a), cachedBefore = [...a.storage], requestCount = a.requests.length;
      const expected = state === '401' ? /登录财务中心/ : state === 'network' ? /未能连接财务中心/ : /共享数据未连接/;
      await assert.rejects(a.run(operation), expected);
      assert.deepEqual(draft(a), before);
      assert.deepEqual([...a.storage], cachedBefore, 'a blocked write must not be cached as a completed save');
      assert.equal(a.requests.length, requestCount, 'a save cannot implicitly load and overwrite an unseen workspace');
      assert.equal(a.run('T4_SERVER_READY'), false);
      assert.equal(a.run('T4_SERVER_SAVING'), false);
      assert.equal(a.run('T4_SERVER_BASELINE'), null);
    });
  }
}

for (const failure of ['401', 'network']) {
  for (const [label, operation] of saves) {
    test(`${label} write failure (${failure}) retains the loaded baseline and editable draft`, async () => {
      const a = app();
      await a.run('t4LoadServer()');
      editDraft(a);
      const before = draft(a), baseline = a.json('T4_SERVER_BASELINE'), remoteBefore = a.remote();
      a.fail(failure);
      await assert.rejects(a.run(operation), failure === '401' ? /门户登录/ : /网络连接失败/);
      assert.deepEqual(draft(a), before, 'failed locking must also restore the prior lock');
      assert.deepEqual(a.json('T4_SERVER_BASELINE'), baseline);
      assert.deepEqual(a.remote(), remoteBefore);
      assert.equal(a.run('T4_SERVER_VERSION'), 7);
      assert.equal(a.run('window.T4Shared.state.version'), 7);
      assert.equal(a.run('T4_SERVER_SAVING || window.T4Shared.state.saving'), false);
      if (failure === '401') {
        const count = a.requests.length;
        await assert.rejects(a.run(operation), /登录财务中心/);
        assert.equal(a.requests.length, count, 'expired sessions cannot report a successful second save');
        assert.deepEqual(draft(a), before);
      } else {
        a.fail('');
        await a.run(operation);
        assert.equal(a.run('T4_SERVER_VERSION'), 8, 'the retained edit is retryable after connection recovery');
        if (label === 'month lock') {
          assert.equal(a.remote().periodLocks['2026-09'], true);
          assert.equal(a.run("T4.data.tmall['2026-09-01'].retailIncome"), 321);
        } else {
          assert.equal(a.remote().periods['2026-09'].tmall['2026-09-01'].retailIncome, 321);
          assert.equal(a.remote().cfgByPeriod['2026-09'].tmall.directLaborMonth, 654);
        }
      }
    });
  }
}
