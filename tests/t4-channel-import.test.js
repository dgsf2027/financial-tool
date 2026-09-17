const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function app(seed = {}) {
  const storage = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const context = vm.createContext({
    console, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener() {} }, window: {}, S: {},
  });
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
