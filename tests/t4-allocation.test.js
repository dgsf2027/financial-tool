const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(__dirname, '..', 't4-allocation.js');

test('the standalone browser module exposes a pure allocation analyzer', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '', context);
  assert.equal(typeof context.T4Allocation?.analyze, 'function');
});

const { analyze } = require('../t4-allocation');
const channels = { '天猫-澳乐旗舰店': 'tmall', '天猫别名': 'tmall', '京东-澳乐京东自营': 'jd' };
const resolve = name => channels[name] || null;
const expenseHeader = ['归属事业部', '渠道', '直接人工', '直接租金物业', '直接其他管理', '人力公摊', '房租水电公摊', '其他公摊'];

test('expense allocations map all six named columns and sum aliases without losing source rows', () => {
  const rows = [expenseHeader, ['大电商', '天猫-澳乐旗舰店', 100, 20, 3, 4, 5, 6], ['大电商', '天猫别名', 10, 2, 1, 2, 3, 4]];
  const before = JSON.stringify(rows);
  const result = analyze(rows, 'expense', resolve);
  assert.deepEqual(result.entries, [{ channel: 'tmall', values: { directLaborMonth: 110, directRentMonth: 22, directOtherMonth: 4, sharedLaborMonth: 6, sharedRentMonth: 8, sharedOtherMonth: 10 }, rows: [2, 3], sourceNames: ['天猫-澳乐旗舰店', '天猫别名'] }]);
  assert.deepEqual(result.totals, { directLaborMonth: 110, directRentMonth: 22, directOtherMonth: 4, sharedLaborMonth: 6, sharedRentMonth: 8, sharedOtherMonth: 10 });
  assert.equal(result.headerRow, 0);
  assert.equal(result.matchedRows, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(JSON.stringify(rows), before);
});

function payrollFixture() {
  const upper = Array(51).fill('');
  const lower = Array(51).fill('');
  upper[2] = '项目';
  lower[2] = '渠道';
  upper[45] = '店铺直接人工';
  upper[46] = '公摊人工';
  upper[48] = '社保（企业）';
  lower[48] = '直接';
  lower[49] = '间接';
  const row = Array(51).fill('');
  row[2] = '天猫-澳乐旗舰店';
  row[45] = 6062.40;
  row[46] = 114.86;
  row[47] = 999999; // Unlabeled calculated subtotal must never be added.
  row[48] = 821.61;
  row[49] = 74.11;
  row[50] = 999999;
  return [upper, lower, row];
}

test('payroll reads merged headers and adds enterprise social insurance to wage allocations', () => {
  const result = analyze(payrollFixture(), 'payroll', resolve);
  assert.equal(result.headerRow, 1);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 6884.01, sharedLaborMonth: 188.97 });
  assert.deepEqual(result.entries[0]?.rows, [3]);
  assert.equal(result.matchedRows, 1);
  assert.deepEqual(result.errors, []);
});

test('the lower header is consumed when the channel label is on the upper merged row', () => {
  const rows = [['渠道', '店铺直接人工', '公摊人工', '社保（企业）', ''], ['', '', '', '直接', '间接'], ['天猫-澳乐旗舰店', 90, 10, 9, 1]];
  const result = analyze(rows, 'payroll', resolve);
  assert.equal(result.headerRow, 1);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 99, sharedLaborMonth: 11 });
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.errors, []);
});

test('explicit labor totals take precedence over component columns and ignore their errors', () => {
  const rows = [['渠道', '直接人工', '人力公摊', '店铺直接人工', '公摊人工', '社保（企业）直接', '社保（企业）间接'], ['天猫-澳乐旗舰店', 150, 30, 100, '#N/A', 20, 5]];
  const result = analyze(rows, 'payroll', resolve);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 150, sharedLaborMonth: 30 });
  assert.deepEqual(result.errors, []);
});

test('direct totals are supported for expense and payroll without a business-unit column', () => {
  for (const kind of ['expense', 'payroll']) {
    const result = analyze([['渠道', '直接人工', '人力公摊'], ['天猫-澳乐旗舰店', 150, 30]], kind, resolve);
    assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 150, sharedLaborMonth: 30 });
  }
});

test('blank cells remain absent while zero is a real allocation and decimals are preserved', () => {
  const result = analyze([expenseHeader, ['大电商', '天猫-澳乐旗舰店', '', 0, null, '0', undefined, 0.123456]], 'expense', resolve);
  assert.deepEqual(result.entries[0]?.values, { directRentMonth: 0, sharedLaborMonth: 0, sharedOtherMonth: 0.123456 });
});

test('commas, currency symbols and negative parentheses parse as amounts', () => {
  const result = analyze([expenseHeader, ['', '天猫-澳乐旗舰店', '￥1,234.50', ' (2,000.25) ', '¥0', '（￥123.40）', '$1,000', '-12.30']], 'expense', resolve);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 1234.5, directRentMonth: -2000.25, directOtherMonth: 0, sharedLaborMonth: -123.4, sharedRentMonth: 1000, sharedOtherMonth: -12.3 });
  assert.deepEqual(result.errors, []);
});

test('invalid numeric values and Excel errors reject their whole row instead of silently becoming zero', () => {
  for (const invalid of ['#N/A', '#VALUE!', '#DIV/0!', '待确认', '1,2,3', '23元abc', Infinity, NaN, true]) {
    const result = analyze([expenseHeader, ['', '天猫-澳乐旗舰店', 100, invalid, 5]], 'expense', resolve);
    assert.equal(result.entries.length, 0, String(invalid));
    assert.equal(result.matchedRows, 0, String(invalid));
    assert.equal(result.errors.length, 1, String(invalid));
    assert.equal(result.errors[0].row, 2);
    assert.match(result.errors[0].message, /直接租金物业/);
  }
});

test('unknown names are reported with one-based source row numbers', () => {
  const result = analyze([expenseHeader, ['', '新增待匹配店铺', 100], ['', '天猫-澳乐旗舰店', 50]], 'expense', resolve);
  assert.deepEqual(result.unknown, [{ row: 2, name: '新增待匹配店铺' }]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.totals.directLaborMonth, 50);
  assert.equal(result.matchedRows, 1);
});

test('blank rows, totals and repeated column headings never become unknown channels', () => {
  const result = analyze([expenseHeader, [], ['合计', '', 100], ['', '小计', 100], ['', '大电商合计', 100], expenseHeader, ['', '天猫-澳乐旗舰店', 20]], 'expense', resolve);
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.totals.directLaborMonth, 20);
});

test('missing channels with populated allocations are errors rather than skipped values', () => {
  const result = analyze([expenseHeader, ['大电商', '', 100]], 'expense', resolve);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 2);
  assert.match(result.errors[0].message, /渠道/);
});

test('payroll aggregates repeated source channel lines without inventing allocations from gross salary', () => {
  const result = analyze([['渠道', '直接人工', '人力公摊', '实发工资'], ['天猫-澳乐旗舰店', 100, 10, 999], ['天猫-澳乐旗舰店', 200, 20, 888]], 'payroll', resolve);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 300, sharedLaborMonth: 30 });
  assert.deepEqual(result.entries[0]?.rows, [2, 3]);
  assert.deepEqual(result.entries[0]?.sourceNames, ['天猫-澳乐旗舰店']);
  assert.equal(result.matchedRows, 2);
});

test('unrecognized layouts produce an actionable error and never fall back to numeric column positions', () => {
  for (const rows of [[['渠道', '实发工资'], ['天猫-澳乐旗舰店', 999]], [['店名不明', '直接人工'], ['天猫-澳乐旗舰店', 999]], []]) {
    const result = analyze(rows, 'payroll', resolve);
    assert.equal(result.entries.length, 0);
    assert.ok(result.errors.length > 0);
    assert.equal(result.headerRow, -1);
  }
});

test('title rows and whitespace in headers do not prevent named-column detection', () => {
  const rows = [['2026年9月管理费用分摊表'], [], ['归属事业部', ' 渠道\n', '直接\n人工', '直接租金物业', '直接其他管理', '人力 公摊'], ['', ' 天猫-澳乐旗舰店 ', 80, 10, 3, 4]];
  const result = analyze(rows, 'expense', resolve);
  assert.equal(result.headerRow, 2);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 80, directRentMonth: 10, directOtherMonth: 3, sharedLaborMonth: 4 });
  assert.deepEqual(result.errors, []);
});

test('ambiguous duplicate total or component headers are rejected instead of double counted', () => {
  for (const header of [['渠道', '直接人工', '直接人工'], ['渠道', '店铺直接人工', '店铺直接人工']]) {
    const result = analyze([header, ['天猫-澳乐旗舰店', 100, 100]], 'payroll', resolve);
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].row, 1);
    assert.match(result.errors[0].message, /重复|歧义/);
  }
});

test('blank explicit totals remain blank and never fall back to component amounts', () => {
  const result = analyze([['渠道', '直接人工', '人力公摊', '店铺直接人工', '公摊人工'], ['天猫-澳乐旗舰店', '', 0, 100, 20]], 'payroll', resolve);
  assert.deepEqual(result.entries[0]?.values, { sharedLaborMonth: 0 });
});

test('only enterprise insurance enters payroll allocations, not employee insurance', () => {
  const rows = [['渠道', '店铺直接人工', '公摊人工', '社保（个人）', '', '社保（企业）', ''], ['', '', '', '直接', '间接', '直接', '间接'], ['天猫-澳乐旗舰店', 100, 10, 12, 3, 20, 4]];
  const result = analyze(rows, 'payroll', resolve);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 120, sharedLaborMonth: 14 });
  assert.deepEqual(result.errors, []);
});

test('amount aggregation cannot produce infinite allocations', () => {
  const result = analyze([['渠道', '直接人工'], ['天猫-澳乐旗舰店', 1e308], ['天猫-澳乐旗舰店', 1e308]], 'payroll', resolve);
  assert.ok(result.errors.length > 0);
  assert.equal(result.errors[0].row, 3);
  assert.ok(result.entries.every(entry => Object.values(entry.values).every(Number.isFinite)));
  assert.ok(Object.values(result.totals).every(Number.isFinite));
});

test('fractional-cent expense values are retained when aggregating channels', () => {
  const result = analyze([['渠道', '直接人工'], ['天猫-澳乐旗舰店', 6884.0065], ['天猫别名', 0.0035]], 'expense', resolve);
  assert.deepEqual(result.entries[0]?.values, { directLaborMonth: 6884.01 });
});
