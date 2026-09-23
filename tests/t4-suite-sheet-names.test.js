const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('browser suite emits unique Excel tab names for case variants across groups and channels', async () => {
  const context = vm.createContext({
    console, Date, Set, Map, Blob, TextEncoder, Uint8Array, DataView,
    window: {}, S: {}, document: { addEventListener() {} },
  });
  for (const file of ['lib/xlsx-write.js', 't4.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  context.XLSXWrite = context.window.XLSXWrite;
  context.payload = {
    period: '2026-09', days: 1, scopeName: '测试', generated: '测试',
    metrics: [{ k: 'retailIncome', n: '零售收入', lvl: 1 }],
    channels: ['Store/Online', 'store\\online', 'STORE·ONLINE~2'].map((name, i) => ({ id: `ch${i}`, name, bu: 'bu', buName: 'STORE·ONLINE', filled: 1 })),
    tree: [], monthByCh: {}, dailyByCh: {},
  };
  const result = await vm.runInContext('t4SuiteClientWorkbook(payload).arrayBuffer()', context);
  const names = [...Buffer.from(result).toString().matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1]);
  assert.equal(names.length, 5);
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length);
  assert.ok(names.every(name => name.length <= 31 && !/[\\/*?:\[\]]/.test(name)));
});
