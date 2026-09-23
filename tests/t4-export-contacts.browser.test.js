const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {}
let browser, server, base;
before(async () => {
  if (!chromium) return;
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
  server=http.createServer(async(req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;
    if(!/^\/(?:[\w-]+\.(?:js|css)|index\.html|lib\/[\w-]+\.js)?$/.test(name))return res.writeHead(404).end();
    try {res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(path.join(__dirname,'..',name==='/'?'index.html':name.slice(1))));}catch(_){res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});

for(const width of [1440,390]) test(`contact search, draft retention and raw export at ${width}px`,{skip:!chromium},async t=>{
  const page=await browser.newPage({viewport:{width,height:900}});t.after(()=>page.close());page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());
  await page.route('**/api/session',r=>r.fulfill({json:{authenticated:true,name:'测试用户'}}));
  await page.route('**/api/t4/workspace',r=>r.fulfill({json:{found:true,version:1,document:{periods:{'2026-09':{tm_orange:{'2026-09-12':{retailIncome:0,_fileParts:{summaryIncome:{retailIncome:100},summaryCost:{retailCost:40}}}}}},cfg:{},channels:[]}}}));
  let failSave=true, saved=null, mailCalls=0;
  await page.route('**/api/t4/recipients',r=>{
    if(r.request().method()==='POST') {saved=r.request().postDataJSON();return r.fulfill(failSave?{status:500,json:{error:'模拟保存失败'}}:{json:{ok:true,recipients:saved}});}
    return r.fulfill({json:[{name:'张三',email:'zhang@example.test',scope:'all',enabled:true},{name:'李四',email:'li@example.test',scope:'orange',enabled:true}]});
  });
  await page.route('**/api/t4/mail/status',r=>r.fulfill({json:{configured:false,missing:[]}}));
  await page.route('**/api/t4/mail',r=>{mailCalls++;return r.abort();});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{T4.period='2026-09';go('t4-sheet');});
  await page.waitForFunction(()=>T4_SERVER_READY&&!T4_SERVER_LOADING);
  await page.getByRole('button',{name:'通讯录',exact:true}).click();
  await page.getByLabel('联系人 1 姓名',{exact:true}).fill('张三编辑');
  await page.getByLabel('新联系人姓名',{exact:true}).fill('未添加草稿');
  await page.getByLabel('新联系人邮箱',{exact:true}).fill('draft@example.test');
  await page.locator('#t4ContactSearch').fill('李四');
  await page.getByLabel('联系人 2 姓名',{exact:true}).fill('李四编辑');
  await page.getByRole('button',{name:'保存通讯录',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'模拟保存失败'}).waitFor();
  assert.equal(saved.length,2);assert.equal(saved[0].name,'张三编辑');assert.equal(saved[1].name,'李四编辑');
  assert.equal(await page.getByLabel('新联系人邮箱',{exact:true}).inputValue(),'draft@example.test');
  await page.locator('#t4ContactSearch').fill('');
  assert.equal(await page.getByLabel('联系人 1 姓名',{exact:true}).inputValue(),'张三编辑');
  failSave=false;
  await page.getByRole('button',{name:'保存通讯录',exact:true}).click();
  await page.waitForFunction(()=>!T4.mail.dirty&&!T4.mail.saving);
  await page.getByLabel('新联系人邮箱',{exact:true}).fill('ZHANG@example.test');
  await page.getByRole('button',{name:'添加联系人',exact:true}).click();
  assert.match(await page.locator('#toast').innerText(),/邮箱重复/);
  assert.equal(await page.evaluate(()=>T4.mail.list.length),2);
  await page.screenshot({path:`/tmp/finance-contacts-${width}.png`,fullPage:true});
  await page.evaluate(()=>{T4.projFilter='orange';T4.viewFrom='2026-09-12';T4.viewTo='2026-09-12';go('t4-sheet');});
  const dl=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出录入/导入数据',exact:true}).click();
  const download=await dl;
  assert.match(download.suggestedFilename(),/橘农项目_2026-09-12_2026-09-12\.xlsx$/);
  assert.equal(mailCalls,0);assert.deepEqual(errors,[]);
});
