const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

let root, base, child, fakeLog, outDir;
const secret = 'mail-review-secret';
const fixedNow = 1700000000000;

function cookie() {
  const body = Buffer.from(JSON.stringify({ portalUid: 'mail-review', tenantId: 'test', exp: 4102444800000 })).toString('base64url');
  return `t4_session=${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function postMail(job) {
  return fetch(`${base}/api/t4/mail`, {
    method: 'POST',
    headers: { Cookie: cookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  });
}

async function postSuite(payload) {
  return fetch(`${base}/api/t4/suite`, {
    method: 'POST',
    headers: { Cookie: cookie(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function outEntries() {
  return fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-mail-review-'));
  outDir = path.join(root, 'suite', '_out');
  fakeLog = path.join(root, 'fake-mail.log');
  fs.mkdirSync(path.join(root, 'suite', '_cfg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'suite', '_cfg', 'mail.config.json'), JSON.stringify({
    host: 'smtp.invalid', port: 465, secure: 'ssl', user: 'sender@example.test', pass: 'test-pass', from: 'sender@example.test',
  }));
  fs.writeFileSync(fakeLog, '');
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(root, 'server.js'));

  // This fake Python executable delays reads and mail attachment inspection so
  // fixed Date.now() filenames would deterministically collide across jobs.
  const fakePython = path.join(root, 'fake-python.js');
  fs.writeFileSync(fakePython, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const script = path.basename(process.argv[2] || '');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  if (script === 'build_suite.py') {
    await wait(50);
    const input = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    if (input.failBuild) { process.stderr.write('fake build failure'); process.exitCode = 2; return; }
    fs.mkdirSync(path.dirname(process.argv[4]), { recursive: true });
    fs.writeFileSync(process.argv[4], JSON.stringify(input));
    process.stdout.write('fake build\\n');
    return;
  }
  if (script === 'send_mail.py') {
    const job = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    await wait(150);
    const results = job.sends.map(s => {
      const payload = JSON.parse(fs.readFileSync(s.attachment, 'utf8'));
      const result = { to: s.to, name: s.name || '', scopeName: s.scopeName, marker: payload.marker, ok: job.subject !== 'FAIL' };
      if (!result.ok) result.error = 'fake SMTP refusal';
      return result;
    });
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ job, results }) + '\\n');
    process.stdout.write(JSON.stringify(results) + '\\n');
  }
})().catch(e => { process.stderr.write(String(e.stack || e)); process.exitCode = 3; });
`);
  fs.chmodSync(fakePython, 0o755);
  const preload = path.join(root, 'fixed-date.js');
  fs.writeFileSync(preload, `Date.now = () => ${fixedNow};\n`);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], {
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, T4_SESSION_SECRET: secret, T4_PYTHON: fakePython, FAKE_LOG: fakeLog },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', c => { stderr += c.toString(); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`mail review server exited (${child.exitCode}): ${stderr}`);
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`mail review server did not start: ${stderr}`);
});

after(async () => {
  child?.kill();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('invalid, missing, and unknown recipient scopes fail before sender or attachment work', async () => {
  const response = await postMail({
    payloads: { all: { scopeName: '全部项目', period: '2026-09', marker: 'all' } },
    recipients: [
      { email: 'missing@example.test', name: 'Missing' },
      { email: 'unknown@example.test', name: 'Unknown', scope: 'not-a-scope' },
      { email: 'absent@example.test', name: 'Absent', scope: 'aole' },
    ],
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.deepEqual(result.failedRecipients.map(x => x.email), [
    'missing@example.test', 'unknown@example.test', 'absent@example.test',
  ]);
  assert.equal(fs.readFileSync(fakeLog, 'utf8'), '');
  assert.deepEqual(outEntries(), []);
});

test('concurrent jobs remain isolated when Date.now is identical', async () => {
  const baseJob = marker => ({
    subject: `job-${marker}`,
    payloads: { all: { scopeName: '全部项目', period: '2026-09', marker } },
    recipients: [{ email: `${marker.toLowerCase()}@example.test`, name: marker, scope: 'all' }],
  });
  const responses = await Promise.all([postMail(baseJob('A')), postMail(baseJob('B'))]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const lines = fs.readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const sent = Object.fromEntries(lines.flatMap(x => x.results.map(r => [r.to, r.marker])));
  assert.equal(sent['a@example.test'], 'A');
  assert.equal(sent['b@example.test'], 'B');
  assert.deepEqual(outEntries(), []);
});

test('suite and mail failures remove partial input, output, and job files', async () => {
  assert.equal((await postSuite({ scope: 'all', marker: 'download' })).status, 200);
  assert.deepEqual(outEntries(), []);

  assert.equal((await postSuite({ scope: 'all', marker: 'broken', failBuild: true })).status, 500);
  assert.deepEqual(outEntries(), []);

  const response = await postMail({
    subject: 'partial-build',
    payloads: {
      all: { scopeName: '全部项目', period: '2026-09', marker: 'all' },
      ruimian: { scopeName: '瑞眠项目', period: '2026-09', marker: 'broken', failBuild: true },
    },
    recipients: [{ email: 'all@example.test', scope: 'all' }, { email: 'rm@example.test', scope: 'ruimian' }],
  });
  assert.equal(response.status, 500);
  assert.deepEqual(outEntries(), []);

  const failedSend = await postMail({
    subject: 'FAIL',
    payloads: { all: { scopeName: '全部项目', period: '2026-09', marker: 'smtp' } },
    recipients: [{ email: 'smtp@example.test', scope: 'all' }],
  });
  assert.equal(failedSend.status, 200);
  assert.equal((await failedSend.json()).results[0].ok, false);
  assert.deepEqual(outEntries(), []);
});
