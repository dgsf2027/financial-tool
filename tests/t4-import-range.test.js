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
  // These import/entry tests model a connected workspace. Exercise the real
  // save path and acknowledge its document through an explicit service stub.
  vm.runInContext(`T4_SERVER_READY=true; T4_SERVER_VERSION=1;
    T4_SERVER_DOCUMENT=t4ViewDocument(); T4_SERVER_BASELINE=t4ViewDocument();
    window.T4Shared.save=async document=>({version:T4_SERVER_VERSION+1,document:t4Clone(document)});`, context);
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

test('mixed-sign rebate imports deduct each row, preserve refunds, and remain idempotent', async () => {
  const a = app();
  a.run("T4.data.tm_orange={'2099-12-01':{retailIncome:1000,refundAmount:-100,retailCost:400}};T4.cfg.tm_orange={platformFeeRate:0.05};");
  for (let attempt = 0; attempt < 2; attempt++) {
    summary(a, [['tm_orange','2099-12-01',25],['tm_orange','2099-12-01',-25]], {map:{channel:0,date:1,rebateAmount:2}});
    await a.run('t4SummaryImpRun()');
    assert.equal(a.run("t4InputValue(t4Raw('tm_orange','2099-12-01'),'rebateAmount')"), -50);
    assert.equal(a.run("t4Raw('tm_orange','2099-12-01').refundAmount"), -100);
    assert.equal(a.run("t4Row('tm_orange','2099-12-01').salesIncome"), 850);
    assert.equal(a.run("t4Row('tm_orange','2099-12-01').platformFee"), 42.5);
    assert.equal(a.run("t4Row('tm_orange','2099-12-01').netProfit"), 407.5);
  }
  assert.equal(a.run("t4AutoMap(['日期','渠道','返款金额'],T4_FILE_DEFS.summaryDaily).rebateAmount"), 2);
});

test('daily rebate file normalizes signs before summing and accepts explicit zero', async () => {
  const a = app();
  a.run("T4.editCh='tm_orange';T4.data.tm_orange={'2099-12-02':{refundAmount:-8}};T4.imp={mode:'channel',fileK:'daily',fileName:'返款.csv',headRow:0,map:{date:0,rebateAmount:1},rows:[[],['2099-12-01',15],['2099-12-01',-20],['2099-12-02',0]]};");
  await a.run('t4ImpRun()');
  assert.equal(a.run("t4InputValue(t4Raw('tm_orange','2099-12-01'),'rebateAmount')"), -35);
  assert.equal(a.run("t4InputValue(t4Raw('tm_orange','2099-12-02'),'rebateAmount')"), 0);
  assert.equal(a.run("t4Raw('tm_orange','2099-12-02').refundAmount"), -8);
});

test('range manual rebate input normalizes the amount and follows income-only clearing scope', async () => {
  const a = app();
  a.run("T4.data.tm_orange={'2099-12-01':{retailCost:400,refundAmount:-100},'2099-12-02':{rebateAmount:-75}};");
  a.inputs.push({dataset:{t4sumcell:'2099-12-01:tm_orange:rebateAmount',t4orig:''},value:'50'});
  await a.run('t4SaveEntries(true)');
  assert.equal(a.run("t4Raw('tm_orange','2099-12-01').rebateAmount"), -50);
  await a.run("t4ClearPeriodData('orange','income','2099-12-01','2099-12-01')");
  assert.equal(a.run("t4InputValue(t4Raw('tm_orange','2099-12-01'),'rebateAmount')"), null);
  assert.equal(a.run("t4Raw('tm_orange','2099-12-01').retailCost"), 400);
  assert.equal(a.run("t4Raw('tm_orange','2099-12-02').rebateAmount"), -75);
});

test('range rebate entry and clearing preserve legacy imported field provenance', async () => {
  const a = app();
  a.run("T4.projFilter='orange';T4.data.tm_orange={'2099-12-01':{retailIncome:1000,retailCost:400,refundAmount:-100,_src:'file'}};");
  const input = {dataset:{t4sumcell:'2099-12-01:tm_orange:rebateAmount',t4orig:''},value:'50'};
  a.inputs.push(input);
  await a.run('t4SaveEntries(true)');
  const rows = a.json('t4RawExportRows().rows');
  const col = name => rows[0].indexOf(name);
  const legacy = rows.find(row => row[col('来源代码')] === 'legacy-file');
  const manual = rows.find(row => row[col('来源代码')] === 'manual');
  assert.equal(legacy[col('零售收入')], 1000);
  assert.equal(legacy[col('零售成本')], 400);
  assert.equal(legacy[col('退款金额')], -100);
  assert.equal(legacy[col('返款金额（扣减收入）')], '');
  assert.equal(manual[col('返款金额（扣减收入）')], -50);
  assert.equal(manual[col('零售收入')], '');
  input.dataset.t4orig = '-50'; input.value = '';
  await a.run('t4SaveEntries(true)');
  assert.equal(a.run("t4Raw('tm_orange','2099-12-01')._src"), 'file');
  assert.equal(a.run("t4Raw('tm_orange','2099-12-01')._manualFields.rebateAmount"), undefined);
  assert.equal(a.json('t4RawExportRows().rows').length, 2);
});

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

test('explicit range filters dates, preserves missing values, and records skipped reasons', async () => {
  const a = app(); seed(a);
  summary(a, [['天猫-澳乐旗舰店', '2099-12-02', '售后退货', 20, 8], ['天猫-澳乐旗舰店', '2099-12-01', '', 20, 8], ['未知', '2099-12-02', '', 20, 8]],
    { rangeMode: 'range', from: '2099-12-02', to: '2099-12-03' });
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailIncome')"), 100);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'returnAmount')"), -20);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'returnCost')"), -8);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailIncome')"), 200);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailCost')"), 80);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailIncome')"), 300);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailCost')"), 120);
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

test('blank return fields never erase existing same-source returns during a normal sales import', async () => {
  const a = app();
  a.run(`T4.data.tmall={'2099-12-01':{_fileParts:{summaryIncome:{retailIncome:100,returnAmount:-15,refundAmount:-5},summaryCost:{retailCost:40,returnCost:-6}}}}`);
  summary(a, [['天猫-澳乐旗舰店','2099-12-01','普通销售',120,50,'','','']], { map:{channel:0,date:1,type:2,retailIncome:3,retailCost:4,returnAmount:5,refundAmount:6,returnCost:7} });
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailIncome')"), 120);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailCost')"), 50);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'returnAmount')"), -15);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'returnCost')"), -6);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'refundAmount')"), -5);
});

test('explicit range is only a filter and preserves missing dates and blank daily fields', async () => {
  const a = app();
  a.run(`T4.data.tmall={'2099-12-01':{_fileParts:{daily:{retailIncome:10,retailCost:5}}},'2099-12-02':{_fileParts:{daily:{retailIncome:20,retailCost:8}}},'2099-12-03':{_fileParts:{daily:{retailIncome:30,retailCost:12}}}};
    T4.imp={mode:'channel',fileK:'daily',fileName:'daily.xlsx',headRow:0,rangeMode:'range',from:'2099-12-01',to:'2099-12-03',map:{date:0,retailIncome:1,retailCost:2},rows:[[],['2099-12-01',12,6],['2099-12-02',24,'']]}`);
  await a.run('t4ImpRun()');
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailIncome')"), 12);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-01'],'retailCost')"), 6);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailIncome')"), 24);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-02'],'retailCost')"), 8);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailIncome')"), 30);
  assert.equal(a.run("t4InputValue(T4.data.tmall['2099-12-03'],'retailCost')"), 12);
});
