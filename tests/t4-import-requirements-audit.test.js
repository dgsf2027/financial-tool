const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app() {
  const storage = new Map(), handlers = {};
  const context = vm.createContext({
    console, Date, Set, Map,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener: (type, handler) => handlers[type] = handler, querySelectorAll: () => [], getElementById: () => null },
    window: { T4Shared: { clone: value => JSON.parse(JSON.stringify(value)), empty: () => ({ periods: {}, cfg: {}, channels: [] }) } },
    S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  vm.runInContext(`t4LoadServer=async()=>{}; T4.period='2099-12'; t4Load(); T4.periodLocks={'2099-12':false};
    T4_SERVER_READY=true; T4_SERVER_VERSION=1;
    T4_SERVER_DOCUMENT=t4ViewDocument(); T4_SERVER_BASELINE=t4ViewDocument();
    window.T4Shared.save=async document=>({version:T4_SERVER_VERSION+1,document:t4Clone(document)});`, context);
  return { run: code => vm.runInContext(code, context), json: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)), handlers };
}

test('combined import prefers exact channel and shipping-date headers over similar earlier columns', async () => {
  const a = app();
  a.run(`T4.sumScope='both';
    rows=[['渠道备注','销售渠道','订单日期','发货时间','分摊后金额','货品成本'],
      ['待核对','天猫-澳乐旗舰店','2099-12-01','2099-12-02',100,40]];
    T4.imp={mode:'summary',fileK:'summaryDaily',headRow:0,rows,map:t4AutoMap(rows[0],T4_FILE_DEFS.summaryDaily)};`);
  assert.equal(a.run('T4.imp.map.channel'), 1);
  assert.equal(a.run('T4.imp.map.date'), 3);
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4Row('tmall','2099-12-02').salesIncome"), 100);
  assert.equal(a.run("t4Row('tmall','2099-12-02').salesCost"), 40);
  assert.equal(a.run("t4Raw('tmall','2099-12-01')"), null);
});

test('auto-mapping retains supported unit-suffixed headers when no exact alias exists', () => {
  const a = app();
  assert.deepEqual(a.json("t4AutoMap(['记账时间','操作金额（元）','收支类型'],T4_FILE_DEFS.ztc)"), { date: 0, amount: 1, direction: 2 });
});

test('per-channel after-sales cost adjustments keep source signs and explicit zero on repeat imports', async () => {
  const a = app();
  a.run(`T4.editCh='tmall';
    originalImport={mode:'channel',fileK:'sales',headRow:0,
      map:{date:0,channel:1,type:2,amount:3,cost:4},
      rows:[[],['2099-12-01','天猫-澳乐旗舰店','售后发货',-25,-12],
        ['2099-12-02','天猫-澳乐旗舰店','售后发货',0,0],
        ['2099-12-03','天猫-澳乐旗舰店','售后退货',5,2]]};`);
  for (let attempt = 0; attempt < 2; attempt++) {
    await a.run('T4.imp=t4Clone(originalImport);t4ImpRun()');
    assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-01'),'retailIncome')"), -25);
    assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-01'),'retailCost')"), -12);
    assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-02'),'retailIncome')"), 0);
    assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-02'),'retailCost')"), 0);
    assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-03'),'returnAmount')"), -5);
    assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-03'),'returnCost')"), -2);
  }
});

test('manual Youzan pillow channel adjustment applies to both income and cost and remains idempotent', async () => {
  const a = app();
  a.run(`T4.sumScope='both';T4.imp={mode:'summary',fileK:'summaryDaily',headRow:0,
    map:{channel:0,date:1,type:2,product:3,retailIncome:4,retailCost:5},
    rows:[[],['有赞-澳乐乐姐心选','2099-12-01','售后发货','枕头',100,40],
      ['有赞-澳乐乐姐心选','2099-12-01','普通销售','积木',30,12]]};`);
  a.handlers.change({ target: { dataset: { t4rowchannel: '1' }, value: 'tm_zzzrest' } });
  a.run('originalImport=t4Clone(T4.imp)');
  for (let attempt = 0; attempt < 2; attempt++) {
    await a.run('T4.imp=t4Clone(originalImport);t4SummaryImpRun()');
    assert.equal(a.run("t4InputValue(t4Raw('tm_zzzrest','2099-12-01'),'retailIncome')"), 100);
    assert.equal(a.run("t4InputValue(t4Raw('tm_zzzrest','2099-12-01'),'retailCost')"), 40);
    assert.equal(a.run("t4InputValue(t4Raw('priv','2099-12-01'),'retailIncome')"), 30);
    assert.equal(a.run("t4InputValue(t4Raw('priv','2099-12-01'),'retailCost')"), 12);
    const record = a.json('Object.values(T4.importHistory).at(-1)');
    assert.deepEqual(record.channels.sort(), ['priv', 'tm_zzzrest']);
    assert.equal(record.used, 2);
    assert.equal(record.skipped, 0);
  }
});
