/* T4 日损益表
   依据澳乐事业部 2026-08 日损益底稿重构：渠道明细 → 子组 → 大电商/拼多多/经销事业部 → 全部汇总。
   原始值、比例/按月分摊值与硬推值分开保存，汇总一律由工具重算。 */
'use strict';

const T4_GAP_LIMIT = 2;
const T4_KEY = 'fsc_t4_data_v2';
const T4_CFG_KEY = 'fsc_t4_cfg_v1';
const T4_DAILY_FILE = { k: 'daily', n: '标准日损益明细', hint: '按日期映射收入、成本、费用和管理费用等完整科目' };

const T4_CH = [
  { id: 'tmall', n: '天猫', bu: 'ecom', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「天猫-澳乐旗舰店」；按发货时间归属' },
    { k: 'ztc', n: '天猫直通车', hint: '按记账时间；仅取支出/扣款，排除充值' },
    { k: 'cps', n: '天猫 CPS', hint: '按日期取支出金额' },
  ] },
  { id: 'jdzy', n: '京东自营', bu: 'ecom', tier: '特卖', files: [
    T4_DAILY_FILE,
    { k: 'jdIncome', n: '京东自营收入交易概况', hint: '日期 → 当日成交金额；零金额日也保留' },
    { k: 'jzt', n: '京准通推广费', hint: '投放日期 → 支出绝对值' },
  ] },
  { id: 'jdpop', n: '京东 POP', bu: 'ecom', tier: '特卖', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「京东-澳乐官方旗舰店」' },
  ] },
  { id: 'vip', n: '唯品会', bu: 'ecom', tier: '特卖', files: [T4_DAILY_FILE] },
  { id: 'ks', n: '快手', bu: 'ecom', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「快手-澳乐母婴品牌店」' },
  ] },
  { id: 'priv', n: '私域', bu: 'ecom', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'pdd_aole', n: '拼多多-澳乐旗舰店', bu: 'pdd', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「拼多多-澳乐旗舰店」' },
  ] },
  { id: 'pdd_toy', n: '拼多多-澳乐母婴玩具旗舰店', bu: 'pdd', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「拼多多-澳乐母婴玩具旗舰店」' },
  ] },
  { id: 'pdd_mom', n: '拼多多-澳乐母婴旗舰店', bu: 'pdd', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「拼多多-澳乐母婴旗舰店」' },
  ] },
  { id: 'tm_zzzrest', n: '天猫-zzzrest旗舰店', bu: 'ruimian', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「天猫-zzzrest旗舰店」；按发货时间归属' },
  ] },
  { id: 'tianmen', n: '天门', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'gift', n: '礼品单', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'supply', n: '电商供货', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'groupbuy', n: '团购', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'dycreator', n: '抖音达人店', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
];
const T4_CHM = Object.fromEntries(T4_CH.map(c => [c.id, c]));
const T4_TMAI = T4_CH.filter(c => c.tier === '特卖').map(c => c.id);
const T4_BIG_ECOM = T4_CH.filter(c => c.bu === 'ecom').map(c => c.id);
const T4_PDD = T4_CH.filter(c => c.bu === 'pdd').map(c => c.id);
const T4_RUIMIAN = T4_CH.filter(c => c.bu === 'ruimian').map(c => c.id);
const T4_DEALER = T4_CH.filter(c => c.bu === 'dealer').map(c => c.id);
const T4_ALL = T4_CH.map(c => c.id);
const T4_BU_META = {
  ecom: { n: '大电商事业部', short: '大电商', pill: 'in' },
  pdd: { n: '拼多多事业部', short: '拼多多', pill: 'ok' },
  ruimian: { n: '瑞眠事业部', short: '瑞眠', pill: 'mu' },
  dealer: { n: '经销事业部', short: '经销', pill: 'wa' },
};
const t4BuName = id => (T4_BU_META[id] || {}).n || id;
const t4BuPill = id => { const m = T4_BU_META[id] || { short:id, pill:'mu' }; return pill(m.short, m.pill); };

const T4_INPUTS = [
  { k: 'retailIncome', n: '零售收入', g: '销售与成本' },
  { k: 'returnAmount', n: '退货金额', g: '销售与成本' },
  { k: 'refundAmount', n: '退款金额', g: '销售与成本' },
  { k: 'retailCost', n: '零售成本', g: '销售与成本' },
  { k: 'returnCost', n: '退货成本', g: '销售与成本' },
  { k: 'platformFee', n: '平台扣点', g: '运营费用' },
  { k: 'platformOther', n: '平台其他', g: '运营费用' },
  { k: 'promotion', n: '推广费用', g: '运营费用' },
  { k: 'ztc', n: '直通车', g: '运营费用' },
  { k: 'cps', n: 'CPS', g: '运营费用' },
  { k: 'research', n: '数研', g: '运营费用' },
  { k: 'aftersales', n: '售后费用', g: '运营费用' },
  { k: 'logistics', n: '快递物流', g: '运营费用' },
  { k: 'warehouse', n: '仓储费用', g: '运营费用' },
  { k: 'tax', n: '税费', g: '运营费用' },
  { k: 'directLabor', n: '直接人工', g: '直接管理费用' },
  { k: 'directRent', n: '直接租金物业', g: '直接管理费用' },
  { k: 'directOther', n: '直接其他管理', g: '直接管理费用' },
  { k: 'sharedLabor', n: '人力公摊', g: '间接管理费用' },
  { k: 'sharedRent', n: '房租水电公摊', g: '间接管理费用' },
  { k: 'sharedOther', n: '其他公摊', g: '间接管理费用' },
];
const T4_INPUT_KEYS = T4_INPUTS.map(x => x.k);

const T4_METRICS = [
  { k: 'salesIncome', n: '销售收入', lvl: 0 },
  { k: 'retailIncome', n: '　零售收入', lvl: 1 },
  { k: 'returnAmount', n: '　退货金额', lvl: 1 },
  { k: 'refundAmount', n: '　退款金额', lvl: 1 },
  { k: 'salesCost', n: '销售成本', lvl: 0 },
  { k: 'retailCost', n: '　零售成本', lvl: 1 },
  { k: 'returnCost', n: '　退货成本', lvl: 1 },
  { k: 'grossProfit', n: '毛利', lvl: 0 },
  { k: 'grossMargin', n: '毛利率', pct: true, lvl: 0 },
  { k: 'operating', n: '运营费合计', lvl: 0 },
  { k: 'platformFee', n: '　平台扣点', lvl: 1 },
  { k: 'platformOther', n: '　平台其他', lvl: 1 },
  { k: 'promotion', n: '　推广费用', lvl: 1 },
  { k: 'ztc', n: '　直通车', lvl: 1 },
  { k: 'cps', n: '　CPS', lvl: 1 },
  { k: 'research', n: '　数研', lvl: 1 },
  { k: 'aftersales', n: '　售后费用', lvl: 1 },
  { k: 'logistics', n: '　快递物流', lvl: 1 },
  { k: 'warehouse', n: '　仓储费用', lvl: 1 },
  { k: 'tax', n: '　税费', lvl: 1 },
  { k: 'direct', n: '直接管理费用合计', lvl: 0 },
  { k: 'directLabor', n: '　直接人工', lvl: 1 },
  { k: 'directRent', n: '　直接租金物业', lvl: 1 },
  { k: 'directOther', n: '　直接其他管理', lvl: 1 },
  { k: 'contribution', n: '边际毛利', lvl: 0 },
  { k: 'contributionRate', n: '边际毛利率', pct: true, lvl: 0 },
  { k: 'indirect', n: '间接管理费用合计', lvl: 0 },
  { k: 'sharedLabor', n: '　人力公摊', lvl: 1 },
  { k: 'sharedRent', n: '　房租水电公摊', lvl: 1 },
  { k: 'sharedOther', n: '　其他公摊', lvl: 1 },
  { k: 'netProfit', n: '净利润', lvl: 0 },
  { k: 'netMargin', n: '净利润率', pct: true, lvl: 0 },
];

const T4_CFG_DEFAULT = {
  tmall: { platformFeeRate: .05, platformOtherRate: .033, aftersalesRate: .009, logisticsRate: .08, warehouseRate: .02, taxRate: .01,
    directLaborMonth: 9802.343, directRentMonth: 1190.5, directOtherMonth: 2095.73,
    sharedLaborMonth: 194.475465327179, sharedRentMonth: 255.11, sharedOtherMonth: 296.93 },
  jdzy: { retailCostRate: .45, returnRate: -.16, returnCostRate: -.16, platformFeeRate: .30, taxRate: .04, logisticsMonth: 5000,
    directLaborMonth: 11273.173, directRentMonth: 2011.54, directOtherMonth: 3541.06,
    sharedLaborMonth: 91.2252469974487, sharedRentMonth: 431.04, sharedOtherMonth: 501.72 },
  jdpop: { platformFeeRate: .063, logisticsRate: .10, taxRate: .018,
    directLaborMonth: 9802.343, directRentMonth: 1190.5, directOtherMonth: 2095.73,
    sharedLaborMonth: 200.180588463734, sharedRentMonth: 255.11, sharedOtherMonth: 296.93 },
  vip: { directLaborMonth: 7414.617, directRentMonth: 1026.29, directOtherMonth: 1806.66,
    sharedLaborMonth: 5.33824775458277, sharedRentMonth: 219.92, sharedOtherMonth: 255.97 },
  ks: { directLaborMonth: 0, sharedLaborMonth: 82.5103681163978 },
  priv: { directLaborMonth: 5838.63 },
  pdd_aole: {},
  pdd_toy: {},
  pdd_mom: {},
  tianmen: {},
  gift: {},
  supply: {},
  groupbuy: {},
  dycreator: {},
  tm_zzzrest: {},
};

const T4_CFG_FIELDS = [
  ['retailCostRate', '零售成本率', 'rate'], ['returnRate', '退货率', 'rate'], ['returnCostRate', '退货成本率', 'rate'],
  ['platformFeeRate', '平台扣点率', 'rate'], ['platformOtherRate', '平台其他率', 'rate'],
  ['aftersalesRate', '售后费用率', 'rate'], ['logisticsRate', '快递物流率', 'rate'],
  ['warehouseRate', '仓储费率', 'rate'], ['taxRate', '税率', 'rate'],
  ['logisticsMonth', '快递物流/月', 'money'],
  ['directLaborMonth', '直接人工/月', 'money'], ['directRentMonth', '直接租金物业/月', 'money'],
  ['directOtherMonth', '直接其他管理/月', 'money'], ['sharedLaborMonth', '人力公摊/月', 'money'],
  ['sharedRentMonth', '房租水电公摊/月', 'money'], ['sharedOtherMonth', '其他公摊/月', 'money'],
];

/* 管理费分摊页只管这 6 个项目：前 3 项合计为直接管理费用，后 3 项合计为间接管理费用 */
const T4_MGMT_FIELDS = [
  ['directLaborMonth', '直接人工'], ['directRentMonth', '直接租金物业'], ['directOtherMonth', '直接其他管理'],
  ['sharedLaborMonth', '人力公摊'], ['sharedRentMonth', '房租水电公摊'], ['sharedOtherMonth', '其他公摊'],
];

const T4_FILE_DEFS = {
  daily: { fields: [
    ['date', '日期', ['日期', '业务日期', '统计日期']],
    ['retailIncome', '零售收入', ['零售收入']], ['returnAmount', '退货金额', ['退货金额']],
    ['refundAmount', '退款金额', ['退款金额']], ['retailCost', '零售成本', ['零售成本']],
    ['returnCost', '退货成本', ['退货成本']], ['platformFee', '平台扣点', ['平台扣点']],
    ['platformOther', '平台其他', ['平台其他']], ['promotion', '推广费用', ['推广费用', '推广费']],
    ['ztc', '直通车', ['直通车']], ['cps', 'CPS', ['CPS']], ['research', '数研', ['数研']],
    ['aftersales', '售后费用', ['售后费用']], ['logistics', '快递物流', ['快递物流', '快递费', '物流费']],
    ['warehouse', '仓储费用', ['仓储费用', '仓储费']], ['tax', '税费', ['税费']],
    ['directLabor', '直接人工', ['直接人工']], ['directRent', '直接租金物业', ['直接租金物业']],
    ['directOther', '直接其他管理', ['直接其他管理']], ['sharedLabor', '人力公摊', ['人力公摊']],
    ['sharedRent', '房租水电公摊', ['房租水电公摊']], ['sharedOther', '其他公摊', ['其他公摊']],
  ], required: ['date'] },
  sales: { fields: [
    ['date', '发货时间', ['发货时间', '日期']], ['channel', '销售渠道', ['销售渠道', '渠道']],
    ['type', '订单类型', ['订单类型', '业务类型']], ['amount', '分摊后金额', ['分摊后金额', '金额']],
    ['cost', '货品成本', ['货品成本', '成本']], ['postage', '预估邮资', ['预估邮资', '邮资']],
    ['research', '数研', ['数研']],
  ], required: ['date', 'channel', 'amount'] },
  ztc: { fields: [
    ['date', '记账时间', ['记账时间']], ['amount', '操作金额(元)', ['操作金额', '金额']],
    ['direction', '收支类型', ['收支类型']], ['type', '交易类型', ['交易类型']],
  ], required: ['date', 'amount'] },
  cps: { fields: [['date', '日期', ['日期']], ['amount', '支出金额', ['支出金额', '金额']]], required: ['date', 'amount'] },
  jdIncome: { fields: [['date', '日期', ['日期']], ['amount', '成交金额', ['成交金额']]], required: ['date', 'amount'] },
  jzt: { fields: [['date', '投放日期', ['投放日期', '日期']], ['amount', '支出', ['支出', '金额']]], required: ['date', 'amount'] },
};
T4_FILE_DEFS.summaryDaily = {
  fields: [
    ['bu', '归属事业部', ['归属事业部', '事业部']], ['channel', '渠道', ['渠道', '渠道名称', '店铺']],
    ...T4_FILE_DEFS.daily.fields,
  ],
  required: ['channel', 'date'],
};

const T4 = { period: new Date().toISOString().slice(0, 7), data: {}, cfg: {}, editCh: 'tmall', imp: null, sumDate: '', viewDate: '' };

function t4Clone(x) { return JSON.parse(JSON.stringify(x)); }
function t4Load() {
  try {
    const all = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    T4.data = all[T4.period] || {};
  } catch (e) { T4.data = {}; }
  T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; });
  try {
    const saved = JSON.parse(localStorage.getItem(T4_CFG_KEY) || '{}');
    T4.cfg = t4Clone(T4_CFG_DEFAULT);
    T4_CH.forEach(c => Object.assign(T4.cfg[c.id], saved[c.id] || {}));
  } catch (e) { T4.cfg = t4Clone(T4_CFG_DEFAULT); }
  t4MigrateV1();
  t4MigrateFileParts();
}
function t4MigrateV1() {
  try {
    const old = JSON.parse(localStorage.getItem('fsc_t4_data_v1') || '{}')[T4.period];
    if (!old) return;
    T4_CH.forEach(c => Object.entries(old[c.id] || {}).forEach(([dt, r]) => {
      if (T4.data[c.id][dt]) return;
      T4.data[c.id][dt] = { retailIncome: +r.income || 0, retailCost: +r.cost || 0,
        promotion: +r.promo || 0, returnAmount: +r.refund || 0, _src: r._src || 'manual' };
    }));
  } catch (e) { /* 旧数据损坏时忽略 */ }
}
function t4MigrateFileParts() {
  T4_CH.forEach(c => Object.values(T4.data[c.id] || {}).forEach(raw => {
    if (!raw._srcs) return;
    if (!raw._fileParts) raw._fileParts = {};
    Object.entries(raw._srcs).forEach(([k, src]) => {
      if (raw[k] == null) return;
      if (!raw._fileParts[src]) raw._fileParts[src] = {};
      if (raw._fileParts[src][k] == null) raw._fileParts[src][k] = +raw[k] || 0;
      delete raw[k];
    });
    delete raw._srcs;
  }));
}
function t4Save() {
  try {
    const all = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    all[T4.period] = T4.data;
    localStorage.setItem(T4_KEY, JSON.stringify(all));
  } catch (e) { toast('保存失败：浏览器存储空间不足'); }
}
function t4SaveCfg() { localStorage.setItem(T4_CFG_KEY, JSON.stringify(T4.cfg)); }

const t4Days = () => { const [y, m] = T4.period.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const t4Date = d => `${T4.period}-${String(d).padStart(2, '0')}`;
const t4Num = v => { const n = Number(String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '')); return Number.isFinite(n) ? n : 0; };
const t4Raw = (ch, dt) => (T4.data[ch] || {})[dt] || null;
function t4InputValue(raw, key) {
  if (!raw) return null;
  if (raw[key] != null) return +raw[key] || 0;
  const parts = raw._fileParts || {};
  for (const source of ['summaryDaily','daily']) {
    if (parts[source] && parts[source][key] != null) return +parts[source][key] || 0;
  }
  let value = 0, found = false;
  Object.entries(parts).forEach(([source, fields]) => {
    if (source === 'summaryDaily' || source === 'daily' || fields[key] == null) return;
    value += +fields[key] || 0; found = true;
  });
  return found ? value : null;
}
const t4HasInputs = raw => T4_INPUT_KEYS.some(k => t4InputValue(raw, k) != null);
const t4Filled = ch => Object.keys(T4.data[ch] || {}).filter(dt => t4InputValue(t4Raw(ch, dt), 'retailIncome') != null).length;

function t4Assumed(ch, key, base, hard) {
  const cfg = T4.cfg[ch] || {}, days = t4Days();
  const rateMap = { platformFee: 'platformFeeRate', platformOther: 'platformOtherRate', aftersales: 'aftersalesRate',
    logistics: 'logisticsRate', warehouse: 'warehouseRate', tax: 'taxRate' };
  const monthMap = { logistics: 'logisticsMonth', directLabor: 'directLaborMonth', directRent: 'directRentMonth',
    directOther: 'directOtherMonth', sharedLabor: 'sharedLaborMonth', sharedRent: 'sharedRentMonth', sharedOther: 'sharedOtherMonth' };
  if (rateMap[key] && cfg[rateMap[key]] != null) { hard.push(key); return base * cfg[rateMap[key]]; }
  if (monthMap[key] && cfg[monthMap[key]] != null) { hard.push(key); return cfg[monthMap[key]] / days; }
  return 0;
}

function t4Row(ch, dt) {
  const raw = t4Raw(ch, dt); if (!raw) return null;
  const r = {}, hard = [], explicit = new Set();
  T4_INPUT_KEYS.forEach(k => { const v = t4InputValue(raw, k); if (v != null) { r[k] = v; explicit.add(k); } });
  const cfg = T4.cfg[ch] || {};
  r.retailIncome = r.retailIncome || 0;
  if (ch === 'jdzy') {
    if (!explicit.has('retailCost')) { r.retailCost = r.retailIncome * (cfg.retailCostRate || 0); hard.push('retailCost'); }
    if (!explicit.has('returnAmount')) { r.returnAmount = r.retailIncome * (cfg.returnRate || 0); hard.push('returnAmount'); }
    if (!explicit.has('returnCost')) { r.returnCost = r.retailCost * (cfg.returnCostRate || 0); hard.push('returnCost'); }
  }
  ['returnAmount','refundAmount','retailCost','returnCost','promotion','ztc','cps','research'].forEach(k => { if (r[k] == null) r[k] = 0; });
  ['platformFee','platformOther','aftersales','logistics','warehouse','tax','directLabor','directRent','directOther','sharedLabor','sharedRent','sharedOther'].forEach(k => {
    if (r[k] == null) r[k] = t4Assumed(ch, k, r.retailIncome, hard);
  });
  r.salesIncome = r.retailIncome + r.returnAmount + r.refundAmount;
  r.salesCost = r.retailCost + r.returnCost;
  r.grossProfit = r.salesIncome - r.salesCost;
  r.grossMargin = r.salesIncome ? r.grossProfit / r.salesIncome : 0;
  r.operating = ['platformFee','platformOther','promotion','ztc','cps','research','aftersales','logistics','warehouse','tax'].reduce((n, k) => n + r[k], 0);
  r.direct = r.directLabor + r.directRent + r.directOther;
  r.contribution = r.grossProfit - r.operating - r.direct;
  r.contributionRate = r.salesIncome ? r.contribution / r.salesIncome : 0;
  r.indirect = r.sharedLabor + r.sharedRent + r.sharedOther;
  r.netProfit = r.contribution - r.indirect;
  r.netMargin = r.salesIncome ? r.netProfit / r.salesIncome : 0;
  r._hard = hard; r._src = raw._src || 'manual';
  return r;
}
/* 管理费 6 项的每日分摊额。口径：月度金额 ÷ 当月自然日；没有收入数据的日子同样计提 */
function t4MgmtDaily(ch) {
  const cfg = T4.cfg[ch] || {}, days = t4Days(), out = { any: false };
  T4_MGMT_FIELDS.forEach(([mk]) => {
    out[mk.replace(/Month$/, '')] = cfg[mk] != null ? (+cfg[mk] || 0) / days : 0;
    if (cfg[mk] != null) out.any = true;
  });
  out.direct = out.directLabor + out.directRent + out.directOther;
  out.indirect = out.sharedLabor + out.sharedRent + out.sharedOther;
  return out;
}

function t4Month(ch) {
  const out = Object.fromEntries(T4_METRICS.filter(x => !x.pct).map(x => [x.k, 0]));
  out.days = 0; out.hard = new Set();
  let rowN = 0;
  Object.keys(T4.data[ch] || {}).sort().forEach(dt => {
    const r = t4Row(ch, dt); if (!r) return;
    rowN++;
    T4_METRICS.filter(x => !x.pct).forEach(x => { out[x.k] += r[x.k] || 0; });
    if (t4Raw(ch, dt).retailIncome != null) out.days++;
    r._hard.forEach(k => out.hard.add(k));
  });
  // 无收入数据的日子照样计提管理费（有数据的日子已在 t4Row 里按参数计入）
  const md = t4MgmtDaily(ch), rest = t4Days() - rowN;
  if (md.any && rest > 0) {
    ['directLabor','directRent','directOther','sharedLabor','sharedRent','sharedOther','direct','indirect'].forEach(k => { out[k] += md[k] * rest; });
    out.contribution -= md.direct * rest;
    out.netProfit -= (md.direct + md.indirect) * rest;
  }
  out.grossMargin = out.salesIncome ? out.grossProfit / out.salesIncome : 0;
  out.contributionRate = out.salesIncome ? out.contribution / out.salesIncome : 0;
  out.netMargin = out.salesIncome ? out.netProfit / out.salesIncome : 0;
  return out;
}
function t4Group(ids) {
  const out = Object.fromEntries(T4_METRICS.filter(x => !x.pct).map(x => [x.k, 0]));
  ids.forEach(id => { const m = t4Month(id); T4_METRICS.filter(x => !x.pct).forEach(x => { out[x.k] += m[x.k] || 0; }); });
  out.grossMargin = out.salesIncome ? out.grossProfit / out.salesIncome : 0;
  out.contributionRate = out.salesIncome ? out.contribution / out.salesIncome : 0;
  out.netMargin = out.salesIncome ? out.netProfit / out.salesIncome : 0;
  return out;
}
/* ---------- 单日视图：看板可选具体日期，清空回整月 ---------- */
const t4DayHasIncome = (ch, dt) => t4InputValue(t4Raw(ch, dt), 'retailIncome') != null;
const t4DayOK = (ids, dt) => ids.every(id => t4DayHasIncome(id, dt));
/* 当前期间内的有效单日日期；跨期间的旧选择视为整月 */
const t4ViewDate = () => (T4.viewDate && T4.viewDate.startsWith(T4.period + '-') ? T4.viewDate : '');
function t4DayData(ch, dt) {
  const r = t4Row(ch, dt);
  if (r) return r;
  // 当日无任何数据：只计提管理费日摊
  const out = Object.fromEntries(T4_METRICS.map(x => [x.k, 0]));
  const md = t4MgmtDaily(ch);
  if (md.any) {
    ['directLabor','directRent','directOther','sharedLabor','sharedRent','sharedOther','direct','indirect'].forEach(k => { out[k] = md[k]; });
    out.contribution = -md.direct; out.netProfit = -(md.direct + md.indirect);
  }
  return out;
}
function t4GroupDay(ids, dt) {
  const out = Object.fromEntries(T4_METRICS.filter(x => !x.pct).map(x => [x.k, 0]));
  ids.forEach(id => { const r = t4DayData(id, dt); T4_METRICS.filter(x => !x.pct).forEach(x => { out[x.k] += r[x.k] || 0; }); });
  out.grossMargin = out.salesIncome ? out.grossProfit / out.salesIncome : 0;
  out.contributionRate = out.salesIncome ? out.contribution / out.salesIncome : 0;
  out.netMargin = out.salesIncome ? out.netProfit / out.salesIncome : 0;
  return out;
}

function t4Gap(ids = T4_ALL) {
  const ns = ids.map(id => t4Filled(id));
  return { max: Math.max(...ns), min: Math.min(...ns), gap: Math.max(...ns) - Math.min(...ns) };
}
const t4SumOK = (ids = T4_ALL) => { const g = t4Gap(ids); return g.max > 0 && g.gap <= T4_GAP_LIMIT; };
const t4Fmt = (v, pct) => pct ? `${(v * 100).toFixed(1)}%` : money(v || 0);

function t4PeriodControl(extra) {
  return `<label class="sel">期间 <input id="t4Period" type="month" value="${T4.period}" style="width:116px"></label>${extra || ''}`;
}
function t4Cal(ch) {
  let h = '<div class="t4cal">';
  for (let d = 1; d <= t4Days(); d++) {
    const dt = t4Date(d), raw = t4Raw(ch, dt), r = raw && t4Row(ch, dt);
    const filled = raw && t4InputValue(raw, 'retailIncome') != null;
    const cls = !filled ? 'n' : (r._hard.length ? 'h' : 'f');
    h += `<i class="${cls}" title="${d} 日${filled ? (r._hard.length ? ' · 含设定值' : '') : ' · 无收入数据'}">${d}</i>`;
  }
  return h + '</div>';
}

S.t4 = () => {
  t4Load();
  const vd = t4ViewDate();
  const g = t4Gap(), ok = vd ? t4DayOK(T4_ALL, vd) : t4SumOK(),
    ecomOK = vd ? t4DayOK(T4_BIG_ECOM, vd) : t4SumOK(T4_BIG_ECOM), pddOK = vd ? t4DayOK(T4_PDD, vd) : t4SumOK(T4_PDD),
    rmOK = vd ? t4DayOK(T4_RUIMIAN, vd) : t4SumOK(T4_RUIMIAN), dealerOK = vd ? t4DayOK(T4_DEALER, vd) : t4SumOK(T4_DEALER);
  const rows = T4_CH.map(c => {
    const n = t4Filled(c.id), m = vd ? t4DayData(c.id, vd) : t4Month(c.id);
    const mgmtAny = t4MgmtDaily(c.id).any, hasInc = vd ? t4DayHasIncome(c.id, vd) : n > 0, mgmtOnly = !n && mgmtAny;
    const src = c.files.length ? pill('文件/人工', 'ok') : pill('人工', 'wa');
    const st = n === 0 ? (mgmtOnly ? pill('仅管理费', 'wa') : pill('未开始', 'cr')) : n < 15 ? pill('缺口大', 'wa') : pill('已有数据', 'ok');
    return [t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
      `<b class="mono">${n}</b> / ${t4Days()}`, t4Cal(c.id), src,
      hasInc ? money(m.salesIncome) : '—', hasInc || mgmtAny ? money(m.netProfit) : '—', hasInc ? `${(m.netMargin * 100).toFixed(1)}%` : '—', st,
      `${c.files.length ? `<button class="btn sm" data-t4go="imp:${c.id}">导入</button>` : ''}
       <button class="btn sm" data-t4go="man:${c.id}">录入</button>`];
  });
  return head('T4　日损益表', `按底稿完整科目重算 ${T4_CH.length} 个渠道，并分别归集到大电商、拼多多、瑞眠和经销事业部。`, '工具箱 · 已更新',
    t4PeriodControl(`<label class="sel">日期 <input id="t4ViewDate" data-view="overview" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${vd}" title="选具体日期看单日损益，清空回整月累计" style="width:132px"></label><button class="btn" data-t4go="sumimp">汇总导入</button><button class="btn" data-t4go="summan">汇总录入</button><button class="btn" data-t4go="rules">取数口径</button><button class="btn" data-t4go="mgmt">管理费分摊</button><button class="btn" data-t4go="cfg">参数</button><button class="btn pri" data-t4go="sheet">看损益表</button>`))
    + kpis([
      { k: '渠道', v: String(T4_CH.length), u: '个' },
      { k: '大电商', v: String(T4_BIG_ECOM.length), u: '个渠道' },
      { k: '拼多多', v: String(T4_PDD.length), u: '个渠道' },
      { k: '瑞眠', v: String(T4_RUIMIAN.length), u: '个渠道' },
      { k: '经销', v: String(T4_DEALER.length), u: '个渠道' },
      { k: '大电商汇总', v: ecomOK ? '可用' : '禁用', t: ecomOK ? 'g' : 'c' },
      { k: '拼多多汇总', v: pddOK ? '可用' : '禁用', t: pddOK ? 'g' : 'c' },
      { k: '瑞眠汇总', v: rmOK ? '可用' : '禁用', t: rmOK ? 'g' : 'c' },
      { k: '经销汇总', v: dealerOK ? '可用' : '禁用', t: dealerOK ? 'g' : 'c' },
      { k: '全部汇总', v: ok ? '可用' : '禁用', t: ok ? 'g' : 'c', d: vd ? `${vd} 单日` : `全渠道极差 ${g.gap} 天` },
      (() => { // 管理费分摊全渠道月合计——分摊值随有收入数据的日子计入损益
        let sum = 0; const set = new Set();
        T4_CH.forEach(c => { const cfg = T4.cfg[c.id] || {}; T4_MGMT_FIELDS.forEach(([k]) => { if (cfg[k] != null) { sum += +cfg[k] || 0; set.add(c.id); } }); });
        return { k: '管理费分摊', v: set.size ? money(sum) : '未设置', u: set.size ? '元/月' : '', d: set.size ? `${set.size} 个渠道已设置 · 日摊 ${money(sum / t4Days())}` : '点「管理费分摊」录入或导入' };
      })(),
    ])
    + (vd ? `<div class="note"><b>单日视图 ${vd}。</b>渠道列为当日损益（无数据渠道仅计管理费日摊）；汇总卡要求组内全部渠道当日均有收入数据。清空日期返回整月累计。</div>` : '')
    + (vd ? '' : ok ? `<div class="note g"><b>四个事业部取数天数已对齐。</b>大电商、拼多多、瑞眠、经销和全部汇总均可用。</div>`
      : g.max === 0 ? '<div class="note"><b>本期尚无数据。</b>先导入平台文件或逐日录入；已设置的管理费分摊会随有收入数据的日子自动计入损益。</div>'
      : `<div class="note c"><b>部分汇总不可用。</b>大电商事业部：${ecomOK ? '可用' : '禁用'}；拼多多事业部：${pddOK ? '可用' : '禁用'}；瑞眠事业部：${rmOK ? '可用' : '禁用'}；经销事业部：${dealerOK ? '可用' : '禁用'}；全部汇总：禁用。请补齐对应事业部的渠道数据。</div>`)
    + card(vd ? `${T4_CH.length} 渠道 · ${vd} 单日损益` : `${T4_CH.length} 渠道取数进度`, table(
      [{t:'归属事业部'},{t:'渠道'},{t:'取数天数',n:1},{t:`日历（1—${t4Days()}）`},{t:'方式'},{t:'销售收入',n:1},{t:'净利润',n:1},{t:'净利率'},{t:'状态'},{t:''}], rows))
    + '<div class="t4lg"><span><em class="f"></em>实填</span><span><em class="h"></em>含参数/硬推</span><span><em class="n"></em>无收入数据</span></div>';
};

function t4EntryTable(ch, group) {
  const fs = T4_INPUTS.filter(f => f.g === group), rows = [];
  for (let d = 1; d <= t4Days(); d++) {
    const dt = t4Date(d), raw = t4Raw(ch, dt) || {}, r = t4Row(ch, dt);
    rows.push([`<b class="mono">${d}</b>`, ...fs.map(f => { const value = t4InputValue(raw, f.k), v = value != null ? value : ''; return `<input type="number" step="0.01" class="t4in" data-t4cell="${dt}:${f.k}" data-t4orig="${v}" value="${v}" placeholder="—">`; }),
      r ? `<b class="${r.netProfit >= 0 ? 'grn' : 'red'}">${money(r.netProfit)}</b>` : '—']);
  }
  return card(`${group} · ${T4_CHM[ch].n}`, table([{t:'日'}, ...fs.map(f => ({t:f.n,n:1})), {t:'当日净利润',n:1}], rows));
}
S['t4-man'] = () => {
  t4Load(); const c = T4_CHM[T4.editCh];
  return head(`录入　${c.n}`, '留空表示没有数据；填 0 表示当日确认为零。退货金额、退款金额和退货成本请按负数录入。', '工具箱 · T4',
    t4PeriodControl(`<select id="t4chSel">${T4_CH.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${x.n}</option>`).join('')}</select><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="saveMan">保存</button>`))
    + `<div class="note"><b>当前收入取数 ${t4Filled(c.id)} / ${t4Days()} 天。</b>浅色空格会由参数页中的比例或月度分摊值计算；在这里填值可覆盖该参数。</div>`
    + t4EntryTable(c.id, '销售与成本') + t4EntryTable(c.id, '运营费用')
    + t4EntryTable(c.id, '直接管理费用') + t4EntryTable(c.id, '间接管理费用');
};

function t4SummaryEntryTable(group, dt) {
  const fs = T4_INPUTS.filter(f => f.g === group);
  const rows = T4_CH.map(c => {
    const raw = t4Raw(c.id, dt) || {}, r = t4Row(c.id, dt);
    return [t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
      ...fs.map(f => { const value = t4InputValue(raw, f.k), v = value != null ? value : ''; return `<input type="number" step="0.01" class="t4in" data-t4sumcell="${c.id}:${f.k}" data-t4orig="${v}" value="${v}" placeholder="—">`; }),
      r ? `<b class="${r.netProfit >= 0 ? 'grn' : 'red'}">${money(r.netProfit)}</b>` : '—'];
  });
  return card(group, table([{t:'归属事业部'},{t:'渠道'}, ...fs.map(f => ({t:f.n,n:1})), {t:'当日净利润',n:1}], rows));
}
S['t4-summan'] = () => {
  t4Load();
  if (!T4.sumDate || !T4.sumDate.startsWith(T4.period + '-')) T4.sumDate = t4Date(1);
  return head('汇总录入', '选择一个日期，在同一页面录入全部渠道；各渠道原有录入入口继续保留。', '工具箱 · T4',
    t4PeriodControl(`<label class="sel">日期 <input id="t4SumDate" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${T4.sumDate}" style="width:132px"></label><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="sumManSave">保存全部渠道</button>`))
    + '<div class="note"><b>只保存发生变化的格子。</b>留空表示删除该日该科目的录入值；填 0 表示当日确认为零。</div>'
    + t4SummaryEntryTable('销售与成本', T4.sumDate) + t4SummaryEntryTable('运营费用', T4.sumDate)
    + t4SummaryEntryTable('直接管理费用', T4.sumDate) + t4SummaryEntryTable('间接管理费用', T4.sumDate);
};

function t4FindHead(rows, def) {
  let best = 0, score = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(x => String(x || '').replace(/\s/g, ''));
    let s = 0; def.fields.forEach(([, , names]) => { if (cells.some(c => names.some(n => c.includes(n)))) s += 10; });
    s += cells.filter(Boolean).length;
    if (s > score) { score = s; best = i; }
  }
  return best;
}
function t4AutoMap(row, def) {
  const map = {}, cells = row.map(x => String(x || '').replace(/\s/g, ''));
  def.fields.forEach(([k, , names]) => {
    let idx = -1;
    for (const n of names) { idx = cells.findIndex(c => c === n || c.includes(n)); if (idx >= 0) break; }
    if (idx >= 0) map[k] = idx;
  });
  return map;
}
function t4DateNorm(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d{5}(?:\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v), d = new Date(Math.round((n - 25569) * 86400000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
  m = /^(\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (m) return `${T4.period}-${String(+m[1]).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`;
  const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function t4ChannelName(ch) {
  return {
    tmall: '天猫-澳乐旗舰店', jdpop: '京东-澳乐官方旗舰店', ks: '快手-澳乐母婴品牌店',
    pdd_aole: '拼多多-澳乐旗舰店', pdd_toy: '拼多多-澳乐母婴玩具旗舰店', pdd_mom: '拼多多-澳乐母婴旗舰店',
    tm_zzzrest: '天猫-zzzrest旗舰店',
  }[ch] || '';
}
function t4Add(ch, dt, key, value, fileK) {
  const raw = T4.data[ch][dt] || { _src: 'file', _fileParts: {} };
  if (!raw._fileParts) raw._fileParts = {};
  if (!raw._fileParts[fileK]) raw._fileParts[fileK] = {};
  const part = raw._fileParts[fileK];
  part[key] = (part[key] || 0) + value; raw._src = 'file';
  T4.data[ch][dt] = raw;
}
function t4ClearSource(ch, fileK) {
  Object.keys(T4.data[ch] || {}).forEach(dt => {
    const r = T4.data[ch][dt];
    if (r._fileParts) delete r._fileParts[fileK];
    if (!t4HasInputs(r)) delete T4.data[ch][dt];
  });
}

function t4ResolveChannel(value) {
  const norm = x => String(x == null ? '' : x).toLowerCase().replace(/[\s\-_—（）()]/g, '');
  const aliases = { 京东自营店: 'jdzy', 京东pop: 'jdpop', 抖音达人: 'dycreator' };
  const raw = String(value == null ? '' : value).trim();
  if (aliases[raw]) return aliases[raw];
  const n = norm(raw);
  const hit = T4_CH.find(c => norm(c.n) === n || norm(c.id) === n);
  return hit ? hit.id : '';
}
const t4SummaryReady = imp => !!imp && T4_FILE_DEFS.summaryDaily.required.every(k => imp.map[k] != null)
  && T4_INPUT_KEYS.some(k => imp.map[k] != null);

S['t4-sumimp'] = () => {
  t4Load(); const imp = T4.imp && T4.imp.mode === 'summary' ? T4.imp : null;
  if (!imp) return head('汇总导入', '一个文件内按“归属事业部 + 渠道 + 日期”导入全部渠道；各渠道原有导入入口继续保留。', '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4act="sumTemplate">下载模板</button><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="sumPick">选择汇总文件</button>'))
    + card('汇总文件要求', table([{t:'字段'},{t:'要求'}], [
      ['渠道', `必填；支持：${T4_CH.map(c => c.n).join('、')}`],
      ['日期', '必填；只导入当前期间的数据'],
      ['损益科目', '至少映射一个；空白不覆盖，明确的 0 会导入'],
      ['归属事业部', '模板中提供用于核对；实际归属以系统渠道配置为准'],
    ]))
    + '<div class="note"><b>支持 .xlsx、.xls、.csv、.tsv。</b>同一份汇总文件重复导入不会重复累计，也不会删除各渠道专用文件导入的数据。</div>';
  const def = T4_FILE_DEFS.summaryDaily, hdr = imp.rows[imp.headRow] || [];
  const options = k => hdr.map((x, i) => `<option value="${i}" ${imp.map[k] === i ? 'selected' : ''}>${H(String(x || '(空)').slice(0,30))}</option>`).join('');
  return head(`汇总导入 · ${H(imp.fileName)}`, '确认渠道、日期及损益科目的列对应关系。', '工具箱 · T4', '<button class="btn" data-t4act="sumImpCancel">取消</button>')
    + `<div class="frow" style="margin-bottom:13px"><span class="fi">✓</span><span><span class="fn">${H(imp.fileName)}</span><br><span class="fm">${imp.rows.length} 行</span></span></div>`
    + cardp('表头行', `<select id="t4head">${imp.rows.slice(0,15).map((r,i) => `<option value="${i}" ${i===imp.headRow?'selected':''}>第 ${i+1} 行：${H(r.filter(Boolean).slice(0,6).join(' | ').slice(0,80))}</option>`).join('')}</select>`)
    + card('列对应', table([{t:'目标字段'},{t:'文件字段'}], def.fields.map(([k,n]) => [`${H(n)}${def.required.includes(k) ? ' <span class="red">*</span>' : ''}`, `<select data-t4map="${k}"><option value="">— 不使用 —</option>${options(k)}</select>`])))
    + `<div style="display:flex;justify-content:flex-end"><button class="btn pri" data-t4act="sumImpRun" ${t4SummaryReady(imp)?'':'disabled'}>导入全部渠道</button></div>`;
};

async function t4PickSummaryFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      const rows = await XLSXLite.readTable(file), def = T4_FILE_DEFS.summaryDaily;
      const headRow = t4FindHead(rows, def);
      T4.imp = { mode: 'summary', fileK: 'summaryDaily', fileName: file.name, rows, headRow, map: t4AutoMap(rows[headRow] || [], def) };
      t4Go('sumimp');
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
}

function t4SummaryImpRun() {
  const imp = T4.imp;
  if (!imp || imp.mode !== 'summary' || !t4SummaryReady(imp)) return;
  T4_CH.forEach(c => t4ClearSource(c.id, 'summaryDaily'));
  let used = 0, skipped = 0; const seen = new Set(), channels = new Set(), unknown = new Set();
  imp.rows.slice(imp.headRow + 1).forEach(row => {
    const get = k => imp.map[k] == null ? '' : row[imp.map[k]];
    const ch = t4ResolveChannel(get('channel')), dt = t4DateNorm(get('date'));
    if (!ch) { const name = String(get('channel') || '').trim(); if (name) unknown.add(name); skipped++; return; }
    if (!dt || !dt.startsWith(T4.period + '-')) { skipped++; return; }
    let wrote = false;
    T4_INPUT_KEYS.forEach(k => {
      if (imp.map[k] == null) return;
      const value = get(k);
      if (value == null || String(value).trim() === '') return;
      t4Add(ch, dt, k, t4Num(value), 'summaryDaily'); wrote = true;
    });
    if (!wrote) { skipped++; return; }
    seen.add(`${ch}:${dt}`); channels.add(ch); used++;
  });
  t4Save(); T4.imp = null; t4Go('overview');
  const bad = unknown.size ? `；未识别渠道：${[...unknown].slice(0,5).join('、')}` : '';
  toast(`汇总导入 ${channels.size} 个渠道、${seen.size} 个渠道日、${used} 行${skipped ? `，跳过 ${skipped} 行` : ''}${bad}`, 5200);
}

function t4SummaryTemplate() {
  const hdr = ['归属事业部','渠道','日期', ...T4_INPUTS.map(x => x.n)];
  const rows = T4_CH.map(c => [t4BuName(c.bu), c.n, t4Date(1), ...T4_INPUTS.map(() => '')]);
  download(`T4汇总导入模板_${T4.period}.csv`, toCSV([hdr, ...rows])); toast('已下载汇总导入模板');
}

function t4MgmtTemplate() {
  const hdr = ['归属事业部','渠道', ...T4_MGMT_FIELDS.map(([,n]) => n)];
  const rows = T4_CH.map(c => { const cfg = T4.cfg[c.id] || {};
    return [t4BuName(c.bu), c.n, ...T4_MGMT_FIELDS.map(([k]) => cfg[k] != null ? cfg[k] : '')]; });
  download(`T4管理费分摊模板_${T4.period}.csv`, toCSV([hdr, ...rows])); toast('已下载管理费分摊模板（当前值已预填）');
}

function t4MgmtApplyRows(rows) {
  // 去 BOM/零宽字符/所有空白后再比对，容忍 Excel、WPS 带入的不可见字符
  const clean = c => String(c == null ? '' : c).replace(/[﻿​\s]+/g, '');
  const names = T4_MGMT_FIELDS.map(([,n]) => n);
  let headRow = rows.findIndex(r => r.some(c => clean(c) === '渠道' || clean(c) === '渠道名称')
    && r.some(c => names.includes(clean(c))));
  let chCol, cols;
  if (headRow >= 0) {
    const hdr = rows[headRow].map(clean);
    chCol = hdr.indexOf('渠道'); if (chCol < 0) chCol = hdr.indexOf('渠道名称');
    cols = T4_MGMT_FIELDS.map(([k, n]) => [k, hdr.indexOf(n)]).filter(x => x[1] >= 0);
  } else {
    // 兜底：没有可识别的表头时，找到能认出渠道名的列，按模板列序取其右侧 6 列
    for (const r of rows) { const i = r.findIndex(c => t4ResolveChannel(c)); if (i >= 0) { chCol = i; break; } }
    if (chCol == null) {
      const first = (rows.find(r => r.some(c => String(c == null ? '' : c).trim())) || [])
        .map(c => String(c == null ? '' : c).trim()).filter(Boolean).join(' | ').slice(0, 80);
      throw new Error(`未找到表头行，也没认出任何渠道名。请保留模板的表头和渠道列。文件首行读到的是：「${first}」`);
    }
    headRow = -1;
    cols = T4_MGMT_FIELDS.map(([k], j) => [k, chCol + 1 + j]);
  }
  let set = 0; const channels = new Set(), unknown = new Set();
  rows.slice(headRow + 1).forEach(row => {
    const ch = t4ResolveChannel(row[chCol]);
    if (!ch) { const nm = String(row[chCol] == null ? '' : row[chCol]).trim(); if (nm && !['归属事业部','渠道','渠道名称'].includes(nm)) unknown.add(nm); return; }
    cols.forEach(([k, i]) => {
      const v = row[i];
      if (v == null || String(v).trim() === '' || String(v).trim() === '—') return; // 留空 = 不改动该格
      (T4.cfg[ch] = T4.cfg[ch] || {})[k] = t4Num(v); set++; channels.add(ch);
    });
  });
  return { set, channels: channels.size, unknown: [...unknown], fallback: headRow < 0 };
}

function t4MgmtPickFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      const r = t4MgmtApplyRows(await XLSXLite.readTable(file));
      t4SaveCfg(); t4Go('mgmt');
      const bad = r.unknown.length ? `；未识别渠道：${r.unknown.slice(0, 5).join('、')}` : '';
      toast(`分摊导入完成：${r.channels} 个渠道、${r.set} 个金额${r.fallback ? '（未见表头，已按模板列序取数，请核对）' : ''}${bad}`, 5200);
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
}

S['t4-imp'] = () => {
  t4Load(); const c = T4_CHM[T4.editCh], imp = T4.imp;
  if (!c.files.length) return head(`导入　${c.n}`, '该渠道没有标准源文件，请人工录入。', '工具箱 · T4', '<button class="btn" data-t4go="overview">← 返回</button>')
    + '<div class="note w">本渠道当前采用人工录入；录入值和文件导入值使用同一套损益计算。</div>';
  if (!imp) return head(`导入　${c.n}`, '选择源文件；同一种文件再次导入会替换上次结果，不会重复累计。', '工具箱 · T4', t4PeriodControl('<button class="btn" data-t4go="overview">← 返回</button>'))
    + card('源文件', table([{t:'文件'},{t:'取数口径'},{t:''}], c.files.map(f => [`<b>${H(f.n)}</b>`, H(f.hint), `<button class="btn sm" data-t4file="${f.k}">选择文件</button>`])))
    + '<div class="note"><b>支持 .xlsx、.xls、.csv、.tsv。</b>旧版天猫导出文件无需再另存格式。</div>';
  const def = T4_FILE_DEFS[imp.fileK], hdr = imp.rows[imp.headRow] || [];
  const options = k => hdr.map((x, i) => `<option value="${i}" ${imp.map[k] === i ? 'selected' : ''}>${H(String(x || '(空)').slice(0,30))}</option>`).join('');
  const ready = def.required.every(k => imp.map[k] != null)
    && (imp.fileK !== 'daily' || T4_INPUT_KEYS.some(k => imp.map[k] != null));
  return head(`导入　${c.n} · ${H(imp.fileN)}`, '请确认表头和字段映射。', '工具箱 · T4', '<button class="btn" data-t4act="impCancel">取消</button>')
    + `<div class="frow" style="margin-bottom:13px"><span class="fi">✓</span><span><span class="fn">${H(imp.fileName)}</span><br><span class="fm">${imp.rows.length} 行</span></span></div>`
    + cardp('表头行', `<select id="t4head">${imp.rows.slice(0,15).map((r,i) => `<option value="${i}" ${i===imp.headRow?'selected':''}>第 ${i+1} 行：${H(r.filter(Boolean).slice(0,5).join(' | ').slice(0,70))}</option>`).join('')}</select>`)
    + card('列对应', table([{t:'目标字段'},{t:'文件字段'}], def.fields.map(([k,n]) => [`${H(n)}${def.required.includes(k) ? ' <span class="red">*</span>' : ''}`, `<select data-t4map="${k}"><option value="">— 不使用 —</option>${options(k)}</select>`])))
    + `<div style="display:flex;justify-content:flex-end"><button class="btn pri" data-t4act="impRun" ${ready?'':'disabled'}>执行导入</button></div>`;
};

async function t4PickFile(fileK) {
  const c = T4_CHM[T4.editCh], f = c.files.find(x => x.k === fileK);
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      const rows = await XLSXLite.readTable(file), def = T4_FILE_DEFS[fileK];
      const headRow = t4FindHead(rows, def);
      T4.imp = { mode: 'channel', fileK, fileN: f.n, fileName: file.name, rows, headRow, map: t4AutoMap(rows[headRow] || [], def) };
      t4Go('imp');
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
}

function t4ImpRun() {
  const imp = T4.imp, ch = T4.editCh, def = imp && T4_FILE_DEFS[imp.fileK];
  if (!imp || !def || !def.required.every(k => imp.map[k] != null)
    || (imp.fileK === 'daily' && !T4_INPUT_KEYS.some(k => imp.map[k] != null))) return;
  t4ClearSource(ch, imp.fileK);
  let used = 0, skipped = 0; const seen = new Set();
  imp.rows.slice(imp.headRow + 1).forEach(row => {
    const get = k => imp.map[k] == null ? '' : row[imp.map[k]];
    const dt = t4DateNorm(get('date'));
    if (!dt || !dt.startsWith(T4.period + '-')) { skipped++; return; }
    if (imp.fileK === 'daily') {
      let wrote = false;
      T4_INPUT_KEYS.forEach(k => {
        if (imp.map[k] == null) return;
        const value = get(k);
        if (value == null || String(value).trim() === '') return;
        t4Add(ch, dt, k, t4Num(value), imp.fileK); wrote = true;
      });
      if (!wrote) { skipped++; return; }
    } else if (imp.fileK === 'sales') {
      if (String(get('channel')).trim() !== t4ChannelName(ch)) { skipped++; return; }
      const typ = String(get('type')).trim(), amount = t4Num(get('amount')), cost = t4Num(get('cost')), postage = t4Num(get('postage'));
      if (/售后发货/.test(typ)) { t4Add(ch, dt, 'aftersales', Math.abs(cost) + Math.abs(postage), imp.fileK); }
      else if (/退货/.test(typ)) {
        t4Add(ch, dt, 'returnAmount', amount > 0 ? -amount : amount, imp.fileK);
        t4Add(ch, dt, 'returnCost', cost > 0 ? -cost : cost, imp.fileK);
      } else {
        t4Add(ch, dt, 'retailIncome', amount, imp.fileK); t4Add(ch, dt, 'retailCost', Math.abs(cost), imp.fileK);
      }
      if (imp.map.research != null) t4Add(ch, dt, 'research', Math.abs(t4Num(get('research'))), imp.fileK);
    } else if (imp.fileK === 'ztc') {
      const direction = String(get('direction')), typ = String(get('type'));
      if ((direction && !/支出/.test(direction)) || /充值/.test(typ)) { skipped++; return; }
      t4Add(ch, dt, 'ztc', Math.abs(t4Num(get('amount'))), imp.fileK);
    } else if (imp.fileK === 'cps') t4Add(ch, dt, 'cps', Math.abs(t4Num(get('amount'))), imp.fileK);
    else if (imp.fileK === 'jzt') t4Add(ch, dt, 'promotion', Math.abs(t4Num(get('amount'))), imp.fileK);
    else if (imp.fileK === 'jdIncome') t4Add(ch, dt, 'retailIncome', t4Num(get('amount')), imp.fileK);
    seen.add(dt); used++;
  });
  t4Save(); T4.imp = null; t4Go('overview');
  toast(`已导入 ${seen.size} 天、${used} 行${skipped ? `，跳过 ${skipped} 行` : ''}`, 4200);
}

S['t4-sheet'] = () => {
  t4Load();
  const vd = t4ViewDate();
  const okOf = ids => vd ? t4DayOK(ids, vd) : t4SumOK(ids);
  const grpOf = ids => vd ? t4GroupDay(ids, vd) : t4Group(ids);
  const tmOK = okOf(T4_TMAI), ecomOK = okOf(T4_BIG_ECOM), pddOK = okOf(T4_PDD), rmOK = okOf(T4_RUIMIAN), dealerOK = okOf(T4_DEALER), allOK = okOf(T4_ALL);
  const months = T4_CH.map(c => vd ? t4DayData(c.id, vd) : t4Month(c.id)), tm = grpOf(T4_TMAI), ecom = grpOf(T4_BIG_ECOM), pdd = grpOf(T4_PDD), rm = grpOf(T4_RUIMIAN), dealer = grpOf(T4_DEALER), all = grpOf(T4_ALL);
  const headers = [{t:'损益项目'}, ...T4_CH.map(c => ({t:c.n,n:1})), {t:'特卖汇总',n:1}, {t:'大电商事业部',n:1}, {t:'拼多多事业部',n:1}, {t:'瑞眠事业部',n:1}, {t:'经销事业部',n:1}, {t:'全部汇总',n:1}];
  const rows = T4_METRICS.map(metric => {
    const vals = months.map(m => t4Fmt(m[metric.k], metric.pct));
    const groupVals = [tmOK ? t4Fmt(tm[metric.k], metric.pct) : '—', ecomOK ? t4Fmt(ecom[metric.k], metric.pct) : '—',
      pddOK ? t4Fmt(pdd[metric.k], metric.pct) : '—', rmOK ? t4Fmt(rm[metric.k], metric.pct) : '—', dealerOK ? t4Fmt(dealer[metric.k], metric.pct) : '—', allOK ? t4Fmt(all[metric.k], metric.pct) : '—'];
    const name = metric.lvl ? `<span class="mut">${H(metric.n)}</span>` : `<b>${H(metric.n)}</b>`;
    return [name, ...vals, ...groupVals];
  });
  const disabled = [['特卖',tmOK],['大电商事业部',ecomOK],['拼多多事业部',pddOK],['瑞眠事业部',rmOK],['经销事业部',dealerOK],['全部',allOK]].filter(x => !x[1]).map(x => x[0]);
  return head('渠道事业部日损益表', vd ? `${vd} 单日损益；渠道分别归集到大电商、拼多多、瑞眠和经销事业部。清空日期返回整月累计。` : '渠道月累计后，分别归集到大电商、拼多多、瑞眠和经销事业部；特卖汇总作为大电商事业部的子组保留。', '工具箱 · T4',
    t4PeriodControl(`<label class="sel">日期 <input id="t4ViewDate" data-view="sheet" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${vd}" title="选具体日期看单日损益，清空回整月累计" style="width:132px"></label><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="export">导出 CSV</button>`))
    + (disabled.length ? `<div class="note c"><b>以下汇总暂不可用：</b>${disabled.join('、')}。${vd ? '单日汇总要求组内全部渠道当日均有收入数据' : '各事业部按内部渠道取数天数分别校验'}，渠道列仍可核对。</div>` : '')
    + card(vd ? `${vd} 单日损益` : '月累计损益', table(headers, rows))
    + `<div class="note c"><b>红线口径：</b>京东自营零售成本、退货金额和退货成本仍来自底稿设定比例，不是平台原始数据；所有比例与月度分摊可在「参数」中审阅和修改。</div>`;
};

S['t4-cfg'] = () => {
  t4Load();
  const blocks = T4_CH.map(c => {
    const cfg = T4.cfg[c.id], rows = T4_CFG_FIELDS.filter(([k]) => cfg[k] != null).map(([k,n,t]) => [H(n),
      `<input type="number" step="0.0001" data-t4cfg="${c.id}:${k}" value="${t === 'rate' ? cfg[k] * 100 : cfg[k]}">`, t === 'rate' ? '%' : '元']);
    return card(c.n, rows.length ? table([{t:'参数'},{t:'值',n:1},{t:'单位'}], rows)
      : '<div class="mut" style="padding:14px">暂无底稿参数，损益科目以人工录入为准。</div>');
  }).join('');
  return head('T4 参数', '比例基于每日零售收入；月度金额按当月自然日平均分摊。参数均来自 2026-08 日损益底稿。', '工具箱 · T4',
    `<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="cfgReset">恢复底稿值</button><button class="btn pri" data-t4act="cfgSave">保存参数</button>`)
    + '<div class="note w"><b>修改会影响所有对应日期的派生结果。</b>人工录入的同名科目优先于参数值。</div>' + blocks;
};

S['t4-mgmt'] = () => {
  t4Load();
  const days = t4Days();
  const rows = T4_CH.map(c => {
    const cfg = T4.cfg[c.id] || {};
    const cells = T4_MGMT_FIELDS.map(([k]) =>
      `<input type="number" step="0.01" data-t4mgmt="${c.id}:${k}" data-t4orig="${cfg[k] != null ? cfg[k] : ''}" value="${cfg[k] != null ? cfg[k] : ''}" placeholder="—" style="width:104px">`);
    const total = T4_MGMT_FIELDS.reduce((n, [k]) => n + (+cfg[k] || 0), 0);
    return [t4BuPill(c.bu), `<b>${H(c.n)}</b>`, ...cells,
      `<b class="mono">${money(total)}</b>`, `<span class="mono">${money(total / days)}</span>`];
  });
  return head('T4 管理费用分摊', `按项目录入各渠道当月分摊金额，系统平均分摊到每一天（月度金额 ÷ 当月自然日，本期 ${days} 天）。留空表示该渠道该项目不分摊。`, '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="mgmtTemplate">下载模板</button><button class="btn" data-t4act="mgmtPick">导入分摊</button><button class="btn pri" data-t4act="mgmtSave">保存分摊</button>'))
    + card('月度分摊金额（元/月）', table(
      [{t:'归属事业部'},{t:'渠道'}, ...T4_MGMT_FIELDS.map(([,n]) => ({t:n,n:1})), {t:'月合计',n:1},{t:'折算每日',n:1}], rows))
    + '<div class="note"><b>口径：</b>直接管理费用 = 直接人工 + 直接租金物业 + 直接其他管理；间接管理费用 = 人力公摊 + 房租水电公摊 + 其他公摊。每日分摊额 = 月度金额 ÷ 当月自然日；某天人工或文件实填的同名科目优先于分摊值。修改立即影响本期全部日期的派生结果与汇总。</div>';
};

S['t4-rules'] = () => head('T4 取数口径', '以下规则来自用户提供的销售明细、平台推广明细和 2026-08 日损益底稿。', '工具箱 · T4', '<button class="btn" data-t4go="overview">← 返回</button>')
  + card('文件取数', table([{t:'渠道/文件'},{t:'落表规则'},{t:'控制'}], [
    ['汇总导入', '一个文件按渠道 + 日期导入全部渠道；归属事业部由系统配置确定', pill('批量导入','ok')],
    ['全部渠道 · 标准日损益明细', '按日期映射完整损益科目；至少选择一个金额字段', pill('通用导入','ok')],
    ['销售单明细账', '按发货时间；普通/代销售计零售收入与成本，售后退货计负数，售后发货成本及邮资计售后费用', pill('渠道精确匹配','in')],
    ['天猫直通车', '按记账时间；只取支出/扣款，排除充值', pill('符号取绝对值','wa')],
    ['天猫 CPS', '按日期取支出金额', pill('直取','ok')],
    ['京东自营收入', '按日期取成交金额，保留零金额日', pill('直取','ok')],
    ['京准通', '按投放日期取支出，负数转正费用', pill('符号处理','wa')],
  ]))
  + card('底稿设定', table([{t:'渠道'},{t:'项目'},{t:'规则'}], [
    ['京东自营','零售成本','零售收入 × 45%'], ['京东自营','退货金额','零售收入 × -16%'], ['京东自营','退货成本','零售成本 × -16%'],
    ['天猫','平台/售后/物流/仓储/税费','按收入比例计算，比例见参数页'], ['各渠道','管理费用','月度设定值 ÷ 当月自然日'],
  ]))
  + '<div class="note"><b>重复导入是幂等的：</b>每次先清除该文件类型上次写入的字段，再写入本次结果；不同来源不会互相覆盖。</div>';

function t4Export() {
  const hdr = ['期间','渠道','归属事业部','日期', ...T4_METRICS.map(x => x.n.trim()), '取数口径','来源'];
  const rows = [];
  T4_CH.forEach(c => {
    const md = t4MgmtDaily(c.id);
    for (let d = 1; d <= t4Days(); d++) {
      const dt = t4Date(d), r = t4Row(c.id, dt);
      if (r) {
        rows.push([T4.period,c.n,t4BuName(c.bu),dt, ...T4_METRICS.map(x => x.pct ? `${(r[x.k]*100).toFixed(2)}%` : (r[x.k] || 0).toFixed(2)),
          r._hard.length ? `参数/硬推:${r._hard.join('/')}` : '实填', r._src === 'file' ? '文件' : '人工']);
      } else if (md.any) {
        // 无收入数据日：只计提管理费分摊
        const e = Object.fromEntries(T4_METRICS.map(x => [x.k, 0]));
        ['directLabor','directRent','directOther','sharedLabor','sharedRent','sharedOther','direct','indirect'].forEach(k => { e[k] = md[k]; });
        e.contribution = -md.direct; e.netProfit = -(md.direct + md.indirect);
        rows.push([T4.period,c.n,t4BuName(c.bu),dt, ...T4_METRICS.map(x => x.pct ? '0.00%' : (e[x.k] || 0).toFixed(2)), '管理费分摊（无收入数据日）','分摊']);
      }
    }
  });
  rows.push([]);
  [
    ['特卖汇总','大电商事业部',T4_TMAI], ['大电商事业部汇总','大电商事业部',T4_BIG_ECOM],
    ['拼多多事业部汇总','拼多多事业部',T4_PDD],
    ['瑞眠事业部汇总','瑞眠事业部',T4_RUIMIAN],
    ['经销事业部汇总','经销事业部',T4_DEALER], ['全部汇总','全部',T4_ALL],
  ].forEach(([n,bu,ids]) => {
    const ok = t4SumOK(ids), m = ok ? t4Group(ids) : null;
    rows.push([T4.period,n,bu,ok ? '' : `禁用：渠道取数天数极差 ${t4Gap(ids).gap} 天`,
      ...(ok ? T4_METRICS.map(x => x.pct ? `${(m[x.k]*100).toFixed(2)}%` : (m[x.k] || 0).toFixed(2)) : [])]);
  });
  download(`渠道事业部日损益表_${T4.period}.csv`, toCSV([hdr, ...rows])); toast('已导出日损益明细');
}

function t4Go(v) { go(v === 'overview' ? 't4' : `t4-${v}`); }

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-t4go]');
  if (nav) { const [v,ch] = nav.dataset.t4go.split(':'); if (ch) T4.editCh = ch; if (v === 'imp' || v === 'sumimp') T4.imp = null; t4Go(v); return; }
  const file = e.target.closest('[data-t4file]'); if (file) { t4PickFile(file.dataset.t4file); return; }
  const a = e.target.closest('[data-t4act]'); if (!a) return;
  if (a.dataset.t4act === 'saveMan') {
    let changed = 0;
    document.querySelectorAll('[data-t4cell]').forEach(inp => {
      const [dt,k] = inp.dataset.t4cell.split(':'), val = inp.value.trim();
      if (val === String(inp.dataset.t4orig == null ? '' : inp.dataset.t4orig)) return;
      const raw = T4.data[T4.editCh][dt] || { _src: 'manual', _fileParts: {} };
      if (val === '') delete raw[k]; else { raw[k] = Number(val) || 0; raw._src = 'manual'; }
      changed++;
      if (t4HasInputs(raw)) T4.data[T4.editCh][dt] = raw; else delete T4.data[T4.editCh][dt];
    });
    t4Save(); toast(`已保存 ${changed} 个变更`); t4Go('overview');
  } else if (a.dataset.t4act === 'sumManSave') {
    let changed = 0; const dt = T4.sumDate;
    document.querySelectorAll('[data-t4sumcell]').forEach(inp => {
      const [ch,k] = inp.dataset.t4sumcell.split(':'), val = inp.value.trim();
      if (val === String(inp.dataset.t4orig == null ? '' : inp.dataset.t4orig)) return;
      const raw = T4.data[ch][dt] || { _src: 'manual', _fileParts: {} };
      if (val === '') delete raw[k]; else { raw[k] = Number(val) || 0; raw._src = 'manual'; }
      changed++;
      if (t4HasInputs(raw)) T4.data[ch][dt] = raw; else delete T4.data[ch][dt];
    });
    t4Save(); toast(`已保存全部渠道，共 ${changed} 个变更`); t4Go('overview');
  } else if (a.dataset.t4act === 'impCancel') { T4.imp = null; t4Go('imp'); }
  else if (a.dataset.t4act === 'impRun') t4ImpRun();
  else if (a.dataset.t4act === 'sumPick') t4PickSummaryFile();
  else if (a.dataset.t4act === 'sumTemplate') t4SummaryTemplate();
  else if (a.dataset.t4act === 'sumImpCancel') { T4.imp = null; t4Go('sumimp'); }
  else if (a.dataset.t4act === 'sumImpRun') t4SummaryImpRun();
  else if (a.dataset.t4act === 'export') t4Export();
  else if (a.dataset.t4act === 'cfgSave') {
    document.querySelectorAll('[data-t4cfg]').forEach(inp => { const [ch,k] = inp.dataset.t4cfg.split(':'); const meta = T4_CFG_FIELDS.find(x => x[0] === k); T4.cfg[ch][k] = (Number(inp.value) || 0) / (meta && meta[2] === 'rate' ? 100 : 1); });
    t4SaveCfg(); toast('参数已保存'); t4Go('overview');
  } else if (a.dataset.t4act === 'cfgReset') { T4.cfg = t4Clone(T4_CFG_DEFAULT); t4SaveCfg(); toast('已恢复底稿参数'); t4Go('cfg'); }
  else if (a.dataset.t4act === 'mgmtSave') {
    let changed = 0;
    document.querySelectorAll('[data-t4mgmt]').forEach(inp => {
      const [ch,k] = inp.dataset.t4mgmt.split(':'), val = inp.value.trim();
      if (val === String(inp.dataset.t4orig == null ? '' : inp.dataset.t4orig)) return;
      if (val === '') delete T4.cfg[ch][k]; else T4.cfg[ch][k] = Number(val) || 0;
      changed++;
    });
    t4SaveCfg(); toast(`已保存管理费分摊，共 ${changed} 个变更`); t4Go('overview');
  }
  else if (a.dataset.t4act === 'mgmtTemplate') t4MgmtTemplate();
  else if (a.dataset.t4act === 'mgmtPick') t4MgmtPickFile();
});
document.addEventListener('change', e => {
  if (e.target.id === 't4Period') { T4.period = e.target.value || T4.period; T4.imp = null; T4.viewDate = ''; t4Go('overview'); }
  else if (e.target.id === 't4ViewDate') { T4.viewDate = e.target.value || ''; t4Go(e.target.dataset.view === 'sheet' ? 'sheet' : 'overview'); }
  else if (e.target.id === 't4chSel') { T4.editCh = e.target.value; t4Go('man'); }
  else if (e.target.id === 't4SumDate') { T4.sumDate = e.target.value || t4Date(1); t4Go('summan'); }
  else if (e.target.id === 't4head' && T4.imp) { T4.imp.headRow = +e.target.value; T4.imp.map = t4AutoMap(T4.imp.rows[T4.imp.headRow] || [], T4_FILE_DEFS[T4.imp.fileK]); t4Go(T4.imp.mode === 'summary' ? 'sumimp' : 'imp'); }
  else if (e.target.dataset && e.target.dataset.t4map && T4.imp) { const k = e.target.dataset.t4map; if (e.target.value === '') delete T4.imp.map[k]; else T4.imp.map[k] = +e.target.value; t4Go(T4.imp.mode === 'summary' ? 'sumimp' : 'imp'); }
});
