const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
let root, base, child, cfg;
const secret = 'recipients-test-secret';
const cookie = () => {
  const body = Buffer.from(JSON.stringify({ portalUid:'contacts-test',tenantId:'test',exp:4102444800000 })).toString('base64url');
  return `t4_session=${body}.${crypto.createHmac('sha256',secret).update(body).digest('base64url')}`;
};
const post = body => fetch(`${base}/api/t4/recipients`, {method:'POST',headers:{Cookie:cookie(),'Content-Type':'application/json'},body: typeof body === 'string' ? body : JSON.stringify(body)});
const get = () => fetch(`${base}/api/t4/recipients`, {headers:{Cookie:cookie()}}).then(r=>r.json());
before(async () => {
  root=fs.mkdtempSync(path.join(os.tmpdir(),'finance-contacts-')); cfg=path.join(root,'suite','_cfg');
  fs.copyFileSync(path.join(__dirname,'..','server.js'),path.join(root,'server.js'));
  const preload=path.join(root,'fail-rename.js');
  fs.writeFileSync(preload, `const fs=require('fs');const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(fs.existsSync(${JSON.stringify(path.join(root,'fail-save'))})&&to.endsWith('recipients.json'))throw new Error('simulated disk failure');return rename(from,to)};`);
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
  base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['--require',preload,path.join(root,'server.js'),String(port)],{env:{...process.env,T4_SESSION_SECRET:secret},stdio:'ignore'});
  for(let i=0;i<200;i++) { try {if((await fetch(`${base}/healthz`)).ok)return;}catch(_){} await new Promise(resolve=>setTimeout(resolve,25)); }
  throw new Error('server failed to start');
});
after(()=>{child?.kill();if(root)fs.rmSync(root,{recursive:true,force:true});});

test('saving normalizes contacts and stores only supported fields without sending mail',async()=>{
  const response=await post([{name:' 张三 ',email:' Person@example.test ',scope:'orange',enabled:false,extra:'omit'}]);
  assert.equal(response.status,200);
  const expected=[{name:'张三',email:'Person@example.test',scope:'orange',enabled:false}];
  assert.deepEqual((await response.json()).recipients,expected);
  assert.deepEqual(await get(),expected);
  assert.deepEqual(fs.readdirSync(cfg),['recipients.json']);
});

test('invalid contact lists leave previously saved contacts intact',async()=>{
  const before=await get();
  for(const list of [
    [{email:'broken'}], [{email:'one@example.test',scope:'unknown'}],
    [{email:'Person@example.test',scope:'all'},{email:'person@EXAMPLE.test',scope:'orange'}],
    [{name:'x'.repeat(101),email:'a@example.test'}], [null], {}, '{bad json',
  ]) {
    const response=await post(list);assert.equal(response.status,400);
    assert.deepEqual(await get(),before);
  }
  assert.deepEqual(fs.readdirSync(cfg),['recipients.json']);
});

test('failed atomic replacement retains the prior file and cleans temporary output',async()=>{
  const before=await get();fs.writeFileSync(path.join(root,'fail-save'),'1');
  try {assert.equal((await post([{email:'next@example.test',scope:'all'}])).status,500);}finally{fs.unlinkSync(path.join(root,'fail-save'));}
  assert.deepEqual(await get(),before);
  assert.deepEqual(fs.readdirSync(cfg),['recipients.json']);
});

test('an empty contact list can be saved intentionally',async()=>{
  assert.equal((await post([])).status,200);assert.deepEqual(await get(),[]);
});
