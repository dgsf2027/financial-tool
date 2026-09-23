const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

async function app(seed = {}) {
  let remote = { periods: {}, cfg: {}, channels: [], periodLocks: { '2026-09': false }, ...clone(seed) };
  const storage = new Map(), handlers = {}, downloads = [];
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener: (type, fn) => { handlers[type] = fn; }, querySelectorAll: () => [], getElementById: () => null },
    window: { T4Shared: {
      clone, empty: () => ({ periods: {}, cfg: {}, channels: [] }),
      load: async () => ({ found: true, version: 1, document: clone(remote) }),
      save: async document => { remote = clone(document); return { version: 2, document: clone(remote) }; },
    } },
    S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
    head: (title, sub, meta, buttons) => title + sub + (buttons || ''),
    table: (columns, rows) => JSON.stringify(rows), card: (title, body) => title + body,
    cardp: (title, body) => title + body,
    toCSV: clone, download: (name, rows) => downloads.push({ name, rows }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run("T4.period='2026-09'; t4CurrentMonth=()=> '2026-09';");
  await run('t4LoadServer()');
  return { run, handlers, downloads, remote: () => clone(remote) };
}

test('Douyin commission can be configured per month without assuming a rate or changing history', async () => {
  const a = await app({ cfgByPeriod: { '2026-08': { dycreator: { commissionRate: 0.15 } } } });
  assert.equal(a.run('T4.cfg.dycreator.commissionRate'), undefined);
  assert.match(a.run("S['t4-cfg']()"), /value="commissionRate">佣金率（%）/);
  a.run("document.querySelector=()=>({value:'commissionRate'})");
  const button = { dataset: { t4cfgadd: 'dycreator' } };
  await a.handlers.click({ target: { closest: selector => selector === '[data-t4cfgadd]' ? button : null } });
  a.run("document.querySelectorAll=selector=>selector==='[data-t4cfg]' ? [{dataset:{t4cfg:'dycreator:commissionRate'},value:'12.5'}] : []; t4CfgReadInputs()");
  await a.run('t4SaveCfg()');
  assert.equal(a.remote().cfgByPeriod['2026-09'].dycreator.commissionRate, 0.125);
  assert.equal(a.remote().cfgByPeriod['2026-08'].dycreator.commissionRate, 0.15);
});

test('commission uses sales after deductions and leaves CPS actuals independent', async () => {
  const a = await app({ cfg: { dycreator: { commissionRate: 0.1 } },
    periods: { '2026-09': { dycreator: {
      '2026-09-01': { retailIncome: 1000, returnAmount: -200, refundAmount: -50, rebateAmount: 50, retailCost: 400, cps: 25 },
      '2026-09-02': { retailIncome: 500, retailCost: 200 },
    } } } });
  const first = clone(a.run("t4Row('dycreator','2026-09-01')"));
  assert.equal(first.commission, 70);
  assert.equal(first.cps, 25);
  assert.equal(first.operating, 95);
  assert.equal(first.netProfit, 205);
  assert.ok(first._hard.includes('commission'));
  assert.equal(a.run("t4Month('dycreator').commission"), 120);
  assert.equal(a.run("t4RangeData('dycreator','2026-09-01','2026-09-01').netProfit"), 205);
  assert.equal(a.run("t4DayData('dycreator','2026-09-03').commission"), 0);
});

test('manual and imported commission amounts including zero override the configured rate', async () => {
  const a = await app({ cfg: { dycreator: { commissionRate: 0.1 } },
    periods: { '2026-09': { dycreator: {
      '2026-09-01': { retailIncome: 1000, commission: 7, _fileParts: { daily: { commission: 9 } } },
      '2026-09-02': { retailIncome: 1000, commission: 0 },
      '2026-09-03': { retailIncome: 1000, _fileParts: { daily: { commission: 9 } } },
      '2026-09-04': { commission: -3 },
    } } } });
  assert.equal(a.run("t4Row('dycreator','2026-09-01').commission"), 7);
  assert.equal(a.run("t4Row('dycreator','2026-09-02').commission"), 0);
  assert.equal(a.run("t4Row('dycreator','2026-09-03').commission"), 9);
  assert.equal(a.run("t4Row('dycreator','2026-09-03')._hard.includes('commission')"), false);
  assert.equal(a.run("t4DayData('dycreator','2026-09-04').netProfit"), 3);
  for (const heading of ['达人佣金', '达人佣金金额', '佣金', '佣金金额']) {
    assert.equal(a.run(`t4AutoMap(['日期',${JSON.stringify(heading)}],T4_FILE_DEFS.daily).commission`), 1);
  }
  a.run("T4.editCh='dycreator'; T4.imp={mode:'channel',fileK:'daily',fileName:'佣金.csv',headRow:0,map:{date:0,commission:1},rows:[['日期','达人佣金'],['2026-09-03','0']]}");
  await a.run('t4ImpRun()');
  assert.equal(a.remote().periods['2026-09'].dycreator['2026-09-03']._fileParts.daily.commission, 0);
  assert.equal(a.run("t4Row('dycreator','2026-09-03').commission"), 0);
});

test('commission appears in daily CSV and suite workbook with consistent operating totals', async () => {
  const a = await app({ cfg: { dycreator: { commissionRate: 0.1 } },
    periods: { '2026-09': { dycreator: { '2026-09-01': { retailIncome: 1000 }, '2026-09-02': { commission: 5 } } } } });
  const payload = clone(a.run('t4SuitePayload()'));
  assert.ok(payload.inputKeys.includes('commission'));
  assert.ok(payload.operatingKeys.includes('commission'));
  assert.equal(payload.monthByCh.dycreator.commission, 105);
  assert.equal(payload.monthByCh.dycreator.netProfit, 895);
  a.run("T4.dayCh='dycreator'; t4DayExport()");
  assert.deepEqual(a.downloads[0].rows.find(row => row[0] === '达人佣金').slice(1, 3), ['100.00', '5.00']);
  a.run('window.XLSXWrite = XLSXWrite = {build:sheets=>sheets}; sheets=t4SuiteClientWorkbook(t4SuitePayload())');
  assert.equal(a.run("sheets.find(s=>s.name==='抖音-BD达人成交店').rows.find(r=>r[0]==='达人佣金')[1].n"), 105);
});
