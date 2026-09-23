const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function app() {
  const storage = new Map();
  const ctx = vm.createContext({ console, Date, Set, Map, Intl, URL, Blob,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    window: {}, S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
  });
  for (const file of ['t4.js', 't4-returns.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), ctx);
  const run = code => vm.runInContext(code, ctx);
  run("T4.period='2026-09'; t4Load(); T4_SERVER_READY=true; T4.periodLocks={'2026-09':false}; T4.cfg.tm_orange={platformFeeRate:0.05};");
  return run;
}
test('unclassified, invalid-date, invalid-scope and negative returns cannot be saved', () => {
  const run = app();
  for (const override of ["type:''", "type:'constructor'", "date:'2026-09-31'", "date:'2026-08-01'", "channel:'tmall'", "amount:''", "amount:-5", "amount:'NaN'"]) {
    assert.throws(() => run(`t4ReturnValues({type:'rebate',channel:'tm_orange',date:'2026-09-01',amount:'10',${override}})`));
  }
});
test('refunds, rebates, and cash receipts have independent explicit effects', () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{retailIncome:1000}};");
  run("Object.assign(T4.data.tm_orange['2026-09-01'], t4ReturnValues({type:'refund',channel:'tm_orange',date:'2026-09-01',amount:'100'}));");
  assert.equal(run("t4Row('tm_orange','2026-09-01').salesIncome"), 900);
  assert.equal(run("t4Row('tm_orange','2026-09-01').platformFee"), 45);
  run("Object.assign(T4.data.tm_orange['2026-09-01'], t4ReturnValues({type:'rebate',channel:'tm_orange',date:'2026-09-01',amount:'20'}));");
  assert.equal(run("t4Row('tm_orange','2026-09-01').netProfit"), 875);
  run("Object.assign(T4.data.tm_orange['2026-09-01'], t4ReturnValues({type:'receipt',channel:'tm_orange',date:'2026-09-01',amount:'800'}));");
  assert.equal(run("t4Row('tm_orange','2026-09-01').netProfit"), 875);
  assert.equal(run("t4Row('tm_orange','2026-09-01').salesReceipt"), 800);
  assert.equal(run("t4Month('tm_orange').rebateIncome"), 20);
});
test('zero overwrites the selected return type while other values remain', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{rebateIncome:30,salesReceipt:80,refundAmount:-5}}; t4Save=async()=>({ok:true});");
  await run("t4SaveReturn({type:'rebate',channel:'tm_orange',date:'2026-09-01',amount:0})");
  assert.equal(run("T4.data.tm_orange['2026-09-01'].rebateIncome"), 0);
  assert.equal(run("T4.data.tm_orange['2026-09-01'].salesReceipt"), 80);
  assert.equal(run("T4.data.tm_orange['2026-09-01'].refundAmount"), -5);
});
test('a failed return save rolls data back and keeps the entry draft', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{rebateIncome:30}}; T4.returnEntry={period:T4.period,type:'rebate',channel:'tm_orange',date:'2026-09-01',amount:'90'}; t4Save=async()=>{ throw new Error('field conflict'); };");
  await assert.rejects(run('t4SaveReturn()'), /field conflict/);
  assert.equal(run("T4.data.tm_orange['2026-09-01'].rebateIncome"), 30);
  assert.equal(run('T4.returnEntry.amount'), '90');
  run("T4.periodLocks['2026-09']=true;");
  await assert.rejects(run('t4SaveReturn()'), /锁定/);
});
