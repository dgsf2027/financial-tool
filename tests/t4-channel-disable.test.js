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
  return { run: code => vm.runInContext(code, context),
    apply: rows => { context.rows = rows; return vm.runInContext('t4ChApplyRows(rows)', context); },
    json: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)) };
}
const commit = (a, expr) => a.run(`t4SaveChOverrides(${expr}); t4RebuildChannels();`);

test('a disabled built-in channel leaves the roster, imports and the sales dropdown', () => {
  const a = app();
  commit(a, "t4ChannelDisableCandidate('jd_aole', true)");
  assert.equal(a.run("T4_CHM.jd_aole.removed"), true);
  assert.equal(a.run("T4_CH.some(c => c.id === 'jd_aole')"), false);
  assert.equal(a.run("t4ResolveChannel('京东-澳乐官方旗舰店')"), '');
  assert.equal(a.run("t4ChDisplaySourceRows().some(r => r.channel === 'jd_aole')"), false);
  assert.equal(a.run("t4ChTemplateRows().some(r => r[0] === 'jd_aole')"), false);
  a.run("T4.sourceDraft = null");
  assert.doesNotMatch(a.run("S['t4-source-edit']()"), /value="jd_aole"/);
  assert.match(a.run("T4.chField = ''; S['t4-channels']()"), /已停用/);
});

test('a disabled channel stays in the P&L of a period that already has its data', () => {
  const a = app();
  a.run("T4.data = { jd_aole: { '2026-09-02': { retailIncome: 120 } } }");
  commit(a, "t4ChannelDisableCandidate('jd_aole', true)");
  assert.equal(a.run("T4_CH.some(c => c.id === 'jd_aole')"), true);
  assert.equal(a.run("t4ResolveChannel('京东-澳乐官方旗舰店')"), '');
  a.run("T4.data = {}; t4RebuildChannels();");
  assert.equal(a.run("T4_CH.some(c => c.id === 'jd_aole')"), false);
});

test('restoring a disabled channel brings it back', () => {
  const a = app();
  commit(a, "t4ChannelDisableCandidate('jd_aole', true)");
  commit(a, "t4ChannelDisableCandidate('jd_aole', false)");
  assert.equal(a.run("t4ResolveChannel('京东-澳乐官方旗舰店')"), 'jd_aole');
  assert.equal(a.run("T4_CH.some(c => c.id === 'jd_aole')"), true);
});

test('re-importing an old roster skips a disabled channel instead of reviving it', () => {
  const a = app();
  commit(a, "t4ChannelDisableCandidate('jd_aole', true)");
  const r = a.apply([['销售渠道', '归属事业部', '渠道汇总'], ['京东-澳乐官方旗舰店', '大电商', '京东-澳乐官方旗舰店'], ['新店甲', '经销', '新店甲']]);
  assert.equal(r.imported, 1);
  assert.ok(r.bad.some(x => x.includes('京东-澳乐官方旗舰店') && x.includes('停用')));
  assert.equal(a.run("T4_CHM.jd_aole.removed"), true);
  assert.equal(a.run("T4_CH_ACTIVE.filter(c => c.n === '京东-澳乐官方旗舰店').length"), 0);
});

test('deleting one sales row unmaps only that shop and survives re-import', () => {
  const a = app();
  a.apply([['销售渠道', '归属事业部', '渠道汇总'], ['分销-礼品甲', '经销', '分销-澳乐礼品单'], ['分销-礼品乙', '经销', '分销-澳乐礼品单']]);
  commit(a, "t4SourceDeleteCandidate('gift', '分销-礼品甲')");
  assert.equal(a.run("t4ResolveChannel('分销-礼品甲')"), '');
  assert.equal(a.run("t4ResolveChannel('分销-礼品乙')"), 'gift');
  assert.deepEqual(a.json("t4ChDisplaySourceRows().filter(r => r.channel === 'gift').map(r => r.source)"), ['分销-礼品乙']);
  assert.throws(() => a.apply([['销售渠道', '归属事业部', '渠道汇总'], ['分销-礼品甲', '经销', '分销-澳乐礼品单']]), /分销-礼品甲（已删除/);
  const r = a.apply([['销售渠道', '归属事业部', '渠道汇总'], ['分销-礼品甲', '经销', '分销-澳乐礼品单'], ['分销-礼品乙', '经销', '分销-澳乐礼品单']]);
  assert.ok(r.bad.some(x => x.includes('分销-礼品甲') && x.includes('已删除')));
  assert.equal(a.run("t4ResolveChannel('分销-礼品甲')"), '');
});

test('deleting a not-yet-registered default row hides it from the roster', () => {
  const a = app();
  commit(a, "t4SourceDeleteCandidate('priv', '有赞-澳乐乐姐心选')");
  assert.equal(a.run("t4ChDisplaySourceRows().some(r => r.source === '有赞-澳乐乐姐心选')"), false);
  assert.equal(a.run("t4ResolveChannel('有赞-澳乐乐姐心选')"), '');
});

test('deleting a built-in hard-coded shop name also blocks the built-in mapping', () => {
  const a = app();
  commit(a, "t4SourceDeleteCandidate('dycreator', '抖音-澳乐官方旗舰店')");
  assert.equal(a.run("t4ResolveChannel('抖音-澳乐官方旗舰店')"), '');
  assert.equal(a.run("t4ResolveChannel('抖音-BD达人成交店')"), 'dycreator');
});

test('adding a deleted shop again through the form restores its mapping', () => {
  const a = app();
  commit(a, "t4SourceDeleteCandidate('gift', '分销-礼品启尚')");
  assert.equal(a.run("t4ResolveChannel('分销-礼品启尚')"), '');
  commit(a, "t4SourceCandidate({ source: '分销-礼品启尚', channel: 'gift' }).list");
  assert.equal(a.run("t4ResolveChannel('分销-礼品启尚')"), 'gift');
});

test('renaming 渠道汇总 in the downloaded list renames the group instead of adding one', () => {
  const a = app();
  a.apply([['渠道ID', '销售渠道', '归属事业部', '渠道汇总'],
    ['jd_orange', '京东-橘农旗舰店', '橘农事业部', '京东-橘农旗舰店'],
    ['gift', '分销-礼品甲', '经销事业部', '分销-澳乐礼品单'],
    ['gift', '分销-礼品乙', '经销事业部', '分销-澳乐礼品单']]);
  const count = a.run('T4_CH_ALL.length');
  const r = a.apply([['渠道ID', '销售渠道', '归属事业部', '渠道汇总'],
    ['jd_orange', '京东-橘农旗舰店', '橘农事业部', '京东-橘农官方旗舰店'],
    ['gift', '分销-礼品甲', '经销事业部', '礼品单汇总'],
    ['gift', '分销-礼品乙', '经销事业部', '礼品单汇总']]);
  assert.equal(r.added, 0);
  assert.equal(r.renamed, 2);
  assert.equal(a.run('T4_CH_ALL.length'), count);
  assert.equal(a.run('T4_CHM.jd_orange.n'), '京东-橘农官方旗舰店');
  assert.equal(a.run('T4_CHM.gift.n'), '礼品单汇总');
  assert.equal(a.run("t4ResolveChannel('京东-橘农旗舰店')"), 'jd_orange');
});

test('changing 渠道汇总 on only some rows of a group still moves those shops to a new group', () => {
  const a = app();
  const r = a.apply([['渠道ID', '销售渠道', '归属事业部', '渠道汇总'],
    ['gift', '分销-礼品甲', '经销事业部', '新礼品组'],
    ['gift', '分销-礼品乙', '经销事业部', '分销-澳乐礼品单']]);
  assert.equal(r.added, 1);
  assert.equal(a.run('T4_CHM.gift.n'), '分销-澳乐礼品单');
  assert.notEqual(a.run("t4ResolveChannel('分销-礼品甲')"), 'gift');
});

test('拼多多-橘农官方旗舰店 is a built-in 橘农 channel without duplicating an earlier custom one', () => {
  const a = app();
  assert.equal(a.run("T4_CHM[t4ResolveChannel('拼多多-橘农官方旗舰店')].bu"), 'orange');
  assert.equal(a.run("T4_CHM.tm_orange.n"), '天猫-橘农滋补养生旗舰店');
  const b = app({ fsc_t4_channels_v2: [{ id: 'cus1', n: '拼多多-橘农官方旗舰店', bu: 'orange' }] });
  assert.equal(b.run("T4_CH.filter(c => c.n === '拼多多-橘农官方旗舰店').length"), 1);
  assert.equal(b.run("t4ResolveChannel('拼多多-橘农官方旗舰店')"), 'cus1');
});
