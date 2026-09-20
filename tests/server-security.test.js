const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');

let child, root, base, portal;
const secret = 'isolated-test-secret';
function cookie(exp = Date.now() + 60000) {
  const body = Buffer.from(JSON.stringify({ portalUid: 'test', tenantId: 'test', name: '测试同事', exp })).toString('base64url');
  return 't4_session=' + body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-security-'));
  const src = path.resolve(__dirname, '..');
  for (const name of fs.readdirSync(src).filter(n => /\.(js|css|html)$/.test(n))) fs.copyFileSync(path.join(src, name), path.join(root, name));
  fs.cpSync(path.join(src, 'lib'), path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'suite', '_cfg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'suite', '_cfg', 'probe.txt'), 'NON_SECRET_PROBE');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  base = `http://127.0.0.1:${port}`;
  portal = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || '{}');
    const valid = req.url === '/api/v1/sso/verify' && input.authCode === 'valid-code' && input.appId === 'finance';
    res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(valid ? { code: 200, data: { portalUid: 'test', tenantId: 'test', name: '测试同事' } } : { code: 401 }));
  });
  await new Promise(resolve => portal.listen(0, '127.0.0.1', resolve));
  child = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], {
    env: { ...process.env, NODE_ENV: 'production', T4_SESSION_SECRET: secret, T4_PYTHON: path.join(root, 'missing-python'),
      T4_PORTAL_SSO_BASE: `http://127.0.0.1:${portal.address().port}/api`, T4_PORTAL_PUBLIC_URL: 'https://portal.example/apps' }, stdio: 'ignore',
  });
  // 整套测试并行跑时机器负载高（含多个 python 实例），3 秒不够，会偶发全绿变全红。
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited early (${child.exitCode})`);
    try { if ((await fetch(base + '/healthz')).ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('test server did not start within 30s');
});
after(async () => { child?.kill(); if (portal) await new Promise(resolve => portal.close(resolve)); if (root) fs.rmSync(root, { recursive: true, force: true }); });

test('direct visitors see their actual login state and a working login entry', async () => {
  const r = await fetch(base + '/api/session');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await r.json(), { authenticated: false, loginUrl: '/sso/login' });
  const signedIn = await (await fetch(base + '/api/session', { headers: { Cookie: cookie() } })).json();
  assert.deepEqual(signedIn, { authenticated: true, name: '测试同事', loginUrl: '/sso/login' });
  assert.equal((await (await fetch(base + '/api/session', { headers: { Cookie: cookie(1) } })).json()).authenticated, false);
  const html = await (await fetch(base)).text();
  assert.doesNotMatch(html, /潘海鹏|财务经理/);
  assert.match(html, /href="\/sso\/login"/);
});

test('login entry uses the configured portal without accepting redirect overrides', async () => {
  const r = await fetch(base + '/sso/login?next=https://untrusted.example', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://portal.example/apps');
});

test('portal callback creates a real session usable by the finance APIs', async () => {
  const callback = await fetch(base + '/sso/callback?auth_code=valid-code&app_id=finance', { redirect: 'manual' });
  assert.equal(callback.status, 302);
  const setCookie = callback.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Lax; Secure/);
  const headers = { Cookie: setCookie.split(';')[0] };
  const session = await (await fetch(base + '/api/session', { headers })).json();
  assert.equal(session.name, '测试同事');
  assert.equal((await fetch(base + '/api/t4/mail/status', { headers })).status, 200);
  const invalid = await fetch(base + '/sso/callback?auth_code=invalid', { redirect: 'manual' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get('set-cookie'), null);
});

test('every local script and stylesheet referenced by the page is public', async () => {
  const html = await (await fetch(base)).text();
  const assets = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m => m[1]);
  assert(assets.includes('t4-sync.js'));
  for (const asset of assets) assert.equal((await fetch(base + '/' + asset)).status, 200, asset);
});
test('internal files and encoded paths are denied without exposing fixture content', async () => {
  for (const p of ['/suite/_cfg/probe.txt','/suite/%5fcfg/probe.txt','/suite/_out/probe.txt','/.git/config','/.env','/server.js','/sync_api.py','/promo-fetch/config.js','/Dockerfile.web','/suite/_cfg-other/probe.txt']) {
    const r = await fetch(base + p); assert.equal(r.status, 403, p); assert(!((await r.text()).includes('NON_SECRET_PROBE')));
  }
});
test('mail and workspace APIs reject anonymous and forged browser headers', async () => {
  for (const [p, method] of [['mail/status','GET'],['recipients','GET'],['recipients','POST'],['mail/config','POST'],['mail/test','POST'],['mail','POST'],['suite','POST'],['workspace','GET']]) {
    const r = await fetch(base + '/api/t4/' + p, { method, headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin', 'X-T4-User': 'admin' } });
    assert.equal(r.status, 401, `${method} ${p}`);
  }
});
test('valid sessions work; malformed, tampered and expired sessions fail', async () => {
  assert.equal((await fetch(base+'/api/t4/mail/status',{headers:{Cookie:cookie()}})).status,200);
  for (const token of ['t4_session=%', cookie(1), cookie()+'x']) assert.equal((await fetch(base+'/api/t4/mail/status',{headers:{Cookie:token}})).status,401);
});
test('SSO rejects auth codes for another application', async () => {
  assert.equal((await fetch(base+'/sso/callback?auth_code=test&app_id=other')).status,400);
});
test('missing Python produces a clear error without reporting an SMTP password problem', async () => {
  const r=await fetch(base+'/api/t4/suite',{method:'POST',headers:{Cookie:cookie(),'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,500); assert.match(await r.text(),/服务器无法启动 Python/);
});
