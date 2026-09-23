const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function client(fetch, globals = {}) {
  const context = { window: {}, fetch, ...globals };
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

test('an unresponsive write is bounded even without AbortSignal.timeout and releases saving for retry', async () => {
  const callbacks = new Map(), delays = [];
  const initial = { periods: {}, cfg: { value: 1 }, channels: [] };
  let requests = 0, putSignal;
  const shared = client(async (url, options = {}) => {
    requests++;
    if (requests === 2) {
      putSignal = options.signal;
      return new Promise((resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal.reason)));
    }
    return response(requests > 2 ? { ...initial, cfg: { value: 2 } } : initial);
  }, { AbortController, setTimeout(callback, delay) {
    const id = delays.length + 1; delays.push(delay); callbacks.set(id, callback); return id;
  }, clearTimeout(id) { callbacks.delete(id); } });
  await shared.load();
  const before = JSON.stringify(shared.state);
  const draft = { ...initial, cfg: { value: 2 } };
  const saving = shared.save(draft, 'A');
  saving.catch(() => {});
  await Promise.resolve();
  assert.ok(putSignal, 'PUT must have an abort signal');
  assert.equal(callbacks.size, 1);
  assert.ok(delays.at(-1) > 0 && delays.at(-1) <= 30000);
  [...callbacks.values()][0]();
  await assert.rejects(saving, /超时|abort|timeout/i);
  assert.equal(JSON.stringify(shared.state), before);
  assert.equal(callbacks.size, 0);
  await shared.save(draft, 'A');
  assert.equal(shared.state.document.cfg.value, 2);
  assert.equal(callbacks.size, 0);
});

test('a successful HTTP write with an invalid body cannot acknowledge an empty workspace', async () => {
  const initial = { periods: {}, cfg: { value: 1 }, channels: [] };
  for (const invalid of [null, {}, { version: 4 }, { version: 4, document: [] }, { version: -1, document: initial }]) {
    let requests = 0;
    const shared = client(async () => ++requests === 1 ? response(initial) : { ok: true, json: async () => invalid });
    await shared.load();
    const before = JSON.stringify(shared.state);
    await assert.rejects(shared.save({ ...initial, cfg: { value: 2 } }, 'A'), error => error.code === 'invalid_response');
    assert.equal(JSON.stringify(shared.state), before);
  }
  let requests = 0;
  const shared = client(async () => ++requests === 1 ? response(initial) : {
    ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); },
  });
  await shared.load();
  const before = JSON.stringify(shared.state);
  await assert.rejects(shared.save({ ...initial, cfg: { value: 2 } }, 'A'), error => error.code === 'invalid_response');
  assert.equal(JSON.stringify(shared.state), before);
});

test('invalid and older read snapshots retain the last confirmed workspace', async () => {
  const initial = { periods: {}, cfg: { value: 1 }, channels: [] };
  for (const snapshot of [{ version: 4 }, { version: 2, document: initial }, { version: 4, document: null }]) {
    let requests = 0;
    const shared = client(async () => ++requests === 1 ? response(initial) : { ok: true, json: async () => snapshot });
    await shared.load();
    const before = JSON.stringify(shared.state);
    await assert.rejects(shared.load(true), error => error.code === 'invalid_response');
    assert.equal(JSON.stringify(shared.state), before);
  }
});
