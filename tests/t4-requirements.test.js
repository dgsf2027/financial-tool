const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function app(seed = {}) {
  const storage = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  const handlers = {};
  const context = vm.createContext({
    console, Date, Set, Map, URL, Blob,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { addEventListener: (type, fn) => { handlers[type] = fn; }, querySelectorAll: () => [], getElementById: () => null },
    window: { T4Shared: { clone: x => JSON.parse(JSON.stringify(x)), empty: () => ({ periods: {}, cfg: {}, channels: [] }) } },
    S: {}, go() {}, toast() {}, H: String, pill: String, money: String,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 't4.js'), 'utf8'), context);
  vm.runInContext("originalLoadServer = t4LoadServer; t4LoadServer = async () => {}; T4.period='2026-09'; t4Load();", context);
  return { run: code => vm.runInContext(code, context), storage, handlers };
}

// Opt in only for tests that save edits. Load/migration tests must continue to
// begin disconnected and establish readiness through their own load response.
function connectShared(a) {
  a.run(`T4_SERVER_READY=true; T4_SERVER_VERSION=1;
    T4_SERVER_DOCUMENT=t4ViewDocument({periods:t4Stored(T4_KEY,{}),cfg:t4Stored(T4_CFG_KEY,{}),cfgByPeriod:t4Stored(T4_PERIOD_CFG_KEY,{}),channels:[]});
    T4_SERVER_BASELINE=t4ViewDocument();
    window.T4Shared.save=async document=>({version:T4_SERVER_VERSION+1,document:t4Clone(document)});`);
}

test('orange sales appear only in the orange project, including Douyin', () => {
  const a = app();
  assert.equal(a.run("t4ResolveChannel('抖音-橘农滋补旗舰店')"), 'dy_orange');
  assert.equal(a.run("t4Project(T4_CHM.tm_orange.bu)"), '橘农项目');
  assert.equal(a.run("T4.projFilter='aole'; t4ProjCH().some(c => c.id==='tm_orange')"), false);
  assert.equal(a.run("T4.projFilter='orange'; t4ProjCH().length"), 4);
  assert.equal(a.run("t4TreeNodes()[0].children.find(n=>n.id==='proj:orange').ids.length"), 4);
});

test('an uploaded channel mapping overrides a built-in source mapping', () => {
  const a = app();
  a.run("t4ChApplyRows([['销售渠道','归属事业部','渠道汇总'],['抖音-橘农滋补旗舰店','橘农','天猫-橘农旗舰店']])");
  assert.equal(a.run("t4ResolveChannel('抖音-橘农滋补旗舰店')"), 'tm_orange');
});

test('after-sales shipments retain actual income and cost on summary import, without duplicate reimports', async () => {
  const a = app();
  connectShared(a);
  a.run("T4.periodLocks={'2026-09':false}; T4.sumScope='income'; T4.imp={mode:'summary',headRow:0,map:{channel:0,date:1,type:2,retailIncome:3,retailCost:4},rows:[[],['天猫-澳乐旗舰店','2026-09-02','售后发货',25,12],['天猫-澳乐旗舰店','2026-09-02','售后退货',5,2]]}; savedImp=JSON.stringify(T4.imp)");
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4Row('tmall','2026-09-02').salesIncome"), 20);
  await a.run('T4.imp=JSON.parse(savedImp); t4SummaryImpRun()');
  assert.equal(a.run("t4Row('tmall','2026-09-02').salesIncome"), 20);
  await a.run("T4.sumScope='cost'; T4.imp=JSON.parse(savedImp); t4SummaryImpRun()");
  assert.equal(a.run("t4Row('tmall','2026-09-02').salesCost"), 10);
});

test('switching a shared workspace month loads its own data and monthly allocations', () => {
  const a = app();
  a.run("T4_SERVER_READY=true; T4_SERVER_DOCUMENT={periods:{'2026-08':{tmall:{'2026-08-01':{retailIncome:100}}},'2026-09':{tmall:{'2026-09-01':{retailIncome:200}}}},cfgByPeriod:{'2026-08':{tmall:{directLaborMonth:310}},'2026-09':{tmall:{directLaborMonth:600}}},cfg:{},channels:[]}; T4_LOADED_PERIOD=''; T4.period='2026-08'; t4Load()");
  assert.equal(a.run("t4Month('tmall').salesIncome"), 100);
  assert.equal(a.run("t4MgmtDaily('tmall').directLabor"), 10);
  a.run("T4.period='2026-09'; t4Load()");
  assert.equal(a.run("t4Month('tmall').salesIncome"), 200);
  assert.equal(a.run("t4MgmtDaily('tmall').directLabor"), 20);
  assert.equal(a.run("Object.keys(T4.data.tmall)[0]"), '2026-09-01');
});

test('clearing income for one project preserves costs, other projects and other months', async () => {
  const a = app({ fsc_t4_data_v2: {'2026-08':{tmall:{'2026-08-01':{retailIncome:500}}}} });
  connectShared(a);
  a.run("T4.periodLocks={'2026-09':false}; T4.data={tmall:{'2026-09-01':{retailIncome:100,retailCost:40,_fileParts:{sales:{retailIncome:90,retailCost:30}}}},tm_orange:{'2026-09-01':{retailIncome:200}}}; T4_CH.forEach(c=>T4.data[c.id] ||= {})");
  await a.run("t4ClearPeriodData('aole','income')");
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2026-09-01'),'retailIncome')"), null);
  assert.equal(a.run("t4InputValue(t4Raw('tmall','2026-09-01'),'retailCost')"), 40);
  assert.equal(a.run("t4InputValue(t4Raw('tm_orange','2026-09-01'),'retailIncome')"), 200);
  assert.equal(JSON.parse(a.storage.get('fsc_t4_data_v2'))['2026-08'].tmall['2026-08-01'].retailIncome, 500);
});

test('locked months reject clearing before any mutation', async () => {
  const a = app();
  a.run("T4.periodLocks={'2026-09':true}; T4.data.tmall={'2026-09-01':{retailIncome:100}};");
  await assert.rejects(a.run("t4ClearPeriodData('all','all')"), /锁定/);
  assert.equal(a.run("t4Month('tmall').salesIncome"), 100);
});

test('invalid or unmapped imports cannot erase an existing period source', async () => {
  const a = app();
  a.run("T4.periodLocks={'2026-09':false}; T4.data.tmall={'2026-09-01':{_fileParts:{summaryIncome:{retailIncome:100}}}}; T4.imp={mode:'summary',headRow:0,map:{channel:0,date:1,retailIncome:2},rows:[[],['unknown','2026-09-01',30]]}");
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4Month('tmall').salesIncome"), 100);
});

test('invalid summary money preserves previously imported income', async () => {
  const a = app();
  a.run("T4.periodLocks={'2026-09':false}; T4.data.tmall={'2026-09-01':{_fileParts:{summaryIncome:{retailIncome:100}}}}; T4.imp={mode:'summary',headRow:0,map:{channel:0,date:1,retailIncome:2},rows:[[],['天猫-澳乐旗舰店','2026-09-01','#N/A']]}");
  await a.run('t4SummaryImpRun()');
  assert.equal(a.run("t4Month('tmall').salesIncome"), 100);
});

test('a per-channel file without matching current-month rows cannot erase its previous import', async () => {
  const a = app();
  a.run("T4.periodLocks={'2026-09':false}; T4.data.tmall={'2026-09-01':{_fileParts:{sales:{retailIncome:100,retailCost:40}}}}; T4.imp={fileK:'sales',headRow:0,map:{date:0,channel:1,amount:2,cost:3},rows:[[],['2026-08-01','天猫-澳乐旗舰店',5,2]]}");
  await a.run('t4ImpRun()');
  assert.equal(a.run("t4Month('tmall').salesIncome"), 100);
});

test('per-channel after-sales import records income and cost without counting cost again as after-sales expense', async () => {
  const a = app();
  connectShared(a);
  a.run("T4.periodLocks={'2026-09':false}; T4.cfg.tmall={aftersalesRate:0}; T4.imp={fileK:'sales',headRow:0,map:{date:0,channel:1,type:2,amount:3,cost:4},rows:[[],['2026-09-01','天猫-澳乐旗舰店','售后发货',25,12]]}");
  await a.run('t4ImpRun()');
  assert.equal(a.run("t4Month('tmall').salesIncome"), 25);
  assert.equal(a.run("t4Month('tmall').salesCost"), 12);
  assert.equal(a.run("t4Month('tmall').aftersales"), 0);
});

test('monthly allocation edits leave the previous month and legacy configuration intact', async () => {
  const a = app({ fsc_t4_cfg_v1:{tmall:{directLaborMonth:310}}, fsc_t4_period_locks_v1:{'2026-09':false} });
  connectShared(a);
  await a.run("T4.cfg.tmall.directLaborMonth=600; t4SaveCfg()");
  a.run("T4.period='2026-08'; t4Load()");
  assert.equal(a.run("t4MgmtDaily('tmall').directLabor"),10);
  a.run("T4.period='2026-09'; t4Load()");
  assert.equal(a.run("t4MgmtDaily('tmall').directLabor"),20);
  assert.equal(JSON.parse(a.storage.get('fsc_t4_cfg_v1')).tmall.directLaborMonth,310);
});

test('first sync migrates monthly allocation without making it the default for other months', async () => {
  const a = app({ fsc_t4_data_v2:{'2026-09':{tmall:{'2026-09-01':{retailIncome:10}}}}, fsc_t4_cfg_periods_v1:{'2026-09':{tmall:{directLaborMonth:600}}} });
  a.run("t4CurrentMonth=()=> '2026-09'; window.T4Shared.load=async()=>({found:false,version:0,document:{periods:{},cfg:{},channels:[]}}); window.T4Shared.save=async doc=>{migrated=JSON.parse(JSON.stringify(doc));return {version:1}};");
  await a.run('originalLoadServer()');
  assert.equal(a.run("migrated.cfgByPeriod['2026-09'].tmall.directLaborMonth"),600);
  assert.equal(a.run("T4.period='2026-10'; t4Load(); t4MgmtDaily('tmall').directLabor"),0);
});

test('a locked historical local draft can load the server and persist an unlock before migrating', async () => {
  const a = app({ fsc_t4_data_v2:{'2026-08':{tmall:{'2026-08-01':{retailIncome:10}}}} });
  a.run("T4.period='2026-08'; t4Load(); t4CurrentMonth=()=> '2026-09'; saves=[]; window.T4Shared.load=async()=>({found:false,version:0,document:{periods:{},cfg:{},channels:[]}}); window.T4Shared.save=async doc=>{saves.push(JSON.parse(JSON.stringify(doc)));return {version:saves.length}};");
  await a.run('originalLoadServer()');
  assert.equal(a.run('T4_SERVER_READY'),true);
  assert.equal(a.run('saves.length'),0);
  assert.equal(a.run("T4_PENDING_DRAFT.data.tmall['2026-08-01'].retailIncome"),10);
  await a.run('t4SetPeriodLock(false)');
  assert.equal(a.run("saves[0].periodLocks['2026-08']"),false);
  assert.equal(a.run("Object.keys(saves[0].periods).length"),0);
});

test('an allocation date cannot switch months during an in-flight save', () => {
  const a = app();
  a.run('T4_SERVER_SAVING=true');
  a.handlers.change({target:{id:'t4MgmtFrom',value:'2026-10-01'}});
  assert.equal(a.run('T4.period'),'2026-09');
  a.run('T4_SERVER_SAVING=false');
  a.handlers.change({target:{id:'t4MgmtFrom',value:'2026-10-01'}});
  assert.equal(a.run('T4.period'),'2026-09');
});

test('refreshing after a historical draft unlock retains the pending import without overwriting cloud data', async () => {
  const a = app({ fsc_t4_data_v2:{'2026-08':{tmall:{'2026-08-01':{retailIncome:10}}}} });
  a.run("T4.period='2026-08'; t4Load(); t4CurrentMonth=()=> '2026-09'; window.T4Shared.load=async()=>({found:false,version:0,document:{periods:{},cfg:{},channels:[]}}); window.T4Shared.save=async doc=>({version:1});");
  await a.run('originalLoadServer()'); await a.run('t4SetPeriodLock(false)');
  const b = app(Object.fromEntries([...a.storage].map(([key,value])=>[key,JSON.parse(value)])));
  b.run("T4.period='2026-08'; t4Load(); window.T4Shared.load=async()=>({found:true,version:1,document:{periods:{},cfg:{},channels:[],periodLocks:{'2026-08':false}}})");
  await b.run('originalLoadServer()');
  assert.equal(b.run("T4_PENDING_DRAFT?.data.tmall['2026-08-01'].retailIncome"),10);
  assert.equal(b.run("t4Month('tmall').salesIncome"),0);
});

test('loading an existing legacy workspace never writes back or replaces it with a local draft', async () => {
  const local = {'2026-09': {tmall: {'2026-09-01': {retailIncome: 9999}}}};
  const a = app({fsc_t4_data_v2: local});
  const legacy = {
    periods: {
      '2026-08': {tmall: {'2026-08-01': {retailIncome: 310}}},
      '2026-09': {
        tmall: {'2026-09-01': {retailIncome: 200, retailCost: 80, _srcs: {retailIncome: 'sales', retailCost: 'sales'}}},
        custom_shop: {'2026-09-02': {retailIncome: 50}},
      },
    },
    cfg: {tmall: {directLaborMonth: 310}, custom_shop: {directLaborMonth: 30}},
    channels: [{id: 'custom_shop', n: '已有自定义渠道', bu: 'dealer', aliases: ['旧渠道别名']}],
    metadata: {legacyValue: 'keep'},
  };
  a.run(`legacy = ${JSON.stringify(legacy)}; saves=[]; window.T4Shared.load=async()=>({found:true,version:12,document:legacy}); window.T4Shared.save=async doc=>{saves.push(doc);return {version:13}};`);
  await a.run('originalLoadServer()');
  assert.equal(a.run('T4_SERVER_READY'), true);
  assert.equal(a.run('T4_SERVER_VERSION'), 12);
  assert.equal(a.run('saves.length'), 0);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(T4_SERVER_DOCUMENT)')), legacy);
  assert.deepEqual(JSON.parse(a.storage.get('fsc_t4_data_v2')), local);
  assert.equal(a.run("t4Month('tmall').salesIncome"), 200);
  assert.equal(a.run("t4Month('tmall').salesCost"), 80);
  assert.equal(a.run("t4Month('custom_shop').salesIncome"), 50);
  assert.equal(a.run("t4ResolveChannel('旧渠道别名')"), 'custom_shop');
});

test('saving current-month allocation preserves legacy history, configuration and custom channels', async () => {
  const a = app();
  const legacy = {
    periods: {
      '2026-08': {tmall: {'2026-08-01': {retailIncome: 310, retailCost: 100, _srcs: {retailIncome: 'sales'}}}},
      '2026-09': {tmall: {'2026-09-01': {retailIncome: 200, retailCost: 80}}},
    },
    cfg: {tmall: {directLaborMonth: 310, feeRate: 0.02}},
    channels: [{id: 'custom_shop', n: '已有自定义渠道', bu: 'dealer', aliases: ['旧渠道别名']}],
    metadata: {legacyValue: 'keep'},
  };
  a.run(`legacy = ${JSON.stringify(legacy)}; t4CurrentMonth=()=> '2026-09'; window.T4Shared.load=async()=>({found:true,version:12,document:legacy}); window.T4Shared.save=async doc=>{saved=JSON.parse(JSON.stringify(doc));return {version:13}};`);
  await a.run('originalLoadServer()');
  await a.run('T4.cfg.tmall.directLaborMonth=600; t4SaveCfg()');
  const saved = JSON.parse(a.run('JSON.stringify(saved)'));
  assert.deepEqual(saved.periods['2026-08'], legacy.periods['2026-08']);
  assert.deepEqual(saved.periods['2026-09'].tmall, legacy.periods['2026-09'].tmall);
  assert.deepEqual(saved.cfg, legacy.cfg);
  assert.deepEqual(saved.channels, legacy.channels);
  assert.deepEqual(saved.metadata, legacy.metadata);
  assert.equal(saved.cfgByPeriod['2026-09'].tmall.directLaborMonth, 600);
  assert.equal(a.run("T4.period='2026-08'; t4Load(); t4MgmtDaily('tmall').directLabor"), 10);
});

test('shared saves retain the loaded view baseline and adopt the canonical merged document', async () => {
  const a = app();
  a.run(`t4CurrentMonth=()=> '2026-09';
    window.T4Shared.load=async()=>({found:true,version:1,document:{periods:{},cfg:{},channels:[]}});
    window.T4Shared.save=async(doc,user,baseline)=>{
      sentBaseline=baseline;
      const merged=JSON.parse(JSON.stringify(doc));
      merged.cfgByPeriod['2026-09'].jdpop.directLaborMonth=200;
      merged.periods['2026-09'].jdpop={'2026-09-01':{retailIncome:300}};
      return {version:3,document:merged};
    };`);
  await a.run('originalLoadServer()');
  const oldValue = a.run('T4.cfg.tmall.directLaborMonth');
  await a.run('T4.cfg.tmall.directLaborMonth=100; t4SaveCfg()');
  assert.equal(a.run('T4.cfg.jdpop.directLaborMonth'), 200);
  assert.equal(a.run("T4_SERVER_DOCUMENT.periods['2026-09'].jdpop['2026-09-01'].retailIncome"), 300);
  assert.equal(a.run("sentBaseline.cfgByPeriod['2026-09'].tmall.directLaborMonth"), oldValue);
  assert.equal(a.run("T4_SERVER_BASELINE.cfgByPeriod['2026-09'].jdpop.directLaborMonth"), 200);
});

test('parameter save refreshes the displayed form after a successful merge', async () => {
  const a = app();
  a.run("views=[]; t4Go=view=>views.push(view); t4SaveCfg=async()=>{}; T4.periodLocks={'2026-09':false}");
  const button = { dataset: { t4act: 'cfgSave' } };
  await a.handlers.click({ target: { closest: selector => selector.includes('[data-t4act]') ? button : null } });
  assert.equal(a.run("views.join(',')"), 'cfg');
});

test('adding a parameter rule never announces success when shared saving fails', async () => {
  const a = app();
  a.run("messages=[]; views=[]; toast=msg=>messages.push(msg); t4Go=view=>views.push(view); t4SaveCfg=async()=>{throw new Error('同一字段冲突')}; document.querySelector=()=>({value:'platformFeeRate'}); T4.periodLocks={'2026-09':false}");
  const button = { dataset: { t4cfgadd: 'tmall' } };
  await a.handlers.click({ target: { closest: selector => selector.includes('[data-t4cfgadd]') ? button : null } });
  assert.equal(a.run("messages.some(msg=>msg.includes('同一字段冲突'))"), true);
  assert.equal(a.run('views.length'), 0);
});

test('deleting a built-in parameter stays deleted after adopting the saved document', async () => {
  const a = app();
  a.run("t4CurrentMonth=()=> '2026-09'; t4Go=()=>{}; window.T4Shared.load=async()=>({found:true,version:1,document:{periods:{},cfg:{},channels:[]}}); window.T4Shared.save=async doc=>({version:2,document:doc})");
  await a.run('originalLoadServer()');
  assert.equal(a.run('T4.cfg.tmall.platformFeeRate != null'), true);
  const button = { dataset: { t4cfgdel: 'tmall:platformFeeRate' } };
  await a.handlers.click({ target: { closest: selector => selector.includes('[data-t4cfgdel]') ? button : null } });
  assert.equal(a.run('T4.cfg.tmall.platformFeeRate == null'), true);
  a.run('t4ApplyPeriod(T4_SERVER_DOCUMENT)');
  assert.equal(a.run('T4.cfg.tmall.platformFeeRate == null'), true);
});

test('editable form controls are disabled during a shared save and restored on failure', async () => {
  const a = app();
  a.run("t4CurrentMonth=()=> '2026-09'; window.T4Shared.load=async()=>({found:true,version:1,document:{periods:{},cfg:{},channels:[]}})");
  await a.run('originalLoadServer()');
  a.run("field={disabled:false}; disabledField={disabled:true}; document.querySelectorAll=()=>[field,disabledField]; window.T4Shared.save=()=>new Promise((resolve,reject)=>{rejectSave=reject})");
  const saving = a.run('t4SaveCfg()');
  const rejected = assert.rejects(saving, /offline/);
  assert.equal(a.run('field.disabled'), true);
  a.run("rejectSave(new Error('offline'))");
  await rejected;
  assert.equal(a.run('field.disabled'), false);
  assert.equal(a.run('disabledField.disabled'), true);
});
