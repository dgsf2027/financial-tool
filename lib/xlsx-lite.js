/* xlsx-lite —— 零依赖表格解析
   支持：.xlsx（ZIP + sheetXML）/ .xls（OLE2 + BIFF8）/ .csv / .tsv / .txt（UTF-8 与 GBK 自动识别）
   仅做读取，不做写入。写入走 CSV。 */
(function (global) {
  'use strict';

  /* ---------- ZIP ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持解压 xlsx，请另存为 CSV 后再导入');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    // 找中央目录结束记录
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 xlsx 文件');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
      // 本地头
      const lnlen = dv.getUint16(lho + 26, true);
      const lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      const raw = u8.subarray(start, start + csize);
      files[name] = { method, raw };
      p += 46 + nlen + elen + clen;
    }
    const out = {};
    for (const name of Object.keys(files)) {
      const f = files[name];
      out[name] = f.method === 0 ? f.raw : await inflateRaw(f.raw);
    }
    return out;
  }

  /* ---------- XLS (OLE2 + BIFF8) ---------- */
  // 只实现财务导出表常见的 BIFF8 单元格类型：文本、数值、RK 数值与公式缓存值。
  // 数据仍只在浏览器内解析，用于兼容网银/平台导出的旧版 .xls。
  const CFB_END = 0xFFFFFFFE;
  const CFB_FREE = 0xFFFFFFFF;

  function cfbWorkbook(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const sig = [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1];
    if (!sig.every((b, i) => u8[i] === b)) throw new Error('不是有效的 xls 文件');
    const sectorSize = 1 << dv.getUint16(30, true);
    const miniSize = 1 << dv.getUint16(32, true);
    const firstDir = dv.getUint32(48, true);
    const cutoff = dv.getUint32(56, true);
    const firstMiniFat = dv.getUint32(60, true);
    const miniFatCount = dv.getUint32(64, true);
    const sector = sid => u8.subarray((sid + 1) * sectorSize, (sid + 2) * sectorSize);
    const validSid = sid => sid < 0xFFFFFFF0;

    const difat = [];
    for (let i = 0; i < 109; i++) {
      const sid = dv.getUint32(76 + i * 4, true);
      if (validSid(sid)) difat.push(sid);
    }
    let dsid = dv.getUint32(68, true), dleft = dv.getUint32(72, true);
    while (validSid(dsid) && dleft-- > 0) {
      const s = sector(dsid), sdv = new DataView(s.buffer, s.byteOffset, s.byteLength);
      const n = sectorSize / 4 - 1;
      for (let i = 0; i < n; i++) { const sid = sdv.getUint32(i * 4, true); if (validSid(sid)) difat.push(sid); }
      dsid = sdv.getUint32(n * 4, true);
    }
    const fat = [];
    difat.forEach(sid => {
      const s = sector(sid), sdv = new DataView(s.buffer, s.byteOffset, s.byteLength);
      for (let i = 0; i < sectorSize / 4; i++) fat.push(sdv.getUint32(i * 4, true));
    });
    const readChain = (start, size, table, getter, unit) => {
      const parts = []; let sid = start, guard = 0;
      while (validSid(sid) && guard++ < 200000) {
        parts.push(getter(sid)); sid = table[sid];
      }
      const want = size == null ? parts.length * unit : Math.min(size, parts.length * unit);
      const out = new Uint8Array(want); let p = 0;
      for (const part of parts) { if (p >= want) break; const n = Math.min(part.length, want - p); out.set(part.subarray(0, n), p); p += n; }
      return out;
    };
    const dir = readChain(firstDir, null, fat, sector, sectorSize);
    const entries = [];
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const d = new DataView(dir.buffer, dir.byteOffset + p, 128);
      const nlen = d.getUint16(64, true);
      if (nlen < 2) continue;
      const name = new TextDecoder('utf-16le').decode(dir.subarray(p, p + nlen - 2));
      entries.push({ name, type: dir[p + 66], start: d.getUint32(116, true), size: d.getUint32(120, true) });
    }
    const root = entries.find(e => e.type === 5);
    const book = entries.find(e => e.type === 2 && /^(Workbook|Book)$/i.test(e.name));
    if (!root || !book) throw new Error('xls 中没有找到工作簿数据');
    if (book.size >= cutoff) return readChain(book.start, book.size, fat, sector, sectorSize);

    const miniFatBytes = readChain(firstMiniFat, miniFatCount * sectorSize, fat, sector, sectorSize);
    const miniFat = [];
    const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(mdv.getUint32(i, true));
    const miniStream = readChain(root.start, root.size, fat, sector, sectorSize);
    const mini = sid => miniStream.subarray(sid * miniSize, (sid + 1) * miniSize);
    return readChain(book.start, book.size, miniFat, mini, miniSize);
  }

  function rkNumber(v) {
    const div100 = v & 1;
    let n;
    if (v & 2) n = v >> 2;
    else {
      const b = new ArrayBuffer(8), d = new DataView(b);
      d.setUint32(0, 0, true); d.setUint32(4, v & 0xFFFFFFFC, true);
      n = d.getFloat64(0, true);
    }
    return div100 ? n / 100 : n;
  }

  function parseSST(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const strings = []; let p = 8;
    const u16 = () => { const v = dv.getUint16(p, true); p += 2; return v; };
    const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };
    const total = bytes.length >= 8 ? dv.getUint32(4, true) : 0;
    while (p + 3 <= bytes.length && strings.length < total) {
      const chars = u16(), flags = bytes[p++];
      const rich = flags & 8 ? u16() : 0;
      const ext = flags & 4 ? u32() : 0;
      const wide = !!(flags & 1), n = chars * (wide ? 2 : 1);
      if (p + n > bytes.length) break;
      const enc = wide ? 'utf-16le' : 'windows-1252';
      let s;
      try { s = new TextDecoder(enc).decode(bytes.subarray(p, p + n)); }
      catch (e) { s = Array.from(bytes.subarray(p, p + n), b => String.fromCharCode(b)).join(''); }
      strings.push(s); p += n + rich * 4 + ext;
    }
    return strings;
  }

  function parseXLS(buf) {
    const b = cfbWorkbook(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const bounds = []; let sst = [];
    for (let p = 0; p + 4 <= b.length;) {
      const id = dv.getUint16(p, true), len = dv.getUint16(p + 2, true), q = p + 4;
      if (q + len > b.length) break;
      if (id === 0x0085 && len >= 8) {
        const off = dv.getUint32(q, true), chars = b[q + 6], wide = !!(b[q + 7] & 1);
        const n = chars * (wide ? 2 : 1);
        const name = new TextDecoder(wide ? 'utf-16le' : 'windows-1252').decode(b.subarray(q + 8, q + 8 + n));
        bounds.push({ off, name });
      } else if (id === 0x00FC) {
        const parts = [b.subarray(q, q + len)]; let np = q + len;
        while (np + 4 <= b.length && dv.getUint16(np, true) === 0x003C) {
          const nl = dv.getUint16(np + 2, true); parts.push(b.subarray(np + 4, np + 4 + nl)); np += 4 + nl;
        }
        const size = parts.reduce((n, x) => n + x.length, 0), joined = new Uint8Array(size);
        let jp = 0; parts.forEach(x => { joined.set(x, jp); jp += x.length; });
        sst = parseSST(joined);
      }
      p = q + len;
    }
    const start = bounds.length ? bounds[0].off : 0;
    const rows = [];
    const put = (r, c, v) => {
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= c) rows[r].push('');
      rows[r][c] = v;
    };
    for (let p = start; p + 4 <= b.length;) {
      const id = dv.getUint16(p, true), len = dv.getUint16(p + 2, true), q = p + 4;
      if (q + len > b.length || (id === 0x000A && p > start)) break;
      if (id === 0x00FD && len >= 10) put(dv.getUint16(q, true), dv.getUint16(q + 2, true), sst[dv.getUint32(q + 6, true)] || '');
      else if (id === 0x0203 && len >= 14) put(dv.getUint16(q, true), dv.getUint16(q + 2, true), dv.getFloat64(q + 6, true));
      else if (id === 0x027E && len >= 10) put(dv.getUint16(q, true), dv.getUint16(q + 2, true), rkNumber(dv.getUint32(q + 6, true)));
      else if (id === 0x00BD && len >= 12) {
        const r = dv.getUint16(q, true), c0 = dv.getUint16(q + 2, true), n = (len - 6) / 6;
        for (let i = 0; i < n; i++) put(r, c0 + i, rkNumber(dv.getUint32(q + 6 + i * 6, true)));
      } else if (id === 0x0006 && len >= 14) {
        const hi = dv.getUint16(q + 12, true);
        if (hi !== 0xFFFF) put(dv.getUint16(q, true), dv.getUint16(q + 2, true), dv.getFloat64(q + 6, true));
      } else if (id === 0x0205 && len >= 8) put(dv.getUint16(q, true), dv.getUint16(q + 2, true), b[q + 6] ? 1 : 0);
      else if (id === 0x0204 && len >= 8) {
        const r = dv.getUint16(q, true), c = dv.getUint16(q + 2, true), chars = dv.getUint16(q + 6, true);
        put(r, c, new TextDecoder('windows-1252').decode(b.subarray(q + 8, q + 8 + chars)));
      }
      p = q + len;
    }
    return rows;
  }

  /* ---------- XLSX ---------- */
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Excel 序列号 → yyyy-MM-dd
  function serialToDate(n) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return String(n);
    const p = x => String(x).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  async function parseXLSX(buf, wantSheet) {
    const zip = await unzip(buf);
    const dec = new TextDecoder('utf-8');
    const parser = new DOMParser();

    // 共享字符串
    let shared = [];
    if (zip['xl/sharedStrings.xml']) {
      const doc = parser.parseFromString(dec.decode(zip['xl/sharedStrings.xml']), 'application/xml');
      shared = Array.from(doc.getElementsByTagName('si')).map(si => {
        const ts = si.getElementsByTagName('t');
        let s = '';
        for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
        return s;
      });
    }

    // 日期样式：找出 numFmt 为日期的 cellXfs 索引
    const dateStyles = new Set();
    if (zip['xl/styles.xml']) {
      const sd = parser.parseFromString(dec.decode(zip['xl/styles.xml']), 'application/xml');
      const dateFmtIds = new Set([14,15,16,17,22,27,30,36,45,46,47,50,57,58]);
      Array.from(sd.getElementsByTagName('numFmt')).forEach(nf => {
        const code = nf.getAttribute('formatCode') || '';
        if (/[yYmMdD]/.test(code) && /[-/年]/.test(code)) dateFmtIds.add(+nf.getAttribute('numFmtId'));
      });
      const xfs = sd.getElementsByTagName('cellXfs')[0];
      if (xfs) Array.from(xfs.getElementsByTagName('xf')).forEach((xf, i) => {
        if (dateFmtIds.has(+(xf.getAttribute('numFmtId') || 0))) dateStyles.add(i);
      });
    }

    // 工作表清单（默认仍返回第一张；readSheets 会逐张要）
    const sheetNames = Object.keys(zip).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    const sheetName = sheetNames[wantSheet || 0] || sheetNames[0];
    if (!sheetName) throw new Error('xlsx 中没有找到工作表');
    parseXLSX._count = sheetNames.length;
    const doc = parser.parseFromString(dec.decode(zip[sheetName]), 'application/xml');

    const rows = [];
    Array.from(doc.getElementsByTagName('row')).forEach(tr => {
      const row = [];
      Array.from(tr.getElementsByTagName('c')).forEach(c => {
        const idx = colIndex(c.getAttribute('r'));
        const t = c.getAttribute('t');
        const s = c.getAttribute('s');
        let v = '';
        if (t === 'inlineStr') {
          const is = c.getElementsByTagName('is')[0];
          v = is ? is.textContent : '';
        } else {
          const vEl = c.getElementsByTagName('v')[0];
          const raw = vEl ? vEl.textContent : '';
          if (t === 's') v = shared[+raw] || '';
          else if (raw !== '' && s !== null && dateStyles.has(+s) && !isNaN(+raw)) v = serialToDate(+raw);
          else v = raw;
        }
        while (row.length < idx) row.push('');
        row[idx] = v;
      });
      rows.push(row);
    });
    return rows;
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    // 猜分隔符
    const head = text.slice(0, 4000);
    const cand = [',', '\t', ';', '|'];
    let sep = ',', best = -1;
    cand.forEach(s => {
      const n = (head.split('\n')[0] || '').split(s).length;
      if (n > best) { best = n; sep = s; }
    });
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    // BOM
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    // Excel「Unicode 文本」等 UTF-16 存法
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    const utf = new TextDecoder('utf-8', { fatal: false }).decode(u8);
    // 替换字符过多 → 判为 GBK
    const bad = (utf.match(/�/g) || []).length;
    if (bad > 2) {
      try { return new TextDecoder('gbk').decode(u8); } catch (e) { /* 忽略 */ }
    }
    return utf;
  }

  /* ---------- 统一入口 ---------- */
  async function readTable(file) {
    const buf = await file.arrayBuffer();
    // 按内容魔数识别格式，不信扩展名——平台导出和另存为经常名实不符
    const u8 = new Uint8Array(buf);
    const isZip = u8[0] === 0x50 && u8[1] === 0x4B;                                  // xlsx（改名成 .csv/.xls 也认）
    const isOle = u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0; // 老式 .xls
    let rows;
    if (isZip) rows = await parseXLSX(buf);
    else if (isOle) rows = parseXLS(buf);
    else rows = parseCSV(decodeText(buf));
    // 去掉全空行
    rows = rows.filter(r => r.some(c => String(c == null ? '' : c).trim() !== ''));
    if (!rows.length) throw new Error('文件里没有读到任何数据');
    return rows;
  }

  /* ---------- 表头定位 ---------- */
  // 银行流水常见前几行是标题/账号说明，真正表头往往在第 1—8 行
  function findHeaderRow(rows, keywords) {
    let best = 0, bestScore = -1;
    const scan = Math.min(rows.length, 12);
    for (let i = 0; i < scan; i++) {
      const cells = rows[i].map(c => String(c || '').replace(/\s/g, ''));
      const filled = cells.filter(c => c !== '').length;
      let hit = 0;
      cells.forEach(c => { if (keywords.some(k => c.includes(k))) hit++; });
      const score = hit * 10 + filled;
      if (hit >= 2 && score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /* 读 xlsx 的全部工作表，返回 [rows, rows, ...]。抖音账单这类
     「第一页汇总、第二页明细」的文件要靠它挑对页。CSV 只有一张。 */
  async function readSheets(file) {
    const buf = await file.arrayBuffer();
    if (!(new Uint8Array(buf)[0] === 0x50 && new Uint8Array(buf)[1] === 0x4B)) return [await readTable(file)];
    const first = await parseXLSX(buf, 0);
    const out = [first];
    for (let i = 1; i < (parseXLSX._count || 1); i++) out.push(await parseXLSX(buf, i));
    return out.map(rows => rows.filter(r => r.some(c => String(c == null ? '' : c).trim() !== '')));
  }
  global.XLSXLite = { readTable, readSheets, parseCSV, parseXLS, parseXLSX, decodeText, findHeaderRow };
})(window);
