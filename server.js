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

  // 套表生成：前端 POST 数据 JSON → Python(openpyxl) 生成多 Sheet 工作簿 → 回传 xlsx
  if (urlPath === '/api/t4/suite' && req.method === 'POST') {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 30 * 1024 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      const dir = path.join(ROOT, 'suite', '_out');
      fs.mkdirSync(dir, { recursive: true });
      const ts = Date.now();
      const inFile = path.join(dir, `input_${ts}.json`), outFile = path.join(dir, `suite_${ts}.xlsx`);
      fs.writeFileSync(inFile, Buffer.concat(chunks));
      const py = process.env.T4_PYTHON
        || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe') : 'python3');
      require('child_process').execFile(py, [path.join(ROOT, 'suite', 'build_suite.py'), inFile, outFile],
        { timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('套表生成失败：' + String(stderr || err.message).slice(0, 2000));
          }
          fs.readFile(outFile, (e, buf) => {
            fs.unlink(inFile, () => {});
            if (e) { res.writeHead(500); return res.end('读取生成文件失败'); }
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': 'attachment; filename="suite.xlsx"',
              'X-Suite-Log': encodeURIComponent(String(stdout || '').slice(0, 600)),
            });
            res.end(buf);
          });
        });
    });
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
