#!/usr/bin/env node
/* 财务中心 · 静态服务器（零依赖，只用 Node 内置模块）
   用法：node server.js [端口]     默认 5180 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 5180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ===== T4 套表 / 邮件接口（调用 suite/ 下的 Python 脚本） =====
const { execFile } = require('child_process');
const execFileP = require('util').promisify(execFile);
const PY = process.env.T4_PYTHON || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe') : 'python3');
const SUITE = path.join(ROOT, 'suite'), OUT = path.join(SUITE, '_out'), CFG = path.join(SUITE, '_cfg');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); reject(new Error('请求体过大')); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const sendText = (res, code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
const readJsonFile = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return fallback; } };
const runPy = (script, args) => execFileP(PY, [path.join(SUITE, script), ...args],
  { timeout: 180000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 10 * 1024 * 1024 });

// 数据包 → build_suite.py → xlsx 路径 + 校验日志
async function buildSuite(payloadBuf, tag) {
  fs.mkdirSync(OUT, { recursive: true });
  const ts = Date.now(), inFile = path.join(OUT, `input_${tag}_${ts}.json`), outFile = path.join(OUT, `suite_${tag}_${ts}.xlsx`);
  fs.writeFileSync(inFile, payloadBuf);
  try { const { stdout } = await runPy('build_suite.py', [inFile, outFile]); return { outFile, log: stdout }; }
  finally { fs.unlink(inFile, () => {}); }
}
// 发件配置状态（只返回是否就绪与非敏感字段，不返回授权码）
function mailStatus() {
  const cfg = readJsonFile(path.join(CFG, 'mail.config.json'), null);
  if (!cfg) return { configured: false, missing: ['suite/_cfg/mail.config.json 不存在'] };
  const missing = ['host', 'port', 'user', 'pass', 'from'].filter(k => !cfg[k]);
  return { configured: !missing.length, host: cfg.host, port: cfg.port, secure: cfg.secure || 'ssl', user: cfg.user,
    from: cfg.from, fromName: cfg.fromName || '', hasPass: !!cfg.pass, missing };
}
// 写一个无附件的发信任务并执行，返回逐人结果
async function runMailJob(subject, sends) {
  fs.mkdirSync(OUT, { recursive: true });
  const jobFile = path.join(OUT, `mailjob_${Date.now()}.json`);
  fs.writeFileSync(jobFile, JSON.stringify({ subject, sends }));
  try { const { stdout } = await runPy('send_mail.py', [path.join(CFG, 'mail.config.json'), jobFile]); return JSON.parse(stdout.trim().split('\n').pop()); }
  finally { fs.unlink(jobFile, () => {}); }
}

async function handleApi(req, res, urlPath) {
  if (urlPath === '/api/t4/suite' && req.method === 'POST') {
    const buf = await readBody(req);
    try {
      const { outFile, log } = await buildSuite(buf, 'dl');
      res.writeHead(200, { 'Content-Type': XLSX_MIME, 'Content-Disposition': 'attachment; filename="suite.xlsx"',
        'X-Suite-Log': encodeURIComponent(String(log || '').slice(0, 600)) });
      return res.end(fs.readFileSync(outFile));
    } catch (e) { return sendText(res, 500, '套表生成失败：' + String(e.stderr || e.message).slice(0, 2000)); }
  }
  if (urlPath === '/api/t4/recipients' && req.method === 'GET') return sendJson(res, 200, readJsonFile(path.join(CFG, 'recipients.json'), []));
  if (urlPath === '/api/t4/recipients' && req.method === 'POST') {
    const list = JSON.parse((await readBody(req)).toString('utf-8') || '[]');
    if (!Array.isArray(list)) return sendText(res, 400, '格式错误');
    fs.mkdirSync(CFG, { recursive: true });
    fs.writeFileSync(path.join(CFG, 'recipients.json'), JSON.stringify(list, null, 2));
    return sendJson(res, 200, { ok: true, count: list.length });
  }
  if (urlPath === '/api/t4/mail/status' && req.method === 'GET') return sendJson(res, 200, mailStatus());
  // 保存发件配置：授权码由用户在页面输入，只落服务器本地文件；留空则沿用已保存的授权码
  if (urlPath === '/api/t4/mail/config' && req.method === 'POST') {
    const c = JSON.parse((await readBody(req)).toString('utf-8') || '{}');
    const cur = readJsonFile(path.join(CFG, 'mail.config.json'), {}) || {};
    const cfg = { host: String(c.host || '').trim(), port: Number(c.port) || 465,
      secure: ['ssl', 'starttls', 'none'].includes(c.secure) ? c.secure : 'ssl',
      user: String(c.user || '').trim(), pass: c.pass ? String(c.pass) : (cur.pass || ''),
      from: String(c.from || c.user || '').trim(), fromName: String(c.fromName || '').trim() };
    const missing = [['host', 'SMTP 服务器'], ['user', '发件账号'], ['pass', '授权码']].filter(([k]) => !cfg[k]).map(x => x[1]);
    if (missing.length) return sendText(res, 400, '请填写：' + missing.join('、'));
    fs.mkdirSync(CFG, { recursive: true });
    fs.writeFileSync(path.join(CFG, 'mail.config.json'), JSON.stringify(cfg, null, 2));
    return sendJson(res, 200, mailStatus());
  }
  // 发一封测试邮件（无附件）验证配置
  if (urlPath === '/api/t4/mail/test' && req.method === 'POST') {
    const st = mailStatus();
    if (!st.configured) return sendText(res, 400, '发件邮箱未配置：' + st.missing.join('、'));
    const { to } = JSON.parse((await readBody(req)).toString('utf-8') || '{}');
    if (!to) return sendText(res, 400, '请填写测试收件地址');
    try {
      const results = await runMailJob('财务中心 · 发件配置测试', [{ to, name: '', scopeName: '测试',
        body: `这是财务中心 T4 套表的发件配置测试邮件。\n发件：${st.from}（${st.host}:${st.port}）\n时间：${new Date().toLocaleString('zh-CN')}\n\n收到此邮件即表示 SMTP 配置正确，可以正式发送套表。` }]);
      return sendJson(res, 200, { ok: true, results });
    } catch (e) { return sendText(res, 500, '测试发送失败：' + String(e.stderr || e.message).slice(0, 1500)); }
  }
  if (urlPath === '/api/t4/mail' && req.method === 'POST') {
    const st = mailStatus();
    if (!st.configured) return sendText(res, 400, '发件邮箱未配置：' + st.missing.join('、'));
    const job = JSON.parse((await readBody(req)).toString('utf-8'));
    const scopes = Object.keys(job.payloads || {});
    if (!scopes.length || !(job.recipients || []).length) return sendText(res, 400, '没有可发送的收件人');
    const files = {};
    for (const scope of scopes) {   // 每个范围只生成一份，多个收件人共用
      const p = job.payloads[scope];
      const { outFile } = await buildSuite(Buffer.from(JSON.stringify(p)), 'mail_' + scope);
      files[scope] = { path: outFile, filename: `T4日损益套表_${p.scopeName}_${p.period}.xlsx`, scopeName: p.scopeName, period: p.period, generated: p.generated };
    }
    const sends = job.recipients.filter(r => files[r.scope]).map(r => {
      const f = files[r.scope];
      return { to: r.email, name: r.name || '', attachment: f.path, filename: f.filename, scopeName: f.scopeName,
        body: (job.body ? job.body + '\n\n' : '') + `期间：${f.period}\n报表范围：${f.scopeName}\n生成时间：${f.generated}\n\n附件为财务中心 T4 日损益套表（Excel 工作簿：总表 → 事业部 → 渠道逐日明细，含超链接下钻）。` };
    });
    const jobFile = path.join(OUT, `mailjob_${Date.now()}.json`);
    fs.writeFileSync(jobFile, JSON.stringify({ subject: job.subject || 'T4 日损益套表', sends }));
    try {
      const { stdout } = await runPy('send_mail.py', [path.join(CFG, 'mail.config.json'), jobFile]);
      return sendJson(res, 200, { ok: true, results: JSON.parse(stdout.trim().split('\n').pop()) });
    } catch (e) { return sendText(res, 500, '发送失败：' + String(e.stderr || e.message).slice(0, 2000)); }
    finally { fs.unlink(jobFile, () => {}); }
  }
  sendText(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); return res.end('Bad request');
  }

  // 健康检查：给门户探活用
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, app: 'yc-finance-web', version: '1.0.0' }));
  }

  // T4 套表 / 邮件接口
  if (urlPath.startsWith('/api/t4/')) {
    handleApi(req, res, urlPath).catch(e => { try { sendText(res, 500, '接口错误：' + e.message); } catch (_) {} });
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  // 防目录穿越
  const target = path.normalize(path.join(ROOT, urlPath));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 回落
      const idx = path.join(ROOT, 'index.html');
      return fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(buf);
      });
    }
    fs.readFile(target, (e3, buf) => {
      if (e3) { res.writeHead(500); return res.end('Read error'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
    });
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  财务中心 · 已启动');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  一期：系统结构 + 工具箱（T1 资金日报 · T2 流水转凭证 · T3 对账核对 · T4 日损益）');
  console.log('  停止：Ctrl+C');
  console.log('');
});
