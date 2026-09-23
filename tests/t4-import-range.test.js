const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
function app() {
  const storage = new Map(), handlers = {}, inputs = [];
  const context = vm.createContext({ console, Date, Set, Map, URL, Blob, Intl,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener: (k, f) => handlers[k] = f, querySelectorAll: () => inputs, getElementById: () => null },
    window: { T4Shared: { clone: x => JSON.parse(JSON.stringify(x)), empty: () => ({ periods: {}, cfg: {}, channels: [] }) } },
    S: {}, go() {}, toast() {}, H: String, pill: String, money: String, head: (...x) => x.join(''), card: (...x) => x.join(''), cardp: (...x) => x.join(''),
    table: (cols, rows) => JSON.stringify({ cols, rows }), CUR_USER: '测试员',
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4.js'), 'utf8'), context);
  vm.runInContext("t4LoadServer=async()=>{}; T4.period='2099-12'; t4Load(); T4.periodLocks={'2099-12':false};", context);
  return { run: x => vm.runInContext(x, context), json: x => JSON.parse(vm.runInContext(`JSON.stringify(${x})`, context)), storage, handlers, inputs };
}
function seed(a) {
  a.run(`T4.data.tmall={
    '2099-12-01':{_fileParts:{summaryIncome:{retailIncome:100},summaryCost:{retailCost:40},sales:{retailIncome:50}},promotion:9},
    '2099-12-02':{_fileParts:{summaryIncome:{retailIncome:200},summaryCost:{retailCost:80}}},
    '2099-12-03':{_fileParts:{summaryIncome:{retailIncome:300},summaryCost:{retailCost:120}}}
  }`);
}
function summary(a, rows, extra = {}) {
  a.run(`T4.sumScope='both'; T4.imp=${JSON.stringify({ mode: 'summary', fileK: 'summaryDaily', fileName: 'sales.xlsx', headRow: 0,
    map: { channel: 0, date: 1, type: 2, retailIncome: 3, retailCost: 4 }, rows: [[], ...rows], ...extra })}`);
}

test('single-day combined import retains other dates, sources, blank cost, and explicit zero', async () => {
  const a = app(); seed(a);
  summary(a, [['天猫-澳乐旗舰店', '2099-12-02', '普通销售', 0, '']]);
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailIncome')"), 0);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailCost')"), 80);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailIncome')"), 100);
  assert.equal(a.run("T4.data.tmall['2099-12-01']._fileParts.sales.retailIncome"), 50);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailIncome')"), 300);
  assert.equal(a.run('Object.keys(T4.importHistory).length'), 1);
  assert.equal(JSON.parse(a.storage.get('fsc_t4_import_history_v1'))[a.run('Object.keys(T4.importHistory)[0]')].used, 1);
});

test('combined import validates both partitions before mutation and rolls back failed CAS including record', async () => {
  const a = app(); seed(a); const before = a.json('T4.data');
  summary(a, [['天猫-澳乐旗舰店', '2099-12-01', '普通销售', 88, '#N/A']]);
  await a.run('t4SummaryImpRun()');
  assert.deepEqual(a.json('T4.data'), before); assert.equal(a.run('Object.keys(T4.importHistory).length'), 0);
  summary(a, [['天猫-澳乐旗舰店', '2099-12-01', '普通销售', 88, 32]]);
  a.run("t4Save=async()=>{localStorage.setItem(T4_KEY,JSON.stringify({[T4.period]:T4.data}));throw new Error('同字段冲突')}");
  await a.run('t4SummaryImpRun()');
  assert.deepEqual(a.json('T4.data'), before); assert.equal(a.run('Object.keys(T4.importHistory).length'), 0);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_data_v2'))['2099-12'], before);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_import_history_v1')), {});
  assert.match(a.run('T4.importFeedback.message'), /原数据与记录已恢复/);
});

test('explicit range clears only selected source dates and records skipped reasons', async () => {
  const a = app(); seed(a);
  summary(a, [['天猫-澳乐旗舰店', '2099-12-02', '售后退货', 20, 8], ['天猫-澳乐旗舰店', '2099-12-01', '', 20, 8], ['未知', '2099-12-02', '', 20, 8]],
    { rangeMode: 'range', from: '2099-12-02', to: '2099-12-03' });
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailIncome')"), 100);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'returnAmount')"), -20);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'returnCost')"), -8);
  assert.equal(a.run("T4.data.tmall['2099-12-03']"), undefined);
  const record = a.json('Object.values(T4.importHistory)[0]');
  assert.equal(record.skipped, 2); assert.equal(record.issues.length, 2); assert.equal(record.mode, 'range');
});

test('invalid, reversed, cross-month, or locked date ranges never mutate import or clearing', async () => {
  const a = app(); seed(a); const before = a.json('T4.data');
  for (const [from, to] of [['2099-12-32','2099-12-32'], ['2099-12-03','2099-12-01'], ['2099-11-30','2099-12-01']]) {
    summary(a, [['天猫-澳乐旗舰店', '2099-12-01', '', 55, 22]], {rangeMode:'range',from,to});
    await a.run('t4SummaryImpRun()');
    await assert.rejects(a.run(`t4ClearPeriodData('all','all',${JSON.stringify(from)},${JSON.stringify(to)})`));
    assert.deepEqual(a.json('T4.data'), before);
  }
  a.run("T4.periodLocks[T4.period]=true");
  await assert.rejects(a.run("t4ClearPeriodData('all','all','2099-12-01','2099-12-01')"));
  assert.deepEqual(a.json('T4.data'), before);
});

test('daily clear isolates selected project, metric partition, and selected day', async () => {
  const a = app(); seed(a);
  a.run("T4.data.tm_orange={'2099-12-02':{retailIncome:999}}");
  await a.run("t4ClearPeriodData('aole','income','2099-12-02','2099-12-02')");
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailIncome')"), null);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailCost')"), 80);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailIncome')"), 300);
  assert.equal(a.run("T4.data.tm_orange['2099-12-02'].retailIncome"), 999);
});

test('per-channel file uses date-specific keys and retains blanks on another covered date', async () => {
  const a = app();
  a.run(`T4.data.tmall={'2099-12-01':{_fileParts:{daily:{retailIncome:10,retailCost:5}}},'2099-12-02':{_fileParts:{daily:{retailIncome:20,retailCost:8}}},'2099-12-03':{_fileParts:{daily:{retailIncome:30}}}};
    T4.imp={mode:'channel',fileK:'daily',fileName:'daily.xlsx',headRow:0,map:{date:0,retailIncome:1,retailCost:2},rows:[[],['2099-12-01',12,6],['2099-12-02',24,'']]}`);
  await a.run('t4ImpRun()');
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailCost')"), 8);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailIncome')"), 30);
});

test('multiple daily inputs save once without copying a value across range and roll back on failure', async () => {
  const a = app(); seed(a);
  const before = a.json('T4.data');
  a.inputs.push({dataset:{t4sumcell:'2099-12-01:tmall:retailIncome',t4orig:'100'},value:'55'}, {dataset:{t4sumcell:'2099-12-02:tmall:retailCost',t4orig:'80'},value:'0'});
  a.run('saves=0; originalSave=t4Save;t4Save=async()=>{saves++;return originalSave()}');
  await a.run('t4SaveEntries(true)');
  assert.equal(a.run('saves'), 1);
  assert.equal(a.run("T4.data.tmall['2099-12-01'].retailIncome"), 55);
  assert.equal(a.run("T4.data.tmall['2099-12-02'].retailIncome"), undefined);
  assert.equal(a.run("T4.data.tmall['2099-12-02'].retailCost"), 0);
  a.run(`T4.data=${JSON.stringify(before)};t4Save=async()=>{throw new Error('offline')}`);
  await assert.rejects(a.run('t4SaveEntries(true)'), /offline/);
  assert.deepEqual(a.json('T4.data'), before);
});

test('range entry renders distinct date-keyed cells and refuses switching with unsaved inputs', () => {
  const a = app();
  a.run("T4.sumDate='2099-12-02';T4.sumTo='2099-12-03'");
  const html = a.run("S['t4-summan']()");
  assert.match(html, /2099-12-02:tmall:retailIncome/); assert.match(html, /2099-12-03:tmall:retailCost/);
  a.inputs.push({dataset:{t4sumcell:'2099-12-02:tmall:retailIncome',t4orig:''},value:'5'});
  const target = {id:'t4SumTo',value:'2099-12-10'};
  a.handlers.change({target});
  assert.equal(a.run('T4.sumTo'), '2099-12-03'); assert.equal(target.value, '2099-12-03');
});
