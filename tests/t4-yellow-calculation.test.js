const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function app() {
  const context = vm.createContext({ console, Date, Set, Map, Intl, URL, Blob,
    localStorage: { getItem: () => null, setItem() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    window: {}, S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  const run = source => vm.runInContext(source, context);
  run("T4.period='2026-09'; t4Load(); T4.cfg.tmall={platformFeeRate:0.05,logisticsRate:0.1};");
  return run;
}

test('current month defaults to today, while an explicit month-end selection remains available', () => {
  const run = app();
  run("T4.period='2026-09'; t4DefaultRangeEnd=()=> '2026-09-23'; T4.viewFrom=''; T4.viewTo='';");
  assert.equal(run('t4ViewRange().n'), 23);
  assert.equal(run("t4RangeData('tmall',t4ViewRange().from,t4ViewRange().to).directLabor"), 0);
  run("T4.cfg.tmall.directLaborMonth=3000;");
  assert.equal(run("t4RangeData('tmall',t4ViewRange().from,t4ViewRange().to).directLabor"), 2300);
  run("T4.viewFrom='2026-09-01'; T4.viewTo='2026-09-30';");
  assert.equal(run("t4RangeData('tmall',t4ViewRange().from,t4ViewRange().to).directLabor"), 3000);
});

test('default range uses the selected month length and the local calendar date', () => {
  const run = app();
  assert.equal(run("t4DefaultRangeEnd(new Date(2026,8,23,0,10))"), '2026-09-23');
  run("T4.period='2026-02';");
  assert.equal(run("t4DefaultRangeEnd(new Date(2026,8,23))"), '2026-02-28');
  run("T4.period='2028-02';");
  assert.equal(run("t4DefaultRangeEnd(new Date(2026,8,23))"), '2028-02-29');
});

test('platform commission uses sales after returns/refunds, other rates retain retail base', () => {
  const run = app();
  run("T4.data.tmall={'2026-09-01':{retailIncome:1000,returnAmount:-100,refundAmount:-50}};");
  assert.equal(run("t4Row('tmall','2026-09-01').platformFee"), 42.5);
  assert.equal(run("t4Row('tmall','2026-09-01').logistics"), 100);
});

test('explicit platform commission including zero overrides the sales-based rule', () => {
  const run = app();
  for (const fee of [0, 19]) {
    run(`T4.data.tmall={'2026-09-01':{retailIncome:1000,returnAmount:-200,platformFee:${fee}}}`);
    assert.equal(run("t4Row('tmall','2026-09-01').platformFee"), fee);
  }
  run("T4.data.tmall={'2026-09-01':{_fileParts:{daily:{retailIncome:1000,platformFee:12}}}};");
  assert.equal(run("t4Row('tmall','2026-09-01').platformFee"), 12);
});

test('zero or negative sales retain the signed commission calculation', () => {
  const run = app();
  for (const [refund, fee] of [[-1000, 0], [-1200, -10]]) {
    run(`T4.data.tmall={'2026-09-01':{retailIncome:1000,refundAmount:${refund}}}`);
    assert.equal(run("t4Row('tmall','2026-09-01').platformFee"), fee);
  }
});

test('derived return ratios are included before platform commission', () => {
  const run = app();
  run("T4.cfg.tmall.returnRate=-0.2; T4.data.tmall={'2026-09-01':{retailIncome:1000}}");
  assert.equal(run("t4Row('tmall','2026-09-01').platformFee"), 40);
});

test('daily and selected-period allocations exclude unselected future days and keep overrides', () => {
  const run = app();
  run("T4.cfg.tmall={directLaborMonth:3000}; T4.data.tmall={'2026-09-01':{retailIncome:100, directLabor:150}};");
  assert.equal(run("t4DayData('tmall','2026-09-02').directLabor"), 100);
  assert.equal(run("t4RangeData('tmall','2026-09-01','2026-09-10').directLabor"), 1050);
  assert.equal(run("t4Month('tmall').directLabor"), 3050);
});
