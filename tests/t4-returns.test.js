const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function app() {
  const storage = new Map(), controls = [{ disabled: false }, { disabled: false }];
  const ctx = vm.createContext({ console, Date, Set, Map, Intl, URL, Blob, __controls: controls,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    document: { addEventListener() {}, querySelectorAll: () => controls, getElementById: () => null },
    window: {}, S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
  });
  for (const file of ['t4.js', 't4-returns.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), ctx);
  const run = code => vm.runInContext(code, ctx);
  run("T4.period='2026-09'; t4Load(); T4_SERVER_READY=true; T4.periodLocks={'2026-09':false}; T4.cfg.tm_orange={platformFeeRate:0.05};");
  return run;
}
const json = (run, code) => JSON.parse(run(`JSON.stringify(${code})`));

test('rebate entry has one fixed income deduction, accepting positive input and explicit zero', () => {
  const run = app();
  assert.deepEqual(json(run, "t4ReturnValues({channel:'tm_orange',date:'2026-09-01',amount:'50'})"), { rebateAmount: -50 });
  assert.deepEqual(json(run, "t4ReturnValues({channel:'tm_orange',date:'2026-09-01',amount:0})"), { rebateAmount: 0 });
  // A stale draft type must never restore the old refund/receipt entry paths.
  for (const type of ['refund', 'rebate', 'receipt']) {
    assert.deepEqual(json(run, `t4ReturnValues({type:'${type}',channel:'tm_orange',date:'2026-09-01',amount:'50'})`), { rebateAmount: -50 });
  }
});

test('invalid dates, channels, blank or negative amounts cannot be saved', () => {
  const run = app();
  for (const override of ["date:'2026-09-31'", "date:'2026-08-01'", "channel:'tmall'", "channel:'constructor'", "amount:''", "amount:'  '", "amount:-5", "amount:'NaN'", "amount:Infinity"]) {
    assert.throws(() => run(`t4ReturnValues({channel:'tm_orange',date:'2026-09-01',amount:'10',${override}})`));
  }
});

test('refund and rebate independently reduce net sales, platform fee, profit and suite totals', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{retailIncome:1000,retailCost:400,refundAmount:-100}}; t4Save=async()=>({ok:true});");
  await run("t4SaveReturn({channel:'tm_orange',date:'2026-09-01',amount:'50'})");
  for (const expression of ["t4Row('tm_orange','2026-09-01')", "t4Month('tm_orange')"]) {
    const row = json(run, expression);
    assert.equal(row.refundAmount, -100); assert.equal(row.rebateAmount, -50);
    assert.equal(row.salesIncome, 850); assert.equal(row.platformFee, 42.5); assert.equal(row.netProfit, 407.5);
  }
  run("T4.projFilter='orange'; T4.viewFrom='2026-09-01'; T4.viewTo='2026-09-01';");
  const payload = json(run, 't4SuitePayload({useViewRange:true})');
  assert.ok(payload.metrics.some(m => m.k === 'rebateAmount'));
  for (const row of [payload.dailyByCh.tm_orange[0], payload.monthByCh.tm_orange]) {
    assert.equal(row.rebateAmount, -50); assert.equal(row.refundAmount, -100);
    assert.equal(row.salesIncome, 850); assert.equal(row.platformFee, 42.5); assert.equal(row.netProfit, 407.5);
  }
});

test('zero overwrites only rebate amount and preserves legacy rebate income and receipt semantics', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{retailIncome:1000,retailCost:400,rebateAmount:-30,rebateIncome:20,salesReceipt:800,refundAmount:-100}}; t4Save=async()=>({ok:true});");
  await run("t4SaveReturn({channel:'tm_orange',date:'2026-09-01',amount:0})");
  const raw = json(run, "T4.data.tm_orange['2026-09-01']");
  assert.equal(raw.rebateAmount, 0); assert.equal(raw.rebateIncome, 20);
  assert.equal(raw.salesReceipt, 800); assert.equal(raw.refundAmount, -100);
  assert.deepEqual(raw._manualFields, { rebateAmount: true });
  const row = json(run, "t4Row('tm_orange','2026-09-01')");
  assert.equal(row.salesIncome, 900); assert.equal(row.platformFee, 45); assert.equal(row.netProfit, 475);
});

test('manual rebate into a legacy file leaves all prior fields in their original export source', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{retailIncome:1000,retailCost:400,refundAmount:-100,rebateIncome:20,salesReceipt:800,_src:'file'}}; t4Save=async()=>({ok:true});");
  await run("t4SaveReturn({channel:'tm_orange',date:'2026-09-01',amount:50})");
  run("T4.projFilter='orange'; T4.viewFrom='2026-09-01'; T4.viewTo='2026-09-01';");
  const rows = json(run, 't4RawExportRows().rows');
  const fields = json(run, 'T4_INPUTS');
  const column = key => rows[0].indexOf(fields.find(f => f.k === key).n);
  const source = rows[0].indexOf('来源代码');
  const legacy = rows.find(r => r[source] === 'legacy-file'), manual = rows.find(r => r[source] === 'manual');
  assert.equal(rows.length, 3); assert.ok(legacy); assert.ok(manual);
  for (const [key, value] of Object.entries({retailIncome:1000,retailCost:400,refundAmount:-100,rebateIncome:20,salesReceipt:800})) {
    assert.equal(legacy[column(key)], value); assert.equal(manual[column(key)], '');
  }
  assert.equal(legacy[column('rebateAmount')], ''); assert.equal(manual[column('rebateAmount')], -50);
});

test('a failed rebate save restores data and local storage, retains draft, and permits retry', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{rebateAmount:-30,refundAmount:-100}}; T4.returnEntry={period:T4.period,channel:'tm_orange',date:'2026-09-01',amount:'90'}; localStorage.setItem(T4_KEY, 'saved-before-request'); t4Save=async()=>{localStorage.setItem(T4_KEY,'failed-draft'); throw new Error('field conflict');};");
  const before = json(run, 'T4.data');
  await assert.rejects(run('t4SaveReturn()'), /field conflict/);
  assert.deepEqual(json(run, 'T4.data'), before);
  assert.equal(run('localStorage.getItem(T4_KEY)'), 'saved-before-request');
  assert.equal(run('T4.returnEntry.amount'), '90');
  assert.equal(run('__controls.every(c => !c.disabled)'), true);
  run('t4Save=async()=>({ok:true})');
  await run('t4SaveReturn()');
  assert.equal(run("T4.data.tm_orange['2026-09-01'].rebateAmount"), -90);
  assert.equal(run("T4.data.tm_orange['2026-09-01'].refundAmount"), -100);
});

test('a locked period or invalid draft rejects before any mutation or shared write', async () => {
  const run = app();
  run("T4.data.tm_orange={'2026-09-01':{rebateAmount:-30}}; T4.returnEntry={period:T4.period,channel:'tm_orange',date:'2026-09-01',amount:'90'}; T4.periodLocks['2026-09']=true; globalThis.writes=0; t4Save=async()=>{writes++};");
  const before = json(run, 'T4.data');
  await assert.rejects(run('t4SaveReturn()'), /锁定/);
  assert.deepEqual(json(run, 'T4.data'), before); assert.equal(run('writes'), 0);
  assert.equal(run('T4.returnEntry.amount'), '90');
  run("T4.periodLocks['2026-09']=false; T4.returnEntry.amount='-1';");
  await assert.rejects(run('t4SaveReturn()'));
  assert.deepEqual(json(run, 'T4.data'), before); assert.equal(run('writes'), 0);
});
