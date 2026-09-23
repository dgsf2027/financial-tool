const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function app() {
  const handlers = {}, storage = new Map();
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob, TextEncoder, Uint8Array, DataView, CURS: 't4-contacts',
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); }, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
    window: {}, S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
    toCSV: JSON.stringify, download: (name, data) => { context.downloaded = { name, rows: JSON.parse(data) }; },
    downloadBlob: (name, blob) => { context.downloadedBlob = { name, blob }; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib/xlsx-write.js'), 'utf8'), context);
  context.XLSXWrite = context.window.XLSXWrite;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  vm.runInContext("T4.period='2026-09'; T4.cfg={}; T4.data={};", context);
  return { run: code => vm.runInContext(code, context), context, handlers };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('raw export keeps sources, manual overrides, zero and blank while filtering project and days', async () => {
  const a = app();
  a.run(`T4.projFilter='orange'; T4.viewFrom='2026-09-02'; T4.viewTo='2026-09-02';
    T4.cfg={tm_orange:{platformFeeRate:0.5,directLaborMonth:300}};
    T4.data={tmall:{'2026-09-02':{retailIncome:999}},tm_orange:{
      '2026-09-01':{retailIncome:111},
      '2026-09-02':{retailIncome:0,_src:'manual',_fileParts:{summaryIncome:{retailIncome:100,refundAmount:0},summaryCost:{retailCost:40}}}
    }};`);
  const { rows } = plain(a.run('t4RawExportRows()'));
  const col = name => rows[0].indexOf(name);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map(r => r[col('来源代码')]), ['summaryIncome', 'summaryCost', 'manual']);
  assert.ok(rows.slice(1).every(r => r[col('日期')] === '2026-09-02' && r[col('渠道ID')] === 'tm_orange'));
  assert.equal(rows[1][col('零售收入')], 100);
  assert.equal(rows[1][col('退款金额')], 0);
  assert.equal(rows[2][col('零售收入')], '');
  assert.equal(rows[3][col('零售收入')], 0);
  assert.ok(rows.slice(1).every(r => r[col('平台扣点')] === '' && r[col('直接人工')] === ''));
  a.run('t4RawExport()');
  const content = Buffer.from(await a.context.downloadedBlob.blob.arrayBuffer()).toString();
  assert.match(content, /系统未保留上传原文件的逐笔明细/);
  assert.match(content, /人工录入 \/ 覆盖/);
  assert.match(a.context.downloadedBlob.name, /橘农项目_2026-09-02_2026-09-02\.xlsx$/);
});

test('legacy per-field sources export once without inventing manual values', () => {
  const a = app();
  a.run(`T4.projFilter='orange'; T4.data={tm_orange:{'2026-09-01':{retailIncome:10,retailCost:5,promotion:0,_srcs:{retailIncome:'sales',retailCost:'sales'},_fileParts:{sales:{retailIncome:10}}}}};`);
  const { rows } = plain(a.run('t4RawExportRows()'));
  assert.equal(rows.length, 3);
  assert.equal(rows[1][8], 10);
  assert.equal(rows[1][11], 5);
  assert.equal(rows[2][8], '');
});

test('derived export uses selected project and interval for both daily rows and summary', () => {
  const a = app();
  a.run(`T4.projFilter='orange'; T4.viewFrom='2026-09-02'; T4.viewTo='2026-09-03';
    T4.data={tmall:{'2026-09-02':{retailIncome:999}},tm_orange:{'2026-09-01':{retailIncome:100},'2026-09-02':{retailIncome:20}},tb_orange:{'2026-09-02':{retailIncome:30}},jd_orange:{'2026-09-02':{retailIncome:40}},dy_orange:{'2026-09-02':{retailIncome:50}}}; t4Export();`);
  const { rows, name } = a.context.downloaded;
  assert.ok(!rows.some(r => r[1] === '天猫-澳乐旗舰店' || r[1] === '全部汇总'));
  assert.ok(!rows.some(r => r[3] === '2026-09-01'));
  assert.equal(rows.find(r => r[1] === '橘农项目汇总')[4], '140.00');
  assert.match(name, /橘农项目_2026-09-02_2026-09-03/);
});

test('contacts reject duplicate emails and invalid address or scope', () => {
  const a = app();
  assert.throws(() => a.run("t4ValidateContacts([{email:' One@example.test '},{email:'one@EXAMPLE.test'}])"), /邮箱重复/);
  assert.throws(() => a.run("t4ValidateContacts([{email:'broken'}])"), /邮箱无效/);
  assert.throws(() => a.run("t4ValidateContacts([{email:'valid@example.test',scope:'missing'}])"), /报表范围无效/);
  assert.deepEqual(plain(a.run("t4ValidateContacts([{name:' 张三 ',email:' a@example.test ',scope:'orange',enabled:false}])")), [{name:'张三',email:'a@example.test',scope:'orange',enabled:false}]);
});

test('reading a filtered contact form preserves contacts outside the search and new draft', () => {
  const a = app();
  a.run(`T4.mail.list=[{name:'A',email:'a@example.test',scope:'all'},{name:'B',email:'b@example.test',scope:'orange'}];
    document.querySelectorAll=()=>[{dataset:{t4mailname:'1'},value:'Changed B'}];
    document.querySelector=selector=>selector.includes('addr')?{value:'updated@example.test'}:selector.includes('scope')?{value:'orange'}:{checked:false};
    document.getElementById=id=>({t4MailNewName:{value:'New'},t4MailNewAddr:{value:'new@example.test'},t4MailNewScope:{value:'all'}})[id]||null;
    t4MailReadForm();`);
  assert.equal(a.run('T4.mail.list.length'), 2);
  assert.equal(a.run('T4.mail.list[0].email'), 'a@example.test');
  assert.equal(a.run('T4.mail.list[1].name'), 'Changed B');
  assert.equal(a.run('T4.mail.newContact.email'), 'new@example.test');
  assert.equal(a.run('T4.mail.dirty'), true);
});

test('contact API rejection preserves edited and newly added drafts', async () => {
  const a = app();
  a.run(`T4.mail.loaded=true; T4.mail.dirty=true; T4.mail.list=[{name:'new',email:'new@example.test',scope:'all'}]; T4.mail.newContact={name:'unadded',email:'draft@example.test'};
    fetch=async()=>({ok:false,status:500,text:async()=>'{"error":"磁盘暂不可写"}'});`);
  await a.run('t4SaveContacts()');
  assert.equal(a.run('T4.mail.list[0].email'), 'new@example.test');
  assert.equal(a.run('T4.mail.newContact.email'), 'draft@example.test');
  assert.equal(a.run('T4.mail.dirty'), true);
  assert.match(a.run('T4.mail.saveError'), /磁盘/);
});

test('successful contact save does not overwrite changes made while request is pending', async () => {
  const a = app();
  a.run(`T4.mail.list=[{name:'before',email:'a@example.test',scope:'all'}]; T4.mail.dirty=true;
    fetch=()=>new Promise(resolve=>{finishSave=resolve});`);
  const pending = a.run('t4MailSaveList()');
  a.run(`T4.mail.list[0].name='after'; finishSave({ok:true,text:async()=>'{"ok":true}'});`);
  await pending;
  assert.equal(a.run('T4.mail.list[0].name'), 'after');
  assert.equal(a.run('T4.mail.dirty'), true);
});

test('suite export follows the view while mail payload remains a full month', async () => {
  const a = app();
  a.run(`t4Load=()=>{}; T4.projFilter='orange'; T4.viewFrom='2026-09-12'; T4.viewTo='2026-09-13';
    T4.cfg={tm_orange:{directLaborMonth:300}};
    T4.data={tm_orange:{'2026-09-01':{retailIncome:100},'2026-09-12':{retailIncome:20},'2026-09-13':{promotion:0}}};
    rangePayload=t4SuitePayload({useViewRange:true}); mailPayload=t4SuitePayload({useViewRange:false});`);
  const range = plain(a.run('rangePayload')), mail = plain(a.run('mailPayload'));
  assert.deepEqual(range.dates, ['2026-09-12','2026-09-13']);
  assert.equal(range.days, 2);
  assert.equal(range.monthByCh.tm_orange.salesIncome, 20);
  assert.equal(range.monthByCh.tm_orange.directLabor, 20);
  assert.equal(range.dailyByCh.tm_orange[1].has, true);
  assert.equal(mail.days, 30);
  assert.equal(mail.monthByCh.tm_orange.salesIncome, 120);
  assert.equal(mail.monthByCh.tm_orange.directLabor, 300);
  // The fallback uses the captured payload even if the live screen changes during the request.
  a.run("T4.data={}; T4.cfg={}; rangeWorkbook=t4SuiteClientWorkbook(rangePayload)");
  const content=Buffer.from(await a.run('rangeWorkbook.arrayBuffer()')).toString();
  assert.match(content,/2026-09-12/); assert.match(content,/2026-09-13/);
  assert.doesNotMatch(content,/>1日</);
  assert.match(content,/<v>20<\/v>/);
});
