const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

// Exercise the actual CAS client and browser model; only HTTP/storage are in-memory.
async function app(document = {}) {
  let remote = { periods: {}, cfg: {}, channels: [], periodLocks: { '2026-09': false }, ...clone(document) };
  let version = 1, reject = '', puts = 0; const writes = [];
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
        puts++; writes.push(JSON.parse(options.body));
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
  for (const file of ['t4-sync.js', 't4-allocation.js', 't4.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c, { filename: file });
  const run = code => vm.runInContext(code, c);
  run("T4.period='2026-09'; t4CurrentMonth=()=> '2026-09';");
  await run('t4LoadServer()');
  return { run, c, storage, downloads, messages, writes, remote: () => clone(remote), puts: () => puts,
    reject: message => { reject = message; }, changeRemote: fn => { fn(remote); version++; } };
}

async function pickChannels(a, rows) {
  a.c.sheets = [rows];
  a.run(`XLSXLite={readSheets:async()=>sheets}; picker={files:[{name:'渠道模板.xlsx'}],click(){}};
    document.createElement=()=>picker; t4ChPickFile();`);
  await a.run('picker.onchange()');
}
function history(a) { return Object.values(a.remote().importHistory || {}); }
function setAllocation(a, kind = 'expense', amount = 300) {
  a.c.amount = amount; a.c.kind = kind;
  a.run(`T4.allocImport={kind, fileName:kind+'.xlsx', sheet:0,
    sheets:[[['渠道','直接人工','人力公摊'],['天猫-澳乐旗舰店',amount,0]]]};`);
}

test('channel template and import record use one CAS, and unchanged reimports also record success', async () => {
  const a = await app();
  const rows = [['渠道ID','销售渠道','归属事业部'],['tmall','新的天猫店','大电商']];
  await pickChannels(a, rows);
  assert.equal(a.puts(), 1);
  assert.equal(a.remote().channels[0].n, '新的天猫店');
  const record = history(a)[0];
  assert.equal(record.fileName, '渠道模板.xlsx');
  assert.equal(record.scope, '渠道列表');
  assert.equal(record.mode, 'file');
  assert.equal(record.from, '2026-09-01'); assert.equal(record.to, '2026-09-30');
  assert.deepEqual(record.channels, ['tmall']); assert.equal(record.used, 1);
  assert.ok(a.writes[0].changes.some(x => x.path[0] === 'channels'));
  assert.ok(a.writes[0].changes.some(x => x.path[0] === 'importHistory'));
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_import_history_v1')), a.remote().importHistory);
  await pickChannels(a, rows);
  assert.equal(a.puts(), 2); assert.equal(history(a).length, 2);
  assert.deepEqual(history(a)[1].channels, ['tmall']);
});

test('channel template failure restores metadata and cannot leave a successful history record', async () => {
  const a = await app(); const before = a.remote();
  a.reject('保存失败');
  await pickChannels(a, [['销售渠道','归属事业部'],['未保存店','大电商']]);
  assert.deepEqual(a.remote(), before);
  assert.equal(a.run("t4ResolveChannel('未保存店')"), '');
  assert.equal(a.run('Object.keys(T4.importHistory).length'), 0);
  assert.equal(JSON.parse(a.storage.get('fsc_t4_channels_v2')).length, 0);
  assert.ok(a.messages.some(x => x.includes('渠道导入未完成')));
});

test('channel CAS conflict rejects its audit entry atomically', async () => {
  const a = await app();
  a.changeRemote(doc => { doc.channels=[{id:'tmall',n:'同事保存店',bu:'ecom'}]; });
  await pickChannels(a, [['渠道ID','销售渠道','归属事业部'],['tmall','本地名称','大电商']]);
  assert.equal(a.remote().channels[0].n, '同事保存店');
  assert.equal(history(a).length, 0); assert.equal(a.run('Object.keys(T4.importHistory).length'), 0);
});

for (const kind of ['payroll', 'expense']) {
  test(`${kind} allocation and import record are persisted by one CAS including explicit zero`, async () => {
    const a = await app({cfgByPeriod:{'2026-09':{tmall:{directLaborMonth:10,sharedLaborMonth:90}}}});
    setAllocation(a, kind, 300); await a.run('t4ApplyAllocationImport()');
    assert.equal(a.puts(), 1); assert.equal(a.remote().cfgByPeriod['2026-09'].tmall.directLaborMonth, 300);
    assert.equal(a.remote().cfgByPeriod['2026-09'].tmall.sharedLaborMonth, 0);
    const record = history(a)[0];
    assert.equal(record.scope, kind === 'payroll' ? '工资分摊' : '费用分摊');
    assert.equal(record.fileName, kind+'.xlsx'); assert.equal(record.used, 1);
    assert.deepEqual(record.channels, ['tmall']); assert.equal(record.dates.length, 30);
    assert.ok(a.writes[0].changes.some(x => x.path[0] === 'cfgByPeriod'));
    assert.ok(a.writes[0].changes.some(x => x.path[0] === 'importHistory'));
    assert.equal(a.run('T4.allocImport'), null);
  });
}

test('allocation failure rolls back both config and history in memory and storage', async () => {
  const a = await app({cfgByPeriod:{'2026-09':{tmall:{directLaborMonth:10,sharedLaborMonth:90}}}});
  const before=clone(a.run('T4.cfg')); setAllocation(a); a.reject('同步失败');
  await a.run('t4ApplyAllocationImport()');
  assert.deepEqual(clone(a.run('T4.cfg')), before);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_cfg_periods_v1'))['2026-09'], before);
  assert.equal(a.run('Object.keys(T4.importHistory).length'),0);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_import_history_v1')), {});
  assert.equal(history(a).length,0); assert.ok(a.run('T4.allocImport'));
  assert.ok(a.messages.some(x => x.startsWith('未完成导入：')));
});

test('invalid or disconnected allocation import cannot produce a success record', async () => {
  const a = await app(); setAllocation(a,'payroll','invalid');
  await a.run('t4ApplyAllocationImport()');
  assert.equal(a.puts(),0); assert.equal(history(a).length,0);
  setAllocation(a); a.run('T4_SERVER_READY=false');
  await a.run('t4ApplyAllocationImport()');
  assert.equal(a.puts(),0); assert.equal(a.run('Object.keys(T4.importHistory).length'),0);
  assert.ok(a.run('T4.allocImport'));
});
