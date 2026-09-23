"""Real JS shared client -> HTTP handler -> temporary SQLite catalog round trip."""
import json
import subprocess
import unittest
import test_sync_patch as fixture


class ExpenseCatalogHTTPTest(unittest.TestCase):
    setUp = fixture.SyncPatchTest.setUp
    stop_server = fixture.SyncPatchTest.stop_server
    request = fixture.SyncPatchTest.request
    change = fixture.SyncPatchTest.change
    save_changes = fixture.SyncPatchTest.save_changes
    assert_unchanged = fixture.SyncPatchTest.assert_unchanged

    def test_actual_js_catalog_and_daily_saves_reload_from_sqlite(self):
        script = r'''
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const [root, endpoint] = process.argv.slice(1);
async function app() {
  const storage = new Map();
  const c = vm.createContext({ console, Date, Set, Map, Intl, Math,
    window:{}, S:{}, go(){}, toast(){},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    document:{addEventListener(){},querySelectorAll:()=>[],getElementById:()=>null},
    fetch:(url, options={})=>fetch(endpoint, options), CUR_USER:'catalog-http-test' });
  for(const file of ['t4-sync.js','t4-allocation.js','t4.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c);
  const run=code=>vm.runInContext(code,c);
  run("T4.period='2099-01';t4CurrentMonth=()=> '2099-01';"); await run('t4LoadServer()');
  return {run,c};
}
(async()=>{
  const a=await app();
  const key=await a.run("t4SaveExpenseItem({n:'HTTP直播服务费'})"); a.c.key=key;
  await a.run("t4SaveDailyExpenses('pdd_aole','2099-01-01',[{k:key,value:'125.50',original:''}])");
  await a.run("t4SaveDailyExpenses('pdd_aole','2099-01-02',[{k:key,value:'0',original:''}])");
  await a.run("t4SaveDailyExpenses('pdd_aole','2099-01-03',[{k:key,value:'-25.50',original:''}])");
  const b=await app(); b.c.key=key;
  assert.equal(b.run('T4.expenseItems[0].k'),key);
  assert.equal(b.run("T4_METRICS.find(m=>m.k===key).n.trim()"),'HTTP直播服务费');
  assert.equal(b.run("t4Raw('pdd_aole','2099-01-02')[key]"),0);
  assert.equal(b.run("t4Month('pdd_aole').operating"),100);
  assert.equal(b.run("t4Month('pdd_aole').netProfit"),-100);
  await b.run("t4SaveExpenseItem({k:key,n:'HTTP改名服务费'})");
  const c=await app(); c.c.key=key;
  assert.equal(c.run('T4.expenseItems[0].n'),'HTTP改名服务费');
  assert.equal(c.run("t4Raw('pdd_aole','2099-01-01')[key]"),125.5);
  assert.equal(c.run("t4SuitePayload().operatingKeys.includes(key)"),true);
  c.run(`XLSXLite={readSheets:async()=>[[['渠道ID','销售渠道','归属事业部'],['tmall','HTTP新店名','大电商']]]};
    picker={files:[{name:'真实渠道模板.xlsx'}],click(){}}; document.createElement=()=>picker;t4ChPickFile();`);
  await c.run('picker.onchange()');
  assert.equal(c.run("Object.values(T4.importHistory)[0].scope"),'渠道列表');
  assert.equal(c.run("Object.values(T4.importHistory)[0].actor"),'catalog-http-test');
  c.run(`T4.allocImport={kind:'payroll',fileName:'真实工资底稿.xlsx',sheet:0,
    sheets:[[['渠道','直接人工','人力公摊'],['HTTP新店名',300,0]]]};`);
  await c.run('t4ApplyAllocationImport()');
  const d=await app();
  assert.equal(d.run('Object.keys(T4.importHistory).length'),2);
  assert.equal(d.run('T4.cfg.tmall.directLaborMonth'),300);
  assert.equal(d.run('T4.cfg.tmall.sharedLaborMonth'),0);
  console.log(JSON.stringify({key,version:d.run('T4_SERVER_VERSION')}));
})().catch(err=>{console.error(err);process.exitCode=1;});
'''
        result = subprocess.run(['node', '-e', script, str(fixture.ROOT), self.url], text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads(result.stdout)
        status, loaded = self.request()
        self.assertEqual(status, 200)
        key = evidence['key']
        self.assertEqual(loaded['document']['expenseItems'], [{'k': key, 'n': 'HTTP改名服务费'}])
        values = loaded['document']['periods'][fixture.MONTH]['pdd_aole']
        self.assertEqual(values['2099-01-02'][key], 0)
        self.assertEqual(values['2099-01-03'][key], -25.5)
        self.assertGreaterEqual(loaded['version'], 8)
        self.assertEqual({r['scope'] for r in loaded['document']['importHistory'].values()}, {'渠道列表', '工资分摊'})
        self.assertEqual(loaded['document']['cfgByPeriod'][fixture.MONTH]['tmall']['directLaborMonth'], 300)

    def test_bad_catalog_rejects_accompanying_daily_amount_without_partial_write(self):
        status, result = self.save_changes(
            self.change(['expenseItems'], value=[{'k': 'expense_http', 'n': '<bad>'}], oldExists=False),
            self.change(['periods', fixture.MONTH, 'tmall', fixture.DAY, 'expense_http'], value=99, oldExists=False))
        self.assertEqual(status, 400, result)
        self.assert_unchanged()


if __name__ == '__main__':
    unittest.main()
