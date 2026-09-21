const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const ROOT = require('node:path').join(__dirname, '..');
const plain = v => JSON.parse(JSON.stringify(v));
const helpers = fs.readFileSync(`${ROOT}/app.js`, 'utf8');

function context(extra = {}) {
  const storage = new Map();
  const c = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {} }, textContent: '' }) },
    window: { addEventListener() {}, removeEventListener() {}, scrollTo() {} },
    S: {}, toast() {}, go() {}, confirm() { return false; }, H: String,
    pill() { return ''; }, table() { return ''; }, head() { return ''; }, card() { return ''; }, cardp() { return ''; },
    kpis() { return ''; }, money: String, navigator: {}, ...extra,
  });
  return { c, storage };
}

function loadApp() {
  const out = context();
  vm.runInContext(helpers, out.c);
  out.c.toast = () => {}; out.c.go = () => {};
  return out;
}

function loadT3() {
  const out = loadApp();
  vm.runInContext(fs.readFileSync(`${ROOT}/t3.js`, 'utf8') + '; globalThis.__review = { t3Num, t3Run, T3 };', out.c);
  return out;
}

function loadT1() {
  const out = loadApp();
  vm.runInContext(fs.readFileSync(`${ROOT}/t1.js`, 'utf8') + '; globalThis.__review = { t1FindAccByNo, t1SaveDay, t1SaveAcc, t1SaveCfg };', out.c);
  return out;
}

test('T2 chooses the latest timestamp when same-day rows are descending', () => {
  const { c } = loadApp();
  vm.runInContext(`
    T2.rows = [['日期', '余额'], ['2026-09-01 10:00:00', '200'], ['2026-09-01 09:00:00', '100']];
    T2.headRow = 0; T2.map = { date: 0, bal: 1 };
  `, c);
  assert.deepEqual(plain(vm.runInContext('t2ClosingBal()', c)), { date: '2026-09-01', val: 200, asc: false });
});

test('T2 does not auto-select a closing balance when same-day order is unknowable', () => {
  const { c } = loadApp();
  vm.runInContext(`
    T2.rows = [['日期', '余额'], ['2026-09-01', '200'], ['2026-09-01', '100']];
    T2.headRow = 0; T2.map = { date: 0, bal: 1 };
  `, c);
  assert.deepEqual(plain(vm.runInContext('t2ClosingBal()', c)), { ambiguous: true, date: '2026-09-01' });
});

test('T1 account matching reports ambiguity instead of returning the first masked account', () => {
  const { c } = loadT1();
  vm.runInContext(`
    T1_ACC = [
      { id: 'B1', ent: '甲', name: '账户一', no: '621700001234' , on: 1 },
      { id: 'B2', ent: '乙', name: '账户二', no: '621799991234' , on: 1 },
    ];
  `, c);
  assert.deepEqual(plain(vm.runInContext('t1FindAccByNo("6217****1234")', c)), { ambiguous: true, candidates: ['B1', 'B2'] });
});

test('T3 parses accounting parentheses and rejects invalid numeric cells', () => {
  const { c } = loadT3();
  assert.equal(vm.runInContext('t3Num("(100)")', c), -100);
  assert.equal(vm.runInContext('t3Num("#VALUE!")', c), null);
  vm.runInContext(`
    T3.ours = { rows: [['key', 'amt'], ['A', '(100)']], headRow: 0, map: { key1: 0, amt: 1 } };
    T3.theirs = { rows: [['key', 'amt'], ['A', '0']], headRow: 0, map: { key1: 0, amt: 1 } };
    T3.keyCount = 1; T3.mode = 'row'; t3Run();
  `, c);
  assert.equal(vm.runInContext('T3.result.same.length', c), 0);
  assert.equal(vm.runInContext('T3.result.amtDiff.length', c), 1);
});

test('T1 save reports localStorage failures to its caller', () => {
  const out = loadT1();
  out.c.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(vm.runInContext('t1SaveDay({"2026-09-01":{"B1":1}})', out.c), false);
  assert.equal(vm.runInContext('t1SaveAcc([])', out.c), false);
  assert.equal(vm.runInContext('t1SaveCfg({})', out.c), false);
});
