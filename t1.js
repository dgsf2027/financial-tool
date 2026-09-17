/* T1 资金日报生成器
   账户台账预置 → 每日只填变动的 → 三级汇总 + 变动率预警/覆盖红线 → 一键生成钉钉文本
   分布表按主体出「较上日变动率」，超阈值（默认 ±10%）标预警；
   余额可下钻：主体 → 账户 → 导入留存的流水明细（T2 转换或 T1 对账单导入都会留存）。
   诚实定位：登网银抄余额这步省不掉，工具省的是抄完之后的汇总/算/排版/发。
   依赖 app.js 的工具函数。 */
'use strict';

/* v3：主体从简称改成法人全称。台账里的主体名变了，不升键的话
   已经载入过 v2 的浏览器还是旧的简称，跟 T2 的 ENTITIES 对不上、账户下拉会空。
   v2：台账换成《银行资料信息/银行.xlsx》里的真实账户，id 前缀 A → B
   （旧余额按 A0xx 存，不换前缀会错挂到新账户上）。 */
const T1_ACC_KEY = 'fsc_t1_accounts_v3';
const T1_DAY_KEY = 'fsc_t1_daily_v1';
/* v2：主体换成法人公司后，旧 cfg 里那份按访谈估的月固定支出必须一起作废。
   有几个简称（优栖/瑞眠/云帕…）正好撞上，不换键就会拿假数字算覆盖倍数、报假红线。 */
const T1_CFG_KEY = 'fsc_t1_cfg_v2';

/* 账户台账 —— 取自《银行资料信息/银行.xlsx》，37 个法人主体 / 58 个银行账户。
   主体一律用法人全称，不用简称：简称是二次加工，两个系统各写各的迟早对不上。 */
const T1_PRESET = [
  // 法人全称, 账户名, 类型, 账号
  // 广州乐时婴童用品有限公司
  ['广州乐时婴童用品有限公司', '工行基本户', 'bank', '3602201109100201479'],
  // 广州星逸文化有限公司
  ['广州星逸文化有限公司', '招行一般户', 'bank', '755941553710102'],
  ['广州星逸文化有限公司', '工行基本户', 'bank', '3602201109100129943'],
  // 广州澳乐电子商务科技有限公司
  ['广州澳乐电子商务科技有限公司', '工行一般户 7864', 'bank', '3602201109100127864'],
  ['广州澳乐电子商务科技有限公司', '招行一般户', 'bank', '120914833010605'],
  ['广州澳乐电子商务科技有限公司', '工行美元户', 'bank', '3602201109100180986'],
  ['广州澳乐电子商务科技有限公司', '建行基本户', 'bank', '44050158010700003065'],
  ['广州澳乐电子商务科技有限公司', '中行一般户 1459', 'bank', '738077181459'],
  ['广州澳乐电子商务科技有限公司', '中行一般户 2190', 'bank', '673077492190'],
  ['广州澳乐电子商务科技有限公司', '网商一般户', 'bank', '8888888076590437'],
  ['广州澳乐电子商务科技有限公司', '工行一般户 0445', 'bank', '3602116619100470445'],
  // 广州市橘农农业发展有限公司
  ['广州市橘农农业发展有限公司', '工行基本户', 'bank', '3602201109100128518'],
  ['广州市橘农农业发展有限公司', '中行一般户', 'bank', '718577180149'],
  // 深圳萌立方文化有限公司
  ['深圳萌立方文化有限公司', '建行基本户', 'bank', '44250100013600000702'],
  // 广州贝堡儿童用品有限公司
  ['广州贝堡儿童用品有限公司', '中行基本户', 'bank', '660066686671'],
  ['广州贝堡儿童用品有限公司', '招行一般户', 'bank', '120915235710703'],
  ['广州贝堡儿童用品有限公司', '建行一般户', 'bank', '44050158010700003333'],
  // 广州澳乐游玩母婴用品有限公司
  ['广州澳乐游玩母婴用品有限公司', '工行基本户', 'bank', '3602201109100146801'],
  ['广州澳乐游玩母婴用品有限公司', '中行一般户', 'bank', '654875145901'],
  ['广州澳乐游玩母婴用品有限公司', '建行一般户', 'bank', '44050158010700003569'],
  // 广州达观文化有限公司
  ['广州达观文化有限公司', '工行基本户', 'bank', '3602201109100150071'],
  // 广州市星逸贸易有限公司
  ['广州市星逸贸易有限公司', '招行基本户', 'bank', '120907133510202'],
  ['广州市星逸贸易有限公司', '建行一般户', 'bank', '44001490053052504657'],
  ['广州市星逸贸易有限公司', '网商一般户', 'bank', '8888888038441554'],
  // 广州堂品玩具有限公司
  ['广州堂品玩具有限公司', '浦发一般户', 'bank', '82030154700000406'],
  ['广州堂品玩具有限公司', '工行基本户', 'bank', '3602201109100067975'],
  ['广州堂品玩具有限公司', '网商一般户', 'bank', '8888888201845854'],
  // 广州奇妙口袋供应链有限公司
  ['广州奇妙口袋供应链有限公司', '中行基本户', 'bank', '697766676096'],
  ['广州奇妙口袋供应链有限公司', '建行一般户', 'bank', '44050158010700003334'],
  // 广州有方新媒体科技有限公司
  ['广州有方新媒体科技有限公司', '招行基本户', 'bank', '120914315710601'],
  // 广州昭妍贸易有限公司
  ['广州昭妍贸易有限公司', '农行基本户', 'bank', '44032101040005223'],
  // 广州源美生物科技有限公司
  ['广州源美生物科技有限公司', '招行基本户', 'bank', '120915273010903'],
  // 广州锐度生物科技有限公司
  ['广州锐度生物科技有限公司', '招行基本户', 'bank', '120915330610203'],
  // 广州艺晟生物科技有限公司
  ['广州艺晟生物科技有限公司', '招行基本户', 'bank', '120917408410902'],
  // 广州荣耀商贸有限公司
  ['广州荣耀商贸有限公司', '建行基本户', 'bank', '44050155150200000430'],
  ['广州荣耀商贸有限公司', '农行一般户', 'bank', '44071701040000603'],
  // 广州不易文化传播有限公司
  ['广州不易文化传播有限公司', '工行基本户', 'bank', '3602201109100436356'],
  // 广州德逸技术有限责任公司
  ['广州德逸技术有限责任公司', '农商基本户', 'bank', '03101432000000488'],
  // 广州泰昌百川管理咨询有限责任公司
  ['广州泰昌百川管理咨询有限责任公司', '建行基本户', 'bank', '44050158010700004231'],
  // 广州万视智能科技有限责任公司
  ['广州万视智能科技有限责任公司', '招行一般户', 'bank', '120917009510601'],
  ['广州万视智能科技有限责任公司', '中行基本户', 'bank', '680876122444'],
  ['广州万视智能科技有限责任公司', '中行一般户', 'bank', '713378284904'],
  // 广州贝蜜电子商务有限公司
  ['广州贝蜜电子商务有限公司', '工行账户', 'bank', '3602201109100403932'],
  // 广州数智云仓产业园运营有限公司
  ['广州数智云仓产业园运营有限公司', '建行基本户', 'bank', '44050129162500000277'],
  // 广州云泰运营管理有限公司
  ['广州云泰运营管理有限公司', '建行基本户', 'bank', '44050129162500000270'],
  // AOLE. Limited
  ['AOLE. Limited', '建行亚洲港元户', 'bank', '846210258411'],
  // 优栖（广州）服务管理有限公司
  ['优栖（广州）服务管理有限公司', '工行账户', 'bank', '3602116609100466418'],
  // 海南钧恒投资有限公司
  ['海南钧恒投资有限公司', '农行账户', 'bank', '21-225001040035724'],
  // 海南弈晟企业管理有限公司
  ['海南弈晟企业管理有限公司', '农行账户', 'bank', '21-225001040035732'],
  // 广州智租贸易有限公司
  ['广州智租贸易有限公司', '工行账户', 'bank', '3602116609100482595'],
  // 广州优机库贸易有限公司
  ['广州优机库贸易有限公司', '工行账户', 'bank', '3602116609100484426'],
  // 广州瑞眠科技有限公司
  ['广州瑞眠科技有限公司', '工行账户', 'bank', '3602116609100485851'],
  // 广州云迪物业管理服务合伙企业（有限合伙）
  ['广州云迪物业管理服务合伙企业（有限合伙）', '工行基本户', 'bank', '3602003709200608024'],
  // 广州云湃供应链服务合伙企业（有限合伙）
  ['广州云湃供应链服务合伙企业（有限合伙）', '工行基本户', 'bank', '3602003709200608671'],
  // 广州云帕供应链管理有限公司
  ['广州云帕供应链管理有限公司', '工行基本户', 'bank', '3602003709200605167'],
  // 广州云基电子商务合伙企业（有限合伙）
  ['广州云基电子商务合伙企业（有限合伙）', '工行基本户', 'bank', '3602003709200609325'],
  // 广州闪租数码贸易有限公司
  ['广州闪租数码贸易有限公司', '工行基本户', 'bank', '3602003709200609449'],
  // 中山市木同日用品有限公司
  ['中山市木同日用品有限公司', '建行基本户', 'bank', '44050178150100003420'],
];

/* 月固定支出（算覆盖倍数用）。银行资料表里没有这项，一律留空，
   在台账页填了才会算覆盖倍数和红线——不编数。 */
const T1_FIXED = {};

const T1 = { date: new Date().toISOString().slice(0, 10), view: 'daily', filterEnt: '', imp: null, drillEnt: '', drillAcc: '' };

function t1LoadAcc() {
  try { const s = JSON.parse(localStorage.getItem(T1_ACC_KEY) || 'null'); if (s && s.length) return s; } catch (e) { /* 忽略 */ }
  const init = T1_PRESET.map((p, i) => ({ id: 'B' + String(i + 1).padStart(3, '0'), ent: p[0], name: p[1], type: p[2], no: p[3] || '', on: 1 }));
  t1SaveAcc(init); return init;
}
function t1SaveAcc(a) { try { localStorage.setItem(T1_ACC_KEY, JSON.stringify(a)); } catch (e) { toast('账户台账保存失败'); } }
let T1_ACC = t1LoadAcc();

function t1LoadCfg() {
  try {
    const s = JSON.parse(localStorage.getItem(T1_CFG_KEY) || 'null');
    if (s) { if (s.rateTh === undefined) s.rateTh = 10; return s; }   // 老配置补默认阈值
  } catch (e) { /* 忽略 */ }
  return { ratio: 1.5, rateTh: 10, fixed: { ...T1_FIXED } };
}
function t1SaveCfg(c) { try { localStorage.setItem(T1_CFG_KEY, JSON.stringify(c)); } catch (e) { /* 忽略 */ } }
let T1_CFG = t1LoadCfg();

function t1LoadDay() { try { return JSON.parse(localStorage.getItem(T1_DAY_KEY) || '{}'); } catch (e) { return {}; } }
function t1SaveDay(d) { try { localStorage.setItem(T1_DAY_KEY, JSON.stringify(d)); } catch (e) { toast('余额保存失败'); } }

const t1Prev = date => {
  const all = Object.keys(t1LoadDay()).filter(d => d < date).sort();
  return all.length ? all[all.length - 1] : null;
};

/** 取某日各账户的有效余额：今日填了用今日；没填则沿用最近一次，并标记 stale */
function t1Effective(date) {
  const day = t1LoadDay();
  const today = day[date] || {};
  const hist = Object.keys(day).filter(d => d <= date).sort();
  const out = {};
  T1_ACC.filter(a => a.on).forEach(a => {
    if (today[a.id] !== undefined) { out[a.id] = { v: +today[a.id], stale: 0, from: date }; return; }
    for (let i = hist.length - 1; i >= 0; i--) {
      const d = hist[i];
      if (day[d] && day[d][a.id] !== undefined) { out[a.id] = { v: +day[d][a.id], stale: 1, from: d }; return; }
    }
    out[a.id] = { v: null, stale: 0, from: null };  // 从未有数
  });
  return out;
}

/** 按主体汇总 */
function t1ByEnt(date) {
  const eff = t1Effective(date), prevD = t1Prev(date);
  const prevEff = prevD ? t1Effective(prevD) : null;
  const m = {};
  T1_ACC.filter(a => a.on).forEach(a => {
    const e = m[a.ent] = m[a.ent] || { ent: a.ent, bal: 0, prev: 0, n: 0, stale: 0, miss: 0, accs: [] };
    const v = eff[a.id];
    if (v.v === null) { e.miss++; }
    else { e.bal += v.v; e.n++; if (v.stale) e.stale++; }
    if (prevEff && prevEff[a.id] && prevEff[a.id].v !== null) e.prev += prevEff[a.id].v;
    e.accs.push({ ...a, ...v });
  });
  Object.values(m).forEach(e => {
    e.delta = prevEff ? e.bal - e.prev : null;
    e.fixed = T1_CFG.fixed[e.ent] || 0;
    // 有账户从未录入时余额是不全的，此时算出来的覆盖倍数偏低且不可信，
    // 不报红线——否则会把「没抄数」误报成「快没钱了」。
    e.incomplete = e.miss > 0;
    e.cover = (e.fixed && !e.incomplete) ? e.bal / e.fixed : null;
    e.red = e.cover !== null && e.cover < T1_CFG.ratio;
    // 较上日变动率：上一日合计为 0（或没有上一日）时分母不成立，不算、不报警
    e.rate = (prevEff && e.prev > 0.005) ? (e.bal - e.prev) / e.prev * 100 : null;
    e.rateWarn = e.rate !== null && Math.abs(e.rate) >= (T1_CFG.rateTh || 10);
  });
  return Object.values(m).sort((a, b) => b.bal - a.bal);
}

/* ============ 给 T2 用的接口 ============ */
/* 账户主数据只有 T1 这一份，T2 不自己存账户，只通过下面两个函数引用。
   放在这里是为了让「谁在用 T1 的账户」一眼可见——改这两个函数前先看 T2 的调用点。 */

/** 某主体的在管账户列表（T2 步骤 2 的账户下拉用）。ent 传主体简称，如「优栖」 */
function t1Accounts(ent) {
  return T1_ACC.filter(a => a.on && (!ent || a.ent === ent));
}
/** 按 id 取账户 */
const t1AccById = id => T1_ACC.find(a => a.id === id) || null;

/* 账号比对要容忍打码：对账单里常是 6215****1234，台账里可能存的是完整卡号。
   去掉分隔符和星号后，先试全等，再试「前 4 位 + 后 4 位都一样」。 */
const t1NoKey = s => String(s == null ? '' : s).replace(/[\s　\-*＊·]/g, '');
function t1NoMatch(a, b) {
  const x = t1NoKey(a), y = t1NoKey(b);
  if (x.length < 6 || y.length < 6) return false;
  if (x === y) return true;
  return x.slice(0, 4) === y.slice(0, 4) && x.slice(-4) === y.slice(-4);
}
/** 按账号找在管账户（T2 上传文件后靠这个自动认账户） */
function t1FindAccByNo(no) {
  if (!no) return null;
  return T1_ACC.find(a => a.on && a.no && t1NoMatch(a.no, no)) || null;
}
/** 把账号写进某个账户（T2 认不出账户时，用户当场绑定，下次就自动了） */
function t1BindAcctNo(accId, no) {
  const a = t1AccById(accId);
  if (!a || !no) return false;
  a.no = String(no).trim(); t1SaveAcc(T1_ACC); return true;
}

/* 余额来源留痕：哪些余额是 T2 流水带进来的，T1 界面上要标出来，
   否则用户分不清哪个数是自己抄的、哪个是机器填的。 */
const T1_SRC_KEY = 'fsc_t1_balsrc_v1';
function t1LoadSrc() { try { return JSON.parse(localStorage.getItem(T1_SRC_KEY) || '{}'); } catch (e) { return {}; } }
function t1SaveSrc(s) { try { localStorage.setItem(T1_SRC_KEY, JSON.stringify(s)); } catch (e) { /* 忽略 */ } }

/**
 * 把某账户某天的余额写进 T1。
 * 不传 force 时遇到「那天已有值且和新值对不上」不写，返回 conflict 让调用方去问用户，
 * 避免静默盖掉手工抄的数。
 * @returns {{ok:boolean, conflict?:boolean, old?:number, val?:number, reason?:string}}
 */
function t1PutBalance(accId, date, val, from, force) {
  const acc = t1AccById(accId);
  if (!acc) return { ok: false, reason: '账户不存在：' + accId };
  if (!date || isNaN(Number(val))) return { ok: false, reason: '日期或金额无效' };
  const day = t1LoadDay();
  const d = day[date] || (day[date] = {});
  const old = d[accId];
  if (old !== undefined && Math.abs(old - val) > 0.005 && !force) {
    return { ok: false, conflict: true, old, val };
  }
  d[accId] = Number(val);
  t1SaveDay(day);
  const src = t1LoadSrc();
  (src[date] || (src[date] = {}))[accId] = from || 'T2';
  t1SaveSrc(src);
  return { ok: true, val: Number(val) };
}
/** 该余额是不是 T2 带进来的 */
const t1BalFrom = (date, accId) => (t1LoadSrc()[date] || {})[accId] || '';

/**
 * 撤回一条自动写入的余额。
 * 用在 T2 里改了账户的时候：余额要搬到新账户，旧账户上那笔是写错的，得撤掉，
 * 否则那个账户会凭空多出一笔它从没有过的余额。
 * 只撤「来源是自动写入、且值没被人手改过」的，人工调过的一律不动。
 */
function t1ClearBalance(accId, date, from, expectVal) {
  if (!accId || !date) return false;
  if (t1BalFrom(date, accId) !== from) return false;
  const day = t1LoadDay();
  const d = day[date];
  if (!d || d[accId] === undefined) return false;
  if (expectVal !== undefined && Math.abs(d[accId] - expectVal) > 0.005) return false;
  delete d[accId];
  if (!Object.keys(d).length) delete day[date];
  t1SaveDay(day);
  const src = t1LoadSrc();
  if (src[date]) { delete src[date][accId]; if (!Object.keys(src[date]).length) delete src[date]; }
  t1SaveSrc(src);
  return true;
}

/* 流水明细留存：T2 每转换一批、T1 导入每导一份带交易列的对账单，
   都把解析出的流水按「账户 + 交易日」存一份，
   T1 里点余额下钻时能看到每一笔是什么。余额是结论，流水是物证。
   同账户同一天重复导入 = 整天替换，不累加，所以重传同一份文件不会翻倍。 */
const T1_TXN_KEY = 'fsc_t1_txns_v1';
function t1LoadTxns() { try { return JSON.parse(localStorage.getItem(T1_TXN_KEY) || '{}'); } catch (e) { return {}; } }
function t1SaveTxns(t) {
  try { localStorage.setItem(T1_TXN_KEY, JSON.stringify(t)); return true; }
  catch (e) {
    // 空间不够：全局掐掉最老的一半日期再试一次，再不行就放弃——余额不受影响。
    // 掐掉了什么必须说出来，静默清数据会让用户以为明细一直都在
    const all = [];
    Object.keys(t).forEach(id => Object.keys(t[id]).forEach(d => all.push([id, d])));
    all.sort((x, y) => (x[1] < y[1] ? -1 : 1));
    const cut = all.slice(0, Math.ceil(all.length / 2));
    cut.forEach(([id, d]) => { delete t[id][d]; });
    try {
      localStorage.setItem(T1_TXN_KEY, JSON.stringify(t));
      toast(`流水明细空间不足，已清掉最旧的 ${cut.length} 天（余额不受影响）`, 4600);
      return true;
    }
    catch (e2) { toast('流水明细存不下了，本批未保存（余额不受影响）', 4200); return false; }
  }
}
/** T2 转换完、或 T1 导入落盘时调这个存明细。recs: [{date,memo,dir,amt,opp,ref,bal}]，bal 是该笔发生后的账面余额（可为 null） */
function t1PutTxns(accId, fileName, recs) {
  if (!t1AccById(accId) || !recs || !recs.length) return 0;
  const all = t1LoadTxns();
  const mine = all[accId] = all[accId] || {};
  const byDate = {};
  recs.forEach(r => {
    if (!r.date || !(r.amt > 0)) return;
    (byDate[r.date] = byDate[r.date] || []).push({
      memo: r.memo || '', opp: r.opp || '', dir: r.dir === 'in' ? 'in' : 'out',
      amt: Number(r.amt) || 0, ref: r.ref || '',
      bal: (r.bal === null || r.bal === undefined || isNaN(r.bal)) ? null : Number(r.bal),
    });
  });
  const at = new Date().toLocaleString('zh-CN');
  Object.keys(byDate).forEach(d => {
    // total 记原始笔数：超 800 截断时页面要如实标出来，不能让截过的「当日合计」冒充全量
    mine[d] = { file: String(fileName || ''), at, total: byDate[d].length, rows: byDate[d].slice(0, 800) };
  });
  // 每个账户最多留 62 天（约两个月），从最老的掐——localStorage 就那么大
  const ds = Object.keys(mine).sort();
  while (ds.length > 62) { delete mine[ds.shift()]; }
  // 笔数在掐完旧桶之后再数：导超 62 天的对账单时，被掐掉的部分不能算「已留存」
  let n = 0;
  Object.keys(byDate).forEach(d => { if (mine[d]) n += mine[d].rows.length; });
  return t1SaveTxns(all) ? n : 0;
}
/** T2 换绑账户时，把写错账户的那几天撤掉（和 t1ClearBalance 同一个纪律）。
    传了 expectFile 就只删「确实是那份文件写进来的」桶——桶已被别的批次覆盖时不动，防误删 */
function t1DelTxns(accId, dates, expectFile) {
  if (!accId || !dates || !dates.length) return;
  const all = t1LoadTxns();
  if (!all[accId]) return;
  dates.forEach(d => {
    const b = all[accId][d];
    if (!b) return;
    if (expectFile !== undefined && b.file !== expectFile) return;
    delete all[accId][d];
  });
  if (!Object.keys(all[accId]).length) delete all[accId];
  t1SaveTxns(all);
}

/* ============ 台账导入 ============ */
/* 一个入口两件事：导账户台账；表里带余额列就顺手把余额也导了。
   只写 T1 自己的三份数据（账户台账 / 月固定支出 / 每日余额），不碰别的模块。 */

const T1_IMP_ALIAS = {
  ent:   ['主体', '公司', '单位', '企业', '所属'],
  name:  ['账户名', '账户', '平台', '户名', '开户行'],
  no:    ['账号', '卡号', '银行账号'],
  type:  ['类型', '性质', '类别'],
  fixed: ['月固定支出', '固定支出', '月支出', '月均支出'],
  bal:   ['余额', '当前余额', '账户余额'],
  date:  ['日期', '余额日期', '数据日期', '入账日期', '交易日期', '记账日期', '交易日', '交易时间', '业务日期'],
  // 以下是对账单的交易列，别名与 T2 的 FIELDS 保持同一份口径——认出来就把每一笔留存给下钻页
  memo:   ['摘要', '摘要说明', '用途', '附言', '交易摘要', '备注', '交易类型'],
  opp:    ['对方户名', '对方账户名称', '对方名称', '收款人名称', '付款人名称', '对方单位'],
  // 对方账号必须自己占一个字段：不占坑的话「账号」的包含匹配会把「对方账号」列错认成本方账号
  oppAcct: ['对方账号', '对方账户', '对方卡号'],
  inAmt:  ['转入金额', '收入', '贷方发生额', '贷方金额', '收入金额', '存入', '收款金额'],
  outAmt: ['转出金额', '支出', '借方发生额', '借方金额', '支出金额', '支取', '付款金额'],
  amt:    ['金额', '发生额', '交易金额'],
  dc:     ['借贷', '借贷标志', '收付标志', '资金流向'],
  ref:    ['流水号', '交易流水号', '凭证号', '业务编号', '交易序号'],
};
const T1_IMP_FIELDS = [
  ['ent', '主体', 1], ['name', '账户 / 平台', 1], ['no', '账号', 0],
  ['type', '类型', 0], ['fixed', '月固定支出', 0], ['bal', '余额', 0], ['date', '日期', 0],
  ['memo', '摘要', 0], ['opp', '对方户名', 0], ['oppAcct', '对方账号', 0],
  ['inAmt', '收入金额', 0], ['outAmt', '支出金额', 0],
  ['amt', '发生额（单列）', 0], ['dc', '借贷标志', 0], ['ref', '流水号', 0],
];

/* 新账户编号取现有最大序号 +1。不能用 length —— 删过账户会撞号 */
function t1NextSeq() {
  let max = 0;
  T1_ACC.forEach(a => { const m = /^[A-Z](\d+)$/.exec(a.id || ''); if (m) max = Math.max(max, +m[1]); });
  return max + 1;
}
const t1MkId = n => 'B' + String(n).padStart(3, '0');
const t1Norm = v => String(v == null ? '' : v).replace(/\s|　/g, '');
const t1ImpType = v => (/平台|电商|店|网店|plat/i.test(String(v)) ? 'plat' : 'bank');

function t1ImpAutoMap(header) {
  const cells = header.map(t1Norm);
  const map = {}, used = new Set();
  // 先精确后包含，避免「账户名」被「账户」抢走
  [1, 0].forEach(exact => {
    T1_IMP_FIELDS.forEach(([k]) => {
      if (map[k] !== undefined) return;
      for (let i = 0; i < cells.length; i++) {
        if (used.has(i) || !cells[i]) continue;
        const hit = T1_IMP_ALIAS[k].some(a => (exact ? cells[i] === a : cells[i].includes(a)));
        if (hit) { map[k] = i; used.add(i); break; }
      }
    });
  });
  return map;
}

/* 一次可以选多份文件：一份对账单 = 一个账户，几十个账户挨个导太慢。
   T1.imp = { files: [ {fileName, rows, headRow, map, fixEnt, fixName} ], cur, offStale } */
async function t1ImpLoad(fileList) {
  const files = [].slice.call(fileList || []);
  if (!files.length) return;
  toast(files.length > 1 ? `正在解析 ${files.length} 份文件…` : '正在解析…');
  const allAlias = Object.keys(T1_IMP_ALIAS).reduce((a, k) => a.concat(T1_IMP_ALIAS[k]), []);
  const curEnt = (typeof CUR_ENT !== 'undefined' && CUR_ENT) ? (ENTITIES.find(x => x.id === CUR_ENT) || {}).full || '' : '';
  const ok = [], bad = [];
  for (const file of files) {
    try {
      const rows = await XLSXLite.readTable(file);
      const headRow = XLSXLite.findHeaderRow(rows, allAlias);
      const g = t1GuessAcc(file.name);
      ok.push({
        fileName: file.name, rows, headRow, map: t1ImpAutoMap(rows[headRow] || []),
        fixEnt: g ? g.ent : curEnt, fixName: g ? g.name : '', guessed: g ? 1 : 0,
      });
    } catch (e) { bad.push(file.name + '：' + e.message); }
  }
  if (!ok.length) { toast('读取失败：' + bad.join('；'), 4600); return; }
  // 再选一次是追加，不是替换——分几次挑文件也能凑成一批
  if (T1.imp && T1.imp.files) T1.imp.files = T1.imp.files.concat(ok);
  else T1.imp = { files: ok, cur: 0, offStale: 0 };
  T1.imp.cur = Math.min(T1.imp.cur || 0, T1.imp.files.length - 1);
  go('t1-imp');
  const guessed = ok.filter(f => f.guessed).length;
  toast(`读到 ${ok.length} 份文件`
    + (guessed ? `，${guessed} 份按文件名认出了账户` : '')
    + (bad.length ? `；${bad.length} 份读不了：${bad[0]}` : ''), 4600);
}

/* 从文件名猜账户：对账单文件名常带账号后四位或账户名（「张华9999工行流水」）。
   猜错了页面上照样能改；猜对了几十份文件就不用一个个选主体、填账户名。 */
function t1GuessAcc(fileName) {
  const s = t1Norm(fileName);
  const digits = s.replace(/\D/g, '');
  let hit = T1_ACC.find(a => {
    const no = t1Norm(a.no).replace(/\D/g, '');
    return no.length >= 4 && digits.includes(no.slice(-4));
  });
  if (!hit) hit = T1_ACC.find(a => a.name && t1Norm(a.name).length >= 3 && s.includes(t1Norm(a.name)));
  return hit ? { ent: hit.ent, name: hit.name } : null;
}

const t1ImpCur = () => (T1.imp && T1.imp.files ? T1.imp.files[T1.imp.cur] || null : null);
const t1ImpReady = f => !!(f && f.fixEnt && (f.fixName || '').trim());

/* 账户匹配：账号是唯一的，优先按账号认；没账号才退回「主体+账户名」。
   认上了就复用原 id —— 历史余额按 id 存，换了 id 等于把历史全丢了。 */
function t1FindAcc(ent, name, no) {
  if (no) { const byNo = T1_ACC.find(a => a.no && t1Norm(a.no) === t1Norm(no)); if (byNo) return byNo; }
  return T1_ACC.find(a => t1Norm(a.ent) === t1Norm(ent) && t1Norm(a.name) === t1Norm(name)) || null;
}

/* 先算清楚要改什么再落盘。预览和真正导入共用这一份，避免两边算法走样。
   传哪份文件算哪份；不传就算当前正在设置的那份。 */
function t1ImpPlan(f) {
  const im = f || t1ImpCur();
  const out = { add: [], upd: [], same: [], bad: [], dup: 0, fixed: {}, bals: [], keys: new Set(), txns: [], txnSkip: 0 };
  if (!im || !im.fixEnt || !(im.fixName || '').trim()) return out;
  const seen = new Set();
  im.rows.slice(im.headRow + 1).forEach((r, i) => {
    const cell = k => (im.map[k] === undefined ? '' : String(r[im.map[k]] == null ? '' : r[im.map[k]]).trim());
    const ent = im.fixEnt, name = im.fixName.trim(), no = cell('no');   // 主体/账户名页面直选，整个文件归同一账户
    const blank = !r.some(c => String(c == null ? '' : c).trim());
    if (!ent || !name) {
      if (!blank) out.bad.push({ no: im.headRow + i + 2, ent, name, why: !ent ? '缺主体' : '缺账户名' });
      return;
    }
    const key = t1Norm(ent) + '' + t1Norm(name);
    // 余额先收再做账户去重——银行对账单每天一行余额，账户只建一次、余额要逐日收；
    // 同一天多行时取文件中靠后的那行（记完排在后面的余额更接近日终）
    if (im.map.bal !== undefined) {
      const v0 = Number(cell('bal').replace(/[,，¥￥]/g, ''));
      if (cell('bal') !== '' && !isNaN(v0)) {
        const d0 = im.map.date !== undefined && cell('date') ? normDate(cell('date')) : T1.date;
        // normDate 认不出的串会原样返回（如「合计」）——垃圾键写进每日余额会搅乱日期序，
        // 认不出就不收这行的余额（合计行的余额本来也不是某一天的日终数）
        if (/^\d{4}-\d{2}-\d{2}$/.test(d0)) {
          out._balMap = out._balMap || {};
          out._balMap[key + '|' + d0] = { key, ent, name, no, date: d0, val: v0 };
        }
      }
    }
    // 流水明细也逐行收，且在账户去重之前——账户一个文件只建一次，交易却是每行一笔。
    // 认出「日期 + 任一金额列」就是带明细的对账单，每一笔留存给 T1 下钻页（余额是结论，流水是物证）。
    // 注意：列别名和方向判据抄的是 T2 那份，但 T2 的高级认列（同名双列推断等）这里没有——
    // 认不出时预览会诚实显示 0 笔并提示，复杂格式走 T2 转换兜底
    if (!blank && im.map.date !== undefined
      && (im.map.inAmt !== undefined || im.map.outAmt !== undefined || im.map.amt !== undefined)) {
      // normDate 认不出的串会原样返回（如「合计」），必须再验一道是不是真日期，
      // 否则合计行会被当成一笔交易收进来
      const d1raw = cell('date') ? normDate(cell('date')) : '';
      const d1 = /^\d{4}-\d{2}-\d{2}$/.test(d1raw) ? d1raw : '';
      let inA = numOf(cell('inAmt')), outA = numOf(cell('outAmt'));
      if (im.map.inAmt === undefined && im.map.outAmt === undefined) {
        const a1 = numOf(cell('amt'));
        const isOut = /借|支|付|出|-/.test(cell('dc')) || a1 < 0;   // 和 T2 runRules 同一判据
        if (isOut) outA = Math.abs(a1); else inA = Math.abs(a1);
      }
      const amt1 = inA > 0 ? inA : outA;
      if (d1 && amt1 > 0) {
        // 余额不能用 numOf（它把空串归 0）：余额恰好 0 是合法值，空/横杠才算没有
        const bs = cell('bal').replace(/[,，\s¥￥]/g, '');
        out.txns.push({ key, date: d1, memo: cell('memo'), opp: cell('opp'),
          dir: inA > 0 ? 'in' : 'out', amt: amt1, ref: cell('ref'),
          bal: (bs === '' || bs === '-' || bs === '—' || isNaN(Number(bs))) ? null : Number(bs) });
      } else out.txnSkip++;   // 合计行、说明行：没日期或金额为 0，进不了留存
    }
    if (seen.has(key)) { out.dup++; return; }
    seen.add(key); out.keys.add(key);

    const type = im.map.type === undefined ? null : t1ImpType(cell('type'));
    if (im.map.fixed !== undefined) {
      const f2 = Number(cell('fixed').replace(/[,，¥￥]/g, ''));
      if (!isNaN(f2) && f2 > 0 && out.fixed[ent] === undefined) out.fixed[ent] = f2;
    }
    const hit = t1FindAcc(ent, name, no);
    if (!hit) out.add.push({ ent, name, no, type: type || 'bank' });
    else {
      const chg = [];
      if (no && t1Norm(hit.no) !== t1Norm(no)) chg.push('账号');
      if (type && hit.type !== type) chg.push('类型');
      if (!hit.on) chg.push('重新启用');
      if (t1Norm(hit.name) !== t1Norm(name)) chg.push('账户名');
      if (chg.length) out.upd.push({ id: hit.id, ent, name, no, type, chg });
      else out.same.push({ ent, name });
    }
  });
  out.bals = Object.values(out._balMap || {});
  delete out._balMap;
  return out;
}

/* 整批合计：给页面上的 KPI 与「全部导入」按钮用 */
function t1ImpTotals() {
  const files = (T1.imp && T1.imp.files) || [];
  const t = { add: 0, upd: 0, same: 0, bals: 0, bad: 0, ready: 0, notReady: 0, txns: 0, txnSkip: 0 };
  files.forEach(f => {
    if (!t1ImpReady(f)) { t.notReady++; return; }
    t.ready++;
    const p = t1ImpPlan(f);
    t.add += p.add.length; t.upd += p.upd.length; t.same += p.same.length;
    t.bals += p.bals.length; t.bad += p.bad.length;
    t.txns += p.txns.length; t.txnSkip += p.txnSkip;
  });
  return t;
}

/* 落盘：就绪的文件一份份写，最后统一处理「表里没有的账户停用」。
   停用要按整批的账户并集判断——按单份文件判会把其它文件里的账户误停。 */
function t1ImpApply() {
  const im = T1.imp;
  const files = (im.files || []).filter(t1ImpReady);
  let seq = t1NextSeq();
  let nAdd = 0, nUpd = 0, nb = 0, nt = 0, off = 0, nf = 0;
  const allKeys = new Set();

  files.forEach(f => {
    const plan = t1ImpPlan(f);
    const idOf = {};
    plan.add.forEach(a => {
      const id = t1MkId(seq++);
      T1_ACC.push({ id, ent: a.ent, name: a.name, type: a.type, no: a.no || '', on: 1 });
      idOf[t1Norm(a.ent) + '' + t1Norm(a.name)] = id;
      nAdd++;
    });
    plan.upd.forEach(u => {
      const a = T1_ACC.find(x => x.id === u.id);
      if (!a) return;
      if (u.no) a.no = u.no;
      if (u.type) a.type = u.type;
      a.name = u.name; a.on = 1;
      idOf[t1Norm(u.ent) + '' + t1Norm(u.name)] = a.id;
      nUpd++;
    });
    plan.same.forEach(s => {
      const a = t1FindAcc(s.ent, s.name, '');
      if (a) idOf[t1Norm(s.ent) + '' + t1Norm(s.name)] = a.id;
    });
    Object.keys(plan.fixed).forEach(e => { T1_CFG.fixed[e] = plan.fixed[e]; });
    plan.keys.forEach(k => allKeys.add(k));

    // 余额：导入的表是用户自己给的口径，直接写；来源标 T1导入，跟 T2 流水分得开
    plan.bals.forEach(b => {
      const id = idOf[b.key]; if (!id) return;
      if (t1PutBalance(id, b.date, b.val, 'T1导入', 1).ok) nb++;
    });
    // 流水明细：和 T2 转换共用同一份留存（t1PutTxns 同日整天替换），重导同一份文件不会翻倍
    const txnByAcc = {};
    plan.txns.forEach(x => { const id = idOf[x.key]; if (id) (txnByAcc[id] = txnByAcc[id] || []).push(x); });
    Object.keys(txnByAcc).forEach(id => { nt += t1PutTxns(id, f.fileName, txnByAcc[id]); });
    nf++;
  });

  // 表里没有的在管账户 → 停用而不是删除，历史余额一律保留
  if (im.offStale) {
    T1_ACC.forEach(a => {
      if (a.on && !allKeys.has(t1Norm(a.ent) + '' + t1Norm(a.name))) { a.on = 0; off++; }
    });
  }
  t1SaveAcc(T1_ACC); t1SaveCfg(T1_CFG);

  T1.imp = null;
  toast(`${nf} 份文件导入完成：新增 ${nAdd} 户、更新 ${nUpd} 户`
    + (nb ? `、余额 ${nb} 条` : '') + (nt ? `、流水明细 ${nt} 笔` : '') + (off ? `、停用 ${off} 户` : ''), 4600);
  go('t1-acc');
}

function t1ImpTemplate() {
  download('账户台账导入模板.csv', toCSV([
    ['主体', '账户/平台', '账号', '类型', '月固定支出', '余额', '余额日期'],
    ['优栖', '建行基本户', '6215****1234', '银行', '520000', '130547.25', T1.date],
    ['优栖', '抖店账户', '', '平台', '', '', ''],
    ['澳乐', '工行基本户', '6222****5678', '银行', '1860000', '', ''],
  ]));
  toast('模板已下载');
}

/* ============ 界面 ============ */
S['t1'] = () => {
  const ents = t1ByEnt(T1.date);
  const tot = ents.reduce((s, e) => s + e.bal, 0);
  const prevD = t1Prev(T1.date);
  const totPrev = ents.reduce((s, e) => s + e.prev, 0);
  const delta = prevD ? tot - totPrev : null;
  const red = ents.filter(e => e.red);
  const staleN = ents.reduce((s, e) => s + e.stale, 0);
  const missN = ents.reduce((s, e) => s + e.miss, 0);
  const onN = T1_ACC.filter(a => a.on).length;

  const fmtRate = r => r === null ? '<span class="mut">—</span>'
    : `<span class="${r >= 0 ? 'grn' : 'red'}">${r >= 0 ? '+' : ''}${r.toFixed(2)}%</span>`;
  const fmtWarn = (r, warn) => r === null ? '<span class="mut" title="上一日合计不为正数或没有更早记录，算不出变动率">—</span>'
    : (warn ? pill('预警', 'cr') : pill('正常', 'ok'));
  const rows = ents.map(e => [
    `<b>${H(e.ent)}</b>`,
    `<span class="mono">${e.n}</span>${e.miss ? `<span class="red"> +${e.miss} 缺</span>` : ''}`,
    `<span class="lnk" data-t1ent="${H(e.ent)}" title="点击查看该主体的账户与流水明细">${money(e.bal)}</span>`,
    e.delta === null ? '<span class="mut">—</span>'
      : `<span class="${e.delta >= 0 ? 'grn' : 'red'}">${e.delta >= 0 ? '+' : ''}${money(e.delta)}</span>`,
    fmtRate(e.rate),
    fmtWarn(e.rate, e.rateWarn),
    e.stale ? pill(`${e.stale} 户沿用昨日`, 'wa') : (e.miss ? pill(`${e.miss} 户无数`, 'cr') : pill('今日已更新', 'ok')),
  ]);
  const rateRed = ents.filter(e => e.rateWarn);
  const totRate = (prevD && totPrev > 0.005) ? (tot - totPrev) / totPrev * 100 : null;
  const totWarn = totRate !== null && Math.abs(totRate) >= (T1_CFG.rateTh || 10);

  return head('T1　资金日报生成器',
    '账户台账预置，每天只填<b>变动的</b>。汇总、覆盖倍数、红线、日报文本自动出。<b>登网银抄余额这步省不掉</b>——工具省的是抄完之后的活。',
    '工具箱 · 已上线',
    `<input type="date" id="t1date" value="${T1.date}">
     <button class="btn" data-t1go="acc">账户台账</button>
     <button class="btn" data-t1go="imp">导入</button>
     <button class="btn" data-t1go="entry">录入余额</button>
     <button class="btn pri" data-t1act="gen">生成日报</button>`)
    + kpis([
      { k: '账户总余额', v: money(tot), u: '元' },
      { k: '较上一日', v: delta === null ? '—' : (delta >= 0 ? '+' : '') + money(delta), u: delta === null ? '' : '元', t: delta === null ? '' : (delta >= 0 ? 'g' : 'c') },
      { k: '在管账户', v: String(onN), u: '个' },
      { k: '今日已更新', v: String(onN - staleN - missN), u: '个', t: 'g' },
      { k: '沿用昨日', v: String(staleN), u: '个', t: staleN ? 'w' : 'g' },
      { k: '变动率预警', v: String(rateRed.length), u: '户', t: rateRed.length ? 'c' : 'g' },
      { k: '红线预警', v: String(red.length), u: '户', t: red.length ? 'c' : 'g' },
    ])
    + (missN ? `<div class="note c"><b>${missN} 个账户从未录过余额</b>，没有计入合计。这些账户所属主体<b>不计算覆盖倍数、也不报红线</b>——余额不全时算出来的倍数偏低，会把「没抄数」误报成「快没钱了」。</div>` : '')
    + (staleN ? `<div class="note w"><b>${staleN} 个账户今天没更新，用的是上一次的余额。</b>日报里会单独列出来——沿用昨日的数和今天实抄的数不是一回事，收款人看到才好判断。</div>` : '')
    + (rateRed.length ? `<div class="note c"><b>变动率预警 ${rateRed.length} 户：</b>${rateRed.map(e => `${H(e.ent)}（${e.rate >= 0 ? '+' : ''}${e.rate.toFixed(2)}%）`).join('、')}。较上日变动超过 ±${T1_CFG.rateTh}%，点余额可下钻到账户与流水明细核对。</div>` : '')
    + (red.length ? `<div class="note c"><b>红线预警 ${red.length} 户：</b>${red.map(e => `${H(e.ent)}（覆盖倍数 ${e.cover.toFixed(2)}）`).join('、')}。低于阈值 ${T1_CFG.ratio} 倍，已在日报中标出。</div>` : '')
    + card('分主体资金分布（点余额看账户与流水明细）', table(
      [{ t: '主体' }, { t: '账户数' }, { t: '余额（元）', n: 1 }, { t: '较上日（元）', n: 1 },
       { t: '较上日变动率', n: 1 }, { t: '预警' }, { t: '更新状态' }], rows,
      ['<b>合计</b>', `<b>${onN - missN}</b>`, `<b>${money(tot)}</b>`,
       delta === null ? '—' : `<b>${delta >= 0 ? '+' : ''}${money(delta)}</b>`,
       totRate === null ? '—' : `<b class="${totRate >= 0 ? 'grn' : 'red'}">${totRate >= 0 ? '+' : ''}${totRate.toFixed(2)}%</b>`,
       totRate === null ? '' : (totWarn ? pill('预警', 'cr') : pill('正常', 'ok')), '']))
    + cardp('预警与红线规则', `<div class="cols c2">
        <div class="field"><label class="fl">变动率预警阈值（较上日 ±%）</label>
          <input type="number" step="1" min="1" id="t1rateTh" value="${T1_CFG.rateTh}"></div>
        <div class="note" style="margin:0"><b>默认 ±10%</b>——主体余额较上一日变动幅度超过它，分布表「预警」列标红；上一日合计为 0 时算不出变动率，不报警。</div>
        <div class="field"><label class="fl">覆盖倍数阈值（余额 ÷ 月固定支出）</label>
          <input type="number" step="0.1" id="t1ratio" value="${T1_CFG.ratio}"></div>
        <div class="note" style="margin:0"><b>建议值 1.5 倍</b>——单主体活期余额低于当月固定支出的 1.5 倍时预警。这是方案第十二章待老板拍板的第 4 项，改了这里等于改了口径。月固定支出在「账户台账」里维护。</div>
      </div>`);
};

/* 一个账户留存的流水按天渲染成卡片（新的在前）。t1-ent 内联和 t1-txn 全量共用这一份，
   两个页面的口径不会走样。limitRows 只在内联场景用：行数凑够就停在整天边界，
   截了多少由返回值报给调用方，调用方必须如实标出来——不许静默少显示。 */
function t1TxnBlocks(accId, opt) {
  const o = opt || {};
  const mine = (o.store || t1LoadTxns())[accId] || {};
  const dates = Object.keys(mine).sort().reverse();
  const out = { html: '', days: 0, rows: 0, totalDays: dates.length, totalRows: 0 };
  dates.forEach(d => { out.totalRows += mine[d].rows.length; });
  const parts = [];
  for (const d of dates) {
    if (o.limitRows && out.rows >= o.limitRows) break;
    const b = mine[d];
    let inS = 0, outS = 0;
    const rows = b.rows.map(r => {
      if (r.dir === 'in') inS += r.amt; else outS += r.amt;
      return [
        H(r.memo || '—'),
        r.opp ? H(r.opp) : '<span class="mut">—</span>',
        r.dir === 'in' ? `<span class="grn">+${money(r.amt)}</span>` : '<span class="mut">—</span>',
        r.dir === 'out' ? `<span class="red">−${money(r.amt)}</span>` : '<span class="mut">—</span>',
        (r.bal === null || r.bal === undefined) ? '<span class="mut">—</span>' : money(r.bal),
        r.ref ? `<span class="code">${H(r.ref)}</span>` : '<span class="mut">—</span>',
      ];
    });
    const cut = b.total && b.total > b.rows.length;
    parts.push(card(`${o.prefix || ''}${d} · ${b.rows.length} 笔${cut ? `（原 ${b.total} 笔，超上限已截断，当日合计只含留存部分）` : ''} · 来自「${b.file || '导入'}」`, table(
      [{ t: '摘要' }, { t: '对方户名' }, { t: '收入（元）', n: 1 }, { t: '支出（元）', n: 1 },
       { t: '当时余额（元）', n: 1 }, { t: '流水号' }], rows,
      ['<b>当日合计</b>', '',
       `<b class="grn">+${money(inS)}</b>`, `<b class="red">−${money(outS)}</b>`,
       `<b>净 ${inS - outS >= 0 ? '+' : ''}${money(inS - outS)}</b>`, ''])));
    out.days++; out.rows += b.rows.length;
  }
  out.html = parts.join('');
  return out;
}

/* 主体明细（下钻第一层）：这个主体的余额由哪些账户组成、每个数取自哪天、谁写进来的；
   导入留存的每一笔流水直接列在页面下方——物证不藏在链接后面 */
S['t1-ent'] = () => {
  const ent = T1.drillEnt;
  const e = ent ? t1ByEnt(T1.date).find(x => x.ent === ent) : null;
  if (!e) return S['t1']();   // 没有下钻目标（比如直接刷新进来）就回日报
  const prevD = t1Prev(T1.date);
  const prevEff = prevD ? t1Effective(prevD) : null;
  const txns = t1LoadTxns();
  const srcLabel = s => s === 'T2' ? '来自 T2 流水' : s === 'T1导入' ? '来自台账导入' : '来自 ' + s;

  const rows = e.accs.map(a => {
    const pv = prevEff && prevEff[a.id] && prevEff[a.id].v !== null ? prevEff[a.id].v : null;
    const d = (a.v !== null && pv !== null) ? a.v - pv : null;
    const src = a.from ? t1BalFrom(a.from, a.id) : '';
    const mine = txns[a.id] || {};
    const days = Object.keys(mine).length;
    const cnt = Object.values(mine).reduce((s, b) => s + b.rows.length, 0);
    return [
      `${a.type === 'plat' ? '▣' : '▤'} ${H(a.name)}`
        + (a.no ? `<div class="mut" style="font-size:11px">${H(a.no)}</div>` : ''),
      a.v === null ? '<span class="red">从未录入</span>' : money(a.v),
      d === null ? '<span class="mut">—</span>'
        : `<span class="${d >= 0 ? 'grn' : 'red'}">${d >= 0 ? '+' : ''}${money(d)}</span>`,
      a.v === null ? '<span class="mut">—</span>'
        : a.stale ? `<span class="mut">${H(a.from)}</span> ${pill('沿用', 'wa')}` : pill('今日', 'ok'),
      src ? pill(srcLabel(src), 'ok') : (a.v === null ? '<span class="mut">—</span>' : '<span class="mut">手工录入</span>'),
      cnt ? `<span class="lnk" data-t1txn="${a.id}">流水 ${cnt} 笔 / ${days} 天</span>` : '<span class="mut">无流水明细</span>',
    ];
  });

  // 论证：这条变动率是怎么算出来的、为什么报/不报警——结论要能自证
  const exp = e.rate === null
    ? `<div class="note"><b>较上日变动率算不出来：</b>${prevD ? `上一日（${H(prevD)}）该主体合计不是正数，分母不成立` : '没有更早的余额记录'}，所以不报预警。</div>`
    : `<div class="note ${e.rateWarn ? 'c' : 'g'}"><b>较上日变动率 ${e.rate >= 0 ? '+' : ''}${e.rate.toFixed(2)}% → ${e.rateWarn ? '预警' : '正常'}。</b>
       算法：（今日合计 ${money(e.bal)} − 上一日 ${H(prevD)} 合计 ${money(e.prev)}）÷ ${money(e.prev)}；预警阈值 ±${T1_CFG.rateTh}%。</div>`;

  // 物证内联：导入过的每一笔直接列在下面。每户先内联约 300 笔防大户卡死——
  // 软上限，凑够就停在整天边界（一天绝不拆半），如实标出还剩多少，一键去该账户的全量页。
  const INLINE_MAX = 300;
  const txnAccs = e.accs.filter(a => txns[a.id] && Object.keys(txns[a.id]).length);
  let totDays = 0, totRows = 0;
  const detail = txnAccs.map(a => {
    const tb = t1TxnBlocks(a.id, { store: txns, limitRows: INLINE_MAX,
      prefix: txnAccs.length > 1 ? a.name + ' · ' : '' });
    totDays += tb.totalDays; totRows += tb.totalRows;
    return tb.html + (tb.rows < tb.totalRows
      ? `<div class="note w"><b>${H(a.name)} 还有 ${tb.totalDays - tb.days} 天 ${tb.totalRows - tb.rows} 笔没在本页展开</b>（每户先内联约 ${INLINE_MAX} 笔、停在整天边界，防止页面过长）。
         <span class="lnk" data-t1txn="${a.id}">查看该账户全部 ${tb.totalDays} 天 ${tb.totalRows} 笔 →</span></div>`
      : '');
  }).join('');
  const detailIntro = txnAccs.length
    ? `<div class="note g"><b>流水明细 · 每一笔都列在下面：</b>共 ${totDays} 天 ${totRows} 笔，来自 T2 转换 / T1 对账单导入时的自动留存，按交易日分块、新的在前。同一天重复导入整天替换，不会重复累计；每户最多留最近 62 天。</div>` + detail
    : `<div class="note"><b>该主体还没有留存的流水明细。</b>上面的余额来自手工录入或只带余额的导入——用 <b>T2 银行流水转凭证</b>转一次网银流水，或在 <b>T1 导入</b>里重导一次带交易列（收入/支出）的对账单，每一笔都会自动留存并直接列在这里。</div>`;

  return head(`${ent} · 资金明细`, `${T1.date} 各账户余额与来源。<b>导入过的流水每一笔都直接列在下方</b>；没有流水的账户，余额是手工录或台账导的。`, '工具箱 · T1',
    `<input type="date" id="t1date" value="${T1.date}">
     <button class="btn" data-t1go="daily">← 返回日报</button>
     <button class="btn" data-t1go="entry">录入余额</button>`)
    + kpis([
      { k: '余额合计', v: money(e.bal), u: '元' },
      { k: '较上一日', v: e.delta === null ? '—' : (e.delta >= 0 ? '+' : '') + money(e.delta), u: e.delta === null ? '' : '元', t: e.delta === null ? '' : (e.delta >= 0 ? 'g' : 'c') },
      { k: '较上日变动率', v: e.rate === null ? '—' : (e.rate >= 0 ? '+' : '') + e.rate.toFixed(2) + '%', t: e.rate === null ? '' : (e.rateWarn ? 'c' : 'g') },
      { k: '账户', v: `${e.n}<small> / ${e.n + e.miss}</small>`, d: e.miss ? `${e.miss} 户从未录入` : '全部有数' },
      { k: '留存流水', v: String(totRows), u: '笔', d: totRows ? `${totDays} 天 · 全部列在下方` : '导过带明细的流水才有', t: totRows ? 'g' : '' },
    ])
    + exp
    + (e.miss ? `<div class="note w"><b>${e.miss} 个账户从未录入余额</b>，上面的合计与变动率只含已录入的 ${e.n} 户。</div>` : '')
    + card('账户构成', table(
      [{ t: '账户 / 平台' }, { t: '余额（元）', n: 1 }, { t: '较上日（元）', n: 1 },
       { t: '数据取自' }, { t: '余额来源' }, { t: '流水明细' }], rows,
      ['<b>合计</b>', `<b>${money(e.bal)}</b>`,
       e.delta === null ? '—' : `<b>${e.delta >= 0 ? '+' : ''}${money(e.delta)}</b>`, '', '', '']))
    + detailIntro;
};

/* 流水明细（下钻第二层）：一个账户的全量留存，不设内联上限。
   渲染逻辑在 t1TxnBlocks，和 t1-ent 内联共用一份。 */
S['t1-txn'] = () => {
  const a = t1AccById(T1.drillAcc);
  if (!a) return S['t1']();
  const back = `<button class="btn" data-t1go="ent">← 返回 ${H(a.ent)} 明细</button>
     <button class="btn" data-t1go="daily">返回日报</button>`;
  const tb = t1TxnBlocks(a.id);

  if (!tb.totalDays) {
    return head(`${a.ent} · ${a.name} · 流水明细`, '这个账户还没有留存的流水。', '工具箱 · T1', back)
      + `<div class="soonbox"><div class="si">▷</div><h3>暂无流水明细</h3>
         <p>它的余额来自手工录入或只带余额的导入。用 <b>T2 银行流水转凭证</b>转一次这个账户的网银流水，或在 <b>T1 导入</b>里重导一次带交易列（收入/支出）的对账单，每一笔都会留存在这里。</p></div>`;
  }

  return head(`${a.ent} · ${a.name} · 流水明细`,
    `T2 转换 / T1 对账单导入时自动留存，共 <b>${tb.totalDays}</b> 天 <b>${tb.totalRows}</b> 笔，全部列在下面。同一天重复导入会整天替换，不会重复累计；最多留最近 62 天。`,
    '工具箱 · T1', back)
    + tb.html;
};

/* 录入 */
S['t1-entry'] = () => {
  const day = t1LoadDay(), today = day[T1.date] || {};
  const eff = t1Effective(T1.date);
  const ents = [...new Set(T1_ACC.filter(a => a.on).map(a => a.ent))];
  const list = T1.filterEnt ? ents.filter(e => e === T1.filterEnt) : ents;
  const blocks = list.map(ent => {
    const accs = T1_ACC.filter(a => a.on && a.ent === ent);
    const rows = accs.map(a => {
      const e = eff[a.id];
      const cur = today[a.id];
      const src = t1BalFrom(T1.date, a.id);
      const hint = e.v === null ? '<span class="red">从未录入</span>'
        : (cur !== undefined
          ? (src ? pill('来自 ' + src + ' 流水', 'ok') : pill('今日已填', 'ok'))
          : `<span class="mut">上次 ${H(e.from)}${t1BalFrom(e.from, a.id) ? '（' + H(t1BalFrom(e.from, a.id)) + '）' : ''}：${money(e.v)}</span>`);
      return [
        `${a.type === 'plat' ? '▣' : '▤'} ${H(a.name)}`
        + (a.no ? `<div class="mut" style="font-size:11px">${H(a.no)}</div>` : ''),
        `<input type="number" step="0.01" class="t1in" data-t1cell="${a.id}" value="${cur !== undefined ? cur : ''}" placeholder="${e.v !== null ? money(e.v) : '—'}">`,
        hint,
      ];
    });
    return card(`${ent}（${accs.length} 户）`, table(
      [{ t: '账户 / 平台' }, { t: '今日余额', n: 1 }, { t: '状态' }], rows));
  }).join('');

  return head('录入余额', `只填<b>今天变动过的</b>账户。留空 = 沿用上一次的余额，日报里会标出来。`, '工具箱 · T1',
    `<input type="date" id="t1date" value="${T1.date}">
     <select id="t1entFilter"><option value="">全部主体</option>${ents.map(e => `<option ${T1.filterEnt === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
     <button class="btn" data-t1go="daily">← 返回</button>
     <button class="btn pri" data-t1act="save">保存</button>`)
    + `<div class="note"><b>为什么设计成「只填变动的」：</b>一般户、平台账户很多天不动，每天全填 47 个是浪费。留空自动沿用，但<b>沿用的会在日报里单独标注</b>——避免收报表的人把陈数当新数。</div>`
    + blocks;
};

/* 账户台账 */
S['t1-acc'] = () => {
  const rows = T1_ACC.map(a => [
    `<span class="code">${a.id}</span>`,
    `<input class="t1in wide" data-t1acc="${a.id}:ent" value="${H(a.ent)}">`,
    `<input class="t1in wide" data-t1acc="${a.id}:name" value="${H(a.name)}">`,
    `<input class="t1in wide" data-t1acc="${a.id}:no" value="${H(a.no || '')}" placeholder="选填">`,
    `<select data-t1acc="${a.id}:type"><option value="bank" ${a.type === 'bank' ? 'selected' : ''}>银行</option><option value="plat" ${a.type === 'plat' ? 'selected' : ''}>平台</option></select>`,
    `<label style="font-size:11px;white-space:nowrap"><input type="checkbox" data-t1on="${a.id}" ${a.on ? 'checked' : ''}> 在管</label>`,
    `<button class="btn sm" data-t1del="${a.id}">删除</button>`,
  ]);
  const ents = [...new Set(T1_ACC.map(a => a.ent))];
  const fixRows = ents.map(e => [
    H(e),
    `<input type="number" step="1000" class="t1in wide" data-t1fix="${H(e)}" value="${T1_CFG.fixed[e] || 0}">`,
  ]);
  return head('账户台账', `在管 <b>${T1_ACC.filter(a => a.on).length}</b> / 共 ${T1_ACC.length} 个。改完点保存。`, '工具箱 · T1',
    `<button class="btn" data-t1go="daily">← 返回</button>
     <button class="btn" data-t1go="imp">导入台账</button>
     <button class="btn" data-t1act="addAcc">+ 新增账户</button>
     <button class="btn pri" data-t1act="saveAcc">保存台账</button>`)
    + `<div class="note"><b>${T1_PRESET.length} 个账户来自《银行资料信息/银行.xlsx》</b>，${new Set(T1_PRESET.map(x => x[0])).size} 个法人主体。
        账号已填好，T2 上传流水能按账号自动认账户。<b>停用的账户不进日报</b>，但历史数据保留。</div>`
    + `<div class="note w"><b>月固定支出全部未设。</b>银行资料表里没有这项，我没编——
        下面填了才会算覆盖倍数和报红线。没填的主体，日报里覆盖倍数显示「未设」。</div>`
    + `<div class="note"><b>账号填了才能在 T2 里选到这个账户。</b>T2 导流水时从这张台账选账户——账户主数据只有这一份，两边永远对得上。填了账号的账户，凭证里的银行存款科目也靠它自动对上。</div>`
    + card('账户', table(
      [{ t: '编号' }, { t: '主体' }, { t: '账户 / 平台' }, { t: '账号' }, { t: '类型' }, { t: '状态' }, { t: '' }], rows))
    + card('各主体月固定支出（算覆盖倍数用）', table(
      [{ t: '主体' }, { t: '月固定支出（元）', n: 1 }], fixRows));
};

/* 导入台账 */
S['t1-imp'] = () => {
  const im = T1.imp;
  const tools = `<button class="btn" data-t1go="acc">← 返回台账</button>
     <button class="btn" data-t1act="impTpl">下载模板</button>`;
  const picker = `<input type="file" id="t1file" accept=".xlsx,.csv,.txt" multiple>`;

  if (!im || !im.files.length) {
    return head('导入账户台账', '一张表把账户建好。<b>带余额列就顺手导余额；带交易列（收入/支出）就把每一笔流水也留存</b>，在 T1 下钻页逐笔可见。', '工具箱 · T1', tools)
      + cardp('选择文件', picker
        + `<div class="note" style="margin-top:11px"><b>可以一次选多份</b>（按住 ⌘ 或 Shift 多选，也能分几次挑、后选的往上加）。
          一份文件 = 一个账户：每份单独选主体、填账户名，文件名里带账号后四位或账户名的会自动认出来。</div>
        <div class="note"><b>表里至少要有「主体」和「账户/平台」两列</b>，其余都是选填：
          账号（填了 T2 才能按账号认账户）、类型（银行/平台）、月固定支出、余额、余额日期。
          列名不用跟模板一字不差，认得出就行；认错了下一步能手动改。</div>
        <div class="note"><b>已有账户不会被重建。</b>按账号认，没账号就按「主体+账户名」认——认上了复用原编号，
          历史余额是按编号存的，换编号等于把历史丢了。</div>`);
  }

  const cur = t1ImpCur();
  const tot = t1ImpTotals();

  /* 文件清单：每份文件一行，主体与账户名就地设，状态实时算 */
  const fileRows = im.files.map((f, i) => {
    const on = i === im.cur;
    const p = t1ImpReady(f) ? t1ImpPlan(f) : null;
    const st = !p
      ? `<span class="red">${!f.fixEnt ? '要选主体' : '要填账户名'}</span>`
      : `${p.add.length ? pill('新建户', 'ok') : (p.upd.length ? pill('更新户', 'wa') : pill('已有户', 'mu'))}
         ${p.bals.length ? `余额 <b>${p.bals.length}</b> 天` : '<span class="mut">无余额列</span>'}${
         p.txns.length ? ` · 流水 <b>${p.txns.length}</b> 笔` : ''}`;
    return [
      `${on ? '<b>▶ </b>' : ''}${H(f.fileName.slice(0, 26))}${f.guessed ? ' <span class="mut">·自动认出</span>' : ''}`,
      String(f.rows.length),
      `<select data-t1fix="ent" data-t1i="${i}"><option value="">— 选主体 —</option>${ENTITIES.map(e =>
        `<option value="${H(e.full)}" ${f.fixEnt === e.full ? 'selected' : ''}>${H(entShort(e))}</option>`).join('')}</select>`,
      `<input data-t1fix="name" data-t1i="${i}" value="${H(f.fixName || '')}" placeholder="如 工行基本户" style="min-width:150px">`,
      st,
      `<button class="btn sm" data-t1pick="${i}">${on ? '正在设置' : '调列'}</button>
       <button class="btn sm" data-t1rm="${i}">移除</button>`,
    ];
  });

  /* 当前文件的列对应 */
  const header = cur.rows[cur.headRow] || [];
  const preview = cur.rows.slice(cur.headRow + 1, cur.headRow + 4);
  const sampleOf = j => {
    const v = preview.map(r => r && r[j]).find(x => String(x == null ? '' : x).trim() !== '');
    return v === undefined ? '' : ' ＝ ' + String(v).slice(0, 10);
  };
  const opts = k => header.map((h, j) =>
    `<option value="${j}" ${cur.map[k] === j ? 'selected' : ''}>第${j + 1}列 ${H(String(h || '(空)').slice(0, 14))}${H(sampleOf(j))}</option>`).join('');
  // 主体与账户名不从文件列里找——银行对账单里根本没有这两列（负责人拍板改自选）。
  // 它们在上面的文件清单里逐份设，整份文件的行都归到那一个账户上。
  const mapRows = T1_IMP_FIELDS.filter(([k]) => k !== 'ent' && k !== 'name').map(([k, n, must]) => [
    H(n) + (must ? ' <span class="red">*</span>' : ''),
    `<select data-t1map="${k}"><option value="">— 不使用 —</option>${opts(k)}</select>`,
    cur.map[k] !== undefined ? `<span class="mut">${H(String(preview[0] && preview[0][cur.map[k]] || '').slice(0, 22))}</span>` : '<span class="mut">—</span>',
  ]);
  const headOpts = cur.rows.slice(0, Math.min(cur.rows.length, 12)).map((r, i) =>
    `<option value="${i}" ${i === cur.headRow ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 46))}</option>`).join('');

  const p = t1ImpPlan(cur);
  const cut = (arr, n) => arr.slice(0, n).map(x => `${H(x.ent)} · ${H(x.name)}`).join('、')
    + (arr.length > n ? ` … 等 ${arr.length} 户` : '');
  const dates = [...new Set(im.files.filter(t1ImpReady).flatMap(f => t1ImpPlan(f).bals.map(b => b.date)))].sort();

  return head('导入账户台账', `${im.files.length} 份文件 · 就绪 ${tot.ready} 份`, '工具箱 · T1', tools)
    + kpis([
      { k: '新增账户', v: String(tot.add), u: '户', t: tot.add ? 'g' : '' },
      { k: '更新账户', v: String(tot.upd), u: '户', t: tot.upd ? 'w' : '' },
      { k: '无变化', v: String(tot.same), u: '户' },
      { k: '带余额', v: String(tot.bals), u: '条', t: tot.bals ? 'g' : '' },
      { k: '流水明细', v: String(tot.txns), u: '笔', t: tot.txns ? 'g' : '', d: tot.txns ? '逐笔留存可下钻' : '认出交易列才有' },
      { k: '待设置', v: String(tot.notReady), u: '份', t: tot.notReady ? 'c' : 'g' },
    ])
    + cardp(`文件清单（${im.files.length} 份）`, table(
      [{ t: '文件' }, { t: '行数', n: 1 }, { t: '主体' }, { t: '账户 / 平台' }, { t: '状态' }, { t: '' }], fileRows)
      + `<div style="margin-top:11px">${picker}<span class="mut" style="margin-left:9px">再选是往上加，不会顶掉已经选好的</span></div>`,
      `<button class="btn sm" data-t1act="impCancel">清空</button>`)
    + cardp(`列对应关系 · ${H(cur.fileName.slice(0, 22))}`,
      `<div style="margin-bottom:11px">表头在第几行 <select id="t1head" style="min-width:300px">${headOpts}</select></div>`
      + table([{ t: '字段' }, { t: '对应哪一列' }, { t: '示例值' }], mapRows)
      + `<div class="note" style="margin-top:11px">这一份的列对应只管这一份文件。每份格式不同（不同银行的对账单）都能各设各的。</div>`)
    + (t1ImpReady(cur) && p.add.length ? `<div class="note g"><b>本份会新增 ${p.add.length} 户：</b>${cut(p.add, 8)}</div>` : '')
    + (t1ImpReady(cur) && p.upd.length ? `<div class="note w"><b>本份会更新 ${p.upd.length} 户</b>（复用原编号，历史余额不丢）：${
        p.upd.slice(0, 6).map(u => `${H(u.ent)} · ${H(u.name)}（${u.chg.join('、')}）`).join('；')}${p.upd.length > 6 ? ' …' : ''}</div>` : '')
    + (tot.bad ? `<div class="note c"><b>整批共 ${tot.bad} 行没法用，会跳过。</b></div>` : '')
    + (tot.bals ? `<div class="note"><b>余额会写到 ${dates.slice(0, 8).join('、')}${dates.length > 8 ? ` 等 ${dates.length} 天` : ''}</b>，
        在 T1 里标「来自 T1导入」。文件里没有余额日期列时用当前选的日期 ${T1.date}。</div>` : '')
    + (tot.txns ? `<div class="note g"><b>流水明细 ${tot.txns} 笔会一并留存</b>${tot.txnSkip ? `（另有 ${tot.txnSkip} 行没日期或金额为 0，多为合计/说明行，留不了）` : ''}——导入后在 T1 点主体余额下钻，每一笔直接列出。同一天重复导入整天替换，不会翻倍；每户最多留最近 62 天，更早的会被掐掉并按实际留存数报。</div>` : '')
    + (!tot.txns && tot.txnSkip ? `<div class="note w"><b>认出了交易列，但 ${tot.txnSkip} 行都没收上</b>（没日期、金额为 0，或日期认不出来）。检查「日期」对应的列是不是交易日期——对成时间/序号列就会整份收不上。</div>` : '')
    + (t1ImpReady(cur) && p.txns.length === 0 && cur.map.bal !== undefined && cur.map.date !== undefined
        && cur.map.inAmt === undefined && cur.map.outAmt === undefined && cur.map.amt === undefined
      ? `<div class="note w"><b>当前这份没认出收入/支出列，只收余额、不留流水明细。</b>要每一笔都能在 T1 里看到，
         把上面「收入金额 / 支出金额」（或「发生额（单列）+ 借贷标志」）对应上再导。</div>` : '')
    + cardp('导入方式', `<label style="font-size:12px"><input type="checkbox" id="t1off" ${im.offStale ? 'checked' : ''}>
        把「这批文件里都没有、但当前在管」的账户设为<b>停用</b></label>
      <div class="note" style="margin-top:9px"><b>不勾就是纯追加合并</b>：这批没提到的账户原样不动。
        勾了按<b>整批的账户并集</b>判断（不是单份文件），也只是停用、<b>不删除</b>，历史余额一律保留。</div>`)
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        ${tot.notReady ? `<span class="mut" style="align-self:center">还有 ${tot.notReady} 份没设主体/账户名，导入时会跳过</span>` : ''}
        <button class="btn pri" data-t1act="impApply" ${tot.ready ? '' : 'disabled'}>全部导入（${tot.ready} 份）</button>
      </div>`;
};

/* 日报文本 */
function t1Text() {
  const ents = t1ByEnt(T1.date);
  const tot = ents.reduce((s, e) => s + e.bal, 0);
  const prevD = t1Prev(T1.date);
  const totPrev = ents.reduce((s, e) => s + e.prev, 0);
  const delta = prevD ? tot - totPrev : null;
  const red = ents.filter(e => e.red);
  const stale = [];
  ents.forEach(e => e.accs.forEach(a => { if (a.stale) stale.push(`${e.ent}·${a.name}（${a.from}）`); }));
  const miss = [];
  ents.forEach(e => e.accs.forEach(a => { if (a.v === null) miss.push(`${e.ent}·${a.name}`); }));

  let t = `【资金日报】${T1.date}\n`;
  t += `━━━━━━━━━━━━━━\n`;
  t += `集团合计　${money(tot)} 元`;
  if (delta !== null) t += `　较上日 ${delta >= 0 ? '+' : ''}${money(delta)} 元`;
  t += `\n在管账户 ${T1_ACC.filter(a => a.on).length} 个\n\n`;

  ents.forEach(e => {
    t += `▍${e.ent}　${money(e.bal)} 元`;
    if (e.delta !== null && Math.abs(e.delta) > 0.005) t += `　${e.delta >= 0 ? '↑' : '↓'}${money(Math.abs(e.delta))}`;
    if (e.incomplete) t += `　覆盖 —（数据不全）`;
    else if (e.cover !== null) t += `　覆盖 ${e.cover.toFixed(2)}${e.red ? ' ⚠' : ''}`;
    t += `\n`;
  });

  if (red.length) {
    t += `\n⚠ 红线预警（低于 ${T1_CFG.ratio} 倍）\n`;
    red.forEach(e => { t += `　${e.ent}　覆盖 ${e.cover.toFixed(2)}　余额 ${money(e.bal)} 元 / 月固定支出 ${money(e.fixed)} 元\n`; });
  }
  if (stale.length) {
    t += `\n※ 以下 ${stale.length} 个账户今日未更新，沿用上次余额：\n　${stale.join('、')}\n`;
  }
  if (miss.length) {
    t += `\n※ 以下 ${miss.length} 个账户从未录入，未计入合计：\n　${miss.join('、')}\n`;
  }
  t += `\n━━━━━━━━━━━━━━\n由财务中心工具箱 T1 生成`;
  return t;
}

S['t1-report'] = () => {
  const txt = t1Text();
  return head('日报文本', '可直接复制粘贴到钉钉群。<b>沿用昨日的账户和从未录入的账户都会单独列出</b>——让收报表的人知道哪些数是新的。', '工具箱 · T1',
    `<button class="btn" data-t1go="daily">← 返回</button>
     <button class="btn" data-t1act="dl">导出 CSV</button>
     <button class="btn pri" data-t1act="copy">复制文本</button>`)
    + `<div class="card"><div class="cb"><pre id="t1txt" class="t1pre">${H(txt)}</pre></div></div>`
    + `<div class="note"><b>改造前：</b>出纳每日盘点 11 个主体/平台资金并发群，约 1.2 小时。<b>改造后：</b>抄余额仍是人工，但汇总、算覆盖倍数、比对昨日、排版、生成文本全自动，约 15 分钟。</div>`;
};

/* ============ 交互 ============ */
function t1Export() {
  const ents = t1ByEnt(T1.date);
  const hdr = ['日期', '主体', '账户/平台', '类型', '余额', '数据状态', '取自日期'];
  const rows = [];
  ents.forEach(e => e.accs.forEach(a => {
    rows.push([T1.date, e.ent, a.name, a.type === 'plat' ? '平台' : '银行',
      a.v === null ? '' : a.v.toFixed(2),
      a.v === null ? '从未录入' : (a.stale ? '沿用上次' : '今日更新'), a.from || '']);
  }));
  rows.push([]);
  rows.push(['—— 主体汇总 ——', '', '', '', '', '', '']);
  ents.forEach(e => rows.push([T1.date, e.ent, '合计', '', e.bal.toFixed(2),
    e.incomplete ? '数据不全，未算覆盖倍数'
      : e.cover === null ? '' : `覆盖 ${e.cover.toFixed(2)}${e.red ? ' 红线预警' : ''}`, '']));
  download(`资金日报_${T1.date}.csv`, toCSV([hdr].concat(rows)));
  toast('已导出');
}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-t1go]');
  if (g) { const v = g.dataset.t1go; go(v === 'daily' ? 't1' : 't1-' + v, { resetScroll: true }); return; }
  const de = e.target.closest('[data-t1ent]');
  if (de) { T1.drillEnt = de.dataset.t1ent; go('t1-ent'); return; }
  const dtx = e.target.closest('[data-t1txn]');
  if (dtx) { T1.drillAcc = dtx.dataset.t1txn; go('t1-txn'); return; }
  const pk = e.target.closest('[data-t1pick]');
  if (pk && T1.imp) { T1.imp.cur = +pk.dataset.t1pick; go('t1-imp'); return; }
  const rm = e.target.closest('[data-t1rm]');
  if (rm && T1.imp) {
    T1.imp.files.splice(+rm.dataset.t1rm, 1);
    if (!T1.imp.files.length) T1.imp = null;
    else T1.imp.cur = Math.min(T1.imp.cur, T1.imp.files.length - 1);
    go('t1-imp'); return;
  }
  const d = e.target.closest('[data-t1del]');
  if (d) {
    if (!confirm('确认删除该账户？历史余额数据会保留。')) return;
    T1_ACC = T1_ACC.filter(a => a.id !== d.dataset.t1del); t1SaveAcc(T1_ACC);
    toast('已删除'); go('t1-acc'); return;
  }
  const a = e.target.closest('[data-t1act]');
  if (!a) return;
  const act = a.dataset.t1act;
  if (act === 'save') {
    const day = t1LoadDay(); const today = day[T1.date] || {};
    let n = 0;
    document.querySelectorAll('[data-t1cell]').forEach(inp => {
      const id = inp.dataset.t1cell, v = inp.value.trim();
      if (v === '') delete today[id];
      else { today[id] = Number(v) || 0; n++; }
    });
    day[T1.date] = today; t1SaveDay(day);
    toast(`已保存 ${n} 个账户余额`); go('t1');
  }
  else if (act === 'gen') go('t1-report');
  else if (act === 'copy') {
    const txt = t1Text();
    navigator.clipboard.writeText(txt).then(
      () => toast('已复制，粘贴到钉钉群即可'),
      () => {
        const el = document.getElementById('t1txt');
        const r = document.createRange(); r.selectNodeContents(el);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('已选中，按 ⌘C 复制', 3200);
      });
  }
  else if (act === 'dl') t1Export();
  else if (act === 'impTpl') t1ImpTemplate();
  else if (act === 'impCancel') { T1.imp = null; go('t1-imp'); }
  else if (act === 'impApply') {
    const t = t1ImpTotals();
    if (!t.ready) { toast('还没有设好主体与账户名的文件'); return; }
    if (!t.add && !t.upd && !t.bals && !T1.imp.offStale) {
      toast('这批文件没有需要写入的改动'); return;
    }
    t1ImpApply();
  }
  else if (act === 'addAcc') {
    // 不能用 length+1：删过账户会撞号，撞上的新账户会继承旧账户的历史余额和流水明细
    const id = t1MkId(t1NextSeq());
    T1_ACC.push({ id, ent: '新主体', name: '新账户', type: 'bank', on: 1 });
    t1SaveAcc(T1_ACC); go('t1-acc');
  }
  else if (act === 'saveAcc') {
    document.querySelectorAll('[data-t1acc]').forEach(inp => {
      const [id, k] = inp.dataset.t1acc.split(':');
      const a = T1_ACC.find(x => x.id === id); if (a) a[k] = inp.value;
    });
    document.querySelectorAll('[data-t1on]').forEach(cb => {
      const a = T1_ACC.find(x => x.id === cb.dataset.t1on); if (a) a.on = cb.checked ? 1 : 0;
    });
    document.querySelectorAll('[data-t1fix]').forEach(inp => {
      T1_CFG.fixed[inp.dataset.t1fix] = Number(inp.value) || 0;
    });
    t1SaveAcc(T1_ACC); t1SaveCfg(T1_CFG);
    toast('台账已保存'); go('t1');
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 't1file' && e.target.files && e.target.files.length) {
    const fs = e.target.files; e.target.value = '';   // 清空才能再选同一份文件
    t1ImpLoad(fs); return;
  }
  if (e.target.id === 't1head' && t1ImpCur()) {
    const f = t1ImpCur();
    f.headRow = +e.target.value;
    f.map = t1ImpAutoMap(f.rows[f.headRow] || []);
    go('t1-imp'); return;
  }
  if (e.target.id === 't1off' && T1.imp) { T1.imp.offStale = e.target.checked ? 1 : 0; go('t1-imp'); return; }
  // 主体/账户名按文件下标改——一屏里同时挂着好几份文件的下拉与输入框
  if (e.target.dataset && e.target.dataset.t1fix && e.target.dataset.t1i !== undefined && T1.imp) {
    const f = T1.imp.files[+e.target.dataset.t1i];
    if (f) {
      if (e.target.dataset.t1fix === 'ent') f.fixEnt = e.target.value;
      else { f.fixName = e.target.value; f.guessed = 0; }
      go('t1-imp');
    }
    return;
  }
  if (e.target.dataset && e.target.dataset.t1map && t1ImpCur()) {
    const f = t1ImpCur(), k = e.target.dataset.t1map;
    if (e.target.value === '') delete f.map[k]; else f.map[k] = +e.target.value;
    go('t1-imp'); return;
  }
  // 改日期留在当前页——在主体明细里翻日期不该被踢回日报
  if (e.target.id === 't1date') { T1.date = e.target.value; go(typeof CURS === 'string' && CURS.indexOf('t1') === 0 ? CURS : 't1'); }
  if (e.target.id === 't1entFilter') { T1.filterEnt = e.target.value; go('t1-entry'); }
  if (e.target.id === 't1ratio') { T1_CFG.ratio = Number(e.target.value) || 1.5; t1SaveCfg(T1_CFG); go('t1'); }
  if (e.target.id === 't1rateTh') { T1_CFG.rateTh = Math.abs(Number(e.target.value)) || 10; t1SaveCfg(T1_CFG); go('t1'); }
});

/* ============ 资金 · 网银入口 ============ */
/* 广州市常用银行的官网首页直达。只放官网首页、不放登录深链——
   网银登录页地址银行经常换，从官网首页点「企业网银」进最稳，也防钓鱼。
   集团在 T1 台账里有账户的银行自动置顶并标账户数。 */
const FD_BANKS = [
  ['工商银行', 'icbc', 'https://www.icbc.com.cn', '#c7000b'],
  ['建设银行', 'ccb', 'https://www.ccb.com', '#0066b3'],
  ['农业银行', 'abc', 'https://www.abchina.com', '#009944'],
  ['中国银行', 'boc', 'https://www.boc.cn', '#a71e32'],
  ['交通银行', 'bocom', 'https://www.bankcomm.com', '#00467f'],
  ['邮储银行', 'psbc', 'https://www.psbc.com', '#007a3d'],
  ['招商银行', 'cmb', 'https://www.cmbchina.com', '#c7000b'],
  ['浦发银行', 'spdb', 'https://www.spdb.com.cn', '#00509e'],
  ['中信银行', 'citic', 'https://www.citicbank.com', '#c8102e'],
  ['民生银行', 'cmbc', 'https://www.cmbc.com.cn', '#009b8d'],
  ['兴业银行', 'cib', 'https://www.cib.com.cn', '#004a8f'],
  ['光大银行', 'ceb', 'https://www.cebbank.com', '#5c2d91'],
  ['平安银行', 'pab', 'https://bank.pingan.com', '#ff6600'],
  ['华夏银行', 'hxb', 'https://www.hxb.com.cn', '#c7000b'],
  ['广发银行', 'cgb', 'https://www.cgbchina.com.cn', '#c7000b'],
  ['广州银行', 'gzcb', 'https://www.gzcb.com.cn', '#d61619'],
  ['广州农商银行', 'grcb', 'https://www.grcbank.com', '#00854a'],
  ['网商银行', 'mybank', 'https://www.mybank.cn', '#ff6a00'],
  ['微众银行', 'webank', 'https://www.webank.com', '#0080ff'],
  ['支付宝（企业账户）', 'alipay', 'https://b.alipay.com', '#1677ff'],
];
/* 台账账户名（工行基本户…）→ 银行全名，算出各银行的账户数用来置顶 */
const FD_SHORT = { 工行: '工商银行', 建行: '建设银行', 农行: '农业银行', 中行: '中国银行',
  交行: '交通银行', 邮储: '邮储银行', 招行: '招商银行', 浦发: '浦发银行', 中信: '中信银行',
  民生: '民生银行', 兴业: '兴业银行', 光大: '光大银行', 平安: '平安银行', 华夏: '华夏银行',
  广发: '广发银行', 网商: '网商银行', 农商: '广州农商银行', 支付宝: '支付宝（企业账户）' };
S['fd-banks'] = () => {
  const cnt = {};
  T1_ACC.filter(a => a.on).forEach(a => {
    for (const k of Object.keys(FD_SHORT)) {
      if (String(a.name).includes(k)) { const b = FD_SHORT[k]; cnt[b] = (cnt[b] || 0) + 1; return; }
    }
  });
  const list = FD_BANKS.slice().sort((a, b) => (cnt[b[0]] || 0) - (cnt[a[0]] || 0));
  const cards = list.map(b => {
    const n = cnt[b[0]] || 0;
    return `<a class="bank" href="${b[2]}" target="_blank" rel="noopener noreferrer" style="--bc:${b[3]}">
      <span class="bi0">${H(b[0].slice(0, 1))}</span>
      <span class="bn">${H(b[0])}${n ? ` <span class="bcnt">${n} 户</span>` : ''}</span>
      <span class="bu">${H(b[2].replace('https://', ''))}</span>
    </a>`;
  }).join('');
  return head('网银入口', `广州市常用银行官网直达 · 集团有账户的银行已置顶（来自 T1 账户台账）。`, '资金 · 业务链接')
    + `<div class="note"><b>只放官网首页，不放登录深链。</b>网银登录页地址银行经常换，从官网首页点「企业网银」进最稳；
      也别用搜索引擎搜网银登录页——钓鱼站最爱做这个。U盾/证书登录问题打银行对公客服，别信弹窗。</div>`
    + `<div class="bankgrid">${cards}</div>`;
};
