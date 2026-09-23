const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

// Reduced from the production roster's three cross-group name collisions.
// Amounts and the two gift-shop rows are synthetic; no production financial data.
function fixture() {
  return {
    periods: { '2026-08': { gift: { '2026-08-20': { retailIncome: 80 } } },
      '2026-09': { gift: { '2026-09-20': { retailIncome: 120 } }, supply: { '2026-09-20': { retailCost: 20 } } } },
    cfg: { gift: { directLaborMonth: 50 } }, cfgByPeriod: { '2026-09': { gift: { directLaborMonth: 75 } } },
    channels: [
      { id: 'gift', aliases: ['销售甲店', '销售乙店'], details: [
        { source: '销售甲店', fields: [{ name: '编号', value: '0004' }, { name: '负责人', value: '甲' }] },
        { source: '销售乙店', fields: [{ name: '编号', value: '0008' }, { name: '负责人', value: '乙' }] },
      ] },
      { id: 'jdpop', aliases: ['京东-澳乐官方旗舰店'], details: [
        { source: '京东-澳乐官方旗舰店', fields: [{ name: '编号', value: '0035' }] },
      ] },
      { id: 'supply', aliases: ['分销-澳乐自营（零售）', '分销-澳乐自营（1688）'], details: [
        { source: '分销-澳乐自营（零售）', fields: [{ name: '编号', value: '0036' }] },
        { source: '分销-澳乐自营（1688）', fields: [{ name: '编号', value: '0037' }] },
      ] },
    ],
  };
}

// Multiple independent runtimes share only this CAS endpoint. This exercises the
// real save/rebase client and fresh-load path rather than copying local storage.
function workspace(seed = fixture()) {
  let remote = { periodLocks: { '2026-09': false }, ...clone(seed) }, version = 1, rejection = '';
  const writes = [];
  return {
    document: () => clone(remote), writes,
    reject: message => { rejection = message; },
    mutate: fn => { fn(remote); version++; },
    fetch: async (url, options = {}) => {
      if (options.method === 'PUT') {
        const input = JSON.parse(options.body); writes.push(input);
        if (rejection) return { ok: false, status: 503, json: async () => ({ error: rejection }) };
        const conflicts = input.changes.filter(change => {
          let parent = remote;
          for (const key of change.path.slice(0, -1)) parent = parent?.[key];
          const key = change.path.at(-1), exists = parent != null && Object.hasOwn(parent, key);
          return exists !== change.oldExists || (exists && JSON.stringify(parent[key]) !== JSON.stringify(change.old));
        });
        if (conflicts.length) return { ok: false, status: 409, json: async () => ({ error: 'field_conflict', conflicts }) };
        const candidate = clone(remote);
        for (const change of input.changes) {
          let parent = candidate;
          for (const key of change.path.slice(0, -1)) parent = parent[key] ||= {};
          if (change.newExists) parent[change.path.at(-1)] = clone(change.value);
          else delete parent[change.path.at(-1)];
        }
        // The real API rejects import records with no affected channel. An old
        // shop name must still identify the canonical row for its audit entry.
        if (Object.values(candidate.importHistory || {}).some(record => !record.channels?.length)) {
          return { ok: false, status: 400, json: async () => ({ error: 'invalid import history range' }) };
        }
        remote = candidate;
        version++;
      }
      return { ok: true, json: async () => ({ found: true, version, document: clone(remote) }) };
    },
  };
}

async function app(server) {
  const storage = new Map(), tables = [], messages = [];
  const context = vm.createContext({
    console, Date, Set, Map, Blob, Intl, Math,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    window: {}, S: {}, go() {}, H: String, money: String, pill: String,
    head: (title, subtitle, meta, buttons) => title + subtitle + (buttons || ''),
    table: (columns, rows) => { tables.push(clone({ columns, rows })); return JSON.stringify(rows); },
    card: (title, body) => title + body, cardp: (title, body) => title + body,
    toast: text => messages.push(text), fetch: server.fetch,
  });
  for (const file of ['t4-sync.js', 't4.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  const run = script => vm.runInContext(script, context);
  run("T4.period='2026-09'; t4CurrentMonth=()=> '2026-09'");
  await run('t4LoadServer()');
  return { run, context, storage, tables, messages, json: script => clone(run(script)),
    save: draft => run(`t4SaveSource(${JSON.stringify(draft)})`),
    import: async rows => {
      context.sheets = [rows];
      run("XLSXLite={readSheets:async()=>sheets}; picker={files:[{name:'渠道列表.xlsx'}],click(){}}; document.createElement=()=>picker; t4ChPickFile()");
      await run('picker.onchange()');
    },
  };
}
const sourceRows = app => app.json('t4ChDisplaySourceRows()');
const source = (doc, name) => doc.channels.flatMap(channel => (channel.details || []).map(row => ({ ...row, channel: channel.id }))).find(row => row.source === name);

test('a fresh session opens sales rows and production cross-group names appear exactly once', async () => {
  const a = await app(workspace());
  const groups = a.json('T4_CH.map(c => [c.id,c.n,c.bu])');
  a.run("S['t4-channels']()");
  assert.equal(a.run('T4.chField'), '__sources');
  const rendered = a.tables.at(-1);
  assert.equal(rendered.columns[0].t, '销售渠道');
  for (const [name, channel] of [
    ['京东-澳乐官方旗舰店', 'jdpop'], ['分销-澳乐自营（零售）', 'supply'], ['分销-澳乐自营（1688）', 'supply'],
  ]) {
    const matches = sourceRows(a).filter(row => row.source === name);
    assert.equal(matches.length, 1, name);
    assert.equal(matches[0].channel, channel);
    assert.equal(rendered.rows.filter(row => row[0] === name).length, 1);
  }
  assert.equal(new Set(sourceRows(a).map(row => row.source)).size, sourceRows(a).length);
  assert.deepEqual(a.json('T4_CH.map(c => [c.id,c.n,c.bu])'), groups);
  assert.equal(a.run('T4_CH.length'), 26);
});

test('editing one sales name and number preserves its sibling, extra fields, groups and financial history', async () => {
  const initial = fixture(), server = workspace(initial), a = await app(server);
  const groups = a.json('T4_CH.map(c => [c.id,c.n,c.bu])');
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲新店', number: '0104' });
  const saved = server.document();
  assert.deepEqual(source(saved, '销售乙店'), { ...initial.channels[0].details[1], channel: 'gift' });
  assert.deepEqual(source(saved, '销售甲新店').fields, [{ name: '编号', value: '0104' }, { name: '负责人', value: '甲' }]);
  assert.equal(source(saved, '销售甲店'), undefined);
  for (const field of ['periods', 'cfg', 'cfgByPeriod']) assert.deepEqual(saved[field], initial[field]);
  assert.deepEqual(a.json('T4_CH.map(c => [c.id,c.n,c.bu])'), groups);
  assert.equal(a.run("t4ResolveChannel('销售甲店')"), 'gift');
  assert.ok(server.writes.every(write => write.changes.every(change => change.path[0] === 'channels')));
});

test('a rename chain moves only its sales row and all former names to the chosen existing group', async () => {
  const initial = fixture(), server = workspace(initial), a = await app(server);
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲新店' });
  await a.save({ channel: 'supply', originalChannel: 'gift', originalSource: '销售甲新店', source: '销售甲终店' });
  for (const name of ['销售甲店', '销售甲新店', '销售甲终店']) assert.equal(a.run(`t4ResolveChannel(${JSON.stringify(name)})`), 'supply');
  assert.equal(a.run("t4ResolveChannel('销售乙店')"), 'gift');
  assert.deepEqual(source(server.document(), '销售甲终店').fields, initial.channels[0].details[0].fields);
  assert.equal(source(server.document(), '销售甲终店').channel, 'supply');
  assert.deepEqual(server.document().periods, initial.periods);
  assert.equal(sourceRows(a).filter(row => ['销售甲店', '销售甲新店', '销售甲终店'].includes(row.source)).length, 1);
});

test('new sales rows and explicitly entered aliases persist for fresh clients without creating extra groups', async () => {
  const server = workspace(), a = await app(server);
  await a.save({ channel: 'gift', source: '销售丙店', number: '0078' });
  await a.run("t4SaveChannel({id:'gift',n:T4_CHM.gift.n,bu:T4_CHM.gift.bu,aliases:'销售丁店'})");
  const b = await app(server), refreshed = await app(server);
  assert.deepEqual(sourceRows(b), sourceRows(refreshed));
  for (const name of ['销售丙店', '销售丁店']) {
    assert.equal(sourceRows(b).filter(row => row.source === name).length, 1);
    assert.equal(b.run(`t4ResolveChannel(${JSON.stringify(name)})`), 'gift');
  }
  assert.equal(b.run('T4_CH.length'), 26);
});

test('conflicting or invalid source edits are rejected before a shared write', async () => {
  const server = workspace(), a = await app(server), before = server.document();
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲新店' });
  const writes = server.writes.length, afterRename = server.document();
  for (const draft of [
    { channel: 'gift', source: '销售乙店' },
    { channel: 'supply', source: '销售甲店' },
    { channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '过期修改' },
    { channel: 'missing', source: '销售丙店' },
    { channel: 'gift', source: '<新店>' },
    { channel: 'gift', source: '新店', number: '编号\n换行' },
  ]) await assert.rejects(a.save(draft));
  assert.equal(server.writes.length, writes);
  assert.deepEqual(server.document(), afterRename);
  assert.deepEqual(server.document().periods, before.periods);
});

test('two stale clients cannot overwrite another sales-row edit, including on a repeated save', async () => {
  const server = workspace(), a = await app(server), b = await app(server);
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '同事已保存甲店' });
  const draft = { channel: 'gift', originalChannel: 'gift', originalSource: '销售乙店', source: '本地乙新店' };
  await assert.rejects(b.save(draft), /已被其他人修改/);
  await assert.rejects(b.save(draft), /已被其他人修改/);
  assert.ok(source(server.document(), '同事已保存甲店'));
  assert.equal(source(server.document(), '本地乙新店'), undefined);
  assert.equal(b.run("t4ResolveChannel('本地乙新店')"), '');
  const refreshed = await app(server);
  await refreshed.save(draft);
  assert.ok(source(server.document(), '同事已保存甲店'));
  assert.ok(source(server.document(), '本地乙新店'));
});

test('failed sales-row saves leave the roster and persistent cache unchanged', async () => {
  const server = workspace(), a = await app(server), before = server.document();
  const cached = a.storage.get('fsc_t4_channels_v2'), shown = sourceRows(a);
  server.reject('连接失败');
  await assert.rejects(a.save({ channel: 'supply', originalChannel: 'gift', originalSource: '销售甲店', source: '未保存名' }), /连接失败/);
  assert.deepEqual(server.document(), before);
  assert.deepEqual(sourceRows(a), shown);
  assert.equal(a.storage.get('fsc_t4_channels_v2'), cached);
  assert.equal(a.run('T4_SERVER_SAVING'), false);
});

test('sales edits merge independent remote amounts and retain unsaved local amounts without publishing them', async () => {
  const server = workspace(), a = await app(server);
  a.run("T4.data.gift['2026-09-20'].retailIncome=121");
  server.mutate(doc => { doc.periods['2026-09'].supply['2026-09-20'].retailCost = 25; });
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲新店' });
  assert.equal(server.document().periods['2026-09'].gift['2026-09-20'].retailIncome, 120);
  assert.equal(a.run("T4.data.gift['2026-09-20'].retailIncome"), 121);
  assert.equal(a.run("T4.data.supply['2026-09-20'].retailCost"), 25);
});

test('download and reimport retain current names and extra fields without reviving historical aliases', async () => {
  const server = workspace(), a = await app(server);
  await a.save({ channel: 'jdpop', originalChannel: 'jdpop', originalSource: '京东-澳乐官方旗舰店', source: '京东新店', number: '0099' });
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲新店' });
  await a.save({ channel: 'supply', originalChannel: 'gift', originalSource: '销售甲新店', source: '销售甲终店' });
  const beforeRows = sourceRows(a).map(row => [row.channel, row.source]);
  const downloaded = a.json('t4ChTemplateRows()');
  const names = downloaded.slice(1).map(row => row[downloaded[0].indexOf('销售渠道')]);
  assert.equal(new Set(names).size, names.length);
  for (const previous of ['销售甲店', '销售甲新店', '京东-澳乐官方旗舰店']) assert.equal(names.includes(previous), false, previous);
  await a.import(downloaded);
  assert.ok(a.messages.some(text => text.includes('已识别')), a.messages.join('\n'));
  const fresh = await app(server);
  // Registering genuine fallback rows can change grouping order, not membership.
  assert.deepEqual(sourceRows(fresh).map(row => [row.channel, row.source]).sort(), beforeRows.sort());
  assert.deepEqual(source(server.document(), '销售甲终店').fields, fixture().channels[0].details[0].fields);
  assert.equal(source(server.document(), '京东新店').fields.find(field => field.name === '编号').value, '0099');
  for (const name of ['销售甲店', '销售甲新店', '销售甲终店']) assert.equal(fresh.run(`t4ResolveChannel(${JSON.stringify(name)})`), 'supply');
  assert.equal(fresh.run("t4ResolveChannel('京东-澳乐官方旗舰店')"), 'jdpop');
});

test('a legacy-name import updates the current sales row and moves the full alias chain', async () => {
  const server = workspace(), a = await app(server);
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲新店' });
  await a.save({ channel: 'supply', originalChannel: 'gift', originalSource: '销售甲新店', source: '销售甲终店' });
  await a.import([['销售渠道', '渠道汇总', '编号'], ['销售甲店', '京东POP', '0200']]);
  assert.ok(a.messages.some(text => text.includes('已识别')), a.messages.join('\n'));
  const fresh = await app(server);
  const matches = sourceRows(fresh).filter(row => ['销售甲店', '销售甲新店', '销售甲终店'].includes(row.source));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, '销售甲终店');
  assert.equal(matches[0].channel, 'jdpop');
  assert.deepEqual(matches[0].fields, [{ name: '编号', value: '0200' }, { name: '负责人', value: '甲' }]);
  for (const name of ['销售甲店', '销售甲新店', '销售甲终店']) assert.equal(fresh.run(`t4ResolveChannel(${JSON.stringify(name)})`), 'jdpop');
  assert.deepEqual(Object.values(server.document().importHistory).at(-1).channels, ['jdpop']);
});

test('source-only old-name imports preserve an established mapping even when the old name is a built-in group', async () => {
  const server = workspace(), a = await app(server);
  await a.save({ channel: 'supply', originalChannel: 'jdpop', originalSource: '京东-澳乐官方旗舰店', source: '京东新销售店' });
  const groups = a.json('T4_CH.map(c=>[c.id,c.n,c.bu])');
  await a.import([['销售渠道', '编号'], ['京东-澳乐官方旗舰店', '0090']]);
  assert.ok(a.messages.some(text => text.includes('已识别')), a.messages.join('\n'));
  assert.equal(source(server.document(), '京东新销售店').channel, 'supply');
  assert.equal(source(server.document(), '京东-澳乐官方旗舰店'), undefined);
  assert.equal(a.run("t4ResolveChannel('京东-澳乐官方旗舰店')"), 'supply');
  assert.deepEqual(a.json('T4_CH.map(c=>[c.id,c.n,c.bu])'), groups);
  assert.deepEqual(Object.values(server.document().importHistory).at(-1).channels, ['supply']);
  // An explicit target remains authoritative when the user does choose a move.
  await a.import([['销售渠道', '渠道汇总'], ['京东-澳乐官方旗舰店', '京东-澳乐官方旗舰店']]);
  assert.equal(source(server.document(), '京东新销售店').channel, 'jd_aole');
  assert.equal(a.run("t4ResolveChannel('京东-澳乐官方旗舰店')"), 'jd_aole');
});

test('editing a group keeps its existing name but cannot add a source name already mapped elsewhere', async () => {
  const server = workspace(), a = await app(server);
  await a.run("t4SaveChannel({id:'jd_aole',n:T4_CHM.jd_aole.n,bu:T4_CHM.jd_aole.bu})");
  const before = server.document();
  await assert.rejects(a.run("t4SaveChannel({id:'jd_aole',n:T4_CHM.jd_aole.n,bu:T4_CHM.jd_aole.bu,aliases:'京东-澳乐官方旗舰店'})"), /已属于其他渠道/);
  assert.deepEqual(server.document(), before);
  assert.equal(sourceRows(a).filter(row=>row.source==='京东-澳乐官方旗舰店').length, 1);
});

test('new sales names cannot redirect another group ID or established built-in matching name', async () => {
  const server = workspace(), a = await app(server), before = server.document();
  for (const name of ['tmall', 'T-MALL', '天猫', '快手-澳乐玩具']) {
    const resolved = a.run(`t4ResolveChannel(${JSON.stringify(name)})`);
    await assert.rejects(a.save({ channel: 'gift', source: name }), /已属于|保留|其他渠道|归集渠道/);
    await assert.rejects(a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: name }), /已属于|保留|其他渠道|归集渠道/);
    assert.equal(a.run(`t4ResolveChannel(${JSON.stringify(name)})`), resolved);
  }
  assert.equal(server.writes.length, 0);
  assert.deepEqual(server.document(), before);
  // Registering an ID in its own group first cannot make that stable ID movable.
  await a.save({ channel: 'gift', source: 'gift' });
  const registered = server.document();
  await assert.rejects(a.save({ channel: 'supply', originalChannel: 'gift', originalSource: 'gift', source: '礼品门店' }), /已属于|保留|其他渠道|归集渠道/);
  assert.deepEqual(server.document(), registered);
  assert.equal(a.run("t4ResolveChannel('gift')"), 'gift');
});

test('a moved shop can be renamed again when its original group retains an automatic historical name', async () => {
  const seed = fixture();
  seed.channels.push({ id: 'tmall', n: '澳乐天猫归集新名', aliases: ['天猫-澳乐旗舰店'], details: [
    { source: '天猫-澳乐旗舰店', fields: [{ name: '编号', value: '0091' }], legacyNote: '保留旧结构字段' },
  ] });
  const server = workspace(seed), a = await app(server);
  await a.save({ channel: 'gift', originalChannel: 'tmall', originalSource: '天猫-澳乐旗舰店', source: '天猫门店新名' });
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '天猫门店新名', source: '天猫门店二次改名' });
  assert.equal(source(server.document(), '天猫门店二次改名').legacyNote, '保留旧结构字段');
  assert.deepEqual(source(server.document(), '天猫门店二次改名').fields, [{ name: '编号', value: '0091' }]);
  for (const name of ['天猫-澳乐旗舰店', '天猫门店新名', '天猫门店二次改名']) assert.equal(a.run(`t4ResolveChannel(${JSON.stringify(name)})`), 'gift');
  assert.equal(sourceRows(a).some(row => row.source === '天猫-澳乐旗舰店'), false);
});

test('registering a genuine fallback row preserves its group and presents one persisted sales row', async () => {
  const server = workspace(), a = await app(server);
  assert.equal(sourceRows(a).find(row => row.channel === 'tmall').fallback, true);
  await a.save({ channel: 'tmall', originalChannel: 'tmall', originalSource: '天猫-澳乐旗舰店', source: '天猫新销售店', number: '0080' });
  const fresh = await app(server), rows = sourceRows(fresh).filter(row => row.channel === 'tmall');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, '天猫新销售店');
  assert.equal(rows[0].fallback, false);
  assert.equal(fresh.run('T4_CHM.tmall.n'), '天猫-澳乐旗舰店');
  assert.equal(fresh.run("t4ResolveChannel('天猫-澳乐旗舰店')"), 'tmall');
});

test('an explicitly empty number clears only that metadata field', async () => {
  const server = workspace(), a = await app(server);
  await a.save({ channel: 'gift', originalChannel: 'gift', originalSource: '销售甲店', source: '销售甲店', number: '' });
  assert.deepEqual(source(server.document(), '销售甲店').fields, [{ name: '编号', value: '' }, { name: '负责人', value: '甲' }]);
});
