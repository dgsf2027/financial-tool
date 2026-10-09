'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { /* Optional existing browser runtime. */ }
let browser;
before(async () => { if (chromium) browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL }); });
after(async () => { if (browser) await browser.close(); });
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (const n of b) c = crcTable[(c ^ n) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const parts = [], directory = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), compressed = zlib.deflateRawSync(bytes), filename = Buffer.from(name), crc = crc32(bytes);
    const header = Buffer.alloc(30 + filename.length); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(2048, 6); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26); filename.copy(header, 30);
    const central = Buffer.alloc(46 + filename.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(2048, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42); filename.copy(central, 46);
    parts.push(header, compressed); directory.push(central); offset += header.length + compressed.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length, 8); end.writeUInt16LE(directory.length, 10); end.writeUInt32LE(directory.reduce((n, b) => n + b.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat(directory, end));
}
function unzip(bytes) {
  const end = bytes.length - 22, count = bytes.readUInt16LE(end + 10), out = new Map(); let p = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(p), 0x02014b50); const nameLength = bytes.readUInt16LE(p + 28), extra = bytes.readUInt16LE(p + 30), comment = bytes.readUInt16LE(p + 32), name = bytes.subarray(p + 46, p + 46 + nameLength).toString(), local = bytes.readUInt32LE(p + 42), method = bytes.readUInt16LE(p + 10), crc = bytes.readUInt32LE(p + 16), size = bytes.readUInt32LE(p + 20);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28), raw = bytes.subarray(start, start + size), content = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(crc32(content), crc, 'CRC: ' + name); out.set(name, { raw, content }); p += 46 + nameLength + extra + comment;
  }
  return out;
}
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relns = 'http://schemas.openxmlformats.org/package/2006/relationships';
const rns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cell = (ref, s) => `<c r="${ref}" t="inlineStr"><is><t>${esc(s)}</t></is></c>`;
const fcell = (ref, formula, value = '') => `<c r="${ref}" t="str"><f>${esc(formula)}</f><v>${esc(value)}</v></c>`;
function fixture(options = {}) {
  const heads = ['日期', '类别', '支出项目', '支出金额', '备用金', '收入', '余额', options.missingHeader ? '附件' : '支付截图', '备注', '补', '订单号', '月份', '核对'];
  const row = (n, extra = '', image = 'ONE', label = '评论') => `<row r="${n}">${cell('C' + n, label)}<c r="D${n}"><v>2.5</v></c>${image ? fcell('H' + n, `_xlfn.DISPIMG("${image}",1)`) : ''}${extra}</row>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="${ns}" xmlns:r="${rns}" xmlns:wps="urn:test-wps"><sheetData><row r="1">${cell('A1', '测试费用')}</row><row r="2">${heads.map((h, i) => cell(String.fromCharCode(65 + i) + '2', h)).join('')}</row>${row(3, '<c r="L3" s="7"/><c r="N3"><f>D3*2</f><v>5</v></c>', 'MAIN')}${row(4, cell('L4', '2608'), 'ONE')}${row(5, fcell('L5', 'TEXT(A5,"yymm")', ''), 'TWO')}${row(6, cell('M6', '已核对'), 'ONE')}${row(7, '', null, '合计')}${row(8, '', null)}${row(9, '', 'TWO')}</sheetData>${options.drawing ? '<drawing r:id="draw"/>' : ''}<wps:preserve value="original"/></worksheet>`;
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': `<Relationships xmlns="${relns}"><Relationship Id="wb" Type="${rns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${rns}"><sheets><sheet name="测试" sheetId="7" r:id="sheet"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relns}"><Relationship Id="sheet" Type="${rns}/worksheet" Target="worksheets/custom.xml"/><Relationship Id="images" Type="http://www.wps.cn/officeDocument/2020/cellImage" Target="cellimages.xml"/></Relationships>`,
    'xl/worksheets/custom.xml': sheet,
    'xl/cellimages.xml': `<etc:cellImages xmlns:etc="urn:wps" xmlns:xdr="urn:drawing" xmlns:a="urn:a" xmlns:r="${rns}">${['ONE', 'TWO', 'MAIN'].map((name, i) => `<etc:cellImage><xdr:pic><xdr:cNvPr name="${name}"/><a:blip r:embed="img${i}"/></xdr:pic></etc:cellImage>`).join('')}</etc:cellImages>`,
    'xl/_rels/cellimages.xml.rels': `<Relationships xmlns="${relns}">${['one', 'two', 'main'].map((name, i) => `<Relationship Id="img${i}" Type="${rns}/image" Target="media/${name}.png"/>`).join('')}</Relationships>`,
    'xl/media/one.png': Buffer.from([137, 80, 78, 71, 0, 1, 2, 3]),
    'xl/media/two.png': Buffer.from([137, 80, 78, 71, 4, 5, 6, 7]),
    'xl/media/main.png': Buffer.from([137, 80, 78, 71, 0, 1, 2, 9]),
    'xl/styles.xml': '<keep-formatting/>', 'customXml/item1.xml': '<custom keep="all"/>'
  };
  if (options.drawing) {
    files['xl/worksheets/_rels/custom.xml.rels'] = `<Relationships xmlns="${relns}"><Relationship Id="draw" Type="${rns}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
    files['xl/drawings/drawing1.xml'] = `<xdr:wsDr xmlns:xdr="urn:drawing" xmlns:a="urn:a" xmlns:r="${rns}"><xdr:oneCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:row>7</xdr:row></xdr:from><xdr:pic><a:blip r:embed="pic"/></xdr:pic></xdr:oneCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:row>8</xdr:row></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:row>10</xdr:row></xdr:to><xdr:pic><a:blip r:embed="pic"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`;
    files['xl/drawings/_rels/drawing1.xml.rels'] = `<Relationships xmlns="${relns}"><Relationship Id="pic" Type="${rns}/image" Target="../media/one.png"/></Relationships>`;
  }
  return files;
}
const styledCell = (ref, value, style) => cell(ref, value).replace('<c ', `<c s="${style}" `);
const targetXf = fill => `<xf numFmtId="164" fontId="1" fillId="${fill}" borderId="1" xfId="0" quotePrefix="1" applyNumberFormat="1" applyAlignment="1" applyProtection="1"${fill === 2 ? ' applyFill="1"' : ''}><alignment horizontal="left" wrapText="1"/><protection locked="0" hidden="1"/></xf>`;
function colorFixture({ references = [{ row: 6, month: '2609', monthStyle: 2, statusStyle: 2 }], reuse = false, targets = true } = {}) {
  const files = fixture();
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', targetXf(0),
    '<xf numFmtId="165" fontId="2" fillId="2" borderId="2" xfId="0" applyFill="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="165" fontId="2" fillId="4" borderId="2" xfId="0" applyFill="1"><alignment horizontal="center"/></xf>',
    '<xf numFmtId="166" fontId="3" fillId="0" borderId="3" xfId="0"><alignment vertical="top"/></xf>',
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="3" xfId="0"><alignment vertical="bottom"/><protection locked="0"/></xf>',
  ];
  if (reuse) xfs.push(targetXf(2));
  files['xl/styles.xml'] = `<?xml version="1.0"?><styleSheet xmlns="${ns}"><numFmts count="3"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="@"/><numFmt numFmtId="166" formatCode="yyyy-mm"/></numFmts><fonts count="4">${[12, 11, 10, 9].map(size => `<font><sz val="${size}"/><name val="Arial"/></font>`).join('')}</fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['FF92D04F', 'FFFFFF00', 'FF00B0F0'].map(rgb => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="4">${['', 'thin', 'medium', 'double'].map(style => `<border><left${style ? ` style="${style}"` : ''}/><right/><top/><bottom/><diagonal/></border>`).join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill></dxf></dxfs></styleSheet>`;
  files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('</Relationships>', `<Relationship Id="styles" Type="${rns}/styles" Target="styles.xml"/></Relationships>`);
  files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml']
    .replace('<c r="L3" s="7"/>', targets ? '<c r="L3" s="1"/><c r="M3" s="1"/>' : '')
    .replace(/<row r="6">[\s\S]*?<\/row>/, '')
    .replace('</sheetData>', references.map(ref => `<row r="${ref.row}">${cell('C' + ref.row, '已核对样例')}<c r="D${ref.row}"><v>2.5</v></c>${styledCell('L' + ref.row, ref.month, ref.monthStyle)}${styledCell('M' + ref.row, '已核对', ref.statusStyle)}</row>`).join('') + '</sheetData>');
  return files;
}
async function coloredExport(page, month = '2609', sheetId = '7') {
  return Buffer.from(await page.evaluate(async ({ month, sheetId }) => Array.from(new Uint8Array(await (await book.export([{ sheetId, row: 3, month, status: '已核对' }])).arrayBuffer())), { month, sheetId }));
}
async function colorFacts(page, bytes, sheetPath = 'xl/worksheets/custom.xml') {
  const entries = unzip(bytes);
  return page.evaluate(({ styles, sheet }) => {
    const parse = text => new DOMParser().parseFromString(text, 'application/xml');
    const all = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];
    const stylesDoc = parse(styles), sheetDoc = parse(sheet), xfs = [...all(stylesDoc, 'cellXfs')[0].children];
    const facts = xf => ({ attrs: Object.fromEntries([...xf.attributes].filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/').map(a => [a.name, a.value])), children: [...xf.children].map(c => new XMLSerializer().serializeToString(c)) });
    const cells = {};
    for (const ref of ['L3', 'M3']) { const c = all(sheetDoc, 'c').find(c => c.getAttribute('r') === ref); const id = Number(c?.getAttribute('s') || 0); cells[ref] = { id, style: facts(xfs[id]), value: all(c, 't').map(t => t.textContent).join('') }; }
    return { count: xfs.length, declaredCount: Number(all(stylesDoc, 'cellXfs')[0].getAttribute('count')), xfs: xfs.map(facts), cells };
  }, { styles: entries.get('xl/styles.xml').content.toString(), sheet: entries.get(sheetPath).content.toString() });
}
function withoutFill(style) { const attrs = { ...style.attrs }; delete attrs.fillId; delete attrs.applyFill; return { ...style, attrs }; }
function imageAlias(files, bytes) {
  files['xl/cellimages.xml'] = files['xl/cellimages.xml'].replace('</etc:cellImages>', '<etc:cellImage><xdr:pic><xdr:cNvPr name="COPY"/><a:blip r:embed="copy"/></xdr:pic></etc:cellImage></etc:cellImages>');
  files['xl/_rels/cellimages.xml.rels'] = files['xl/_rels/cellimages.xml.rels'].replace('</Relationships>', `<Relationship Id="copy" Type="${rns}/image" Target="media/different-name.png"/></Relationships>`);
  files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml'].replace('<row r="8">', '<row r="8">' + fcell('H8', '_xlfn.DISPIMG("COPY",1)'));
  files['xl/media/different-name.png'] = bytes;
  return files;
}
// Produce equal-length, distinct bytes with an identical CRC32, exercising the
// byte comparison instead of merely testing the metadata shortlist.
function crcCollision(original) {
  const result = Buffer.from(original); result[0] ^= 64; result.fill(0, result.length - 4);
  const base = crc32(result), basis = new Array(32);
  for (let i = 0; i < 32; i++) {
    const probe = Buffer.from(result); probe[probe.length - 4 + Math.floor(i / 8)] ^= 1 << (i % 8);
    let value = (crc32(probe) ^ base) >>> 0, mask = (2 ** i) >>> 0;
    for (let bit = 31; bit >= 0; bit--) if ((value >>> bit) & 1) {
      if (basis[bit]) { value = (value ^ basis[bit].value) >>> 0; mask = (mask ^ basis[bit].mask) >>> 0; }
      else { basis[bit] = { value, mask }; break; }
    }
  }
  let target = (base ^ crc32(original)) >>> 0, mask = 0;
  for (let bit = 31; bit >= 0; bit--) if ((target >>> bit) & 1) { assert.ok(basis[bit]); target = (target ^ basis[bit].value) >>> 0; mask = (mask ^ basis[bit].mask) >>> 0; }
  assert.equal(target, 0);
  for (let bit = 0; bit < 32; bit++) if ((mask >>> bit) & 1) result[result.length - 4 + Math.floor(bit / 8)] ^= 1 << (bit % 8);
  assert.equal(crc32(result), crc32(original)); assert.notDeepEqual(result, original); return result;
}
async function load(t, input) {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.route('http://receipt.test/**', route => route.fulfill({ body: route.request().url().endsWith('/input.xlsx') ? input : '<!doctype html>', contentType: route.request().url().endsWith('/input.xlsx') ? 'application/octet-stream' : 'text/html' }));
  await page.goto('http://receipt.test/'); await page.addScriptTag({ path: path.join(__dirname, '../lib/receipt-workbook.js') });
  await page.evaluate(async () => { window.inputBlob = await (await fetch('/input.xlsx')).blob(); window.book = await ReceiptWorkbook.open(inputBlob); });
  return page;
}
const opts = { skip: !chromium };
test('detect headers and WPS screenshots; retain reviewed rows for duplicate detection; exclude totals', opts, async t => {
  const page = await load(t, zip(fixture())); const result = await page.evaluate(() => ({ sheets: book.sheets, usage: book.imageUsage })); const sheet = result.sheets[0];
  assert.equal(sheet.id, '7'); assert.equal(sheet.headerRow, 2); assert.equal(sheet.columns.amount, 'D'); assert.equal(sheet.columns.month, 'L'); assert.equal(sheet.canExport, true);
  assert.deepEqual(sheet.rows.map(r => r.row), [3, 4, 5, 6, 8, 9]); assert.equal(sheet.rows.find(r => r.row === 6).eligible, false);
  assert.ok(sheet.rows.find(r => r.row === 8).issues.includes('缺少支付截图')); assert.equal(sheet.rows[0].images[0].ref, 'xl/media/main.png'); assert.equal(result.usage.find(u => u.ref.endsWith('one.png')).rows.length, 2);
  assert.deepEqual(await page.evaluate(async () => Array.from(new Uint8Array(await (await book.image(book.sheets[0].rows[0].images[0])).arrayBuffer()))), [137, 80, 78, 71, 0, 1, 2, 9]);
});
test('identical image bytes under different media paths block every affected row, including direct export', opts, async t => {
  const files = fixture(); imageAlias(files, Buffer.from(files['xl/media/main.png']));
  const page = await load(t, zip(files));
  const rows = await page.evaluate(() => book.sheets[0].rows.filter(r => [3, 8].includes(r.row)));
  assert.equal(rows.length, 2); assert.notEqual(rows[0].images[0].ref, rows[1].images[0].ref);
  assert.ok(rows.every(r => r.issues.includes('相同图片内容被多行使用')));
  for (const row of [3, 8]) assert.match(await page.evaluate(async row => { book.sheets[0].rows.find(r => r.row === row).issues.length = 0; try { await book.export([{ sheetId: '7', row, month: '2609', status: '已核对' }]); return ''; } catch (e) { return e.message; } }, row), /相同图片内容被多行使用/);
});
test('equal size and CRC with different image bytes is not falsely marked as duplicate', opts, async t => {
  const files = fixture(); imageAlias(files, crcCollision(files['xl/media/main.png']));
  const page = await load(t, zip(files));
  assert.ok(await page.evaluate(() => book.sheets[0].rows.filter(r => [3, 8].includes(r.row)).every(r => !r.issues.length)));
  assert.ok(await page.evaluate(async () => (await book.export([3, 8].map(row => ({ sheetId: '7', row, month: '2609', status: '已核对' })))).size > 0));
});
test('amount formulas require recalculation review and cannot export cached values; totals remain excluded', opts, async t => {
  for (const formula of ['A3*2', '']) {
    const files = fixture(); files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml'].replace('<c r="D3"><v>2.5</v></c>', fcell('D3', formula, '2.5'));
    const page = await load(t, zip(files));
    assert.ok(await page.evaluate(() => book.sheets[0].rows[0].issues.includes('支出金额为公式，请确认重算结果')));
    assert.match(await page.evaluate(async () => { try { await book.export([{ sheetId: '7', row: 3, month: '2609', status: '已核对' }]); return ''; } catch (e) { return e.message; } }), /支出金额为公式/);
    assert.equal(await page.evaluate(() => book.sheets[0].rows.some(r => r.row === 7)), false);
  }
});
test('review colors only change L/M fills and preserve all target formatting plus original images and formulas', opts, async t => {
  const input = zip(colorFixture()), page = await load(t, input), output = await coloredExport(page);
  const facts = await colorFacts(page, output), before = unzip(input), after = unzip(output);
  assert.equal(facts.count, 7); assert.equal(facts.declaredCount, 7, 'one reusable combined style is appended');
  for (const ref of ['L3', 'M3']) {
    assert.equal(facts.cells[ref].style.attrs.fillId, '2'); assert.equal(facts.cells[ref].style.attrs.applyFill, '1');
    assert.deepEqual(withoutFill(facts.cells[ref].style), withoutFill(facts.xfs[1]), 'font, border, number format, alignment and protection remain the target’s');
  }
  assert.equal(facts.cells.L3.id, facts.cells.M3.id); assert.equal(facts.cells.L3.value, '2609'); assert.equal(facts.cells.M3.value, '已核对');
  const originalFacts = await colorFacts(page, input); assert.deepEqual(facts.xfs.slice(0, 6), originalFacts.xfs, 'existing XF definitions remain unchanged');
  const stripTargets = xml => xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, value => /\br="[LM]3"/.test(value.slice(0, value.indexOf('>') + 1)) ? '' : value);
  assert.equal(stripTargets(after.get('xl/worksheets/custom.xml').content.toString()), stripTargets(before.get('xl/worksheets/custom.xml').content.toString()), 'only the two reviewed cells changed');
  for (const [name, entry] of before) if (!['xl/worksheets/custom.xml', 'xl/styles.xml'].includes(name)) assert.ok(entry.raw.equals(after.get(name).raw), name + ' compressed bytes unchanged');
  const outsideXfs = xml => xml.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, '');
  assert.equal(outsideXfs(before.get('xl/styles.xml').content.toString()), outsideXfs(after.get('xl/styles.xml').content.toString()), 'fonts, fills, borders and every other style table stay byte-for-byte intact');
  assert.ok(output.subarray(0, input.length).equals(input));
});
test('an existing combined style is reused byte-for-byte and unanimous sheet colors apply when no month sample exists', opts, async t => {
  const input = zip(colorFixture({ reuse: true, references: [{ row: 6, month: '2608', monthStyle: 2, statusStyle: 2 }] })), page = await load(t, input), output = await coloredExport(page);
  const facts = await colorFacts(page, output); assert.equal(facts.cells.L3.id, 6); assert.equal(facts.cells.M3.id, 6);
  assert.ok(unzip(input).get('xl/styles.xml').raw.equals(unzip(output).get('xl/styles.xml').raw), 'no style entry rewrite is needed when both combined styles already exist');
});
test('same-month samples take priority per column and repeated exports do not contaminate source style caches', opts, async t => {
  const files = colorFixture({ references: [{ row: 6, month: '2609', monthStyle: 2, statusStyle: 3 }, { row: 10, month: '2608', monthStyle: 3, statusStyle: 2 }] });
  const page = await load(t, zip(files)), september = await coloredExport(page, '2609'), august = await coloredExport(page, '2608'), repeated = await coloredExport(page, '2609');
  const a = await colorFacts(page, september), b = await colorFacts(page, august);
  assert.equal(a.cells.L3.style.attrs.fillId, '2'); assert.equal(a.cells.M3.style.attrs.fillId, '4');
  assert.equal(b.cells.L3.style.attrs.fillId, '4'); assert.equal(b.cells.M3.style.attrs.fillId, '2');
  assert.equal(a.count, 8); assert.equal(b.count, 8); assert.ok(september.equals(repeated), 'exporting a different month never mutates the loaded original workbook');
});
test('no reference, conflicting reference colors and conditional formatting preserve existing target colors', opts, async t => {
  for (const mode of ['none', 'conflicting', 'conditional', 'colored']) {
    const references = mode === 'none' ? [] : [{ row: 6, month: '2609', monthStyle: 2, statusStyle: 2 }, ...(mode === 'conflicting' ? [{ row: 10, month: '2609', monthStyle: 3, statusStyle: 3 }] : [])];
    const files = colorFixture({ references });
    if (mode === 'colored') files['xl/styles.xml'] = files['xl/styles.xml'].replace(targetXf(0), targetXf(3));
    if (mode === 'conditional') files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml'].replace('</worksheet>', '<conditionalFormatting sqref="L3 M3"><cfRule type="expression" dxfId="0" priority="1"><formula>1=1</formula></cfRule></conditionalFormatting></worksheet>');
    const input = zip(files), page = await load(t, input), output = await coloredExport(page), facts = await colorFacts(page, output);
    assert.equal(facts.cells.L3.id, 1, mode); assert.equal(facts.cells.M3.id, 1, mode); assert.equal(facts.cells.L3.style.attrs.fillId, mode === 'colored' ? '3' : '0', mode);
    assert.ok(unzip(input).get('xl/styles.xml').raw.equals(unzip(output).get('xl/styles.xml').raw), mode + ' does not modify styles');
  }
});
test('missing target cells preserve row or column formats; without explicit defaults they inherit the reviewed reference format', opts, async t => {
  for (const mode of ['row', 'column', 'reference']) {
    const files = colorFixture({ targets: false });
    if (mode === 'row') files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml'].replace('<row r="3">', '<row r="3" s="4" customFormat="1">');
    if (mode === 'column') files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml'].replace('<sheetData>', '<cols><col min="12" max="13" style="5" width="12" customWidth="1"/></cols><sheetData>');
    const page = await load(t, zip(files)), facts = await colorFacts(page, await coloredExport(page)), base = mode === 'row' ? 4 : mode === 'column' ? 5 : 2;
    for (const ref of ['L3', 'M3']) { assert.equal(facts.cells[ref].style.attrs.fillId, '2', mode); assert.deepEqual(withoutFill(facts.cells[ref].style), withoutFill(facts.xfs[base]), mode + ' formatting'); }
    if (mode === 'reference') { assert.equal(facts.count, 6); assert.equal(facts.cells.L3.id, 2); assert.equal(facts.cells.M3.id, 2); }
  }
});
test('review color samples never leak across different worksheets', opts, async t => {
  const files = colorFixture();
  files['xl/workbook.xml'] = files['xl/workbook.xml'].replace('</sheets>', '<sheet name="第二表" sheetId="8" r:id="second"/></sheets>');
  files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('</Relationships>', `<Relationship Id="second" Type="${rns}/worksheet" Target="worksheets/second.xml"/></Relationships>`);
  files['xl/worksheets/second.xml'] = files['xl/worksheets/custom.xml'].replace('DISPIMG("MAIN",1)', 'DISPIMG("SECOND",1)').replace('s="2" r="L6"', 's="3" r="L6"').replace('s="2" r="M6"', 's="3" r="M6"');
  files['xl/cellimages.xml'] = files['xl/cellimages.xml'].replace('</etc:cellImages>', '<etc:cellImage><xdr:pic><xdr:cNvPr name="SECOND"/><a:blip r:embed="second"/></xdr:pic></etc:cellImage></etc:cellImages>');
  files['xl/_rels/cellimages.xml.rels'] = files['xl/_rels/cellimages.xml.rels'].replace('</Relationships>', `<Relationship Id="second" Type="${rns}/image" Target="media/second.png"/></Relationships>`); files['xl/media/second.png'] = Buffer.from([137, 80, 78, 71, 91, 92, 93, 94]);
  const page = await load(t, zip(files)); const first = await colorFacts(page, await coloredExport(page)), second = await colorFacts(page, await coloredExport(page, '2609', '8'), 'xl/worksheets/second.xml');
  assert.equal(first.cells.L3.style.attrs.fillId, '2'); assert.equal(first.cells.M3.style.attrs.fillId, '2'); assert.equal(second.cells.L3.style.attrs.fillId, '4'); assert.equal(second.cells.M3.style.attrs.fillId, '4');
});
test('export preserves every non-sheet entry compressed bytes, original markup, formats and formulas', opts, async t => {
  const input = zip(fixture()), page = await load(t, input);
  const output = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await book.export([{ sheetId: '7', row: 3, month: '2609', status: '已核对' }])).arrayBuffer()))));
  assert.ok(output.subarray(0, input.length).equals(input), 'all original ZIP bytes retained');
  const before = unzip(input), after = unzip(output); assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [name, entry] of before) if (name !== 'xl/worksheets/custom.xml') assert.ok(entry.raw.equals(after.get(name).raw), name + ' compressed bytes unchanged');
  const xml = after.get('xl/worksheets/custom.xml').content.toString(); assert.ok(xml.includes('<c r="L3" s="7" t="inlineStr"><is><t>2609</t></is></c>')); assert.ok(xml.includes('<c r="M3" t="inlineStr"><is><t>已核对</t></is></c>')); assert.ok(xml.includes('<c r="N3"><f>D3*2</f><v>5</v></c>')); assert.ok(xml.includes('<wps:preserve value="original"/>'));
  const preserved = xml.replace('<c r="L3" s="7" t="inlineStr"><is><t>2609</t></is></c>', '<c r="L3" s="7"/>').replace('<c r="M3" t="inlineStr"><is><t>已核对</t></is></c>', ''); assert.equal(preserved, before.get('xl/worksheets/custom.xml').content.toString(), 'exactly two target cells changed');
  assert.equal(await page.evaluate(async bytes => { const reopened = await ReceiptWorkbook.open(new Blob([new Uint8Array(bytes)])); return reopened.sheets[0].rows[0].status; }, Array.from(output)), '已核对');
});
test('export rejects existing different values, formula targets, reviewed/non-detail rows, invalid and duplicate patches', opts, async t => {
  const page = await load(t, zip(fixture()));
  for (const [patch, pattern] of [[{ row: 4 }, /多行引用/], [{ row: 5 }, /公式/], [{ row: 6 }, /已核对或非明细/], [{ row: 7 }, /已核对或非明细/], [{ row: 3, month: '2613' }, /月份格式/], [{ row: 3, status: 'whatever' }, /核对状态/]]) {
    const error = await page.evaluate(async p => { try { await book.export([{ sheetId: '7', month: '2609', status: '已核对', ...p }]); return ''; } catch (e) { return e.message; } }, patch); assert.match(error, pattern);
  }
  assert.match(await page.evaluate(async () => { try { const p = { sheetId: '7', row: 3, month: '2609', status: '已核对' }; await book.export([p, p]); return ''; } catch (e) { return e.message; } }), /重复提交/);
});
test('target conflicts and formulas/merges are visible before export; export guards cannot be bypassed by UI mutations', opts, async t => {
  const files = fixture();
  files['xl/worksheets/custom.xml'] = files['xl/worksheets/custom.xml'].replace('<c r="L3" s="7"/>', cell('L3', '2608'));
  const page = await load(t, zip(files));
  const conflict = await page.evaluate(async () => { try { await book.export([{ sheetId: '7', row: 3, month: '2609', status: '已核对' }]); return ''; } catch (e) { return e.message; } });
  assert.match(conflict, /已有不同值/);
  assert.ok(await page.evaluate(async () => (await book.export([{ sheetId: '7', row: 3, month: '2608', status: '已核对' }])).size > 0));
  assert.ok(await page.evaluate(() => book.sheets[0].rows.find(r => r.row === 5).issues.some(x => x.includes('公式'))));
  assert.match(await page.evaluate(async () => { const row = book.sheets[0].rows.find(r => r.row === 4); row.issues.length = 0; row.images.length = 1; try { await book.export([{ sheetId: '7', row: 4, month: '2608', status: '已核对' }]); return ''; } catch (e) { return e.message; } }), /多行引用/);
  const mergedFiles = fixture(); mergedFiles['xl/worksheets/custom.xml'] = mergedFiles['xl/worksheets/custom.xml'].replace('</sheetData>', '</sheetData><mergeCells><mergeCell ref="L3:L4"/></mergeCells>');
  const mergedPage = await load(t, zip(mergedFiles));
  assert.ok(await mergedPage.evaluate(() => book.sheets[0].rows[0].issues.some(x => x.includes('合并'))));
  assert.match(await mergedPage.evaluate(async () => { try { await book.export([{ sheetId: '7', row: 3, month: '2609', status: '已核对' }]); return ''; } catch (e) { return e.message; } }), /合并/);
});
test('missing critical header blocks export', opts, async t => {
  const page = await load(t, zip(fixture({ missingHeader: true })));
  assert.equal(await page.evaluate(() => book.sheets[0].canExport), false);
  assert.match(await page.evaluate(async () => { try { await book.export([{ sheetId: '7', row: 3, month: '2609', status: '已核对' }]); return ''; } catch (e) { return e.message; } }), /必要表头/);
});
test('drawing anchors map to screenshot column and flag multiple / spanning receipts', opts, async t => {
  const page = await load(t, zip(fixture({ drawing: true })));
  const rows = await page.evaluate(() => book.sheets[0].rows);
  assert.equal(rows.find(r => r.row === 8).images[0].kind, 'drawing'); assert.equal(rows.find(r => r.row === 9).images.length, 2); assert.ok(rows.find(r => r.row === 9).issues.includes('浮动截图跨行，需确认所属行'));
});
test('images are lazy; damaged image payload fails CRC only when requested; truncated ZIP fails open', opts, async t => {
  const input = zip(fixture()), entries = unzip(input), bad = Buffer.from(input); const raw = entries.get('xl/media/one.png').raw, at = bad.indexOf(raw); bad[at + 2] ^= 1;
  const page = await load(t, bad);
  assert.equal(await page.evaluate(() => book.sheets.length), 1);
  assert.ok(await page.evaluate(async () => { try { await book.image('xl/media/one.png'); return false; } catch (_) { return true; } }));
  const error = await page.evaluate(async bytes => { try { await ReceiptWorkbook.open(new Blob([new Uint8Array(bytes)])); return ''; } catch (e) { return e.message; } }, Array.from(input.subarray(0, input.length - 10))); assert.match(error, /完整的 xlsx/);
});
test('ZIP path traversal and inflated-size limits rejected before extraction', opts, async t => {
  const page = await load(t, zip(fixture()));
  const unsafe = zip({ ...fixture(), '../escape': 'bad' });
  assert.match(await page.evaluate(async bytes => { try { await ReceiptWorkbook.open(new Blob([new Uint8Array(bytes)])); return ''; } catch (e) { return e.message; } }, Array.from(unsafe)), /路径重复或不安全/);
  const oversized = Buffer.from(zip(fixture())), central = oversized.readUInt32LE(oversized.length - 6); oversized.writeUInt32LE(101 * 1024 * 1024, central + 24);
  assert.match(await page.evaluate(async bytes => { try { await ReceiptWorkbook.open(new Blob([new Uint8Array(bytes)])); return ''; } catch (e) { return e.message; } }, Array.from(oversized)), /大小超过安全限制/);
});
test('optional real local workbook smoke and preservation verification (never uploaded)', { skip: !chromium || !process.env.RECEIPT_TEST_XLSX }, async t => {
  const input = await fs.readFile(process.env.RECEIPT_TEST_XLSX), page = await load(t, input);
  const summary = await page.evaluate(() => book.sheets.map(s => ({ id: s.id, name: s.name, rows: s.rows.length, eligible: s.rows.filter(r => r.eligible).length, sameRefRows: s.rows.filter(r => r.issues.includes('同一图片被多行引用')).length, sameContentRows: s.rows.filter(r => r.issues.includes('相同图片内容被多行使用')).length, newlyBlockedEligible: s.rows.filter(r => r.eligible && r.issues.includes('相同图片内容被多行使用') && !r.issues.includes('同一图片被多行引用')).length, formulaAmountRows: s.rows.filter(r => r.issues.includes('支出金额为公式，请确认重算结果')).length, cleanEligible: s.rows.filter(r => r.eligible && !r.issues.length).length, columns: s.columns, canExport: s.canExport })));
  assert.equal(summary.length, 2); assert.ok(summary.every(s => s.columns.amount === 'D' && s.columns.image === 'H' && s.columns.month === 'L' && s.columns.status === 'M' && s.canExport));
  const image = await page.evaluate(async () => ({ size: (await book.image(book.sheets[0].rows.find(r => r.row === 5).images[0])).size })); assert.ok(image.size > 1000);
  await page.route('http://receipt.test/export', async route => { await fs.writeFile(path.join(process.env.RECEIPT_TEST_OUTPUT_DIR || process.env.TMPDIR || '/tmp', 'receipt-workbook-preservation-test.xlsx'), route.request().postDataBuffer()); await route.fulfill({ body: 'ok' }); });
  const patches = await page.evaluate(async () => {
    const patches = book.sheets.map(sheet => {
      const clean = sheet.rows.find(r => r.eligible && !r.issues.length && (!r.month || r.month === '2609'));
      if (!clean) throw new Error('No clean eligible row in ' + sheet.name);
      return { sheetId: sheet.id, row: clean.row, month: '2609', status: '已核对' };
    });
    const output = await book.export(patches); await fetch('/export', { method: 'POST', body: output }); return patches;
  });
  const outputPath = path.join(process.env.RECEIPT_TEST_OUTPUT_DIR || process.env.TMPDIR || '/tmp', 'receipt-workbook-preservation-test.xlsx'), output = await fs.readFile(outputPath); t.after(() => fs.unlink(outputPath));
  const originalEntries = unzip(input), newEntries = unzip(output); assert.equal(originalEntries.size, newEntries.size);
  const paths = patches.map(p => 'xl/worksheets/sheet' + p.sheetId + '.xml');
  for (const [name, entry] of originalEntries) if (!paths.includes(name) && name !== 'xl/styles.xml') assert.ok(entry.raw.equals(newEntries.get(name).raw), name + ' unchanged');
  for (const patch of patches) {
    const file = 'xl/worksheets/sheet' + patch.sheetId + '.xml', refs = ['L' + patch.row, 'M' + patch.row];
    const strip = xml => xml.replace(/<((?:[A-Za-z_][\w.-]*:)?c)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g, value => {
      const ref = /\br\s*=\s*["']([^"']+)["']/.exec(value.slice(0, value.indexOf('>') + 1))?.[1]; return refs.includes(ref) ? '' : value;
    });
    assert.equal(strip(originalEntries.get(file).content.toString()), strip(newEntries.get(file).content.toString()), file + ': every non-target cell, image formula and extension stays unchanged');
  }
  const styleEvidence = await page.evaluate(({ before, after, sheets, patches }) => {
    const parse = text => new DOMParser().parseFromString(text, 'application/xml'), all = (el, name) => [...el.getElementsByTagNameNS('*', name)], serialize = node => new XMLSerializer().serializeToString(node);
    const oldDoc = parse(before), newDoc = parse(after), original = [...all(oldDoc, 'cellXfs')[0].children], current = [...all(newDoc, 'cellXfs')[0].children], fills = [...all(newDoc, 'fills')[0].children];
    const colors = patches.map((patch, i) => {
      const sheet = parse(sheets[i]); return ['L', 'M'].map(column => {
        const cell = all(sheet, 'c').find(c => c.getAttribute('r') === column + patch.row), xf = current[Number(cell.getAttribute('s') || 0)], fill = fills[Number(xf.getAttribute('fillId') || 0)];
        return { pattern: all(fill, 'patternFill')[0]?.getAttribute('patternType') || 'none', rgb: all(fill, 'fgColor')[0]?.getAttribute('rgb') || '', value: all(cell, 't').map(t => t.textContent).join('') };
      });
    });
    return { originalXfs: original.map(serialize), preservedXfs: current.slice(0, original.length).map(serialize), oldFills: serialize(all(oldDoc, 'fills')[0]), newFills: serialize(all(newDoc, 'fills')[0]), colors };
  }, { before: originalEntries.get('xl/styles.xml').content.toString(), after: newEntries.get('xl/styles.xml').content.toString(), sheets: paths.map(p => newEntries.get(p).content.toString()), patches });
  assert.deepEqual(styleEvidence.preservedXfs, styleEvidence.originalXfs); assert.equal(styleEvidence.newFills, styleEvidence.oldFills);
  for (const [index, patch] of patches.entries()) {
    assert.deepEqual(styleEvidence.colors[index].map(c => c.value), ['2609', '已核对']);
    if (patch.sheetId === '1') assert.ok(styleEvidence.colors[index].every(c => ['none', 'gray125'].includes(c.pattern)), '楚欣 retains no fill');
    if (patch.sheetId === '2') assert.ok(styleEvidence.colors[index].every(c => c.pattern === 'solid' && c.rgb === 'FF92D04F'), '牛紫薇 uses the existing green review fill in both target cells');
  }
  console.log('Local workbook summary:', summary);
});
