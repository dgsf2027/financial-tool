const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

let child, root, base;
const secret = 'isolated-test-secret';
function cookie(exp = Date.now() + 60000) {
  const body = Buffer.from(JSON.stringify({ portalUid: 'test', tenantId: 'test', exp })).toString('base64url');
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
  child = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], {
    env: { ...process.env, T4_SESSION_SECRET: secret, T4_PYTHON: path.join(root, 'missing-python') }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/healthz')).ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('test server did not start');
});
after(() => { child?.kill(); if (root) fs.rmSync(root, { recursive: true, force: true }); });

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
