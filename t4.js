/* T4 日损益表
   依据澳乐事业部 2026-08 日损益底稿重构：渠道明细 → 子组 → 大电商/拼多多/经销事业部 → 全部汇总。
   原始值、比例/按月分摊值与硬推值分开保存，汇总一律由工具重算。 */
'use strict';

const T4_GAP_LIMIT = 2;
const T4_KEY = 'fsc_t4_data_v2';
const T4_CFG_KEY = 'fsc_t4_cfg_v1';
const T4_DAILY_FILE = { k: 'daily', n: '标准日损益明细', hint: '按日期映射收入、成本、费用和管理费用等完整科目' };

const T4_CH_BASE = [
  { id: 'tmall', n: '天猫-澳乐旗舰店', bu: 'ecom', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「天猫-澳乐旗舰店」；按发货时间归属' },
    { k: 'ztc', n: '天猫直通车', hint: '按记账时间；仅取支出/扣款，排除充值' },
    { k: 'cps', n: '天猫 CPS', hint: '按日期取支出金额' },
  ] },
  { id: 'jdzy', n: '京东-澳乐京东自营', bu: 'ecom', tier: '特卖', files: [
    T4_DAILY_FILE,
    { k: 'jdIncome', n: '京东自营收入交易概况', hint: '日期 → 当日成交金额；零金额日也保留' },
    { k: 'jzt', n: '京准通推广费', hint: '投放日期 → 支出绝对值' },
  ] },
  { id: 'jdpop', n: '京东POP', bu: 'ecom', tier: '特卖', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取堂品/新堂品两家京东澳乐旗舰店' },
  ] },
  { id: 'jd_aole', n: '京东-澳乐官方旗舰店', bu: 'ecom', tier: '特卖', files: [
    T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「京东-澳乐官方旗舰店」' },
  ] },
  { id: 'vip', n: '唯品会-澳乐唯品会MP', bu: 'ecom', tier: '特卖', files: [T4_DAILY_FILE] },
  { id: 'vip3pl', n: '唯品会-澳乐唯品会3PL', bu: 'ecom', tier: '特卖', files: [T4_DAILY_FILE] },
  { id: 'ks', n: '快手', bu: 'ecom', tier: '直属', files: [
    T4_DAILY_FILE,
    { k: 'sales', n: '销售单明细账', hint: '仅取「快手-澳乐母婴品牌店」' },
  ] },
  { id: 'priv', n: '有赞-澳乐乐姐心选', bu: 'ecom', tier: '直属', files: [T4_DAILY_FILE] },
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
  { id: 'jd_zzzrest', n: '京东-zzzrest官方旗舰店', bu: 'ruimian', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「京东-zzzrest官方旗舰店」' }] },
  { id: 'dy_zzzrest', n: '抖音-zzzrest旗舰店', bu: 'ruimian', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「抖音-zzzrest旗舰店」' }] },
  { id: 'xhs_zzzrest', n: '小红书-zzzrest旗舰店', bu: 'ruimian', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「小红书-zzzrest旗舰店」' }] },
  { id: 'tm_orange', n: '天猫-橘农旗舰店', bu: 'ecom', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「天猫-橘农滋补养生旗舰店」' }] },
  { id: 'tb_orange', n: '淘宝-橘农滋补企业店', bu: 'ecom', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「淘宝-橘农滋补企业店」' }] },
  { id: 'jd_orange', n: '京东-橘农旗舰店', bu: 'ecom', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「京东-橘农旗舰店」' }] },
  { id: 'tianmen', n: '分销-微商-天门（1688）', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'gift', n: '分销-澳乐礼品单', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'supply', n: '电商供货', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'groupbuy', n: '分销-团购-零售', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'dycreator', n: '抖音-BD达人成交店', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
];

/* 财务提供的渠道列表（2026-09-15）：吉客云销售渠道 → T4 汇总渠道。 */
const T4_SOURCE_CHANNEL_MAP = {
  '京东-澳乐旗舰店（新堂品）': 'jdpop',
  '快手-澳乐玩具': 'ks',
  '分销-团购-零售': 'groupbuy',
  '分销-礼品启尚': 'gift',
  '京东-zzzrest官方旗舰店': 'jd_zzzrest',
  '抖音-zzzrest旗舰店': 'dy_zzzrest',
  '小红书-zzzrest旗舰店': 'xhs_zzzrest',
  '分销-礼品盛夏光年': 'gift',
  '天猫-zzzrest旗舰店': 'tm_zzzrest',
  '分销-抖音BBG赠品仓': 'dycreator',
  '分销-抖音麦得多赠品仓': 'dycreator',
  '分销-抖音象迪咪赠品仓': 'dycreator',
  '分销-抖音卷发暖暖妈妈赠品仓': 'dycreator',
  '分销-上海元许礼品分销店': 'gift',
  '分销-国虹礼品分销店': 'gift',
  '分销-抖音多赞平台': 'dycreator',
  '分销-上海安皇礼品分销店': 'gift',
  '分销-佛山晋佳礼品分销店': 'gift',
  '分销-抖音深圳萌鹿赠品仓': 'dycreator',
  '分销-壹叁壹玖礼品分销店': 'gift',
  '分销-哆啦哈蕾礼品分销店': 'gift',
  '分销-宛初礼品分销店': 'gift',
  '分销-卓瑞艺零售分销店': 'gift',
  '分销-鑫津羽礼品分销店': 'gift',
  '分销-抖音miko赠品仓': 'dycreator',
  '义乌市忆泰包装有限公司': 'gift',
  '分销-抖音江苏半夏赠品仓': 'dycreator',
  '分销-上海嘉叠贸易有限公司': 'gift',
  '分销-第一天空礼品分销店': 'gift',
  '分销-抖音博杨赠品仓': 'dycreator',
  '快手-澳乐母婴品牌店': 'ks',
  '分销-碧芭山海经': 'gift',
  '分销-抖音么么橙赠品仓': 'dycreator',
  '京东-澳乐旗舰店（堂品）': 'jdpop',
  '分销-豪悦': 'supply',
  '分销-抖音亲抚赠品仓': 'dycreator',
  '分销-抖音南昌海控赠品仓': 'dycreator',
  '分销-瑞雪礼品分销店': 'gift',
  '分销-抖音BIBI赠品仓': 'dycreator',
  '快手-澳乐母婴专卖店': 'ks',
  '分销-欧贝比礼品分销店': 'gift',
  '天猫-橘农滋补养生旗舰店': 'tm_orange',
  '淘宝-橘农滋补企业店': 'tb_orange',
  '抖音-澳乐官方旗舰店': 'dycreator',
  '快手-澳乐母婴官方旗舰店': 'ks',
  '京东-橘农旗舰店': 'jd_orange',
  '分销-巧巧手玩具': 'groupbuy',
  '抖音-橘农滋补旗舰店': 'dycreator',
  '拼多多-澳乐母婴旗舰店': 'pdd_mom',
  '拼多多-澳乐旗舰店': 'pdd_aole',
  '小红书-澳乐旗舰店': 'tmall',
  '抖音-我爱我宝（妈咪生活馆）手工专用': 'dycreator',
  '分销-大团主': 'groupbuy',
  '京东-手工单专用（自营）': 'jdzy',
  '唯品会-手工单专用': 'vip',
  '抖音-我爱我宝（妈咪生活馆）': 'dycreator',
  '抖音-澳乐旗舰店手工专用': 'dycreator',
  '拼多多-澳乐母婴玩具旗舰店': 'pdd_toy',
  '分销-团购-快团团': 'groupbuy',
  '快手-澳乐旗舰店': 'ks',
  '分销-微商-天门聚水潭': 'tianmen',
  '分销- 澳乐抖音- 乐乐妈咪好物分享': 'dycreator',
  '抖音-BD达人成交店': 'dycreator',
  '分销-澳乐自营（天猫供销）': 'supply',
  '分销-澳乐自营（零售）': 'supply',
  '分销-澳乐礼品单': 'gift',
  '分销-澳乐自营（1688）': 'supply',
  '分销-微商-天门（1688）': 'tianmen',
  '唯品会-澳乐唯品会3PL': 'vip3pl',
  '天猫-澳乐旗舰店': 'tmall',
  '有赞-澳乐乐姐心选': 'priv',
  '分销代运营-澳乐苏宁自营旗舰店（玩具类）': 'supply',
  '抖音-澳乐旗舰店': 'dycreator',
  '唯品会-澳乐唯品会MP': 'vip',
  '京东-澳乐官方旗舰店': 'jd_aole',
  '京东-澳乐京东自营': 'jdzy',
};
const T4_SOURCE_CHANNEL_NORM = Object.fromEntries(Object.entries(T4_SOURCE_CHANNEL_MAP)
  .map(([name, id]) => [name.toLowerCase().replace(/[\s\-_—（）()]/g, ''), id]));
/* 渠道表 = 内置基础表 + localStorage 覆盖层（渠道列表页可导入模板批量改名/调事业部/新增） */
const T4_CHLIST_KEY = 'fsc_t4_channels_v2';
let T4_CH = [], T4_CHM = {}, T4_TMAI = [], T4_BIG_ECOM = [], T4_PDD = [], T4_RUIMIAN = [], T4_DEALER = [], T4_ALL = [];
function t4ChOverrides() { try { const v = JSON.parse(localStorage.getItem(T4_CHLIST_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function t4SaveChOverrides(list) { localStorage.setItem(T4_CHLIST_KEY, JSON.stringify(list)); }
function t4RebuildChannels() {
  const base = T4_CH_BASE.map(c => ({ ...c }));
  t4ChOverrides().forEach(o => {
    const hit = base.find(c => c.id === o.id);
    if (hit) {
      if (o.n && o.n !== hit.n) { hit.aliases = (hit.aliases || []).concat(hit.n); hit.n = o.n; }
      if (o.bu) hit.bu = o.bu;
      if (o.aliases) hit.aliases = (hit.aliases || []).concat(o.aliases);
    } else if (o.n) {
      base.push({ id: o.id, n: o.n, bu: o.bu || 'dealer', tier: '直属', files: [T4_DAILY_FILE], aliases: o.aliases || [], custom: true });
    }
  });
  T4_CH = base;
  T4_CHM = Object.fromEntries(T4_CH.map(c => [c.id, c]));
  T4_TMAI = T4_CH.filter(c => c.tier === '特卖').map(c => c.id);
  T4_BIG_ECOM = T4_CH.filter(c => c.bu === 'ecom').map(c => c.id);
  T4_PDD = T4_CH.filter(c => c.bu === 'pdd').map(c => c.id);
  T4_RUIMIAN = T4_CH.filter(c => c.bu === 'ruimian').map(c => c.id);
  T4_DEALER = T4_CH.filter(c => c.bu === 'dealer').map(c => c.id);
  T4_ALL = T4_CH.map(c => c.id);
}
t4RebuildChannels();
const T4_BU_META = {
  ecom: { n: '大电商事业部', short: '大电商', pill: 'in' },
  pdd: { n: '拼多多事业部', short: '拼多多', pill: 'ok' },
  ruimian: { n: '瑞眠事业部', short: '瑞眠', pill: 'mu' },
  dealer: { n: '经销事业部', short: '经销', pill: 'wa' },
};
const t4BuName = id => (T4_BU_META[id] || {}).n || id;
// 项目层：瑞眠事业部归瑞眠项目，其余（大电商/拼多多/经销）归澳乐项目
const t4Project = bu => bu === 'ruimian' ? '瑞眠项目' : '澳乐项目';
const t4ProjectPill = bu => bu === 'ruimian' ? pill('瑞眠项目', 'mu') : pill('澳乐项目', 'in');
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

/* 管理费 6 项月摊不再内置底稿默认值——统一在「管理费分摊」页由用户录入/导入维护 */
const T4_CFG_DEFAULT = {
  tmall: { platformFeeRate: .05, platformOtherRate: .033, aftersalesRate: .009, logisticsRate: .08, warehouseRate: .02, taxRate: .01 },
  jdzy: { retailCostRate: .45, returnRate: -.16, returnCostRate: -.16, platformFeeRate: .30, taxRate: .04, logisticsMonth: 5000 },
  jdpop: { platformFeeRate: .063, logisticsRate: .10, taxRate: .018 },
  vip: {},
  vip3pl: {},
  ks: {},
  priv: {},
  pdd_aole: {},
  pdd_toy: {},
  pdd_mom: {},
  tianmen: {},
  gift: {},
  supply: {},
  groupbuy: {},
  dycreator: {},
  tm_zzzrest: {},
  jd_aole: {},
  jd_zzzrest: {},
  dy_zzzrest: {},
  xhs_zzzrest: {},
  tm_orange: {},
  tb_orange: {},
  jd_orange: {},
};

const T4_CFG_FIELDS = [
  ['retailCostRate', '零售成本率', 'rate'], ['returnRate', '退货率', 'rate'], ['returnCostRate', '退货成本率', 'rate'],
  ['platformFeeRate', '平台扣点率', 'rate'], ['platformOtherRate', '平台其他率', 'rate'],
  ['aftersalesRate', '售后费用率', 'rate'], ['logisticsRate', '快递物流率', 'rate'],
  ['warehouseRate', '仓储费率', 'rate'], ['taxRate', '税率', 'rate'],
  ['logisticsMonth', '快递物流/月', 'money'],
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
    ['date', '记账时间', ['记账时间', '交易日期']], ['amount', '操作金额(元)', ['操作金额', '金额']],
    ['direction', '收支类型', ['收支类型']], ['type', '交易类型', ['交易类型']],
  ], required: ['date', 'amount'] },
  cps: { fields: [['date', '日期', ['日期']], ['amount', '支出金额', ['支出金额', '金额']]], required: ['date', 'amount'] },
  jdIncome: { fields: [['date', '日期', ['日期']], ['amount', '成交金额', ['成交金额']]], required: ['date', 'amount'] },
  jzt: { fields: [['date', '投放日期', ['投放日期', '日期']], ['amount', '支出', ['支出', '金额']]], required: ['date', 'amount'] },
};
T4_FILE_DEFS.summaryDaily = {
  fields: [
    ['bu', '归属事业部', ['归属事业部', '事业部']],
    ['channel', '渠道', ['渠道', '渠道名称', '店铺', '销售渠道']],
    ['type', '订单类型', ['订单类型', '业务类型']],
    // 吉客云明细列名：发货时间→日期、分摊后金额→销售收入、货品成本→销售成本
    ...T4_FILE_DEFS.daily.fields.map(f =>
      f[0] === 'date' ? ['date', '日期', ['日期', '发货时间']]
      : f[0] === 'retailIncome' ? ['retailIncome', '零售收入', ['零售收入', '分摊后金额']]
      : f[0] === 'retailCost' ? ['retailCost', '零售成本', ['零售成本', '货品成本']] : f),
  ],
  required: ['channel', 'date'],
};

const T4 = { period: new Date().toISOString().slice(0, 7), data: {}, cfg: {}, editCh: 'tmall', imp: null, sumDate: '', sumScope: 'income', viewFrom: '', viewTo: '', mgmtFrom: '', mgmtTo: '', sheetMode: 'tree', treeCollapsed: {}, projFilter: 'all', dayCh: 'tmall',
  mail: { list: [], status: null, loaded: false, loading: false, result: null, subject: '', body: '' } };

// 项目筛选：全部 / 澳乐（大电商+拼多多+经销）/ 瑞眠
const T4_PROJ_OPTS = [['all', '全部项目'], ['aole', '澳乐项目'], ['ruimian', '瑞眠项目']];
const t4InProj = bu => T4.projFilter === 'all' || (T4.projFilter === 'ruimian' ? bu === 'ruimian' : bu !== 'ruimian');
const t4ProjCH = () => T4_CH.filter(c => t4InProj(c.bu));
const t4ProjSelect = view => `<label class="sel">项目 <select id="t4ProjSel" data-view="${view}">${T4_PROJ_OPTS.map(([v, n]) => `<option value="${v}" ${T4.projFilter === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;

/* 汇总导入/录入按科目拆分：销售收入与销售成本各走各的入口，数据源独立、互不覆盖 */
const T4_SUM_SCOPES = {
  income: { n: '销售收入', fileK: 'summaryIncome', keys: ['retailIncome', 'returnAmount', 'refundAmount'] },
  cost: { n: '销售成本', fileK: 'summaryCost', keys: ['retailCost', 'returnCost'] },
};
const t4SumScope = () => T4_SUM_SCOPES[T4.sumScope] || T4_SUM_SCOPES.income;

function t4Clone(x) { return JSON.parse(JSON.stringify(x)); }
let T4_SERVER_VERSION = null;
let T4_SERVER_LOADING = false;
let T4_SERVER_LAST_KEY = '';
function t4EntityKey() {
  try { return localStorage.getItem('fsc_cur_ent') || 'global'; } catch (e) { return 'global'; }
}
async function t4LoadServer() {
  if (T4_SERVER_LOADING) return;
  const loadKey = `${T4.period}|${t4EntityKey()}`;
  if (T4_SERVER_LAST_KEY === loadKey) return;
  T4_SERVER_LAST_KEY = loadKey;
  T4_SERVER_LOADING = true;
  try {
    const r = await fetch(`/api/t4/data?period=${encodeURIComponent(T4.period)}&entity=${encodeURIComponent(t4EntityKey())}`);
    if (!r.ok) return;
    const x = await r.json();
    if (x.found) {
      T4.data = x.data || T4.data;
      T4.cfg = Object.assign(T4.cfg || {}, x.cfg || {});
      T4_SERVER_VERSION = x.version;
      if (typeof CURS === 'string' && CURS.startsWith('t4')) go(CURS);
    }
  } catch (e) { /* API 不可用时保留 localStorage 回退 */ }
  finally { T4_SERVER_LOADING = false; }
}
async function t4SaveServer() {
  try {
    const r = await fetch('/api/t4/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: T4.period, entity: t4EntityKey(), data: T4.data, cfg: T4.cfg, version: T4_SERVER_VERSION }) });
    if (r.status === 409) { toast('其他同事刚保存了数据，请刷新后再提交', 4200); return; }
    if (r.ok) { const x = await r.json(); T4_SERVER_VERSION = x.version; }
  } catch (e) { toast('共享保存暂不可用，已保留在本机浏览器', 4200); }
}
function t4Load() {
  try {
    const all = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    T4.data = all[T4.period] || {};
  } catch (e) { T4.data = {}; }
  T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; });
  try {
    const saved = JSON.parse(localStorage.getItem(T4_CFG_KEY) || '{}');
    T4.cfg = t4Clone(T4_CFG_DEFAULT);
    T4_CH.forEach(c => { T4.cfg[c.id] = Object.assign(T4.cfg[c.id] || {}, saved[c.id] || {}); });
  } catch (e) { T4.cfg = t4Clone(T4_CFG_DEFAULT); }
  t4MigrateV1();
  t4MigrateFileParts();
  void t4LoadServer();
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
    void t4SaveServer();
  } catch (e) { toast('保存失败：浏览器存储空间不足'); }
}
function t4SaveCfg() { localStorage.setItem(T4_CFG_KEY, JSON.stringify(T4.cfg)); void t4SaveServer(); }

const t4Days = () => { const [y, m] = T4.period.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const t4Date = d => `${T4.period}-${String(d).padStart(2, '0')}`;
const t4Num = v => { const n = Number(String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '')); return Number.isFinite(n) ? n : 0; };
const t4Raw = (ch, dt) => (T4.data[ch] || {})[dt] || null;
function t4InputValue(raw, key) {
  if (!raw) return null;
  if (raw[key] != null) return +raw[key] || 0;
  const parts = raw._fileParts || {};
  for (const source of ['summaryIncome','summaryCost','summaryDaily','daily']) {
    if (parts[source] && parts[source][key] != null) return +parts[source][key] || 0;
  }
  let value = 0, found = false;
  Object.entries(parts).forEach(([source, fields]) => {
    if (['summaryIncome','summaryCost','summaryDaily','daily'].includes(source) || fields[key] == null) return;
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
  // 零售成本率/退货率/退货成本率：任意渠道只要在参数页设置了就按比例派生（原仅京东自营，现通用）
  if (!explicit.has('retailCost') && cfg.retailCostRate != null) { r.retailCost = r.retailIncome * cfg.retailCostRate; hard.push('retailCost'); }
  if (!explicit.has('returnAmount') && cfg.returnRate != null) { r.returnAmount = r.retailIncome * cfg.returnRate; hard.push('returnAmount'); }
  if (!explicit.has('returnCost') && cfg.returnCostRate != null) { r.returnCost = (r.retailCost || 0) * cfg.returnCostRate; hard.push('returnCost'); }
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
/* ---------- 区间视图：看板可选起止日期（限当前期间内），清空回整月累计 ---------- */
const t4DayHasIncome = (ch, dt) => t4InputValue(t4Raw(ch, dt), 'retailIncome') != null;
/* 当前生效的查看区间；两端都空视为整月，只填一端补齐月初/月末，跨期间旧选择作废 */
function t4ViewRange() {
  const val = v => (v && v.startsWith(T4.period + '-') ? v : '');
  let f = val(T4.viewFrom), t = val(T4.viewTo);
  if (!f && !t) return null;
  if (!f) f = t4Date(1);
  if (!t) t = t4Date(t4Days());
  if (t < f) t = f;
  return { from: f, to: t, n: t4RangeDays(f, t) };
}
const t4RangeDates = (from, to) => { const out = []; for (let i = +from.slice(8, 10); i <= +to.slice(8, 10); i++) out.push(t4Date(i)); return out; };
const t4FilledRange = (ch, from, to) => t4RangeDates(from, to).filter(dt => t4DayHasIncome(ch, dt)).length;
/* 区间汇总可用性：沿用取数天数对齐思路——极差 ≤ min(2, 区间天数-1)，且至少一个渠道有数 */
function t4RangeOK(ids, from, to) {
  const ns = ids.map(id => t4FilledRange(id, from, to));
  return Math.max(...ns) > 0 && Math.max(...ns) - Math.min(...ns) <= Math.min(2, t4RangeDays(from, to) - 1);
}
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
function t4RangeData(ch, from, to) {
  const out = Object.fromEntries(T4_METRICS.filter(x => !x.pct).map(x => [x.k, 0]));
  t4RangeDates(from, to).forEach(dt => { const r = t4DayData(ch, dt); T4_METRICS.filter(x => !x.pct).forEach(x => { out[x.k] += r[x.k] || 0; }); });
  out.grossMargin = out.salesIncome ? out.grossProfit / out.salesIncome : 0;
  out.contributionRate = out.salesIncome ? out.contribution / out.salesIncome : 0;
  out.netMargin = out.salesIncome ? out.netProfit / out.salesIncome : 0;
  return out;
}
function t4GroupRange(ids, from, to) {
  const out = Object.fromEntries(T4_METRICS.filter(x => !x.pct).map(x => [x.k, 0]));
  ids.forEach(id => { const r = t4RangeData(id, from, to); T4_METRICS.filter(x => !x.pct).forEach(x => { out[x.k] += r[x.k] || 0; }); });
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
  const vr = t4ViewRange();
  const okOf = ids => vr ? t4RangeOK(ids, vr.from, vr.to) : t4SumOK(ids);
  const g = t4Gap(), ok = vr ? t4RangeOK(T4_ALL, vr.from, vr.to) : t4SumOK(),
    ecomOK = okOf(T4_BIG_ECOM), pddOK = okOf(T4_PDD), rmOK = okOf(T4_RUIMIAN), dealerOK = okOf(T4_DEALER);
  const shownCH = t4ProjCH();
  const rows = shownCH.map(c => {
    const n = t4Filled(c.id), rn = vr ? t4FilledRange(c.id, vr.from, vr.to) : 0;
    const m = vr ? t4RangeData(c.id, vr.from, vr.to) : t4Month(c.id);
    const mgmtAny = t4MgmtDaily(c.id).any, hasInc = vr ? rn > 0 : n > 0, mgmtOnly = !n && mgmtAny;
    const src = c.files.length ? pill('文件/人工', 'ok') : pill('人工', 'wa');
    const st = n === 0 ? (mgmtOnly ? pill('仅管理费', 'wa') : pill('未开始', 'cr')) : n < 15 ? pill('缺口大', 'wa') : pill('已有数据', 'ok');
    return [t4ProjectPill(c.bu), t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
      vr ? `<b class="mono">${rn}</b> / ${vr.n}` : `<b class="mono">${n}</b> / ${t4Days()}`, t4Cal(c.id), src,
      hasInc ? money(m.salesIncome) : '—', hasInc || mgmtAny ? money(m.netProfit) : '—', hasInc ? `${(m.netMargin * 100).toFixed(1)}%` : '—', st,
      `${c.files.length ? `<button class="btn sm" data-t4go="imp:${c.id}">导入</button>` : ''}
       <button class="btn sm" data-t4go="man:${c.id}">录入</button>`];
  });
  return head('T4　日损益表', `按底稿完整科目重算 ${T4_CH.length} 个渠道，并分别归集到大电商、拼多多、瑞眠和经销事业部。`, '工具箱 · 已更新',
    t4PeriodControl(`<label class="sel">起 <input id="t4ViewFrom" data-view="overview" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.from : ''}" title="选起止日期看区间损益，清空回整月累计" style="width:132px"></label><label class="sel">止 <input id="t4ViewTo" data-view="overview" type="date" min="${vr ? vr.from : t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.to : ''}" style="width:132px"></label>${t4ProjSelect('overview')}<button class="btn" data-t4go="sumimp:income">收入导入</button><button class="btn" data-t4go="sumimp:cost">成本导入</button><button class="btn" data-t4go="summan:income">收入录入</button><button class="btn" data-t4go="summan:cost">成本录入</button><button class="btn" data-t4go="channels">渠道列表</button><button class="btn" data-t4go="rules">取数口径</button><button class="btn" data-t4go="mgmt">管理费分摊</button><button class="btn" data-t4go="cfg">参数</button><button class="btn" data-t4act="wipePeriod" title="清空当前期间全部渠道的收入/成本/费用数据；参数、管理费分摊和渠道列表不受影响">清空本期</button><button class="btn pri" data-t4go="sheet">看损益表</button>`))
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
      { k: '全部汇总', v: ok ? '可用' : '禁用', t: ok ? 'g' : 'c', d: vr ? `${vr.from} ～ ${vr.to}（${vr.n} 天）` : `全渠道极差 ${g.gap} 天` },
      (() => { // 管理费分摊全渠道月合计——分摊值随有收入数据的日子计入损益
        let sum = 0; const set = new Set();
        T4_CH.forEach(c => { const cfg = T4.cfg[c.id] || {}; T4_MGMT_FIELDS.forEach(([k]) => { if (cfg[k] != null) { sum += +cfg[k] || 0; set.add(c.id); } }); });
        return { k: '管理费分摊', v: set.size ? money(sum) : '未设置', u: set.size ? '元/月' : '', d: set.size ? `${set.size} 个渠道已设置 · 日摊 ${money(sum / t4Days())}` : '点「管理费分摊」录入或导入' };
      })(),
    ])
    + (vr ? `<div class="note"><b>区间视图 ${vr.from} ～ ${vr.to}，共 ${vr.n} 天。</b>渠道列为区间累计损益（无收入数据的日子仅计管理费日摊）；汇总卡按区间内取数天数对齐校验。清空起止日期返回整月累计。</div>` : '')
    + (vr ? '' : ok ? `<div class="note g"><b>四个事业部取数天数已对齐。</b>大电商、拼多多、瑞眠、经销和全部汇总均可用。</div>`
      : g.max === 0 ? '<div class="note"><b>本期尚无数据。</b>先导入平台文件或逐日录入；已设置的管理费分摊会随有收入数据的日子自动计入损益。</div>'
      : `<div class="note c"><b>部分汇总不可用。</b>大电商事业部：${ecomOK ? '可用' : '禁用'}；拼多多事业部：${pddOK ? '可用' : '禁用'}；瑞眠事业部：${rmOK ? '可用' : '禁用'}；经销事业部：${dealerOK ? '可用' : '禁用'}；全部汇总：禁用。请补齐对应事业部的渠道数据。</div>`)
    + card((T4.projFilter === 'all' ? '' : T4_PROJ_OPTS.find(o => o[0] === T4.projFilter)[1] + ' · ') + (vr ? `${shownCH.length} 渠道 · ${vr.from} ～ ${vr.to} 区间损益` : `${shownCH.length} 渠道取数进度`), table(
      [{t:'项目'},{t:'归属事业部'},{t:'渠道汇总'},{t:'取数天数',n:1},{t:`日历（1—${t4Days()}）`},{t:'方式'},{t:'销售收入',n:1},{t:'净利润',n:1},{t:'净利率'},{t:'状态'},{t:''}], rows))
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

function t4SummaryEntryTable(group, dt, keys, title) {
  const fs = T4_INPUTS.filter(f => f.g === group && (!keys || keys.includes(f.k)));
  const rows = T4_CH.map(c => {
    const raw = t4Raw(c.id, dt) || {}, r = t4Row(c.id, dt);
    return [t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
      ...fs.map(f => { const value = t4InputValue(raw, f.k), v = value != null ? value : ''; return `<input type="number" step="0.01" class="t4in" data-t4sumcell="${c.id}:${f.k}" data-t4orig="${v}" value="${v}" placeholder="—">`; }),
      r ? `<b class="${r.netProfit >= 0 ? 'grn' : 'red'}">${money(r.netProfit)}</b>` : '—'];
  });
  return card(title || group, table([{t:'归属事业部'},{t:'渠道'}, ...fs.map(f => ({t:f.n,n:1})), {t:'当日净利润',n:1}], rows));
}
S['t4-summan'] = () => {
  t4Load(); const sc = t4SumScope();
  if (!T4.sumDate || !T4.sumDate.startsWith(T4.period + '-')) T4.sumDate = t4Date(1);
  return head(`汇总录入 · ${sc.n}`, `选择一个日期，在同一页面录入全部渠道的${sc.n}；各渠道原有录入入口继续保留。`, '工具箱 · T4',
    t4PeriodControl(`<label class="sel">日期 <input id="t4SumDate" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${T4.sumDate}" style="width:132px"></label><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="sumManSave">保存全部渠道</button>`))
    + `<div class="note"><b>只保存发生变化的格子。</b>留空表示删除该日该科目的录入值；填 0 表示当日确认为零。${sc.n === '销售收入' ? '退货金额、退款金额请按负数录入。' : '退货成本请按负数录入。'}</div>`
    + t4SummaryEntryTable('销售与成本', T4.sumDate, sc.keys, `${sc.n} · ${T4.sumDate}`);
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
  const aliases = { 京东自营店: 'jdzy', 京东pop: 'jdpop', 抖音达人: 'dycreator',
    // 吉客云「销售渠道」用店铺全名
    快手澳乐母婴品牌店: 'ks',
    // 渠道改店铺全名后，旧文件/旧数据里的简称仍要认
    天猫: 'tmall', 私域: 'priv', 团购: 'groupbuy', 天门: 'tianmen', 抖音达人店: 'dycreator', 礼品单: 'gift',
    京东自营: 'jdzy', 唯品会: 'vip' };
  const raw = String(value == null ? '' : value).trim();
  if (aliases[raw]) return aliases[raw];
  const n = norm(raw);
  if (T4_SOURCE_CHANNEL_NORM[n]) return T4_SOURCE_CHANNEL_NORM[n];
  if (aliases[n]) return aliases[n];
  const hit = T4_CH.find(c => norm(c.n) === n || norm(c.id) === n || (c.aliases || []).some(a => norm(a) === n));
  return hit ? hit.id : '';
}
const t4SummaryReady = imp => !!imp && T4_FILE_DEFS.summaryDaily.required.every(k => imp.map[k] != null)
  && t4SumScope().keys.some(k => imp.map[k] != null);

S['t4-sumimp'] = () => {
  t4Load(); const sc = t4SumScope(), scItems = T4_INPUTS.filter(x => sc.keys.includes(x.k));
  const imp = T4.imp && T4.imp.mode === 'summary' ? T4.imp : null;
  if (!imp) return head(`汇总导入 · ${sc.n}`, `一个文件内按“归属事业部 + 渠道 + 日期”导入全部渠道的${sc.n}；各渠道原有导入入口继续保留。`, '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4act="sumTemplate">下载模板</button><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="sumPick">选择汇总文件</button>'))
    + `<div class="note g"><b>模板就是吉客云导出的「销售单明细账」原版（28 列一列不少）。</b>吉客云导出的文件不用改一个字、直接选进来；从其他系统来的数据按模板列序套进去再导也一样。收入导入与成本导入用<b>同一份模板、同一份文件</b>：分摊后金额＝零售收入，货品成本＝零售成本，其余列自动忽略。</div>`
    + card('汇总文件要求（吉客云销售单明细账直接导入）', table([{t:'字段'},{t:'要求'}], [
      ['渠道 / 销售渠道', `必填；支持渠道名或店铺全名：${T4_CH.map(c => c.n).join('、')}、天猫-澳乐旗舰店、京东-澳乐官方旗舰店、快手-澳乐母婴品牌店`],
      ['日期 / 发货时间', '必填；只导入当前期间的数据，同渠道同日多行自动累加'],
      [`${sc.n}科目`, `${sc.fileK === 'summaryIncome' ? '分摊后金额（即销售收入）' : '货品成本（即销售成本）'}；也认${scItems.map(x => x.n).join('、')}列名。空白不覆盖，明确的 0 会导入`],
      ['订单类型', '选填；「退货」行自动按负数计入退货科目，「售后发货」行跳过'],
    ]))
    + `<div class="note"><b>支持 .xlsx、.xls、.csv、.tsv。</b>本入口只写${sc.n}科目；与${sc.n === '销售收入' ? '成本' : '收入'}导入、各渠道专用文件导入互不覆盖，重复导入不会重复累计。</div>`;
  const def = T4_FILE_DEFS.summaryDaily, hdr = imp.rows[imp.headRow] || [];
  const fields = def.fields.filter(([k]) => ['date','bu','channel','type'].includes(k) || sc.keys.includes(k));
  const options = k => hdr.map((x, i) => `<option value="${i}" ${imp.map[k] === i ? 'selected' : ''}>${H(String(x || '(空)').slice(0,30))}</option>`).join('');
  return head(`汇总导入 · ${sc.n} · ${H(imp.fileName)}`, `确认渠道、日期及${sc.n}科目的列对应关系。`, '工具箱 · T4', '<button class="btn" data-t4act="sumImpCancel">取消</button>')
    + `<div class="frow" style="margin-bottom:13px"><span class="fi">✓</span><span><span class="fn">${H(imp.fileName)}</span><br><span class="fm">${imp.rows.length} 行</span></span></div>`
    + cardp('表头行', `<select id="t4head">${imp.rows.slice(0,15).map((r,i) => `<option value="${i}" ${i===imp.headRow?'selected':''}>第 ${i+1} 行：${H(r.filter(Boolean).slice(0,6).join(' | ').slice(0,80))}</option>`).join('')}</select>`)
    + card('列对应', table([{t:'目标字段'},{t:'文件字段'}], fields.map(([k,n]) => [`${H(n)}${def.required.includes(k) ? ' <span class="red">*</span>' : ''}`, `<select data-t4map="${k}"><option value="">— 不使用 —</option>${options(k)}</select>`])))
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
  const sc = t4SumScope();
  T4_CH.forEach(c => t4ClearSource(c.id, sc.fileK));
  let used = 0, skipped = 0; const seen = new Set(), channels = new Set(), unknown = new Set();
  imp.rows.slice(imp.headRow + 1).forEach(row => {
    const get = k => imp.map[k] == null ? '' : row[imp.map[k]];
    const ch = t4ResolveChannel(get('channel')), dt = t4DateNorm(get('date'));
    if (!ch) { const name = String(get('channel') || '').trim(); if (name) unknown.add(name); skipped++; return; }
    if (!dt || !dt.startsWith(T4.period + '-')) { skipped++; return; }
    // 明细口径（吉客云）：售后发货行不属于收入/成本；退货行转入退货科目并保证负数
    const typ = imp.map.type != null ? String(get('type')).trim() : '';
    if (/售后发货/.test(typ)) { skipped++; return; }
    const isReturn = /退货/.test(typ);
    let wrote = false;
    sc.keys.forEach(k => {
      if (imp.map[k] == null) return;
      const value = get(k);
      if (value == null || String(value).trim() === '') return;
      let key = k, num = t4Num(value);
      if (isReturn && k === 'retailIncome') { key = 'returnAmount'; num = num > 0 ? -num : num; }
      else if (isReturn && k === 'retailCost') { key = 'returnCost'; num = num > 0 ? -num : num; }
      t4Add(ch, dt, key, num, sc.fileK); wrote = true;
    });
    if (!wrote) { skipped++; return; }
    seen.add(`${ch}:${dt}`); channels.add(ch); used++;
  });
  t4Save(); T4.imp = null; t4Go('overview');
  const bad = unknown.size ? `；未识别渠道：${[...unknown].slice(0,5).join('、')}` : '';
  toast(`${sc.n}汇总导入 ${channels.size} 个渠道、${seen.size} 个渠道日、${used} 行${skipped ? `，跳过 ${skipped} 行` : ''}${bad}`, 5200);
}

async function t4SummaryTemplate() {
  // 模板 = 吉客云「销售单明细账」原版 xlsx（仓库携带，28 列一列不动，负责人 2026-09-12 拍板不许精简）。
  // 收入导入与成本导入共用同一份：分摊后金额＝零售收入、货品成本＝零售成本，导入时其余列自动忽略
  try {
    const r = await fetch('示例文件/吉客云销售单明细账模版.xlsx');
    const u8 = new Uint8Array(await r.arrayBuffer());
    // 静态服务器对不存在的路径回落 200+index.html，光看 r.ok 拦不住——
    // xlsx 是 zip，头两字节必为 PK，嗅一道防止把 HTML 当模版发给用户
    if (!r.ok || u8[0] !== 0x50 || u8[1] !== 0x4b) throw new Error('模版文件缺失或损坏，请联系开发');
    downloadBlob('吉客云销售单明细账模版.xlsx', new Blob([u8]));
    toast('已下载吉客云销售单明细账模版（28 列原版，收入导入 / 成本导入通用）');
  } catch (e) { toast(`模版下载失败：${e.message || e}`, 5000); }
}

/* ---------- 渠道列表：模板导入维护（批量改名/调事业部/新增） ---------- */
const T4_BU_ALIAS = { 大电商: 'ecom', 大电商事业部: 'ecom', 拼多多: 'pdd', 拼多多事业部: 'pdd',
  瑞眠: 'ruimian', 瑞眠事业部: 'ruimian', 经销: 'dealer', 经销事业部: 'dealer' };

async function t4ChTemplate() {
  // 财务确认版渠道底稿：76 条销售渠道映射，保留原 xlsx 的列序、编号与格式。
  try {
    const r = await fetch('示例文件/渠道列表.xlsx');
    const u8 = new Uint8Array(await r.arrayBuffer());
    if (!r.ok || u8[0] !== 0x50 || u8[1] !== 0x4b) throw new Error('模板文件缺失或损坏，请联系开发');
    downloadBlob('渠道列表.xlsx', new Blob([u8]));
    toast('已下载渠道列表模板（76 条销售渠道映射）');
  } catch (e) { toast(`模板下载失败：${e.message || e}`, 5000); }
}

function t4ChApplyRows(rows) {
  const clean = c => String(c == null ? '' : c).replace(/[﻿​\s]+/g, '');
  const headRow = rows.findIndex(r => r.some(c => ['渠道名称', '渠道', '销售渠道'].includes(clean(c)))
    && r.some(c => ['归属事业部', '事业部'].includes(clean(c))));
  if (headRow < 0) throw new Error('未找到表头行（需包含「销售渠道/渠道名称」和「归属事业部」列）');
  const hdr = rows[headRow].map(clean);
  const buCol = hdr.findIndex(c => c === '归属事业部' || c === '事业部');
  const sumCol = hdr.findIndex(c => c === '渠道汇总' || c === '汇总渠道');
  const trim = v => String(v == null ? '' : v).trim();
  const buOf = raw => raw ? T4_BU_ALIAS[raw.replace(/\s/g, '')] || '' : '';
  const ov = t4ChOverrides();
  const put = entry => { const i = ov.findIndex(x => x.id === entry.id); if (i >= 0) ov[i] = { ...ov[i], ...entry }; else ov.push(entry); };
  let cusMax = 0; T4_CH.concat(ov).forEach(c => { const m = /^cus(\d+)$/.exec(c.id || ''); if (m) cusMax = Math.max(cusMax, +m[1]); });
  let renamed = 0, moved = 0, added = 0, mapped = 0; const bad = [];
  const body = rows.slice(headRow + 1);

  if (sumCol >= 0) {
    // 映射模式（渠道列表底稿）：销售渠道（吉客云原始店铺）归集到渠道汇总（T4 渠道）
    const rawCol = hdr.findIndex(c => ['销售渠道', '店铺', '渠道名称', '渠道'].includes(c));
    // 第一遍：保证每个「渠道汇总」目标渠道存在，并按表调整事业部
    body.forEach(row => {
      const tgt = trim(row[sumCol]) || (rawCol >= 0 ? trim(row[rawCol]) : ''); if (!tgt) return;
      const buRaw = buCol >= 0 ? trim(row[buCol]) : '', bu = buOf(buRaw);
      if (buRaw && !bu) { bad.push(`${tgt}（事业部「${buRaw}」不识别）`); return; }
      const rid = t4ResolveChannel(tgt);
      if (rid) {
        if (bu && T4_CHM[rid].bu !== bu) { put({ id: rid, bu }); T4_CHM[rid].bu = bu; moved++; }
      } else {
        put({ id: `cus${++cusMax}`, n: tgt, bu: bu || 'dealer' }); added++;
        if (!bu) bad.push(`${tgt}（未填事业部，暂归经销）`);
        t4SaveChOverrides(ov); t4RebuildChannels(); // 让同表后续行立即能解析到新渠道
      }
    });
    t4SaveChOverrides(ov); t4RebuildChannels();
    // 第二遍：销售渠道 → 渠道汇总 的对应关系挂为目标渠道的别名
    body.forEach(row => {
      const raw = rawCol >= 0 ? trim(row[rawCol]) : '';
      const tgt = trim(row[sumCol]) || raw;
      if (!raw || !tgt) return;
      const tid = t4ResolveChannel(tgt); if (!tid) return;
      if (t4ResolveChannel(raw) === tid) return; // 本名或已有映射
      const i = ov.findIndex(x => x.id === tid);
      const prev = i >= 0 ? (ov[i].aliases || []) : [];
      if (i >= 0) ov[i] = { ...ov[i], aliases: [...new Set(prev.concat(raw))] };
      else ov.push({ id: tid, aliases: [raw] });
      mapped++;
    });
    t4SaveChOverrides(ov); t4RebuildChannels();
    return { renamed, moved, added, mapped, bad };
  }

  // 渠道ID 模式：改名 / 调事业部 / 新增
  const idCol = hdr.findIndex(c => ['渠道ID', '渠道Id', '渠道id', 'ID', 'id'].includes(c));
  const nameCol = hdr.findIndex(c => c === '渠道名称' || c === '渠道');
  body.forEach(row => {
    const name = trim(row[nameCol]);
    if (!name) return;
    const idRaw = idCol >= 0 ? trim(row[idCol]) : '';
    const buRaw = buCol >= 0 ? trim(row[buCol]) : '', bu = buOf(buRaw);
    if (buRaw && !bu) { bad.push(`${name}（事业部「${buRaw}」不识别）`); return; }
    const rid = t4ResolveChannel(name);
    const target = (idRaw && T4_CHM[idRaw]) || (rid && T4_CHM[rid]) || null;
    if (target) {
      const entry = { id: target.id };
      if (name !== target.n) { entry.n = name; renamed++; }
      if (bu && bu !== target.bu) { entry.bu = bu; moved++; }
      if (entry.n || entry.bu) put(entry);
    } else {
      const id = /^[a-z][a-z0-9_]*$/i.test(idRaw) && !T4_CHM[idRaw] ? idRaw : `cus${++cusMax}`;
      put({ id, n: name, bu: bu || 'dealer' }); added++;
      if (!bu) bad.push(`${name}（未填事业部，暂归经销）`);
    }
  });
  t4SaveChOverrides(ov);
  t4RebuildChannels();
  return { renamed, moved, added, mapped, bad };
}

function t4ChPickFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      const r = t4ChApplyRows(await XLSXLite.readTable(file));
      t4Load(); t4Go('channels');
      const warn = r.bad.length ? `；注意：${r.bad.slice(0, 3).join('、')}` : '';
      toast(`渠道列表导入完成：新增渠道 ${r.added}、映射销售渠道 ${r.mapped}、改名 ${r.renamed}、调事业部 ${r.moved}${warn}`, 5600);
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
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

/* 区间天数（含首尾） */
const t4RangeDays = (from, to) => Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;
/* 月度金额在任意日期区间内的分摊额；跨月时按各自月份的自然日分别折算 */
function t4RangeAmount(monthTotal, from, to) {
  let sum = 0, d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    const y = d.getFullYear(), m = d.getMonth(), dim = new Date(y, m + 1, 0).getDate();
    const monthEnd = new Date(y, m, dim);
    const spanEnd = end < monthEnd ? end : monthEnd;
    sum += monthTotal / dim * (Math.round((spanEnd - d) / 86400000) + 1);
    d = new Date(y, m + 1, 1);
  }
  return sum;
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
      if (t4ResolveChannel(get('channel')) !== ch) { skipped++; return; }
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

// 损益树的列：一条从销售收入到净利润的「层层递减」链
const T4_TREE_COLS = [
  ['salesIncome', '销售收入'], ['salesCost', '销售成本'], ['grossProfit', '毛利'], ['grossMargin', '毛利率', true],
  ['operating', '运营费'], ['contribution', '边际毛利'], ['mgmt', '管理费'], ['netProfit', '净利润'], ['netMargin', '净利率', true],
];
const t4TreeVal = (g, key) => key === 'mgmt' ? (g.direct || 0) + (g.indirect || 0) : (g[key] || 0);
function t4TreeCell(g, col) {
  const [key, , pct] = col;
  const v = t4TreeVal(g, key);
  const neg = v < 0;
  return `<span class="${neg ? 'red' : ''}">${t4Fmt(v, pct)}</span>`;
}
// 组织树：全部 → 项目 → 事业部 → 渠道
function t4TreeNodes() {
  const chNodes = ids => ids.map(id => ({ id, name: T4_CHM[id].n, lvl: 3, ids: [id] }));
  const buNode = (id, name, ids) => ({ id: 'bu:' + id, name, lvl: 2, ids, children: chNodes(ids) });
  const aole = [...T4_BIG_ECOM, ...T4_PDD, ...T4_DEALER];
  return [{
    id: 'all', name: '全部汇总', lvl: 0, ids: T4_ALL, children: [
      { id: 'proj:aole', name: '澳乐项目', lvl: 1, ids: aole, children: [
        buNode('ecom', '大电商事业部', T4_BIG_ECOM),
        buNode('pdd', '拼多多事业部', T4_PDD),
        buNode('dealer', '经销事业部', T4_DEALER),
      ].filter(n => n.ids.length) },
      { id: 'proj:ruimian', name: '瑞眠项目', lvl: 1, ids: T4_RUIMIAN, children: [
        buNode('ruimian', '瑞眠事业部', T4_RUIMIAN),
      ].filter(n => n.ids.length) },
    ].filter(n => n.ids.length),
  }];
}

S['t4-sheet'] = () => {
  t4Load();
  const vr = t4ViewRange();
  const grpOf = ids => vr ? t4GroupRange(ids, vr.from, vr.to) : t4Group(ids);
  const ctrl = t4PeriodControl(`<label class="sel">起 <input id="t4ViewFrom" data-view="sheet" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.from : ''}" title="选起止日期看区间损益，清空回整月累计" style="width:132px"></label><label class="sel">止 <input id="t4ViewTo" data-view="sheet" type="date" min="${vr ? vr.from : t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.to : ''}" style="width:132px"></label>${t4ProjSelect('sheet')}<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="sheetMode">${T4.sheetMode === 'tree' ? '切换明细表' : '切换树视图'}</button><button class="btn" data-t4go="chday">每日明细</button><button class="btn" data-t4act="export">导出本表</button><button class="btn" data-t4go="mail">邮件发送</button><button class="btn pri" data-t4act="exportSuite">导出套表</button>`);
  const desc = vr ? `${vr.from} ～ ${vr.to}（${vr.n} 天）区间损益。` : '渠道月累计损益。';
  const title = vr ? `${vr.from} ～ ${vr.to} 区间损益（${vr.n} 天）` : '月累计损益';

  if (T4.sheetMode === 'tree') {
    // 展平树为行，尊重折叠状态
    const rows = [];
    const walk = (node, parents) => {
      const collapsed = parents.some(p => T4.treeCollapsed[p]);
      if (collapsed) return;
      const g = grpOf(node.ids);
      const has = node.children && node.children.length;
      const open = !T4.treeCollapsed[node.id];
      const caret = has ? `<span class="tcar" data-t4tree="${H(node.id)}">${open ? '▾' : '▸'}</span>` : '<span class="tcar"></span>';
      const pad = 4 + node.lvl * 16;
      const name = `<span style="padding-left:${pad}px">${caret}<span class="tnm">${H(node.name)}</span></span>`;
      rows.push({ cls: 'tr' + node.lvl, d: [name, ...T4_TREE_COLS.map(col => t4TreeCell(g, col))] });
      if (has && open) node.children.forEach(ch => walk(ch, parents.concat(node.id)));
    };
    // 项目筛选：全部看整棵树；选定项目则以该项目为根
    const full = t4TreeNodes()[0];
    const roots = T4.projFilter === 'all' ? [full] : full.children.filter(p => p.id === 'proj:' + T4.projFilter);
    roots.forEach(n => walk(n, []));
    const headers = [{ t: '项目 / 事业部 / 渠道' }, ...T4_TREE_COLS.map(c => ({ t: c[1], n: 1 }))];
    return head('渠道事业部日损益表', desc + '按 项目→事业部→渠道 逐层汇总，父级为子级之和；点名称前的三角可折叠。', '工具箱 · T4', ctrl)
      + card(title + ' · 树视图', table(headers, rows))
      + `<div class="note c"><b>红线口径：</b>京东自营零售成本、退货金额和退货成本来自底稿设定比例；管理费为直接+间接合计。比例与分摊可在「参数」「管理费分摊」中修改。</div>`;
  }

  // 明细表（经典矩阵）——只列渠道；事业部/全部汇总看树视图
  const chs = t4ProjCH();
  const months = chs.map(c => vr ? t4RangeData(c.id, vr.from, vr.to) : t4Month(c.id));
  const headers = [{t:'损益项目'}, ...chs.map(c => ({t:c.n,n:1}))];
  const rows = T4_METRICS.map(metric => {
    const vals = months.map(m => t4Fmt(m[metric.k], metric.pct));
    const name = metric.lvl ? `<span class="mut">${H(metric.n)}</span>` : `<b>${H(metric.n)}</b>`;
    return [name, ...vals];
  });
  return head('渠道事业部日损益表', desc + '按渠道逐列展开损益科目；事业部与全部汇总见「树视图」。', '工具箱 · T4', ctrl)
    + card(title, table(headers, rows))
    + `<div class="note c"><b>红线口径：</b>京东自营零售成本、退货金额和退货成本仍来自底稿设定比例，不是平台原始数据；所有比例与月度分摊可在「参数」中审阅和修改。</div>`;
};

// 把参数页当前所有输入框的值读回 T4.cfg（供保存/添加/删除前保留未存的编辑）
function t4CfgReadInputs() {
  document.querySelectorAll('[data-t4cfg]').forEach(inp => {
    const [ch, k] = inp.dataset.t4cfg.split(':'), meta = T4_CFG_FIELDS.find(x => x[0] === k);
    (T4.cfg[ch] = T4.cfg[ch] || {})[k] = (Number(inp.value) || 0) / (meta && meta[2] === 'rate' ? 100 : 1);
  });
}

// 单渠道每日明细：利润表格式——损益科目竖排（行），日期横排（列），末列合计
S['t4-chday'] = () => {
  t4Load();
  if (!T4_CHM[T4.dayCh]) T4.dayCh = T4_CH[0].id;
  const c = T4_CHM[T4.dayCh], days = t4Days();
  const sel = `<label class="sel">渠道 <select id="t4DayCh">${T4_CH.map(x => `<option value="${x.id}" ${x.id === T4.dayCh ? 'selected' : ''}>${H(x.n)}</option>`).join('')}</select></label>`;
  // 每天算一次损益对象（含参数/分摊派生），末列取月合计
  const daily = [], hasData = [];
  for (let d = 1; d <= days; d++) {
    const dt = t4Date(d);
    daily.push(t4DayData(c.id, dt));
    hasData.push(t4DayHasIncome(c.id, dt) || t4MgmtDaily(c.id).any);
  }
  const m = t4Month(c.id);
  // 合计列放最左（紧挨科目名）与最右各一列，两头都能直接看到
  const headers = [{ t: '损益项目' }, { t: '合计', n: 1 }, ...Array.from({ length: days }, (_, i) => ({ t: `${i + 1}日`, n: 1 })), { t: '合计', n: 1 }];
  const rows = T4_METRICS.map(metric => {
    const name = metric.lvl ? `<span class="mut">${H(metric.n)}</span>` : `<b>${H(metric.n)}</b>`;
    const total = `<b>${t4Fmt(m[metric.k], metric.pct)}</b>`;
    const dayCells = daily.map((g, i) => hasData[i] ? t4Fmt(g[metric.k], metric.pct) : '<span class="mut">—</span>');
    return [name, total, ...dayCells, total];
  });
  return head(`每日明细 · ${c.n}`, `${T4.period} 逐日损益表（利润表格式）：损益科目竖排，每天一列，末列为当月合计。空白日仅计管理费日摊。`, '工具箱 · T4',
    t4PeriodControl(`${sel}<button class="btn" data-t4go="sheet">← 返回损益表</button><button class="btn pri" data-t4act="dayExport">导出 CSV</button>`))
    + card(`${c.n} · ${T4.period} 每日损益表（实取 ${t4Filled(c.id)}/${days} 天）`, table(headers, rows));
};

// ---------- 邮件发送：收件人清单（服务端保存，多端共用）+ 按各自范围生成套表并逐人发送 ----------
const T4_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// 常见服务商 SMTP 预设（授权码获取方式见 tip）
const T4_SMTP_PRESETS = {
  dingtalk: { n: '钉钉邮箱（@dingtalk.com）', host: 'smtp.aliyun.com', port: 465, secure: 'ssl', tip: '钉钉邮箱由阿里邮箱托管，SMTP 服务器为 smtp.aliyun.com。网页版邮箱 → 设置 → 账户 → 开启 IMAP/SMTP 服务；若提供「客户端授权码/安全密码」则填它，否则填邮箱登录密码' },
  exmail: { n: '腾讯企业邮箱（企业微信）', host: 'smtp.exmail.qq.com', port: 465, secure: 'ssl', tip: '登录网页邮箱 → 设置 → 账户 → 开启 IMAP/SMTP 服务 → 生成「客户端专用密码」，即授权码' },
  qq: { n: 'QQ 邮箱', host: 'smtp.qq.com', port: 465, secure: 'ssl', tip: 'QQ 邮箱网页版 → 设置 → 账户 → 开启 SMTP 服务 → 生成授权码（16 位）' },
  n163: { n: '网易 163 邮箱', host: 'smtp.163.com', port: 465, secure: 'ssl', tip: '163 网页版 → 设置 → POP3/SMTP/IMAP → 开启服务 → 新增授权密码' },
  ali: { n: '阿里企业邮箱', host: 'smtp.mxhichina.com', port: 465, secure: 'ssl', tip: '用邮箱登录密码；若开启了「客户端专用密码」则填专用密码' },
  o365: { n: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: 'starttls', tip: '需管理员允许 SMTP AUTH；密码用应用专用密码' },
  custom: { n: '自定义', host: '', port: 465, secure: 'ssl', tip: '按邮箱服务商提供的 SMTP 参数填写' },
};
async function t4SmtpSave(quiet) {
  t4MailReadForm();
  const g = id => ((document.getElementById(id) || {}).value || '').trim();
  const body = { host: g('t4SmtpHost'), port: g('t4SmtpPort'), secure: g('t4SmtpSecure'), user: g('t4SmtpUser'), pass: g('t4SmtpPass'), from: g('t4SmtpFrom') || g('t4SmtpUser'), fromName: g('t4SmtpName') };
  try {
    const res = await fetch('/api/t4/mail/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { toast(await res.text(), 6000); return false; }
    T4.mail.status = await res.json();
    if (!quiet) { toast('发件配置已保存到服务器本地'); t4Go('mail'); }
    return true;
  } catch (e) { toast('保存失败：' + (e.message || e), 6000); return false; }
}
// 发送前确保发件配置就绪：表单里填了授权码就先自动保存；仍未配置则提示并中止
async function t4SmtpEnsure() {
  const pass = ((document.getElementById('t4SmtpPass') || {}).value || '').trim();
  if (pass || !(T4.mail.status && T4.mail.status.configured)) {
    if (!pass && !(T4.mail.status && T4.mail.status.hasPass)) { toast('请先在「发件邮箱配置」里填写授权码', 6000); return false; }
    await t4SmtpSave(true);
  }
  if (!(T4.mail.status && T4.mail.status.configured)) { toast('发件邮箱未配置完整：' + ((T4.mail.status || {}).missing || []).join('、'), 6000); return false; }
  return true;
}
async function t4SmtpTest() {
  t4MailReadForm();
  const to = ((document.getElementById('t4SmtpTestTo') || {}).value || '').trim();
  if (!T4_EMAIL_RE.test(to)) { toast('请填写测试收件邮箱'); return; }
  if (!(await t4SmtpEnsure())) return;
  toast('正在发送测试邮件…', 6000);
  try {
    const res = await fetch('/api/t4/mail/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
    if (!res.ok) throw new Error((await res.text()).slice(0, 300));
    const out = await res.json(); const r = out.results && out.results[0];
    T4.mail.result = (out.results || []).map(x => ({ ...x, name: '测试邮件 → ' + x.to }));
    toast(r && r.ok ? '测试邮件已发出，请到收件箱确认' : '测试发送失败：' + (r && r.error || '未知错误'), 7000);
  } catch (e) { T4.mail.result = [{ name: '测试邮件', ok: false, error: String(e.message || e) }]; toast('测试发送失败：' + (e.message || e), 7000); }
  t4Go('mail');
}
function t4SmtpCard(cfg) {
  const c = cfg || {};
  const preset = Object.keys(T4_SMTP_PRESETS).find(k => T4_SMTP_PRESETS[k].host && T4_SMTP_PRESETS[k].host === c.host) || 'custom';
  const opt = (v, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>`;
  return cardp('发件邮箱配置（授权码只存服务器本地，不入库）',
    `<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;max-width:640px">
      <span>服务商</span><select id="t4SmtpPreset">${Object.entries(T4_SMTP_PRESETS).map(([k, p]) => `${opt(k, preset)}${H(p.n)}</option>`).join('')}</select>
      <span>SMTP 服务器</span><div style="display:flex;gap:7px"><input id="t4SmtpHost" value="${H(c.host || '')}" placeholder="smtp.exmail.qq.com" style="flex:1"><input id="t4SmtpPort" value="${H(String(c.port || 465))}" style="width:70px" title="端口"><select id="t4SmtpSecure">${opt('ssl', c.secure || 'ssl')}SSL(465)</option>${opt('starttls', c.secure)}STARTTLS(587)</option>${opt('none', c.secure)}不加密</option></select></div>
      <span>发件账号</span><input id="t4SmtpUser" value="${H(c.user || '')}" placeholder="finance@公司域名.com">
      <span>授权码</span><input id="t4SmtpPass" type="password" placeholder="${c.hasPass ? '已保存，留空则不改' : '邮箱设置里生成的 SMTP 授权码'}" autocomplete="new-password">
      <span>发件人显示</span><div style="display:flex;gap:7px"><input id="t4SmtpName" value="${H(c.fromName || '财务中心')}" placeholder="显示名" style="width:150px"><input id="t4SmtpFrom" value="${H(c.from || '')}" placeholder="发件地址（默认同账号）" style="flex:1"></div>
    </div>
    <div id="t4SmtpTip" class="mut" style="margin:8px 0 10px;font-size:11px">${H(T4_SMTP_PRESETS[preset].tip)}</div>
    <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><button class="btn pri" data-t4act="smtpSave">保存配置</button><span style="width:14px"></span><input id="t4SmtpTestTo" value="${H(c.user || '')}" placeholder="测试收件邮箱" style="width:230px"><button class="btn" data-t4act="smtpTest">发测试邮件</button></div>`);
}
async function t4MailLoad() {
  const st = T4.mail; st.loading = true;
  try {
    const [list, status] = await Promise.all([fetch('/api/t4/recipients').then(r => r.json()), fetch('/api/t4/mail/status').then(r => r.json())]);
    st.list = Array.isArray(list) ? list : []; st.status = status;
  } catch (e) { st.status = { configured: false, missing: ['服务端不可达：' + (e.message || e)] }; }
  st.loaded = true; st.loading = false;
  if (document.getElementById('t4MailSubject')) t4Go('mail');   // 仍在本页才刷新
}
// 把页面上的收件人表格与主题/附言读回状态
function t4MailReadForm() {
  const names = document.querySelectorAll('[data-t4mailname]');
  if (names.length) {
    const val = (sel, i) => { const el = document.querySelector(`[${sel}="${i}"]`); return el ? el : {}; };
    T4.mail.list = [...names].map(inp => { const i = inp.dataset.t4mailname; return {
      name: inp.value.trim(), email: String(val('data-t4mailaddr', i).value || '').trim(),
      scope: val('data-t4mailscope', i).value || 'all', enabled: !!val('data-t4mailon', i).checked }; });
  }
  const s = document.getElementById('t4MailSubject'); if (s) T4.mail.subject = s.value.trim();
  const b = document.getElementById('t4MailBody'); if (b) T4.mail.body = b.value.trim();
}
const t4MailSaveList = () => fetch('/api/t4/recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(T4.mail.list) });
async function t4MailSend() {
  t4MailReadForm();
  const list = T4.mail.list.filter(r => r.enabled !== false && T4_EMAIL_RE.test(r.email || ''));
  if (!list.length) { toast('没有启用且邮箱有效的收件人'); return; }
  if (!(await t4SmtpEnsure())) return;
  const scopes = [...new Set(list.map(r => r.scope || 'all'))];
  const prev = T4.projFilter, payloads = {};
  scopes.forEach(s => { T4.projFilter = s; payloads[s] = t4SuitePayload(); });   // 每个范围一份数据包
  T4.projFilter = prev;
  toast(`正在生成 ${scopes.length} 份套表并发送给 ${list.length} 人，请稍候…`, 8000);
  try {
    await t4MailSaveList();
    const res = await fetch('/api/t4/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: T4.mail.subject || `T4 日损益套表 · ${T4.period}`, body: T4.mail.body, payloads,
        recipients: list.map(r => ({ name: r.name, email: r.email, scope: r.scope || 'all' })) }) });
    if (!res.ok) throw new Error((await res.text()).slice(0, 300));
    const out = await res.json();
    T4.mail.result = out.results || [];
    toast(`发送完成：成功 ${T4.mail.result.filter(x => x.ok).length} / ${T4.mail.result.length}`, 5000);
  } catch (e) { T4.mail.result = [{ name: '—', ok: false, error: String(e.message || e) }]; toast('发送失败：' + (e.message || e), 7000); }
  t4Go('mail');
}
S['t4-mail'] = () => {
  t4Load();
  const st = T4.mail;
  if (!st.loaded && !st.loading) t4MailLoad();
  const opts = (v, attr) => `<select ${attr}>${T4_PROJ_OPTS.map(([k, n]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const rows = st.list.map((r, i) => [
    `<input type="checkbox" data-t4mailon="${i}" ${r.enabled !== false ? 'checked' : ''}>`,
    `<input data-t4mailname="${i}" value="${H(r.name || '')}" placeholder="姓名" style="width:110px">`,
    `<input data-t4mailaddr="${i}" value="${H(r.email || '')}" placeholder="邮箱" style="width:230px">`,
    opts(r.scope || 'all', `data-t4mailscope="${i}"`),
    `<button class="btn sm" data-t4maildel="${i}">删除</button>`]);
  const cfg = st.status;
  const cfgNote = !cfg ? '<div class="note">正在读取发件配置…</div>'
    : cfg.configured ? `<div class="note g"><b>发件邮箱已就绪：</b>${H(cfg.fromName ? cfg.fromName + ' ' : '')}${H(cfg.from)}（${H(cfg.host)}:${H(String(cfg.port))}）</div>`
    : `<div class="note c"><b>发件邮箱尚未配置。</b>在下方选择服务商、填写发件账号和授权码后点「保存配置」，再发一封测试邮件确认。</div>`;
  return head('邮件发送套表', '维护收件人清单，每人指定报表范围（全部 / 澳乐 / 瑞眠）；发送时按范围各生成一份套表工作簿，逐人附上对应的那份。', '工具箱 · T4',
    '<button class="btn" data-t4go="sheet">← 返回损益表</button><button class="btn" data-t4act="mailSave">保存收件人</button><button class="btn pri" data-t4act="mailSend">生成并发送</button>')
    + cfgNote
    + t4SmtpCard(cfg)
    + card(`收件人清单（${st.list.length}）`,
      (rows.length ? table([{t:'启用'},{t:'姓名'},{t:'邮箱'},{t:'报表范围'},{t:''}], rows) : '<div class="mut" style="padding:14px 14px 0">还没有收件人，在下面添加。</div>')
      + `<div style="padding:11px 14px;display:flex;gap:7px;align-items:center;flex-wrap:wrap"><input id="t4MailNewName" placeholder="姓名" style="width:110px"><input id="t4MailNewAddr" placeholder="邮箱" style="width:230px">${opts('all', 'id="t4MailNewScope"')}<button class="btn sm" data-t4act="mailAdd">添加</button><span class="mut" style="font-size:11px">停用的收件人保留在清单但不发送</span></div>`)
    + cardp('邮件内容', `<label class="sel" style="display:block;margin-bottom:8px">主题 <input id="t4MailSubject" value="${H(st.subject || `T4 日损益套表 · ${T4.period}`)}" style="width:440px"></label>`
      + `<label class="sel" style="display:block">附言 <input id="t4MailBody" value="${H(st.body || '')}" placeholder="可选，写在正文开头" style="width:440px"></label>`
      + '<div class="mut" style="margin-top:8px;font-size:11px">正文自动附上期间、报表范围、生成时间；附件为该收件人范围的套表 .xlsx（总表→事业部→渠道逐日明细）。</div>')
    + (st.result ? card('发送结果', table([{t:'收件人'},{t:'范围'},{t:'结果'}],
        st.result.map(x => [H(x.name || x.to || ''), H(x.scopeName || ''), x.ok ? pill('已发送', 'ok') : `<span class="red">${H(x.error || '失败')}</span>`]))) : '');
};

S['t4-cfg'] = () => {
  t4Load();
  const blocks = T4_CH.map(c => {
    const cfg = T4.cfg[c.id] || {};
    const rows = T4_CFG_FIELDS.filter(([k]) => cfg[k] != null).map(([k,n,t]) => [H(n),
      `<input type="number" step="0.0001" data-t4cfg="${c.id}:${k}" value="${t === 'rate' ? cfg[k] * 100 : cfg[k]}">`,
      t === 'rate' ? '%' : '元',
      `<button class="btn sm" data-t4cfgdel="${c.id}:${k}" title="删除此费用规则">删除</button>`]);
    // 该渠道还没设置的费用项目——供「添加规则」下拉选择
    const unset = T4_CFG_FIELDS.filter(([k]) => cfg[k] == null);
    const addCtrl = unset.length
      ? `<select class="t4addsel" data-ch="${c.id}"><option value="">＋添加费用规则…</option>${unset.map(([k,n,t]) => `<option value="${k}">${H(n)}（${t === 'rate' ? '%' : '元'}）</option>`).join('')}</select><button class="btn sm" data-t4cfgadd="${c.id}">添加</button>`
      : '<span class="mut" style="font-size:11px">已包含全部费用规则</span>';
    return card(c.n,
      (rows.length ? table([{t:'参数'},{t:'值',n:1},{t:'单位'},{t:''}], rows)
        : '<div class="mut" style="padding:14px 14px 0">暂无费用规则；用下方「添加费用规则」为本渠道设置分摊。</div>')
      + `<div style="padding:11px 14px;display:flex;gap:7px;align-items:center;flex-wrap:wrap">${addCtrl}<span style="flex:1"></span><button class="btn sm pri" data-t4act="cfgSave">保存参数</button></div>`);
  }).join('');
  return head('T4 参数', '比例基于每日零售收入；月度金额按当月自然日平均分摊。可为每个渠道单独添加费用分摊规则；直接/间接管理费用请在「管理费分摊」页维护。', '工具箱 · T4',
    `<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="cfgReset">恢复底稿值</button><button class="btn pri" data-t4act="cfgSave">保存参数</button>`)
    + '<div class="note w"><b>修改会影响所有对应日期的派生结果。</b>人工录入的同名科目优先于参数值。添加规则后填入数值并「保存参数」生效。</div>' + blocks;
};

S['t4-mgmt'] = () => {
  t4Load();
  const days = t4Days();
  let from = /^\d{4}-\d{2}-\d{2}$/.test(T4.mgmtFrom) ? T4.mgmtFrom : t4Date(1);
  let to = /^\d{4}-\d{2}-\d{2}$/.test(T4.mgmtTo) ? T4.mgmtTo : t4Date(days);
  if (to < from) to = from;
  const rangeN = t4RangeDays(from, to);
  const rows = T4_CH.map(c => {
    const cfg = T4.cfg[c.id] || {};
    const cells = T4_MGMT_FIELDS.map(([k]) =>
      `<input type="number" step="0.01" data-t4mgmt="${c.id}:${k}" data-t4orig="${cfg[k] != null ? cfg[k] : ''}" value="${cfg[k] != null ? cfg[k] : ''}" placeholder="—" style="width:104px">`);
    const total = T4_MGMT_FIELDS.reduce((n, [k]) => n + (+cfg[k] || 0), 0);
    return [t4BuPill(c.bu), `<b>${H(c.n)}</b>`, ...cells,
      `<b class="mono">${money(total)}</b>`, `<span class="mono">${money(total / days)}</span>`,
      `<b class="mono">${money(t4RangeAmount(total, from, to))}</b>`];
  });
  return head('T4 管理费用分摊', `按项目录入各渠道当月分摊金额，系统平均分摊到每一天（月度金额 ÷ 当月自然日）。当前区间 ${from} ～ ${to}，共 ${rangeN} 天；「区间合计」= 日摊 × 区间天数。留空表示该渠道该项目不分摊。`, '工具箱 · T4',
    `<label class="sel">起 <input id="t4MgmtFrom" type="date" value="${from}" style="width:132px"></label><label class="sel">止 <input id="t4MgmtTo" type="date" value="${to}" min="${from}" style="width:132px"></label><button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="mgmtTemplate">下载模板</button><button class="btn" data-t4act="mgmtPick">导入分摊</button><button class="btn pri" data-t4act="mgmtSave">保存分摊</button>`)
    + card(`月度分摊金额（元/月） · 区间 ${from} ～ ${to}（${rangeN} 天）`, table(
      [{t:'归属事业部'},{t:'渠道'}, ...T4_MGMT_FIELDS.map(([,n]) => ({t:n,n:1})), {t:'月合计',n:1},{t:'折算每日',n:1},{t:`区间合计（${rangeN} 天）`,n:1}], rows))
    + '<div class="note"><b>口径：</b>直接管理费用 = 直接人工 + 直接租金物业 + 直接其他管理；间接管理费用 = 人力公摊 + 房租水电公摊 + 其他公摊。每日分摊额 = 月度金额 ÷ 当月自然日，区间跨月时按各月天数分别折算；某天人工或文件实填的同名科目优先于分摊值。修改立即影响对应日期的派生结果与汇总。</div>';
};

S['t4-channels'] = () => {
  t4Load();
  const rows = T4_CH.map(c => [
    `<span class="mono">${H(c.id)}</span>`, t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
    (c.aliases || []).map(H).join('、') || '<span class="mut">—</span>',
    c.custom ? pill('自定义', 'in') : pill('内置', 'mu'),
    c.custom ? `<button class="btn sm" data-t4chdel="${H(c.id)}">移除</button>` : '']);
  return head('T4 渠道列表', `当前 ${T4_CH.length} 个渠道。下载模板修改后导入：按渠道ID（留空则按名称）匹配已有渠道，改名或调整归属事业部；匹配不上的行作为新渠道加入。改名后旧名在数据导入时仍会被识别。`, '工具箱 · T4',
    '<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="chTemplate">下载模板</button><button class="btn pri" data-t4act="chPick">导入渠道列表</button>')
    + card(`渠道清单（${T4_CH.length} 个）`, table([{t:'渠道ID'},{t:'归属事业部'},{t:'渠道汇总'},{t:'关联销售渠道'},{t:'来源'},{t:''}], rows))
    + '<div class="note"><b>与吉客云的关系：</b>渠道列表底稿的「销售渠道」列是吉客云明细里的原始店铺名，导入后挂为对应「渠道汇总」渠道的关联名；此后收入/成本导入吉客云明细时，各店铺数据自动归集到渠道汇总。事业部填大电商、拼多多、瑞眠或经销；新增渠道自动获得录入/导入/分摊全部能力；移除仅限自定义渠道，历史数据保留。</div>';
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
    ['天猫-澳乐旗舰店','平台/售后/物流/仓储/税费','按收入比例计算，比例见参数页'], ['各渠道','管理费用','月度设定值 ÷ 当月自然日'],
  ]))
  + '<div class="note"><b>重复导入是幂等的：</b>每次先清除该文件类型上次写入的字段，再写入本次结果；不同来源不会互相覆盖。</div>';

// 套表数据包：按当前项目筛选裁剪（全部/澳乐/瑞眠），交给服务端 Python 生成多 Sheet 工作簿
function t4SuitePayload() {
  t4Load();
  const days = t4Days(), scope = T4.projFilter;
  const scopeName = (T4_PROJ_OPTS.find(o => o[0] === scope) || T4_PROJ_OPTS[0])[1];
  const chs = t4ProjCH();
  const full = t4TreeNodes()[0];
  const roots = scope === 'all' ? [full] : full.children.filter(p => p.id === 'proj:' + scope);
  const R = n => Math.round((n || 0) * 100) / 100;
  const R6 = n => Math.round((n || 0) * 1e6) / 1e6;   // 每日取数保留全精度，避免分摊值逐日取整后累计漂移
  const mkNode = n => ({ name: n.name, lvl: n.lvl, id: n.children ? null : n.id,
    children: (n.children || []).map(mkNode) });
  const dailyByCh = {}, monthByCh = {};
  chs.forEach(c => {
    const arr = [];
    for (let d = 1; d <= days; d++) {
      const dt = t4Date(d), g = t4DayData(c.id, dt);
      const o = { has: t4DayHasIncome(c.id, dt) || t4MgmtDaily(c.id).any };
      T4_INPUT_KEYS.forEach(k => { o[k] = R6(g[k]); });
      arr.push(o);
    }
    dailyByCh[c.id] = arr;
    const m = t4Month(c.id);
    monthByCh[c.id] = Object.fromEntries(T4_METRICS.map(x => [x.k, R(m[x.k])]));
  });
  return { period: T4.period, days, scope, scopeName, generated: new Date().toLocaleString('zh-CN'),
    metrics: T4_METRICS.map(m => ({ k: m.k, n: m.n.trim(), lvl: m.lvl || 0, pct: !!m.pct })),
    inputKeys: T4_INPUT_KEYS,
    channels: chs.map(c => ({ id: c.id, name: c.n, project: t4Project(c.bu), bu: c.bu, buName: t4BuName(c.bu), filled: t4Filled(c.id) })),
    tree: roots.map(mkNode), dailyByCh, monthByCh };
}

// 浏览器端套表兜底：线上若只托管静态文件、没有转发 /api/t4/suite，仍要导出真正的多 Sheet xlsx。
function t4SuiteClientWorkbook(payload) {
  if (!window.XLSXWrite || typeof XLSXWrite.build !== 'function') throw new Error('Excel 导出组件未加载');
  const metric = (ids, k) => {
    const sum = key => ids.reduce((n, id) => n + Number((payload.monthByCh[id] || {})[key] || 0), 0);
    if (k === 'grossMargin') { const d = sum('salesIncome'); return d ? sum('grossProfit') / d : 0; }
    if (k === 'contributionRate') { const d = sum('salesIncome'); return d ? sum('contribution') / d : 0; }
    if (k === 'netMargin') { const d = sum('salesIncome'); return d ? sum('netProfit') / d : 0; }
    return sum(k);
  };
  const val = (v, pct) => pct ? `${(Number(v || 0) * 100).toFixed(2)}%` : { n: Number(v || 0) };
  const leaves = node => node.children && node.children.length
    ? node.children.reduce((out, child) => out.concat(leaves(child)), []) : (node.id ? [node.id] : []);
  const sheets = [], used = new Set();
  const sheetName = raw => {
    const base = String(raw || '报表').replace(/[\\/*?:\[\]]/g, '·').slice(0, 28) || '报表';
    let name = base, i = 2;
    while (used.has(name)) name = `${base.slice(0, 25)}~${i++}`;
    used.add(name); return name;
  };
  const meta = title => [[{ h: title }], [`期间：${payload.period}`, `范围：${payload.scopeName}`, `生成：${payload.generated}`], []];

  const summary = meta(`财务中心 · T4 日损益套表（${payload.scopeName}）`);
  // 总表采用标准利润表方向：损益科目纵向，组织层级横向。
  // 渠道已有独立明细 Sheet，总表只放全部/项目/事业部，避免再次横向铺满所有渠道。
  const summaryNodes = [];
  const collectSummaryNode = (node, depth) => {
    if (!node.children || !node.children.length) return;
    const isBu = node.children.every(child => !child.children || !child.children.length);
    summaryNodes.push({ node, depth, isBu, ids: leaves(node) });
    node.children.forEach(child => collectSummaryNode(child, depth + 1));
  };
  payload.tree.forEach(root => collectSummaryNode(root, 0));
  summary.push([{ h: '损益项目' }, ...summaryNodes.map(x => ({ h: `${x.isBu ? '└ ' : ''}${x.node.name}` }))]);
  payload.metrics.forEach(m => summary.push([
    `${m.lvl ? '　' : ''}${m.n}`,
    ...summaryNodes.map(x => val(metric(x.ids, m.k), m.pct)),
  ]));
  summary.push([], ['实取渠道', ...summaryNodes.map(x => {
    const got = x.ids.filter(id => (payload.channels.find(ch => ch.id === id) || {}).filled > 0).length;
    return `${got}/${x.ids.length}`;
  })]);
  sheets.push({ name: sheetName('总表'), rows: summary });

  const byBu = [];
  payload.channels.forEach(ch => {
    let group = byBu.find(x => x.bu === ch.bu);
    if (!group) { group = { bu: ch.bu, name: ch.buName, channels: [] }; byBu.push(group); }
    group.channels.push(ch);
  });
  byBu.forEach(group => {
    const rows = meta(`${group.name} · 渠道对比`);
    rows.push([{ h: '损益项目' }, { h: `${group.name}合计` }, ...group.channels.map(ch => ({ h: ch.name }))]);
    payload.metrics.forEach(m => rows.push([m.n, val(metric(group.channels.map(ch => ch.id), m.k), m.pct),
      ...group.channels.map(ch => val((payload.monthByCh[ch.id] || {})[m.k], m.pct))]));
    sheets.push({ name: sheetName(group.name), rows });
  });

  payload.channels.forEach(ch => {
    const rows = meta(`${ch.name} · 每日利润表`);
    rows.push([{ h: '损益项目' }, { h: '合计' }, ...Array.from({ length: payload.days }, (_, i) => ({ h: `${i + 1}日` }))]);
    const daily = Array.from({ length: payload.days }, (_, i) => t4DayData(ch.id, t4Date(i + 1)));
    payload.metrics.forEach(m => rows.push([m.n, val((payload.monthByCh[ch.id] || {})[m.k], m.pct),
      ...daily.map((day, i) => (payload.dailyByCh[ch.id] || [])[i]?.has ? val(day[m.k], m.pct) : '')]));
    sheets.push({ name: sheetName(ch.name), rows });
  });
  return XLSXWrite.build(sheets);
}

// 导出整套报表：优先服务端生成带公式/超链接的工作簿；接口不可用时在浏览器生成多 Sheet xlsx。
async function t4ExportSuite() {
  const payload = t4SuitePayload();
  toast('正在生成套表工作簿…');
  try {
    const res = await fetch('/api/t4/suite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200));
    const blob = await res.blob();
    downloadBlob(`T4日损益套表_${payload.scopeName}_${payload.period}.xlsx`, blob);
    toast(`套表已生成：${payload.scopeName} · ${payload.channels.length} 个渠道（总表/渠道对比/逐日明细）`, 4500);
  } catch (serverError) {
    try {
      const blob = t4SuiteClientWorkbook(payload);
      downloadBlob(`T4日损益套表_${payload.scopeName}_${payload.period}.xlsx`, blob);
      toast(`套表已生成：${payload.scopeName} · ${payload.channels.length} 个渠道（浏览器多 Sheet 版）`, 5000);
    } catch (clientError) {
      toast(`套表生成失败：${clientError.message || clientError}；服务端：${serverError.message || serverError}`, 8000);
    }
  }
}

// CSV 回退版（总分区块，单表）
function t4ExportSuiteCsv() {
  t4Load();
  const days = t4Days(), period = T4.period;
  const money = v => (Number(v) || 0).toFixed(2);
  const fmt = (g, m) => m.pct ? `${((g[m.k] || 0) * 100).toFixed(2)}%` : money(t4TreeVal(g, m.k));
  const sumCols = [['salesIncome', '销售收入'], ['salesCost', '销售成本'], ['grossProfit', '毛利'], ['grossMargin', '毛利率', true], ['operating', '运营费'], ['contribution', '边际毛利'], ['mgmt', '管理费'], ['netProfit', '净利润'], ['netMargin', '净利率', true]];
  const out = [];
  const push = row => out.push(row);
  const blank = () => out.push([]);

  push([`财务中心 · T4 日损益套表`]);
  push([`期间：${period}`, `导出时间：${new Date().toLocaleString('zh-CN')}`, `实取渠道：${T4_CH.filter(c => t4Filled(c.id) > 0).length}/${T4_CH.length}`]);
  blank();

  // —— 一、总分汇总（树）——
  push(['【一、总分汇总】全部 → 项目 → 事业部 → 渠道，父级为子级之和']);
  push(['层级/名称', ...sumCols.map(c => ({ pct: c[2], n: c[1] }).n)]);
  const walk = (node, lvl) => {
    const g = t4Group(node.ids);
    push(['　'.repeat(lvl) + node.name, ...sumCols.map(c => fmt(g, { k: c[0], pct: c[2] }))]);
    (node.children || []).forEach(ch => walk(ch, lvl + 1));
  };
  walk(t4TreeNodes()[0], 0);
  blank(); blank();

  // —— 二、渠道月度对比（全科目 × 渠道）——
  push(['【二、渠道月度对比】损益科目 × 各渠道（当月累计）']);
  push(['损益项目', ...T4_CH.map(c => c.n), '全部合计']);
  const monthByCh = {}; T4_CH.forEach(c => monthByCh[c.id] = t4Month(c.id));
  const allG = t4Group(T4_ALL);
  T4_METRICS.forEach(m => {
    const nm = (m.lvl ? '　' : '') + m.n.trim();
    push([nm, ...T4_CH.map(c => m.pct ? `${((monthByCh[c.id][m.k] || 0) * 100).toFixed(2)}%` : money(monthByCh[c.id][m.k])),
      m.pct ? `${((allG[m.k] || 0) * 100).toFixed(2)}%` : money(allG[m.k])]);
  });
  blank(); blank();

  // —— 三、各渠道每日利润表（分表）——
  push([`【三、渠道每日利润表】${period} 逐日，仅列有数据的渠道`]);
  blank();
  T4_CH.forEach(c => {
    if (t4Filled(c.id) === 0 && !t4MgmtDaily(c.id).any) return;  // 完全无数据的渠道跳过
    const daily = [], has = [];
    for (let d = 1; d <= days; d++) { const dt = t4Date(d); daily.push(t4DayData(c.id, dt)); has.push(t4DayHasIncome(c.id, dt) || t4MgmtDaily(c.id).any); }
    const m = t4Month(c.id);
    push([`▼ ${c.n}（${t4Project(c.bu)} / ${t4BuName(c.bu)}） 实取 ${t4Filled(c.id)}/${days} 天`]);
    push(['损益项目', '合计', ...Array.from({ length: days }, (_, i) => `${i + 1}日`)]);
    T4_METRICS.forEach(mt => {
      const nm = (mt.lvl ? '　' : '') + mt.n.trim();
      const total = mt.pct ? `${((m[mt.k] || 0) * 100).toFixed(2)}%` : money(m[mt.k]);
      push([nm, total, ...daily.map((g, i) => has[i] ? (mt.pct ? `${((g[mt.k] || 0) * 100).toFixed(2)}%` : money(g[mt.k])) : '')]);
    });
    blank();
  });

  download(`T4日损益套表_${period}.csv`, toCSV(out));
  toast('已导出整套报表（总分模式），Excel 打开即可');
}

function t4DayExport() {
  const c = T4_CHM[T4.dayCh]; if (!c) return;
  const days = t4Days();
  const daily = [], has = [];
  for (let d = 1; d <= days; d++) { const dt = t4Date(d); daily.push(t4DayData(c.id, dt)); has.push(t4DayHasIncome(c.id, dt) || t4MgmtDaily(c.id).any); }
  const m = t4Month(c.id);
  const hdr = ['损益项目', ...Array.from({ length: days }, (_, i) => `${T4.period}-${String(i + 1).padStart(2, '0')}`), '合计'];
  const fmt = (g, metric) => metric.pct ? `${(g[metric.k] * 100).toFixed(2)}%` : (g[metric.k] || 0).toFixed(2);
  const rows = T4_METRICS.map(metric => [metric.n.trim(),
    ...daily.map((g, i) => has[i] ? fmt(g, metric) : ''), fmt(m, metric)]);
  download(`每日损益_${c.n}_${T4.period}.csv`, toCSV([hdr, ...rows])); toast('已导出每日损益明细');
}
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
  if (nav) {
    const [v,ch] = nav.dataset.t4go.split(':');
    if (ch && (v === 'sumimp' || v === 'summan')) T4.sumScope = ch;
    else if (ch) T4.editCh = ch;
    if (v === 'imp' || v === 'sumimp') T4.imp = null; t4Go(v); return;
  }
  const file = e.target.closest('[data-t4file]'); if (file) { t4PickFile(file.dataset.t4file); return; }
  const mdel = e.target.closest('[data-t4maildel]');
  if (mdel) { t4MailReadForm(); T4.mail.list.splice(+mdel.dataset.t4maildel, 1); t4Go('mail'); return; }
  const tree = e.target.closest('[data-t4tree]');
  if (tree) { const id = tree.dataset.t4tree; T4.treeCollapsed[id] = !T4.treeCollapsed[id]; t4Go('sheet'); return; }
  const chdel = e.target.closest('[data-t4chdel]');
  if (chdel) {
    t4SaveChOverrides(t4ChOverrides().filter(x => x.id !== chdel.dataset.t4chdel));
    t4RebuildChannels(); t4Load(); toast('已移除自定义渠道（历史数据保留）'); t4Go('channels'); return;
  }
  const cfgadd = e.target.closest('[data-t4cfgadd]');
  if (cfgadd) {
    const ch = cfgadd.dataset.t4cfgadd, sel = document.querySelector(`.t4addsel[data-ch="${ch}"]`), key = sel && sel.value;
    if (!key) { toast('请先选择要添加的费用规则'); return; }
    t4CfgReadInputs(); (T4.cfg[ch] = T4.cfg[ch] || {})[key] = 0; t4SaveCfg();
    const meta = T4_CFG_FIELDS.find(x => x[0] === key);
    toast(`已为「${T4_CHM[ch].n}」添加「${meta[1]}」，请填入数值后保存`); t4Go('cfg'); return;
  }
  const cfgdel = e.target.closest('[data-t4cfgdel]');
  if (cfgdel) {
    const [ch, key] = cfgdel.dataset.t4cfgdel.split(':');
    t4CfgReadInputs(); if (T4.cfg[ch]) delete T4.cfg[ch][key]; t4SaveCfg();
    toast('已删除该费用规则'); t4Go('cfg'); return;
  }
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
  else if (a.dataset.t4act === 'exportSuite') t4ExportSuite();
  else if (a.dataset.t4act === 'dayExport') t4DayExport();
  else if (a.dataset.t4act === 'mailAdd') {
    t4MailReadForm();
    const g = id => (document.getElementById(id) || {}).value || '';
    const name = g('t4MailNewName').trim(), email = g('t4MailNewAddr').trim(), scope = g('t4MailNewScope') || 'all';
    if (!T4_EMAIL_RE.test(email)) { toast('请输入有效邮箱'); return; }
    T4.mail.list.push({ name, email, scope, enabled: true }); t4Go('mail');
  }
  else if (a.dataset.t4act === 'mailSave') { t4MailReadForm(); t4MailSaveList().then(r => toast(r.ok ? '收件人已保存（服务端，多端共用）' : '保存失败')).catch(() => toast('保存失败：服务端不可达')); }
  else if (a.dataset.t4act === 'mailSend') t4MailSend();
  else if (a.dataset.t4act === 'smtpSave') t4SmtpSave();
  else if (a.dataset.t4act === 'smtpTest') t4SmtpTest();
  else if (a.dataset.t4act === 'cfgSave') {
    t4CfgReadInputs();
    t4SaveCfg(); toast('✓ 参数已保存，损益表已按新规则重算', 3500);  // 留在本页，不跳转，滚动位置不丢
  } else if (a.dataset.t4act === 'cfgReset') {
    // 只重置比例类底稿参数；管理费分摊是用户数据，原样保留
    const keep = {};
    T4_CH.forEach(c => { const cur = T4.cfg[c.id] || {}; keep[c.id] = {}; T4_MGMT_FIELDS.forEach(([k]) => { if (cur[k] != null) keep[c.id][k] = cur[k]; }); });
    T4.cfg = t4Clone(T4_CFG_DEFAULT);
    T4_CH.forEach(c => { T4.cfg[c.id] = Object.assign(T4.cfg[c.id] || {}, keep[c.id]); });
    t4SaveCfg(); toast('已恢复底稿参数（管理费分摊保留）'); t4Go('cfg');
  }
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
  else if (a.dataset.t4act === 'chTemplate') t4ChTemplate();
  else if (a.dataset.t4act === 'chPick') t4ChPickFile();
  else if (a.dataset.t4act === 'sheetMode') { T4.sheetMode = T4.sheetMode === 'tree' ? 'matrix' : 'tree'; t4Go('sheet'); }
  else if (a.dataset.t4act === 'wipePeriod') {
    // 两步确认：先弹窗说明，再要求手动输入期间号，防误触
    if (!confirm(`确认清空 ${T4.period} 期间全部渠道的收入、成本与费用数据？\n参数、管理费分摊和渠道列表不受影响，此操作不可恢复。\n\n点「确定」后还需输入期间号做二次确认。`)) return;
    const typed = prompt(`二次确认：请输入当前期间「${T4.period}」以执行清空`);
    if (typed == null) { toast('已取消清空'); return; }
    if (String(typed).trim() !== T4.period) { toast(`输入「${String(typed).trim()}」与当前期间不一致，已取消清空`, 4200); return; }
    T4.data = {}; T4_CH.forEach(c => { T4.data[c.id] = {}; });
    t4Save(); toast(`已清空 ${T4.period} 全部录入与导入数据`); t4Go('overview');
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 't4Period') { T4.period = e.target.value || T4.period; T4.imp = null; T4.viewFrom = ''; T4.viewTo = ''; t4Go('overview'); }
  else if (e.target.id === 't4ProjSel') { T4.projFilter = e.target.value || 'all'; t4Go(e.target.dataset.view === 'sheet' ? 'sheet' : 'overview'); }
  else if (e.target.id === 't4DayCh') { T4.dayCh = e.target.value || T4_CH[0].id; t4Go('chday'); }
  else if (e.target.id === 't4SmtpPreset') {   // 选服务商自动填 SMTP 参数
    const p = T4_SMTP_PRESETS[e.target.value]; if (!p) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    if (p.host) { set('t4SmtpHost', p.host); set('t4SmtpPort', String(p.port)); set('t4SmtpSecure', p.secure); }
    const tip = document.getElementById('t4SmtpTip'); if (tip) tip.textContent = p.tip;
  }
  else if (e.target.id === 't4ViewFrom' || e.target.id === 't4ViewTo') {
    if (e.target.id === 't4ViewFrom') T4.viewFrom = e.target.value || ''; else T4.viewTo = e.target.value || '';
    if (T4.viewFrom && T4.viewTo && T4.viewTo < T4.viewFrom) T4.viewTo = T4.viewFrom;
    t4Go(e.target.dataset.view === 'sheet' ? 'sheet' : 'overview');
  }
  else if (e.target.id === 't4MgmtFrom' || e.target.id === 't4MgmtTo') {
    if (e.target.id === 't4MgmtFrom') T4.mgmtFrom = e.target.value || ''; else T4.mgmtTo = e.target.value || '';
    if (T4.mgmtFrom && T4.mgmtTo && T4.mgmtTo < T4.mgmtFrom) T4.mgmtTo = T4.mgmtFrom;
    if (T4.mgmtFrom && T4.mgmtFrom.slice(0, 7) !== T4.period) { T4.period = T4.mgmtFrom.slice(0, 7); T4.imp = null; T4.viewFrom = ''; T4.viewTo = ''; }
    t4Go('mgmt');
  }
  else if (e.target.id === 't4chSel') { T4.editCh = e.target.value; t4Go('man'); }
  else if (e.target.id === 't4SumDate') { T4.sumDate = e.target.value || t4Date(1); t4Go('summan'); }
  else if (e.target.id === 't4head' && T4.imp) { T4.imp.headRow = +e.target.value; T4.imp.map = t4AutoMap(T4.imp.rows[T4.imp.headRow] || [], T4_FILE_DEFS[T4.imp.fileK]); t4Go(T4.imp.mode === 'summary' ? 'sumimp' : 'imp'); }
  else if (e.target.dataset && e.target.dataset.t4map && T4.imp) { const k = e.target.dataset.t4map; if (e.target.value === '') delete T4.imp.map[k]; else T4.imp.map[k] = +e.target.value; t4Go(T4.imp.mode === 'summary' ? 'sumimp' : 'imp'); }
});
