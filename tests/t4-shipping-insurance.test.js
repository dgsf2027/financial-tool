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

test('Douyin insurance rule starts unset, adds at zero and saves a percentage for this month only', async () => {
  const a = await app({ cfgByPeriod: { '2026-08': { dycreator: { shippingInsuranceRate: 0.03 } } } });
  assert.equal(a.run('T4.cfg.dycreator.shippingInsuranceRate'), undefined);
  assert.match(a.run("S['t4-cfg']()"), /value="shippingInsuranceRate">运费险（%）/);
  a.run("document.querySelector=()=>({value:'shippingInsuranceRate'})");
  const button = { dataset: { t4cfgadd: 'dycreator' } };
  await a.handlers.click({ target: { closest: selector => selector === '[data-t4cfgadd]' ? button : null } });
  assert.equal(a.remote().cfgByPeriod['2026-09'].dycreator.shippingInsuranceRate, 0);
  a.run("document.querySelectorAll=selector=>selector==='[data-t4cfg]' ? [{dataset:{t4cfg:'dycreator:shippingInsuranceRate'},value:'1.25'}] : []; t4CfgReadInputs()");
  await a.run('t4SaveCfg()');
  assert.equal(a.remote().cfgByPeriod['2026-09'].dycreator.shippingInsuranceRate, 0.0125);
  assert.equal(a.remote().cfgByPeriod['2026-08'].dycreator.shippingInsuranceRate, 0.03);
  assert.equal(a.remote().cfgByPeriod['2026-09'].dy_orange.shippingInsuranceRate, undefined);
});

test('insurance is based on sales after deductions and reduces daily, monthly and date-range profit', async () => {
  const a = await app({ cfg: { dycreator: { shippingInsuranceRate: 0.02, platformFeeRate: 0.05 } },
    periods: { '2026-09': { dycreator: {
      '2026-09-01': { retailIncome: 1000, returnAmount: -200, refundAmount: -50, rebateAmount: 50, retailCost: 400 },
      '2026-09-02': { retailIncome: 500, retailCost: 200 },
    } } } });
  const first = clone(a.run("t4Row('dycreator','2026-09-01')"));
  assert.equal(first.shippingInsurance, 14);
  assert.equal(first.platformFee, 35);
  assert.equal(first.operating, 49);
  assert.equal(first.netProfit, 251);
  assert.ok(first._hard.includes('shippingInsurance'));
  assert.equal(a.run("t4Month('dycreator').shippingInsurance"), 24);
  assert.equal(a.run("t4Month('dycreator').netProfit"), 516);
  assert.equal(a.run("t4RangeData('dycreator','2026-09-01','2026-09-01').netProfit"), 251);
  assert.equal(a.run("t4DayData('dycreator','2026-09-03').shippingInsurance"), 0);
});

test('manual insurance including zero and imported actuals override the configured rate', async () => {
  const a = await app({ cfg: { dycreator: { shippingInsuranceRate: 0.02 } },
    periods: { '2026-09': { dycreator: {
      '2026-09-01': { retailIncome: 1000, shippingInsurance: 7, _fileParts: { daily: { shippingInsurance: 9 } } },
      '2026-09-02': { retailIncome: 1000, shippingInsurance: 0 },
      '2026-09-03': { retailIncome: 1000, _fileParts: { daily: { shippingInsurance: 9 } } },
      '2026-09-04': { shippingInsurance: -3 },
    } } } });
  assert.equal(a.run("t4Row('dycreator','2026-09-01').shippingInsurance"), 7);
  assert.equal(a.run("t4Row('dycreator','2026-09-02').shippingInsurance"), 0);
  assert.equal(a.run("t4Row('dycreator','2026-09-03').shippingInsurance"), 9);
  assert.equal(a.run("t4Row('dycreator','2026-09-03')._hard.includes('shippingInsurance')"), false);
  assert.equal(a.run("t4DayData('dycreator','2026-09-04').netProfit"), 3);
  assert.equal(a.run("t4DayHasData('dycreator','2026-09-04')"), true);
});

test('standard daily import recognizes insurance aliases and zero replaces a previous actual', async () => {
  const a = await app({ cfg: { dycreator: { shippingInsuranceRate: 0.02 } },
    periods: { '2026-09': { dycreator: { '2026-09-01': { retailIncome: 1000, _fileParts: { daily: { shippingInsurance: 15 } } } } } } });
  for (const heading of ['运费险', '运费险费用', '退换货运费险']) {
    assert.equal(a.run(`t4AutoMap(['日期',${JSON.stringify(heading)}],T4_FILE_DEFS.daily).shippingInsurance`), 1);
  }
  a.run("T4.editCh='dycreator'; T4.imp={mode:'channel',fileK:'daily',fileName:'运费险.csv',headRow:0,map:{date:0,shippingInsurance:1},rows:[['日期','运费险'],['2026-09-01','0'],['2026-09-02','5.50']]}");
  await a.run('t4ImpRun()');
  assert.equal(a.run("t4Row('dycreator','2026-09-01').shippingInsurance"), 0);
  assert.equal(a.run("t4DayData('dycreator','2026-09-02').netProfit"), -5.5);
  assert.equal(a.remote().periods['2026-09'].dycreator['2026-09-02']._fileParts.daily.shippingInsurance, 5.5);
});

test('insurance amounts are present in CSV, suite payload and browser workbook', async () => {
  const a = await app({ cfg: { dycreator: { shippingInsuranceRate: 0.0125 } },
    periods: { '2026-09': { dycreator: { '2026-09-01': { retailIncome: 1000 }, '2026-09-02': { shippingInsurance: 5 } } } } });
  const payload = clone(a.run('t4SuitePayload()'));
  assert.ok(payload.inputKeys.includes('shippingInsurance'));
  assert.ok(payload.operatingKeys.includes('shippingInsurance'));
  assert.equal(payload.dailyByCh.dycreator[0].shippingInsurance, 12.5);
  assert.equal(payload.dailyByCh.dycreator[1].has, true);
  assert.equal(payload.monthByCh.dycreator.shippingInsurance, 17.5);
  assert.equal(payload.monthByCh.dycreator.netProfit, 982.5);
  a.run("T4.dayCh='dycreator'; t4DayExport(); t4Export()");
  const insurance = a.downloads[0].rows.find(row => row[0] === '运费险');
  assert.deepEqual(insurance.slice(1, 3), ['12.50', '5.00']);
  const report = a.downloads[1].rows, column = report[0].indexOf('运费险');
  assert.ok(column > 0);
  assert.equal(report.find(row => row[1] === '抖音-BD达人成交店' && row[3] === '2026-09-01')[column], '12.50');
  a.run('window.XLSXWrite = XLSXWrite = {build:sheets=>sheets}; sheets=t4SuiteClientWorkbook(t4SuitePayload())');
  assert.equal(a.run("sheets.find(s=>s.name==='抖音-BD达人成交店').rows.find(r=>r[0]==='运费险')[1].n"), 17.5);
  assert.equal(a.run("sheets.find(s=>s.name==='抖音-BD达人成交店').rows.find(r=>r[0]==='运费险')[2].n"), 12.5);
});

test('unconfigured insurance leaves existing profit unchanged', async () => {
  const a = await app({ periods: { '2026-09': { dycreator: { '2026-09-01': { retailIncome: 1000, retailCost: 400, logistics: 100 } } } } });
  assert.equal(a.run("t4Row('dycreator','2026-09-01').shippingInsurance"), 0);
  assert.equal(a.run("t4Row('dycreator','2026-09-01').netProfit"), 500);
});
