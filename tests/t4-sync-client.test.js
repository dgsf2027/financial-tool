const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function client(fetch) {
  const context = { window: {}, fetch };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 't4-sync.js'), 'utf8'), context);
  return context.window.T4Shared;
}
const response = document => ({ ok: true, json: async () => ({ version: 3, found: true, document }) });

test('concurrent loads both wait for the same server response', async () => {
  let finish, requests = 0;
  const shared = client(() => { requests++; return new Promise(resolve => { finish = resolve; }); });
  const first = shared.load(), second = shared.load();
  let secondFinished = false;
  second.then(() => { secondFinished = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(secondFinished, false);
  finish(response({ periods: {}, cfg: {}, channels: [] }));
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.equal(shared.state.version, 3);
});

test('a failed load can be retried and a forced load fetches a fresh snapshot', async () => {
  let requests = 0;
  const shared = client(async () => {
    requests++;
    if (requests === 1) throw new Error('offline');
    return response({ periods: {}, cfg: { request: requests }, channels: [] });
  });
  await assert.rejects(shared.load(), /offline/);
  await shared.load();
  await shared.load(true);
  assert.equal(requests, 3);
  assert.equal(shared.state.document.cfg.request, 3);
});

test('a no-op with reordered object keys reads latest data without writing', async () => {
  const calls = [];
  const shared = client(async (url, options = {}) => {
    calls.push(options.method || 'GET');
    return response({ periods: {}, cfg: { tmall: { a: 1, b: 2 } }, channels: [] });
  });
  await shared.load();
  await shared.save({ channels: [], cfg: { tmall: { b: 2, a: 1 } }, periods: {} }, 'A');
  assert.equal(calls.includes('PUT'), false);
  assert.equal(shared.state.version, 3);
});
