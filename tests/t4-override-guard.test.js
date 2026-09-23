const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app() {
  const storage = new Map(), inputs = [], confirmations = [];
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener() {}, querySelectorAll: () => inputs, getElementById: () => null },
    window: { T4Shared: { clone: value => JSON.parse(JSON.stringify(value)), empty: () => ({ periods: {}, cfg: {}, channels: [] }) } },
    confirm: message => { confirmations.push(message); return context.confirmResult; },
    confirmResult: true,
    S: {}, go() {}, toast() {}, H: String, pill: String, money: value => Number(value).toFixed(2),
    head: (...items) => items.join(''), card: (...items) => items.join(''), cardp: (...items) => items.join(''),
    table: (cols, rows) => JSON.stringify({ cols, rows }), CUR_USER: '测试员',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  vm.runInContext("t4LoadServer=async()=>{}; T4.period='2099-12'; t4Load(); T4.periodLocks={'2099-12':false}; T4.editCh='tmall';", context);
  // The financial override tests run with a connected shared-service stub;
  // the product save guard and response adoption still execute normally.
  vm.runInContext(`T4_SERVER_READY=true; T4_SERVER_VERSION=1;
    T4_SERVER_DOCUMENT=t4ViewDocument(); T4_SERVER_BASELINE=t4ViewDocument();
    window.T4Shared.save=async document=>({version:T4_SERVER_VERSION+1,document:t4Clone(document)});`, context);
  return {
    run: code => vm.runInContext(code, context),
    json: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
    storage, inputs, confirmations,
  };
}

const importedDay = {
  _src: 'file',
  _fileParts: { summaryIncome: { retailIncome: 32129.21, returnAmount: -21468.19 }, summaryCost: { retailCost: 5033 } },
};

function seed(a, overrides = {}) {
  a.run(`T4.data.tmall={'2099-12-20':${JSON.stringify({ ...importedDay, ...overrides })}};
    localStorage.setItem(T4_KEY,JSON.stringify({[T4.period]:T4.data}))`);
}

function entry(a, key, value, original, { summary = true, date = '2099-12-20' } = {}) {
  const input = { dataset: { t4orig: String(original) }, value: String(value) };
  input.dataset[summary ? 't4sumcell' : 't4cell'] = summary ? `${date}:tmall:${key}` : `${date}:${key}`;
  a.inputs.push(input);
  return input;
}

function summaryImport(a, rows, extra = {}) {
  a.run(`T4.sumScope='income'; T4.imp=${JSON.stringify({ mode: 'summary', fileK: 'summaryDaily', fileName: 'sales.xlsx', headRow: 0,
    map: { channel: 0, date: 1, retailIncome: 2 }, rows: [[], ...rows], ...extra })}`);
}

test('file comparison follows effective source priority, sums only fallback sources, and preserves explicit zero', () => {
  const a = app();
  a.run(`raw={retailIncome:9,_fileParts:{summaryIncome:{retailIncome:0},summaryCost:{retailIncome:10},summaryDaily:{retailIncome:20},daily:{retailIncome:30},sales:{retailIncome:40},other:{retailIncome:50}}}`);
  assert.equal(a.run("t4InputValue(raw,'retailIncome')"), 9);
  for (const [source, expected] of [['summaryIncome', 0], ['summaryCost', 10], ['summaryDaily', 20], ['daily', 30]]) {
    assert.equal(a.run("t4FileInputValue(raw,'retailIncome')"), expected);
    a.run(`delete raw._fileParts.${source}`);
  }
  assert.equal(a.run("t4FileInputValue(raw,'retailIncome')"), 90);
  assert.equal(a.run("t4FileInputValue(raw,'refundAmount')"), null);
  assert.equal(a.run("t4FileInputValue(null,'retailIncome')"), null);
  assert.equal(a.run('raw.retailIncome'), 9, 'comparison must not remove the active manual value');
});

test('the September 20 failure is recognized as a net amount placed over imported gross sales', () => {
  const a = app(); seed(a, { retailIncome: 10661.02 });
  const risk = a.json("t4IncomeOverrideRisk(t4Raw('tmall','2099-12-20'))");
  assert.equal(risk.fileIncome, 32129.21);
  assert.equal(risk.manualIncome, 10661.02);
  assert.equal(risk.deductions, -21468.19);
  assert.equal(Math.round(risk.netIncome * 100), 1066102);
  assert.equal(Math.round(a.run("t4Row('tmall','2099-12-20').salesIncome") * 100), -1080717);
});

test('risk checks include explicit refunds and rebates at cent precision without classifying ordinary losses', () => {
  const a = app();
  const risk = raw => a.run(`t4IncomeOverrideRisk(${JSON.stringify(raw)})`);
  assert.ok(risk({ retailIncome: 69.004, _fileParts: { daily: { retailIncome: 100, returnAmount: -20, refundAmount: -7, rebateAmount: 4 } } }));
  assert.equal(risk({ retailIncome: 69.006, _fileParts: { daily: { retailIncome: 100, returnAmount: -20, refundAmount: -7, rebateAmount: 4 } } }), null);
  assert.equal(risk({ retailIncome: 69, returnAmount: -20, refundAmount: -7, rebateAmount: -4 }), null, 'manual-only data has no imported gross baseline');
  assert.equal(risk({ retailIncome: 100, _fileParts: { daily: { retailIncome: 100, returnAmount: -200 } } }), null, 'unchanged gross sales may legitimately produce a negative net day');
  assert.equal(risk({ retailIncome: -5, _fileParts: { daily: { retailIncome: 100, returnAmount: -200 } } }), null);
  assert.equal(risk({ retailIncome: 0, _fileParts: { daily: { retailIncome: 0 } } }), null);
  assert.equal(risk({ retailIncome: 69, _fileParts: { daily: { retailIncome: 100 } } }), null, 'rate assumptions must not invent a duplicate-deduction finding');
});

test('source labels retain mixed provenance even if an import most recently set the day source to file', () => {
  const a = app();
  for (const source of ['file', 'manual']) {
    seed(a, { _src: source, retailIncome: 30000 });
    assert.match(a.run("t4SourceLabel(t4Raw('tmall','2099-12-20'))"), /文件.*人工覆盖/);
  }
  seed(a, { promotion: 5 });
  const mixed = a.run("t4SourceLabel(t4Raw('tmall','2099-12-20'))");
  assert.match(mixed, /文件/); assert.match(mixed, /人工/); assert.doesNotMatch(mixed, /覆盖/);
  assert.equal(a.run("t4SourceLabel({_src:'file',retailIncome:100})"), '文件');
  assert.equal(a.run("t4SourceLabel({_src:'file',retailIncome:100,rebateAmount:-5,_manualFields:{rebateAmount:true}})"), '文件 + 人工');
  assert.equal(a.run("t4SourceLabel({retailIncome:100,promotion:5,_srcs:{retailIncome:'sales',promotion:'manual'}})"), '文件 + 人工');
  assert.equal(a.run("t4SourceLabel({retailIncome:100})"), '人工');
  assert.equal(a.run(`t4SourceLabel(${JSON.stringify(importedDay)})`), '文件');
});

for (const summary of [true, false]) {
  test(`${summary ? 'summary' : 'channel'} entry rejects duplicate deduction before saving any changed cell`, async () => {
    const a = app(); seed(a);
    const before = a.json('T4.data');
    entry(a, 'retailIncome', '10661.02', '32129.21', { summary });
    entry(a, 'retailCost', '5000', '5033', { summary });
    a.run('saveCalls=0; t4Save=async()=>{saveCalls++}');
    await assert.rejects(a.run(`t4SaveEntries(${summary})`), error => /重复.*扣|扣.*重复/.test(error.message) && error.message.includes('2099-12-20'));
    assert.equal(a.run('saveCalls'), 0);
    assert.deepEqual(a.json('T4.data'), before);
    assert.equal(a.inputs[0].value, '10661.02', 'the rejected draft remains editable');
  });
}

test('ordinary manual corrections still save, and clearing a correction restores imported gross sales', async () => {
  const a = app(); seed(a);
  const input = entry(a, 'retailIncome', '32000', '32129.21');
  assert.equal(await a.run('t4SaveEntries(true)'), 1);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-20'),'retailIncome')"), 32000);
  input.dataset.t4orig = '32000'; input.value = '';
  assert.equal(await a.run('t4SaveEntries(true)'), 1);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-20'),'retailIncome')"), 32129.21);
  assert.equal(a.run("t4SourceLabel(t4Raw('tmall','2099-12-20'))"), '文件');
  assert.equal(Math.round(a.run("t4Row('tmall','2099-12-20').salesIncome") * 100), 1066102);
});

test('clearing an existing bad override repairs the day, while unrelated edits do not lock historic data', async () => {
  const a = app(); seed(a, { retailIncome: 10661.02 });
  entry(a, 'promotion', '15', '');
  assert.equal(await a.run('t4SaveEntries(true)'), 1);
  assert.equal(a.run("t4Raw('tmall','2099-12-20').promotion"), 15);
  a.inputs.length = 0;
  entry(a, 'retailIncome', '', '10661.02');
  await a.run('t4SaveEntries(true)');
  assert.equal(a.run("t4IncomeOverrideRisk(t4Raw('tmall','2099-12-20'))"), null);
  assert.equal(Math.round(a.run("t4Row('tmall','2099-12-20').salesIncome") * 100), 1066102);
});

test('a batch is validated after all changed values, so the order of fields cannot hide duplicate deductions', async () => {
  const a = app(); seed(a);
  entry(a, 'retailIncome', '10161.02', '32129.21');
  entry(a, 'refundAmount', '-500', '');
  const before = a.json('T4.data');
  a.run('saveCalls=0; t4Save=async()=>{saveCalls++}');
  await assert.rejects(a.run('t4SaveEntries(true)'), /重复|扣退/);
  assert.equal(a.run('saveCalls'), 0);
  assert.deepEqual(a.json('T4.data'), before);
});

test('a simultaneous gross and return correction is judged by its final values', async () => {
  const a = app(); seed(a);
  entry(a, 'retailIncome', '10661.02', '32129.21');
  entry(a, 'returnAmount', '0', '-21468.19');
  assert.equal(await a.run('t4SaveEntries(true)'), 2);
  assert.equal(a.run("t4IncomeOverrideRisk(t4Raw('tmall','2099-12-20'))"), null);
  assert.equal(Math.round(a.run("t4Row('tmall','2099-12-20').salesIncome") * 100), 1066102);
});

test('canceling an import masked by a manual override leaves data, history, stored values, and draft intact', async () => {
  const a = app(); seed(a, { retailIncome: 30000 });
  a.run("T4.importHistory={previous:{id:'previous',period:T4.period}}; confirmResult=false");
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', 33000]]);
  const before = a.json('({data:T4.data,history:T4.importHistory,imp:T4.imp})');
  const stored = new Map(a.storage);
  a.run('saveCalls=0; t4Save=async()=>{saveCalls++}');
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 1);
  assert.match(a.confirmations[0], /2099-12-20/);
  assert.equal(a.run('saveCalls'), 0);
  assert.deepEqual(a.json('({data:T4.data,history:T4.importHistory,imp:T4.imp})'), before);
  assert.deepEqual(a.storage, stored);
});

test('confirmed reimport preserves the manual value and records that it masks the new file amount', async () => {
  const a = app(); seed(a, { retailIncome: 30000 });
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', 33000]]);
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 1);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-20'),'retailIncome')"), 30000);
  assert.equal(a.run("t4FileInputValue(t4Raw('tmall','2099-12-20'),'retailIncome')"), 33000);
  assert.match(a.run("t4SourceLabel(t4Raw('tmall','2099-12-20'))"), /人工覆盖/);
  const history = a.json('Object.values(T4.importHistory)');
  assert.equal(history.length, 1);
  assert.ok(history[0].issues.some(issue => /人工/.test(issue) && /覆盖|优先|生效|遮挡|仍按/.test(issue)));
  assert.equal(a.run('T4.imp'), null);
});

test('manual zero is an explicit override and must be disclosed before a new file value is stored', async () => {
  const a = app(); seed(a, { retailIncome: 0 });
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', 33000]]);
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 1);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-20'),'retailIncome')"), 0);
});

test('imports prompt only for accepted overlapping fields, not another date, channel, or metric', async () => {
  const a = app(); seed(a, { retailIncome: 30000 });
  a.run("T4.data.tm_orange={'2099-12-21':{retailIncome:44,_fileParts:{summaryIncome:{retailIncome:55}}}}; confirmResult=false");
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', 33000], ['天猫-澳乐旗舰店', '2099-12-21', 100]],
    { rangeMode: 'range', from: '2099-12-21', to: '2099-12-21' });
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 0);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-21'),'retailIncome')"), 100);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-20'),'retailIncome')"), 30000);
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', '', 99]], { map: { channel: 0, date: 1, retailIncome: 2, retailCost: 3 } });
  a.run("T4.sumScope='both'");
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 0);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2099-12-20'),'retailCost')"), 99);
});

test('channel file imports use the same confirmation and cancellation protection', async () => {
  const a = app(); seed(a, { retailIncome: 30000 });
  a.run("confirmResult=false; T4.imp={mode:'channel',fileK:'daily',fileName:'daily.xlsx',headRow:0,map:{date:0,retailIncome:1},rows:[[],['2099-12-20',34000]]}");
  const before = a.json('T4.data');
  await a.run('t4ImpRun()');
  assert.equal(a.confirmations.length, 1);
  assert.deepEqual(a.json('T4.data'), before);
  assert.equal(a.run('Object.keys(T4.importHistory).length'), 0);
  assert.ok(a.run('T4.imp'));
});

test('an import that would create a duplicate deduction rolls back before confirmation or saving', async () => {
  const a = app();
  seed(a, { retailIncome: 10661.02, _fileParts: { summaryIncome: { retailIncome: 30000, returnAmount: -21468.19 } } });
  assert.equal(a.run("t4IncomeOverrideRisk(t4Raw('tmall','2099-12-20'))"), null);
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', 32129.21]]);
  const before = a.json('T4.data');
  a.run('saveCalls=0; t4Save=async()=>{saveCalls++}');
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 0);
  assert.equal(a.run('saveCalls'), 0);
  assert.deepEqual(a.json('T4.data'), before);
  assert.equal(a.run('Object.keys(T4.importHistory).length'), 0);
  assert.ok(a.run('T4.imp'));
  assert.match(a.run('T4.importFeedback.message'), /重复.*扣|扣.*重复/);
});

test('a failed save after accepting an override warning restores the old file amount and history', async () => {
  const a = app(); seed(a, { retailIncome: 30000 });
  a.run("T4.importHistory={previous:{id:'previous',period:T4.period}}");
  summaryImport(a, [['天猫-澳乐旗舰店', '2099-12-20', 33000]]);
  const before = a.json('({data:T4.data,history:T4.importHistory,imp:T4.imp})');
  a.run("t4Save=async()=>{localStorage.setItem(T4_KEY,JSON.stringify({[T4.period]:T4.data}));localStorage.setItem(T4_IMPORT_HISTORY_KEY,JSON.stringify(T4.importHistory));throw new Error('同字段冲突')}");
  await a.run('t4SummaryImpRun()');
  assert.equal(a.confirmations.length, 1);
  assert.deepEqual(a.json('({data:T4.data,history:T4.importHistory,imp:T4.imp})'), before);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_data_v2'))['2099-12'], before.data);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_import_history_v1')), before.history);
  assert.match(a.run('T4.importFeedback.message'), /同字段冲突/);
});

test('existing overrides expose original amounts and recovery instructions in daily report and both entry views', () => {
  const a = app(); seed(a, { retailIncome: 10661.02 });
  a.run("T4.dayCh='tmall';T4.manFrom='2099-12-20';T4.manTo='2099-12-20';T4.sumDate='2099-12-20';T4.sumTo='2099-12-20'");
  for (const page of ['t4-chday', 't4-man', 't4-summan']) {
    const html = a.run(`S['${page}']()`);
    assert.match(html, /人工/);
    assert.match(html, /32129\.21/);
    assert.match(html, /10661\.02/);
    assert.match(html, /重复.*扣|扣.*重复/);
  }
  assert.match(a.run("S['t4-man']()"), /留空.*恢复导入/);
  assert.match(a.run("S['t4-summan']()"), /留空.*恢复导入/);
  assert.equal(a.run("t4OverrideNotice(['tmall'],['2099-12-21'])"), '', 'notices follow the selected entry dates');
  assert.equal(a.run("t4OverrideNotice(['tm_orange'])"), '', 'notices follow the selected channel');
});
