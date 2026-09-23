const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

function app() {
  const tables = [], downloads = [], handlers = {}, navigations = [];
  const context = vm.createContext({ console, Date, Set, Map, Intl, URL, Blob,
    localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener: (type, fn) => { handlers[type] = fn; }, querySelectorAll: () => [], getElementById: () => null },
    window: {}, S: {}, go: route => navigations.push(route), toast() {}, H: String, pill: String, money: String,
    head: (title, sub, meta, buttons) => title + sub + buttons,
    table: (cols, rows) => { tables.push(clone({ cols, rows })); return '<div class="tw">table</div>'; },
    card: (title, body) => title + body, toCSV: clone,
    download: (name, rows) => downloads.push({ name, rows }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  run("T4.period='2026-09'; t4Load(); t4Load=()=>{}; t4DefaultRangeEnd=()=> '2026-09-23'; T4.dayCh='tmall'; T4.cfg.tmall={directLaborMonth:3000}; T4.data.tmall={'2026-09-01':{retailIncome:100,directLabor:250},'2026-09-24':{retailIncome:9999}};");
  return { run, tables, downloads, handlers, navigations };
}

test('daily detail defaults to today and freezes the metric column without charging future allocation days', () => {
  const a = app(), html = a.run("S['t4-chday']()");
  assert.match(html, /t4-pinned-one/);
  assert.match(html, /data-view="chday"/);
  const { cols, rows } = a.tables.at(-1);
  assert.equal(cols.length, 26);
  assert.equal(cols.at(-2).t, '23日');
  const labor = rows.find(row => row[0].includes('直接人工'));
  assert.equal(labor[1], '<b>2450</b>');
  assert.equal(labor[2], '250');
  assert.equal(labor[3], '100');
  assert.equal(labor.at(-1), labor[1]);
  const sales = rows.find(row => row[0] === '<b>销售收入</b>');
  assert.equal(sales[1], '<b>100</b>');
});

test('daily CSV follows the visible selected dates and full-month selection remains explicit', () => {
  const a = app();
  a.run("T4.viewFrom='2026-09-05'; T4.viewTo='2026-09-07'; t4DayExport()");
  const report = a.downloads[0];
  assert.deepEqual(report.rows[0], ['损益项目', '2026-09-05', '2026-09-06', '2026-09-07', '合计']);
  assert.deepEqual(report.rows.find(row => row[0] === '直接人工'), ['直接人工', '100.00', '100.00', '100.00', '300.00']);
  assert.match(report.name, /2026-09-05_2026-09-07\.csv$/);
  a.run("T4.viewFrom='2026-09-01'; T4.viewTo='2026-09-30'; t4DayExport()");
  assert.equal(a.downloads[1].rows[0].length, 32);
  assert.equal(a.downloads[1].rows.find(row => row[0] === '直接人工').at(-1), '3150.00');
});

test('changing a daily range stays on daily detail and is shared with the summary view', () => {
  const a = app();
  a.handlers.change({ target: { id: 't4ViewTo', value: '2026-09-10', dataset: { view: 'chday' } } });
  assert.equal(a.run('T4.viewTo'), '2026-09-10');
  assert.equal(a.navigations.at(-1), 't4-chday');
  assert.equal(a.run('t4ViewRange().n'), 10);
});

test('the official orange Tmall name retains the old import name and respects user catalog names', () => {
  const a = app();
  assert.equal(a.run('T4_CHM.tm_orange.n'), '天猫-橘农滋补养生旗舰店');
  assert.equal(a.run("t4ResolveChannel('天猫-橘农旗舰店')"), 'tm_orange');
  assert.equal(a.run("t4ResolveChannel('天猫-橘农滋补养生旗舰店')"), 'tm_orange');
  a.run("t4SaveChOverrides([{id:'tm_orange',n:'用户维护的橘农渠道'}]); t4RebuildChannels()");
  assert.equal(a.run('T4_CHM.tm_orange.n'), '用户维护的橘农渠道');
  assert.equal(a.run("t4ResolveChannel('天猫-橘农旗舰店')"), 'tm_orange');
  assert.equal(a.run("t4ResolveChannel('天猫-橘农滋补养生旗舰店')"), 'tm_orange');
});
