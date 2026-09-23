const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const xlsxSource = fs.readFileSync(path.join(ROOT, 'lib/xlsx-lite.js'), 'utf8');

test('CSV delimiter detection ignores a single-cell title and quoted punctuation', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(xlsxSource, context);
  const rows = JSON.parse(JSON.stringify(context.window.XLSXLite.parseCSV('导出说明：本文件含有;和,符号\n"销售渠道";"归属事业部";备注\n"甲,店";大电商;"含;分号"\n')));
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    ['导出说明：本文件含有;和,符号'],
    ['销售渠道', '归属事业部', '备注'],
    ['甲,店', '大电商', '含;分号'],
  ]);
});

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(entries) {
  const enc = new TextEncoder();
  const locals = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = enc.encode(name), data = typeof value === 'string' ? enc.encode(value) : value;
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const ld = new DataView(local.buffer);
    ld.setUint32(0, 0x04034B50, true); ld.setUint16(4, 20, true);
    ld.setUint16(8, 0, true); ld.setUint16(10, 0, true);
    ld.setUint32(14, crc32(data), true); ld.setUint32(18, data.length, true); ld.setUint32(22, data.length, true);
    ld.setUint16(26, nameBytes.length, true); ld.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    locals.push(local);
    const c = new Uint8Array(46 + nameBytes.length), cd = new DataView(c.buffer);
    cd.setUint32(0, 0x02014B50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true); cd.setUint16(10, 0, true); cd.setUint32(16, crc32(data), true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(38, 0, true); cd.setUint32(42, offset, true); c.set(nameBytes, 46);
    central.push(c); offset += local.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0), centralOffset = offset;
  const end = new Uint8Array(22), ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054B50, true); ed.setUint16(8, entries.length, true); ed.setUint16(10, entries.length, true);
  ed.setUint32(12, centralSize, true); ed.setUint32(16, centralOffset, true);
  const out = new Uint8Array(offset + centralSize + end.length); let p = 0;
  for (const part of locals) { out.set(part, p); p += part.length; }
  for (const part of central) { out.set(part, p); p += part.length; }
  out.set(end, p); return out;
}

function syntheticWorkbook() {
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="Second" sheetId="2" r:id="rIdB"/><sheet name="First" sheetId="1" r:id="rIdA"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/custom-first.xml"/><Relationship Id="rIdB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/custom-second.xml"/></Relationships>`;
  const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="165"/></cellXfs></styleSheet>`;
  const sheet = (label, serial) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${label}</t></is></c></row><row r="2"><c r="A2" s="1"><v>${serial}</v></c></row></sheetData></worksheet>`;
  return zipStore([
    ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', rels], ['xl/styles.xml', styles],
    ['xl/worksheets/custom-first.xml', sheet('FIRST', 0.25)],
    ['xl/worksheets/custom-second.xml', sheet('SECOND', 0.5)],
  ]);
}

test('XLSX follows workbook sheet order, custom worksheet names, 1904 dates, and concurrent reads', async t => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { t.skip('Playwright is not installed'); return; }
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>xlsx parser</title>');
    await page.addScriptTag({ content: xlsxSource });
    const bytes = Array.from(syntheticWorkbook());
    const result = await page.evaluate(async bytes => {
      const b = Uint8Array.from(bytes).buffer;
      const first = await window.XLSXLite.parseXLSX(b, 0);
      const second = await window.XLSXLite.parseXLSX(b, 1);
      const file = { arrayBuffer: async () => Uint8Array.from(bytes).buffer };
      const [a, c] = await Promise.all([window.XLSXLite.readSheets(file), window.XLSXLite.readSheets(file)]);
      return { first, second, a, c };
    }, bytes);
    assert.equal(result.first[0][0], 'SECOND');
    assert.equal(result.first[1][0], '1904-01-01 12:00:00');
    assert.equal(result.second[0][0], 'FIRST');
    assert.equal(result.second[1][0], '1904-01-01 06:00:00');
    assert.deepEqual(result.a, result.c);
    assert.equal(result.a[0][0][0], 'SECOND');
    assert.equal(result.a[1][0][0], 'FIRST');
  } finally { await browser.close(); }
});

test('T4 stores a detail row when an imported alias has no extra columns and labels fallback channels', () => {
  const storage = new Map();
  const context = vm.createContext({
    console,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener() {}, getElementById() { return null; } }, window: {}, S: {},
  });
  const helpers = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').split('/* ============ 系统结构')[0];
  vm.runInContext(helpers, context); vm.runInContext('toast = () => {};', context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 't4.js'), 'utf8'), context);
  vm.runInContext("t4ChApplyRows([['销售渠道','归属事业部'],['无字段别名','大电商']])", context);
  const saved = JSON.parse(storage.get('fsc_t4_channels_v2'));
  const id = vm.runInContext("t4ResolveChannel('无字段别名')", context);
  const override = saved.find(row => row.id === id);
  assert.deepEqual(override.details, [{ source: '无字段别名', fields: [] }]);
  const rows = JSON.parse(vm.runInContext('JSON.stringify(t4ChDisplaySourceRows())', context));
  assert.ok(rows.some(row => row.source === '无字段别名' && row.fallback === false));
  assert.ok(rows.some(row => row.fallback === true));
  vm.runInContext("T4.chField = '__sources'", context);
  const html = vm.runInContext("S['t4-channels']()", context);
  assert.match(html, /26 个归集渠道待登记/);
  assert.match(html, /data-t4sourceedit="天猫-澳乐旗舰店"[^>]*>登记<\/button>/);
});
