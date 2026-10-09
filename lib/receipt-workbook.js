/* ReceiptWorkbook: browser-only, dependency-free receipt workbook reader.
 * Images are inflated only for duplicate-content candidates or image() requests. Export is append-only: every
 * original ZIP byte is retained, with a new central directory replacing only
 * patched worksheets and, when needed, appended cell styles. No workbook
 * reconstruction or formula evaluation.
 */
(function (global) {
  'use strict';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
  const LIMITS = Object.freeze({ fileBytes: 200 * 1024 * 1024, entries: 12000, expandedBytes: 512 * 1024 * 1024, entryBytes: 100 * 1024 * 1024, xmlBytes: 24 * 1024 * 1024, rows: 200000 });
  const fail = text => { throw new Error(text); };
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  const elements = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const direct = (node, name) => Array.from(node.children || []).filter(c => c.localName === name);
  function attr(node, name) { return node && Array.from(node.attributes).find(a => a.localName === name)?.value || ''; }
  function parseXML(bytes, name) {
    if (bytes.length > LIMITS.xmlBytes) fail('XML 内容过大：' + name);
    const text = dec.decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('不支持包含外部实体的 XML：' + name);
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (elements(doc, 'parsererror').length) fail('XML 损坏：' + name);
    return { doc, text };
  }
  function targetPath(source, target) {
    if (!target || /[\\\x00-\x1f]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target)) return null;
    let decoded; try { decoded = decodeURIComponent(target); } catch (_) { fail('工作簿关系路径编码损坏'); }
    if (/[\\\x00-\x1f?#]/.test(decoded)) fail('不支持的工作簿关系路径');
    const parts = decoded.startsWith('/') ? [] : source.split('/').slice(0, -1);
    for (const p of decoded.split('/')) { if (!p || p === '.') continue; if (p === '..') { if (!parts.length) fail('工作簿关系路径越界'); parts.pop(); } else parts.push(p); }
    return parts.join('/');
  }
  function relPath(source) { const p = source.split('/'); return p.slice(0, -1).concat('_rels', p[p.length - 1] + '.rels').join('/'); }
  function colNumber(name) { let n = 0; for (const c of name) n = n * 26 + c.charCodeAt(0) - 64; return n; }
  function cellRef(value) { const m = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value || ''); if (!m || colNumber(m[1]) > 16384 || +m[2] > 1048576) fail('单元格坐标损坏'); return { column: m[1], row: +m[2] }; }
  const normalize = s => String(s == null ? '' : s).replace(/\s/g, '').replace(/[（(].*?[）)]/g, '');
  const trim = s => String(s == null ? '' : s).trim();
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  class Zip {
    constructor(buffer) {
      this.bytes = new Uint8Array(buffer); this.entries = new Map(); this.cache = new Map();
      const b = this.bytes, v = new DataView(buffer);
      if (b.length > LIMITS.fileBytes) fail('文件超过 200 MB，请拆分后导入');
      const bounds = (p, n) => { if (!Number.isSafeInteger(p) || p < 0 || n < 0 || p + n > b.length) fail('ZIP 文件损坏或下载未完成'); };
      let end = -1;
      for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--) if (v.getUint32(p, true) === 0x06054b50 && p + 22 + v.getUint16(p + 20, true) === b.length) { end = p; break; }
      if (end < 0) fail('不是完整的 xlsx 文件（ZIP 结束记录缺失）');
      if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) fail('不支持分卷 ZIP');
      const count = v.getUint16(end + 10, true), size = v.getUint32(end + 12, true), offset = v.getUint32(end + 16, true);
      if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) fail('不支持 ZIP64 工作簿');
      if (count !== v.getUint16(end + 8, true) || count > LIMITS.entries || !count) fail('ZIP 条目数量异常');
      bounds(offset, size); if (offset + size !== end) fail('ZIP 中央目录损坏');
      this.comment = b.slice(end + 22); let p = offset, total = 0; const ranges = [];
      for (let i = 0; i < count; i++) {
        bounds(p, 46); if (v.getUint32(p, true) !== 0x02014b50) fail('ZIP 中央目录损坏');
        const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
        const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
        if (flags & 1 || flags & 64) fail('不支持加密工作簿');
        if (![0, 8].includes(method) || v.getUint16(p + 34, true)) fail('不支持此 ZIP 压缩格式');
        if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) fail('不支持 ZIP64 工作簿');
        if (usize > LIMITS.entryBytes || (total += usize) > LIMITS.expandedBytes || (usize > 1024 * 1024 && usize > Math.max(csize, 1) * 1000)) fail('ZIP 解压大小超过安全限制');
        bounds(p, 46 + nlen + elen + clen);
        if (p + 46 + nlen + elen + clen > offset + size) fail('ZIP 中央目录越界');
        for (let q = p + 46 + nlen; q < p + 46 + nlen + elen;) {
          if (q + 4 > p + 46 + nlen + elen) fail('ZIP 扩展字段损坏');
          const tag = v.getUint16(q, true), length = v.getUint16(q + 2, true);
          if (tag === 1) fail('不支持 ZIP64 工作簿');
          q += 4 + length; if (q > p + 46 + nlen + elen) fail('ZIP 扩展字段越界');
        }
        const nameBytes = b.slice(p + 46, p + 46 + nlen), name = dec.decode(nameBytes);
        if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(x => x === '..' || x === '.') || /[\x00-\x1f]/.test(name) || this.entries.has(name)) fail('ZIP 路径重复或不安全');
        bounds(local, 30); if (v.getUint32(local, true) !== 0x04034b50) fail('ZIP 本地记录损坏');
        if (v.getUint16(local + 6, true) !== flags || v.getUint16(local + 8, true) !== method) fail('ZIP 记录不一致');
        const ln = v.getUint16(local + 26, true), le = v.getUint16(local + 28, true), start = local + 30 + ln + le;
        bounds(local + 30, ln + le); bounds(start, csize);
        if (dec.decode(b.subarray(local + 30, local + 30 + ln)) !== name || start + csize > offset) fail('ZIP 本地记录越界');
        if (!(flags & 8) && (v.getUint32(local + 14, true) !== crc || v.getUint32(local + 18, true) !== csize || v.getUint32(local + 22, true) !== usize)) fail('ZIP 长度或校验记录不一致');
        if (method === 0 && csize !== usize) fail('ZIP 存储长度错误');
        const entry = { name, nameBytes, flags, method, crc, csize, usize, local, start, central: b.slice(p, p + 46 + nlen + elen + clen) };
        this.entries.set(name, entry); ranges.push([local, start + csize]); p += 46 + nlen + elen + clen;
      }
      if (p !== offset + size) fail('ZIP 中央目录长度不一致');
      ranges.sort((a, b) => a[0] - b[0]); for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail('ZIP 条目重叠');
    }
    has(name) { return this.entries.has(name); }
    async read(name, xml) {
      const e = this.entries.get(name); if (!e) fail('工作簿缺少文件：' + name);
      if (xml && e.usize > LIMITS.xmlBytes) fail('XML 内容过大：' + name);
      if (xml && this.cache.has(name)) return this.cache.get(name);
      const raw = this.bytes.subarray(e.start, e.start + e.csize); let data = raw;
      if (e.method === 8) {
        if (typeof DecompressionStream !== 'function') fail('浏览器不支持 xlsx 解压，请使用新版 Chrome 或 Edge');
        const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        const chunks = []; let total = 0;
        try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > e.usize || total > LIMITS.entryBytes) { await reader.cancel(); fail('ZIP 实际解压大小异常'); } chunks.push(value); } }
        finally { reader.releaseLock(); }
        data = new Uint8Array(total); let p = 0; for (const chunk of chunks) { data.set(chunk, p); p += chunk.length; }
      }
      if (data.length !== e.usize || crc32(data) !== e.crc) fail('ZIP 数据校验失败：' + name);
      if (xml) this.cache.set(name, data);
      return data;
    }
    async xml(name) { return parseXML(await this.read(name, true), name); }
    async rels(source) {
      const path = source ? relPath(source) : '_rels/.rels'; if (!this.has(path)) return new Map();
      const { doc } = await this.xml(path), result = new Map();
      for (const r of elements(doc, 'Relationship')) {
        const id = r.getAttribute('Id'); if (!id || result.has(id)) fail('工作簿关系 ID 重复');
        result.set(id, { path: r.getAttribute('TargetMode') === 'External' ? null : targetPath(source, r.getAttribute('Target')), type: r.getAttribute('Type') || '' });
      }
      return result;
    }
    export(replacements) {
      const parts = [this.bytes], central = []; let offset = this.bytes.length;
      for (const e of this.entries.values()) {
        if (!replacements.has(e.name)) { central.push(e.central); continue; }
        const data = enc.encode(replacements.get(e.name)), crc = crc32(data), flags = e.flags & ~(8 | 6), lh = new Uint8Array(30 + e.nameBytes.length), lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true);
        lh.set(e.central.subarray(12, 16), 10); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, e.nameBytes.length, true); lh.set(e.nameBytes, 30);
        const nameLength = e.nameBytes.length, extraLength = new DataView(e.central.buffer).getUint16(30, true), commentLength = new DataView(e.central.buffer).getUint16(32, true);
        const ch = new Uint8Array(46 + nameLength + commentLength); ch.set(e.central.subarray(0, 46 + nameLength)); ch.set(e.central.subarray(46 + nameLength + extraLength), 46 + nameLength);
        const cv = new DataView(ch.buffer); cv.setUint16(30, 0, true);
        cv.setUint16(6, 20, true); cv.setUint16(8, flags, true); cv.setUint16(10, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint32(42, offset, true);
        parts.push(lh, data); central.push(ch); offset += lh.length + data.length;
      }
      const size = central.reduce((sum, b) => sum + b.length, 0), end = new Uint8Array(22 + this.comment.length), ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true); ev.setUint16(20, this.comment.length, true); end.set(this.comment, 22);
      return new Blob(parts.concat(central, [end]), { type: MIME });
    }
  }

  function textValue(c, shared) {
    const type = c.getAttribute('t');
    if (type === 'inlineStr') return elements(c, 't').map(t => t.textContent).join('');
    const raw = direct(c, 'v')[0]?.textContent || '';
    if (type === 's') { if (!/^\d+$/.test(raw) || +raw >= shared.length) fail('共享字符串索引损坏'); return shared[+raw]; }
    return raw;
  }
  function readRows(doc, shared) {
    const data = elements(doc, 'sheetData')[0]; if (!data) fail('工作表没有 sheetData');
    const rows = new Map(); let cells = 0;
    for (const el of direct(data, 'row')) {
      const n = +el.getAttribute('r'); if (!Number.isInteger(n) || n < 1 || n > 1048576 || rows.has(n)) fail('工作表行号重复或无效');
      if (rows.size >= LIMITS.rows) fail('工作表行数超过限制');
      const row = { row: n, cells: new Map(), element: el };
      for (const c of direct(el, 'c')) {
        const ref = cellRef(c.getAttribute('r')); if (ref.row !== n || row.cells.has(ref.column)) fail('单元格坐标重复或不属于当前行');
        if (++cells > 2000000) fail('工作表单元格数量超过限制');
        row.cells.set(ref.column, { value: textValue(c, shared), formula: direct(c, 'f')[0]?.textContent ?? null, element: c });
      }
      rows.set(n, row);
    }
    return rows;
  }
  const HEADERS = { amount: ['支出金额'], image: ['支付截图', '付款截图', '支付凭证'], month: ['月份'], status: ['核对', '核对状态'], label: ['支出项目', '项目'], note: ['备注'], date: ['日期'], category: ['类别'], order: ['订单号'] };
  const REQUIRED = ['amount', 'image', 'month', 'status'];
  function headerInfo(rows) {
    let best = { row: 0, columns: {}, duplicates: [], score: 0 };
    for (const row of Array.from(rows.values()).sort((a, b) => a.row - b.row).slice(0, 30)) {
      const columns = {}, duplicates = [];
      for (const [col, c] of row.cells) for (const [key, choices] of Object.entries(HEADERS)) if (choices.includes(normalize(c.value))) { if (columns[key]) duplicates.push(key); else columns[key] = col; }
      const score = REQUIRED.filter(k => columns[k]).length;
      if (score > best.score) best = { row: row.row, columns, duplicates, score };
    }
    return best;
  }
  function amountValue(value) {
    const s = trim(value).replace(/[,，\s¥￥]/g, '');
    return /^-?\d+(?:\.\d+)?$/.test(s) ? s : null;
  }
  function getImages(cell, cellImages, zip, issues) {
    if (!cell) return [];
    const source = (cell.formula || '') + '\n' + cell.value;
    const matches = Array.from(source.matchAll(/(?:_xlfn\.)?DISPIMG\s*\(\s*"([^"]+)"/gi));
    const names = Array.from(new Set(matches.map(m => m[1]))), result = [];
    for (const name of names) {
      const paths = cellImages.get(name) || [];
      if (!paths.length) issues.push('图片引用未找到：' + name);
      for (const path of paths) { if (zip.has(path)) result.push({ ref: path, path, kind: 'dispimg' }); else issues.push('图片文件缺失：' + name); }
    }
    return result;
  }
  async function loadCellImages(zip, workbookRels) {
    const paths = Array.from(workbookRels.values()).filter(r => /\/cellImage$/i.test(r.type) && r.path).map(r => r.path);
    if (!paths.length && zip.has('xl/cellimages.xml')) paths.push('xl/cellimages.xml');
    const map = new Map();
    for (const path of paths) {
      const { doc } = await zip.xml(path), rels = await zip.rels(path);
      for (const img of elements(doc, 'cellImage')) {
        const name = elements(img, 'cNvPr')[0]?.getAttribute('name'); if (!name) continue;
        const refs = elements(img, 'blip').map(b => rels.get(attr(b, 'embed'))?.path).filter(Boolean);
        map.set(name, Array.from(new Set((map.get(name) || []).concat(refs))));
      }
    }
    return map;
  }
  async function loadDrawings(zip, path, doc, imageColumn) {
    const result = new Map(), rels = await zip.rels(path), warnings = [];
    const add = (row, value) => { if (!result.has(row)) result.set(row, []); result.get(row).push(value); };
    for (const drawing of elements(doc, 'drawing')) {
      const target = rels.get(attr(drawing, 'id'))?.path;
      if (!target || !zip.has(target)) { warnings.push('工作表绘图引用缺失'); continue; }
      const { doc: d } = await zip.xml(target), dr = await zip.rels(target);
      for (const anchor of Array.from(d.documentElement.children)) {
        if (!['oneCellAnchor', 'twoCellAnchor'].includes(anchor.localName)) { if (elements(anchor, 'blip').length) warnings.push('存在无法按行定位的浮动图片'); continue; }
        const from = direct(anchor, 'from')[0], to = direct(anchor, 'to')[0];
        const r = +(direct(from || {}, 'row')[0]?.textContent ?? -1) + 1, c = +(direct(from || {}, 'col')[0]?.textContent ?? -1) + 1;
        if (!Number.isInteger(r) || r < 1 || !Number.isInteger(c) || c < 1) { warnings.push('图片锚点无效'); continue; }
        if (!imageColumn || c !== colNumber(imageColumn)) continue;
        const endRow = to ? +(direct(to, 'row')[0]?.textContent ?? r - 1) + 1 : r;
        const endOffset = to ? +(direct(to, 'rowOff')[0]?.textContent || 0) : 0;
        const ambiguous = endRow > r + 1 || (endRow === r + 1 && endOffset > 0);
        const blips = elements(anchor, 'blip');
        for (const b of blips) {
          const image = dr.get(attr(b, 'embed'))?.path;
          if (!image || !zip.has(image)) { add(r, { missing: true }); continue; }
          add(r, { ref: image, path: image, kind: 'drawing', cell: imageColumn + r, ambiguous });
        }
      }
    }
    return { map: result, warnings };
  }

  // Size/CRC only shortlist candidates. Exact comparison is required because
  // different payloads can have the same CRC. Other images remain compressed.
  async function markContentDuplicates(zip, imageUsage, internals) {
    const candidates = new Map();
    for (const use of imageUsage) {
      const entry = zip.entries.get(use.ref), key = entry.usize + ':' + entry.crc;
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(use);
    }
    for (const uses of candidates.values()) {
      if (uses.length < 2 || new Set(uses.flatMap(use => use.rows.map(p => p.sheetId + ':' + p.row))).size < 2) continue;
      const groups = [];
      for (const use of uses) {
        const bytes = await zip.read(use.ref);
        const same = groups.find(group => group.bytes.length === bytes.length && group.bytes.every((value, i) => value === bytes[i]));
        if (same) same.uses.push(use); else groups.push({ bytes, uses: [use] });
      }
      for (const group of groups) {
        if (group.uses.length < 2) continue;
        const positions = new Map();
        for (const use of group.uses) for (const p of use.rows) positions.set(p.sheetId + ':' + p.row, p);
        if (positions.size < 2) continue;
        for (const p of positions.values()) {
          const issues = internals.get(p.sheetId).sheet.rows.find(row => row.row === p.row).issues;
          if (!issues.includes('相同图片内容被多行使用')) issues.push('相同图片内容被多行使用');
        }
      }
    }
  }

  const xmlKey = node => node ? JSON.stringify([node.namespaceURI, node.localName,
    Array.from(node.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.name, a.value]).sort(),
    Array.from(node.children).map(xmlKey)]) : '';
  const monthKey = value => trim(value).replace(/^(?:\d{2})(\d{2})-(\d{2})$/, '$1$2');
  function rangeContains(range, column, row) {
    const parts = range.replace(/\$/g, '').split(':'), points = parts.map(p => /^([A-Z]{1,3})([1-9]\d*)$/.exec(p));
    // Unknown conditional-format ranges are left to Excel rather than painted over.
    if (!points.every(Boolean) || parts.length > 2) return true;
    const a = points[0], b = points[1] || a, c = colNumber(column);
    return c >= colNumber(a[1]) && c <= colNumber(b[1]) && row >= +a[2] && row <= +b[2];
  }
  function hasConditionalColor(internal, column, row) {
    return internal.conditionalRanges.some(range => rangeContains(range, column, row));
  }
  async function loadStyles(zip, rels) {
    const path = Array.from(rels.values()).find(r => /\/styles$/.test(r.type))?.path;
    if (!path || !zip.has(path)) return null;
    const { doc, text } = await zip.xml(path), root = doc.documentElement;
    if (root.localName !== 'styleSheet') return null;
    const cellXfs = direct(root, 'cellXfs')[0], fills = direct(direct(root, 'fills')[0] || {}, 'fill');
    const xfs = direct(cellXfs || {}, 'xf');
    if (!xfs.length || !fills.length) return null;
    const valid = (id, list) => /^\d+$/.test(String(id)) && +id < list.length;
    function effective(internal, raw, column) {
      const cell = raw.cells.get(column)?.element;
      let id = cell?.getAttribute('s'), explicit = id !== null && id !== undefined;
      if (!explicit && raw.element.hasAttribute('s') && !['0', 'false'].includes(raw.element.getAttribute('customFormat'))) { id = raw.element.getAttribute('s'); explicit = true; }
      if (!explicit) for (const col of internal.columnStyles) if (colNumber(column) >= +col.getAttribute('min') && colNumber(column) <= +col.getAttribute('max') && col.hasAttribute('style')) { id = col.getAttribute('style'); explicit = true; }
      if (!explicit) id = '0';
      if (!valid(id, xfs)) return null;
      const xf = xfs[+id], fillId = xf.getAttribute('fillId') || '0';
      if (!valid(fillId, fills)) return null;
      // Inherited named-style fills are not inferred from an explicitly disabled fill.
      if (['0', 'false'].includes(xf.getAttribute('applyFill')) && +fillId !== 0) return null;
      return { id: +id, explicit, fillId: +fillId, fillKey: xmlKey(fills[+fillId]) };
    }
    function colored(fillId) {
      const fill = fills[fillId], pattern = direct(fill, 'patternFill')[0];
      return !!direct(fill, 'gradientFill').length || !!pattern && !['none', 'gray125', ''].includes(pattern.getAttribute('patternType') || '');
    }
    function references(internal, kind) {
      const column = internal.columns[kind]; if (!column) return [];
      return internal.sheet.rows.flatMap(row => {
        const raw = internal.allRows.get(row.row), target = raw.cells.get(column);
        if (trim(row.status) !== '已核对' || !trim(target?.value) || target.formula !== null || hasConditionalColor(internal, column, row.row)) return [];
        if (internal.merges.some(range => rangeContains(range, column, row.row))) return [];
        const style = effective(internal, raw, column);
        return style ? [{ ...style, row: row.row, month: monthKey(row.month) }] : [];
      });
    }
    function editor() {
      // Each export starts from the immutable original styles, including repeated exports.
      const additions = [], known = new Map(xfs.map((xf, i) => [xmlKey(xf), i]));
      function styleFor(internal, raw, kind, month) {
        const column = internal.columns[kind];
        if (hasConditionalColor(internal, column, raw.row)) return undefined;
        const samples = internal.colorReferences[kind], matching = samples.filter(s => s.month === monthKey(month));
        const candidates = matching.length ? matching : samples;
        if (!candidates.length || new Set(candidates.map(s => s.fillKey)).size !== 1) return undefined;
        const source = candidates.reduce((a, b) => Math.abs(a.row - raw.row) <= Math.abs(b.row - raw.row) ? a : b);
        const base = effective(internal, raw, column); if (!base) return undefined;
        if (!raw.cells.has(column) && !base.explicit) return source.id;
        if (base.fillKey === source.fillKey || colored(base.fillId)) return undefined;
        const xf = xfs[base.id].cloneNode(true); xf.setAttribute('fillId', String(source.fillId)); xf.setAttribute('applyFill', '1');
        const key = xmlKey(xf); if (known.has(key)) return known.get(key);
        const id = xfs.length + additions.length; additions.push(xf); known.set(key, id); return id;
      }
      function replacement() {
        if (!additions.length) return null;
        let hits = 0;
        const updated = text.replace(/<((?:[A-Za-z_][\w.-]*:)?cellXfs)\b[^>]*>[\s\S]*?<\/\1\s*>/g, whole => {
          hits++;
          const start = whole.indexOf('>'), tag = /^<([^\s/>]+)/.exec(whole)[1];
          const opening = whole.slice(0, start).replace(/\s+count\s*=\s*(?:"[^"]*"|'[^']*')/g, '') + ` count="${xfs.length + additions.length}">`;
          return opening + whole.slice(start + 1).replace(new RegExp('</' + tag + '\\s*>$'), additions.map(xf => new XMLSerializer().serializeToString(xf)).join('') + `</${tag}>`);
        });
        if (hits !== 1 || direct(elements(parseXML(enc.encode(updated), '导出样式').doc, 'cellXfs')[0] || {}, 'xf').length !== xfs.length + additions.length) fail('导出后的颜色样式校验失败');
        return [path, updated];
      }
      return { styleFor, replacement };
    }
    return { references, editor };
  }

  // Patch the original XML string instead of serializing the document: all
  // unmodified cell markup, extension namespaces and WPS metadata stay intact.
  function patchSheet(text, changes) {
    const byRow = new Map(); for (const change of changes) { if (!byRow.has(change.row)) byRow.set(change.row, []); byRow.get(change.row).push(change); }
    let hits = 0;
    const changed = text.replace(/<((?:[A-Za-z_][\w.-]*:)?row)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g, whole => {
      const open = whole.slice(0, whole.indexOf('>') + 1), rowMatch = /\br\s*=\s*["'](\d+)["']/.exec(open), row = rowMatch ? +rowMatch[1] : 0;
      if (!byRow.has(row)) return whole;
      hits++; let updated = whole;
      for (const change of byRow.get(row)) {
        const ref = change.column + row, cellRegex = /<((?:[A-Za-z_][\w.-]*:)?c)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g;
        let found = false;
        updated = updated.replace(cellRegex, cell => {
          const op = cell.slice(0, cell.indexOf('>') + 1), m = /\br\s*=\s*["']([^"']+)["']/.exec(op);
          if (!m || m[1] !== ref) return cell;
          if (found) fail('目标单元格重复'); found = true;
          const tag = /^<([^\s/>]+)/.exec(op)[1], prefix = tag.includes(':') ? tag.split(':')[0] + ':' : '';
          let attributes = op.slice(tag.length + 1).replace(/\/?\s*>$/, '').replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
          if (change.style !== undefined) attributes = attributes.replace(/\s+s\s*=\s*(?:"[^"]*"|'[^']*')/g, '') + ` s="${change.style}"`;
          return `<${tag}${attributes} t="inlineStr"><${prefix}is><${prefix}t>${esc(change.value)}</${prefix}t></${prefix}is></${tag}>`;
        });
        if (!found) {
          const rowTag = /^<([^\s/>]+)/.exec(updated)[1], prefix = rowTag.includes(':') ? rowTag.split(':')[0] + ':' : '';
          const add = `<${prefix}c r="${ref}"${change.style === undefined ? '' : ` s="${change.style}"`} t="inlineStr"><${prefix}is><${prefix}t>${esc(change.value)}</${prefix}t></${prefix}is></${prefix}c>`;
          if (/\/>$/.test(updated)) updated = updated.replace(/\/>$/, '>' + add + `</${rowTag}>`);
          else {
            let inserted = false;
            updated = updated.replace(cellRegex, cell => { const m = /\br\s*=\s*["']([A-Z]+)\d+["']/.exec(cell.slice(0, cell.indexOf('>') + 1)); if (!inserted && m && colNumber(m[1]) > colNumber(change.column)) { inserted = true; return add + cell; } return cell; });
            if (!inserted) updated = updated.replace(new RegExp('</' + rowTag + '\\s*>$'), add + `</${rowTag}>`);
          }
        }
      }
      return updated;
    });
    if (hits !== byRow.size) fail('导出时无法唯一定位目标行');
    const verified = parseXML(enc.encode(changed), '导出工作表').doc, cells = elements(verified, 'c');
    for (const change of changes) {
      const matches = cells.filter(c => c.getAttribute('r') === change.column + change.row);
      if (matches.length !== 1 || matches[0].getAttribute('t') !== 'inlineStr' || textValue(matches[0], []) !== change.value || direct(matches[0], 'f').length) fail('导出后的目标单元格校验失败');
      if (change.style !== undefined && matches[0].getAttribute('s') !== String(change.style)) fail('导出后的目标颜色校验失败');
    }
    return changed;
  }

  async function open(file) {
    if (!file || typeof file.arrayBuffer !== 'function') fail('请选择完整的 xlsx 文件');
    if (file.size > LIMITS.fileBytes) fail('文件超过 200 MB，请拆分后导入');
    const zip = new Zip(await file.arrayBuffer()), rootRels = await zip.rels('');
    const workbookPath = Array.from(rootRels.values()).find(r => /\/officeDocument$/.test(r.type))?.path || 'xl/workbook.xml';
    const { doc: workbook } = await zip.xml(workbookPath), rels = await zip.rels(workbookPath), sharedRel = Array.from(rels.values()).find(r => /\/sharedStrings$/.test(r.type));
    const shared = sharedRel?.path ? elements((await zip.xml(sharedRel.path)).doc, 'si').map(si => elements(si, 't').map(t => t.textContent).join('')) : [];
    const styles = await loadStyles(zip, rels), cellImages = await loadCellImages(zip, rels), sheets = [], internals = new Map(), imageUsageMap = new Map();
    for (const el of elements(workbook, 'sheet')) {
      const id = el.getAttribute('sheetId'), name = el.getAttribute('name') || id, path = rels.get(attr(el, 'id'))?.path;
      if (!id || internals.has(id) || !path) fail('工作表引用重复或缺失');
      const { doc, text } = await zip.xml(path), allRows = readRows(doc, shared), header = headerInfo(allRows), columns = header.columns;
      const issues = REQUIRED.filter(k => !columns[k]).map(k => '缺少表头：' + HEADERS[k][0]);
      if (header.duplicates.length) issues.push('表头重复，无法唯一定位列');
      const drawings = await loadDrawings(zip, path, doc, columns.image); issues.push(...drawings.warnings);
      const sheet = { id, name, headerRow: header.row, columns, canExport: !issues.length, issues, rows: [] };
      const merges = elements(doc, 'mergeCell').map(e => e.getAttribute('ref')).filter(Boolean);
      for (const raw of allRows.values()) {
        if (raw.row <= header.row || !columns.amount) continue;
        const value = key => raw.cells.get(columns[key])?.value || '';
        const amount = amountValue(value('amount')); if (amount === null) continue;
        const labelValues = [value('label'), value('category'), value('date')].map(normalize);
        const amountCell = raw.cells.get(columns.amount), amountFormula = amountCell?.formula || '';
        const hasAmountFormula = amountCell && amountCell.formula !== null;
        if (labelValues.some(v => /^(?:总计|合计|小计|汇总|累计|本[月期]合计|支出合计|合计金额)[：:]?$/.test(v)) || /\b(?:SUM|SUBTOTAL|AGGREGATE)\s*\(/i.test(amountFormula)) continue;
        const rowIssues = hasAmountFormula ? ['支出金额为公式，请确认重算结果'] : [], images = getImages(raw.cells.get(columns.image), cellImages, zip, rowIssues).map(img => ({ ...img, cell: columns.image + raw.row }));
        for (const img of drawings.map.get(raw.row) || []) { if (img.missing) rowIssues.push('图片文件缺失'); else images.push(img); }
        if (!images.length) rowIssues.push('缺少支付截图');
        if (images.length > 1) rowIssues.push('同一行包含多张截图');
        if (images.some(i => i.ambiguous)) rowIssues.push('浮动截图跨行，需确认所属行');
        const status = value('status'), month = value('month'), eligible = trim(status) === '';
        for (const kind of ['month', 'status']) {
          const column = columns[kind], target = raw.cells.get(column);
          if (target && target.formula !== null) rowIssues.push('目标' + HEADERS[kind][0] + '单元格含公式');
          if (column) for (const merge of merges) {
            const pair = merge.split(':'); if (pair.length !== 2) continue;
            const a = cellRef(pair[0]), b = cellRef(pair[1]);
            if (raw.row >= a.row && raw.row <= b.row && colNumber(column) >= colNumber(a.column) && colNumber(column) <= colNumber(b.column)) rowIssues.push('目标' + HEADERS[kind][0] + '为合并单元格');
          }
        }
        const row = { row: raw.row, amount, label: value('label') || value('category') || '第 ' + raw.row + ' 行', month, status, note: value('note'), date: value('date'), category: value('category'), order: value('order'), images, eligible, issues: rowIssues };
        sheet.rows.push(row);
        for (const image of images) {
          if (!imageUsageMap.has(image.ref)) imageUsageMap.set(image.ref, { ref: image.ref, rows: [] });
          const uses = imageUsageMap.get(image.ref).rows; if (!uses.some(use => use.sheetId === id && use.row === row.row)) uses.push({ sheetId: id, row: row.row });
        }
      }
      const internal = { sheet, allRows, path, text, merges, columns: { ...columns }, canExport: sheet.canExport,
        columnStyles: elements(doc, 'col'), conditionalRanges: elements(doc, 'conditionalFormatting').flatMap(c => (c.getAttribute('sqref') || elements(c, 'sqref')[0]?.textContent || '').trim().split(/\s+/).filter(Boolean)) };
      if (styles) internal.colorReferences = { month: styles.references(internal, 'month'), status: styles.references(internal, 'status') };
      sheets.push(sheet); internals.set(id, internal);
    }
    if (!sheets.length) fail('工作簿中没有工作表');
    const imageUsage = Array.from(imageUsageMap.values());
    for (const use of imageUsage) if (use.rows.length > 1) for (const position of use.rows) internals.get(position.sheetId).sheet.rows.find(r => r.row === position.row).issues.push('同一图片被多行引用');
    await markContentDuplicates(zip, imageUsage, internals);
    for (const internal of internals.values()) internal.guards = new Map(internal.sheet.rows.map(row => [row.row, { eligible: row.eligible, issues: row.issues.slice(), imageCount: row.images.length }]));
    return {
      name: file.name || '费用明细.xlsx', sheets, imageUsage,
      async image(reference) {
        const ref = typeof reference === 'string' ? reference : reference?.ref;
        if (!imageUsageMap.has(ref)) fail('图片引用不属于该工作簿明细');
        const ext = ref.split('.').pop().toLowerCase(), types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };
        if (!types[ext]) fail('此图片格式不能在浏览器中识别：' + ext);
        return new Blob([await zip.read(ref)], { type: types[ext] });
      },
      async export(patches) {
        if (!Array.isArray(patches) || !patches.length) fail('没有可导出的核对结果');
        const changes = new Map(), seen = new Set(), styleEditor = styles?.editor();
        for (const patch of patches) {
          const id = String(patch.sheetId), internal = internals.get(id);
          if (!internal || !internal.canExport) fail('工作表缺少唯一的必要表头或图片定位存在异常');
          if (!Number.isInteger(patch.row)) fail('导出行号无效');
          const key = id + ':' + patch.row; if (seen.has(key)) fail('同一明细重复提交导出'); seen.add(key);
          const row = internal.guards.get(patch.row); if (!row || !row.eligible) fail('不能修改已核对或非明细行');
          if (row.issues.length || row.imageCount !== 1) fail('该行需要复核：' + row.issues.join('；'));
          if (patch.status !== '已核对' || typeof patch.month !== 'string' || !/^(?:\d{2}(?:0[1-9]|1[0-2])|\d{4}-(?:0[1-9]|1[0-2]))$/.test(patch.month)) fail('核对状态或月份格式无效');
          const raw = internal.allRows.get(patch.row);
          for (const [kind, value] of [['month', patch.month], ['status', patch.status]]) {
            const column = internal.columns[kind], cell = raw.cells.get(column);
            if (cell?.formula !== null && cell?.formula !== undefined) fail('不能覆盖公式单元格：' + column + patch.row);
            if (trim(cell?.value) !== '' && trim(cell.value) !== value) fail('不能覆盖已有不同值：' + column + patch.row);
            for (const merge of internal.merges) { const pair = merge.split(':'); if (pair.length !== 2) continue; const a = cellRef(pair[0]), b = cellRef(pair[1]); if (patch.row >= a.row && patch.row <= b.row && colNumber(column) >= colNumber(a.column) && colNumber(column) <= colNumber(b.column)) fail('不能自动写入合并单元格'); }
            if (!changes.has(internal.path)) changes.set(internal.path, []);
            changes.get(internal.path).push({ row: patch.row, column, value, style: styleEditor?.styleFor(internal, raw, kind, patch.month) });
          }
        }
        const replacements = new Map();
        for (const [path, rows] of changes) replacements.set(path, patchSheet(Array.from(internals.values()).find(x => x.path === path).text, rows));
        const styleReplacement = styleEditor?.replacement(); if (styleReplacement) replacements.set(...styleReplacement);
        return zip.export(replacements);
      }
    };
  }
  global.ReceiptWorkbook = Object.freeze({ open, limits: LIMITS });
})(typeof window !== 'undefined' ? window : globalThis);
