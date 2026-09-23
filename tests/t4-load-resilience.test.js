const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
const root = process.env.FINANCE_TEST_SOURCE_ROOT || path.join(__dirname, '..');

function client(initialChannels) {
  let failure = 0, cacheFailure = false, pausePut;
  let remote = { version: 7, found: true, document: {
    channels: [{ id: 'gift', n: '共享渠道', details: [{ source: '共享门店', fields: [] }] }],
    periods: {}, cfg: {}, cfgByPeriod: { '2099-12': { gift: { platformFeeRate: 0.05 } } },
  } };
  const status = { innerHTML: '' }, storage = new Map(), requests = [];
  if (initialChannels) storage.set('fsc_t4_channels_v2', JSON.stringify(initialChannels));
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, Intl, CURS: 't4-cfg',
    window: {}, S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) {
      if (cacheFailure) throw new Error('QuotaExceededError');
      storage.set(key, value);
    } },
    document: { addEventListener() {}, getElementById: () => null,
      querySelectorAll: selector => selector === '[data-t4-sync-status]' ? [status] : [] },
    fetch: async (url, options = {}) => {
      requests.push(options.method || 'GET');
      if (failure) return { ok: false, status: failure, json: async () => ({ error: 'unavailable' }) };
      if (options.method === 'PUT') {
        if (pausePut) { const gate = pausePut; pausePut = null; gate.arrive(); await gate.promise; }
        for (const change of JSON.parse(options.body).changes) {
          let obj = remote.document;
          for (const key of change.path.slice(0, -1)) obj = obj[key] ||= {};
          if (change.newExists) obj[change.path.at(-1)] = clone(change.value);
          else delete obj[change.path.at(-1)];
        }
        remote.version++;
      }
      return { ok: true, json: async () => clone(remote) };
    },
  });
  for (const file of ['t4-sync.js', 't4.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run("T4.period='2099-12'");
  return { run, status, storage, requests, remote: () => clone(remote), seedRemote: doc => { remote.document = doc; }, fail: code => { failure = code; },
    failCache: () => { cacheFailure = true; },
    gatePut() {
      let arrive, release;
      const arrived = new Promise(resolve => { arrive = resolve; });
      const promise = new Promise(resolve => { release = resolve; });
      pausePut = { arrive, promise }; return { arrived, release };
    },
  };
}

test('malformed old channel cache cannot prevent T4 initialization and shared recovery', async () => {
  const c = client([null, { id: 'gift', details: [null] }, { id: 'tmall', aliases: 5 },
    { id: 'jdpop', details: [{ source: '坏字段', fields: [null] }] }, { id: 'jdzy', n: '本机有效条目' }]);
  assert.equal(c.run('T4_CHM.jdzy.n'), '本机有效条目');
  await c.run('t4LoadServer()');
  assert.equal(c.run('T4_SERVER_READY'), true);
  assert.equal(c.run('T4_CHM.gift.n'), '共享渠道');
  assert.equal(c.run('T4.cfg.gift.platformFeeRate'), 0.05);
  assert.equal(c.run('T4_CHM.gift.details[0].source'), '共享门店');
});

for (const [code, expected] of [[401, /登录财务中心/], [503, /重新连接/]]) {
  test(`initial parameter loading failure ${code} immediately displays recovery`, async () => {
    const c = client(); c.fail(code);
    await c.run('t4LoadServer()');
    assert.match(c.status.innerHTML, expected);
    assert.doesNotMatch(c.status.innerHTML, /正在连接/);
    assert.equal(c.run('T4_SERVER_READY'), false);
    c.fail(0); await c.run("T4_SERVER_LAST_KEY=''; t4LoadServer()");
    assert.equal(c.run('T4_SERVER_READY'), true);
    assert.equal(c.run('T4.cfg.gift.platformFeeRate'), 0.05);
  });
}

test('an unavailable browser cache cannot block server channels and parameter loading', async () => {
  const c = client(); c.failCache();
  await c.run('t4LoadServer()');
  assert.equal(c.run('T4_SERVER_READY'), true);
  assert.equal(c.run('T4_CHM.gift.n'), '共享渠道');
  assert.equal(c.run('T4.cfg.gift.platformFeeRate'), 0.05);
  assert.match(c.status.innerHTML, /本机缓存不可用/);
  c.run('T4.cfg.gift.platformFeeRate=0.08');
  await c.run('t4SaveCfg()');
  assert.equal(c.remote().document.cfgByPeriod['2099-12'].gift.platformFeeRate, 0.08);
  assert.equal(c.run('T4_SERVER_VERSION'), c.remote().version);
  await c.run('t4SaveCatalog("channels", [{id:"gift",n:"已更新渠道"}])');
  assert.equal(c.run('T4_CHM.gift.n'), '已更新渠道');
  assert.equal(c.run('T4_SERVER_ERROR'), null);
  c.run("T4.data.gift['2099-12-01']={retailIncome:321}");
  await c.run('t4Save()');
  assert.equal(c.remote().document.periods['2099-12'].gift['2099-12-01'].retailIncome, 321);
});

test('old migration draft cleanup does not block loading when the cache is full', async () => {
  const c = client();
  c.storage.set('fsc_t4_pending_migration_v1', JSON.stringify({ period: '2099-12', data: {}, cfg: {} }));
  const doc = c.remote().document;
  doc.periods['2099-12'] = { gift: { '2099-12-01': { retailIncome: 200 } } };
  c.seedRemote(doc); c.failCache();
  await c.run('t4LoadServer()');
  assert.equal(c.run('T4_SERVER_READY'), true);
  assert.equal(c.run('T4.data.gift["2099-12-01"].retailIncome'), 200);
  assert.equal(c.run('T4_CHM.gift.n'), '共享渠道');
});

test('catalog acknowledgment preserves parameters edited while the request is pending', async () => {
  const c = client(); await c.run('t4LoadServer()');
  const gate = c.gatePut();
  const saving = c.run('t4SaveCatalog("channels", [{id:"gift",n:"已更新渠道"}])');
  await gate.arrived;
  c.run('T4.cfg.gift.platformFeeRate=0.13');
  gate.release(); await saving;
  assert.equal(c.run('T4.cfg.gift.platformFeeRate'), 0.13);
  assert.equal(c.remote().document.cfgByPeriod['2099-12'].gift.platformFeeRate, 0.05);
  assert.equal(c.run('T4_SERVER_BASELINE.cfgByPeriod["2099-12"].gift.platformFeeRate'), 0.05);
  await c.run('t4SaveCfg()');
  assert.equal(c.remote().document.cfgByPeriod['2099-12'].gift.platformFeeRate, 0.13);
});

test('failed writes show a connection problem and a successful retry clears it', async () => {
  const c = client(); await c.run('t4LoadServer()');
  c.run('T4.cfg.gift.platformFeeRate=0.08'); c.fail(503);
  await assert.rejects(c.run('t4SaveCfg()'));
  assert.match(c.status.innerHTML, /连接中断/);
  assert.equal(c.run('T4.cfg.gift.platformFeeRate'), 0.08);
  c.fail(0); await c.run('t4SaveCfg()');
  assert.doesNotMatch(c.status.innerHTML, /连接中断/);
});
