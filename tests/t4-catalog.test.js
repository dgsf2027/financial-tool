const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

// Exercise the actual CAS client and browser model; only HTTP/storage are in-memory.
async function app(document = {}) {
  let remote = { periods: {}, cfg: {}, channels: [], periodLocks: { '2026-09': false }, ...clone(document) };
  let version = 1, reject = '', puts = 0;
  const storage = new Map(), handlers = {}, downloads = [], messages = [];
  const c = vm.createContext({
    console, Date, Set, Map, Blob, Intl, Math,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener: (type, fn) => { handlers[type] = fn; }, querySelectorAll: () => [], getElementById: () => null },
    window: {}, S: {}, go() {}, H: String, money: String, pill: String,
    head: (title, sub, meta, buttons) => title + sub + (buttons || ''), table: (cols, rows) => JSON.stringify(rows), card: (title, body) => title + body,
    cardp: (title, body) => title + body, toast: msg => messages.push(msg),
    toCSV: clone, download: (name, rows) => downloads.push({ name, rows }),
    fetch: async (url, options = {}) => {
      if (options.method === 'PUT') {
        puts++;
        if (reject) return { ok: false, status: 503, json: async () => ({ error: reject }) };
        const input = JSON.parse(options.body), conflicts = [];
        for (const change of input.changes) {
          let value = remote;
          for (const key of change.path.slice(0, -1)) value = value?.[key];
          const key = change.path.at(-1), exists = value != null && Object.hasOwn(value, key);
          if (exists !== change.oldExists || (exists && JSON.stringify(value[key]) !== JSON.stringify(change.old))) {
            conflicts.push({ path: change.path, currentExists: exists, current: exists ? value[key] : null });
          }
        }
        if (conflicts.length) return { ok: false, status: 409, json: async () => ({ error: 'field_conflict', conflicts }) };
        for (const change of input.changes) {
          let value = remote;
          for (const key of change.path.slice(0, -1)) value = value[key] ||= {};
          if (change.newExists) value[change.path.at(-1)] = change.value; else delete value[change.path.at(-1)];
        }
        version++;
      }
      return { ok: true, json: async () => ({ found: true, version, document: clone(remote) }) };
    },
  });
  for (const file of ['t4-sync.js', 't4.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c, { filename: file });
  const run = code => vm.runInContext(code, c);
  run("T4.period='2026-09'; t4CurrentMonth=()=> '2026-09';");
  await run('t4LoadServer()');
  return { run, c, storage, downloads, messages, remote: () => clone(remote), puts: () => puts,
    reject: message => { reject = message; }, changeRemote: fn => { fn(remote); version++; } };
}

test('renaming and moving a channel keeps its ID, aliases, metadata and historical daily amounts', async () => {
  const old = { periods: { '2026-08': { tmall: { '2026-08-01': { retailIncome: 500 } } }, '2026-09': { tmall: { '2026-09-01': { retailCost: 30 } } } },
    channels: [{ id: 'tmall', n: '天猫-澳乐旗舰店', bu: 'ecom', aliases: ['旧销售店'], details: [{ source: '旧销售店', fields: [{ name: '负责人', value: '张三' }] }] }] };
  const a = await app(old);
  const id = await a.run("t4SaveChannel({id:'tmall',n:'澳乐线上直营',bu:'dealer',aliases:'新销售店'})");
  assert.equal(id, 'tmall');
  assert.equal(a.run("t4ResolveChannel('天猫-澳乐旗舰店')"), 'tmall');
  assert.equal(a.run("t4ResolveChannel('旧销售店')"), 'tmall');
  assert.equal(a.run("t4ResolveChannel('新销售店')"), 'tmall');
  assert.equal(a.run('T4_CHM.tmall.bu'), 'dealer');
  assert.deepEqual(a.remote().periods, old.periods);
  assert.deepEqual(a.remote().channels[0].details.find(row => row.source === '旧销售店'), old.channels[0].details[0]);
  assert.deepEqual(a.remote().channels[0].details.find(row => row.source === '新销售店'), { source: '新销售店', fields: [] });
  assert.equal(a.run("t4ChSourceRows().filter(row => row.source === '新销售店').length"), 1);
});

test('new channel validation rejects names/aliases used by another channel and invalid business units', async () => {
  const a = await app();
  for (const draft of [
    { n: '天猫-澳乐旗舰店', bu: 'ecom' }, { n: '新店', bu: 'dealer', aliases: '快手' },
    { n: '<新店>', bu: 'dealer' }, { n: '新店', bu: 'toString' },
  ]) await assert.rejects(a.run(`t4SaveChannel(${JSON.stringify(draft)})`));
  assert.equal(a.puts(), 0);
  const id = await a.run("t4SaveChannel({n:'渠道新店',bu:'orange',aliases:'渠道新店源名称'})");
  assert.match(id, /^ch_/);
  assert.equal(a.run("t4ResolveChannel('渠道新店源名称')"), id);
  assert.equal(a.remote().channels.find(c => c.id === id).bu, 'orange');
});

test('failed channel or expense catalog save does not change the displayed or cached metadata', async () => {
  const a = await app({ expenseItems: [{ k: 'expense_sample', n: '达人服务费' }] });
  a.reject('服务器离线');
  await assert.rejects(a.run("t4SaveChannel({id:'tmall',n:'未保存渠道',bu:'ecom'})"), /离线/);
  await assert.rejects(a.run("t4SaveExpenseItem({k:'expense_sample',n:'未保存费用'})"), /离线/);
  assert.equal(a.run('T4_CHM.tmall.n'), '天猫-澳乐旗舰店');
  assert.equal(a.run('T4.expenseItems[0].n'), '达人服务费');
  assert.equal(a.run('T4_SERVER_SAVING'), false);
  assert.equal(a.run('t4ChOverrides().length'), 0);
  assert.equal(a.remote().expenseItems[0].n, '达人服务费');
});

test('conflicting catalog array edits use CAS and cannot overwrite a colleague’s edit', async () => {
  const a = await app({ expenseItems: [{ k: 'expense_sample', n: '原费用' }] });
  a.changeRemote(doc => { doc.expenseItems[0].n = '同事费用'; });
  await assert.rejects(a.run("t4SaveExpenseItem({k:'expense_sample',n:'本地费用'})"), /已被其他人修改/);
  assert.equal(a.remote().expenseItems[0].n, '同事费用');
  assert.equal(a.run('T4.expenseItems[0].n'), '原费用');
});

test('successful catalog edit adopts independent remote data while retaining unsaved local daily edits', async () => {
  const a = await app({ periods: { '2026-09': { tmall: { '2026-09-01': { retailIncome: 100 } } } } });
  a.run("T4.data.tmall['2026-09-01'].retailIncome=150");
  a.changeRemote(doc => { doc.periods['2026-09'].ks = { '2026-09-01': { retailIncome: 80 } }; });
  await a.run("t4SaveChannel({id:'tmall',n:'修改店名',bu:'ecom'})");
  assert.equal(a.run("T4.data.tmall['2026-09-01'].retailIncome"), 150);
  assert.equal(a.run("T4.data.ks['2026-09-01'].retailIncome"), 80);
  assert.equal(a.remote().periods['2026-09'].tmall['2026-09-01'].retailIncome, 100);
});

test('custom expense registration updates shared arrays and import headings without changing references', async () => {
  const a = await app();
  a.run('originalInputs=T4_INPUTS; originalKeys=T4_INPUT_KEYS; originalMetrics=T4_METRICS; originalDaily=T4_FILE_DEFS.daily.fields;');
  const key = await a.run("t4SaveExpenseItem({n:'直播服务费'})");
  a.c.key = key;
  assert.equal(a.run('originalInputs===T4_INPUTS && originalKeys===T4_INPUT_KEYS && originalMetrics===T4_METRICS && originalDaily===T4_FILE_DEFS.daily.fields'), true);
  assert.equal(a.run('T4_INPUT_KEYS.includes(key)'), true);
  assert.equal(a.run("t4AutoMap(['日期','直播服务费'],T4_FILE_DEFS.daily)[key]"), 1);
  assert.equal(a.run("t4AutoMap(['日期','直播服务费'],T4_FILE_DEFS.summaryDaily)[key]"), 1);
  for (const name of ['直播服务费', '销售收入', '平台扣点', '', '<新科目>']) {
    await assert.rejects(a.run(`t4SaveExpenseItem({n:${JSON.stringify(name)}})`));
  }
});

test('daily custom expenses including zero and negative values affect operating profit and survive renaming', async () => {
  const a = await app({ expenseItems: [{ k: 'expense_sample', n: '服务费' }],
    periods: { '2026-08': { tmall: { '2026-08-01': { expense_sample: 99 } } } } });
  await a.run("t4SaveDailyExpenses('pdd_aole','2026-09-01',[{k:'expense_sample',value:'125.50',original:''}])");
  await a.run("t4SaveDailyExpenses('pdd_aole','2026-09-02',[{k:'expense_sample',value:'0',original:''}])");
  await a.run("t4SaveDailyExpenses('pdd_aole','2026-09-03',[{k:'expense_sample',value:'-25.50',original:''}])");
  assert.equal(a.run("t4Month('pdd_aole').operating"), 100);
  assert.equal(a.run("t4Month('pdd_aole').netProfit"), -100);
  assert.equal(a.run("t4InputValue(t4Raw('pdd_aole','2026-09-02'),'expense_sample')"), 0);
  await a.run("t4SaveExpenseItem({k:'expense_sample',n:'直播服务费'})");
  assert.equal(a.run("t4Month('pdd_aole').netProfit"), -100);
  assert.equal(a.remote().periods['2026-08'].tmall['2026-08-01'].expense_sample, 99);
  assert.equal(a.remote().expenseItems[0].k, 'expense_sample');
  assert.equal(a.run("T4_METRICS.find(m=>m.k==='expense_sample').n.trim()"), '直播服务费');
});

test('invalid daily amount, locked month and server failure preserve original expenses', async () => {
  const a = await app({ expenseItems: [{ k: 'expense_sample', n: '服务费' }],
    periods: { '2026-09': { pdd_aole: { '2026-09-01': { expense_sample: 50 } } } } });
  await assert.rejects(a.run("t4SaveDailyExpenses('pdd_aole','2026-09-01',[{k:'expense_sample',value:'1e999',original:50}])"));
  a.run("T4.periodLocks['2026-09']=true");
  await assert.rejects(a.run("t4SaveDailyExpenses('pdd_aole','2026-09-01',[{k:'expense_sample',value:'75',original:50}])"), /锁定/);
  a.run("T4.periodLocks['2026-09']=false"); a.reject('连接失败');
  await assert.rejects(a.run("t4SaveDailyExpenses('pdd_aole','2026-09-01',[{k:'expense_sample',value:'75',original:50}])"), /连接失败/);
  assert.equal(a.run("t4Raw('pdd_aole','2026-09-01').expense_sample"), 50);
  assert.equal(a.remote().periods['2026-09'].pdd_aole['2026-09-01'].expense_sample, 50);
});

test('expense-only days remain visible in CSV, suite payload and browser workbook', async () => {
  const a = await app({ expenseItems: [{ k: 'expense_sample', n: '直播服务费' }],
    periods: { '2026-09': { pdd_aole: { '2026-09-01': { expense_sample: 50 } } } } });
  const payload = clone(a.run('t4SuitePayload()'));
  assert.equal(payload.dailyByCh.pdd_aole[0].has, true);
  assert.equal(payload.dailyByCh.pdd_aole[0].expense_sample, 50);
  assert.equal(payload.monthByCh.pdd_aole.netProfit, -50);
  assert.equal(payload.operatingKeys.includes('expense_sample'), true);
  a.run("T4.dayCh='pdd_aole'; t4DayExport()");
  assert.equal(a.downloads[0].rows.find(row => row[0] === '直播服务费')[1], '50.00');
  a.run('t4Export()');
  const rawCSV = a.downloads[1].rows, col = rawCSV[0].indexOf('直播服务费');
  assert.equal(rawCSV.find(row => row[1] === '拼多多-澳乐旗舰店' && row[3] === '2026-09-01')[col], '50.00');
  a.run('window.XLSXWrite = XLSXWrite = {build:sheets=>sheets}; sheets=t4SuiteClientWorkbook(t4SuitePayload())');
  assert.equal(a.run("sheets.find(s=>s.name==='拼多多-澳乐旗舰店').rows.find(r=>r[0]==='直播服务费')[2].n"), 50);
});
