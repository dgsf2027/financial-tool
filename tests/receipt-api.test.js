'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createReceiptCheck, amountCents, validateResult, MAX_BODY_BYTES } = require('../server/receipt-check');

const ORIGIN = 'https://finance.vvaix.com';
const KEY = 'fixture-key-never-expose';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ3sAAAAASUVORK5CYII=';
const image = (suffix = '') => 'data:image/png;base64,' + Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(suffix)]).toString('base64');
const goodResult = overrides => ({ amount: '2.50', currency: 'CNY', payment_status: 'success',
  payment_date: '2026-10-09', multiple_transactions: false, needs_review: false, reason: '已支付', ...overrides });
const reply = (res, value = goodResult(), overrides = {}) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'x-hub-call-id': 'c_1234567890000_abcdef12' });
  res.end(JSON.stringify({ model: 'gpt-6.1-sol', hub_call_id: 'c_1234567890000_abcdef12',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, secret: KEY }, ...overrides }));
};
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))); }
function close(server) { return new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t, options = {}) {
  const calls = [];
  const hub = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const call = { path: req.url, body: JSON.parse(body), auth: req.headers.authorization };
    calls.push(call);
    if (options.onHub) await options.onHub(req, res, call); else reply(res);
  });
  const hubBase = await listen(hub);
  const handler = createReceiptCheck({ sessionUser: req => /^s=[ab]$/.test(req.headers.cookie || '') ? 'tenant:' + req.headers.cookie.slice(2) : null,
    env: { RECEIPT_AI_BASE_URL: hubBase + '/v1', RECEIPT_AI_KEY: KEY, NODE_ENV: 'production', ...(options.env || {}) },
    ...(options.factory || {}) });
  const server = http.createServer((req, res) => handler.handle(req, res, new URL(req.url, 'http://localhost').pathname));
  const base = await listen(server);
  t.after(async () => { await close(server); await close(hub); });
  const post = (input = { imageDataUrl: image() }, extras = {}) => fetch(base + '/api/receipt-check/recognize', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 's=a', Origin: ORIGIN, ...(extras.headers || {}) },
    body: JSON.stringify(input), ...Object.fromEntries(Object.entries(extras).filter(([key]) => key !== 'headers')),
  });
  return { base, post, calls };
}

test('configuration is public, contains no key or gateway address, and fails closed for invalid configuration', async t => {
  const app = await fixture(t);
  const response = await fetch(app.base + '/api/receipt-check/config');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert(!text.includes(KEY)); assert(!text.includes('127.0.0.1'));
  const config = JSON.parse(text);
  assert.equal(config.configured, true); assert.equal(config.model, 'gpt-6.1-sol');
  assert.equal(config.maxBodyBytes, 8 * 1024 * 1024); assert.equal(config.maxConcurrency, 2);
  const bad = await fixture(t, { env: { RECEIPT_AI_KEY: KEY + '\n' } });
  assert.equal((await (await fetch(bad.base + '/api/receipt-check/config')).json()).configured, false);
  const failed = await bad.post();
  assert.equal(failed.status, 503); assert(!(await failed.text()).includes(KEY)); assert.equal(bad.calls.length, 0);
});

test('paid recognition requires a server session and exact allowed Origin before any upstream call', async t => {
  const app = await fixture(t);
  for (const headers of [{ Cookie: '' }, { Cookie: 'fake-admin', 'X-T4-User': 'admin' }]) {
    const response = await app.post(undefined, { headers });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).loginUrl, '/sso/login');
  }
  for (const headers of [{ Origin: '' }, { Origin: 'null' }, { Origin: 'https://evil.example' },
    { Origin: 'https://finance.vvaix.com.evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await app.post(undefined, { headers })).status, 403);
  }
  assert.equal(app.calls.length, 0);
});

test('request uses the fixed model/hub feature, never sends expected amount, and returns validated facts and accounting ids', async t => {
  const app = await fixture(t);
  const response = await app.post({ imageDataUrl: image(), expectedAmount: '987654321.01' });
  assert.equal(response.status, 200);
  const out = await response.json();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].auth, 'Bearer ' + KEY);
  assert.equal(app.calls[0].path, '/v1/chat/completions');
  assert.equal(app.calls[0].body.model, 'gpt-6.1-sol');
  assert.equal(app.calls[0].body.hub_feature, 'finance-receipt-check');
  assert.equal(app.calls[0].body.hub_plan_fallback, false);
  assert.deepEqual(app.calls[0].body.response_format, { type: 'json_object' });
  assert.equal(app.calls[0].body.max_tokens, 900);
  assert(!JSON.stringify(app.calls[0].body).includes('987654321.01'));
  assert.equal(out.result.amount_matches, false); assert.equal(out.result.eligible_for_write, false);
  assert.equal(out.result.month, '2026-10'); assert.equal(out.callId, 'c_1234567890000_abcdef12');
  assert.deepEqual(out.usage, { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 });
  assert(!JSON.stringify(out).includes(KEY)); assert(!JSON.stringify(out).includes(PNG));
  for (const extra of [{ model: 'other' }, { baseUrl: 'http://evil' }, { key: 'other' }]) {
    assert.equal((await app.post({ imageDataUrl: image(), ...extra })).status, 400);
  }
  assert.equal(app.calls.length, 1);
});

test('integer cents are exact and cached facts are compared again against each new expected amount', async t => {
  assert.equal(amountCents('999999999999.99'), 99999999999999n);
  assert.equal(amountCents('0.29'), 29n);
  for (const value of [2.5, '-1', '1e3', '1.001', 'NaN', 'Infinity', '1,000', '']) assert.throws(() => amountCents(value));
  const app = await fixture(t);
  const first = await (await app.post({ imageDataUrl: image(), expectedAmount: '2.5' })).json();
  assert.equal(first.result.amount_matches, true); assert.equal(first.result.eligible_for_write, true);
  const otherExpected = await (await app.post({ imageDataUrl: image(), expectedAmount: '2.51' })).json();
  assert.equal(otherExpected.cached, true); assert.equal(otherExpected.result.amount_matches, false);
  assert.equal(otherExpected.result.eligible_for_write, false);
  const noExpected = await (await app.post()).json();
  assert.equal(noExpected.result.amount_matches, null); assert.equal(noExpected.result.eligible_for_write, false);
  assert.equal(app.calls.length, 1);
  await app.post(undefined, { headers: { Cookie: 's=b' } });
  assert.equal(app.calls.length, 2, 'another signed-in identity must not reuse private extracted facts');
});

test('pending, refunded, missing date, multiple transactions and uncertain results never become eligible', async t => {
  const variations = [{ payment_status: 'pending' }, { payment_status: 'refunded' }, { payment_status: 'failed' },
    { payment_status: 'unknown' }, { payment_date: null }, { multiple_transactions: true }, { needs_review: true },
    { currency: 'USD' }, { amount: null }, { amount: '0.00' }];
  let index = 0;
  const app = await fixture(t, { onHub: (_req, res) => reply(res, goodResult(variations[index++])) });
  for (let i = 0; i < variations.length; i += 1) {
    const response = await app.post({ imageDataUrl: image(String(i)), expectedAmount: i === variations.length - 1 ? '0' : '2.50' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.eligible_for_write, false, JSON.stringify(variations[i]));
  }
});

test('model response schema rejects malformed amounts, dates, flags, missing fields and interrupted completions', async t => {
  for (const patch of [{ amount: 2.5 }, { amount: '-2.50' }, { amount: '2.500' }, { currency: 100 },
    { payment_date: '2026-02-29' }, { payment_date: '0000-01-01' }, { payment_date: '2026-04-31' },
    { payment_status: ['success'] }, { needs_review: 'false' }, { multiple_transactions: 0 }, { reason: null }]) {
    assert.throws(() => validateResult(goodResult(patch)));
  }
  assert.equal(validateResult(goodResult({ payment_date: '2024-02-29' })).payment_date, '2024-02-29');
  assert.throws(() => validateResult({ amount: '2.50' }));
  const app = await fixture(t, { onHub: (_req, res) => reply(res, goodResult(), {
    choices: [{ finish_reason: 'length', message: { content: JSON.stringify(goodResult()) } }],
  }) });
  const response = await app.post();
  assert.equal(response.status, 502);
  assert.deepEqual(Object.keys(await response.json()), ['error']);
});

test('bad images, malformed JSON, oversized requests and compressed requests fail without billing', async t => {
  const app = await fixture(t);
  for (const imageDataUrl of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/jpeg;base64,' + PNG, 'data:image/png;base64,!!!!', 'data:image/png;base64,c29tZSB0ZXh0', '', null]) {
    assert.equal((await app.post({ imageDataUrl })).status, 400);
  }
  assert.equal((await app.post({ imageDataUrl: image(), expectedAmount: 2.5 })).status, 400);
  assert.equal((await app.post(undefined, { body: '{' })).status, 400);
  assert.equal((await app.post(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await app.post(undefined, { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  const oversizedStatus = await new Promise((resolve, reject) => {
    const request = http.request(app.base + '/api/receipt-check/recognize', { method: 'POST', headers: {
      Cookie: 's=a', Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': MAX_BODY_BYTES + 1,
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.flushHeaders();
  });
  assert.equal(oversizedStatus, 413);
  assert.equal(app.calls.length, 0);
});

test('simultaneous identical requests share one paid call and a different image obeys the concurrency limit', async t => {
  const entered = deferred(), release = deferred();
  const app = await fixture(t, { factory: { maxConcurrent: 1 }, onHub: async (_req, res) => {
    entered.resolve(); await release.promise; reply(res);
  } });
  const first = app.post();
  await entered.promise;
  const duplicate = app.post({ imageDataUrl: image(), expectedAmount: '2.51' });
  const different = await app.post({ imageDataUrl: image('second') });
  assert.equal(different.status, 429);
  release.resolve();
  const [one, two] = await Promise.all([first, duplicate]);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal((await two.json()).result.amount_matches, false);
  assert.equal(app.calls.length, 1);
});

test('per-identity rate limit bounds paid calls and allows another signed-in identity', async t => {
  const app = await fixture(t, { factory: { rateLimit: 1 } });
  assert.equal((await app.post()).status, 200);
  const blocked = await app.post({ imageDataUrl: image('different') });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '30');
  assert.equal((await app.post(undefined, { headers: { Cookie: 's=b' } })).status, 200);
  assert.equal(app.calls.length, 2);
});

test('timeout and provider errors expose no raw content, follow no redirects and never report successful facts', async t => {
  const slow = await fixture(t, { factory: { timeoutMs: 25 }, onHub: async (_req, _res) => {} });
  const timed = await slow.post(); assert.equal(timed.status, 504);
  assert.equal((await timed.json()).error.code, 'AI_TIMEOUT');
  for (const status of [302, 401, 402, 429, 500]) {
    const app = await fixture(t, { onHub: (_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json', Location: 'https://invalid.example/steal' });
      res.end(JSON.stringify({ error: { message: KEY + ' confidential provider error' } }));
    } });
    const response = await app.post();
    assert.equal(response.status, [402, 429].includes(status) ? status : 502);
    const output = await response.text(); assert(!output.includes(KEY)); assert(!output.includes('confidential'));
    assert.deepEqual(Object.keys(JSON.parse(output)), ['error']); assert.equal(app.calls.length, 1);
  }
});

test('only expected route methods are allowed', async t => {
  const app = await fixture(t);
  assert.equal((await fetch(app.base + '/api/receipt-check/recognize')).status, 405);
  assert.equal((await fetch(app.base + '/api/receipt-check/config', { method: 'POST' })).status, 405);
  assert.equal((await fetch(app.base + '/api/receipt-check/other')).status, 404);
  assert.equal(app.calls.length, 0);
});
