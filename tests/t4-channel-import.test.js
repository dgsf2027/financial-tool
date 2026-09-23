const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function app(seed = {}) {
  const storage = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const context = vm.createContext({
    console, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }, window: {}, S: {},
  });
  const helpers = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').split('/* ============ 系统结构')[0];
  vm.runInContext(helpers, context);
  vm.runInContext('toast = () => {};', context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  return { run: code => vm.runInContext(code, context), storage,
    apply: rows => { context.rows = rows; return vm.runInContext('t4ChApplyRows(rows)', context); },
    json: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)) };
}

test('sales-channel-only headers create a working channel without a summary column', () => {
  const a = app();
  assert.equal(a.apply([['销售渠道', '归属事业部'], ['新店', '大电商']]).added, 1);
  assert.equal(a.run("T4_CHM[t4ResolveChannel('新店')].bu"), 'ecom');
  assert.equal(a.run("T4_CHM[t4ResolveChannel('新店')].files[0].k"), 'daily');
});

test('a roster with repeated summary IDs keeps every source shop visible after import', () => {
  const a = app();
  const result = a.apply([
    ['渠道ID', '销售渠道', '归属事业部', '渠道汇总', '编号'],
    ['gift', '分销-礼品甲', '经销事业部', '分销-澳乐礼品单', '0001'],
    ['gift', '分销-礼品乙', '经销事业部', '分销-澳乐礼品单', '0002'],
    ['cus1', '拼多多-橘农官方旗舰店', '橘农事业部', '拼多多-橘农官方旗舰店', '0003'],
  ]);
  assert.equal(result.imported, 3);
  assert.equal(a.run('t4ChSourceRows().length'), 3);
  assert.deepEqual(a.json("t4ChSourceRows().filter(r => r.source.startsWith('分销-礼品')).map(r => [r.source, r.target, r.fields[0].value])"), [
    ['分销-礼品甲', '分销-澳乐礼品单', '0001'],
    ['分销-礼品乙', '分销-澳乐礼品单', '0002'],
  ]);
  assert.match(a.run("S['t4-channels']()"), /销售渠道/);
});

test('channel mutations require a connected shared workspace', () => {
  const a = app();
  assert.throws(() => a.run('t4RequireServerReady()'), /共享数据未连接/);
  a.run("T4_SERVER_LAST_KEY = 'error:network'");
  assert.throws(() => a.run('t4RequireServerReady()'), /未能连接财务中心/);
  assert.match(a.run('t4SyncStatus()'), /未能连接财务中心/);
  a.run('T4_SERVER_READY = true');
  assert.match(a.run('t4SyncStatus()'), /已连接财务中心/);
  assert.match(a.run('t4SyncStatus()'), /data-t4act="refreshSync"/);
});

test('channel mutations wait for an in-flight sync even after a workspace was loaded', () => {
  const a = app();
  a.run('T4_SERVER_READY = true; T4_SERVER_SAVING = true;');
  assert.throws(() => a.run('t4RequireServerReady()'), /正在同步/);
  a.run('T4_SERVER_SAVING = false; T4_SERVER_LOADING = true;');
  assert.throws(() => a.run('t4RequireServerReady()'), /正在同步/);
});

test('an unauthenticated import click stops before opening the file picker', () => {
  const a = app();
  a.run(`
    notices = []; toast = message => notices.push(message);
    pickerOpened = false;
    document.createElement = () => ({ click() { pickerOpened = true; } });
    T4_SERVER_ERROR = { status: 401 };
    t4ChPickFile();
  `);
  assert.equal(a.run('pickerOpened'), false);
  assert.match(a.run('notices[0]'), /登录财务中心/);
});

test('a rejected workspace load renders the channel page after loading ends', async () => {
  const a = app();
  a.run(`
    CURS = 't4-channels';
    renders = [];
    go = id => renders.push({ loading: T4_SERVER_LOADING, html: S[id]() });
    window.T4Shared = { load: async () => { throw new Error('未完成门户登录'); } };
  `);
  await a.run('t4LoadServer()');
  const renders = a.json('renders');
  assert.equal(renders.length, 1);
  assert.equal(renders[0].loading, false, 'failure must not leave the rendered page in its loading state');
  assert.match(renders[0].html, /未能连接财务中心/);
  assert.doesNotMatch(renders[0].html, /正在连接财务中心/);
});

test('the channel page renders its connection state and retry control as HTML', () => {
  const a = app();
  a.run("T4_SERVER_LAST_KEY = 'error:network';");
  const html = a.run("S['t4-channels']()");
  assert.match(html, /<span class="pill p-wa">未能连接财务中心<\/span>/);
  assert.match(html, /<button class="btn sm" data-t4act="retrySync">重新连接<\/button>/);
  assert.doesNotMatch(html, /&lt;(?:span|button)/);
});

test('an unauthenticated channel page offers a working login route instead of only retrying', async () => {
  const a = app();
  a.run(`
    CURS = 't4-channels';
    rendered = '';
    go = id => { rendered = S[id](); };
    sessionExpired = 0;
    window.financeSessionExpired = () => { sessionExpired++; };
    window.T4Shared = { load: async () => { const error = new Error('未完成门户登录'); error.status = 401; throw error; } };
  `);
  await a.run('t4LoadServer()');
  const html = a.run('rendered');
  assert.match(html, /请先登录财务中心/);
  assert.match(html, /<a href="\/sso\/login" class="btn sm pri">登录财务中心<\/a>/);
  assert.match(html, /登录后.*财务中心/);
  assert.doesNotMatch(html, /data-t4act="retrySync"/);
  assert.equal(a.run('sessionExpired'), 1);
  assert.throws(() => a.run('t4RequireServerReady()'), /登录财务中心/);
});

test('a service outage remains a connection error without a login instruction', async () => {
  const a = app();
  a.run(`
    CURS = 't4-channels';
    rendered = '';
    go = id => { rendered = S[id](); };
    window.T4Shared = { load: async () => { const error = new Error('服务暂不可用'); error.status = 503; throw error; } };
  `);
  await a.run('t4LoadServer()');
  const html = a.run('rendered');
  assert.match(html, /未能连接财务中心/);
  assert.match(html, /data-t4act="retrySync"/);
  assert.doesNotMatch(html, /href="\/sso\/login"/);
  assert.throws(() => a.run('t4RequireServerReady()'), /未能连接财务中心/);
});

test('an expired session during channel saving keeps drafts and renders a login action', async () => {
  const a = app();
  a.run(`
    CURS = 't4-channels';
    rendered = '';
    go = id => { rendered = S[id](); };
    document.querySelectorAll = () => [];
    sessionExpired = 0;
    window.financeSessionExpired = () => { sessionExpired++; };
    window.T4Shared = {
      clone: value => JSON.parse(JSON.stringify(value)),
      empty: () => ({ periods: {}, cfg: {}, channels: [] }),
      load: async () => ({ found: true, version: 1, document: { periods: {}, cfg: {}, channels: [] } }),
      save: async () => { const error = new Error('会话已过期'); error.status = 401; throw error; }
    };
  `);
  await a.run('t4LoadServer()');
  a.run(`
    T4.data.tmall[T4.period + '-01'] = { retailIncome: 321 };
    T4.cfg.tmall.directLaborMonth = 654;
    t4ChApplyRows([['销售渠道','归属事业部'],['待同步渠道','大电商']]);
  `);
  await assert.rejects(a.run('t4SaveServer(true)'), /会话已过期/);
  assert.equal(a.run("T4.data.tmall[T4.period + '-01'].retailIncome"), 321);
  assert.equal(a.run('T4.cfg.tmall.directLaborMonth'), 654);
  assert.ok(a.run("t4ResolveChannel('待同步渠道')"));
  assert.match(a.run('rendered'), /href="\/sso\/login"/);
  assert.doesNotMatch(a.run('t4SyncStatus()'), /已连接财务中心/);
  assert.equal(a.run('sessionExpired'), 1);
  assert.throws(() => a.run('t4RequireServerReady()'), /登录财务中心/);
});

test('new channels repeated within a file or across imports keep one stable identity', () => {
  const a = app();
  const rows = [['渠道名称', '事业部'], ['新店', '大电商'], ['新店', '大电商']];
  assert.equal(a.apply(rows).added, 1);
  const id = a.run("t4ResolveChannel('新店')");
  assert.equal(a.apply(rows).added, 0);
  assert.equal(a.run("t4ResolveChannel('新店')"), id);
  assert.equal(a.run('T4_CH.filter(c => c.custom).length'), 1);
});

test('reordered columns, title rows and extra fields retain separate source-shop values', () => {
  const a = app();
  a.apply([['渠道清单'], [], ['负责人', '渠道汇总', '归属事业部', '销售渠道', '预算'],
    ['甲', '新渠道', '大电商', '新店甲', 0], ['乙', '新渠道', '大电商', '新店乙', 25]]);
  assert.equal(a.run("t4ResolveChannel('新店甲') === t4ResolveChannel('新店乙')"), true);
  assert.deepEqual(a.json('t4ChExtraFields()'), ['负责人', '预算']);
  assert.deepEqual(a.json("t4ChFieldRows('预算').map(r => [r.source, r.value])"), [['新店甲', '0'], ['新店乙', '25']]);
  const b = app(Object.fromEntries([...a.storage].map(([k, v]) => [k, JSON.parse(v)])));
  assert.deepEqual(b.json("t4ChFieldRows('负责人').map(r => r.value)"), ['甲', '乙']);
});

test('smaller later imports preserve absent channels, source fields and historic data', () => {
  const seed = { fsc_t4_data_v2: { '2026-08': { tmall: { '2026-08-01': { retailIncome: 55 } } } } };
  const a = app(seed);
  a.apply([['销售渠道', '事业部', '负责人', '备注'], ['新店甲', '大电商', '甲', '保留'], ['新店乙', '经销', '乙', '第二店']]);
  a.apply([['销售渠道', '负责人'], ['新店甲', '丙']]);
  assert.equal(a.run("T4_CHM[t4ResolveChannel('新店甲')].bu"), 'ecom');
  assert.ok(a.run("t4ResolveChannel('新店乙')"));
  assert.deepEqual(a.json("t4ChFieldRows('负责人').map(r => r.value)"), ['丙', '乙']);
  assert.deepEqual(a.json("t4ChFieldRows('备注').map(r => r.value)"), ['保留', '第二店']);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_data_v2')), seed.fsc_t4_data_v2);
});

test('invalid business-unit rows cannot change aliases or field values', () => {
  const a = app();
  a.apply([['销售渠道', '归属事业部', '渠道汇总'], ['原店', '大电商', '天猫-澳乐旗舰店']]);
  assert.throws(() => a.apply([['销售渠道', '归属事业部', '渠道汇总', '备注'], ['原店', '无效事业部', '京东POP', '坏值']]), /无效事业部/);
  assert.equal(a.run("t4ResolveChannel('原店')"), 'tmall');
  assert.deepEqual(a.json('t4ChExtraFields()'), []);
});

test('multiple worksheets skip a cover sheet and import all channel tables together', () => {
  const a = app();
  const result = a.run("t4ChApplySheets([[['导入说明']], [['销售渠道','事业部','负责人'],['甲店','大电商','甲']], [['渠道汇总','事业部','地区'],['乙店','经销','杭州']]])");
  assert.equal(result.added, 2);
  assert.equal(result.sheets, 2);
  assert.deepEqual(a.json('t4ChExtraFields()'), ['负责人', '地区']);
});

test('transposed channel tables create each newly added channel column', () => {
  const a = app();
  assert.equal(a.apply([['渠道名称', '甲店', '乙店'], ['归属事业部', '大电商', '经销'], ['负责人', '甲', '乙']]).added, 2);
  assert.deepEqual(a.json("t4ChFieldRows('负责人').map(r => r.value)"), ['甲', '乙']);
});

test('downloaded current template includes added channels, mappings and dynamic columns', () => {
  const a = app();
  a.apply([['销售渠道', '事业部', '渠道汇总', '负责人'], ['甲店', '大电商', '新渠道', '甲']]);
  const rows = a.json('t4ChTemplateRows()');
  assert.ok(rows[0].includes('负责人'));
  assert.ok(rows.some(r => r.includes('甲店') && r.includes('新渠道') && r.includes('甲')));
  assert.ok(rows.some(r => r.includes('天猫-澳乐旗舰店')));
  const id = a.run("t4ResolveChannel('新渠道')");
  assert.equal(a.apply(rows).added, 0);
  assert.equal(a.run("t4ResolveChannel('甲店')"), id);
  assert.equal(a.run("t4ChFieldRows('负责人').find(r=>r.source==='甲店').value"), '甲');
});

test('moving a source shop moves its retained extra fields to the chosen channel', () => {
  const a = app();
  a.apply([['销售渠道', '事业部', '渠道汇总', '负责人'], ['甲店', '大电商', '天猫', '甲']]);
  a.apply([['销售渠道', '事业部', '渠道汇总'], ['甲店', '大电商', '京东POP']]);
  assert.equal(a.run("t4ResolveChannel('甲店')"), 'jdpop');
  assert.equal(a.run("t4ChFieldRows('负责人').find(r=>r.source==='甲店').channel"), 'jdpop');
});

test('empty imports report failure and leave all stored channel settings untouched', () => {
  const a = app();
  a.apply([['销售渠道','事业部'],['新店','大电商']]);
  const before = a.storage.get('fsc_t4_channels_v2');
  assert.throws(() => a.apply([['销售渠道','事业部'],['','']]), /没有可导入/);
  assert.equal(a.storage.get('fsc_t4_channels_v2'), before);
});

test('an explicit custom channel ID cannot be overwritten by the next generated ID', () => {
  const a = app();
  assert.equal(a.apply([['渠道ID','渠道名称','事业部'],['cus1','甲店','大电商'],['','乙店','经销']]).added, 2);
  assert.equal(a.run("T4_CHM.cus1.n"), '甲店');
  assert.notEqual(a.run("t4ResolveChannel('乙店')"), 'cus1');
});

test('business-unit names must be registered aliases, not inherited object properties', () => {
  const a = app();
  assert.throws(() => a.apply([['渠道名称','事业部'],['新店','constructor']]), /constructor/);
  assert.equal(a.run("t4ResolveChannel('新店')"), '');
});

test('editing a downloaded source mapping moves the shop instead of renaming its old channel', () => {
  const a = app();
  a.apply([['销售渠道','事业部','渠道汇总','负责人'],['甲店','大电商','新渠道','甲']]);
  const original = a.run("t4ResolveChannel('新渠道')");
  const rows = a.json('t4ChTemplateRows()');
  const source = rows[0].indexOf('销售渠道'), target = rows[0].indexOf('渠道汇总');
  rows.find(r => r[source] === '甲店')[target] = '京东POP';
  a.apply(rows);
  assert.equal(a.run("t4ResolveChannel('甲店')"), 'jdpop');
  assert.equal(a.run(`T4_CHM['${original}'].n`), '新渠道');
  assert.equal(a.run("T4_CH.filter(c=>c.n==='京东POP').length"), 1);
  assert.equal(a.run("t4ChFieldRows('负责人').find(r=>r.source==='甲店').channel"), 'jdpop');
});

test('equivalent field headings across uploads share one page and export can be imported again', () => {
  const a = app();
  a.apply([['销售渠道','SKU'],['甲店','甲']]);
  a.apply([['销售渠道',' sku '],['乙店','乙']]);
  assert.deepEqual(a.json('t4ChExtraFields()'), ['SKU']);
  assert.deepEqual(a.json("t4ChFieldRows('SKU').map(r=>r.value)"), ['甲', '乙']);
  assert.equal(a.apply(a.json('t4ChTemplateRows()')).added, 0);
  assert.deepEqual(a.json("t4ChFieldRows('SKU').filter(r=>r.value).map(r=>r.value)"), ['甲', '乙']);
});

test('a title containing a channel keyword does not replace the complete header below it', () => {
  const a = app();
  const result = a.apply([['销售渠道'],['负责人','渠道汇总','归属事业部','销售渠道'],['甲','新渠道','大电商','新店']]);
  assert.equal(result.added, 1);
  assert.equal(a.run("T4_CHM[t4ResolveChannel('新店')].n"), '新渠道');
  assert.equal(a.run("T4_CHM[t4ResolveChannel('新店')].bu"), 'ecom');
});

test('a business-unit-first table below a title is not mistaken for a transposed table', () => {
  const a = app();
  assert.equal(a.apply([['销售渠道'],['归属事业部','销售渠道','负责人'],['大电商','新店','甲']]).added, 1);
  assert.equal(a.run("T4_CHM[t4ResolveChannel('新店')].bu"), 'ecom');
  assert.deepEqual(a.json('t4ChExtraFields()'), ['负责人']);
});

test('source-name header aliases update registered shops without renaming their aggregate group', () => {
  for (const heading of ['销售渠道', '渠道名称', '渠道']) {
    for (const withId of [false, true]) {
      const a = app();
      a.apply([['销售渠道', '渠道汇总', '编号'], ['礼品甲店', '分销-澳乐礼品单', '0001'], ['礼品乙店', '分销-澳乐礼品单', '0002']]);
      const beforeGroups = a.json('T4_CH.map(c => [c.id,c.n,c.bu])');
      const rows = [[heading, '编号'], ['礼品甲店', '0101']];
      if (withId) { rows[0].unshift('渠道ID'); rows[1].unshift('gift'); }
      assert.equal(a.apply(rows).renamed, 0, `${heading}, ID=${withId}`);
      assert.deepEqual(a.json('T4_CH.map(c => [c.id,c.n,c.bu])'), beforeGroups);
      assert.deepEqual(a.json("t4ChFieldRows('编号').map(r => [r.channel,r.source,r.value])"), [
        ['gift', '礼品乙店', '0002'], ['gift', '礼品甲店', '0101'],
      ]);
    }
  }
});

test('built-in source aliases keep their aggregate name while explicit ID plus a new name still renames it', () => {
  const a = app();
  a.apply([['渠道名称', '编号'], ['分销-礼品启尚', '0001']]);
  assert.equal(a.run('T4_CHM.gift.n'), '分销-澳乐礼品单');
  assert.equal(a.run("t4ResolveChannel('分销-礼品启尚')"), 'gift');
  const result = a.apply([['渠道ID', '渠道名称'], ['gift', '礼品事业归集']]);
  assert.equal(result.renamed, 1);
  assert.equal(a.run('T4_CHM.gift.n'), '礼品事业归集');
  assert.equal(a.run("t4ResolveChannel('分销-礼品启尚')"), 'gift');
  assert.equal(a.run("t4ResolveChannel('分销-澳乐礼品单')"), 'gift');
});
