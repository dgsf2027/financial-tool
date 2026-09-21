const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));

// Execute the shipped browser modules and their real event handlers with in-memory I/O.
function browserModule(file) {
  const storage = new Map(), listeners = {}, fields = {}, messages = [], downloads = [];
  let vouchers = [], sequence = 0, importRows = [];
  const c = vm.createContext({
    console, Date, Map, Set, CUR_ENT: 'test', CURS: '', S: {}, IV: { month: '2026-09' },
    AC: { from: '2026-09-01', to: '2026-09-30', inc: true },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    document: { addEventListener: (type, listener) => (listeners[type] ||= []).push(listener) },
    $: id => fields[id], uid: () => `new-${++sequence}`, confirm: () => true,
    toast: message => messages.push(message), go() {},
    ym: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    normDate: value => String(value || '').trim(), numOf: value => Number(String(value ?? '').replace(/[,￥¥$]/g, '')) || 0,
    XLSXLite: { readTable: async () => importRows, findHeaderRow: () => 0 },
    H: value => String(value ?? ''), money: value => Number(value).toFixed(2),
    head: () => '', kpis: rows => JSON.stringify(rows), card: (title, content) => content,
    cardp: (title, content) => content, table: (columns, rows) => JSON.stringify(rows), pill: String,
    entName: () => '测试主体', acctName: code => code, ACCOUNTS: () => [['5602', '管理费用']],
    toCSV: rows => plain(rows), download: (name, rows) => downloads.push({ name, rows }),
    vchLoad: () => plain(vouchers), vchSave: (entity, rows) => { vouchers = plain(rows); },
    vDate: voucher => voucher.date,
    vchIn: (entity, from, to, inc) => plain(vouchers.filter(v => (inc || v.posted) && v.date >= from && v.date <= to)),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c, { filename: file });
  return {
    c, messages, downloads, fields,
    run: code => vm.runInContext(code, c),
    seed: (key, value) => storage.set(key, JSON.stringify(value)),
    saved: key => JSON.parse(storage.get(key) || 'null'),
    rows: rows => { importRows = rows; },
    vouchers: value => { if (value) vouchers = plain(value); return plain(vouchers); },
    click: dataset => {
      const target = { dataset, closest: selector => {
        const match = selector.match(/^\[data-([a-z]+)\]$/);
        return match && Object.hasOwn(dataset, match[1]) ? target : null;
      } };
      (listeners.click || []).forEach(listener => listener({ target }));
    },
  };
}

const invoice = { id: 'old-invoice', no: '001', code: 'A', date: '2026-09-01', month: '2026-09', who: '供应商', amt: 100, tax: 13, total: 113, state: '正常', kind: '专用发票', src: 'old.xlsx' };

test('invoice re-import updates the same code/number and preserves omitted metadata and ID', async () => {
  const b = browserModule('inv.js');
  b.seed('fsc_iv_in_test_v1', [invoice]);
  b.rows([['发票号码', '开票日期', '金额', '税额'], ['001', '2026-09-02', 200, 26]]);
  await b.c.ivImport({ name: 'update.xlsx' }, 'in');
  const saved = b.saved('fsc_iv_in_test_v1');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].amt, 200);
  assert.equal(saved[0].date, '2026-09-02');
  assert.equal(saved[0].id, invoice.id);
  for (const key of ['code', 'who', 'kind', 'state']) assert.equal(saved[0][key], invoice[key]);
  assert.equal(saved[0].total, 226);
});

test('invoice status-only re-import voids earlier normal invoice and removes its tax contribution', async () => {
  const b = browserModule('inv.js');
  b.seed('fsc_iv_in_test_v1', [invoice]);
  b.rows([['发票号码', '发票状态'], ['001', '作废']]);
  await b.c.ivImport({ name: 'void.xlsx' }, 'in');
  assert.equal(b.c.ivSumPool('2026-09', '2026-09').inTax, 0);
  assert.match(b.messages.at(-1), /作废/);
});

test('invoice number collisions with distinct invoice codes remain distinct', async () => {
  const b = browserModule('inv.js');
  b.seed('fsc_iv_in_test_v1', [invoice]);
  b.rows([['发票号码', '发票代码', '开票日期', '金额', '税额'], ['001', 'B', '2026-09-03', 300, 39]]);
  await b.c.ivImport({ name: 'other.xlsx' }, 'in');
  assert.equal(b.saved('fsc_iv_in_test_v1').length, 2);
  assert.equal(b.c.ivSumPool('2026-09', '2026-09').inTax, 52);
});

test('ambiguous invoice update without code reports a row error and changes neither invoice', async () => {
  const b = browserModule('inv.js');
  const before = [invoice, { ...invoice, id: 'other', code: 'B' }];
  b.seed('fsc_iv_in_test_v1', before);
  b.rows([['发票号码', '开票日期', '金额', '税额'], ['001', '2026-09-03', 300, 39]]);
  await b.c.ivImport({ name: 'ambiguous.xlsx' }, 'in');
  assert.deepEqual(b.saved('fsc_iv_in_test_v1'), before);
  assert.match(b.messages.at(-1), /第\s*2\s*行.*(代码|歧义|同号)/);
});

test('previously persisted void invoices are excluded from every VAT pool total', () => {
  const b = browserModule('inv.js');
  b.seed('fsc_iv_in_test_v1', [{ ...invoice, state: '作废' }]);
  b.seed('fsc_iv_out_test_v1', [{ ...invoice, state: '作废' }]);
  const total = b.c.ivSumPool('2026-09', '2026-09');
  assert.equal(total.inAmt, 0);
  assert.equal(total.inCnt, 0);
  assert.equal(total.spNet, 0);
  assert.equal(total.outCnt, 0);
});

test('AP export keeps the negative unsettled amount shown for over-reconciliation', () => {
  const b = browserModule('rec.js');
  b.seed('fsc_rec_ap_test_v1', [{ id: 'ap1', no: 'AP1', name: '供应商', date: '2026-09-01', open: 0, ap: 100, pay: 0, offset: 0 }]);
  b.seed('fsc_rec_hx_test_v1', [{ id: 'hx1', kind: 'ap', docId: 'ap1', amt: 150 }]);
  assert.match(b.c.S['p-rec-ap'](), /超核 50\.00/);
  b.click({ act: 'apExp' });
  const { rows } = b.downloads[0];
  assert.equal(rows[1][rows[0].indexOf('未结算金额')], '-50.00');
});

const asset = { id: 'asset1', no: 'FA001', name: '电脑', cat: '电子设备', dept: '财务', useDate: '2026-01-01', cost: 12000, res: 0, life: 12, expAcct: '5602', initDep: 0, status: 'use' };
function assetForm(b, changes = {}) {
  const a = { ...asset, ...changes };
  const values = { faName: a.name, faCat: a.cat, faDept: a.dept, faUse: a.useDate, faCost: a.cost, faRes: a.res, faLife: a.life / 12, faExp: a.expAcct, faInit: a.initDep };
  Object.entries(values).forEach(([key, value]) => { b.fields[key] = { value: String(value) }; });
  b.run('FA.edit = "asset1"; FA.month = "2026-09";');
}
const depVoucher = { id: '__fa_dep_2026-08__', period: '2026-08', date: '2026-08-31', src: '折旧计提', posted: 1, lines: [{ acct: '5602', dr: 1000, cr: 0 }, { acct: '1602', dr: 0, cr: 1000 }] };

for (const [field, value] of Object.entries({ cost: 24000, useDate: '2026-02-01', res: 5, life: 24, expAcct: '5601', initDep: 500 })) {
  test(`FA blocks changing ${field} after the asset contributed to a generated depreciation voucher`, () => {
    const b = browserModule('fa.js');
    b.seed('fsc_fa_test_v1', [asset]);
    b.vouchers([depVoucher]);
    assetForm(b, { [field]: value });
    b.click({ act: 'faSave' });
    assert.deepEqual(b.saved('fsc_fa_test_v1'), [asset]);
    assert.deepEqual(b.vouchers(), [depVoucher]);
    assert.match(b.messages.at(-1), /折旧.*(不能|不可|禁止|不允许)|不能.*折旧/);
  });
}

test('FA allows nonfinancial metadata edits after depreciation generation', () => {
  const b = browserModule('fa.js');
  b.seed('fsc_fa_test_v1', [asset]);
  b.vouchers([depVoucher]);
  assetForm(b, { name: '办公电脑', cat: '其他设备', dept: '技术' });
  b.click({ act: 'faSave' });
  assert.equal(b.saved('fsc_fa_test_v1')[0].name, '办公电脑');
  assert.equal(b.saved('fsc_fa_test_v1')[0].dept, '技术');
  assert.deepEqual(b.vouchers(), [depVoucher]);
});

test('FA writes contributing asset IDs and locks only included assets in new vouchers', () => {
  const b = browserModule('fa.js');
  b.seed('fsc_fa_test_v1', [asset, { ...asset, id: 'future', useDate: '2026-10-01' }]);
  b.run('FA.month = "2026-09";');
  b.click({ act: 'faDepVch' });
  const voucher = b.vouchers()[0];
  assert.deepEqual(voucher.faAssetIds, ['asset1']);
  assert.equal(voucher.posted, 0);
  b.seed('fsc_fa_test_v1', [{ ...asset, id: 'asset1' }]);
  b.vouchers([{ ...depVoucher, faAssetIds: ['different-asset'] }]);
  assetForm(b, { cost: 24000 });
  b.click({ act: 'faSave' });
  assert.equal(b.saved('fsc_fa_test_v1')[0].cost, 24000);
});

test('FA blocks legacy aggregate voucher edits that would retroactively add depreciation', () => {
  const b = browserModule('fa.js');
  const laterAsset = { ...asset, useDate: '2026-09-01' };
  b.seed('fsc_fa_test_v1', [laterAsset]);
  b.vouchers([depVoucher]);
  assetForm(b, { useDate: '2026-07-01' });
  b.click({ act: 'faSave' });
  assert.deepEqual(b.saved('fsc_fa_test_v1'), [laterAsset]);
});

test('FA permits editing an asset outside all legacy voucher depreciation months', () => {
  const b = browserModule('fa.js');
  b.seed('fsc_fa_test_v1', [{ ...asset, useDate: '2026-09-01' }]);
  b.vouchers([depVoucher]);
  assetForm(b, { useDate: '2026-09-01', cost: 24000 });
  b.click({ act: 'faSave' });
  assert.equal(b.saved('fsc_fa_test_v1')[0].cost, 24000);
});

test('FA refuses to overwrite a posted monthly depreciation voucher', () => {
  const b = browserModule('fa.js');
  b.seed('fsc_fa_test_v1', [asset]);
  b.vouchers([depVoucher]);
  b.run('FA.month = "2026-08";');
  b.click({ act: 'faDepVch' });
  assert.deepEqual(b.vouchers(), [depVoucher]);
  assert.match(b.messages.at(-1), /已过账/);
});

test('payroll matches certificate first and keeps same-name employees with different IDs separate', async () => {
  const b = browserModule('pay.js');
  b.seed('fsc_pay_emp_test_v1', [{ id: 'employee1', name: '张三', idno: 'ID001', on: 1 }]);
  b.rows([['姓名', '身份证号', '应发工资'], ['张三', 'ID002', 7000], ['张三', 'ID001', 6000]]);
  await b.c.payImport({ name: 'salary.xlsx' });
  const emps = b.saved('fsc_pay_emp_test_v1'), sal = b.saved('fsc_pay_sal_test_2026-09_v1');
  assert.equal(emps.length, 2);
  assert.equal(sal.employee1.gross, 6000);
  assert.equal(sal[emps.find(e => e.idno === 'ID002').id].gross, 7000);
});

test('payroll uses matching certificate when the imported name differs', async () => {
  const b = browserModule('pay.js');
  b.seed('fsc_pay_emp_test_v1', [{ id: 'employee1', name: '旧姓名', idno: 'ID001X', on: 1 }]);
  b.rows([['姓名', '身份证号', '应发工资'], ['新姓名', ' id001x ', 6000]]);
  await b.c.payImport({ name: 'salary.xlsx' });
  assert.equal(b.saved('fsc_pay_emp_test_v1').length, 1);
  assert.equal(b.saved('fsc_pay_sal_test_2026-09_v1').employee1.gross, 6000);
});

test('payroll missing certificate with ambiguous name reports source row and preserves old salaries', async () => {
  const b = browserModule('pay.js');
  const emps = [{ id: 'employee1', name: '张三', idno: 'ID001', on: 1 }, { id: 'employee2', name: '张三', idno: 'ID002', on: 1 }];
  const sal = { employee1: { gross: 6000 }, employee2: { gross: 7000 } };
  b.seed('fsc_pay_emp_test_v1', emps);
  b.seed('fsc_pay_sal_test_2026-09_v1', sal);
  b.rows([['姓名', '应发工资'], ['张三', 9999], ['李四', 8000]]);
  await b.c.payImport({ name: 'ambiguous.xlsx' });
  const saved = b.saved('fsc_pay_sal_test_2026-09_v1');
  assert.deepEqual(saved.employee1, sal.employee1);
  assert.deepEqual(saved.employee2, sal.employee2);
  assert.equal(b.saved('fsc_pay_emp_test_v1').length, 3);
  assert.match(b.messages.at(-1), /第\s*2\s*行.*(同名|身份证|歧义)/);
});

test('payroll duplicate certificate in existing records is a row error, never first-match overwrite', async () => {
  const b = browserModule('pay.js');
  b.seed('fsc_pay_emp_test_v1', [{ id: 'a', name: '甲', idno: 'ID001', on: 1 }, { id: 'b', name: '乙', idno: 'ID001', on: 1 }]);
  b.rows([['姓名', '身份证号', '应发工资'], ['甲', 'ID001', 6000]]);
  await b.c.payImport({ name: 'duplicate.xlsx' });
  assert.deepEqual(b.saved('fsc_pay_sal_test_2026-09_v1'), {});
  assert.match(b.messages.at(-1), /第\s*2\s*行.*(重复|身份证|歧义)/);
});

test('profit CSV includes one tax surcharge line and the displayed investment income', () => {
  const b = browserModule('rpt.js');
  b.vouchers([{ date: '2026-09-10', posted: 1, lines: [{ acct: '5403', dr: 20, cr: 0 }, { acct: '5111', dr: 0, cr: 125 }] }]);
  assert.match(b.c.S['rp-pl'](), /投资收益/);
  b.click({ act: 'rptExpPl' });
  const rows = b.downloads[0].rows;
  assert.equal(rows.filter(row => row[0].includes('税金及附加')).length, 1);
  assert.deepEqual(rows.find(row => row[0].includes('投资收益')), ['加：投资收益', '125.00', '125.00']);
  assert.equal(rows.find(row => row[0].includes('营业利润'))[1], '105.00');
});
