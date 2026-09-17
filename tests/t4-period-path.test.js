// 回归：2026-09-16「导入未同步：invalid change path」
// 共享存储把期间和月份锁定的键当路径段用，服务端 sync_api.py 的 valid_path 只认
// 20xx-01..12。此前前端不校验，一个坏期间会让整批变更被拒（实测 529/530 条），
// 一个陈旧的锁定键会永久堵死该浏览器的所有保存（1/1 条）且界面毫无异常。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 't4.js'), 'utf8');
// 只取被测的纯函数，避免拉起整个页面运行时。
function load(names) {
  const picked = names.map(n => {
    const m = SRC.match(new RegExp(`\\nfunction ${n}\\b[\\s\\S]*?\\n}`));
    assert(m, `未找到函数 ${n}`);
    return m[0];
  }).join('\n');
  const re = SRC.match(/const T4_PERIOD_RE = .*/);
  assert(re, '未找到 T4_PERIOD_RE');
  return new Function(`${re[0]}\n${picked}\nreturn { ${names.join(', ')} };`)();
}
const { t4ValidPeriod, t4SanePeriodLocks } = load(['t4ValidPeriod', 't4SanePeriodLocks']);

// 服务端规则的等价实现，与 sync_api.py 的 valid_path 保持一致
const PERIOD = /^20\d{2}-(0[1-9]|1[0-2])$/;
function serverAccepts(p) {
  if (!(Array.isArray(p) && p.length >= 1 && p.length <= 7 && p.every(x =>
    typeof x === 'string' && x.length > 0 && x.length <= 120 && !x.includes('..')
    && !['__proto__', 'constructor', 'prototype'].includes(x)))) return false;
  if (p[0] === 'channels') return p.length === 1;
  if (p.length < 2) return false;
  if (p[0] === 'periodLocks') return p.length === 2 && PERIOD.test(p[1]);
  if (p[0] === 'periods' || p[0] === 'cfgByPeriod') return PERIOD.test(p[1]);
  return p[0] === 'cfg';
}

test('月份控件能产出的非法期间一律被前端拦下', () => {
  for (const bad of ['0226-09', '12026-09', '1999-05', '2026-9', '2026-13', '', '2026-00']) {
    assert.equal(t4ValidPeriod(bad), false, bad);
    assert.equal(serverAccepts(['periods', bad, 'tmall', '2026-09-01']), false, `服务端也应拒 ${bad}`);
  }
});

test('合法期间放行，且服务端确实接受它构成的满 7 段导入路径', () => {
  for (const good of ['2026-09', '2000-01', '2099-12']) {
    assert.equal(t4ValidPeriod(good), true, good);
    assert.equal(serverAccepts(
      ['periods', good, 'tmall', '2026-09-01', '_fileParts', 'summaryIncome', 'retailIncome']), true, good);
  }
});

test('陈旧的月份锁定键被丢弃而不是上传', () => {
  const { clean, dropped } = t4SanePeriodLocks({ '2026-08': true, '2026-9': true, '': true, all: true });
  assert.deepEqual(Object.keys(clean), ['2026-08']);
  assert.deepEqual(dropped.sort(), ['', '2026-9', 'all'].sort());
  for (const k of Object.keys(clean)) assert.equal(serverAccepts(['periodLocks', k]), true, k);
  for (const k of dropped) assert.equal(serverAccepts(['periodLocks', k]), false, k);
});

test('锁定值被规范成布尔，避免值为对象时下钻出第 3 段', () => {
  const { clean } = t4SanePeriodLocks({ '2026-08': { by: 'someone' } });
  assert.equal(clean['2026-08'], true);
  assert.equal(serverAccepts(['periodLocks', '2026-08', 'by']), false);
});
