/* T4 日损益表
   依据澳乐事业部 2026-08 日损益底稿重构：渠道明细 → 子组 → 大电商/拼多多/经销事业部 → 全部汇总。
   原始值、比例/按月分摊值与硬推值分开保存，汇总一律由工具重算。 */
'use strict';

const T4_GAP_LIMIT = 2;
const T4_KEY = 'fsc_t4_data_v2';
const T4_CFG_KEY = 'fsc_t4_cfg_v1';
const T4_PERIOD_CFG_KEY = 'fsc_t4_cfg_periods_v1';
const T4_LOCK_KEY = 'fsc_t4_period_locks_v1';
const T4_IMPORT_HISTORY_KEY = 'fsc_t4_import_history_v1';
const T4_PENDING_DRAFT_KEY = 'fsc_t4_pending_migration_v1';
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
  { id: 'tm_orange', n: '天猫-橘农旗舰店', bu: 'orange', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「天猫-橘农滋补养生旗舰店」' }] },
  { id: 'tb_orange', n: '淘宝-橘农滋补企业店', bu: 'orange', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「淘宝-橘农滋补企业店」' }] },
  { id: 'jd_orange', n: '京东-橘农旗舰店', bu: 'orange', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「京东-橘农旗舰店」' }] },
  { id: 'dy_orange', n: '抖音-橘农滋补旗舰店', bu: 'orange', tier: '直属', files: [T4_DAILY_FILE, { k: 'sales', n: '销售单明细账', hint: '仅取「抖音-橘农滋补旗舰店」' }] },
  { id: 'tianmen', n: '分销-微商-天门（1688）', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'gift', n: '分销-澳乐礼品单', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'supply', n: '电商供货', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'dealer_retail', n: '分销-澳乐自营（零售）', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
  { id: 'dealer_1688', n: '分销-澳乐自营（1688）', bu: 'dealer', tier: '直属', files: [T4_DAILY_FILE] },
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
  '抖音-橘农滋补旗舰店': 'dy_orange',
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
  '分销-澳乐自营（零售）': 'dealer_retail',
  '分销-澳乐礼品单': 'gift',
  '分销-澳乐自营（1688）': 'dealer_1688',
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
const T4_EXPENSE_ITEMS_KEY = 'fsc_t4_expense_items_v1';
let T4_CH = [], T4_CHM = {}, T4_TMAI = [], T4_BIG_ECOM = [], T4_PDD = [], T4_RUIMIAN = [], T4_ORANGE = [], T4_DEALER = [], T4_ALL = [];
function t4ChOverrides() { try { const v = JSON.parse(localStorage.getItem(T4_CHLIST_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function t4SaveChOverrides(list) { localStorage.setItem(T4_CHLIST_KEY, JSON.stringify(list)); }
function t4ChannelList(overrides) {
  const base = T4_CH_BASE.map(c => ({ ...c }));
  overrides.forEach(o => {
    const hit = base.find(c => c.id === o.id);
    if (hit) {
      if (o.n && o.n !== hit.n) { hit.aliases = (hit.aliases || []).concat(hit.n); hit.n = o.n; }
      if (o.bu) hit.bu = o.bu;
      if (o.aliases) hit.aliases = (hit.aliases || []).concat(o.aliases);
      if (o.details) hit.details = o.details;
    } else if (o.n) {
      base.push({ id: o.id, n: o.n, bu: o.bu || 'dealer', tier: '直属', files: [T4_DAILY_FILE], aliases: o.aliases || [], details: o.details || [], custom: true });
    }
  });
  return base;
}
function t4RebuildChannels() {
  T4_CH = t4ChannelList(t4ChOverrides());
  T4_CHM = Object.fromEntries(T4_CH.map(c => [c.id, c]));
  T4_TMAI = T4_CH.filter(c => c.tier === '特卖').map(c => c.id);
  T4_BIG_ECOM = T4_CH.filter(c => c.bu === 'ecom').map(c => c.id);
  T4_PDD = T4_CH.filter(c => c.bu === 'pdd').map(c => c.id);
  T4_RUIMIAN = T4_CH.filter(c => c.bu === 'ruimian').map(c => c.id);
  T4_ORANGE = T4_CH.filter(c => c.bu === 'orange').map(c => c.id);
  T4_DEALER = T4_CH.filter(c => c.bu === 'dealer').map(c => c.id);
  T4_ALL = T4_CH.map(c => c.id);
}
t4RebuildChannels();
const T4_BU_META = {
  ecom: { n: '大电商事业部', short: '大电商', pill: 'in' },
  pdd: { n: '拼多多事业部', short: '拼多多', pill: 'ok' },
  ruimian: { n: '瑞眠事业部', short: '瑞眠', pill: 'mu' },
  orange: { n: '橘农事业部', short: '橘农', pill: 'ok' },
  dealer: { n: '经销事业部', short: '经销', pill: 'wa' },
};
const t4BuName = id => (T4_BU_META[id] || {}).n || id;
// 项目层：瑞眠事业部归瑞眠项目，其余（大电商/拼多多/经销）归澳乐项目
const t4ProjectId = bu => ['ruimian', 'orange'].includes(bu) ? bu : 'aole';
const t4Project = bu => ({ ruimian: '瑞眠项目', orange: '橘农项目', aole: '澳乐项目' })[t4ProjectId(bu)];
const t4ProjectPill = bu => pill(t4Project(bu), bu === 'ruimian' ? 'mu' : bu === 'orange' ? 'ok' : 'in');
const t4BuPill = id => { const m = T4_BU_META[id] || { short:id, pill:'mu' }; return pill(m.short, m.pill); };

const T4_INPUTS = [
  { k: 'retailIncome', n: '零售收入', g: '销售与成本' },
  { k: 'returnAmount', n: '退货金额', g: '销售与成本' },
  { k: 'refundAmount', n: '退款金额', g: '销售与成本' },
  { k: 'rebateAmount', n: '返款金额（扣减收入）', g: '销售与成本' },
  { k: 'retailCost', n: '零售成本', g: '销售与成本' },
  { k: 'returnCost', n: '退货成本', g: '销售与成本' },
  { k: 'rebateIncome', n: '返利收入（计入净利润）', g: '返款' },
  { k: 'salesReceipt', n: '销售回款（仅记录）', g: '返款' },
  { k: 'platformFee', n: '平台扣点', g: '运营费用' },
  { k: 'platformOther', n: '平台其他', g: '运营费用' },
  { k: 'promotion', n: '推广费用', g: '运营费用' },
  { k: 'ztc', n: '直通车', g: '运营费用' },
  { k: 'cps', n: 'CPS', g: '运营费用' },
  { k: 'research', n: '数研', g: '运营费用' },
  { k: 'aftersales', n: '售后费用', g: '运营费用' },
  { k: 'logistics', n: '快递物流', g: '运营费用' },
  { k: 'shippingInsurance', n: '运费险', g: '运营费用' },
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
  { k: 'rebateAmount', n: '　返款金额', lvl: 1 },
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
  { k: 'shippingInsurance', n: '　运费险', lvl: 1 },
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
  { k: 'rebateIncome', n: '返利收入', lvl: 0 },
  { k: 'netProfit', n: '净利润', lvl: 0 },
  { k: 'netMargin', n: '净利润率', pct: true, lvl: 0 },
  { k: 'salesReceipt', n: '销售回款（仅记录）', lvl: 0 },
];

// Keep the arrays themselves stable: the import, entry and export views share them.
const T4_BASE_INPUTS = T4_INPUTS.slice();
const T4_BASE_METRICS = T4_METRICS.slice();
const t4OperatingKeys = () => T4_INPUTS.filter(f => f.g === '运营费用').map(f => f.k);
function t4ApplyExpenseItems(items = []) {
  T4.expenseItems = Array.isArray(items) ? items.filter(x => x && /^expense_[a-z0-9_]{1,64}$/.test(x.k)
    && typeof x.n === 'string').map(x => ({ k: x.k, n: x.n })) : [];
  const inputs = T4.expenseItems.map(x => ({ ...x, g: '运营费用' }));
  const inputAt = T4_BASE_INPUTS.findIndex(f => f.g === '直接管理费用');
  T4_INPUTS.splice(0, T4_INPUTS.length, ...T4_BASE_INPUTS.slice(0, inputAt), ...inputs, ...T4_BASE_INPUTS.slice(inputAt));
  T4_INPUT_KEYS.splice(0, T4_INPUT_KEYS.length, ...T4_INPUTS.map(x => x.k));
  const metricAt = T4_BASE_METRICS.findIndex(f => f.k === 'direct');
  T4_METRICS.splice(0, T4_METRICS.length, ...T4_BASE_METRICS.slice(0, metricAt),
    ...inputs.map(x => ({ k: x.k, n: '　' + x.n, lvl: 1 })), ...T4_BASE_METRICS.slice(metricAt));
  // Dynamic daily columns remain available to standard imports as well.
  for (const name of ['daily', 'summaryDaily']) {
    const fields = T4_FILE_DEFS[name].fields;
    const base = fields.filter(([k]) => !k.startsWith('expense_'));
    fields.splice(0, fields.length, ...base, ...inputs.map(x => [x.k, x.n, [x.n]]));
  }
}

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
  ['shippingInsuranceRate', '运费险', 'rate'],
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
    ['refundAmount', '退款金额', ['退款金额']], ['rebateAmount', '返款金额', ['返款金额', '返款', '返款金额（扣减收入）']], ['retailCost', '零售成本', ['零售成本']],
    ['returnCost', '退货成本', ['退货成本']], ['rebateIncome', '返利收入', ['返利收入']], ['salesReceipt', '销售回款（仅记录）', ['销售回款', '销售回款（仅记录）']], ['platformFee', '平台扣点', ['平台扣点']],
    ['platformOther', '平台其他', ['平台其他']], ['promotion', '推广费用', ['推广费用', '推广费']],
    ['ztc', '直通车', ['直通车']], ['cps', 'CPS', ['CPS']], ['research', '数研', ['数研']],
    ['aftersales', '售后费用', ['售后费用']], ['logistics', '快递物流', ['快递物流', '快递费', '物流费']],
    ['shippingInsurance', '运费险', ['运费险', '运费险费用', '退换货运费险']],
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
    ['product', '货品名称', ['货品名称', '商品名称', '产品名称']],
    // 吉客云明细列名：发货时间→日期、分摊后金额→销售收入、货品成本→销售成本
    ...T4_FILE_DEFS.daily.fields.map(f =>
      f[0] === 'date' ? ['date', '日期', ['日期', '发货时间']]
      : f[0] === 'retailIncome' ? ['retailIncome', '零售收入', ['零售收入', '分摊后金额']]
      : f[0] === 'retailCost' ? ['retailCost', '零售成本', ['零售成本', '货品成本']] : f),
  ],
  required: ['channel', 'date'],
};

// 共享存储把期间当路径段用，服务端只认 20xx-01..12（sync_api.py 的 PERIOD_RE）。
// 不合规的期间或陈旧的锁定键会让整批变更被拒成 invalid change path，因此在
// 组装文档前就地拦下来，并且明确告诉用户是哪一类问题。
const T4_PERIOD_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
function t4ValidPeriod(period) { return typeof period === 'string' && T4_PERIOD_RE.test(period); }
function t4AssertPeriod(period) {
  if (!t4ValidPeriod(period)) {
    throw new Error(`期间「${period || '空'}」不是有效月份（需 2000-01 至 2099-12）。请重新选择月份后再操作`);
  }
  return period;
}
// 只保留键合规的锁定项；坏键一旦进过 localStorage 会永久堵死本浏览器的保存。
function t4SanePeriodLocks(locks) {
  const clean = {}; const dropped = [];
  Object.keys(locks || {}).forEach(k => {
    if (t4ValidPeriod(k)) clean[k] = !!locks[k]; else dropped.push(k);
  });
  return { clean, dropped };
}
const T4 = { period: new Date().toISOString().slice(0, 7), data: {}, cfg: {}, editCh: 'tmall', imp: null, sumDate: '', sumTo: '', manFrom: '', manTo: '', sumScope: 'both', importHistory: {}, importFeedback: null, viewFrom: '', viewTo: '', mgmtFrom: '', mgmtTo: '', sheetMode: 'tree', treeCollapsed: {}, projFilter: 'all', dayCh: 'tmall',
  expenseItems: [], expenseCh: 'tmall', expenseDate: '', expenseEdits: {}, channelDraft: null, expenseDraft: null, catalogError: '',
  mail: { list: [], status: null, loaded: false, loading: false, result: null, subject: '', body: '' } };

// 项目筛选：全部 / 澳乐（大电商+拼多多+经销）/ 瑞眠
const T4_PROJ_OPTS = [['all', '全部项目'], ['aole', '澳乐项目'], ['ruimian', '瑞眠项目'], ['orange', '橘农项目']];
const t4InProj = bu => T4.projFilter === 'all' || t4ProjectId(bu) === T4.projFilter;
const t4ProjCH = () => T4_CH.filter(c => t4InProj(c.bu));
const t4ProjSelect = view => `<label class="sel">项目 <select id="t4ProjSel" data-view="${view}">${T4_PROJ_OPTS.map(([v, n]) => `<option value="${v}" ${T4.projFilter === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;

/* 合并入口保留收入/成本两个来源分区，旧导入与单科目文件继续兼容。 */
const T4_SUM_SCOPES = {
  both: { n: '收入与成本', fileK: 'summaryDaily', keys: ['retailIncome', 'returnAmount', 'refundAmount', 'rebateAmount', 'retailCost', 'returnCost'] },
  income: { n: '销售收入', fileK: 'summaryIncome', keys: ['retailIncome', 'returnAmount', 'refundAmount', 'rebateAmount'] },
  cost: { n: '销售成本', fileK: 'summaryCost', keys: ['retailCost', 'returnCost'] },
};
const t4SumScope = () => T4_SUM_SCOPES[T4.sumScope] || T4_SUM_SCOPES.both;

function t4Clone(x) { return JSON.parse(JSON.stringify(x)); }
let T4_SERVER_VERSION = null;
let T4_SERVER_LOADING = false;
let T4_SERVER_LAST_KEY = '';
let T4_SERVER_ERROR = null;
let T4_SERVER_READY = false;
let T4_SERVER_DOCUMENT = null;
let T4_SERVER_BASELINE = null;
let T4_LOADED_PERIOD = '';
let T4_SERVER_SAVING = false;
let T4_PENDING_DRAFT = null;
function t4Stored(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (_) { return fallback; } }
function t4CurrentMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}
function t4IsPeriodLocked(period = T4.period) {
  const locks = T4.periodLocks || t4Stored(T4_LOCK_KEY, {});
  return typeof locks[period] === 'boolean' ? locks[period] : period < t4CurrentMonth();
}
function t4AssertEditable() {
  if (T4_SERVER_LOADING || T4_SERVER_SAVING) throw new Error('正在同步，请稍后再操作');
  if (t4IsPeriodLocked()) throw new Error(`${T4.period} 已锁定，请先解锁该月再修改`);
}
function t4RequireServerReady() {
  if (T4_SERVER_LOADING || T4_SERVER_SAVING) throw new Error('正在同步，请稍后再操作');
  if (T4_SERVER_ERROR && T4_SERVER_ERROR.status === 401) {
    throw new Error('请先登录财务中心，本次修改未写入服务器');
  }
  if (T4_SERVER_READY) return;
  if (T4_SERVER_LAST_KEY.startsWith('error:')) {
    throw new Error('未能连接财务中心，请重新连接后再试，本次修改未写入服务器');
  }
  throw new Error('共享数据未连接，本次修改未写入服务器');
}
function t4SyncStatus() {
  if (T4_SERVER_LOADING) return pill('正在连接财务中心…', 'mu');
  if (T4_SERVER_ERROR && T4_SERVER_ERROR.status === 401) {
    return pill('请先登录财务中心', 'wa') + '<a href="/sso/login" class="btn sm pri">登录财务中心</a>';
  }
  if (T4_SERVER_READY) return pill('已连接财务中心，可保存', 'ok');
  const retry = T4_SERVER_LAST_KEY.startsWith('error:')
    ? '<button class="btn sm" data-t4act="retrySync">重新连接</button>' : '';
  return pill('未能连接财务中心', 'wa') + retry;
}
function t4ConfigForPeriod(doc, period) {
  const saved = (doc.cfgByPeriod || {})[period] || doc.cfg || {};
  const cfg = t4Clone(T4_CFG_DEFAULT);
  T4_CH.forEach(c => { cfg[c.id] = Object.assign(cfg[c.id] || {}, saved[c.id] || {}); });
  return cfg;
}
function t4ApplyPeriod(doc) {
  t4ApplyExpenseItems(doc.expenseItems || []);
  T4.data = t4Clone((doc.periods || {})[T4.period] || {});
  T4.cfg = t4ConfigForPeriod(doc, T4.period);
  T4.periodLocks = t4Clone(doc.periodLocks || {});
  T4.importHistory = t4Clone(doc.importHistory || {});
  T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; });
  t4MigrateFileParts();
  T4_LOADED_PERIOD = T4.period;
  T4_SERVER_BASELINE = t4ViewDocument(doc);
}
function t4ViewDocument(source = T4_SERVER_DOCUMENT) {
  const doc = window.T4Shared.clone(source || window.T4Shared.empty());
  t4AssertPeriod(T4.period);
  doc.periods = doc.periods || {}; doc.periods[T4.period] = t4Clone(T4.data);
  doc.cfgByPeriod = doc.cfgByPeriod || {}; doc.cfgByPeriod[T4.period] = t4Clone(T4.cfg);
  const locks = t4SanePeriodLocks(T4.periodLocks);
  if (locks.dropped.length) {
    // 坏键只丢弃、不上传；同时修正内存与本地存储，避免下次保存又被拒。
    T4.periodLocks = locks.clean;
    try { localStorage.setItem(T4_LOCK_KEY, JSON.stringify(locks.clean)); } catch (e) {}
    toast(`已清理无效的月份锁定记录：${locks.dropped.slice(0, 3).join('、')}`, 4200);
  }
  doc.periodLocks = t4Clone(locks.clean);
  doc.channels = t4ChOverrides();
  doc.importHistory = t4Clone(T4.importHistory || {});
  doc.expenseItems = t4Clone(T4.expenseItems);
  return doc;
}
function t4EntityKey() {
  try { return localStorage.getItem('fsc_cur_ent') || 'global'; } catch (e) { return 'global'; }
}
async function t4LoadServer() {
  if (T4_SERVER_LOADING || T4_SERVER_READY || T4_SERVER_LAST_KEY.startsWith('error:')) return;
  T4_SERVER_LOADING = true;
  T4_SERVER_ERROR = null;
  try {
    const x = await window.T4Shared.load();
    T4_SERVER_VERSION = x.version; T4_SERVER_DOCUMENT = x.document || window.T4Shared.empty();
    const pending = t4Stored(T4_PENDING_DRAFT_KEY, null);
    if (pending && pending.period && pending.data && pending.cfg) {
      const cloudData = (T4_SERVER_DOCUMENT.periods || {})[pending.period] || {};
      if (!Object.values(cloudData).some(days => Object.keys(days || {}).length)) T4_PENDING_DRAFT = pending;
      else { T4_PENDING_DRAFT = null; localStorage.setItem(T4_PENDING_DRAFT_KEY, 'null'); }
    }
    // 首次切到服务端时，把当前门户用户此前的本机草稿迁入空工作区。
    // 只在 found=false/version=0 时执行，已有共享数据绝不被本机草稿覆盖。
    if (!x.found && Number(x.version) === 0 && Object.keys(T4.data || {}).some(k => Object.keys(T4.data[k] || {}).length)) {
      const migrated = window.T4Shared.clone(T4_SERVER_DOCUMENT);
      migrated.periods = migrated.periods || {};
      migrated.periods[T4.period] = window.T4Shared.clone(T4.data);
      migrated.cfg = t4Stored(T4_CFG_KEY, {});
      migrated.cfgByPeriod = { [T4.period]: window.T4Shared.clone(T4.cfg || {}) };
      migrated.periodLocks = t4Clone(T4.periodLocks || {});
      migrated.channels = t4ChOverrides();
      migrated.importHistory = t4Clone(T4.importHistory || {});
      migrated.expenseItems = t4Clone(T4.expenseItems);
      const cloudLocks = T4_SERVER_DOCUMENT.periodLocks || {};
      const locked = typeof cloudLocks[T4.period] === 'boolean' ? cloudLocks[T4.period] : T4.period < t4CurrentMonth();
      if (locked) {
        T4_PENDING_DRAFT = { period: T4.period, data: t4Clone(T4.data), cfg: t4Clone(T4.cfg) };
        localStorage.setItem(T4_PENDING_DRAFT_KEY, JSON.stringify(T4_PENDING_DRAFT));
        toast('本机往期草稿已保留。请先解锁，再点“导入本机草稿”写入共享工作区。', 6000);
      } else {
        const saved = await window.T4Shared.save(migrated, (typeof CUR_USER === 'string' && CUR_USER) || 'portal-user');
        T4_SERVER_VERSION = saved.version; T4_SERVER_DOCUMENT = saved.document || migrated;
        toast('已将本机 T4 草稿迁移到共享服务器', 4200);
      }
    }
    if (Array.isArray(T4_SERVER_DOCUMENT.channels)) {
      t4SaveChOverrides(window.T4Shared.clone(T4_SERVER_DOCUMENT.channels)); t4RebuildChannels();
    }
    T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; if (!T4.cfg[c.id]) T4.cfg[c.id] = {}; });
    t4ApplyPeriod(T4_SERVER_DOCUMENT);
    T4_SERVER_READY = true;
    T4_SERVER_LAST_KEY = '';
  } catch (e) {
    T4_SERVER_ERROR = e;
    T4_SERVER_LAST_KEY = `error:${Date.now()}`;
    if (e.status === 401 && typeof window.financeSessionExpired === 'function') window.financeSessionExpired();
    toast(`共享数据未加载：${e.message || e}。当前仍是本机草稿，未标记为已同步`, 5200);
  } finally {
    T4_SERVER_LOADING = false;
    if (typeof CURS === 'string' && CURS.startsWith('t4') && (T4_SERVER_READY || CURS === 't4-channels')) go(CURS);
    const picker = document.getElementById('t4Period');
    if (picker) picker.disabled = T4_SERVER_SAVING;
  }
}
async function t4SaveServer(lockOnly = false) {
  if (!window.T4Shared || !T4_SERVER_READY) throw new Error('共享数据尚未完成加载');
  if (T4_SERVER_SAVING) throw new Error('正在同步，请稍后再操作');
  const doc = lockOnly ? window.T4Shared.clone(T4_SERVER_DOCUMENT) : t4ViewDocument();
  const baseline = lockOnly ? window.T4Shared.clone(T4_SERVER_DOCUMENT) : T4_SERVER_BASELINE;
  doc.periodLocks = t4Clone(T4.periodLocks || {});
  doc.channels = t4ChOverrides();
  doc.importHistory = t4Clone(T4.importHistory || {});
  doc.expenseItems = t4Clone(T4.expenseItems);
  const pendingBase = lockOnly ? t4Clone(T4_SERVER_BASELINE) : t4Clone(doc);
  pendingBase.periodLocks = t4Clone(doc.periodLocks); pendingBase.channels = t4Clone(doc.channels);
  pendingBase.importHistory = t4Clone(doc.importHistory);
  pendingBase.expenseItems = t4Clone(doc.expenseItems);
  const controls = [...document.querySelectorAll('[data-t4cfg], [data-t4mgmt], [data-t4cell], [data-t4sumcell], [data-t4expense], #t4ExpenseCh, #t4ExpenseDate, [data-t4act="expenseSave"], #t4Period')]
    .map(input => ({ input, disabled: input.disabled }));
  controls.forEach(({ input }) => { input.disabled = true; });
  T4_SERVER_SAVING = true;
  try {
    const x = await window.T4Shared.save(doc, (typeof CUR_USER === 'string' && CUR_USER) || 'portal-user', baseline);
    const pendingView = t4ViewDocument();
    T4_SERVER_VERSION = x.version; T4_SERVER_DOCUMENT = x.document || doc;
    if (Array.isArray(T4_SERVER_DOCUMENT.channels)) {
      t4SaveChOverrides(t4Clone(T4_SERVER_DOCUMENT.channels)); t4RebuildChannels();
    }
    t4ApplyPeriod(T4_SERVER_DOCUMENT);
    // Edits made while saving, and drafts during a lock/channel-only save,
    // remain local changes against the newly acknowledged server snapshot.
    if (window.T4Shared.reapply) {
      const pending = window.T4Shared.reapply(pendingBase, pendingView, T4_SERVER_BASELINE);
      T4.data = pending.periods[T4.period]; T4.cfg = pending.cfgByPeriod[T4.period];
      T4.periodLocks = pending.periodLocks;
      T4.importHistory = pending.importHistory || {};
      t4SaveChOverrides(pending.channels); t4RebuildChannels();
      t4ApplyExpenseItems(pending.expenseItems || []);
    }
    const all = t4Stored(T4_KEY, {}); all[T4.period] = T4.data;
    localStorage.setItem(T4_KEY, JSON.stringify(all));
    const cfgs = t4Stored(T4_PERIOD_CFG_KEY, {}); cfgs[T4.period] = T4.cfg;
    localStorage.setItem(T4_PERIOD_CFG_KEY, JSON.stringify(cfgs));
    localStorage.setItem(T4_LOCK_KEY, JSON.stringify(T4.periodLocks));
    localStorage.setItem(T4_IMPORT_HISTORY_KEY, JSON.stringify(T4.importHistory));
    localStorage.setItem(T4_EXPENSE_ITEMS_KEY, JSON.stringify(T4.expenseItems));
    T4_SERVER_ERROR = null;
    return x;
  } catch (err) {
    if (err.status === 401) {
      // Keep the loaded document and in-memory edits when the session expires.
      // Reloading local storage here would discard drafts that have not been saved yet.
      T4_SERVER_ERROR = err;
      if (typeof window.financeSessionExpired === 'function') window.financeSessionExpired();
    }
    if (err.code === 'field_conflict' && err.response && err.response.conflicts) {
      const labels = Object.fromEntries([...T4_CFG_FIELDS, ...T4_MGMT_FIELDS,
        ...T4_INPUTS.map(f => [f.k, f.n]), ['cfgByPeriod', '月度参数'], ['periods', '日数据'],
        ['channels', '渠道列表'], ['periodLocks', '月份锁定']]);
      const details = err.response.conflicts.slice(0, 3).map(c => {
        const label = c.path.map(k => labels[k] || (T4_CHM[k] && T4_CHM[k].n) || k).join(' / ');
        const value = !c.currentExists ? '已删除' : typeof c.current === 'object' ? '已更新' : String(c.current);
        return `${label}（共享值：${value}）`;
      }).join('；');
      err.message = `${details} 与本次修改冲突。本次输入已保留；请先记下输入，刷新核对后再保存`;
    }
    throw err;
  } finally {
    T4_SERVER_SAVING = false;
    controls.forEach(({ input, disabled }) => { input.disabled = disabled; });
    if (T4_SERVER_ERROR && T4_SERVER_ERROR.status === 401 && typeof CURS === 'string' && CURS === 't4-channels') go(CURS);
  }
}
function t4Load() {
  if (T4_SERVER_READY) {
    if (T4_LOADED_PERIOD !== T4.period) t4ApplyPeriod(T4_SERVER_DOCUMENT);
    T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; });
    return;
  }
  t4ApplyExpenseItems(t4Stored(T4_EXPENSE_ITEMS_KEY, []));
  try {
    const all = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    T4.data = all[T4.period] || {};
  } catch (e) { T4.data = {}; }
  T4_CH.forEach(c => { if (!T4.data[c.id]) T4.data[c.id] = {}; });
  try {
    T4.cfg = t4ConfigForPeriod({ cfg: t4Stored(T4_CFG_KEY, {}), cfgByPeriod: t4Stored(T4_PERIOD_CFG_KEY, {}) }, T4.period);
  } catch (e) { T4.cfg = t4Clone(T4_CFG_DEFAULT); }
  T4.periodLocks = t4Stored(T4_LOCK_KEY, {});
  T4.importHistory = t4Stored(T4_IMPORT_HISTORY_KEY, {});
  T4_LOADED_PERIOD = T4.period;
  t4MigrateV1();
  t4MigrateFileParts();
  void t4LoadServer();
}

// Catalog edits save only their own top-level array. Nothing is changed locally
// before field CAS succeeds; a rejected save therefore cannot leak into a later save.
async function t4SaveCatalog(field, value, importInfo = null) {
  t4RequireServerReady();
  if (!['channels', 'expenseItems'].includes(field)) throw new Error('不支持的目录');
  const pendingView = t4ViewDocument(), before = t4Clone(T4_SERVER_BASELINE);
  const candidate = t4Clone(T4_SERVER_DOCUMENT);
  candidate[field] = t4Clone(value);
  if (importInfo) {
    // Build the audit entry for this CAS without exposing unsaved history locally.
    const previousHistory = T4.importHistory;
    try {
      const record = t4AddImportHistory(importInfo);
      candidate.importHistory = { ...(candidate.importHistory || {}), [record.id]: record };
    } finally { T4.importHistory = previousHistory; }
  }
  const controls = [...document.querySelectorAll('[data-t4act="channelSave"], [data-t4act="expenseItemSave"], #t4ChannelName, #t4ChannelBu, #t4ChannelAliases, #t4ExpenseName, #t4Period')]
    .map(input => ({ input, disabled: input.disabled }));
  controls.forEach(({ input }) => { input.disabled = true; });
  T4_SERVER_SAVING = true;
  try {
    const saved = await window.T4Shared.save(candidate, (typeof CUR_USER === 'string' && CUR_USER) || 'portal-user', T4_SERVER_DOCUMENT);
    T4_SERVER_VERSION = saved.version;
    T4_SERVER_DOCUMENT = saved.document || candidate;
    t4SaveChOverrides(t4Clone(T4_SERVER_DOCUMENT.channels || [])); t4RebuildChannels();
    t4ApplyPeriod(T4_SERVER_DOCUMENT);
    if (window.T4Shared.reapply) {
      const pending = window.T4Shared.reapply(before, pendingView, T4_SERVER_BASELINE);
      T4.data = pending.periods[T4.period]; T4.cfg = pending.cfgByPeriod[T4.period];
      T4.periodLocks = pending.periodLocks;
      T4.importHistory = pending.importHistory || {};
    }
    localStorage.setItem(T4_EXPENSE_ITEMS_KEY, JSON.stringify(T4.expenseItems));
    localStorage.setItem(T4_IMPORT_HISTORY_KEY, JSON.stringify(T4.importHistory || {}));
    T4_SERVER_ERROR = null;
    return saved;
  } catch (err) {
    if (err.status === 401) T4_SERVER_ERROR = err;
    throw err;
  } finally {
    T4_SERVER_SAVING = false;
    controls.forEach(({ input, disabled }) => { input.disabled = disabled; });
  }
}
function t4CatalogName(value, what, limit) {
  const name = String(value || '').trim();
  if (!name || name.length > limit || /[\u0000-\u001f\u007f<>]/.test(name)) {
    throw new Error(`${what}请输入 1～${limit} 个字，不能包含换行或尖括号`);
  }
  return name;
}
function t4NewCatalogId(prefix) {
  const token = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2);
  return prefix + token;
}
function t4ChannelCandidate(draft) {
  const existing = draft.id && Object.hasOwn(T4_CHM, draft.id) ? T4_CHM[draft.id] : null;
  if (draft.id && !existing) throw new Error('该渠道已不存在，请返回渠道列表重新选择');
  const name = t4CatalogName(draft.n, '渠道名称', 80), bu = draft.bu;
  if (!Object.hasOwn(T4_BU_META, bu)) throw new Error('请选择归属事业部');
  const aliases = String(draft.aliases || '').split(/[\n,，;；、]/).map(x => x.trim()).filter(Boolean)
    .map(x => t4CatalogName(x, '销售渠道别名', 80));
  for (const label of [name, ...aliases]) {
    const resolved = t4ResolveChannel(label);
    if (resolved && resolved !== existing?.id) throw new Error(`「${label}」已属于其他渠道，请使用不同名称`);
  }
  const list = t4Clone(t4ChOverrides()), id = existing?.id || t4NewCatalogId('ch_');
  const prior = list.find(c => c.id === id) || {};
  const retained = [...(existing?.aliases || []), ...(prior.aliases || []), ...(existing && existing.n !== name ? [existing.n] : []), ...aliases];
  const seen = new Set();
  const entry = { ...prior, id, n: name, bu, aliases: retained.filter(alias => {
    const norm = t4ChNorm(alias); if (norm === t4ChNorm(name) || seen.has(norm)) return false; seen.add(norm); return true;
  }) };
  const index = list.findIndex(c => c.id === id);
  if (index < 0) list.push(entry); else list[index] = entry;
  return { id, list };
}
async function t4SaveChannel(draft) {
  t4RequireServerReady();
  const candidate = t4ChannelCandidate(draft);
  await t4SaveCatalog('channels', candidate.list);
  return candidate.id;
}
async function t4SaveExpenseItem(draft) {
  t4RequireServerReady();
  const name = t4CatalogName(draft.n, '费用科目名称', 40), key = draft.k;
  if (key && !T4.expenseItems.some(item => item.k === key)) throw new Error('该费用科目已不存在，请重新选择');
  if (T4_METRICS.some(item => item.k !== key && t4ChNorm(item.n) === t4ChNorm(name))) throw new Error('该费用科目名称已存在');
  if (!key && T4.expenseItems.length >= 100) throw new Error('最多支持 100 个自定义费用科目');
  const list = t4Clone(T4.expenseItems), k = key || t4NewCatalogId('expense_');
  const index = list.findIndex(item => item.k === k);
  if (index < 0) list.push({ k, n: name }); else list[index] = { k, n: name };
  await t4SaveCatalog('expenseItems', list);
  return k;
}

S['t4-channel-edit'] = () => {
  t4Load();
  const draft = T4.channelDraft || { n: '', bu: 'dealer', aliases: '' }, current = T4_CHM[draft.id];
  return head(current ? `修改渠道 · ${H(current.n)}` : '新增渠道', '渠道名称和归属保存后在各页面共用。改名会保留原名匹配，已有损益继续归属原渠道。', '工具箱 · T4',
    '<button class="btn" data-t4go="channels">返回渠道列表</button>')
    + (T4.catalogError ? `<div class="note c" role="alert">${H(T4.catalogError)}</div>` : '')
    + cardp('渠道信息', `<div class="frow"><label>渠道名称 <input id="t4ChannelName" type="text" maxlength="80" value="${H(draft.n)}" style="width:min(320px,100%)"></label>
      <label>归属事业部 <select id="t4ChannelBu" aria-label="归属事业部">${Object.entries(T4_BU_META).map(([id, meta]) => `<option value="${id}" ${id === draft.bu ? 'selected' : ''}>${H(meta.n)}</option>`).join('')}</select></label></div>
      <div style="margin-top:14px"><label>新增销售渠道别名 <textarea id="t4ChannelAliases" class="t4in" rows="3" style="display:block;width:100%;max-width:600px;font-family:inherit;text-align:left;line-height:1.6" placeholder="可选，每行一个源文件里的销售渠道名称">${H(draft.aliases || '')}</textarea></label></div>
      ${current?.aliases?.length ? `<p class="mut">已保留别名：${current.aliases.map(H).join('、')}</p>` : ''}
      <div class="frow" style="margin-top:14px"><button class="btn pri" data-t4act="channelSave">保存渠道</button></div>`);
};

function t4RememberExpenseInputs() {
  const fields = [...document.querySelectorAll('[data-t4expense]')];
  if (!fields.length) return;
  T4.expenseEdits[`${T4.expenseCh}:${T4.expenseDate}`] = Object.fromEntries(fields
    .filter(el => el.value !== el.dataset.t4orig).map(el => [el.dataset.t4expense, el.value]));
}
S['t4-expenses'] = () => {
  t4Load();
  if (!T4_CHM[T4.expenseCh]) T4.expenseCh = T4_CH[0].id;
  if (!T4.expenseDate.startsWith(T4.period + '-')) T4.expenseDate = t4Date(1);
  const raw = t4Raw(T4.expenseCh, T4.expenseDate), draft = T4.expenseDraft;
  const edits = T4.expenseEdits[`${T4.expenseCh}:${T4.expenseDate}`] || {};
  const rows = T4_INPUTS.filter(f => f.g === '运营费用').map(f => {
    const value = t4InputValue(raw, f.k), shown = value == null ? '' : value;
    const entered = Object.hasOwn(edits, f.k) ? edits[f.k] : shown;
    return [H(f.n), `<input type="number" class="t4in" style="width:140px;max-width:100%" step="0.01" data-t4expense="${f.k}" data-t4orig="${shown}" value="${H(entered)}" placeholder="—" aria-label="${H(f.n)}金额">`,
      f.k.startsWith('expense_') ? `<button class="btn sm" data-t4expenseedit="${f.k}">修改名称</button>` : '<span class="mut">固定科目</span>'];
  });
  return head('运营费用', '按渠道和日期录入费用。自定义费用会计入运营费与净利润，并出现在每日明细和导出报表中。', '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4go="overview">返回</button><button class="btn" data-t4act="expenseItemNew">新增费用科目</button>'))
    + (T4.catalogError ? `<div class="note c" role="alert">${H(T4.catalogError)}</div>` : '')
    + (draft ? cardp(draft.k ? '修改费用科目名称' : '新增费用科目', `<div class="frow"><label>科目名称 <input id="t4ExpenseName" type="text" maxlength="40" value="${H(draft.n || '')}"></label><button class="btn pri" data-t4act="expenseItemSave">保存科目</button><button class="btn" data-t4act="expenseItemCancel">取消</button></div><p class="mut">修改名称保留已有金额。费用科目在所有渠道共用。</p>`) : '')
    + `<div class="frow" style="margin:14px 0"><label>渠道 <select id="t4ExpenseCh" aria-label="渠道">${T4_CH.map(c => `<option value="${c.id}" ${c.id === T4.expenseCh ? 'selected' : ''}>${H(c.n)}</option>`).join('')}</select></label>
      <label>日期 <input id="t4ExpenseDate" type="date" value="${T4.expenseDate}" min="${t4Date(1)}" max="${t4Date(t4Days())}"></label></div>`
    + card(`${H(T4_CHM[T4.expenseCh].n)} · ${T4.expenseDate}`, table([{ t: '费用科目' }, { t: '当日金额（元）', n: 1 }, { t: '操作' }], rows))
    + '<div class="note">留空取消手工覆盖，继续使用导入金额或参数计算值；填 0 表示该日确认为零。负数用于冲减费用。</div>'
    + `<button class="btn pri" data-t4act="expenseSave" ${t4IsPeriodLocked() ? 'disabled' : ''}>保存当日费用</button>`;
};
async function t4SaveDailyExpenses(ch, date, entries) {
  t4RequireServerReady(); t4AssertEditable();
  if (!Object.hasOwn(T4_CHM, ch) || !t4RangeDates(t4Date(1), t4Date(t4Days())).includes(date)) throw new Error('请选择本月内的有效日期与渠道');
  const keys = t4OperatingKeys(), changes = [];
  entries.forEach(({ k, value, original }) => {
    if (!keys.includes(k)) throw new Error('费用科目已变化，请刷新后重试');
    const text = String(value ?? '').trim();
    if (text === String(original ?? '')) return;
    const amount = t4ImportAmount(text);
    if (amount != null && !Number.isFinite(amount)) throw new Error('请填写有效金额');
    changes.push({ k, amount });
  });
  if (!changes.length) return 0;
  const previous = t4Clone(T4.data), raw = (T4.data[ch] ||= {})[date] || { _src: 'manual', _fileParts: {} };
  changes.forEach(({ k, amount }) => { if (amount == null) delete raw[k]; else raw[k] = amount; });
  raw._src = 'manual';
  if (t4HasInputs(raw)) T4.data[ch][date] = raw; else delete T4.data[ch][date];
  try { await t4Save(); } catch (err) { t4RestorePeriodData(previous); throw err; }
  return changes.length;
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
async function t4Save() {
  t4AssertEditable();
  let all;
  try {
    all = JSON.parse(localStorage.getItem(T4_KEY) || '{}');
    all[T4.period] = T4.data;
    localStorage.setItem(T4_KEY, JSON.stringify(all));
    localStorage.setItem(T4_IMPORT_HISTORY_KEY, JSON.stringify(T4.importHistory || {}));
  } catch (e) { throw new Error('保存失败：浏览器存储空间不足'); }
  if (T4_SERVER_READY) return t4SaveServer();
  return { ok: true, localOnly: true };
}
async function t4SaveCfg() {
  t4AssertEditable();
  const all = t4Stored(T4_PERIOD_CFG_KEY, {});
  all[T4.period] = t4Clone(T4.cfg);
  localStorage.setItem(T4_PERIOD_CFG_KEY, JSON.stringify(all));
  if (T4_SERVER_READY) await t4SaveServer();
}

async function t4SetPeriodLock(locked) {
  if (T4_SERVER_LOADING || T4_SERVER_SAVING) throw new Error('正在同步，请稍后再操作');
  const before = t4Clone(T4.periodLocks || {});
  T4.periodLocks = { ...before, [T4.period]: locked };
  try {
    if (T4_SERVER_READY) await t4SaveServer(true);
    localStorage.setItem(T4_LOCK_KEY, JSON.stringify(T4.periodLocks));
  } catch (e) { T4.periodLocks = before; throw e; }
}

async function t4ClearPeriodData(project, scope, from = t4Date(1), to = t4Date(t4Days())) {
  t4AssertEditable();
  t4ValidateRange(from, to);
  const keys = scope === 'all' ? T4_INPUT_KEYS : scope === 'income' ? T4_SUM_SCOPES.income.keys
    : scope === 'cost' ? T4_SUM_SCOPES.cost.keys : scope === 'expenses'
      ? T4_INPUTS.filter(f => f.g === '运营费用').map(f => f.k) : [];
  if (!T4_PROJ_OPTS.some(([id]) => id === project) || !keys.length) throw new Error('请选择有效的清空范围');
  const previous = t4Clone(T4.data);
  T4_CH.filter(c => project === 'all' || t4ProjectId(c.bu) === project).forEach(c => {
    Object.entries(T4.data[c.id] || {}).forEach(([dt, raw]) => {
      if (dt < from || dt > to) return;
      keys.forEach(k => delete raw[k]);
      Object.values(raw._fileParts || {}).forEach(part => keys.forEach(k => delete part[k]));
      if (!t4HasInputs(raw)) delete T4.data[c.id][dt];
    });
  });
  try { await t4Save(); } catch (e) { T4.data = previous; const all = t4Stored(T4_KEY, {}); all[T4.period] = previous; localStorage.setItem(T4_KEY, JSON.stringify(all)); throw e; }
}

const t4Days = () => { const [y, m] = T4.period.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const t4Date = d => `${T4.period}-${String(d).padStart(2, '0')}`;
function t4ValidDate(date) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date || '')) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function t4ValidateRange(from, to) {
  if (!t4ValidDate(from) || !t4ValidDate(to) || !from.startsWith(T4.period + '-') || !to.startsWith(T4.period + '-'))
    throw new Error('起止日期必须是当前月份内的有效日期');
  if (from > to) throw new Error('结束日期不能早于开始日期');
  return Array.from({ length: Number(to.slice(-2)) - Number(from.slice(-2)) + 1 }, (_, i) => t4Date(Number(from.slice(-2)) + i));
}
function t4ImportRange(imp) {
  return imp.rangeMode === 'range' ? t4ValidateRange(imp.from, imp.to) : null;
}
function t4ImportRangeControls(imp) {
  const range = imp.rangeMode === 'range';
  return cardp('导入日期范围', `<div class="frow"><label>日期筛选 <select id="t4ImportRangeMode"><option value="file" ${range ? '' : 'selected'}>文件覆盖日期</option><option value="range" ${range ? 'selected' : ''}>指定起止日期</option></select></label>
    ${range ? `<label>起 <input id="t4ImportFrom" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${H(imp.from ?? t4Date(1))}"></label><label>止 <input id="t4ImportTo" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${H(imp.to ?? t4Date(t4Days()))}"></label>` : ''}</div><p class="mut">${range ? '只读取所选区间，起止相同表示一天。只替换文件内有有效金额的日期和科目，缺少的日期及空白字段保留原值。' : '只替换文件内有有效金额的日期和科目。同渠道同日同科目多行先合计，缺少的日期及空白字段保留原值。'} 未匹配渠道和无有效金额的文件不会清空旧数据。要冲销旧值请明确填 0，或使用清空功能。修改订单类型只更新其对应科目，请同时核对原零售或退货科目是否需要冲销。</p>`);
}
function t4ImportFeedback() {
  const feedback = T4.importFeedback;
  if (!feedback) return '';
  return cardp(feedback.ok ? '导入已保存' : '导入未写入', `<p>${H(feedback.message)}</p>${feedback.issues?.length ? `<ul>${feedback.issues.map(x => `<li>${H(x)}</li>`).join('')}</ul>` : ''}`);
}
function t4RejectImport(message, issues = []) {
  T4.importFeedback = { ok: false, message, issues };
  toast(message, 6000);
  t4Go(T4.imp?.mode === 'summary' ? 'sumimp' : 'imp');
}
// Call before the same data save. Callers must restore their history snapshot
// together with their data snapshot if that save fails.
function t4AddImportHistory(info) {
  const id = `import_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const dates = [...new Set(info.dates || [t4Date(1)])].sort();
  const record = { id, period: T4.period, fileName: String(info.fileName || '导入文件').slice(0, 512), at: new Date().toISOString(),
    actor: (typeof CUR_USER === 'string' && CUR_USER) || 'portal-user', scope: info.scope || '数据导入',
    mode: info.mode || 'file', from: info.from || dates[0], to: info.to || dates[dates.length - 1],
    dates, channels: [...new Set(info.channels || [])], used: info.used || 0, skipped: info.skipped || 0, issues: info.issues || [] };
  T4.importHistory = { ...(T4.importHistory || {}), [id]: record };
  return record;
}
async function t4CommitImport(imp, pending, used, skipped, issues, range) {
  const before = t4Clone(T4.data), history = t4Clone(T4.importHistory || {});
  const targets = new Map();
  // Both modes replace only accepted (channel, date, source, field) values.
  // A selected interval filters rows; it never turns absent dates or blank
  // fields into deletion requests. Explicit zero is an accepted value.
  pending.forEach(x => {
    const key = `${x.ch}:${x.source}`;
    if (!targets.has(key)) targets.set(key, { ch: x.ch, source: x.source, dateKeys: new Map() });
    const target = targets.get(key);
    if (!target.dateKeys.has(x.dt)) target.dateKeys.set(x.dt, new Set());
    target.dateKeys.get(x.dt).add(x.key);
  });
  let record;
  try {
    targets.forEach(x => {
      x.dateKeys.forEach((keys, dt) => t4ClearSource(x.ch, x.source, new Set([dt]), keys));
    });
    pending.forEach(x => t4Add(x.ch, x.dt, x.key, x.num, x.source));
    const touched = new Map(), shadowed = new Map();
    pending.forEach(({ ch, dt, key }) => {
      const raw = t4Raw(ch, dt);
      touched.set(`${ch}:${dt}`, { ch, dt, raw });
      if (t4ManualKeys(raw).includes(key)) shadowed.set(`${ch}:${dt}:${key}`,
        `${dt} ${T4_CHM[ch]?.n || ch} · ${T4_INPUTS.find(f => f.k === key)?.n || key}：导入后文件值 ${money(t4FileInputValue(raw, key))}，人工覆盖仍生效，按 ${money(raw[key])} 计算。`);
    });
    touched.forEach(({ ch, dt, raw }) => t4AssertIncomeOverride(before[ch]?.[dt], raw, ch, dt));
    if (shadowed.size) {
      const warnings = [...shadowed.values()];
      const accepted = confirm(`有 ${warnings.length} 项导入金额被人工值覆盖。\n${warnings.slice(0, 8).join('\n')}${warnings.length > 8 ? `\n另有 ${warnings.length - 8} 项，完整明细将保存在导入记录中。` : ''}\n\n确定：保留人工值并导入；取消：返回核对。要使用文件金额，请在录入页将相应格子留空并保存。`);
      if (!accepted) {
        T4.data = before;
        t4RejectImport('已取消导入，原数据和本次文件已保留。请先核对人工覆盖。', warnings);
        return null;
      }
      issues = [...issues, ...warnings];
    }
    record = t4AddImportHistory({ fileName: imp.fileName || imp.fileN, scope: imp.mode === 'summary' ? t4SumScope().n : (imp.fileN || imp.fileK),
      mode: range ? 'range' : 'file', from: range?.[0], to: range?.[range.length - 1], dates: pending.map(x => x.dt), channels: pending.map(x => x.ch), used, skipped, issues });
    await t4Save();
  } catch (e) {
    T4.importHistory = history;
    t4RestorePeriodData(before);
    localStorage.setItem(T4_IMPORT_HISTORY_KEY, JSON.stringify(history));
    throw e;
  }
  T4.importFeedback = { ok: true, message: `${record.scope}：${record.channels.length} 个渠道、${record.dates.length} 个日期、有效 ${used} 行、跳过 ${skipped} 行。`, issues };
  T4.imp = null;
  t4Go('history');
  toast('导入数据与记录已保存', 4200);
  return record;
}
S['t4-history'] = () => {
  t4Load();
  const records = Object.values(T4.importHistory || {}).filter(r => r.period === T4.period).sort((a, b) => b.at.localeCompare(a.at));
  return head('T4 导入记录', '成功记录与业务数据一起保存；失败导入保留原数据，并在导入页显示原因。', '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4go="overview">← 返回</button>')) + t4ImportFeedback()
    + card(`本月导入（${records.length} 次）`, records.length ? table([{t:'时间 / 操作人'},{t:'文件 / 范围'},{t:'日期'},{t:'渠道'},{t:'有效 / 跳过'},{t:'反馈'}],
      records.map(r => [H(`${r.at} / ${r.actor}`), `${H(r.fileName)}<br>${H(r.scope)}`, `${H(r.from)} ～ ${H(r.to)}<br>${r.mode === 'range' ? '指定区间' : '文件覆盖日期'}`,
        H(r.channels.map(id => T4_CHM[id]?.n || id).join('、')), `${r.used} / ${r.skipped}`,
        r.issues.length ? `<details><summary>${r.issues.length} 条原因</summary>${r.issues.map(H).join('<br>')}</details>` : '全部通过'])) : '<p class="mut" style="padding:14px">本月尚无导入记录。启用记录前的历史导入无法补溯。</p>');
};
const t4Num = v => { const n = Number(String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '')); return Number.isFinite(n) ? n : 0; };
function t4ImportAmount(value) {
  const text = String(value == null ? '' : value).trim().replace(/，/g, ',').replace(/^[¥￥$]\s*/, '');
  if (!text) return null;
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(text)) return NaN;
  const n = Number(text.replace(/,/g, '')); return Number.isFinite(n) ? n : NaN;
}
function t4RestorePeriodData(data) {
  T4.data = data;
  const all = t4Stored(T4_KEY, {}); all[T4.period] = data;
  localStorage.setItem(T4_KEY, JSON.stringify(all));
}
const t4Raw = (ch, dt) => (T4.data[ch] || {})[dt] || null;
function t4InputValue(raw, key) {
  if (!raw) return null;
  if (raw[key] != null) return +raw[key] || 0;
  return t4FileInputValue(raw, key);
}
function t4FileInputValue(raw, key) {
  if (!raw) return null;
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
function t4ManualKeys(raw) {
  if (!raw) return [];
  return T4_INPUT_KEYS.filter(k => raw[k] != null &&
    (raw._manualFields?.[k] || raw._fileParts || raw._src !== 'file') &&
    (!raw._srcs?.[k] || raw._srcs[k] === 'manual'));
}
function t4SourceLabel(raw) {
  if (!raw) return '分摊';
  const manual = t4ManualKeys(raw), file = T4_INPUT_KEYS.some(k => t4FileInputValue(raw, k) != null ||
    (raw[k] != null && ((raw._src === 'file' && !raw._fileParts && !raw._manualFields?.[k]) ||
      (raw._srcs?.[k] && raw._srcs[k] !== 'manual'))));
  if (manual.length && file) return manual.some(k => t4FileInputValue(raw, k) != null) ? '文件 + 人工覆盖' : '文件 + 人工';
  return manual.length ? '人工' : file || raw._src === 'file' ? '文件' : '人工';
}
// A negative daily result can be legitimate. Only flag the precise case where
// a manual gross-income field equals the imported net amount, to the cent.
function t4IncomeOverrideRisk(raw) {
  if (!raw?._fileParts || raw.retailIncome == null) return null;
  const fileIncome = t4FileInputValue(raw, 'retailIncome');
  if (fileIncome == null) return null;
  const manualIncome = +raw.retailIncome;
  const deductions = (t4InputValue(raw, 'returnAmount') || 0) + (t4InputValue(raw, 'refundAmount') || 0)
    - Math.abs(t4InputValue(raw, 'rebateAmount') || 0);
  const netIncome = fileIncome + deductions, cents = n => Math.round(n * 100);
  return deductions < -0.005 && cents(manualIncome) !== cents(fileIncome) && cents(manualIncome) === cents(netIncome)
    ? { fileIncome, manualIncome, deductions, netIncome } : null;
}
function t4AssertIncomeOverride(before, after, ch, dt) {
  const risk = t4IncomeOverrideRisk(after);
  if (!risk || JSON.stringify(risk) === JSON.stringify(t4IncomeOverrideRisk(before))) return;
  throw new Error(`${dt} ${T4_CHM[ch]?.n || ch}：疑似重复扣退。录入的零售收入 ${money(risk.manualIncome)} 已等于导入销售额 ${money(risk.fileIncome)} 扣退后的净额；退货、退款及返款还会另行扣减。请填写扣退前销售额，或将零售收入留空以恢复导入值。`);
}
function t4OverrideHint(raw, key, id) {
  if (!t4ManualKeys(raw).includes(key)) return '';
  const file = t4FileInputValue(raw, key);
  if (file == null) return `<small id="${id}" class="t4-source-hint">人工录入</small>`;
  return `<small id="${id}" class="t4-source-hint t4-source-override">人工覆盖 · 导入 ${money(file)}<br>留空并保存可恢复导入值</small>`;
}
function t4OverrideNotice(channels, dates = null) {
  const selected = dates && new Set(dates), entries = [];
  channels.forEach(ch => Object.entries(T4.data[ch] || {}).forEach(([dt, raw]) => {
    if (selected && !selected.has(dt)) return;
    const keys = t4ManualKeys(raw).filter(k => t4FileInputValue(raw, k) != null);
    if (keys.length) entries.push({ ch, dt, raw, keys, risk: t4IncomeOverrideRisk(raw) });
  }));
  if (!entries.length) return '';
  entries.sort((a, b) => Number(!!b.risk) - Number(!!a.risk) || a.dt.localeCompare(b.dt));
  const risks = entries.filter(x => x.risk).length;
  const rows = entries.map(({ ch, dt, raw, keys, risk }) => `<li><b>${H(dt)} · ${H(T4_CHM[ch]?.n || ch)}</b>：${keys.map(k => `${H(T4_INPUTS.find(f => f.k === k)?.n || k)}，人工 ${money(raw[k])} / 导入 ${money(t4FileInputValue(raw, k))}`).join('；')}${risk ? `<br><strong>疑似重复扣退：</strong>人工收入已是导入销售额扣退后的净额，当前仍会另扣 ${money(-risk.deductions)}。` : ''} <button class="btn sm" data-t4review="${H(ch)}:${H(dt)}">核对录入</button></li>`).join('');
  return `<div class="note w t4-override-note" role="status"><b>${risks ? `有 ${risks} 个日期疑似重复扣退，请先核对收入。` : `有 ${entries.length} 个日期使用人工覆盖。`}</b> 手工值优先于导入值，重新导入不会自动取消覆盖。<details ${risks ? 'open' : ''}><summary>查看金额来源与处理入口</summary><ul>${rows}</ul></details></div>`;
}
const t4HasInputs = raw => T4_INPUT_KEYS.some(k => t4InputValue(raw, k) != null);
const t4Filled = ch => Object.keys(T4.data[ch] || {}).filter(dt => t4InputValue(t4Raw(ch, dt), 'retailIncome') != null).length;

function t4Assumed(ch, key, base, hard) {
  const cfg = T4.cfg[ch] || {}, days = t4Days();
  const rateMap = { platformFee: 'platformFeeRate', platformOther: 'platformOtherRate', aftersales: 'aftersalesRate',
    logistics: 'logisticsRate', shippingInsurance: 'shippingInsuranceRate', warehouse: 'warehouseRate', tax: 'taxRate' };
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
  ['returnAmount','refundAmount','retailCost','returnCost','promotion','ztc','cps','research','rebateIncome','salesReceipt'].forEach(k => { if (r[k] == null) r[k] = 0; });
  r.rebateAmount = -Math.abs(r.rebateAmount || 0) || 0;
  r.salesIncome = r.retailIncome + r.returnAmount + r.refundAmount + r.rebateAmount;
  ['platformFee','platformOther','aftersales','logistics','shippingInsurance','warehouse','tax','directLabor','directRent','directOther','sharedLabor','sharedRent','sharedOther'].forEach(k => {
    // Only platform commission uses net sales; the other agreed rates retain
    // their retail-income base. Explicit imported/manual amounts still win.
    if (r[k] == null) r[k] = t4Assumed(ch, k, k === 'platformFee' ? r.salesIncome : r.retailIncome, hard);
  });
  r.salesCost = r.retailCost + r.returnCost;
  r.grossProfit = r.salesIncome - r.salesCost;
  r.grossMargin = r.salesIncome ? r.grossProfit / r.salesIncome : 0;
  T4.expenseItems.forEach(({ k }) => { if (r[k] == null) r[k] = 0; });
  r.operating = t4OperatingKeys().reduce((n, k) => n + r[k], 0);
  r.direct = r.directLabor + r.directRent + r.directOther;
  r.contribution = r.grossProfit - r.operating - r.direct;
  r.contributionRate = r.salesIncome ? r.contribution / r.salesIncome : 0;
  r.indirect = r.sharedLabor + r.sharedRent + r.sharedOther;
  r.netProfit = r.contribution - r.indirect + r.rebateIncome;
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
/* ---------- 区间视图：当前月默认截至今天，历史月份默认整月 ---------- */
const t4DayHasIncome = (ch, dt) => t4InputValue(t4Raw(ch, dt), 'retailIncome') != null;
const t4DayHasData = (ch, dt) => t4HasInputs(t4Raw(ch, dt));
function t4DefaultRangeEnd(now = new Date()) {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return T4.period === current ? t4Date(now.getDate()) : t4Date(t4Days());
}
/* 当前月不提前累计未来的日摊；手选月末仍可查看整月预算。 */
function t4ViewRange() {
  const val = v => (v && v.startsWith(T4.period + '-') ? v : '');
  let f = val(T4.viewFrom), t = val(T4.viewTo);
  if (!f && !t) {
    t = t4DefaultRangeEnd();
    if (t === t4Date(t4Days())) return null;
  }
  if (!f) f = t4Date(1);
  if (!t) t = t4DefaultRangeEnd();
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
  const locked = t4IsPeriodLocked();
  const draft = T4_PENDING_DRAFT && T4_PENDING_DRAFT.period === T4.period ? '<button class="btn" data-t4act="migrateDraft">导入本机草稿</button>' : '';
  const retry = T4_SERVER_LAST_KEY.startsWith('error:') ? '<button class="btn" data-t4act="retrySync">本机草稿 · 重新连接</button>' : '';
  return `<label class="sel">期间 <input id="t4Period" type="month" value="${T4.period}" style="width:116px" ${T4_SERVER_LOADING || T4_SERVER_SAVING ? 'disabled' : ''}></label><button class="btn" data-t4act="togglePeriodLock" title="往期默认锁定；锁定后禁止修改、导入与清空">${locked ? '本月已锁定 · 解锁' : '锁定本月'}</button>${draft}${retry}${extra || ''}`;
}
S['t4-clear'] = () => {
  t4Load();
  return head('清空本期数据', '选择本月内的日期范围、项目与板块。起止相同表示只清空一天。', '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4go="overview">返回</button>'))
    + cardp('清空范围', `<div class="frow"><label>起 <input id="t4ClearFrom" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${t4Date(1)}"></label><label>止 <input id="t4ClearTo" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${t4Date(t4Days())}"></label><label>项目 <select id="t4ClearProject">${T4_PROJ_OPTS.map(([id,n]) => `<option value="${id}" ${id === T4.projFilter ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>板块 <select id="t4ClearScope"><option value="income">销售收入</option><option value="cost">销售成本</option><option value="expenses">运营费用</option><option value="all">全部录入与导入数据</option></select></label>
      <button class="btn" data-t4act="clearSelected" ${t4IsPeriodLocked() ? 'disabled' : ''}>清空所选板块</button></div>`)
    + `<div class="note ${t4IsPeriodLocked() ? 'w' : ''}">${t4IsPeriodLocked() ? `${T4.period} 已锁定。往期月份默认受保护，需主动解锁才能清空。` : '清空前需输入期间号确认。'} 参数与月度工资/费用分摊保留；由参数推算的费用仍会显示。</div>`;
};
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
    ecomOK = okOf(T4_BIG_ECOM), pddOK = okOf(T4_PDD), rmOK = okOf(T4_RUIMIAN), orangeOK = okOf(T4_ORANGE), dealerOK = okOf(T4_DEALER);
  const shownCH = t4ProjCH();
  const rows = shownCH.map(c => {
    const n = t4Filled(c.id), rn = vr ? t4FilledRange(c.id, vr.from, vr.to) : 0;
    const m = vr ? t4RangeData(c.id, vr.from, vr.to) : t4Month(c.id);
    const mgmtAny = t4MgmtDaily(c.id).any, hasInc = vr ? rn > 0 : n > 0, mgmtOnly = !n && mgmtAny;
    const hasData = Object.entries(T4.data[c.id] || {}).some(([dt, raw]) => (!vr || (dt >= vr.from && dt <= vr.to)) && t4HasInputs(raw));
    const src = c.files.length ? pill('文件/人工', 'ok') : pill('人工', 'wa');
    const st = n === 0 ? (hasData ? pill('有成本 / 费用 / 返款', 'wa') : mgmtOnly ? pill('仅管理费', 'wa') : pill('未开始', 'cr')) : n < 15 ? pill('缺口大', 'wa') : pill('已有数据', 'ok');
    return [t4ProjectPill(c.bu), t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
      vr ? `<b class="mono">${rn}</b> / ${vr.n}` : `<b class="mono">${n}</b> / ${t4Days()}`, t4Cal(c.id), src,
      hasData ? money(m.salesIncome) : '—', hasData || mgmtAny ? money(m.netProfit) : '—', hasInc ? `${(m.netMargin * 100).toFixed(1)}%` : '—', st,
      `${c.files.length ? `<button class="btn sm" data-t4go="imp:${c.id}">导入</button>` : ''}
       <button class="btn sm" data-t4go="man:${c.id}">录入</button>`];
  });
  return head('T4　日损益表', `按底稿完整科目重算 ${T4_CH.length} 个渠道，并分别归集到大电商、拼多多、瑞眠、橘农和经销事业部。`, '工具箱 · 已更新',
    t4PeriodControl(`<label class="sel">起 <input id="t4ViewFrom" data-view="overview" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.from : ''}" title="当前月默认截至今天；选择月末可看整月" style="width:132px"></label><label class="sel">止 <input id="t4ViewTo" data-view="overview" type="date" min="${vr ? vr.from : t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.to : ''}" style="width:132px"></label>${t4ProjSelect('overview')}<button class="btn" data-t4go="sumimp:both">收入成本导入</button><button class="btn" data-t4go="summan:both">收入成本录入</button><button class="btn" data-t4go="history">导入记录</button><button class="btn" data-t4go="returns">瑞眠 / 橘农返款</button><button class="btn" data-t4go="channels">渠道列表</button><button class="btn" data-t4go="expenses">运营费用</button><button class="btn" data-t4go="rules">取数口径</button><button class="btn" data-t4go="mgmt">工资 / 费用分摊</button><button class="btn" data-t4go="cfg">参数</button><button class="btn" data-t4act="wipePeriod" title="清空当前期间全部渠道的收入/成本/费用数据；参数、管理费分摊和渠道列表不受影响">清空本期</button><button class="btn pri" data-t4go="sheet">看损益表</button>`))
    + kpis([
      { k: '渠道', v: String(T4_CH.length), u: '个' },
      { k: '大电商', v: String(T4_BIG_ECOM.length), u: '个渠道' },
      { k: '拼多多', v: String(T4_PDD.length), u: '个渠道' },
      { k: '瑞眠', v: String(T4_RUIMIAN.length), u: '个渠道' },
      { k: '橘农', v: String(T4_ORANGE.length), u: '个渠道' },
      { k: '经销', v: String(T4_DEALER.length), u: '个渠道' },
      { k: '大电商汇总', v: ecomOK ? '可用' : '禁用', t: ecomOK ? 'g' : 'c' },
      { k: '拼多多汇总', v: pddOK ? '可用' : '禁用', t: pddOK ? 'g' : 'c' },
      { k: '瑞眠汇总', v: rmOK ? '可用' : '禁用', t: rmOK ? 'g' : 'c' },
      { k: '橘农汇总', v: orangeOK ? '可用' : '禁用', t: orangeOK ? 'g' : 'c' },
      { k: '经销汇总', v: dealerOK ? '可用' : '禁用', t: dealerOK ? 'g' : 'c' },
      { k: '全部汇总', v: ok ? '可用' : '禁用', t: ok ? 'g' : 'c', d: vr ? `${vr.from} ～ ${vr.to}（${vr.n} 天）` : `全渠道极差 ${g.gap} 天` },
      (() => { // 管理费分摊全渠道月合计——分摊值随有收入数据的日子计入损益
        let sum = 0; const set = new Set();
        T4_CH.forEach(c => { const cfg = T4.cfg[c.id] || {}; T4_MGMT_FIELDS.forEach(([k]) => { if (cfg[k] != null) { sum += +cfg[k] || 0; set.add(c.id); } }); });
        return { k: '管理费分摊', v: set.size ? money(sum) : '未设置', u: set.size ? '元/月' : '', d: set.size ? `${set.size} 个渠道已设置 · 日摊 ${money(sum / t4Days())}` : '点「管理费分摊」录入或导入' };
      })(),
    ])
    + (vr ? `<div class="note"><b>区间视图 ${vr.from} ～ ${vr.to}，共 ${vr.n} 天。</b>渠道列为区间累计损益（无收入数据的日子仅计管理费日摊）；汇总卡按区间内取数天数对齐校验。清空起止日期返回整月累计。</div>` : '')
    + (vr ? '' : ok ? `<div class="note g"><b>各事业部取数天数已对齐。</b>大电商、拼多多、瑞眠、橘农、经销和全部汇总均可用。</div>`
      : g.max === 0 ? '<div class="note"><b>本期尚无数据。</b>先导入平台文件或逐日录入；已设置的管理费分摊会随有收入数据的日子自动计入损益。</div>'
      : `<div class="note c"><b>部分汇总不可用。</b>大电商事业部：${ecomOK ? '可用' : '禁用'}；拼多多事业部：${pddOK ? '可用' : '禁用'}；瑞眠事业部：${rmOK ? '可用' : '禁用'}；经销事业部：${dealerOK ? '可用' : '禁用'}；全部汇总：禁用。请补齐对应事业部的渠道数据。</div>`)
    + t4OverrideNotice(shownCH.map(c => c.id), vr ? t4RangeDates(vr.from, vr.to) : null)
    + card((T4.projFilter === 'all' ? '' : T4_PROJ_OPTS.find(o => o[0] === T4.projFilter)[1] + ' · ') + (vr ? `${shownCH.length} 渠道 · ${vr.from} ～ ${vr.to} 区间损益` : `${shownCH.length} 渠道取数进度`), table(
      [{t:'项目'},{t:'归属事业部'},{t:'渠道汇总'},{t:'取数天数',n:1},{t:`日历（1—${t4Days()}）`},{t:'方式'},{t:'销售收入',n:1},{t:'净利润',n:1},{t:'净利率'},{t:'状态'},{t:''}], rows))
    + '<div class="t4lg"><span><em class="f"></em>实填</span><span><em class="h"></em>含参数/硬推</span><span><em class="n"></em>无收入数据</span></div>';
};

function t4EntryTable(ch, group) {
  const fs = T4_INPUTS.filter(f => f.g === group), rows = [];
  for (const dt of t4EntryRange(false)) {
    const d = Number(dt.slice(-2)), raw = t4Raw(ch, dt) || {}, r = t4Row(ch, dt);
    rows.push([`<b class="mono">${d}</b>`, ...fs.map(f => { const value = t4InputValue(raw, f.k), v = value != null ? value : '', id = `t4hint-${ch}-${dt}-${f.k}`, hint = t4OverrideHint(raw, f.k, id); return `<input type="number" step="0.01" class="t4in" data-t4cell="${dt}:${f.k}" data-t4orig="${v}" value="${v}" aria-label="${H(dt + ' ' + T4_CHM[ch].n + ' ' + f.n)}" ${hint ? `aria-describedby="${id}"` : ''} placeholder="—">${hint}`; }),
      r ? `<b class="${r.netProfit >= 0 ? 'grn' : 'red'}">${money(r.netProfit)}</b>` : '—']);
  }
  return card(`${group} · ${T4_CHM[ch].n}`, table([{t:'日'}, ...fs.map(f => ({t:f.n,n:1})), {t:'当日净利润',n:1}], rows));
}
S['t4-man'] = () => {
  t4Load(); const c = T4_CHM[T4.editCh];
  return head(`录入　${c.n}`, '留空表示没有数据；填 0 表示当日确认为零。退货金额、退款金额和退货成本请按负数录入；返款填正数，系统自动扣减收入。', '工具箱 · T4',
    t4PeriodControl(`${t4EntryRangeControls(false)}<select id="t4chSel">${T4_CH.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${x.n}</option>`).join('')}</select><button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="saveMan">保存</button>`))
    + `<div class="note"><b>当前收入取数 ${t4Filled(c.id)} / ${t4Days()} 天。</b>零售收入填写扣退前销售额，退货、退款及返款单独扣减。人工值优先；将格子留空并保存可取消覆盖，恢复导入值或参数计算。</div>`
    + '<div id="t4EntryError" class="note c" role="alert" hidden></div>'
    + t4OverrideNotice([c.id], t4EntryRange(false))
    + t4EntryTable(c.id, '销售与成本') + t4EntryTable(c.id, '运营费用')
    + t4EntryTable(c.id, '直接管理费用') + t4EntryTable(c.id, '间接管理费用');
};

function t4EntryRange(summary) {
  const from = summary ? T4.sumDate : T4.manFrom, to = summary ? T4.sumTo : T4.manTo;
  const start = t4ValidDate(from) && from.startsWith(T4.period + '-') ? from : t4Date(1);
  const end = t4ValidDate(to) && to.startsWith(T4.period + '-') ? to : (summary ? start : t4Date(t4Days()));
  return t4ValidateRange(start, end < start ? start : end);
}
function t4EntryRangeControls(summary) {
  const dates = t4EntryRange(summary), prefix = summary ? 't4Sum' : 't4Man';
  return `<label class="sel">起 <input id="${prefix}From" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${dates[0]}"></label><label class="sel">止 <input id="${prefix}To" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${dates[dates.length - 1]}"></label>`;
}
function t4SummaryEntryTable(group, dates, keys, title) {
  const fs = T4_INPUTS.filter(f => f.g === group && (!keys || keys.includes(f.k)));
  const rows = dates.flatMap(dt => T4_CH.map(c => {
    const raw = t4Raw(c.id, dt) || {}, r = t4Row(c.id, dt);
    return [H(dt), t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
      ...fs.map(f => { const value = t4InputValue(raw, f.k), v = value != null ? value : '', id = `t4hint-${c.id}-${dt}-${f.k}`, hint = t4OverrideHint(raw, f.k, id); return `<input type="number" step="0.01" class="t4in" data-t4sumcell="${dt}:${c.id}:${f.k}" data-t4orig="${v}" value="${v}" aria-label="${H(dt + ' ' + c.n + ' ' + f.n)}" ${hint ? `aria-describedby="${id}"` : ''} placeholder="—">${hint}`; }),
      r ? `<b class="${r.netProfit >= 0 ? 'grn' : 'red'}">${money(r.netProfit)}</b>` : '—'];
  }));
  return card(title || group, table([{t:'日期'},{t:'归属事业部'},{t:'渠道'}, ...fs.map(f => ({t:f.n,n:1})), {t:'当日净利润',n:1}], rows));
}
S['t4-summan'] = () => {
  t4Load(); const sc = t4SumScope(), dates = t4EntryRange(true);
  T4.sumDate = dates[0]; T4.sumTo = dates[dates.length - 1];
  return head(`汇总录入 · ${sc.n}`, '选择起止日期，每个日期分别填写各渠道收入与成本。一个格子只对应一天，不会复制到其他日期。', '工具箱 · T4',
    t4PeriodControl(`${t4EntryRangeControls(true)}<button class="btn" data-t4go="overview">← 返回</button><button class="btn pri" data-t4act="sumManSave">保存全部渠道</button>`))
    + `<div class="note"><b>只保存发生变化的格子。</b>零售收入填写扣退前销售额，退货、退款及返款单独扣减。留空并保存取消人工覆盖，恢复文件值或参数。填 0 表示当日确认为零。退货金额、退款金额和退货成本按负数录入；返款填正数。切换日期前请保存本页变更。</div>`
    + '<div id="t4EntryError" class="note c" role="alert" hidden></div>'
    + t4OverrideNotice(T4_CH.map(c => c.id), dates)
    + t4SummaryEntryTable('销售与成本', dates, sc.keys, `${sc.n} · ${dates[0]} ～ ${dates[dates.length - 1]}`);
};
function t4EntryDirty() {
  return [...document.querySelectorAll('[data-t4cell], [data-t4sumcell]')].some(inp => inp.value.trim() !== String(inp.dataset.t4orig ?? ''));
}
async function t4SaveEntries(summary) {
  t4AssertEditable();
  const changes = [];
  document.querySelectorAll(summary ? '[data-t4sumcell]' : '[data-t4cell]').forEach(inp => {
    const parts = String(summary ? inp.dataset.t4sumcell : inp.dataset.t4cell).split(':');
    const [dt, ch, key] = summary ? (parts.length === 3 ? parts : [T4.sumDate, ...parts]) : [parts[0], T4.editCh, parts[1]];
    if (inp.validity?.badInput) throw new Error(`${dt} 金额格式无效`);
    const value = inp.value.trim();
    if (value === String(inp.dataset.t4orig ?? '')) return;
    t4ValidateRange(dt, dt);
    if (!T4_CHM[ch] || !T4_INPUT_KEYS.includes(key)) throw new Error('录入渠道或科目无效');
    const num = value === '' ? null : t4ImportAmount(value);
    if (num !== null && !Number.isFinite(num)) throw new Error(`${dt} ${T4_CHM[ch].n} 金额无效`);
    changes.push({ dt, ch, key, num });
  });
  if (!changes.length) return 0;
  const before = t4Clone(T4.data);
  try {
    changes.forEach(({ dt, ch, key, num }) => {
      const raw = T4.data[ch][dt] || { _src: 'manual', _fileParts: {} };
      if (num === null) {
        delete raw[key];
        if (raw._manualFields) delete raw._manualFields[key];
      } else if (key === 'rebateAmount') {
        raw[key] = -Math.abs(num) || 0;
        // A new rebate must not relabel the day's existing imported amounts.
        (raw._manualFields ||= {})[key] = true;
      } else { raw[key] = num; raw._src = 'manual'; }
      if (t4HasInputs(raw)) T4.data[ch][dt] = raw; else delete T4.data[ch][dt];
    });
    changes.forEach(({ ch, dt }) => t4AssertIncomeOverride(before[ch]?.[dt], t4Raw(ch, dt), ch, dt));
    await t4Save();
  } catch (e) { t4RestorePeriodData(before); throw e; }
  return changes.length;
}

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
  if (m) return `${T4.period.slice(0, 4)}-${String(+m[1]).padStart(2,'0')}-${String(+m[2]).padStart(2,'0')}`;
  const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function t4Add(ch, dt, key, value, fileK) {
  if (key === 'rebateAmount') value = -Math.abs(value) || 0;
  const raw = T4.data[ch][dt] || { _src: 'file', _fileParts: {} };
  if (!raw._fileParts) raw._fileParts = {};
  if (!raw._fileParts[fileK]) raw._fileParts[fileK] = {};
  const part = raw._fileParts[fileK];
  part[key] = (part[key] || 0) + value; raw._src = 'file';
  T4.data[ch][dt] = raw;
}
function t4ClearSource(ch, fileK, dates = null, keys = null) {
  Object.keys(T4.data[ch] || {}).forEach(dt => {
    if (dates && !dates.has(dt)) return;
    const r = T4.data[ch][dt];
    if (r._fileParts && r._fileParts[fileK]) {
      if (keys) keys.forEach(key => delete r._fileParts[fileK][key]);
      else delete r._fileParts[fileK];
    }
    if (!t4HasInputs(r)) delete T4.data[ch][dt];
  });
}

function t4ResolveChannel(value) {
  const norm = x => String(x == null ? '' : x).toLowerCase().replace(/[\s\-_—（）()]/g, '');
  const aliases = { 京东自营店: 'jdzy', 京东pop: 'jdpop', 抖音达人: 'dycreator', 有赞: 'priv',
    京东澳乐玩具旗舰店: 'jdpop', 快手澳乐母婴旗舰店: 'ks',
    // 吉客云「销售渠道」用店铺全名
    快手澳乐母婴品牌店: 'ks',
    // 渠道改店铺全名后，旧文件/旧数据里的简称仍要认
    天猫: 'tmall', 私域: 'priv', 团购: 'groupbuy', 天门: 'tianmen', 抖音达人店: 'dycreator', 礼品单: 'gift',
    京东自营: 'jdzy', 唯品会: 'vip' };
  const raw = String(value == null ? '' : value).trim();
  const n = norm(raw);
  const override = t4ChOverrides().slice().reverse().find(c => (c.aliases || []).some(a => norm(a) === n));
  if (override && T4_CHM[override.id]) return override.id;
  const exact = T4_CH.find(c => norm(c.n) === n || norm(c.id) === n);
  if (exact) return exact.id;
  if (aliases[raw]) return aliases[raw];
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
    + `<div class="note g"><b>模板就是吉客云导出的「销售单明细账」原版（28 列一列不少）。</b>吉客云导出的文件不用改一个字、直接选进来；从其他系统来的数据按模板列序套进去再导也一样。收入与成本使用<b>同一份模板，一次导入</b>：分摊后金额＝零售收入，货品成本＝零售成本，其余列自动忽略。</div>`
    + card('汇总文件要求（吉客云销售单明细账直接导入）', table([{t:'字段'},{t:'要求'}], [
      ['渠道 / 销售渠道', `必填；支持渠道名或店铺全名：${T4_CH.map(c => c.n).join('、')}、天猫-澳乐旗舰店、京东-澳乐官方旗舰店、快手-澳乐母婴品牌店`],
      ['日期 / 发货时间', '必填；只导入当前期间的数据，同渠道同日多行自动累加'],
      [`${sc.n}科目`, `${sc.fileK === 'summaryIncome' ? '分摊后金额（即零售收入）' : sc.fileK === 'summaryCost' ? '货品成本（即零售成本）' : '分摊后金额＝零售收入，货品成本＝零售成本'}；也认${scItems.map(x => x.n).join('、')}列名。空白不覆盖，明确的 0 会导入`],
      ['订单类型', '选填；「退货」行自动按负数计入退货科目；「售后发货」按源表实际金额计入收入/成本，包括明确的 0'],
    ]))
    + `<div class="note"><b>支持 .xlsx、.xls、.csv、.tsv。</b>默认只替换文件覆盖日期的${sc.n}来源数据，其他日期及其他来源保留。也可指定本月内起止日期；收入与成本一次验证、一次保存，未提供的科目分区保留。</div>`;
  const def = T4_FILE_DEFS.summaryDaily, hdr = imp.rows[imp.headRow] || [];
  const fields = def.fields.filter(([k]) => ['date','bu','channel','type','product'].includes(k) || sc.keys.includes(k));
  const options = k => hdr.map((x, i) => `<option value="${i}" ${imp.map[k] === i ? 'selected' : ''}>${H(String(x || '(空)').slice(0,30))}</option>`).join('');
  return head(`汇总导入 · ${sc.n} · ${H(imp.fileName)}`, `确认渠道、日期及${sc.n}科目的列对应关系。`, '工具箱 · T4', '<button class="btn" data-t4act="sumImpCancel">取消</button>')
    + `<div class="frow" style="margin-bottom:13px"><span class="fi">✓</span><span><span class="fn">${H(imp.fileName)}</span><br><span class="fm">${imp.rows.length} 行</span></span></div>`
    + cardp('表头行', `<select id="t4head">${imp.rows.slice(0,15).map((r,i) => `<option value="${i}" ${i===imp.headRow?'selected':''}>第 ${i+1} 行：${H(r.filter(Boolean).slice(0,6).join(' | ').slice(0,80))}</option>`).join('')}</select>`)
    + card('列对应', table([{t:'目标字段'},{t:'文件字段'}], fields.map(([k,n]) => [`${H(n)}${def.required.includes(k) ? ' <span class="red">*</span>' : ''}`, `<select data-t4map="${k}"><option value="">— 不使用 —</option>${options(k)}</select>`])))
    + t4ImportRangeControls(imp)
    + t4ImportFeedback()
    + t4ChannelReview(imp)
    + `<div style="display:flex;justify-content:flex-end"><button class="btn pri" data-t4act="sumImpRun" ${t4SummaryReady(imp) && !t4IsPeriodLocked() ? '' : 'disabled'}>导入全部渠道</button></div>`;
};

async function t4PickSummaryFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      const rows = await XLSXLite.readTable(file), def = T4_FILE_DEFS.summaryDaily;
      const headRow = t4FindHead(rows, def);
      T4.importFeedback = null;
      T4.imp = { mode: 'summary', fileK: 'summaryDaily', fileName: file.name, rows, headRow, map: t4AutoMap(rows[headRow] || [], def) };
      t4Go('sumimp');
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
}

function t4ImportChannel(imp, row, index) {
  return (imp.channelOverrides || {})[index] || t4ResolveChannel(row[imp.map.channel]);
}
function t4ChannelReview(imp) {
  if (imp.map.channel == null) return '';
  const rows = [];
  imp.rows.slice(imp.headRow + 1).forEach((row, i) => {
    const index = imp.headRow + 1 + i, source = String(row[imp.map.channel] || '');
    if (!/有赞/.test(source)) return;
    const product = imp.map.product == null ? '' : String(row[imp.map.product] || '');
    const ch = t4ImportChannel(imp, row, index);
    rows.push([String(index + 1), H(source), H(product || '未提供货品名称'), /枕/.test(product) ? pill('枕头待核对', 'wa') : '',
      `<select aria-label="第 ${index + 1} 行目标渠道" data-t4rowchannel="${index}">${T4_CH.map(c => `<option value="${c.id}" ${ch === c.id ? 'selected' : ''}>${H(c.n)}</option>`).join('')}</select>`]);
  });
  return rows.length ? card('有赞明细渠道调整', table([{t:'源行'},{t:'原渠道'},{t:'货品名称'},{t:'提示'},{t:'本次入账渠道'}], rows))
    + '<div class="note">有赞枕头可在这里手动调至对应 zzzrest 渠道。收入与成本使用同一行的渠道调整。</div>' : '';
}

async function t4SummaryImpRun() {
  const imp = T4.imp;
  if (!imp || imp.mode !== 'summary' || !t4SummaryReady(imp)) return;
  let range;
  try { t4AssertEditable(); range = t4ImportRange(imp); } catch (e) { t4RejectImport(e.message); return; }
  const sc = t4SumScope(), pending = [], errors = [], issues = [];
  let used = 0, skipped = 0;
  imp.rows.slice(imp.headRow + 1).forEach((row, i) => {
    if (!row.some(v => v != null && String(v).trim())) return;
    const line = imp.headRow + i + 2, get = k => imp.map[k] == null ? '' : row[imp.map[k]];
    const skip = reason => { skipped++; issues.push(`第 ${line} 行：${reason}`); };
    const ch = t4ImportChannel(imp, row, imp.headRow + 1 + i), dt = t4DateNorm(get('date'));
    if (!ch) { skip(`未识别渠道「${String(get('channel') || '').slice(0, 80)}」`); return; }
    if (!t4ValidDate(dt)) { skip('日期无效'); return; }
    if (!dt.startsWith(T4.period + '-') || (range && !range.includes(dt))) { skip('日期不在本次导入范围'); return; }
    const isReturn = /退货/.test(String(get('type')).trim());
    let wrote = false;
    sc.keys.forEach(k => {
      if (imp.map[k] == null) return;
      const value = get(k);
      if (value == null || String(value).trim() === '') return;
      let key = k, num = t4ImportAmount(value);
      if (!Number.isFinite(num)) { errors.push(`第 ${line} 行 ${(T4_INPUTS.find(f => f.k === k) || {}).n || k}金额无效`); return; }
      if (isReturn && k === 'retailIncome') { key = 'returnAmount'; num = -Math.abs(num); }
      else if (isReturn && k === 'retailCost') { key = 'returnCost'; num = -Math.abs(num); }
      const source = T4_SUM_SCOPES.cost.keys.includes(k) ? 'summaryCost' : 'summaryIncome';
      pending.push({ ch, dt, key, num, source }); wrote = true;
    });
    if (!wrote) { skip('未提供本次科目的金额'); return; }
    used++;
  });
  if (errors.length) { t4RejectImport('金额校验未通过，收入与成本均未写入，原数据已保留。', errors.concat(issues)); return; }
  if (!pending.length) { t4RejectImport('没有可导入的当前范围明细，原数据已保留。', issues); return; }
  try { await t4CommitImport(imp, pending, used, skipped, issues, range); }
  catch (e) { t4RejectImport(`导入未同步：${e.message}；原数据与记录已恢复。`, issues); }
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
  瑞眠: 'ruimian', 瑞眠事业部: 'ruimian', 橘农: 'orange', 橘农事业部: 'orange', 经销: 'dealer', 经销事业部: 'dealer' };

const t4ChClean = v => String(v == null ? '' : v).replace(/[\uFEFF\u200B\s]+/g, '').toLowerCase();
const t4ChNorm = v => t4ChClean(v).replace(/[-_—（）()]/g, '');
const T4_CH_HEADERS = {
  id: ['渠道id', 'id'], bu: ['归属事业部', '事业部', '所属事业部'],
  source: ['销售渠道', '店铺', '店铺名称', '渠道名称', '渠道'],
  target: ['渠道汇总', '汇总渠道'],
};
function t4ChSchema(input) {
  let rows = input;
  const has = (v, key) => T4_CH_HEADERS[key].includes(t4ChClean(v));
  const findHeader = table => table.reduce((best, row, index) => {
    const roles = Object.keys(T4_CH_HEADERS).filter(key => row.some(v => has(v, key)));
    if (!roles.includes('source') && !roles.includes('target')) return best;
    const score = roles.length * 100 + Math.min(50, row.filter(v => t4ChClean(v)).length);
    return score > best.score ? { index, score, roles: roles.length } : best;
  }, { index: -1, score: -1, roles: 0 });
  let headerMatch = findHeader(rows);
  // 完整的横向表头优先，避免标题中的“销售渠道”把普通清单误判为转置表。
  if (headerMatch.roles < 2 && rows.some(r => has(r[0], 'bu')) && rows.some(r => has(r[0], 'source') || has(r[0], 'target'))) {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    rows = Array.from({ length: width }, (_, col) => rows.map(r => r[col] ?? ''));
    headerMatch = findHeader(rows);
  }
  const headRow = headerMatch.index;
  if (headRow < 0) return null;
  const header = rows[headRow], body = rows.slice(headRow + 1);
  const map = Object.fromEntries(Object.keys(T4_CH_HEADERS).map(key => [key, header.findIndex(v => has(v, key))]));
  const used = new Set(Object.values(map).filter(i => i >= 0)), names = new Set(), extra = [];
  const width = body.reduce((max, row) => Math.max(max, row.length), header.length);
  for (let col = 0; col < width; col++) {
    if (used.has(col)) continue;
    const name = String(header[col] ?? '').trim() || (body.some(r => String(r[col] ?? '').trim()) ? `第${col + 1}列` : '');
    if (!name) continue;
    if (names.has(t4ChClean(name))) throw new Error(`附加列「${name}」重名，请使用不同的表头名称`);
    names.add(t4ChClean(name)); extra.push({ col, name });
  }
  return { body, map, extra, renameByName: ['渠道名称', '渠道'].includes(t4ChClean(header[map.source])) };
}
function t4ChExtraFields() {
  const fields = new Map();
  T4_CH.forEach(c => (c.details || []).forEach(r => (r.fields || []).forEach(f => {
    const key = t4ChClean(f.name); if (!fields.has(key)) fields.set(key, f.name);
  })));
  return [...fields.values()];
}
function t4ChFieldRows(name) {
  return T4_CH.flatMap(c => (c.details || []).flatMap(r => {
    const field = (r.fields || []).find(f => t4ChClean(f.name) === t4ChClean(name));
    return field ? [{ channel: c.id, source: r.source, value: field.value }] : [];
  }));
}
function t4ChSourceRows() {
  const imported = T4_CH.some(c => (c.details || []).length);
  return T4_CH.flatMap(c => {
    const details = c.details || [];
    if (details.length) return details.map(r => ({ channel: c.id, source: r.source, target: c.n, fields: r.fields || [] }));
    if (imported) return [];
    return [{ channel: c.id, source: c.n, target: c.n, fields: [] }];
  });
}
// 渠道列表导入后，仍把尚未出现在文件中的内置渠道展示出来，避免用户误以为
// 它们被导入覆盖或删除。它们只作为“未导入基础渠道”展示，不计入销售渠道导入数。
function t4ChDisplaySourceRows() {
  const importedRows = T4_CH.flatMap(c => (c.details || []).map(r => ({
    channel: c.id, source: r.source, target: c.n, fields: r.fields || [], fallback: false,
  })));
  if (!importedRows.length) return t4ChSourceRows().map(r => ({ ...r, fallback: true }));
  const seen = new Set(importedRows.map(r => r.channel));
  const fallbackRows = T4_CH.filter(c => !seen.has(c.id)).map(c => ({
    channel: c.id, source: c.n, target: c.n, fields: [], fallback: true,
  }));
  return [...importedRows, ...fallbackRows];
}
function t4ChTemplateRows() {
  const extra = t4ChExtraFields();
  const sources = new Set([...Object.keys(T4_SOURCE_CHANNEL_MAP), ...T4_CH.flatMap(c =>
    [c.n, ...(c.aliases || []), ...(c.details || []).map(r => r.source)])]);
  const rows = [['渠道ID', '销售渠道', '归属事业部', '渠道汇总', ...extra]];
  sources.forEach(source => {
    const id = t4ResolveChannel(source), c = T4_CHM[id]; if (!c) return;
    const fields = (c.details || []).find(r => t4ChNorm(r.source) === t4ChNorm(source))?.fields || [];
    rows.push([id, source, t4BuName(c.bu), c.n, ...extra.map(name => fields.find(f => t4ChClean(f.name) === t4ChClean(name))?.value ?? '')]);
  });
  return rows;
}
async function t4ChTemplate() {
  try {
    downloadBlob('渠道列表.xlsx', XLSXWrite.build([{ name: '渠道列表', rows: t4ChTemplateRows() }]));
    toast('已下载当前渠道列表，包含新增渠道和附加字段');
  } catch (e) { toast(`模板下载失败：${e.message || e}`, 5000); }
}
function t4ChApplyRows(rows) { return t4ChApplySheets([rows]); }
function t4ChApplySheets(sheets) {
  const schemas = sheets.map(t4ChSchema).filter(Boolean);
  if (!schemas.length) throw new Error('未找到渠道表头，请包含「销售渠道 / 渠道名称 / 渠道汇总」列');
  // 整份工作簿先在内存中合并，通过校验后一次写入，避免导入一半就改变当前渠道。
  const ov = t4ChOverrides();
  let channels = t4ChannelList(ov), cusMax = 0;
  channels.forEach(c => { const m = /^cus(\d+)$/.exec(c.id); if (m) cusMax = Math.max(cusMax, +m[1]); });
  const put = entry => {
    const i = ov.findIndex(o => o.id === entry.id);
    if (i < 0) ov.push(entry); else ov[i] = { ...ov[i], ...entry };
  };
  const resolve = name => {
    const n = t4ChNorm(name); if (!n) return null;
    return channels.find(c => t4ChNorm(c.n) === n || t4ChNorm(c.id) === n)
      || channels.find(c => (c.aliases || []).some(a => t4ChNorm(a) === n))
      || channels.find(c => c.id === t4ResolveChannel(name));
  };
  let renamed = 0, moved = 0, added = 0, mapped = 0, imported = 0;
  const bad = [];
  schemas.forEach(({ body, map, extra, renameByName }) => body.forEach(row => {
    const get = key => map[key] < 0 ? '' : String(row[map[key]] ?? '').trim();
    const source = get('source') || get('target'), name = get('target') || source;
    if (!name) return;
    if (T4_CH_HEADERS.source.includes(t4ChClean(source)) || T4_CH_HEADERS.target.includes(t4ChClean(name))) return;
    const buRaw = get('bu'), buKey = buRaw.replace(/\s/g, '');
    const bu = Object.prototype.hasOwnProperty.call(T4_BU_ALIAS, buKey) ? T4_BU_ALIAS[buKey] : '';
    if (buRaw && !bu) { bad.push(`${name}（事业部「${buRaw}」不识别）`); return; }
    const idRaw = get('id');
    let target = (map.target < 0 && idRaw && channels.find(c => c.id === idRaw)) || resolve(name);
    if (target) {
      const entry = { id: target.id };
      // 映射表以渠道汇总为准，旧 ID 不能把调整归集误当成改名。
      if (name !== target.n && map.target < 0 && (idRaw || renameByName)) {
        entry.n = name; entry.aliases = [...new Set([...(ov.find(o => o.id === target.id)?.aliases || []), target.n])]; renamed++;
      }
      if (bu && bu !== target.bu) { entry.bu = bu; moved++; }
      put(entry);
    } else {
      const id = /^[a-z][a-z0-9_]*$/i.test(idRaw) && !['__proto__','constructor','prototype'].includes(idRaw) && !channels.some(c => c.id === idRaw)
        ? idRaw : `cus${++cusMax}`;
      const customNumber = /^cus(\d+)$/.exec(id);
      if (customNumber) cusMax = Math.max(cusMax, +customNumber[1]);
      put({ id, n: name, bu: bu || 'dealer' }); added++;
      if (!bu) bad.push(`${name}（未填事业部，暂归经销）`);
      target = { id, n: name };
    }
    // 别名迁移时连同这个销售渠道的附加字段一起移动，防止字段挂在旧归集渠道上。
    const norm = t4ChNorm(source), fields = [];
    ov.forEach(o => {
      const detail = (o.details || []).find(r => t4ChNorm(r.source) === norm);
      if (detail) fields.push(...(detail.fields || []));
      if (o.id !== target.id) {
        if (o.aliases) o.aliases = o.aliases.filter(a => t4ChNorm(a) !== norm);
        if (o.details) o.details = o.details.filter(r => t4ChNorm(r.source) !== norm);
      }
    });
    const entry = ov.find(o => o.id === target.id);
    if (t4ChNorm(source) !== t4ChNorm(target.n) && !(entry.aliases || []).some(a => t4ChNorm(a) === norm)) {
      entry.aliases = [...(entry.aliases || []), source]; mapped++;
    }
    extra.forEach(({ col, name: fieldName }) => {
      const f = { name: fieldName, value: String(row[col] ?? '').trim() };
      const i = fields.findIndex(v => t4ChClean(v.name) === t4ChClean(fieldName));
      if (i < 0) fields.push(f); else fields[i] = { ...f, name: fields[i].name };
    });
    // 即使这次只有“销售渠道/归属事业部”等基础列，也要落一条明细记录。
    // 否则后续页面无法知道该别名已经被导入，且再次导入时会被当成未关联渠道。
    entry.details = [...(entry.details || []).filter(r => t4ChNorm(r.source) !== norm), { source, fields }];
    channels = t4ChannelList(ov); imported++;
  }));
  if (!imported) throw new Error(`没有可导入的渠道${bad.length ? '：' + bad.slice(0, 3).join('、') : '，请在表头下填写渠道名称'}`);
  t4SaveChOverrides(ov); t4RebuildChannels();
  return { renamed, moved, added, mapped, bad, imported, sheets: schemas.length };
}

function t4ChPickFile() {
  try { t4RequireServerReady(); } catch (err) { toast(err.message, 5200); return; }
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      if (T4_SERVER_SAVING || T4_SERVER_LOADING) throw new Error('正在同步，请稍后再导入');
      t4RequireServerReady();
      const sheets = await XLSXLite.readSheets(file), previous = t4Clone(t4ChOverrides());
      let r, channels, importedChannels;
      try {
        r = t4ChApplySheets(sheets); channels = t4Clone(t4ChOverrides());
        const sources = new Set();
        sheets.map(t4ChSchema).filter(Boolean).forEach(({ body, map }) => body.forEach(row => {
          const bu = map.bu < 0 ? '' : String(row[map.bu] || '').replace(/\s/g, '');
          if (bu && !Object.hasOwn(T4_BU_ALIAS, bu)) return;
          const source = (map.source < 0 ? '' : row[map.source]) || (map.target < 0 ? '' : row[map.target]);
          if (source) sources.add(t4ChNorm(source));
        }));
        importedChannels = channels.filter(c => (c.details || []).some(d => sources.has(t4ChNorm(d.source)))).map(c => c.id);
      } finally { t4SaveChOverrides(previous); t4RebuildChannels(); }
      const dates = Array.from({ length: t4Days() }, (_, i) => t4Date(i + 1));
      await t4SaveCatalog('channels', channels, { fileName: file.name, scope: '渠道列表', mode: 'file',
        dates, from: dates[0], to: dates[dates.length - 1], channels: importedChannels,
        used: r.imported, skipped: r.bad.filter(x => !x.includes('未填事业部')).length, issues: r.bad });
      t4Load(); T4.chField = '__sources'; t4Go('channels');
      const warn = r.bad.length ? `；注意：${r.bad.slice(0, 3).join('、')}` : '';
      toast(`已识别 ${r.sheets} 张渠道表：读取销售渠道 ${r.imported} 条，新增归集渠道 ${r.added}、映射销售渠道 ${r.mapped}、改名 ${r.renamed}、调事业部 ${r.moved}${warn}`, 5600);
    } catch (e) { toast(`渠道导入未完成：${e.message || e}`, 5000); }
  };
  input.click();
}

function t4MgmtTemplate() {
  const hdr = ['归属事业部','渠道', ...T4_MGMT_FIELDS.map(([,n]) => n)];
  const rows = T4_CH.map(c => { const cfg = T4.cfg[c.id] || {};
    return [t4BuName(c.bu), c.n, ...T4_MGMT_FIELDS.map(([k]) => cfg[k] != null ? cfg[k] : '')]; });
  download(`T4管理费分摊模板_${T4.period}.csv`, toCSV([hdr, ...rows])); toast('已下载管理费分摊模板（当前值已预填）');
}

function t4MgmtApplyRows(rows, kind = 'expense') {
  t4AssertEditable();
  const result = T4Allocation.analyze(rows, kind, t4ResolveChannel);
  if (result.errors.length || result.unknown.length) throw new Error('分摊表有无效金额或未匹配渠道，请在预览中核对');
  result.entries.forEach(entry => Object.assign(T4.cfg[entry.channel] ||= {}, entry.values));
  return result;
}

function t4AnalyzeAllocation() {
  const imp = T4.allocImport;
  if (imp) imp.result = T4Allocation.analyze(imp.sheets[imp.sheet], imp.kind, t4ResolveChannel);
}
function t4AllocationPreview() {
  const imp = T4.allocImport; if (!imp) return '';
  const r = imp.result, valid = r.entries.length && !r.errors.length && !r.unknown.length && !t4IsPeriodLocked();
  const issues = r.errors.map(x => `第 ${x.row} 行：${x.message}`).concat(r.unknown.map(x => `第 ${x.row} 行：未匹配渠道「${x.name}」`));
  return cardp(`${imp.kind === 'payroll' ? '工资底稿' : '费用分摊表'} · ${H(imp.fileName)}`,
    `<label>工作表 <select id="t4AllocationSheet">${imp.sheets.map((_, i) => `<option value="${i}" ${i === imp.sheet ? 'selected' : ''}>第 ${i + 1} 张工作表</option>`).join('')}</select></label><p>写入 ${T4.period}，已匹配 ${r.entries.length} 个渠道。空白保留原值，零金额按 0 写入。相同渠道多行自动合计。</p>`)
    + (issues.length ? `<div class="note w">${issues.map(H).join('<br>')}<br>请修正源文件或渠道列表后重新导入。</div>` : '')
    + card('导入预览（元/月）', table([{t:'源行'},{t:'渠道'}, ...T4_MGMT_FIELDS.map(([,n]) => ({t:n,n:1}))],
      r.entries.map(entry => [entry.rows.join('、'), H(T4_CHM[entry.channel].n), ...T4_MGMT_FIELDS.map(([k]) => entry.values[k] == null ? '保留原值' : money(entry.values[k]))])))
    + `<div class="frow"><button class="btn" data-t4act="allocationCancel">取消导入</button><button class="btn pri" data-t4act="allocationApply" ${valid ? '' : 'disabled'}>确认写入 ${T4.period}</button></div>`;
}
async function t4ApplyAllocationImport() {
  t4AssertEditable();
  const imp = T4.allocImport; if (!imp) return;
  const before = t4Clone(T4.cfg), history = t4Clone(T4.importHistory || {}), period = T4.period;
  try {
    t4RequireServerReady();
    const r = t4MgmtApplyRows(imp.sheets[imp.sheet], imp.kind);
    if (!r.entries.length) throw new Error('没有可写入的分摊金额');
    const dates = Array.from({ length: t4Days() }, (_, i) => t4Date(i + 1));
    t4AddImportHistory({ fileName: imp.fileName, scope: imp.kind === 'payroll' ? '工资分摊' : '费用分摊', mode: 'file',
      dates, from: dates[0], to: dates[dates.length - 1], channels: r.entries.map(x => x.channel), used: r.matchedRows, skipped: 0, issues: [] });
    await t4SaveCfg(); T4.allocImport = null; t4Go('mgmt');
    toast(`已写入 ${period} 的 ${r.entries.length} 个渠道，日损益自动按月分摊`);
  } catch (e) {
    if (T4.period === period) T4.cfg = before;
    T4.importHistory = history;
    localStorage.setItem(T4_IMPORT_HISTORY_KEY, JSON.stringify(history));
    const all = t4Stored(T4_PERIOD_CFG_KEY, {}); all[period] = before;
    localStorage.setItem(T4_PERIOD_CFG_KEY, JSON.stringify(all));
    toast(`未完成导入：${e.message}`, 5200);
  }
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

function t4MgmtPickFile(kind = 'expense') {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.tsv,.txt';
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try {
      const sheets = await XLSXLite.readSheets(file);
      const results = sheets.map(rows => T4Allocation.analyze(rows, kind, t4ResolveChannel));
      const sheet = results.reduce((best, r, i) => r.entries.length > results[best].entries.length ? i : best, 0);
      T4.allocImport = { kind, sheets, sheet, fileName: file.name, result: results[sheet] };
      t4Go('mgmt');
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
}

S['t4-imp'] = () => {
  t4Load(); const c = T4_CHM[T4.editCh], imp = T4.imp;
  if (!c.files.length) return head(`导入　${c.n}`, '该渠道没有标准源文件，请人工录入。', '工具箱 · T4', '<button class="btn" data-t4go="overview">← 返回</button>')
    + '<div class="note w">本渠道当前采用人工录入；录入值和文件导入值使用同一套损益计算。</div>';
  if (!imp) return head(`导入　${c.n}`, '选择源文件；默认只替换该文件覆盖的日期，其他日期保留，不会重复累计。', '工具箱 · T4', t4PeriodControl('<button class="btn" data-t4go="overview">← 返回</button>'))
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
    + t4ImportRangeControls(imp) + t4ImportFeedback()
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
      T4.importFeedback = null;
      T4.imp = { mode: 'channel', fileK, fileN: f.n, fileName: file.name, rows, headRow, map: t4AutoMap(rows[headRow] || [], def) };
      t4Go('imp');
    } catch (e) { toast(`读取失败：${e.message || e}`, 5000); }
  };
  input.click();
}

async function t4ImpRun() {
  let range;
  try { t4AssertEditable(); range = t4ImportRange(T4.imp || {}); } catch (e) { t4RejectImport(e.message); return; }
  const imp = T4.imp, ch = T4.editCh, def = imp && T4_FILE_DEFS[imp.fileK];
  if (!imp || !def || !def.required.every(k => imp.map[k] != null)
    || (imp.fileK === 'daily' && !T4_INPUT_KEYS.some(k => imp.map[k] != null))) return;
  const pending = [], errors = [], issues = [];
  const add = (dt, key, num) => pending.push({ ch, dt, key, num, source: imp.fileK });
  let used = 0, skipped = 0;
  imp.rows.slice(imp.headRow + 1).forEach((row, index) => {
    if (!row.some(v => v != null && String(v).trim())) return;
    const line = imp.headRow + index + 2, get = k => imp.map[k] == null ? '' : row[imp.map[k]];
    const skip = reason => { skipped++; issues.push(`第 ${line} 行：${reason}`); };
    const numeric = key => {
      const n = t4ImportAmount(get(key));
      if (Number.isNaN(n)) errors.push(`第 ${line} 行 ${key}金额无效`);
      return n;
    };
    const dt = t4DateNorm(get('date'));
    if (!t4ValidDate(dt)) { skip('日期无效'); return; }
    if (!dt.startsWith(T4.period + '-') || (range && !range.includes(dt))) { skip('日期不在本次导入范围'); return; }
    const start = pending.length;
    if (imp.fileK === 'daily') {
      T4_INPUT_KEYS.forEach(k => {
        if (imp.map[k] == null || get(k) == null || String(get(k)).trim() === '') return;
        add(dt, k, numeric(k));
      });
    } else if (imp.fileK === 'sales') {
      if (t4ResolveChannel(get('channel')) !== ch) { skip('渠道与当前渠道不符'); return; }
      const isReturn = /退货/.test(String(get('type')).trim()), amount = numeric('amount'), cost = numeric('cost');
      if (amount != null) add(dt, isReturn ? 'returnAmount' : 'retailIncome', isReturn ? -Math.abs(amount) : amount);
      if (cost != null) add(dt, isReturn ? 'returnCost' : 'retailCost', isReturn ? -Math.abs(cost) : Math.abs(cost));
      if (imp.map.research != null && get('research') != null && String(get('research')).trim()) add(dt, 'research', Math.abs(numeric('research')));
    } else {
      if (imp.fileK === 'ztc' && ((String(get('direction')) && !/支出/.test(String(get('direction')))) || /充值/.test(String(get('type'))))) { skip('非支出或充值行'); return; }
      const amount = numeric('amount');
      if (amount != null) {
        const key = { ztc: 'ztc', cps: 'cps', jzt: 'promotion', jdIncome: 'retailIncome' }[imp.fileK];
        if (key) add(dt, key, imp.fileK === 'jdIncome' ? amount : Math.abs(amount));
      }
    }
    if (pending.length === start) { skip('未提供金额'); return; }
    used++;
  });
  if (errors.length) { t4RejectImport('金额校验未通过，原数据已保留。', errors.concat(issues)); return; }
  if (!pending.length) { t4RejectImport('没有可导入的当前范围明细，原数据已保留。', issues); return; }
  try { await t4CommitImport(imp, pending, used, skipped, issues, range); }
  catch (e) { t4RejectImport(`导入未同步：${e.message}；原数据与记录已恢复。`, issues); }
}

// 损益树的列：一条从销售收入到净利润的「层层递减」链
const T4_TREE_COLS = [
  ['salesIncome', '销售收入'], ['rebateAmount', '返款金额'], ['salesCost', '销售成本'], ['grossProfit', '毛利'], ['grossMargin', '毛利率', true],
  ['operating', '运营费'], ['contribution', '边际毛利'], ['mgmt', '管理费'], ['rebateIncome', '返利收入'], ['netProfit', '净利润'], ['netMargin', '净利率', true], ['salesReceipt', '销售回款（仅记录）'],
];
const t4TreeVal = (g, key) => key === 'mgmt' ? (g.direct || 0) + (g.indirect || 0) : (g[key] || 0);
function t4PinnedTable(cols, rows, count = 1) {
  return table(cols, rows).replace('<div class="tw">', `<div class="tw t4-pinned-${count === 2 ? 'two' : 'one'}" tabindex="0" aria-label="可左右滚动的表格，左侧字段固定">`);
}
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
      { id: 'proj:orange', name: '橘农项目', lvl: 1, ids: T4_ORANGE, children: [
        buNode('orange', '橘农事业部', T4_ORANGE),
      ].filter(n => n.ids.length) },
    ].filter(n => n.ids.length),
  }];
}

S['t4-sheet'] = () => {
  t4Load();
  const vr = t4ViewRange();
  const grpOf = ids => vr ? t4GroupRange(ids, vr.from, vr.to) : t4Group(ids);
  const ctrl = t4PeriodControl(`<label class="sel">起 <input id="t4ViewFrom" data-view="sheet" type="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.from : ''}" title="当前月默认截至今天；选择月末可看整月" style="width:132px"></label><label class="sel">止 <input id="t4ViewTo" data-view="sheet" type="date" min="${vr ? vr.from : t4Date(1)}" max="${t4Date(t4Days())}" value="${vr ? vr.to : ''}" style="width:132px"></label>${t4ProjSelect('sheet')}<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="sheetMode">${T4.sheetMode === 'tree' ? '切换明细表' : '切换树视图'}</button><button class="btn" data-t4go="chday">每日明细</button><button class="btn" data-t4act="export">导出本表</button><button class="btn" data-t4act="rawExport" title="按当前项目和日期，导出按日归集的原始输入及来源">导出录入/导入数据</button><button class="btn" data-t4go="contacts">通讯录</button><button class="btn" data-t4go="mail">邮件发送</button><button class="btn pri" data-t4act="exportSuite">导出套表</button>`);
  const desc = vr ? `${vr.from} ～ ${vr.to}（${vr.n} 天）区间损益。` : '渠道月累计损益。';
  const title = vr ? `${vr.from} ～ ${vr.to} 区间损益（${vr.n} 天）` : '月累计损益';
  const overrides = t4OverrideNotice(t4ProjCH().map(c => c.id), vr ? t4RangeDates(vr.from, vr.to) : null);

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
      + overrides
      + card(title + ' · 树视图', t4PinnedTable(headers, rows))
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
    + overrides
    + card(title, t4PinnedTable(headers, rows))
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
    hasData.push(t4DayHasData(c.id, dt) || t4MgmtDaily(c.id).any);
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
    + t4OverrideNotice([c.id])
    + card(`${c.n} · ${T4.period} 每日损益表（实取 ${t4Filled(c.id)}/${days} 天）`, table(headers, rows));
};

// ---------- 邮件发送：收件人清单（服务端保存，多端共用）+ 按各自范围生成套表并逐人发送 ----------
const T4_EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
function t4ValidateContacts(list) {
  if (!Array.isArray(list) || list.length > 1000) throw new Error('通讯录最多保存 1000 位联系人');
  const seen = new Set();
  return list.map((r, i) => {
    const name = String(r.name || '').trim(), email = String(r.email || '').trim(), scope = r.scope || 'all';
    if (name.length > 100) throw new Error(`第 ${i + 1} 位联系人姓名不能超过 100 个字符`);
    if (email.length > 254 || !T4_EMAIL_RE.test(email)) throw new Error(`第 ${i + 1} 位联系人邮箱无效`);
    if (!T4_PROJ_OPTS.some(([k]) => k === scope)) throw new Error(`第 ${i + 1} 位联系人报表范围无效`);
    if (seen.has(email.toLowerCase())) throw new Error(`邮箱重复：${email}，请合并或删除重复联系人`);
    seen.add(email.toLowerCase());
    return { name, email, scope, enabled: r.enabled !== false };
  });
}
const t4ContactView = () => typeof CURS !== 'undefined' && CURS === 't4-contacts' ? 'contacts' : 'mail';
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
  const st = T4.mail; st.loading = true; st.error = '';
  try {
    const read = async url => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 401 ? '登录已失效或尚未登录，请从星逸门户重新进入财务中心。' : `读取配置失败（${r.status}），请稍后重试。`);
      return r.json();
    };
    const [list, status] = await Promise.all([read('/api/t4/recipients'), read('/api/t4/mail/status')]);
    if (!st.dirty) st.list = Array.isArray(list) ? list : [];
    st.status = status;
  } catch (e) { st.status = null; st.error = String(e.message || e); }
  st.loaded = true; st.loading = false;
  if (document.getElementById('t4ContactSearch')) t4Go(t4ContactView());
}
// 把页面上的收件人表格与主题/附言读回状态
function t4MailReadForm() {
  const names = document.querySelectorAll('[data-t4mailname]');
  const before = JSON.stringify(T4.mail.list);
  const val = (sel, i) => document.querySelector(`[${sel}="${i}"]`) || {};
  // 搜索仅显示部分联系人；按原索引更新，不能用过滤后的表格替换整个通讯录。
  [...names].forEach(inp => { const i = +inp.dataset.t4mailname;
    if (!T4.mail.list[i]) return;
    T4.mail.list[i] = { name: inp.value.trim(), email: String(val('data-t4mailaddr', i).value || '').trim(),
      scope: val('data-t4mailscope', i).value || 'all', enabled: !!val('data-t4mailon', i).checked };
  });
  if (before !== JSON.stringify(T4.mail.list)) T4.mail.dirty = true;
  const newName = document.getElementById('t4MailNewName');
  if (newName) T4.mail.newContact = { name: newName.value, email: (document.getElementById('t4MailNewAddr') || {}).value || '',
    scope: (document.getElementById('t4MailNewScope') || {}).value || 'all' };
  const s = document.getElementById('t4MailSubject'); if (s) T4.mail.subject = s.value.trim();
  const b = document.getElementById('t4MailBody'); if (b) T4.mail.body = b.value.trim();
}
async function t4MailSaveList() {
  const recipients = t4ValidateContacts(T4.mail.list);
  const snapshot = JSON.stringify(T4.mail.list);
  const response = await fetch('/api/t4/recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(recipients) });
  const message = await response.text();
  let result;
  try { result = JSON.parse(message); } catch (_) { result = {}; }
  if (!response.ok || result.ok !== true) throw new Error(result.error || message || `保存失败（${response.status}）`);
  // 保存期间若有新编辑，保留本地草稿，不让较早的响应覆盖。
  if (snapshot === JSON.stringify(T4.mail.list)) {
    T4.mail.list = recipients; T4.mail.dirty = false;
  }
  return result;
}
async function t4SaveContacts() {
  if (T4.mail.saving) return;
  if (T4.mail.loading || !T4.mail.loaded || T4.mail.error) { toast('请先读取通讯录，再保存修改'); return; }
  t4MailReadForm(); T4.mail.saving = true; T4.mail.saveError = '';
  t4Go(t4ContactView());
  try { await t4MailSaveList(); toast('通讯录已保存（多端共用）'); }
  catch (e) { T4.mail.saveError = String(e.message || e); toast(`保存失败：${T4.mail.saveError}。编辑草稿已保留`, 6000); }
  finally { T4.mail.saving = false; t4Go(t4ContactView()); }
}
function t4ContactsCard() {
  const st = T4.mail, query = String(st.search || '').trim().toLowerCase(), draft = st.newContact || {};
  const disabled = st.loading || !st.loaded || st.saving ? 'disabled' : '';
  const opts = (v, attr) => `<select ${attr} ${disabled}>${T4_PROJ_OPTS.map(([k, n]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const entries = st.list.map((r, i) => ({ r, i })).filter(({ r }) => !query || `${r.name || ''} ${r.email || ''}`.toLowerCase().includes(query));
  const rows = entries.map(({ r, i }) => [
    `<input type="checkbox" aria-label="启用联系人 ${i + 1}" data-t4mailon="${i}" ${r.enabled !== false ? 'checked' : ''} ${disabled}>`,
    `<input type="text" aria-label="联系人 ${i + 1} 姓名" data-t4mailname="${i}" value="${H(r.name || '')}" maxlength="100" style="width:110px" ${disabled}>`,
    `<input type="email" aria-label="联系人 ${i + 1} 邮箱" data-t4mailaddr="${i}" value="${H(r.email || '')}" maxlength="254" style="width:230px" ${disabled}>`,
    opts(r.scope || 'all', `aria-label="联系人 ${i + 1} 报表范围" data-t4mailscope="${i}"`),
    `<button class="btn sm" data-t4maildel="${i}" ${disabled}>删除</button>`]);
  return '<div class="t4-contacts">' + cardp('查找联系人', `<label class="sel">姓名或邮箱 <input id="t4ContactSearch" type="search" value="${H(st.search || '')}" placeholder="搜索通讯录"></label>`)
    + (st.saveError ? `<div class="note c" role="alert">${H(st.saveError)}。编辑草稿已保留，请修正后重试。</div>` : '')
    + card(`通讯录（显示 ${entries.length} / ${st.list.length} 位${st.dirty ? '，有未保存修改' : ''}）`,
      (rows.length ? table([{t:'启用'},{t:'姓名'},{t:'邮箱'},{t:'报表范围'},{t:'操作'}], rows) : `<div style="padding:14px">${st.loading ? '正在读取通讯录…' : query ? '没有匹配的联系人，可修改搜索条件。' : '还没有联系人，在下方添加。'}</div>`)
      + `<div style="padding:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="t4MailNewName" type="text" aria-label="新联系人姓名" placeholder="姓名" value="${H(draft.name || '')}" maxlength="100" style="width:110px" ${disabled}><input id="t4MailNewAddr" type="email" aria-label="新联系人邮箱" placeholder="邮箱" value="${H(draft.email || '')}" maxlength="254" style="width:230px" ${disabled}>${opts(draft.scope || 'all', 'id="t4MailNewScope" aria-label="新联系人报表范围"')}<button class="btn sm" data-t4act="mailAdd" ${disabled}>添加联系人</button></div>`)
    + '<div class="note">添加、修改或删除后点“保存通讯录”。停用联系人仍保留；邮件只发给已启用的联系人。同一邮箱只保留一位联系人，报表范围可直接修改。</div></div>';
}
S['t4-contacts'] = () => {
  const st = T4.mail;
  if (!st.loaded && !st.loading) t4MailLoad();
  return head('邮件通讯录', '按姓名或邮箱查找，维护联系人及默认报表范围。', '工具箱 · T4',
    `<button class="btn" data-t4go="mail">返回邮件发送</button><button class="btn pri" data-t4act="mailSave" ${st.loading || !st.loaded || st.saving || st.error ? 'disabled' : ''}>${st.saving ? '正在保存…' : '保存通讯录'}</button>`)
    + (st.error ? `<div class="note c" role="alert">${H(st.error)} <button class="btn sm" data-t4act="mailReload">重新读取</button></div>` : t4ContactsCard());
};
async function t4MailSend() {
  t4MailReadForm();
  const list = T4.mail.list.filter(r => r.enabled !== false && T4_EMAIL_RE.test(r.email || ''));
  if (!list.length) { toast('没有启用且邮箱有效的收件人'); return; }
  if (!(await t4SmtpEnsure())) return;
  const scopes = [...new Set(list.map(r => r.scope || 'all'))];
  const prev = T4.projFilter, payloads = {};
  scopes.forEach(s => { T4.projFilter = s; payloads[s] = t4SuitePayload({ useViewRange: false }); });   // 每个范围一份数据包
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
  if (st.error) return head('邮件发送套表', '发件配置暂未加载。', '工具箱 · T4', '<button class="btn" data-t4go="sheet">← 返回损益表</button>')
    + `<div class="note c">${H(st.error)}</div>`;
  const cfg = st.status;
  const cfgNote = !cfg ? '<div class="note">正在读取发件配置…</div>'
    : cfg.configured ? `<div class="note g"><b>发件配置已保存，请发送测试邮件验证：</b>${H(cfg.fromName ? cfg.fromName + ' ' : '')}${H(cfg.from)}（${H(cfg.host)}:${H(String(cfg.port))}）</div>`
    : `<div class="note c"><b>发件邮箱尚未配置。</b>在下方选择服务商、填写发件账号和授权码后点「保存配置」，再发一封测试邮件确认。</div>`;
  return head('邮件发送套表', '维护收件人清单，每人指定报表范围（全部 / 澳乐 / 瑞眠 / 橘农）；发送时按范围各生成一份套表工作簿，逐人附上对应的那份。', '工具箱 · T4',
    '<button class="btn" data-t4go="sheet">← 返回损益表</button><button class="btn" data-t4go="contacts">通讯录</button><button class="btn" data-t4act="mailSave">保存通讯录</button><button class="btn pri" data-t4act="mailSend">生成并发送</button>')
    + cfgNote
    + t4SmtpCard(cfg)
    + t4ContactsCard()
    + cardp('邮件内容', `<label class="sel" style="display:block;margin-bottom:8px">主题 <input id="t4MailSubject" value="${H(st.subject || `T4 日损益套表 · ${T4.period}`)}" style="width:440px"></label>`
      + `<label class="sel" style="display:block">附言 <input id="t4MailBody" value="${H(st.body || '')}" placeholder="可选，写在正文开头" style="width:440px"></label>`
      + '<div class="mut" style="margin-top:8px;font-size:11px">邮件附件固定为当前期间的全月套表，不受损益表的起止日期筛选影响。正文附上期间、报表范围和生成时间。</div>')
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
      + `<div style="padding:11px 14px;display:flex;gap:7px;align-items:center;flex-wrap:wrap">${addCtrl}<span style="flex:1"></span><button class="btn sm pri" data-t4act="cfgSave">保存参数</button></div>`, '', `t4-cfg:${c.id}`);
  }).join('');
  return head('T4 参数', '平台扣点按每日销售收入（零售收入加退货、退款及返款的负数金额）计算；运费险等其他费率按每日零售收入计算。月度金额按当月自然日平均分摊；直接/间接管理费用在「工资 / 费用分摊」页维护。', '工具箱 · T4',
    `<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="cfgReset">恢复底稿值</button><button class="btn pri" data-t4act="cfgSave">保存参数</button>`)
    + '<div class="note w"><b>修改会影响所有对应日期的派生结果。</b>人工录入的同名科目优先于参数值。添加规则后填入数值并「保存参数」生效。</div>' + blocks;
};

S['t4-mgmt'] = () => {
  t4Load();
  const days = t4Days();
  let from = T4.mgmtFrom.startsWith(T4.period + '-') ? T4.mgmtFrom : t4Date(1);
  let to = T4.mgmtTo.startsWith(T4.period + '-') ? T4.mgmtTo : t4DefaultRangeEnd();
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
  return head('T4 工资与费用分摊', `按项目录入各渠道当月分摊金额，系统平均分摊到每一天（月度金额 ÷ 当月自然日）。当前区间 ${from} ～ ${to}，共 ${rangeN} 天；「区间合计」= 日摊 × 区间天数。留空表示该渠道该项目不分摊。`, '工具箱 · T4',
    t4PeriodControl(`<label class="sel">起 <input id="t4MgmtFrom" type="date" min="${t4Date(1)}" max="${t4Date(days)}" value="${from}" style="width:132px"></label><label class="sel">止 <input id="t4MgmtTo" type="date" value="${to}" min="${from}" max="${t4Date(days)}" style="width:132px"></label><button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="mgmtTemplate">下载模板</button><button class="btn" data-t4act="payrollPick">导入工资底稿</button><button class="btn" data-t4act="mgmtPick">导入费用分摊表</button><button class="btn pri" data-t4act="mgmtSave" ${t4IsPeriodLocked() ? 'disabled' : ''}>保存分摊</button>`))
    + t4AllocationPreview()
    + '<div class="note">工资底稿按“店铺直接人工 + 企业社保直接”取直接人工，按“公摊人工 + 企业社保间接”取人力公摊；已有同名分摊合计列时直接取合计。导入后先核对预览再写入本月。</div>'
    + card(`月度分摊金额（元/月） · 区间 ${from} ～ ${to}（${rangeN} 天）`, t4PinnedTable(
      [{t:'归属事业部'},{t:'渠道'}, ...T4_MGMT_FIELDS.map(([,n]) => ({t:n,n:1})), {t:'月合计',n:1},{t:'折算每日',n:1},{t:`区间合计（${rangeN} 天）`,n:1}], rows, 2))
    + '<div class="note"><b>口径：</b>直接管理费用 = 直接人工 + 直接租金物业 + 直接其他管理；间接管理费用 = 人力公摊 + 房租水电公摊 + 其他公摊。每日分摊额 = 月度金额 ÷ 当月自然日，分摊数据按月份独立保存；某天人工或文件实填的同名科目优先于分摊值。修改立即影响对应日期的派生结果与汇总。</div>';
};

S['t4-channels'] = () => {
  t4Load();
  const fields = t4ChExtraFields();
  const sourceRows = t4ChSourceRows();
  const displayRows = t4ChDisplaySourceRows();
  const fallbackCount = displayRows.filter(r => r.fallback).length;
  const importedCount = T4_CH.reduce((n, c) => n + (c.details || []).length, 0);
  if (T4.chField !== '__sources' && !fields.includes(T4.chField)) T4.chField = '';
  const tabs = (displayRows.length || fields.length) ? `<div class="tabs t4-channel-tabs" aria-label="渠道列表页面">${['', ...(displayRows.length ? ['__sources'] : []), ...fields].map(name =>
    `<button type="button" class="${T4.chField === name ? 'on' : ''}" data-t4chfield="${H(name)}" aria-pressed="${T4.chField === name}">${H(name === '__sources' ? '销售渠道' : name || '渠道清单')}</button>`).join('')}</div>` : '';
  const actions = c => `<button class="btn sm" data-t4chedit="${H(c.id)}">修改</button> <button class="btn sm" data-t4go="man:${H(c.id)}">录入</button> <button class="btn sm" data-t4go="chday:${H(c.id)}">明细</button>`;
  const rows = T4_CH.map(c => [
    `<span class="mono">${H(c.id)}</span>`, t4BuPill(c.bu), `<b>${H(c.n)}</b>`,
    (c.aliases || []).map(H).join('、') || '<span class="mut">—</span>',
    c.custom ? pill('自定义', 'in') : pill('内置', 'mu'),
    actions(c) + (c.custom ? ` <button class="btn sm" data-t4chdel="${H(c.id)}">移除</button>` : '')]);
  const content = T4.chField === '__sources'
    ? card(`销售渠道明细（已导入 ${importedCount} 条${fallbackCount ? `，${fallbackCount} 个基础渠道未导入` : ''}）`, table([{t:'销售渠道'},{t:'归属事业部'},{t:'渠道汇总'},{t:'编号'},{t:'状态'},{t:'操作'}],
      displayRows.map(r => { const c = T4_CHM[r.channel]; const no = (r.fields || []).find(f => t4ChClean(f.name) === '编号'); return [H(r.source), t4BuPill(c.bu), H(r.target), H(no ? no.value : ''), r.fallback ? pill('未导入基础渠道', 'mu') : pill('已导入', 'ok'), actions(c)]; })))
    : T4.chField
    ? card(T4.chField, table([{t:'销售渠道'},{t:'归属事业部'},{t:'渠道汇总'},{t:T4.chField},{t:'操作'}],
      t4ChFieldRows(T4.chField).map(r => { const c = T4_CHM[r.channel]; return [H(r.source), t4BuPill(c.bu), H(c.n), H(r.value), actions(c)]; })))
    : card(`渠道清单（${T4_CH.length} 个）`, table([{t:'渠道ID'},{t:'归属事业部'},{t:'渠道汇总'},{t:'关联销售渠道'},{t:'来源'},{t:'操作'}], rows));
  const sourceCount = importedCount;
  return head('T4 渠道列表', `当前 ${T4_CH.length} 个归集渠道${sourceCount ? `，已关联 ${sourceCount} 个销售渠道` : ''}。自动识别表头、列顺序和 xlsx 内的渠道工作表；新增渠道自动接入录入、明细与汇总。每个附加字段生成同名页签。`, '工具箱 · T4',
    t4SyncStatus() + '<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4act="chTemplate">下载当前列表</button><button class="btn" data-t4act="chPick">导入渠道列表</button><button class="btn pri" data-t4act="channelNew">新增渠道</button>')
    + (T4_SERVER_ERROR && T4_SERVER_ERROR.status === 401 ? '<div class="note w">点击“登录财务中心”，进入门户登录后点“财务中心”，即可回到当前网址继续保存。</div>' : '')
    + tabs + content
    + '<div class="note"><b>导入规则：</b>至少包含「销售渠道」「渠道名称」或「渠道汇总」之一；支持每行一个渠道，也支持每列一个渠道。销售渠道按「渠道汇总」归集；未填汇总时按渠道名称匹配或新增。已有渠道未填事业部时保留原归属，新渠道未填时归经销并提示。附加字段按销售渠道保存，仅供查看；再次导入只更新文件中提供的渠道和字段，未提供的内容及历史损益保留。事业部支持大电商、拼多多、瑞眠、橘农、经销。</div>';
};

S['t4-rules'] = () => head('T4 取数口径', '以下规则来自用户提供的销售明细、平台推广明细和 2026-08 日损益底稿。', '工具箱 · T4', '<button class="btn" data-t4go="overview">← 返回</button>')
  + card('文件取数', table([{t:'渠道/文件'},{t:'落表规则'},{t:'控制'}], [
    ['汇总导入', '一个文件按渠道 + 日期导入全部渠道；归属事业部由系统配置确定', pill('批量导入','ok')],
    ['全部渠道 · 标准日损益明细', '按日期映射完整损益科目；至少选择一个金额字段', pill('通用导入','ok')],
    ['销售单明细账', '按发货时间；普通/代销售计零售收入与成本，售后退货计负数，售后发货按实际金额计入零售收入和成本', pill('渠道精确匹配','in')],
    ['天猫直通车', '按记账时间；只取支出/扣款，排除充值', pill('符号取绝对值','wa')],
    ['天猫 CPS', '按日期取支出金额', pill('直取','ok')],
    ['京东自营收入', '按日期取成交金额，保留零金额日', pill('直取','ok')],
    ['京准通', '按投放日期取支出，负数转正费用', pill('符号处理','wa')],
  ]))
  + card('底稿设定', table([{t:'渠道'},{t:'项目'},{t:'规则'}], [
    ['京东自营','零售成本','零售收入 × 45%'], ['京东自营','退货金额','零售收入 × -16%'], ['京东自营','退货成本','零售成本 × -16%'],
    ['天猫-澳乐旗舰店','平台/售后/物流/仓储/税费','按收入比例计算，比例见参数页'], ['各渠道','管理费用','月度设定值 ÷ 当月自然日'],
  ]))
  + '<div class="note"><b>重复导入是幂等的：</b>只替换文件内有有效金额的日期和同类来源字段；指定区间仅筛选日期。缺少的日期、空白字段与其他来源保留；要冲销请明确填 0 或先清空。</div>';

// 套表数据包：按当前项目筛选裁剪（全部/澳乐/瑞眠），交给服务端 Python 生成多 Sheet 工作簿
function t4SuitePayload(options = {}) {
  t4Load();
  const range = options.useViewRange ? t4ViewRange() : null;
  const from = range ? range.from : t4Date(1), to = range ? range.to : t4Date(t4Days());
  const dates = t4RangeDates(from, to), days = dates.length, scope = T4.projFilter;
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
    dates.forEach(dt => {
      const g = t4DayData(c.id, dt);
      const o = { has: t4DayHasData(c.id, dt) || t4MgmtDaily(c.id).any };
      T4_METRICS.forEach(({ k }) => { o[k] = R6(g[k]); });
      arr.push(o);
    });
    dailyByCh[c.id] = arr;
    const m = range ? t4RangeData(c.id, from, to) : t4Month(c.id);
    monthByCh[c.id] = Object.fromEntries(T4_METRICS.map(x => [x.k, R(m[x.k])]));
  });
  return { period: T4.period, days, dates, from, to, rangeLabel: `${from} ～ ${to}`, scope, scopeName, generated: new Date().toLocaleString('zh-CN'),
    metrics: T4_METRICS.map(m => ({ k: m.k, n: m.n.trim(), lvl: m.lvl || 0, pct: !!m.pct })),
    inputKeys: T4_INPUT_KEYS.slice(), operatingKeys: t4OperatingKeys(),
    channels: chs.map(c => ({ id: c.id, name: c.n, project: t4Project(c.bu), bu: c.bu, buName: t4BuName(c.bu), filled: t4FilledRange(c.id, from, to) })),
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
  const meta = title => [[{ h: title }], [`日期：${payload.rangeLabel || payload.period}`, `范围：${payload.scopeName}`, `生成：${payload.generated}`], []];

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
    rows.push([{ h: '损益项目' }, { h: '合计' }, ...Array.from({ length: payload.days }, (_, i) => ({ h: (payload.dates || [])[i] || `${i + 1}日` }))]);
    const daily = payload.dailyByCh[ch.id] || [];
    payload.metrics.forEach(m => rows.push([m.n, val((payload.monthByCh[ch.id] || {})[m.k], m.pct),
      ...daily.map((day, i) => (payload.dailyByCh[ch.id] || [])[i]?.has ? val(day[m.k], m.pct) : '')]));
    sheets.push({ name: sheetName(ch.name), rows });
  });
  return XLSXWrite.build(sheets);
}

// 导出整套报表：优先服务端生成带公式/超链接的工作簿；接口不可用时在浏览器生成多 Sheet xlsx。
async function t4ExportSuite() {
  const payload = t4SuitePayload({ useViewRange: true });
  toast('正在生成套表工作簿…');
  try {
    const res = await fetch('/api/t4/suite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200));
    const blob = await res.blob();
    downloadBlob(`T4日损益套表_${payload.scopeName}_${payload.from}_${payload.to}.xlsx`, blob);
    toast(`套表已生成：${payload.scopeName} · ${payload.rangeLabel} · ${payload.channels.length} 个渠道`, 4500);
  } catch (serverError) {
    try {
      const blob = t4SuiteClientWorkbook(payload);
      downloadBlob(`T4日损益套表_${payload.scopeName}_${payload.from}_${payload.to}.xlsx`, blob);
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
  const sumCols = [['salesIncome', '销售收入'], ['rebateAmount', '返款金额'], ['salesCost', '销售成本'], ['grossProfit', '毛利'], ['grossMargin', '毛利率', true], ['operating', '运营费'], ['contribution', '边际毛利'], ['mgmt', '管理费'], ['rebateIncome', '返利收入'], ['netProfit', '净利润'], ['netMargin', '净利率', true]];
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
    if (!Object.values(T4.data[c.id] || {}).some(t4HasInputs) && !t4MgmtDaily(c.id).any) return;
    const daily = [], has = [];
    for (let d = 1; d <= days; d++) { const dt = t4Date(d); daily.push(t4DayData(c.id, dt)); has.push(t4DayHasData(c.id, dt) || t4MgmtDaily(c.id).any); }
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
  for (let d = 1; d <= days; d++) { const dt = t4Date(d); daily.push(t4DayData(c.id, dt)); has.push(t4DayHasData(c.id, dt) || t4MgmtDaily(c.id).any); }
  const m = t4Month(c.id);
  const hdr = ['损益项目', ...Array.from({ length: days }, (_, i) => `${T4.period}-${String(i + 1).padStart(2, '0')}`), '合计'];
  const fmt = (g, metric) => metric.pct ? `${(g[metric.k] * 100).toFixed(2)}%` : (g[metric.k] || 0).toFixed(2);
  const rows = T4_METRICS.map(metric => [metric.n.trim(),
    ...daily.map((g, i) => has[i] ? fmt(g, metric) : ''), fmt(m, metric)]);
  download(`每日损益_${c.n}_${T4.period}.csv`, toCSV([hdr, ...rows])); toast('已导出每日损益明细');
}
function t4ExportSelection() {
  const range = t4ViewRange();
  return { from: range ? range.from : t4Date(1), to: range ? range.to : t4Date(t4Days()),
    scopeName: (T4_PROJ_OPTS.find(([id]) => id === T4.projFilter) || T4_PROJ_OPTS[0])[1], channels: t4ProjCH(), range };
}
function t4RawExportRows() {
  const selection = t4ExportSelection();
  const fields = T4_INPUTS;
  const rows = [['期间', '项目', '归属事业部', '渠道ID', '渠道', '日期', '来源类型', '来源代码', ...fields.map(f => f.n)]];
  const names = { summaryIncome: '收入汇总导入', summaryCost: '成本汇总导入', summaryDaily: '收支汇总导入', daily: '日损益明细导入', sales: '销售单明细账导入', jdIncome: '京东收入导入', ztc: '直通车导入', cps: 'CPS导入', jzt: '京准通导入' };
  const append = (c, dt, source, label, values) => {
    if (!fields.some(f => values[f.k] != null && values[f.k] !== '')) return;
    rows.push([T4.period, t4Project(c.bu), t4BuName(c.bu), c.id, c.n, dt, label, source,
      ...fields.map(f => values[f.k] == null || values[f.k] === '' ? '' : values[f.k])]);
  };
  selection.channels.forEach(c => {
    Object.keys(T4.data[c.id] || {}).sort().forEach(dt => {
      if (dt < selection.from || dt > selection.to) return;
      const raw = T4.data[c.id][dt];
      if (!raw || typeof raw !== 'object') return;
      const sources = Object.fromEntries(Object.entries(raw._fileParts || {}).map(([source, values]) => [source, { ...values }]));
      const manual = {}, legacy = {};
      fields.forEach(({ k }) => {
        if (raw[k] == null || raw[k] === '') return;
        const source = raw._srcs && raw._srcs[k];
        // 旧结构有逐字段来源时使用真实来源；已迁移的同名值不重复导出。
        if (source) {
          const values = sources[source] ||= {};
          if (values[k] == null) values[k] = raw[k];
        } else if (raw._src === 'file' && !raw._fileParts && !raw._manualFields?.[k]) legacy[k] = raw[k];
        else manual[k] = raw[k];
      });
      Object.entries(sources).forEach(([source, values]) => append(c, dt, source, names[source] || '文件导入', values));
      append(c, dt, 'legacy-file', '文件导入（旧记录，来源未细分）', legacy);
      append(c, dt, 'manual', '人工录入 / 覆盖', manual);
    });
  });
  return { selection, rows };
}
function t4RawExport() {
  const { selection, rows } = t4RawExportRows();
  if (rows.length === 1) { toast('当前项目和日期范围没有已保存的录入或导入数据'); return; }
  const title = `T4录入导入数据_${selection.scopeName}_${selection.from}_${selection.to}.xlsx`;
  const info = [['T4 录入与导入数据（按日归集）'], ['项目', selection.scopeName, '开始日期', selection.from, '结束日期', selection.to],
    ['说明', '每行是一渠道、一天、一个来源的原始输入。包含人工覆盖与导入日汇总；空白与明确的 0 分开保留。'],
    ['来源说明', '文件来源可能被人工输入或其他来源覆盖，各来源行不可直接相加当作最终损益。'],
    ['数据范围', '系统未保留上传原文件的逐笔明细，本表不能还原原文件。参数推算、月度分摊等派生值请查看损益表。'], []];
  try {
    downloadBlob(title, XLSXWrite.build([{ name: '按日归集输入', rows: [...info, ...rows] }]));
    toast(`已导出 ${rows.length - 1} 条按日归集输入，含各来源及人工覆盖`);
  } catch (e) { toast(`导出失败：${e.message || e}`, 5200); }
}
function t4Export() {
  const selection = t4ExportSelection(), { from, to, channels, range, scopeName } = selection;
  const idsInView = new Set(channels.map(c => c.id));
  const hdr = ['期间','渠道','归属事业部','日期', ...T4_METRICS.map(x => x.n.trim()), '取数口径','来源'];
  const rows = [];
  channels.forEach(c => {
    const md = t4MgmtDaily(c.id);
    t4RangeDates(from, to).forEach(dt => {
      const raw = t4Row(c.id, dt);
      if (!raw && !md.any) return;
      const r = raw || t4DayData(c.id, dt);
      rows.push([T4.period,c.n,t4BuName(c.bu),dt, ...T4_METRICS.map(x => x.pct ? `${(r[x.k]*100).toFixed(2)}%` : (r[x.k] || 0).toFixed(2)),
        raw ? (r._hard.length ? `参数/硬推:${r._hard.join('/')}` : '实填') : '管理费分摊（无收入数据日）',
        raw ? t4SourceLabel(t4Raw(c.id, dt)) : '分摊']);
    });
  });
  rows.push([]);
  [
    ['特卖汇总','大电商事业部',T4_TMAI], ['大电商事业部汇总','大电商事业部',T4_BIG_ECOM],
    ['拼多多事业部汇总','拼多多事业部',T4_PDD], ['瑞眠事业部汇总','瑞眠事业部',T4_RUIMIAN],
    ['橘农事业部汇总','橘农事业部',T4_ORANGE], ['经销事业部汇总','经销事业部',T4_DEALER],
    [T4.projFilter === 'all' ? '全部汇总' : `${scopeName}汇总`,scopeName,[...idsInView]],
  ].forEach(([n,bu,group]) => {
    const ids = group.filter(id => idsInView.has(id)); if (!ids.length) return;
    const ok = range ? t4RangeOK(ids, from, to) : t4SumOK(ids);
    const m = range ? t4GroupRange(ids, from, to) : t4Group(ids);
    const counts = ids.map(id => t4FilledRange(id, from, to)), gap = Math.max(...counts) - Math.min(...counts);
    rows.push([T4.period,n,bu,`${from} ～ ${to}`,
      ...T4_METRICS.map(x => x.pct ? `${(m[x.k]*100).toFixed(2)}%` : (m[x.k] || 0).toFixed(2)),
      ok ? '按当前范围汇总' : `按已保存数据汇总；渠道收入取数天数极差 ${gap} 天`, '汇总']);
  });
  download(`渠道事业部日损益表_${scopeName}_${from}_${to}.csv`, toCSV([hdr, ...rows])); toast('已按当前项目和日期导出日损益明细');
}

function t4Go(v, options) { go(v === 'overview' ? 't4' : `t4-${v}`, options); }

document.addEventListener('click', async e => {
  const review = e.target.closest('[data-t4review]');
  if (review) {
    if (t4EntryDirty() && !confirm('本页有未保存的输入。离开后将放弃这些输入，继续核对？')) return;
    const [ch, dt] = review.dataset.t4review.split(':');
    if (!T4_CHM[ch] || !t4ValidDate(dt)) return;
    T4.editCh = ch; T4.manFrom = dt; T4.manTo = dt;
    t4Go('man', { resetScroll: true }); return;
  }
  const write = e.target.closest('[data-t4act], [data-t4cfgadd], [data-t4cfgdel]');
  const writeActions = ['saveMan','sumManSave','impRun','sumImpRun','cfgSave','cfgReset','mgmtSave','allocationApply','clearSelected'];
  if (write && (writeActions.includes(write.dataset.t4act) || write.dataset.t4cfgadd || write.dataset.t4cfgdel)) {
    try { t4AssertEditable(); } catch (err) { toast(err.message, 4200); return; }
  }
  const nav = e.target.closest('[data-t4go]');
  if (nav) {
    const [v,ch] = nav.dataset.t4go.split(':');
    if (document.getElementById('t4ContactSearch')) t4MailReadForm();
    if (ch && (v === 'sumimp' || v === 'summan')) T4.sumScope = ch;
    else if (ch && v === 'chday') T4.dayCh = ch;
    else if (ch) T4.editCh = ch;
    if (v === 'imp' || v === 'sumimp') T4.imp = null; t4Go(v, { resetScroll: true }); return;
  }
  const field = e.target.closest('[data-t4chfield]');
  if (field) { T4.chField = field.dataset.t4chfield; t4Go('channels', { resetScroll: true }); return; }
  const file = e.target.closest('[data-t4file]'); if (file) { t4PickFile(file.dataset.t4file); return; }
  const channelEdit = e.target.closest('[data-t4chedit]');
  if (channelEdit) {
    const c = T4_CHM[channelEdit.dataset.t4chedit]; if (!c) return;
    T4.channelDraft = { id: c.id, n: c.n, bu: c.bu, aliases: '' }; T4.catalogError = '';
    t4Go('channel-edit', { resetScroll: true }); return;
  }
  const expenseEdit = e.target.closest('[data-t4expenseedit]');
  if (expenseEdit) {
    const item = T4.expenseItems.find(x => x.k === expenseEdit.dataset.t4expenseedit); if (!item) return;
    t4RememberExpenseInputs();
    T4.expenseDraft = { ...item }; T4.catalogError = ''; t4Go('expenses'); return;
  }
  const mdel = e.target.closest('[data-t4maildel]');
  if (mdel) { if (T4.mail.saving) return; t4MailReadForm(); T4.mail.list.splice(+mdel.dataset.t4maildel, 1); T4.mail.dirty = true; t4Go(t4ContactView()); return; }
  const tree = e.target.closest('[data-t4tree]');
  if (tree) { const id = tree.dataset.t4tree; T4.treeCollapsed[id] = !T4.treeCollapsed[id]; t4Go('sheet'); return; }
  const chdel = e.target.closest('[data-t4chdel]');
  if (chdel) {
    try { t4RequireServerReady(); } catch (err) { toast(err.message, 5200); return; }
    try { await t4SaveCatalog('channels', t4ChOverrides().filter(x => x.id !== chdel.dataset.t4chdel)); toast('已移除自定义渠道（历史数据保留）'); t4Go('channels'); }
    catch (err) { toast(`渠道未同步：${err.message}`, 5200); }
    return;
  }
  const cfgadd = e.target.closest('[data-t4cfgadd]');
  if (cfgadd) {
    const ch = cfgadd.dataset.t4cfgadd, sel = document.querySelector(`.t4addsel[data-ch="${ch}"]`), key = sel && sel.value;
    if (!key) { toast('请先选择要添加的费用规则'); return; }
    t4CfgReadInputs(); (T4.cfg[ch] = T4.cfg[ch] || {})[key] = 0;
    try {
      await t4SaveCfg();
      const meta = T4_CFG_FIELDS.find(x => x[0] === key);
      toast(`已为「${T4_CHM[ch].n}」添加「${meta[1]}」，请填入数值后保存`); t4Go('cfg');
    } catch (err) { toast(`共享保存失败：${err.message || err}`, 5200); }
    return;
  }
  const cfgdel = e.target.closest('[data-t4cfgdel]');
  if (cfgdel) {
    const [ch, key] = cfgdel.dataset.t4cfgdel.split(':');
    // An explicit null masks the built-in default when the merged document
    // is loaded again; deleting the key would immediately restore that rule.
    t4CfgReadInputs(); if (T4.cfg[ch]) T4.cfg[ch][key] = null;
    try { await t4SaveCfg(); toast('已删除该费用规则'); t4Go('cfg'); }
    catch (err) { toast(`共享保存失败：${err.message || err}`, 5200); }
    return;
  }
  const a = e.target.closest('[data-t4act]'); if (!a) return;
  if (a.dataset.t4act === 'channelNew') {
    T4.channelDraft = { n: '', bu: 'dealer', aliases: '' }; T4.catalogError = ''; t4Go('channel-edit', { resetScroll: true });
  }
  else if (a.dataset.t4act === 'channelSave') {
    const g = id => document.getElementById(id).value;
    T4.channelDraft = { ...T4.channelDraft, n: g('t4ChannelName'), bu: g('t4ChannelBu'), aliases: g('t4ChannelAliases') };
    try { await t4SaveChannel(T4.channelDraft); T4.channelDraft = null; T4.catalogError = ''; toast('渠道已保存到服务器'); t4Go('channels'); }
    catch (err) { T4.catalogError = `未保存：${err.message}`; t4Go('channel-edit'); }
  }
  else if (a.dataset.t4act === 'expenseItemNew') { t4RememberExpenseInputs(); T4.expenseDraft = { n: '' }; T4.catalogError = ''; t4Go('expenses'); }
  else if (a.dataset.t4act === 'expenseItemCancel') { t4RememberExpenseInputs(); T4.expenseDraft = null; T4.catalogError = ''; t4Go('expenses'); }
  else if (a.dataset.t4act === 'expenseItemSave') {
    t4RememberExpenseInputs();
    T4.expenseDraft = { ...T4.expenseDraft, n: document.getElementById('t4ExpenseName').value };
    try { await t4SaveExpenseItem(T4.expenseDraft); T4.expenseDraft = null; T4.catalogError = ''; toast('费用科目已保存到服务器'); t4Go('expenses'); }
    catch (err) { T4.catalogError = `未保存：${err.message}`; t4Go('expenses'); }
  }
  else if (a.dataset.t4act === 'expenseSave') {
    const entries = [...document.querySelectorAll('[data-t4expense]')].map(el => ({ k: el.dataset.t4expense, value: el.value, original: el.dataset.t4orig }));
    try { const count = await t4SaveDailyExpenses(T4.expenseCh, T4.expenseDate, entries); delete T4.expenseEdits[`${T4.expenseCh}:${T4.expenseDate}`]; T4.catalogError = ''; toast(count ? `已保存 ${count} 项当日费用` : '没有需要保存的修改'); t4Go('expenses'); }
    catch (err) { toast(`费用未保存，原数据已保留：${err.message}`, 6000); }
  }
  else if (a.dataset.t4act === 'retrySync') { T4_SERVER_LAST_KEY = ''; await t4LoadServer(); }
  else if (a.dataset.t4act === 'migrateDraft') {
    try {
      t4AssertEditable();
      if (!T4_PENDING_DRAFT || T4_PENDING_DRAFT.period !== T4.period) return;
      T4.data = t4Clone(T4_PENDING_DRAFT.data); T4.cfg = t4Clone(T4_PENDING_DRAFT.cfg);
      await t4SaveCfg(); await t4Save(); T4_PENDING_DRAFT = null; localStorage.setItem(T4_PENDING_DRAFT_KEY, 'null');
      toast('本机草稿已导入共享工作区'); t4Go('overview');
    } catch (err) { toast(`草稿未同步：${err.message}`, 5200); }
  }
  else if (a.dataset.t4act === 'togglePeriodLock') {
    const locked = t4IsPeriodLocked();
    if (locked && !confirm(`解锁 ${T4.period} 后可修改、导入及清空该月份。确认解锁？`)) return;
    try { await t4SetPeriodLock(!locked); toast(locked ? '本月已解锁，处理完成后可重新锁定' : '本月已锁定，数据受保护'); t4Go('overview'); }
    catch (err) { toast(`锁定状态保存失败：${err.message}`, 5200); }
  } else if (a.dataset.t4act === 'saveMan' || a.dataset.t4act === 'sumManSave') {
    const errorBox = document.getElementById('t4EntryError');
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    try { const changed = await t4SaveEntries(a.dataset.t4act === 'sumManSave'); toast(`已保存 ${changed} 个变更`); t4Go('overview'); }
    catch (err) {
      if (errorBox) { errorBox.textContent = `未保存：${err.message} 本页输入已保留。`; errorBox.hidden = false; }
      toast(`保存失败，原数据已恢复：${err.message}；本页输入可继续核对`, 6000);
    }
  } else if (a.dataset.t4act === 'impCancel') { T4.imp = null; t4Go('imp'); }
  else if (a.dataset.t4act === 'impRun') t4ImpRun();
  else if (a.dataset.t4act === 'sumPick') t4PickSummaryFile();
  else if (a.dataset.t4act === 'sumTemplate') t4SummaryTemplate();
  else if (a.dataset.t4act === 'sumImpCancel') { T4.imp = null; t4Go('sumimp'); }
  else if (a.dataset.t4act === 'sumImpRun') t4SummaryImpRun();
  else if (a.dataset.t4act === 'export') t4Export();
  else if (a.dataset.t4act === 'rawExport') t4RawExport();
  else if (a.dataset.t4act === 'exportSuite') t4ExportSuite();
  else if (a.dataset.t4act === 'dayExport') t4DayExport();
  else if (a.dataset.t4act === 'mailAdd') {
    if (T4.mail.loading || T4.mail.saving || !T4.mail.loaded) return;
    t4MailReadForm();
    const draft = T4.mail.newContact || {};
    const contact = { name: draft.name || '', email: draft.email || '', scope: draft.scope || 'all', enabled: true };
    try { T4.mail.list = t4ValidateContacts([...T4.mail.list, contact]); }
    catch (err) { T4.mail.saveError = err.message; toast(err.message, 5200); t4Go(t4ContactView()); return; }
    T4.mail.dirty = true; T4.mail.newContact = {}; T4.mail.search = ''; T4.mail.saveError = ''; t4Go(t4ContactView());
  }
  else if (a.dataset.t4act === 'mailSave') await t4SaveContacts();
  else if (a.dataset.t4act === 'mailReload') { T4.mail.loaded = false; t4MailLoad(); }
  else if (a.dataset.t4act === 'mailSend') t4MailSend();
  else if (a.dataset.t4act === 'smtpSave') t4SmtpSave();
  else if (a.dataset.t4act === 'smtpTest') t4SmtpTest();
  else if (a.dataset.t4act === 'cfgSave') {
    t4CfgReadInputs();
    try { await t4SaveCfg(); toast('✓ 参数已保存，损益表已按新规则重算', 3500); t4Go('cfg'); }
    catch (err) { toast(`共享保存失败：${err.message || err}`, 5200); }
  } else if (a.dataset.t4act === 'cfgReset') {
    // 只重置比例类底稿参数；管理费分摊是用户数据，原样保留
    const keep = {};
    T4_CH.forEach(c => { const cur = T4.cfg[c.id] || {}; keep[c.id] = {}; T4_MGMT_FIELDS.forEach(([k]) => { if (cur[k] != null) keep[c.id][k] = cur[k]; }); });
    T4.cfg = t4Clone(T4_CFG_DEFAULT);
    T4_CH.forEach(c => { T4.cfg[c.id] = Object.assign(T4.cfg[c.id] || {}, keep[c.id]); });
    try { await t4SaveCfg(); toast('已恢复底稿参数（管理费分摊保留）'); t4Go('cfg'); }
    catch (err) { toast(`共享保存失败：${err.message || err}`, 5200); }
  }
  else if (a.dataset.t4act === 'mgmtSave') {
    let changed = 0;
    document.querySelectorAll('[data-t4mgmt]').forEach(inp => {
      const [ch,k] = inp.dataset.t4mgmt.split(':'), val = inp.value.trim();
      if (val === String(inp.dataset.t4orig == null ? '' : inp.dataset.t4orig)) return;
      if (val === '') delete T4.cfg[ch][k]; else T4.cfg[ch][k] = Number(val) || 0;
      changed++;
    });
    try { await t4SaveCfg(); toast(`已保存管理费分摊，共 ${changed} 个变更`); t4Go('overview'); }
    catch (err) { toast(`共享保存失败：${err.message || err}`, 5200); }
  }
  else if (a.dataset.t4act === 'mgmtTemplate') t4MgmtTemplate();
  else if (a.dataset.t4act === 'mgmtPick') t4MgmtPickFile('expense');
  else if (a.dataset.t4act === 'payrollPick') t4MgmtPickFile('payroll');
  else if (a.dataset.t4act === 'allocationCancel') { T4.allocImport = null; t4Go('mgmt'); }
  else if (a.dataset.t4act === 'allocationApply') await t4ApplyAllocationImport();
  else if (a.dataset.t4act === 'chTemplate') t4ChTemplate();
  else if (a.dataset.t4act === 'chPick') t4ChPickFile();
  else if (a.dataset.t4act === 'sheetMode') { T4.sheetMode = T4.sheetMode === 'tree' ? 'matrix' : 'tree'; t4Go('sheet'); }
  else if (a.dataset.t4act === 'wipePeriod') {
    t4Go('clear');
  }
  else if (a.dataset.t4act === 'clearSelected') {
    const project = document.getElementById('t4ClearProject').value, scope = document.getElementById('t4ClearScope').value;
    const projectName = T4_PROJ_OPTS.find(([id]) => id === project)[1];
    const scopeName = { income: '销售收入', cost: '销售成本', expenses: '运营费用', all: '全部录入与导入数据' }[scope];
    const from = document.getElementById('t4ClearFrom').value, to = document.getElementById('t4ClearTo').value;
    try { t4ValidateRange(from, to); } catch (err) { toast(err.message); return; }
    const typed = prompt(`将清空 ${projectName} 在 ${from} ～ ${to} 的${scopeName}。此操作不可恢复。\n请输入期间「${T4.period}」确认：`);
    if (typed == null) { toast('已取消清空'); return; }
    if (String(typed).trim() !== T4.period) { toast(`输入「${String(typed).trim()}」与当前期间不一致，已取消清空`, 4200); return; }
    try { await t4ClearPeriodData(project, scope, from, to); toast(`已清空 ${from} ～ ${to} · ${projectName} · ${scopeName}`); t4Go('overview'); }
    catch (err) { toast(`清空失败，原数据已保留：${err.message}`, 5200); }
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 't4ExpenseCh' || e.target.id === 't4ExpenseDate') {
    t4RememberExpenseInputs();
    if (e.target.id === 't4ExpenseCh') T4.expenseCh = e.target.value;
    else T4.expenseDate = e.target.value;
    T4.catalogError = ''; t4Go('expenses');
  }
  else if (e.target.id === 't4Period') {
    if (T4_SERVER_LOADING || T4_SERVER_SAVING) { e.target.value = T4.period; toast('正在同步，请稍后切换月份'); return; }
    const picked = e.target.value || T4.period;
    if (!t4ValidPeriod(picked)) { e.target.value = T4.period; toast('期间需在 2000-01 至 2099-12 之间，请重新选择月份', 4200); return; }
    T4.period = picked; T4.sumDate = ''; T4.sumTo = ''; T4.manFrom = ''; T4.manTo = ''; T4.imp = null; T4.allocImport = null; T4.viewFrom = ''; T4.viewTo = ''; T4.mgmtFrom = ''; T4.mgmtTo = ''; t4Go('overview');
  }
  else if (['t4ImportRangeMode', 't4ImportFrom', 't4ImportTo'].includes(e.target.id) && T4.imp) {
    if (T4_SERVER_LOADING || T4_SERVER_SAVING) return;
    const imp = T4.imp;
    if (e.target.id === 't4ImportRangeMode') {
      imp.rangeMode = e.target.value;
      imp.from ||= t4Date(1); imp.to ||= t4Date(t4Days());
    } else imp[e.target.id === 't4ImportFrom' ? 'from' : 'to'] = e.target.value;
    t4Go(imp.mode === 'summary' ? 'sumimp' : 'imp');
  }
  else if (['t4SumFrom', 't4SumTo', 't4ManFrom', 't4ManTo'].includes(e.target.id)) {
    const summary = e.target.id.startsWith('t4Sum'), from = e.target.id.endsWith('From');
    const dates = t4EntryRange(summary), restore = () => { e.target.value = from ? dates[0] : dates[dates.length - 1]; };
    if (T4_SERVER_LOADING || T4_SERVER_SAVING || t4EntryDirty()) { restore(); toast('请先保存本页变更并等待同步完成，再切换日期'); return; }
    const start = from ? e.target.value : dates[0], end = from ? (e.target.value > dates[dates.length - 1] ? e.target.value : dates[dates.length - 1]) : e.target.value;
    try { t4ValidateRange(start, end); } catch (err) { restore(); toast(err.message); return; }
    if (summary) { T4.sumDate = start; T4.sumTo = end; } else { T4.manFrom = start; T4.manTo = end; }
    t4Go(summary ? 'summan' : 'man');
  }
  else if (e.target.dataset && e.target.dataset.t4rowchannel) {
    if (T4.imp) { T4.imp.channelOverrides ||= {}; T4.imp.channelOverrides[e.target.dataset.t4rowchannel] = e.target.value; }
  }
  else if (e.target.id === 't4AllocationSheet' && T4.allocImport) {
    T4.allocImport.sheet = +e.target.value; t4AnalyzeAllocation(); t4Go('mgmt');
  }
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
    if (T4_SERVER_LOADING || T4_SERVER_SAVING || (e.target.value && !e.target.value.startsWith(T4.period + '-'))) {
      e.target.value = e.target.id === 't4MgmtFrom' ? (T4.mgmtFrom || t4Date(1)) : (T4.mgmtTo || t4DefaultRangeEnd());
      toast('请在同步完成后选择本月内的日期；切换月份请用期间选择框'); return;
    }
    if (e.target.id === 't4MgmtFrom') T4.mgmtFrom = e.target.value || ''; else T4.mgmtTo = e.target.value || '';
    if (T4.mgmtFrom && T4.mgmtTo && T4.mgmtTo < T4.mgmtFrom) T4.mgmtTo = T4.mgmtFrom;
    t4Go('mgmt');
  }
  else if (e.target.id === 't4chSel') { T4.editCh = e.target.value; t4Go('man'); }
  else if (e.target.id === 't4SumDate') { T4.sumDate = e.target.value || t4Date(1); t4Go('summan'); }
  else if (e.target.id === 't4head' && T4.imp) { T4.imp.headRow = +e.target.value; T4.imp.map = t4AutoMap(T4.imp.rows[T4.imp.headRow] || [], T4_FILE_DEFS[T4.imp.fileK]); t4Go(T4.imp.mode === 'summary' ? 'sumimp' : 'imp'); }
  else if (e.target.dataset && e.target.dataset.t4map && T4.imp) { const k = e.target.dataset.t4map; if (e.target.value === '') delete T4.imp.map[k]; else T4.imp.map[k] = +e.target.value; t4Go(T4.imp.mode === 'summary' ? 'sumimp' : 'imp'); }
});

// 搜索前收回当前可见编辑，切换结果时保留其他联系人及新增草稿。
document.addEventListener('input', e => {
  if (e.target.id !== 't4ContactSearch') return;
  t4MailReadForm(); T4.mail.search = e.target.value; t4Go(t4ContactView());
});
