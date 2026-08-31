/* 财务中心 · 星逸平台
   一期：系统结构 + 工具箱（已上线哪些工具，以 TOOLS 里的 ready 标记为唯一口径）
   全部逻辑在浏览器端运行，数据不出本机 */
'use strict';

/* ============ 工具函数 ============ */
const $ = id => document.getElementById(id);
const H = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
const pill = (t, k) => `<span class="pill p-${k}">${H(t)}</span>`;

function toast(msg, ms) {
  const el = $('toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), ms || 2600);
}
function kpis(arr) {
  return `<div class="kpis">${arr.map(k => `<div class="kpi ${k.t || ''}">
    <div class="k">${H(k.k)}</div><div class="v">${k.v}${k.u ? `<small>${H(k.u)}</small>` : ''}</div>
    ${k.d ? `<div class="d">${H(k.d)}</div>` : ''}</div>`).join('')}</div>`;
}
function table(cols, rows, foot) {
  return `<div class="tw"><table><thead><tr>${cols.map(c => `<th class="${c.n ? 'num' : ''}">${H(c.t)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => {
    const cells = Array.isArray(r) ? r : r.d;
    const cls = Array.isArray(r) ? '' : (r.cls || '');
    return `<tr class="${cls}">${cells.map((c, i) => `<td class="${cols[i] && cols[i].n ? 'num' : ''}">${c}</td>`).join('')}</tr>`;
  }).join('')}</tbody>
  ${foot ? `<tfoot><tr>${foot.map((c, i) => `<td class="${cols[i] && cols[i].n ? 'num' : ''}">${c}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
}
const card = (t, b, tools) => `<div class="card"><div class="ch"><h3>${H(t)}</h3><span class="sp"></span>${tools || ''}</div><div class="cb flush">${b}</div></div>`;
const cardp = (t, b, tools) => `<div class="card"><div class="ch"><h3>${H(t)}</h3><span class="sp"></span>${tools || ''}</div><div class="cb">${b}</div></div>`;
const head = (t, sub, code, tools) => `<div class="phead"><div><h2>${H(t)}</h2><div class="sub2">${sub}</div></div>
  <div class="mid">${code ? `<span class="mcode">${H(code)}</span>` : ''}${tools || ''}</div></div>`;

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function download(filename, content) {
  downloadBlob(filename, new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }));
}
const csvCell = v => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');

/* ============ 系统结构（一期只开工具箱） ============ */
const DOMS = [
  { id: 'home', n: '工作台', ic: '◆', ready: 1, items: [] },
  { id: 'tools', n: '工具箱', ic: '🧰', ready: 1, items: [
      ['tool-list', '我的工具'], ['t1', 'T1 资金日报'], ['t2', 'T2 流水转凭证'], ['t3', 'T3 对账核对'], ['t4', 'T4 日损益'],
      ['tool-rules', '规则库'], ['tool-log', '处理记录'], ['tool-plan', '开发排期'] ] },
  { id: 'fund', n: '资金', ic: '◈', ready: 1, items: [['fd-banks', '网银入口'], ['p-fund-daily', '资金日报'], ['p-fund-account', '账户与U盾'], ['p-fund-recon', '流水与对账'], ['p-pay', '付款申请']] },
  { id: 'inv', n: '纳税申报', ic: '▼', ready: 1, items: [
      ['iv-in', '进项票'], ['iv-out', '销项票'], ['iv-noinv', '无票收入'],
      ['--纳税申报'],
      ['iv-vat', '增值税申报'], ['iv-cit', '所得税申报'], ['iv-stamp', '印花税申报'], ['iv-cult', '文化事业建设费'],
      ['iv-iit', '个税申报'], ['iv-pay', '员工与工资表'], ['iv-dbf', '残保金申报'], ['iv-portal', '电子税务局'] ] },
  { id: 'ar', n: '应收', ic: '◫', items: [['p-ar-contract', '合同台账'], ['p-ar-bill', '应收账单'], ['p-ar-claim', '收款认领'], ['p-ar-aging', '账龄与催收']] },
  { id: 'cost', n: '费控', ic: '▧', items: [['p-exp', '报销与费控'], ['p-flow', '审批路由']] },
  { id: 'close', n: '核算', ic: '▩', ready: 1, items: [
      ['ac-vch', '凭证库'], ['ac-new', '录凭证'],
      ['--账簿'],
      ['ac-open', '期初余额'],
      ['ac-bal', '科目余额表'], ['ac-detail', '明细账'], ['ac-gl', '总分类账'],
      ['--固定资产'],
      ['p-fa', '资产卡片'], ['p-fadep', '折旧计提'],
      ['--其他'],
      ['p-stock', '进销存台账'], ['p-count', '月末盘点'], ['p-close', '月结检查单'],
      ['p-tax-cal', '申报日历'] ] },
  { id: 'report', n: '报表', ic: '▤', ready: 1, items: [
      ['rp-home', '报表首页'], ['rp-bs', '资产负债表'], ['rp-pl', '利润表'],
      ['rp-cf', '现金流量表'], ['rp-exp', '费用明细表'],
      ['--合并报表'],
      ['cs-set', '合并设置'], ['cs-reg', '内部交易登记'], ['cs-elim', '抵消分录'],
      ['cs-bs', '合并资产负债表'], ['cs-pl', '合并利润表'], ['cs-cf', '合并现金流量表'] ] },
  { id: 'analysis', n: '分析', ic: '◧', ready: 1, items: [['p-dash', '经营看板'], ['p-daily', '日损益'], ['p-project', '项目盈利']] },
  { id: 'base', n: '基础', ic: '⚙', ready: 1, items: [
      ['bs-acct', '科目设置'],
      ['--辅助核算'],
      ['bs-cust', '客户维护'], ['bs-supp', '供应商维护'], ['bs-proj', '项目维护'],
      ['bs-dept', '部门维护'], ['bs-staff', '职员维护'],
      ['--主数据'],
      ['bs-imp', '主数据导入'],
      ['--其他'],
      ['p-entity', '主体档案'], ['p-match', '跨系统对码'], ['p-perm', '用户与权限'] ] },
];

/* ============ 主数据 ============ */
/* 主体：规则库按主体隔离。不同主体业务完全不同，共用一套规则必然记错账。 */
/* 法人主体 —— 与 T1 账户台账同源（《银行资料信息/银行.xlsx》）。
   用法人全称做匹配键：T2 的账户下拉靠它去 T1 取账户，两边必须字字相同。
   优栖的 id 保持 'youqi'，否则它的规则库会丢。 */
const ENTITIES = [
  { id: 'e01', full: '广州乐时婴童用品有限公司', line: '' },
  { id: 'e02', full: '广州星逸文化有限公司', line: '' },
  { id: 'e03', full: '广州澳乐电子商务科技有限公司', line: '' },
  { id: 'e04', full: '广州市橘农农业发展有限公司', line: '' },
  { id: 'e05', full: '深圳萌立方文化有限公司', line: '' },
  { id: 'e06', full: '广州贝堡儿童用品有限公司', line: '' },
  { id: 'e07', full: '广州澳乐游玩母婴用品有限公司', line: '' },
  { id: 'e08', full: '广州达观文化有限公司', line: '' },
  { id: 'e09', full: '广州市星逸贸易有限公司', line: '' },
  { id: 'e10', full: '广州堂品玩具有限公司', line: '' },
  { id: 'e11', full: '广州奇妙口袋供应链有限公司', line: '' },
  { id: 'e12', full: '广州有方新媒体科技有限公司', line: '' },
  { id: 'e13', full: '广州昭妍贸易有限公司', line: '' },
  { id: 'e14', full: '广州源美生物科技有限公司', line: '' },
  { id: 'e15', full: '广州锐度生物科技有限公司', line: '' },
  { id: 'e16', full: '广州艺晟生物科技有限公司', line: '' },
  { id: 'e17', full: '广州荣耀商贸有限公司', line: '' },
  { id: 'e18', full: '广州不易文化传播有限公司', line: '' },
  { id: 'e19', full: '广州德逸技术有限责任公司', line: '' },
  { id: 'e20', full: '广州泰昌百川管理咨询有限责任公司', line: '' },
  { id: 'e21', full: '广州万视智能科技有限责任公司', line: '' },
  { id: 'e22', full: '广州贝蜜电子商务有限公司', line: '' },
  { id: 'e23', full: '广州数智云仓产业园运营有限公司', line: '' },
  { id: 'e24', full: '广州云泰运营管理有限公司', line: '' },
  { id: 'e25', full: 'AOLE. Limited', line: '' },
  { id: 'youqi', full: '优栖（广州）服务管理有限公司', line: '出租屋' },
  { id: 'e27', full: '海南钧恒投资有限公司', line: '' },
  { id: 'e28', full: '海南弈晟企业管理有限公司', line: '' },
  { id: 'e29', full: '广州智租贸易有限公司', line: '' },
  { id: 'e30', full: '广州优机库贸易有限公司', line: '' },
  { id: 'e31', full: '广州瑞眠科技有限公司', line: '' },
  { id: 'e32', full: '广州云迪物业管理服务合伙企业（有限合伙）', line: '' },
  { id: 'e33', full: '广州云湃供应链服务合伙企业（有限合伙）', line: '' },
  { id: 'e34', full: '广州云帕供应链管理有限公司', line: '' },
  { id: 'e35', full: '广州云基电子商务合伙企业（有限合伙）', line: '' },
  { id: 'e36', full: '广州闪租数码贸易有限公司', line: '' },
  { id: 'e37', full: '中山市木同日用品有限公司', line: '' },
];

/** 从法人全称提取简称：去地区前缀、去括号、去常见后缀 */
function entShort(e) {
  if (e.short) return e.short;
  let s = String(e.full || '');
  s = s.replace(/^(广州市|广州|深圳市|深圳|海南|中山市|东莞市)/, '');
  s = s.replace(/（[^）]*）|\([^)]*\)/g, '');
  s = s.replace(/(有限合伙|合伙企业|有限责任公司|有限公司|Limited|Ltd\.?)$/i, '');
  s = s.replace(/(电子商务科技|电子商务|供应链服务|供应链管理|物业管理服务|服务管理|管理咨询|新媒体科技|生物科技|文化传播|智能科技|婴童用品|儿童用品|母婴用品|日用品|数码贸易|农业发展|产业园运营|运营管理|技术|贸易|文化|玩具|商贸|投资|企业管理)$/, '');
  return s.trim() || e.full;
}
const LINES = ['电商', '集包', '物业收租', '手机租赁', '出租屋', '设备租赁', '塑料制造'];

/* ============ 规则集（按主体） ============ */
/* 优栖 —— 取自 2026年第8期真实凭证。二房东模式：
   从业主手里租房付租金（成本），转租给租客收租金（收入）。
   科目带项目后缀：{p} → 1001 花都UU公寓 / 2001 冼村复建房六期 */
const RS_YOUQI = {
  projects: [
    { code: '2001', name: '冼村复建房六期', kw: '冼村|洗村|复建房' },
    { code: '1001', name: '花都UU公寓', kw: '花都|UU公寓' },
  ],
  accounts: [
    ['100201', '银行存款_张华工行7239'],
    ['100202', '银行存款_张华工行9999'],
    ['100203', '银行存款_优栖工行6418'],
    ['1122_{p}', '应收账款'],
    ['122104', '其他应收款_社保个人部分'],
    ['221101', '应付职工薪酬_工资'],
    ['222112', '应交税费_应交个人所得税'],
    ['22210107', '应交税费_应交增值税_销项税额'],
    ['224101_{p}', '其他应付款_押金'],
    ['5001_{p}', '主营业务收入'],
    ['5402_{p}', '其他业务成本'],
    ['560202_{p}', '管理费用_房租'],
    ['560204_{p}', '管理费用_水电费'],
    ['560206_{p}', '管理费用_清洁费'],
    ['560209_{p}', '管理费用_工资'],
    ['560223_{p}', '管理费用_服务费'],
    ['560303_{p}', '财务费用_手续费'],
  ],
  /* 业主名单：付业主租金的摘要常是「跨行汇款」「网转」，没有业务含义，只能靠户名认 */
  owners: {
    '2001': ['黄巧嫦','李彩屏','潘燕波','卢国秋','冼国锋','康智敏','卢佑江','谢薇','梁翠红',
             '冼东君','卢国湛','冼世竣','冼艳桃','冼树六','骆维','徐淑荣','梁小冬','黄凤香',
             '卢尤添','冼章荣','卢志方','潘妙春','卢尤满'],
  },
  ownerAcct: '5402_{p}',
  ownerMemo: '付业主租金',
  /* 在编员工名单：名单内走 221101 应付职工薪酬（社保个人部分与个税另由月末计提凭证处理），
     名单外（项目现场、临时人员）走 560209 管理费用_工资。取自真实凭证：董伟森走应付职工薪酬全套。 */
  staff: ['董伟森'],
  staffAcct: '221101',
  /* 默认项目：手续费、服务费这类摘要里没有项目信息，真账都记冼村 */
  defaultProj: '2001',
  rules: [
    // 顺序要紧：命中第一条即停，越具体的越靠前
    { kw: '复建房|冼村|洗村', dir: 'out', acct: '5402_{p}', memo: '付业主租金' },
    // 收款：平台提现是冲应收，不是确认收入，必须排在收租金前面
    { kw: '寓小二|提现', dir: 'in', acct: '1122_{p}', memo: '平台提现冲应收',
      note: '租金在挂应收时已确认收入，提现只是收款' },
    { kw: '房租', dir: 'in', acct: '1122_{p}', memo: '收租金冲应收' },
    { kw: '收.*租金|租金.*收', dir: 'in', acct: '5001_{p}', memo: '收租金', tax: 0.01,
      note: '银行直收、未先挂应收的，确认收入并拆销项税' },
    // 水电费收入：借银行存款，贷主营业务收入，贷销项税（贵司口径）
    { kw: '水费|电费|水电|代收电费|代收水费', dir: 'in', acct: '5001_{p}', memo: '收水电费', tax: 0.01,
      proj: '1001',
      note: '按贵司分录：借银行存款 / 贷主营业务收入 + 贷销项税额。' +
            '水电代收只发生在花都，项目定死 1001，不吃全局默认项目；' +
            '但摘要里明写冼村的仍按摘要走' },
    // 押金
    { kw: '收.*押金|收到.*押金|押金', dir: 'in', acct: '224101_{p}', memo: '收押金',
      warn: '押金是负债不是收入' },
    { kw: '退押金', dir: 'out', acct: '5001_{p}', memo: '退押金', red: 1,
      warn: '按贵司做法用红字冲收入' },
    // 付房东与运营
    { kw: '房租.*电费|电费.*房租', dir: 'out', acct: '560202_{p}', memo: '付房东房租',
      warn: '这类通常要拆房租与水电两行，请复核' },
    { kw: '水费|电费|水电', dir: 'out', acct: '560204_{p}', memo: '付水电费' },
    { kw: '清洁|保洁|劳务费', dir: 'out', acct: '560206_{p}', memo: '付清洁费' },
    { kw: '工资|薪酬|薪金|代发', dir: 'out', acct: '560209_{p}', memo: '发放工资',
      byStaff: 1,
      note: '对方户名在在编员工名单里 → 221101 应付职工薪酬；不在 → 560209 管理费用_工资' },
    { kw: '财务.*费用|服务费|代理费', dir: 'out', acct: '560223_{p}', memo: '付服务费' },
    { kw: '手续费|汇费|工本费|短信费|账户管理费|年费', dir: 'out', acct: '560303_{p}', memo: '银行手续费' },
  ],
};
/* 小企业会计准则 · 标准科目表 —— 所有主体自动配齐（负责人拍板）。
   每个主体的科目 = 这张标准表 + 该主体自建科目（同编码时自建的名称优先）。
   标准科目不占各主体的存储、不可删；要更细的（如 5602 下的费用明细）自建。 */
const SE_CHART = [
  // 资产类
  ['1001', '库存现金'], ['1002', '银行存款'], ['1012', '其他货币资金'],
  ['1101', '短期投资'], ['1121', '应收票据'], ['1122', '应收账款'],
  ['1123', '预付账款'], ['1131', '应收股利'], ['1132', '应收利息'],
  ['1221', '其他应收款'], ['1401', '材料采购'], ['1403', '原材料'],
  ['1405', '库存商品'], ['1411', '周转材料'],
  ['1501', '长期债券投资'], ['1511', '长期股权投资'],
  ['1601', '固定资产'], ['1602', '累计折旧'], ['1604', '在建工程'],
  ['1606', '固定资产清理'], ['1701', '无形资产'], ['1702', '累计摊销'],
  ['1801', '长期待摊费用'], ['1901', '待处理财产损溢'],
  // 负债类
  ['2001', '短期借款'], ['2201', '应付票据'], ['2202', '应付账款'],
  ['2203', '预收账款'], ['2211', '应付职工薪酬'], ['2221', '应交税费'],
  ['222101', '应交税费_应交增值税'], ['2231', '应付利息'], ['2232', '应付利润'],
  ['2241', '其他应付款'], ['2401', '递延收益'], ['2501', '长期借款'],
  ['2701', '长期应付款'],
  // 所有者权益类
  ['3001', '实收资本'], ['3002', '资本公积'], ['3101', '盈余公积'],
  ['3103', '本年利润'], ['3104', '利润分配'],
  // 损益类
  ['5001', '主营业务收入'], ['5051', '其他业务收入'], ['5111', '投资收益'],
  ['5301', '营业外收入'], ['5401', '主营业务成本'], ['5402', '其他业务成本'],
  ['5403', '税金及附加'], ['5601', '销售费用'], ['5602', '管理费用'],
  ['5603', '财务费用'], ['5711', '营业外支出'], ['5801', '所得税费用'],
];

/* 其余主体尚无规则集——它们业务不同（电商、集包、塑料制造），
   规则要各自从真账里学，不能套用优栖这套。 */
/* 云迪（e32 广州云迪物业管理服务合伙企业）—— 起步规则集。
   目前只从 3 笔真实流水学到，用起来会不断补充。 */
const RS_YUNDI = {
  projects: [],
  accounts: [
    ['100201', '银行存款_基本户'],
    ['1122', '应收账款'],
    ['1221', '其他应收款'],
    ['2202', '应付账款'],
    ['2241', '其他应付款'],
    ['221101', '应付职工薪酬_工资'],
    ['222112', '应交税费_应交个人所得税'],
    ['22210107', '应交税费_应交增值税_销项税额'],
    ['224102', '其他应付款_股东往来'],
    ['3001', '实收资本'],
    ['5001', '主营业务收入'],
    ['5401', '主营业务成本'],
    ['5602', '管理费用'],
    ['560209', '管理费用_工资'],
    ['560223', '管理费用_服务费'],
    ['560303', '财务费用_手续费'],
  ],
  owners: {},
  ownerAcct: '', ownerMemo: '',
  /* 股东/往来人名单：这类流水摘要常是「转账」，没有业务含义，只能靠户名认 */
  investors: ['李堪珍'],
  rules: [
    { kw: '证书工本费|网银证书|工本费|证书服务费', dir: 'out', acct: '560303', memo: '银行证书费' },
    { kw: '手续费|账户管理费|短信费', dir: 'out', acct: '560303', memo: '银行手续费' },
    { kw: '注资|投资款|出资|股东借款|往来款', dir: 'in', acct: '224102', memo: '股东往来款',
      warn: '暂挂往来。未办验资与工商变更前不得转实收资本，税局不认；且挂账须及时清理，否则影响将来注销' },
    { kw: '工资|薪酬|薪金', dir: 'out', acct: '560209', memo: '发放工资' },
    { kw: '服务费|代理费', dir: 'out', acct: '560223', memo: '付服务费' },
  ],
};
const RULE_SETS = { youqi: RS_YOUQI, e32: RS_YUNDI };

/* 用户自建/改过的规则集存本地，覆盖内置预设 */
const RSET_KEY = e => 'fsc_t2_rset_' + e + '_v1';
function loadRSet(entId) {
  try { const s = JSON.parse(localStorage.getItem(RSET_KEY(entId)) || 'null'); if (s) return s; }
  catch (e) { /* 忽略 */ }
  return RULE_SETS[entId] || null;
}
function saveRSet(entId, set) {
  try { localStorage.setItem(RSET_KEY(entId), JSON.stringify(set)); }
  catch (e) { toast('规则集保存失败'); }
}
/** 给还没有规则集的主体开一个空的，之后可自己加科目、加规则 */
function initRSet(entId) {
  const set = { projects: [], accounts: [], owners: {}, ownerAcct: '', ownerMemo: '', rules: [] };
  saveRSet(entId, set); return set;
}

/* 当前主体与其规则集（全局上下文，顶栏可切） */
let CUR_ENT = '';
let RS = null;
function useRuleSet(entId) {
  CUR_ENT = entId || '';
  RS = entId ? loadRSet(entId) : null;
  RULES = (entId && RS) ? loadRules(entId) : [];
  try { localStorage.setItem('fsc_cur_ent', CUR_ENT); } catch (e) { /* 忽略 */ }
  return RS;
}
/** 主体自带的默认项目（用户可在步骤 2 改） */
const defaultProjOf = () => (RS && RS.defaultProj) || '';
const PROJECTS = () => (RS ? RS.projects : []);
/* 主体科目 = 自建 + 标准表补齐（同编码自建优先），按编码排序 */
const ACCOUNTS = (all) => {
  const custom = RS ? RS.accounts : [];
  const seen = new Set(custom.map(a => String(a[0])));
  const merged = custom.concat(SE_CHART.filter(a => !seen.has(a[0])))
    .slice().sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  // 停用的科目不进录入下拉；传 all=1 取全量（查名称、科目设置页用）
  return all ? merged : merged.filter(a => !(a[2] && a[2].off));
};

function detectProj(text) {
  const s = String(text || '');
  for (const p of PROJECTS()) if (new RegExp(p.kw).test(s)) return p;
  return null;
}
const fillAcct = (code, proj) => String(code).replace('{p}', proj ? proj.code : '____');
const acctName = code => {
  const list = ACCOUNTS(1);   // 停用的科目也要能查到名字，历史凭证还引用着
  const hit = list.find(a => a[0] === code);
  if (hit) return hit[1];
  const tpl = list.find(a => a[0].includes('{p}') &&
    new RegExp('^' + a[0].replace('{p}', '\\d+') + '$').test(code));
  if (tpl) return tpl[1];
  // 带项目后缀的（560201_2001）解析基础码——科目设置里改了名，账簿才跟得上
  const base = String(code).split('_')[0];
  if (base !== String(code)) {
    const bh = list.find(a => a[0] === base);
    if (bh) return bh[1];
  }
  // 反向：查无后缀的基础码（560209），但科目表里存的是模板（560209_{p}）
  const th = list.find(a => String(a[0]).includes('{p}') && String(a[0]).split('_')[0] === String(code));
  if (th) return th[1];
  return '';
};
/** 对方户名是否业主；是则返回项目代码 */
function ownerProj(opp) {
  if (!RS || !RS.owners) return null;
  const s = String(opp || '').trim();
  if (!s) return null;
  for (const code of Object.keys(RS.owners)) {
    if (RS.owners[code].some(n => s === n || s.includes(n))) return code;
  }
  return null;
}

/** 对方户名是否在编员工 */
function isStaff(opp) {
  if (!RS || !RS.staff) return false;
  const s = String(opp || '').trim();
  return !!s && RS.staff.some(n => s === n || s.includes(n));
}

/* ============ 规则库（按主体分开存） ============ */
/* v5：手续费规则补「汇费」「年费」（建行对账单里手续费叫汇费）。
   v4：水电收入规则定死花都项目。
   v3：工资按在编员工名单分流 + 主体默认项目。
   版本号必须随预置规则变更递增，否则老用户浏览器里缓存的旧规则不会更新。 */
const RULE_KEY = e => 'fsc_t2_rules_' + e + '_v5';
const LOG_KEY = 'fsc_t2_log_v1';

function loadRules(entId) {
  try {
    const s = localStorage.getItem(RULE_KEY(entId));
    if (s) return JSON.parse(s);
  } catch (e) { /* 忽略 */ }
  const set = loadRSet(entId);
  if (!set) return [];
  const init = set.rules.map(r => Object.assign({ id: uid(), hits: 0, src: '预置' }, r));
  saveRules(entId, init); return init;
}
function saveRules(entId, r) {
  try { localStorage.setItem(RULE_KEY(entId), JSON.stringify(r)); }
  catch (e) { toast('规则保存失败：浏览器存储空间不足'); }
}
let RULES = [];

function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
function saveLog(l) { try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 200))); } catch (e) { /* 忽略 */ } }
function addLog(entry) { const l = loadLog(); l.unshift(entry); saveLog(l); }

/* ============ T2 状态 ============ */
const T2 = {
  step: 1, rows: null, headRow: 0, map: {}, file: null,
  // acctId = T1 账户台账里的账户 id（账户主数据的唯一真相源在 T1）
  // acctNo = 从该账户带出来的账号文本，只用于凭证备注列和银行存款科目匹配
  ent: '', entId: '', line: '', acctId: '', acctNo: '', vchWord: '记', defProj: '',
  balPush: null,   // 余额回写结果，步骤 3 里摊开说
  sniffNo: null, autoBind: null,   // 上传时从文件里嗅到的卡号 / 自动认账户的结果
  result: null, tab: 'ok',
  logId: null,   // 本批流水在处理记录里的那一行，例外处理/导出都更新它
};

/* 表头别名 */
const FIELDS = [
  { k: 'date', n: '日期', alias: ['入账日期', '交易日期', '记账日期', '交易日', '日期', '交易时间', '业务日期', 'date'], must: 1 },
  { k: 'memo', n: '摘要', alias: ['摘要', '摘要说明', '用途', '附言', '交易摘要', '备注', '交易类型'], must: 1 },
  { k: 'inAmt', n: '收入金额', alias: ['转入金额', '收入', '贷方发生额', '贷方金额', '收入金额', '存入', '收款金额'] },
  { k: 'outAmt', n: '支出金额', alias: ['转出金额', '支出', '借方发生额', '借方金额', '支出金额', '支取', '付款金额'] },
  { k: 'amt', n: '发生额（单列）', alias: ['金额', '发生额', '交易金额'] },
  { k: 'dc', n: '借贷标志', alias: ['借贷', '借贷标志', '收付标志', '资金流向'] },
  { k: 'opp', n: '对方户名', alias: ['对方户名', '对方账户名称', '对方名称', '收款人名称', '付款人名称', '对方单位'] },
  { k: 'oppAcct', n: '对方账号', alias: ['对方账号', '对方账户', '对方卡号'] },
  { k: 'bal', n: '余额', alias: ['余额', '账户余额', '当前余额'] },
  { k: 'ref', n: '流水号', alias: ['流水号', '交易流水号', '凭证号', '业务编号', '交易序号'] },
];
const ALL_ALIAS = FIELDS.reduce((a, f) => a.concat(f.alias), []);

/* 某个单元格算不算「一笔钱」——空、横杠、0 都不算 */
const cellHasAmt = v => {
  const s = String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '');
  if (s === '' || s === '-' || s === '—') return false;
  const n = Number(s);
  return !isNaN(n) && n !== 0;
};

/* 找「借贷两列」。
   建行这类导出把收入和支出都叫「记账金额」，两列列名一模一样，靠名字分不出来；
   前面还有两列同样叫「交易金额」但整列是横杠。所以只能看数据形态：
   相邻两列、各自都出现过数字、且没有任何一行两列同时有数 —— 这就是一对借贷列。 */
function detectDcPair(body, map, ncol) {
  const taken = new Set(Object.values(map).filter(v => v !== undefined));
  for (let i = 0; i + 1 < ncol; i++) {
    if (taken.has(i) || taken.has(i + 1)) continue;
    let a = 0, b = 0, both = 0;
    body.forEach(r => {
      const x = cellHasAmt(r[i]), y = cellHasAmt(r[i + 1]);
      if (x) a++; if (y) b++; if (x && y) both++;
    });
    if (a > 0 && b > 0 && both === 0) return [i, i + 1];
  }
  return null;
}

/* 两列谁是收入谁是支出：拿余额的变动方向投票。
   余额变大的那一笔，钱在哪一列，哪一列就是收入。列名骗人，余额不会。 */
function orderDcPair(body, pair, balCol, asc) {
  if (balCol === undefined) return null;
  let firstIsIn = 0, firstIsOut = 0;
  for (let i = 0; i < body.length; i++) {
    // 「这笔之前」的余额：正序在上一行，倒序（新的在上面）在下一行
    const j = asc ? i - 1 : i + 1;
    if (j < 0 || j >= body.length) continue;
    const before = numOf(body[j][balCol]), after = numOf(body[i][balCol]);
    if (!before || !after || before === after) continue;
    const up = after > before;
    if (cellHasAmt(body[i][pair[0]])) { up ? firstIsIn++ : firstIsOut++; }
    else if (cellHasAmt(body[i][pair[1]])) { up ? firstIsOut++ : firstIsIn++; }
  }
  if (firstIsIn === firstIsOut) return null;       // 分不出就别猜
  return firstIsIn > firstIsOut
    ? { inAmt: pair[0], outAmt: pair[1] }
    : { inAmt: pair[1], outAmt: pair[0] };
}

function autoMap(headerCells, body) {
  const map = {};
  const norm = s => String(s || '').replace(/\s|　/g, '');
  const cells = headerCells.map(norm);
  const used = new Set();
  // 按「别名优先级」挑列，不按列在表里的先后。
  // 工行流水里「用途」常常整列是空的，而「摘要」才有内容；若按列序匹配，
  // 排在前面的「用途」会先被选走，摘要就废了。别名数组里谁排前面谁优先。
  const pick = (test) => FIELDS.forEach(f => {
    if (map[f.k] !== undefined) return;
    for (const a of f.alias) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && test(c, a));
      if (i >= 0) { map[f.k] = i; used.add(i); return; }
    }
  });
  pick((c, a) => c === a);          // 先精确
  pick((c, a) => c.includes(a));    // 再包含

  if (!body || !body.length) return map;

  // 金额列光看列名会认错：建行导出里「交易金额」整列是横杠，真正的钱在「记账金额」。
  // 整列一个数都没有的，不当金额列用。
  ['inAmt', 'outAmt', 'amt'].forEach(k => {
    if (map[k] === undefined) return;
    if (!body.some(r => cellHasAmt(r[map[k]]))) delete map[k];
  });

  // 收入/支出没认出来时，按数据形态找借贷两列，再用余额方向定谁收谁支
  if (map.inAmt === undefined && map.outAmt === undefined) {
    const ncol = body.reduce((m, r) => Math.max(m, r.length), headerCells.length);
    const pair = detectDcPair(body, map, ncol);
    // 文件是正序还是倒序：判方向要靠它，倒序时「这笔之前」的余额在下一行
    let asc = true;
    if (map.date !== undefined) {
      const ds = body.map(r => normDate(r[map.date])).filter(Boolean);
      if (ds.length > 1) asc = ds[0] <= ds[ds.length - 1];
    }
    const ord = pair ? orderDcPair(body, pair, map.bal, asc) : null;
    if (ord) {
      map.inAmt = ord.inAmt; map.outAmt = ord.outAmt;
      delete map.amt;                 // 有了借贷两列，单列发生额就别再掺和
      map._dcGuess = [ord.inAmt, ord.outAmt];   // 界面上要如实说这是推断出来的
    }
  }
  return map;
}

const numOf = v => {
  const s = String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
function normDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  let m = /^(\d{4})[-/年.]?(\d{1,2})[-/月.]?(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

/* 核心：跑规则 */
function runRules() {
  const { rows, headRow, map } = T2;
  const body = rows.slice(headRow + 1);
  const ok = [], ex = [];
  body.forEach((r, i) => {
    const get = k => (map[k] === undefined ? '' : r[map[k]]);
    const date = normDate(get('date'));
    const memo = String(get('memo') || '').trim();
    let inA = numOf(get('inAmt')), outA = numOf(get('outAmt'));
    // 单列金额 + 借贷标志
    if (map.inAmt === undefined && map.outAmt === undefined && map.amt !== undefined) {
      const a = numOf(get('amt'));
      const flag = String(get('dc') || '').trim();
      const isOut = /借|支|付|出|-/.test(flag) || a < 0;
      if (isOut) outA = Math.abs(a); else inA = Math.abs(a);
    }
    const amt = inA > 0 ? inA : outA;
    const dir = inA > 0 ? 'in' : 'out';
    const opp = String(get('opp') || '').trim();
    const rec = {
      no: i + 1, date, memo, dir, amt,
      opp, oppAcct: String(get('oppAcct') || '').trim(),
      ref: String(get('ref') || '').trim(),
      raw: r
    };
    if (!date || !amt) { rec.why = !date ? '日期为空或无法识别' : '金额为 0 或无法识别'; ex.push(rec); return; }
    // 匹配范围：默认只看摘要。对方户名容易误命中（如「交通运输部」含「运输」），
    // 必须由规则显式声明 scope:'both' 才纳入。
    let hitField = '';
    // 对方户名在股东/往来人名单里 + 收款方向 → 判定为往来款挂账
    if (RS && RS.investors && dir === 'in') {
      const inv = RS.investors.find(n => opp && (opp === n || opp.includes(n)));
      if (inv) {
        rec.rule = { id: 'investor', kw: '股东往来名单', memo: '股东往来款' };
        rec.hitField = '股东往来名单'; rec.proj = null;
        rec.acct = '224102'; rec.vmemo = '收 ' + inv + ' 往来款';
        rec.tax = 0; rec.red = 0;
        rec.warn = '暂挂往来，未办验资与工商变更前不得转实收资本（税局不认）；挂账须及时清理';
        ok.push(rec); return;
      }
    }
    // 对方户名在业主名单里 + 付款方向 → 直接判定为付业主租金，
    // 不依赖摘要（银行流水里这类摘要是「跨行汇款」「网转」，没有业务含义）
    const ownerCode = ownerProj(opp);
    if (ownerCode && dir === 'out') {
      const pj = PROJECTS().find(p => p.code === ownerCode);
      rec.rule = { id: 'owner', kw: '业主名单', memo: '付业主租金' };
      rec.hitField = '业主名单'; rec.proj = pj;
      rec.acct = fillAcct(RS.ownerAcct, pj); rec.vmemo = RS.ownerMemo;
      rec.tax = 0; rec.red = 0; rec.warn = '';
      ok.push(rec); return;
    }
    const hit = RULES.find(rule => {
      if (rule.dir !== 'any' && rule.dir !== dir) return false;
      const re = new RegExp(rule.kw);
      if (re.test(memo)) { hitField = '摘要'; return true; }
      if (rule.scope === 'both' && opp && re.test(opp)) { hitField = '对方户名'; return true; }
      return false;
    });
    if (!hit) { rec.why = '摘要未命中任何规则'; ex.push(rec); return; }
    // 项目识别，优先级从高到低：
    // 摘要 → 对方户名 → 业主名单 → 规则自带的固定项目 → 用户设的全局默认项目
    // 规则固定项目排在全局默认之上：某些业务只发生在一个项目（如水电代收只在花都），
    // 但摘要里明写了别的项目时，仍以摘要为准。
    const oc = ownerProj(opp);
    const byCode = c => (c ? PROJECTS().find(p => p.code === c) : null);
    const proj = detectProj(memo) || detectProj(opp)
      || byCode(oc) || byCode(hit.proj) || byCode(T2.defProj);
    rec.rule = hit; rec.vmemo = hit.memo || memo; rec.hitField = hitField;
    rec.proj = proj;
    rec.tax = hit.tax || 0; rec.red = hit.red || 0;
    rec.warn = hit.warn || '';
    // 工资类按在编员工名单分流：名单内冲应付职工薪酬，名单外记管理费用_工资
    let acctTpl = hit.acct;
    if (hit.byStaff && isStaff(opp)) {
      acctTpl = RS.staffAcct;
      rec.vmemo = '发放工资（冲应付职工薪酬）';
      rec.hitField = hitField + ' + 员工名单';
      rec.warn = '本行只冲应付职工薪酬（实发数）；社保个人部分与个税代扣由月末计提凭证处理';
    }
    rec.acct = fillAcct(acctTpl, proj);
    // 科目需要项目但没识别出来 → 不硬填，进例外让人指定
    // 注意查的是分流后真正要用的科目：221101 应付职工薪酬本就不带项目，不该因缺项目进例外
    if (String(acctTpl).includes('{p}') && !proj) {
      rec.why = '命中规则「' + hit.memo + '」，但摘要里认不出是哪个项目';
      ex.push(rec); return;
    }
    ok.push(rec);
  });
  // file 用来防错配：上传了新文件但还没重新转换时，旧 result 不能拿去存流水明细
  T2.result = { ok, ex, total: body.length, file: T2.file ? T2.file.name : '' };
  // 命中计数
  ok.forEach(r => { const t = RULES.find(x => x.id === r.rule.id); if (t) t.hits = (t.hits || 0) + 1; });
  saveRules(T2.entId, RULES);
}

/* 处理留痕：转换一完成就写一条「未导出」记录（导入了但没导出也要有痕）；
   同一批流水后续的例外处理、导出都更新这一条，不另起新行。
   exported 传 1 表示这次动作是导出。 */
function t2Log(exported) {
  const { ok, ex, total } = T2.result;
  const stat = { total, ok: ok.length, ex: ex.length, rate: total ? Math.round(ok.length / total * 100) : 0 };
  const l = loadLog();
  const e = T2.logId && l.find(x => x.id === T2.logId);
  if (e) { Object.assign(e, stat, exported ? { exported: 1 } : null); saveLog(l); }
  else {
    // 找不到本批的记录（老会话、或中途清空过记录）就现补一条
    T2.logId = uid();
    addLog(Object.assign({
      id: T2.logId, time: new Date().toLocaleString('zh-CN'),
      file: T2.file ? T2.file.name : '', ent: T2.ent, exported: exported ? 1 : 0,
    }, stat));
  }
}

/* ============ 凭证生成 ============ */
/* 科目代码里的项目后缀（5001_1001）是本工具内部写法。
   金蝶模版要求拆开：科目代码只写主科目 5001，项目编码 1001 单独填「项目」列。 */
function splitAcct(code) {
  const m = /^(\d+)_(\d+)$/.exec(String(code));
  return m ? { base: m[1], proj: m[2] } : { base: String(code).split('_')[0], proj: '' };
}

/* 金蝶里除项目外还带「供应商 / 客户 / 职员」核算的科目：
   本工具只认得出项目，这几个科目导入前要人工补一列。
   取自模版「科目数据」页的核算类别（优栖 2026 年账套）。 */
const AUX_EXTRA = {
  '224101': '供应商', '122101': '客户', '2203': '客户', '122102': '职员',
};

/* 凭证行的中间形态：一行一分录。凭证明细 CSV 与金蝶模版都从它派生，
   借贷拆分逻辑只写一遍（§4.24 单一真相源）。 */
function voucherLines() {
  const { ok } = T2.result;
  const out = [];
  const bankAcct = () => {
    const hit = ACCOUNTS().find(a => T2.acctNo && a[1].includes(T2.acctNo));
    return hit || ['100203', '银行存款_优栖工行6418'];
  };
  ok.forEach((r, i) => {
    const no = i + 1;
    const bank = bankAcct();
    const other = [r.acct, acctName(r.acct)];
    let seq = 0;
    const push = (a, d, c) => {
      const sp = splitAcct(a[0]);
      out.push({
        date: r.date, word: T2.vchWord, no, seq: ++seq, memo: r.vmemo,
        acctFull: a[0], acct: sp.base, acctName: a[1],
        dr: d ? +d.toFixed(2) : 0, cr: c ? +c.toFixed(2) : 0,
        proj: sp.proj,
        projName: sp.proj ? ((PROJECTS().find(p => p.code === sp.proj) || {}).name || '') : '',
        auxNeed: AUX_EXTRA[sp.base] || '',
        opp: r.opp, ref: r.ref,
      });
    };
    if (r.dir === 'in' && r.tax) {
      // 含税收入：拆主营业务收入 + 销项税额（按征收率）
      const net = +(r.amt / (1 + r.tax)).toFixed(2);
      const vat = +(r.amt - net).toFixed(2);
      push(bank, r.amt, 0);
      push(other, 0, net);
      push(['22210107', '应交税费_应交增值税_销项税额'], 0, vat);
    } else if (r.red) {
      // 红字冲销：两行都在贷方，冲减方为负数（贵司退押金的做法）
      push(other, 0, -r.amt);
      push(bank, 0, r.amt);
    } else if (r.dir === 'in') {
      push(bank, r.amt, 0); push(other, 0, r.amt);
    } else {
      push(other, r.amt, 0); push(bank, 0, r.amt);
    }
  });
  return out;
}

/* 凭证明细（本工具口径，带主体/业务线/对方户名/流水号，用于追溯与留痕） */
function vouchers() {
  return voucherLines().map(l => [
    l.date, l.word, String(l.no).padStart(4, '0'), l.memo, l.acctFull, l.acctName,
    l.dr ? l.dr.toFixed(2) : '', l.cr ? l.cr.toFixed(2) : '',
    T2.ent, T2.line, l.projName, '', l.opp, l.ref, T2.acctNo,
  ]);
}

/* 金蝶凭证导入模版 —— 25 列，列名与顺序一个字都不能改，
   照抄用户提供的「凭证导入成功_2026-08.xlsx · 凭证模版」页。 */
const KD_HEADER = ['日期', '凭证字', '凭证号', '附件数', '分录序号', '摘要', '科目代码', '科目名称',
  '借方金额', '贷方金额', '客户', '供应商', '职员', '项目', '部门', '存货',
  '自定义辅助核算类别', '自定义辅助核算编码', '自定义辅助核算类别1', '自定义辅助核算编码1',
  '数量', '单价', '原币金额', '币别', '汇率'];

function kingdeeRows() {
  const E = '';
  return voucherLines().map(l => {
    const amt = l.dr || l.cr;   // 原币金额取本行发生额；红冲行为负数
    return [
      { d: l.date }, l.word, l.no, 0, l.seq, l.memo,
      { s: l.acct }, l.acctName,
      l.dr ? { n: l.dr } : E, l.cr ? { n: l.cr } : E,
      E, E, E,                                  // 客户 / 供应商 / 职员
      l.proj ? { s: l.proj } : E,               // 项目：填编码，不填名称
      E, E, E, E, E, E, E, E,                   // 部门/存货/自定义辅助核算×2/数量/单价
      { n: amt }, 'RMB', { n: 1 },
    ];
  });
}

/* ============ 界面：工具箱 ============ */
const TOOLS = [
  { id: 'T1', n: '资金日报生成器', save: 20, ready: 1, go: 't1', own: '出纳',
    d: '账户台账预置，每天只填变动的；三级汇总 + 覆盖倍数红线 + 一键生成钉钉日报文本' },
  { id: 'T2', n: '银行流水转凭证', save: 24, ready: 1, go: 't2', own: '出纳 · 总账',
    d: '网银导出的流水，自动归一化 + 规则匹配科目，生成可导入账务系统的凭证文件' },
  { id: 'T3', n: '对账单核对器', save: 22, ready: 1, go: 't3', own: '会计 · 通用',
    d: '我方台账与对方对账单逐笔勾对，三类差异；列对应可存模板，下月复用' },
  { id: 'T4', n: '日损益速算表', save: 35, ready: 1, go: 't4', own: '会计',
    d: '14 渠道按大电商/拼多多/经销三事业部归集；取数天数不对齐时禁止出汇总，硬推口径显式标注' },
  { id: 'T5', n: '商品对码工具', save: 0, own: '会计', d: '销售端与采购端商品名归一化匹配，产出对码表' },
  { id: 'T8', n: '申报数据汇总表', save: 12, own: '税务会计', d: '多主体申报数据汇集与账表税比对' },
  { id: 'T6', n: '发票查重与打标', save: 7, own: '会计', d: '进项票查重、按合同号打标四级维度' },
  { id: 'T10', n: '盘点差异表', save: 4, own: '项目财务', d: '账面与实盘差异、强制归因' },
  { id: 'T7', n: '月结检查清单', save: 0, own: '全员', d: '月结 24 项清单执行与留痕' },
];

const S = {};

S['home'] = () => head('工作台', '一期已上线「工具箱」。其余功能域为二期规划，点击可查看规划说明。', '')
  + kpis([
    { k: '已上线工具', v: String(TOOLS.filter(t => t.ready).length), u: '个', t: 'g', d: TOOLS.filter(t => t.ready).map(t => t.id).join(' · ') },
    { k: '规划中工具', v: String(TOOLS.filter(t => !t.ready).length), u: '个' },
    { k: '已上线合计月省', v: String(TOOLS.filter(t => t.ready).reduce((s, t) => s + t.save, 0)), u: 'h', t: 'g' },
    { k: 'T2 规则库', v: String(RULES.length), u: '条', d: '可持续累积' },
    { k: 'T2 累计处理', v: String(loadLog().length), u: '批次' },
  ])
  + `<div class="note"><b>一期范围：</b>系统整体结构已搭好（9 个功能域），功能上只开放<b>工具箱</b>。其余模块按方案二期起逐个开发，点进去能看到各自的规划说明与对应模块编号。</div>`
  + card('快速开始', `<div style="padding:14px">
      <div class="tgrid">${TOOLS.filter(t => t.ready).map(toolCard).join('')}</div>
    </div>`);

function toolCard(t) {
  const soon = !t.ready;
  return `<button class="tcard ${soon ? 'soon' : ''}" ${t.ready ? `data-go="${t.go}"` : ''}>
    <span class="tc-h"><span class="tc-id">${t.id}</span><span class="tc-n">${H(t.n)}</span><span class="tc-sp"></span>
      ${t.save ? `<span class="tc-sv">省 ${t.save}<small> h/月</small></span>` : `<span class="tc-sv" style="color:var(--accent)">降差错</span>`}</span>
    <span class="tc-d">${H(t.d)}</span>
    <span class="tc-m">${t.ready ? pill('已上线', 'ok') : pill('规划中', 'mu')}<span class="tc-tag">${H(t.own)}</span></span>
  </button>`;
}

S['tool-list'] = () => head('我的工具', `工具箱是常设能力——新工具会持续加进来。当前已上线 ${TOOLS.filter(t => t.ready).length} 个，其余按方案排期逐个开发。`, '工具箱')
  + `<div class="note g"><b>先跑通一个再做下一个。</b>上线的工具用顺了、复盘达标了，再开下一个。这样每个工具上线时都能真正被用起来，而不是堆一堆没人用的功能。</div>`
  + `<div class="tgrid">${TOOLS.map(toolCard).join('')}</div>`;

S['tool-plan'] = () => {
  // 状态从 TOOLS 的 ready 标记派生，不再手写——手写的排期表跟实际上线状态对不上过一次（T1 已上线仍标待开发）
  const st = id => { const t = TOOLS.find(x => x.id === id); return t && t.ready ? pill('已上线', 'ok') : pill('待开发', 'mu'); };
  const live = TOOLS.filter(t => t.ready);
  return head('开发排期', `十个工具分三批。已上线 <b>${live.length}</b> 个（${live.map(t => t.id).join(' · ')}）。`, '工具箱')
    + card('排期', table(
      [{ t: '批次' }, { t: '工具' }, { t: '状态' }, { t: '可省', n: 1 }],
      [
        ['第一批', 'T2 银行流水转凭证', st('T2'), '24 h/月'],
        ['第一批', 'T3 对账单核对器', st('T3'), '22 h/月'],
        ['第一批', 'T1 资金日报生成器', st('T1'), '20 h/月'],
        ['第一批', 'T5 商品对码工具', st('T5'), '前置'],
        ['第二批', 'T4 日损益速算表', st('T4'), '35 h/月'],
        ['第二批', 'T8 / T6', pill('规划中', 'mu'), '19 h/月'],
        ['第三批', 'T10 / T7', pill('规划中', 'mu'), '4 h/月'],
      ]))
    + `<div class="note"><b>推进原则：</b>跑完一个、用好一个，再开下一个。每个工具上线一个月后复盘实测节省，达成率低于 70% 的先优化再往下走。</div>`;
};

/* 规则库界面 */
S['tool-rules'] = () => {
  if (!CUR_ENT) {
    return head('规则库', '规则库<b>按主体隔离</b>——不同主体业务不同，共用一套规则必然记错账。', '工具箱 · T2')
      + `<div class="note"><b>请先在顶栏选一个主体。</b>选好之后在这里维护它的科目表与规则。</div>`
      + `<div class="tgrid">${ENTITIES.map(e => { const s = loadRSet(e.id); return `
          <button class="tcard ${s ? '' : 'soon'}" data-useent="${e.id}">
          <span class="tc-h"><span class="tc-n">${H(entShort(e))}</span><span class="tc-sp"></span>
          <span class="tc-sv">${s ? s.rules.length : 0}<small> 条规则</small></span></span>
          <span class="tc-d">${H(e.full)}</span>
          <span class="tc-m">${e.line ? `<span class="tc-tag">${H(e.line)}</span>` : ''}
          ${s ? `<span class="tc-tag">${s.accounts.length} 科目</span>` : pill('未建规则集', 'mu')}</span></button>`; }).join('')}</div>`;
  }
  const curEnt0 = ENTITIES.find(e => e.id === CUR_ENT);
  if (!RS) {
    return head('规则库 · ' + (curEnt0 ? curEnt0.full : ''), '这个主体还没有规则集。', '工具箱 · T2',
      `<button class="btn" data-useent="">换主体</button>`)
      + `<div class="note"><b>先建科目表，再建规则。</b>规则的本质是「什么样的流水 → 记哪个科目」，没有科目表就无从建起。</div>`
      + `<div class="cols c2">
        ${cardp('从通用模板起步（推荐）', `<div style="font-size:12.5px;line-height:1.8">
          小企业会计准则标准科目表（${SE_CHART.length} 个）已自动配齐，直接可用；
          更细的明细科目去「基础 → 科目设置」加。</div>
          `)}
        ${cardp('从别的主体复制', `<div style="font-size:12.5px;line-height:1.8">
          业务相近的主体可以直接复制它的科目表与规则，再改。</div>
          <div style="margin-top:11px;display:flex;gap:7px;flex-wrap:wrap">
          ${ENTITIES.filter(e => e.id !== CUR_ENT && loadRSet(e.id)).map(e =>
            `<button class="btn" data-copyfrom="${e.id}">复制「${H(entShort(e))}」</button>`).join('') || '<span class="mut">还没有别的主体建过</span>'}
          </div>`)}
      </div>`
      + `<div class="note w"><b>也可以空手起步：</b>直接去 T2 处理例外，在科目框旁边点 <b>+</b> 一个个加——
         处理完一批流水，科目表和规则库就同时长出来了。<b>这是最贴合实际的方式。</b></div>`;
  }
  const rows = RULES.map(r => [
    `<span class="code">${H(r.kw.length > 26 ? r.kw.slice(0, 26) + '…' : r.kw)}</span>`,
    r.dir === 'in' ? pill('收入', 'ok') : r.dir === 'out' ? pill('支出', 'wa') : pill('不限', 'mu'),
    `<span class="code">${r.acct}</span> ${H(acctName(r.acct))}`,
    H(r.memo || ''),
    `<span class="num">${r.hits || 0}</span>`,
    H(r.src || '自建'),
    `<button class="btn sm" data-delrule="${r.id}">删除</button>`
  ]);
  const curEnt = ENTITIES.find(e => e.id === T2.entId);
  const customs = RS ? RS.accounts : [];
  const customSet = new Set(customs.map(a => String(a[0])));
  const accRows = customs.map((a, i) => [
    `<span class="code">${H(a[0])}</span>`, H(a[1]), pill('自建', 'ok'),
    `<button class="btn sm" data-delacct="${i}">删除</button>`])
    .concat(SE_CHART.filter(a => !customSet.has(a[0])).map(a => [
      `<span class="code">${H(a[0])}</span>`, H(a[1]), pill('标准', 'mu'), '']))
    .sort((x, y) => x[0].localeCompare(y[0]));
  return head('规则库 · ' + (curEnt ? curEnt.full : ''),
    '摘要关键词 → 会计科目。每处理一次例外就可以存成规则，规则库越养越准。<b>规则按主体隔离</b>。', '工具箱 · T2',
    `<button class="btn" data-act="exportRules">导出规则</button><button class="btn pri" data-act="addRule">+ 新增规则</button>`)
    + kpis([
      { k: '规则总数', v: String(RULES.length), u: '条' },
      { k: '累计命中', v: String(RULES.reduce((s, r) => s + (r.hits || 0), 0)), u: '次', t: 'g' },
      { k: '自建规则', v: String(RULES.filter(r => r.src !== '预置').length), u: '条' },
      { k: '从未命中', v: String(RULES.filter(r => !r.hits).length), u: '条', t: 'w', d: '可考虑清理' },
    ])
    + `<div class="note"><b>规则匹配顺序：</b>从上到下，命中第一条即停。所以<b>越具体的规则要放越前面</b>。新增规则默认插在最前。</div>`
    + card('规则列表', table(
      [{ t: '关键词（正则）' }, { t: '方向' }, { t: '科目' }, { t: '凭证摘要' }, { t: '命中', n: 1 }, { t: '来源' }, { t: '' }], rows))
    + card(`科目表（${ACCOUNTS().length} 个 · 小企业会计准则标准表已配齐）`,
        table([{ t: '编码' }, { t: '名称' }, { t: '来源' }, { t: '' }], accRows),
      `<button class="btn pri" data-act="addAcct">+ 新增科目</button>`)
    + `<div class="note"><b>规则依赖科目表。</b>科目表里没有的科目，处理例外时选不到。
       建议顺序：先把常用科目建齐，再在处理例外时把「这类流水 → 这个科目」存成规则。</div>`;
};

S['tool-log'] = () => {
  const log = loadLog();
  if (!log.length) return head('处理记录', '每次转换都会留痕：什么时候、哪份文件、处理了多少笔、有没有导出。', '工具箱 · T2')
    + `<div class="soonbox"><div class="si">▷</div><h3>还没有处理记录</h3><p>用 T2 转换一次银行流水后，这里会记录下来。</p></div>`;
  return head('处理记录', '每次转换都会留痕：什么时候、哪份文件、处理了多少笔、有没有导出。', '工具箱 · T2',
    `<button class="btn" data-act="clearLog">清空记录</button>`)
    + card('记录', table(
      [{ t: '时间' }, { t: '文件' }, { t: '主体' }, { t: '总笔数', n: 1 }, { t: '已匹配', n: 1 }, { t: '例外', n: 1 }, { t: '匹配率' }, { t: '导出' }],
      log.map(l => [l.time, H(l.file), H(l.ent || '—'), l.total, l.ok, l.ex,
        `<b class="${l.rate >= 90 ? 'grn' : l.rate >= 70 ? '' : 'red'}">${l.rate}%</b>`,
        l.exported ? pill('已导出', 'ok') : pill('未导出', 'mu')])));
};

/* ============ T2 主界面 ============ */
function stepBar() {
  const names = ['选择文件', '识别表头', '匹配规则', '处理例外', '导出凭证'];
  return `<div class="steps">${names.map((n, i) => {
    const k = i + 1;
    const cls = T2.step === k ? 'on' : T2.step > k ? 'dn' : '';
    return `<span class="stp ${cls}"><i>${T2.step > k ? '✓' : k}</i>${n}</span>${i < 4 ? '<span class="stln"></span>' : ''}`;
  }).join('')}</div>`;
}

S['t2'] = () => {
  let body = '';
  if (T2.step === 1) body = t2Step1();
  else if (T2.step === 2) body = t2Step2();
  else if (T2.step === 3) body = t2Step3();
  else if (T2.step === 4) body = t2Step4();
  else body = t2Step5();
  return head('T2　银行流水转凭证',
    '网银导出的流水丢进来，自动识别表头、按规则匹配科目、生成可导入账务系统的凭证文件。匹配不上的单独列出，绝不猜。',
    '工具箱 · 已上线',
    T2.step > 1 ? `<button class="btn" data-act="t2reset">重新开始</button>` : '')
    + stepBar() + body;
};

function t2Step1() {
  return `<div class="note"><b>支持格式：</b>.xlsx / .csv / .tsv / .txt（UTF-8 与 GBK 自动识别）。文件只在你的浏览器里解析，<b>不会上传到任何服务器</b>。</div>
  <div class="card"><div class="cb">
    <div class="drop" id="drop">
      <div class="di">⇪</div>
      <div class="dt">把银行流水文件拖到这里，或点击选择</div>
      <div class="dm">一次处理一个账户的流水。多账户请分别处理。</div>
    </div>
  </div></div>
  ${cardp('这个工具替你做什么', `
    <div style="font-size:12.5px;line-height:1.95">
    ① 各家银行导出格式不同，<b>自动归一化</b>列名与日期格式<br>
    ② 按<b>摘要关键词规则库</b>匹配会计科目与借贷方向<br>
    ③ 自动带出<b>主体、业务线</b>等核算维度<br>
    ④ 生成<b>可直接导入账务系统</b>的凭证文件（借贷平衡）<br>
    ⑤ 匹配不上的进<b>例外清单</b>，由你逐条处理，并可存成新规则
    </div>
    <div class="note w" style="margin:12px 0 0"><b>工具不替你做的：</b>不猜科目、不自动入账、不碰网银。生成的是<b>草稿</b>，导入账务系统前请复核。</div>`)}`;
}

/* 当前主体的匹配键 —— T1 账户台账也用法人全称存主体，两边字字相同才对得上 */
const t2EntKey = () => {
  const e = ENTITIES.find(x => x.id === T2.entId);
  return e ? e.full : '';
};
/* 选定收付账户：只记 id，账号文本从 T1 台账带出来（账号为空就退回用账户名） */
function t2SetAcct(id) {
  T2.acctId = id || '';
  const a = (typeof t1AccById === 'function' && id) ? t1AccById(id) : null;
  T2.acctNo = a ? (a.no || a.name) : '';
}
/* 收付账户下拉：账户主数据只在 T1 台账里存一份，这里只引用，不自己存 */
function t2AcctSelect() {
  if (!T2.entId) {
    return '<select disabled><option>— 请先选主体 —</option></select>';
  }
  const accs = (typeof t1Accounts === 'function') ? t1Accounts(t2EntKey()) : [];
  if (!accs.length) {
    return '<select disabled><option>— 该主体在 T1 台账里没有在管账户 —</option></select>'
      + '<div class="mut" style="font-size:11px;margin-top:4px">去 <b>T1 资金日报 → 账户台账</b> 添加，这里就能选到</div>';
  }
  return `<select id="acctSel"><option value="">— 请选择 —</option>${accs.map(a =>
    `<option value="${a.id}" ${T2.acctId === a.id ? 'selected' : ''}>${H(a.name)}${a.no ? ' · ' + H(a.no) : ''}</option>`
  ).join('')}</select>`
    + '<div class="mut" style="font-size:11px;margin-top:4px">来自 T1 账户台账。跑完流水，期末余额会回写到 T1 当日余额。</div>';
}

/* 把这份流水「自己的账号」找出来。银行导出五花八门，三条路依次试：
   ① 表头上方的说明行里写着「卡号: 6215****1234」——建行、多数网银是这样
   ② 说明行把标签和值拆在相邻两格：「银行账号」「120914833010605」——招商银行对账单
   ③ 表里就有一列叫「本方账号」，取第一条数据的值——工行 HISTORYDETAIL
   都找不到就返回 null，让用户手选，不猜。 */
function t2SniffAcctNo(rows, headRow) {
  const LABEL = /(卡号|本方账号|本方账户|我方账号|银行账号|账户号|户号|账号|帐号)/;
  const isNo = v => {
    const t = String(v == null ? '' : v).trim();
    return /^[0-9][0-9*＊\-\s]{5,}$/.test(t) && t.replace(/[^0-9]/g, '').length >= 6;
  };
  const scan = rows.slice(0, Math.min(headRow + 1, 12));
  // ① 同一格里「标签: 数字」
  for (const r of scan) {
    for (const c of r) {
      const m = /(?:卡号|账号|帐号|账户号|户号)\s*[:：]\s*([0-9][0-9*＊\-\s]{5,})/.exec(String(c == null ? '' : c));
      if (m && m[1].replace(/[^0-9]/g, '').length >= 6) return m[1].trim();
    }
  }
  // ② 标签在这一格、数字在右边某一格（中间可能隔着空格子）
  for (const r of scan) {
    for (let i = 0; i < r.length; i++) {
      if (!LABEL.test(String(r[i] || '').replace(/\s/g, ''))) continue;
      for (let j = i + 1; j < Math.min(i + 4, r.length); j++) {
        if (isNo(r[j])) return String(r[j]).trim();
      }
    }
  }
  // ③ 表里有「本方账号」列，取第一条有值的数据行
  const head = (rows[headRow] || []).map(h => String(h == null ? '' : h).replace(/\s/g, ''));
  const own = head.findIndex(h => /^(本方账号|本方账户|我方账号|账号)$/.test(h));
  if (own >= 0) {
    for (const r of rows.slice(headRow + 1, headRow + 30)) {
      if (isNo(r[own])) return String(r[own]).trim();
    }
  }
  return null;
}

/* 兜底：文件里压根没有本方账号时（工行有的导出就只有对方账号），
   拿文件名去撞主体。只在「唯一命中一个主体」时才用，撞上两个就不猜。
   这是猜的，界面上必须说清楚，让人核一眼。 */
function t2GuessByFileName() {
  if (!T2.file || typeof t1Accounts !== 'function') return;
  const fn = String(T2.file.name || '');
  const core = full => String(full)
    .replace(/^(广州市|广州|深圳市|深圳|中山市|中山|海南省|海南)/, '')
    .replace(/（广州）|\(广州\)/g, '')
    .replace(/(合伙企业（有限合伙）|有限责任公司|股份有限公司|有限公司|公司)$/, '');
  // 取核心名的前 2-4 个字去文件名里找，命中最长的那个
  const hits = ENTITIES.filter(e => {
    const c = core(e.full);
    for (let n = Math.min(4, c.length); n >= 2; n--) {
      if (fn.includes(c.slice(0, n))) return true;
    }
    return false;
  });
  if (hits.length !== 1) return;          // 不唯一就不猜
  const e = hits[0];
  const accs = t1Accounts(e.full);
  if (!accs.length) return;
  T2.entId = e.id; T2.ent = e.full;
  useRuleSet(T2.entId); T2.defProj = defaultProjOf();
  if (!T2.line && e.line) T2.line = e.line;
  T2.autoBind = { guess: 1, ent: e.full, only: accs.length === 1 };
  if (accs.length === 1) { t2SetAcct(accs[0].id); t2PushBalance(); }
}

/* 上传文件后自动认账户：靠文件里的卡号去 T1 台账匹配。
   认出来就顺带把主体也定了，并立刻回写余额——不用等用户走完匹配规则那一步。 */
function t2AutoBind() {
  T2.sniffNo = null; T2.autoBind = null;
  if (!T2.rows || typeof t1FindAccByNo !== 'function') return;
  const no = t2SniffAcctNo(T2.rows, T2.headRow);
  if (!no) { t2GuessByFileName(); return; }
  T2.sniffNo = no;
  const acc = t1FindAccByNo(no);
  if (!acc) { T2.autoBind = { miss: 1 }; return; }
  const ent = ENTITIES.find(e => e.full === acc.ent);
  if (ent) {
    T2.entId = ent.id; T2.ent = ent.full;
    useRuleSet(T2.entId); T2.defProj = defaultProjOf();
    if (!T2.line && ent.line) T2.line = ent.line;
  }
  t2SetAcct(acc.id);
  T2.autoBind = { accId: acc.id, ent: acc.ent, name: acc.name, no: acc.no };
  t2PushBalance();   // 认出账户就直接把期末余额写进 T1，上传完 T1 里就能看到
}

/* 从流水里取期末余额。
   坑：网银导出有正序也有倒序的，同一天多笔时「最后一笔」在文件里可能是第一行。
   所以先比首末两行判断排序方向，再决定同日取哪一行，不能闭眼取最后一行。 */
function t2ClosingBal() {
  const { rows, headRow, map } = T2;
  if (!rows || map.bal === undefined || map.date === undefined) return null;
  const body = rows.slice(headRow + 1)
    .map(r => ({ d: normDate(r[map.date]), raw: r[map.bal] }))
    .filter(x => x.d && String(x.raw == null ? '' : x.raw).trim() !== '');
  if (!body.length) return null;
  const asc = body[0].d <= body[body.length - 1].d;
  const maxD = body.reduce((m, x) => (x.d > m ? x.d : m), body[0].d);
  const sameDay = body.filter(x => x.d === maxD);
  const pick = asc ? sameDay[sameDay.length - 1] : sameDay[0];
  return { date: maxD, val: numOf(pick.raw), asc };
}

/* 把期末余额回写到 T1 的当日余额。
   那天已有手工录的数且对不上时先问，不静默覆盖。 */
function t2PushBalance() {
  // 同一份文件里改了账户下拉 → 上一次是写错账户了，把那笔撤掉再写新的，
  // 否则旧账户会凭空多出一笔它从没有过的余额。
  // 必须核对是同一份文件：不同文件本来就该写到不同账户，不是写错（撤了就是误删）
  const prev = T2.balPush;
  if (prev && prev.ok && prev.accId && prev.accId !== T2.acctId
    && T2.file && prev.file === T2.file.name && typeof t1ClearBalance === 'function') {
    t1ClearBalance(prev.accId, prev.date, 'T2', prev.val);
  }
  T2.balPush = null;
  if (typeof t1PutBalance !== 'function' || !T2.acctId) return;
  const cb = t2ClosingBal();
  if (!cb) { T2.balPush = { skip: 1 }; return; }
  let r = t1PutBalance(T2.acctId, cb.date, cb.val, 'T2');
  if (r.conflict) {
    const diff = cb.val - r.old;
    const ok = confirm(
      `${cb.date} 这天 T1 里已经有余额 ${money(r.old)}，\n`
      + `流水算出来的期末余额是 ${money(cb.val)}，差 ${(diff >= 0 ? '+' : '') + money(diff)}。\n\n`
      + `用流水的数覆盖吗？\n取消 = 保留原来手工录的数。`);
    if (!ok) { T2.balPush = { kept: 1, accId: T2.acctId, date: cb.date, val: cb.val, old: r.old }; return; }
    r = t1PutBalance(T2.acctId, cb.date, cb.val, 'T2', 1);
  }
  T2.balPush = r.ok ? { ok: 1, accId: T2.acctId, date: cb.date, val: cb.val, file: T2.file ? T2.file.name : '' } : { err: r.reason };
}

/* 把这批解析出的流水明细存给 T1（余额下钻「看每一笔」用）。
   同一份文件换绑了账户 → 上一次是写错账户，把那几天撤掉——跟余额回写同一个纪律；
   不同文件之间绝不互删（各自的账户本来就不同）。 */
function t2PushTxns() {
  if (typeof t1PutTxns !== 'function' || !T2.acctId || !T2.result) return;
  if (!T2.file || T2.result.file !== T2.file.name) return;   // result 是上一个文件的，别写
  const prev = T2.txnPush;
  if (prev && prev.accId && prev.accId !== T2.acctId && prev.file === T2.file.name
    && typeof t1DelTxns === 'function') {
    t1DelTxns(prev.accId, prev.dates, prev.file);
  }
  const map = T2.map;
  // 余额列不能用 cellHasAmt 判（它把 0 当「不是钱」）：余额恰好为 0 是合法值，得存
  const balOf = r => {
    if (map.bal === undefined || !r.raw) return null;
    const s = String(r.raw[map.bal] == null ? '' : r.raw[map.bal]).replace(/[,，\s¥￥]/g, '');
    if (s === '' || s === '-' || s === '—' || isNaN(Number(s))) return null;
    return Number(s);
  };
  const recs = T2.result.ok.concat(T2.result.ex)
    .filter(r => r.date && r.amt > 0)   // 没日期/没金额的行（合计行、说明行）进不了按天分桶
    .map(r => ({ date: r.date, memo: r.memo, dir: r.dir, amt: r.amt, opp: r.opp, ref: r.ref, bal: balOf(r) }));
  if (!recs.length) return;
  // 存失败（比如空间不足两次都没救回来）就不记账——否则之后换绑会按这份假账去删别人的数据
  if (!t1PutTxns(T2.acctId, T2.file.name, recs)) return;
  T2.txnPush = { accId: T2.acctId, dates: [...new Set(recs.map(r => r.date))], file: T2.file.name };
}

/* 上传后自动认账户的结果，连同余额有没有写进 T1，一并摊开说 */
function t2AutoBindNote() {
  const ab = T2.autoBind;
  if (!ab) return '';
  if (ab.guess) {
    const p = T2.balPush;
    return `<div class="note w"><b>这份文件里没有本方账号，主体是按文件名「${H(T2.file ? T2.file.name : '')}」猜的：${H(ab.ent)}。</b>
      ${ab.only
        ? `该主体只有一个账户，已选上${p && p.ok ? `，期末余额 ${money(p.val)}（${p.date}）已写入 T1` : ''}。`
        : '该主体下有多个账户，<b>请在下面选一下是哪个</b>——选了余额才会写进 T1。'}
      <b>猜错了在下面改主体</b>，改完余额会重新写。想以后自动认出来，把账号填进 T1 台账。</div>`;
  }
  if (ab.miss) {
    return `<div class="note w"><b>文件里的卡号是 ${H(T2.sniffNo)}，但 T1 台账里没有账号对得上的账户。</b>
      下面手动选一下是哪个账户${T2.acctId ? `，然后 <button class="btn sm" data-act="t2bindNo">把这个卡号记到该账户</button>，下次上传就自动认出来了` : '——选完可以把卡号记进台账，下次就自动了'}。</div>`;
  }
  const p = T2.balPush;
  const bal = !p ? ''
    : p.ok ? `期末余额 ${money(p.val)}（${p.date}）<b>已写入 T1</b>。`
    : p.kept ? `期末余额 ${money(p.val)} 和 T1 里已有的 ${money(p.old)} 对不上，你选了保留原值。`
    : p.skip ? '这份文件没有余额列，T1 余额没动。'
    : '';
  return `<div class="note g"><b>已按文件里的卡号 ${H(T2.sniffNo)} 认出账户：${H(ab.ent)} · ${H(ab.name)}。</b>
    主体也一并定了。${bal} 认错了在下面改，改完余额会重新写。</div>`;
}

function t2Step2() {
  const rows = T2.rows, hr = T2.headRow;
  const header = rows[hr] || [];
  const preview = rows.slice(hr + 1, hr + 4);
  // 带列序号和样值：银行导出常有两列同名（两个「记账金额」），光看列名选不出来是哪个
  const sampleOf = j => {
    const v = preview.map(r => r && r[j]).find(x => String(x == null ? '' : x).trim() !== '' && String(x).trim() !== '-');
    return v === undefined ? '' : ' ＝ ' + String(v).slice(0, 10);
  };
  const opts = i => header.map((h, j) =>
    `<option value="${j}" ${T2.map[i] === j ? 'selected' : ''}>第${j + 1}列 ${H(String(h || '(空)').slice(0, 14))}${H(sampleOf(j))}</option>`).join('');
  const fieldRows = FIELDS.map(f => [
    H(f.n) + (f.must ? ' <span class="red">*</span>' : ''),
    `<select data-map="${f.k}"><option value="">— 不使用 —</option>${opts(f.k)}</select>`,
    T2.map[f.k] !== undefined ? `<span class="mut">${H(String(preview[0] && preview[0][T2.map[f.k]] || '').slice(0, 22))}</span>` : '<span class="mut">—</span>'
  ]);
  const headOpts = rows.slice(0, Math.min(rows.length, 12)).map((r, i) =>
    `<option value="${i}" ${i === hr ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 46))}</option>`).join('');
  const ready = T2.map.date !== undefined && T2.map.memo !== undefined &&
    (T2.map.inAmt !== undefined || T2.map.outAmt !== undefined || T2.map.amt !== undefined);
  return `<div class="frow" style="margin-bottom:13px">
      <span class="fi">✓</span>
      <span><span class="fn">${H(T2.file.name)}</span><br><span class="fm">${rows.length} 行 · ${(T2.file.size / 1024).toFixed(0)} KB</span></span>
      <span class="sp"></span><button class="btn" data-act="t2reset">换个文件</button>
    </div>
    ${cardp('表头在第几行', `<select id="headSel" style="min-width:340px">${headOpts}</select>
      <div class="note" style="margin:11px 0 0">银行流水前几行常是账号、户名等说明文字，工具已自动猜测表头位置。如果猜错了，在上面改。</div>`)}
    ${card('列对应关系', table([{ t: '需要的字段' }, { t: '对应文件里的哪一列' }, { t: '示例值' }], fieldRows))}
    ${T2.map._dcGuess ? `<div class="note w"><b>收入/支出这两列是按数据推断的，请核一眼。</b>
      这份文件里它们的列名一样（分不出谁是谁），所以改用余额的变动方向判断：
      余额变大的那笔钱在第 ${T2.map._dcGuess[0] + 1} 列 → 当成<b>收入</b>，第 ${T2.map._dcGuess[1] + 1} 列 → 当成<b>支出</b>。
      推断错了直接在上面改。</div>` : ''}
    ${t2AutoBindNote()}
    ${cardp('这批流水属于', `
      <div class="cols c2">
        <div><div class="field"><label class="fl">主体 <span class="red">*</span></label>
          <select id="entSel2"><option value="">— 请选择 —</option>${ENTITIES.map(e => `<option value="${e.id}" ${T2.entId === e.id ? 'selected' : ''}>${e.full}${RULE_SETS[e.id] ? '' : '（无规则库）'}</option>`).join('')}</select></div>
          <div class="field"><label class="fl">业务线</label>
          <select id="lineSel"><option value="">— 不指定 —</option>${LINES.map(e => `<option ${T2.line === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
          <div class="field"><label class="fl">默认项目（摘要与户名都认不出时用）</label>
          <select id="defProj"><option value="">— 不设，认不出就进例外 —</option>${PROJECTS().map(p => `<option value="${p.code}" ${T2.defProj === p.code ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div></div>
        <div><div class="field"><label class="fl">收付账户 <span class="red">*</span></label>
          ${t2AcctSelect()}</div>
          <div class="field"><label class="fl">凭证字</label><input type="text" id="vchWord" value="${H(T2.vchWord)}"></div></div>
      </div>`)}
    <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
      <button class="btn pri" data-act="t2run" ${ready ? '' : 'disabled'}>下一步：匹配规则</button>
    </div>
    ${ready ? '' : `<div class="note c" style="margin-top:11px"><b>还不能继续：</b>日期、摘要、以及至少一个金额列（收入/支出，或发生额）必须对应上。</div>`}`;
}

/* 余额回写结果，摊开说清楚写没写、写到哪个账户哪一天 */
function t2BalNote() {
  const p = T2.balPush;
  if (!p) return '';
  const acc = (typeof t1AccById === 'function') ? t1AccById(T2.acctId) : null;
  const who = acc ? `${H(acc.ent)} · ${H(acc.name)}` : T2.acctId;
  if (p.skip) return `<div class="note"><b>T1 余额没动。</b>这份流水里没有余额列（或余额列是空的），工具不会替你估——去 T1 手工录一下 ${who} 的余额。</div>`;
  if (p.err) return `<div class="note c"><b>余额没能写进 T1：</b>${H(p.err)}</div>`;
  if (p.kept) return `<div class="note w"><b>保留了 T1 原来的手工余额。</b>${who} ${p.date}：T1 是 ${money(p.old)}，流水期末是 ${money(p.val)}，差 ${money(p.val - p.old)}。你选了不覆盖——两边现在对不上，建议查一下是漏了一笔还是流水不全。</div>`;
  return `<div class="note g"><b>已回写 T1 当日余额。</b>${who} ${p.date} 期末余额 ${money(p.val)}，在 T1 里标了「来自 T2 流水」。</div>`;
}

function t2Step3() {
  const { ok, ex, total } = T2.result;
  const rate = total ? Math.round(ok.length / total * 100) : 0;
  return kpis([
    { k: '流水总笔数', v: String(total), u: '笔' },
    { k: '已匹配', v: String(ok.length), u: '笔', t: 'g' },
    { k: '例外', v: String(ex.length), u: '笔', t: ex.length ? 'c' : 'g' },
    { k: '匹配率', v: String(rate), u: '%', t: rate >= 90 ? 'g' : rate >= 70 ? 'w' : 'c' },
    { k: '收入合计', v: money(ok.filter(r => r.dir === 'in').reduce((s, r) => s + r.amt, 0)) },
    { k: '支出合计', v: money(ok.filter(r => r.dir === 'out').reduce((s, r) => s + r.amt, 0)) },
  ])
    + (ex.length ? `<div class="note w"><b>有 ${ex.length} 笔没匹配上。</b>工具不会替你猜科目——下一步逐条处理，处理完还能存成规则，下次就自动了。</div>`
      : `<div class="note g"><b>全部匹配成功。</b>可以直接进入导出。</div>`)
    + t2BalNote()
    + `<div class="tabs">
        <button data-tab="ok" class="${T2.tab === 'ok' ? 'on' : ''}">已匹配<span class="cnt">${ok.length}</span></button>
        <button data-tab="ex" class="${T2.tab === 'ex' ? 'on' : ''}">例外<span class="cnt">${ex.length}</span></button>
      </div>`
    + card('', T2.tab === 'ok' ? okTable(ok) : exTable(ex))
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        ${ex.length ? `<button class="btn" data-act="t2ex">处理例外（${ex.length}）</button>` : ''}
        <button class="btn pri" data-act="t2export">下一步：导出凭证</button>
      </div>`;
}

function okTable(ok) {
  return table(
    [{ t: '#' }, { t: '日期' }, { t: '摘要' }, { t: '对方户名' }, { t: '方向' }, { t: '金额', n: 1 }, { t: '匹配科目' }, { t: '匹配依据' }, { t: '凭证摘要' }, { t: '提示' }],
    ok.slice(0, 300).map(r => [
      r.no, r.date, H(r.memo.slice(0, 26)), H(r.opp.slice(0, 16)),
      r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'),
      money(r.amt), `<span class="code">${r.acct}</span> ${H(acctName(r.acct))}`,
      r.hitField ? `<span class="mut" style="font-size:11px">${H(r.hitField)}</span>` : '<span class="mut">人工指定</span>',
      H(r.vmemo),
      r.warn ? pill(r.warn, 'cr') : ''
    ]));
}
function exTable(ex) {
  return table(
    [{ t: '#' }, { t: '日期' }, { t: '摘要' }, { t: '对方户名' }, { t: '方向' }, { t: '金额', n: 1 }, { t: '原因' }],
    ex.slice(0, 300).map(r => [
      r.no, r.date || '<span class="red">缺失</span>', H(r.memo.slice(0, 30)), H(r.opp.slice(0, 16)),
      r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'),
      r.amt ? money(r.amt) : '<span class="red">0</span>', `<span class="red">${H(r.why)}</span>`
    ]));
}

function t2Step4() {
  const ex = T2.result.ex;
  const acctOpts = ACCOUNTS().map(a => `<option value="${a[0]}">${a[0]} ${a[1]}</option>`).join('');
  const rows = ex.map((r, i) => [
    r.no, r.date || '<span class="red">缺失</span>', H(r.memo.slice(0, 28)), H(r.opp.slice(0, 14)),
    r.dir === 'in' ? pill('收', 'ok') : pill('付', 'wa'), money(r.amt),
    `<span style="display:flex;gap:4px;align-items:center">
       <select data-fix="${i}"><option value="">— 跳过 —</option>${acctOpts}</select>
       <button class="btn sm" data-act="addAcct" title="新增科目">+</button></span>`,
    `<select data-save="${i}" style="min-width:120px">
       <option value="">不存规则</option>
       <option value="memo"${r.memo ? '' : ' disabled'}>按摘要「${H(r.memo.slice(0, 6))}」</option>
       <option value="opp"${r.opp ? '' : ' disabled'}>按户名「${H(r.opp.slice(0, 8))}」</option>
     </select>`
  ]);
  return `<div class="note"><b>逐条指定科目。</b>勾选「存为规则」的，会把该笔<b>摘要的前 4 个字</b>加进规则库，下次自动匹配。不确定的留「跳过」，这些笔不会进凭证文件，会单独导出成清单。</div>`
    + card(`例外清单（${ex.length} 笔）`, table(
      [{ t: '#' }, { t: '日期' }, { t: '摘要' }, { t: '对方户名' }, { t: '方向' }, { t: '金额', n: 1 }, { t: '指定科目' }, { t: '' }], rows))
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        <button class="btn" data-act="t2back3">返回</button>
        <button class="btn pri" data-act="t2applyfix">应用并继续</button>
      </div>`;
}

function t2Step5() {
  const { ok, ex } = T2.result;
  const L = voucherLines();
  const dr = L.reduce((s, l) => s + l.dr, 0);
  const cr = L.reduce((s, l) => s + l.cr, 0);
  const bal = Math.abs(dr - cr) < 0.005;
  // 科目代码没拆干净（项目没填上）的行，导进金蝶必报错，先拦下来
  const badAcct = L.filter(l => /_/.test(l.acctFull) && !l.proj);
  // 金蝶里还要供应商/客户/职员的科目，本工具填不出，导入前要人工补一列
  const auxRows = L.filter(l => l.auxNeed);
  const auxKinds = [...new Set(auxRows.map(l => l.acct + ' ' + l.acctName + '（缺' + l.auxNeed + '）'))];
  const ready = bal && !badAcct.length;
  return kpis([
    { k: '生成凭证', v: String(ok.length), u: '张' },
    { k: '凭证行数', v: String(L.length), u: '行' },
    { k: '借方合计', v: money(dr) },
    { k: '贷方合计', v: money(cr) },
    { k: '借贷平衡', v: bal ? '✓' : '✗', t: bal ? 'g' : 'c' },
    { k: '未处理例外', v: String(ex.length), u: '笔', t: ex.length ? 'w' : 'g' },
  ])
    + (bal ? `<div class="note g"><b>借贷平衡，可以导出。</b>导入金蝶后请复核科目与项目，确认无误再过账。</div>`
      : `<div class="note c"><b>借贷不平衡，请勿导入。</b>请返回检查金额列是否对应正确。</div>`)
    + (badAcct.length ? `<div class="note c"><b>有 ${badAcct.length} 行科目缺项目编码</b>（${H(badAcct.slice(0, 3).map(l => l.acctFull).join('、'))}），
        金蝶会拒收。请返回例外处理，给这些笔指定项目。</div>` : '')
    + (auxRows.length ? `<div class="note w"><b>${auxRows.length} 行还要人工补辅助核算：</b>${H(auxKinds.join('；'))}。
        本工具只认得出项目，客户/供应商/职员这几列留空，导入前请在 Excel 里补上编码。</div>` : '')
    + `<div class="cols c2">
      ${cardp('金蝶凭证导入文件', `<div style="font-size:12.5px;line-height:1.8">
        ${ok.length} 张凭证 / ${L.length} 行 · <b>.xlsx</b><br>
        <span class="mut">25 列金蝶模版：日期·凭证字·凭证号·附件数·分录序号·摘要·科目代码·科目名称·借贷方金额·客户·供应商·职员·项目·部门·存货·自定义辅助核算×2·数量·单价·原币金额·币别·汇率</span><br>
        <span class="mut">科目代码只写主科目，项目按<b>编码</b>填「项目」列（如 1001 花都UU公寓）</span></div>
        <button class="btn pri" style="margin-top:11px" data-act="dlKingdee" ${ready ? '' : 'disabled'}>下载金蝶凭证 xlsx</button>
        <button class="btn" style="margin-top:11px" data-act="dlVoucher" ${bal ? '' : 'disabled'}>凭证明细 CSV（留痕用）</button>
        <button class="btn pri" style="margin-top:11px" data-act="toLedger" ${bal ? '' : 'disabled'}>入凭证库</button>`)}
      ${cardp('例外清单', ex.length ? `<div style="font-size:12.5px;line-height:1.8">
        ${ex.length} 笔未能自动匹配<br><span class="mut">这些笔不在凭证文件里，需人工在账务系统单独处理</span></div>
        <button class="btn" style="margin-top:11px" data-act="dlEx">下载例外清单 CSV</button>`
      : `<div style="font-size:12.5px;color:var(--good)">没有例外，全部已匹配。</div>`)}
    </div>`
    + card('凭证预览（前 30 行 · 与导出文件同口径）', table(
      [{ t: '日期' }, { t: '凭证字号' }, { t: '分录' }, { t: '摘要' }, { t: '科目代码' }, { t: '科目名称' },
       { t: '借方', n: 1 }, { t: '贷方', n: 1 }, { t: '项目' }],
      L.slice(0, 30).map(l => [l.date, l.word + '-' + l.no, l.seq, H(l.memo),
        `<span class="code">${H(l.acct)}</span>`, H(l.acctName),
        l.dr ? money(l.dr) : '', l.cr ? money(l.cr) : '',
        l.proj ? `<span class="code">${H(l.proj)}</span> ${H(l.projName)}` : ''])));
}

/* ============ 二期占位 ============ */
const PHASE2 = {
  'p-fund-daily': ['资金日报', 'M2', '47 个账户余额自动归集，红线预警，日报自动推送'],
  'p-fund-account': ['账户与U盾', 'M2', '账户台账、U 盾领用登记、持盾人与知密人分权'],
  'p-fund-recon': ['流水与对账', 'M2', '银企互联取流水、自动勾对、差异标红'],
  'p-pay': ['付款申请', 'M4', '钉钉电子流、权限自动路由、三单匹配'],
  'p-ar-contract': ['合同台账', 'M3', '对接智慧园区系统自动同步'],
  'p-ar-bill': ['应收账单', 'M3', '合同驱动按月自动生成应收'],
  'p-ar-claim': ['收款认领', 'M3', '流水按规则自动匹配应收'],
  'p-ar-aging': ['账龄与催收', 'M3', '四级逾期分级预警'],
  'p-exp': ['报销与费控', 'M4', '预算前置管控、备用金超期拦截'],
  'p-flow': ['审批路由', 'M4', '权限表内置自动路由'],
  'p-stock': ['进销存台账', 'M11', '加权平均法、期初只读自动推算'],
  'p-count': ['月末盘点', 'M11', '差异强制归因与处理动作'],
  'p-close': ['月结检查单', 'M5', '24 项清单自动跑、强校验阻断'],
  'p-tax-cal': ['申报日历', 'M6', '征期前 3 工作日红线预警'],
  'p-daily': ['日损益', 'M7', '平台数据自动抓取算毛利'],
  'p-project': ['项目盈利', 'M7', '项目/合同级盈利与成本分摊'],
  'p-entity': ['主体档案', 'M0', '多主体统一登记'],
  'p-match': ['跨系统对码', 'M0', '销售端与采购端主数据映射'],
  'p-perm': ['用户与权限', '权限', '功能权限 + 数据权限 + 操作权限三维'],
};
function phase2(id) {
  const [n, m, d] = PHASE2[id] || ['该功能', '—', ''];
  return head(n, d, m)
    + `<div class="soonbox">
      <div class="si">⏱</div>
      <h3>${H(n)} · 二期开发</h3>
      <p>${H(d)}。本模块属方案中的 <b>${H(m)}</b>，一期不开发。</p>
      <p style="margin-top:9px">一期先把<b>工具箱</b>跑通——用小工具直接节省时间，等规则在真账上养熟了，再接入正式模块。</p>
      <span class="tag">对应模块 ${H(m)} · 二期起逐个开发</span>
    </div>`;
}

/* ============ 路由 ============ */
let CURD = 'home', CURS = 'home';
/* 年月格式化。不能用 toISOString().slice(0,7) —— 它按 UTC 算，
   东八区每月 1 号早上 8 点前会算成上个月。 */
const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

/* 期间 = 日期区间（年月日 〜 年月日）。系统只做 2026 年以后的账，
   以前的不用（负责人拍板），所以下限钉死。 */
const RANGE_MIN = '2026-01-01';
/* 页内与顶栏共用同一个 AC.from/AC.to —— 改哪边都一样 */
function acRangeHtml(pfx) {
  if (typeof AC === 'undefined') return '';
  return `<input type="date" id="${pfx}From" class="perin" value="${AC.from}" min="${RANGE_MIN}">`
    + ` 〜 <input type="date" id="${pfx}To" class="perin" value="${AC.to}" min="${RANGE_MIN}">`;
}
/* 期间只在核算模块起作用（账簿按区间取数），别的模块藏起来，
   免得摆一个点了没反应的控件。 */
function renderPerBar() {
  const bar = $('perBar'), box = $('perRange');
  if (!bar || !box) return;
  const on = (CURD === 'close' || CURD === 'report' || CURD === 'analysis') && typeof AC !== 'undefined';
  bar.style.display = on ? '' : 'none';
  if (on) box.innerHTML = acRangeHtml('per');
}
/* 改区间的一端。k = 'from' | 'to'。起点晚于终点时把另一端拖齐，不无声吞掉 */
function setRange(k, v) {
  if (typeof AC === 'undefined' || !v) return;
  if (v < RANGE_MIN) { toast('系统只做 2026 年以后的账'); v = RANGE_MIN; }
  AC[k] = v;
  if (AC.to < AC.from) AC[k === 'from' ? 'to' : 'from'] = v;
  try { localStorage.setItem('fsc_ac_range', AC.from + '~' + AC.to); } catch (e) { /* 忽略 */ }
  go(CURS);
}

/* 主体组合框：敲字模糊筛 + 点 ▾ 出全量下拉，两种用法都行。
   filter 传 null 表示非搜索状态——把输入框恢复成当前主体名。 */
function renderEntBar(filter) {
  const inp = $('entSel'), list = $('entList'); if (!inp || !list) return;
  const t = String(filter == null ? '' : filter).trim();
  const items = ENTITIES.filter(e => !t || e.full.includes(t));
  list.innerHTML = (items.length ? items.map(e =>
    `<div class="ci ${e.id === CUR_ENT ? 'on' : ''}" data-entpick="${e.id}">${H(e.full)}${loadRSet(e.id) ? '' : ' <span class="cimut">无规则</span>'}</div>`).join('')
    : '<div class="ci cimut">没有匹配的主体</div>');
  if (filter == null && document.activeElement !== inp) {
    const cur = ENTITIES.find(e => e.id === CUR_ENT);
    inp.value = cur ? cur.full : '';
  }
}
function pickEnt(id) {
  useRuleSet(id);
  const ei = ENTITIES.find(x => x.id === id);
  T2.entId = id || ''; T2.ent = ei ? ei.full : ''; T2.defProj = '';
  const l = $('entList'); if (l) l.style.display = 'none';
  // 输入框可能还处于聚焦搜索态，强制回填选中的全称，别留半截搜索词
  const inp = $('entSel');
  if (inp) { inp.value = ei ? ei.full : ''; inp.blur(); }
  renderEntBar();
  go(CURS);
}
/* 把用户敲的字解析成主体：先全等，再子串。命中多个不猜，让用户再补几个字 */
function resolveEnt(txt) {
  const t = String(txt || '').trim();
  if (!t) return { empty: 1 };
  const exact = ENTITIES.find(e => e.full === t);
  if (exact) return { hit: exact };
  const hits = ENTITIES.filter(e => e.full.includes(t));
  if (hits.length === 1) return { hit: hits[0] };
  return hits.length ? { multi: hits.length } : { none: 1 };
}
function renderNav() {
  $('domNav').innerHTML = DOMS.map(d =>
    `<button data-d="${d.id}" class="${d.id === CURD ? 'on' : ''}">
      <span class="ic">${d.ic}</span>${d.n}${d.ready ? '' : '<span class="p2">二期</span>'}</button>`).join('');
  const d = DOMS.find(x => x.id === CURD);
  renderPerBar();
  $('subNav').innerHTML = (d && d.items.length)
    ? d.items.map(it => it.length === 1
        ? `<span class="navgp">${H(it[0].slice(2))}</span>`
        : `<button data-s="${it[0]}" class="${it[0] === CURS ? 'on' : ''}">${it[1]}</button>`).join('')
    : `<button class="on">${d ? d.n : ''}</button>`;
}
function go(id) {
  if (/^t[1234]($|-)/.test(id) || id.startsWith('tool-')) CURD = 'tools';
  else if (id.startsWith('ac-')) CURD = 'close';
  else if (id.startsWith('rp-') || id.startsWith('cs-')) CURD = 'report';
  else if (id.startsWith('iv-')) CURD = 'inv';
  else if (id.startsWith('bs-')) CURD = 'base';
  else if (id.startsWith('fd-')) CURD = 'fund';
  else {
    const d = DOMS.find(x => x.items.some(i => i.length > 1 && i[0] === id) || x.id === id);
    if (d) CURD = d.id;
  }
  CURS = id;
  const view = $('view');
  if (S[id]) view.innerHTML = S[id]();
  else if (PHASE2[id]) view.innerHTML = phase2(id);
  else view.innerHTML = S['home']();
  renderNav();
  renderEntBar();
  bindDynamic();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ============ 事件 ============ */
async function loadFile(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    // 换了新文件，上一批的回写记录就作废——否则「处理完账户 A 的文件、再传账户 B 的文件」
    // 会被当成「写错了账户」，把 A 上那批正确的余额和明细误删掉
    T2.balPush = null; T2.txnPush = null;
    T2.file = file; T2.rows = rows;
    T2.headRow = XLSXLite.findHeaderRow(rows, ALL_ALIAS);
    T2.map = autoMap(rows[T2.headRow] || [], rows.slice(T2.headRow + 1));
    t2AutoBind();          // 认出账户就当场把余额写进 T1，上传完 T1 里立刻能看到
    T2.step = 2;
    go('t2');
    const got = Object.keys(T2.map).length;
    const ab = T2.autoBind;
    toast(ab && ab.accId
      ? `读到 ${rows.length} 行 · 已认出账户「${ab.ent} · ${ab.name}」`
      + (T2.balPush && T2.balPush.ok ? `，余额已写入 T1` : '')
      : `读到 ${rows.length} 行，自动识别 ${got} 个字段`, 4200);
  } catch (e) {
    toast('读取失败：' + e.message, 4200);
  }
}

function bindDynamic() {
  const drop = $('drop');
  if (drop) {
    drop.onclick = () => $('filePick').click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('hot'); };
    drop.ondragleave = () => drop.classList.remove('hot');
    drop.ondrop = e => {
      e.preventDefault(); drop.classList.remove('hot');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    };
  }
  const hs = $('headSel');
  if (hs) hs.onchange = () => {
    T2.headRow = +hs.value;
    T2.map = autoMap(T2.rows[T2.headRow] || [], T2.rows.slice(T2.headRow + 1));
    go('t2');
  };
  document.querySelectorAll('[data-map]').forEach(sel => {
    sel.onchange = () => {
      const k = sel.dataset.map;
      if (sel.value === '') delete T2.map[k]; else T2.map[k] = +sel.value;
      go('t2');
    };
  });
  // 收付账户：选的是 T1 账户 id，账号文本从台账带出来，不让用户重复手填
  const accSel = $('acctSel');
  if (accSel) accSel.onchange = () => {
    t2SetAcct(accSel.value);
    if (T2.acctId) { t2PushBalance(); t2PushTxns(); }   // 换了账户，余额和流水明细都得搬到新账户上
    go('t2');
  };
  ['entSel2:ent', 'lineSel:line', 'vchWord:vchWord', 'defProj:defProj'].forEach(p => {
    const [id, key] = p.split(':');
    const el = $(id);
    if (el) el.onchange = () => {
      if (id === 'entSel2') {
        T2.entId = el.value;
        const ei = ENTITIES.find(x => x.id === T2.entId);
        T2.ent = ei ? ei.full : '';
        useRuleSet(T2.entId); T2.defProj = defaultProjOf();
        t2SetAcct('');   // 账户按主体分，换主体原来选的账户就不成立了
        T2.balPush = null; T2.autoBind = null;
        go('t2');
      } else T2[key] = el.value;
    };
  });
}

document.addEventListener('click', e => {
  const d = e.target.closest('[data-d]');
  if (d) { const dom = DOMS.find(x => x.id === d.dataset.d); const f = dom.items.find(i => i.length > 1); go(f ? f[0] : dom.id); return; }
  const s = e.target.closest('[data-s]');
  if (s) { go(s.dataset.s); return; }
  const g = e.target.closest('[data-go]');
  if (g) { go(g.dataset.go); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { T2.tab = tb.dataset.tab; go('t2'); return; }
  const da = e.target.closest('[data-delacct]');
  if (da) {
    if (!RS) return;
    RS.accounts.splice(+da.dataset.delacct, 1);
    saveRSet(CUR_ENT, RS); toast('已删除'); go('tool-rules'); return;
  }
  const cf = e.target.closest('[data-copyfrom]');
  if (cf) {
    const src = loadRSet(cf.dataset.copyfrom);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    saveRSet(CUR_ENT, copy);
    saveRules(CUR_ENT, copy.rules.map(r => Object.assign({ id: uid(), hits: 0, src: '复制' }, r)));
    useRuleSet(CUR_ENT);
    toast('已复制，请按本主体实际情况修改'); go('tool-rules'); return;
  }
  const ue = e.target.closest('[data-useent]');
  if (ue) {
    e.preventDefault();
    T2.entId = ue.dataset.useent;
    const ei = ENTITIES.find(x => x.id === T2.entId);
    T2.ent = ei ? ei.full : '';
    useRuleSet(T2.entId); T2.defProj = defaultProjOf(); go('tool-rules'); return;
  }
  const dr = e.target.closest('[data-delrule]');
  if (dr) {
    RULES = RULES.filter(r => r.id !== dr.dataset.delrule); saveRules(T2.entId, RULES);
    toast('规则已删除'); go('tool-rules'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;

  if (act === 't2reset') { Object.assign(T2, { step: 1, rows: null, result: null, file: null, map: {}, balPush: null, txnPush: null, sniffNo: null, autoBind: null, logId: null }); go('t2'); }
  else if (act === 't2run') {
    T2.entId = ($('entSel2') || {}).value || T2.entId;
    const ei = ENTITIES.find(x => x.id === T2.entId);
    T2.ent = ei ? ei.full : '';
    T2.line = ($('lineSel') || {}).value || T2.line;
    t2SetAcct(($('acctSel') || {}).value || T2.acctId);
    T2.vchWord = ($('vchWord') || {}).value || '记';
    T2.defProj = ($('defProj') || {}).value || '';
    if (!T2.entId) { toast('请先选择这批流水属于哪个主体'); return; }
    if (!T2.acctId) { toast('请选择这批流水是哪个账户的——余额要回写到 T1 那个账户上', 4200); return; }
    if (!useRuleSet(T2.entId)) {
      toast('「' + T2.ent + '」还没有规则库，全部会进例外', 4200);
    }
    runRules(); t2PushBalance(); t2PushTxns();
    T2.logId = null; t2Log(0);   // 每跑一次转换新起一条记录，导入即留痕
    T2.step = 3; T2.tab = T2.result.ex.length ? 'ex' : 'ok'; go('t2');
  }
  else if (act === 't2ex') { T2.step = 4; go('t2'); }
  else if (act === 't2back3') { T2.step = 3; go('t2'); }
  else if (act === 't2applyfix') {
    const still = [];
    let fixed = 0, added = 0;
    T2.result.ex.forEach((r, i) => {
      const sel = document.querySelector(`[data-fix="${i}"]`);
      const save = document.querySelector(`[data-save="${i}"]`);
      if (sel && sel.value) {
        // 下拉里选的是科目模版（如 5001_{p}），要把项目编码填进去才是真科目代码。
        // 项目认不出来就仍留在例外，不硬填一个假编码——那样导金蝶必报错。
        const pj = r.proj || detectProj(r.memo) || detectProj(r.opp)
          || PROJECTS().find(p => p.code === T2.defProj);
        if (String(sel.value).includes('{p}') && !pj) {
          r.why = '指定的科目要带项目，但摘要与户名里都认不出是哪个项目';
          still.push(r); return;
        }
        r.proj = pj;
        r.acct = fillAcct(sel.value, pj);
        r.vmemo = r.memo || acctName(r.acct); r.warn = '';
        T2.result.ok.push(r); fixed++;
        // 存为规则：可按摘要，也可按对方户名。
        // 银行流水里「跨行汇款」「网转」这类摘要是交易类型、不含业务含义，
        // 这时只能按对方户名建规则。
        const how = save ? save.value : '';
        if (how) {
          const esc = s => s.replace(/[|\\^$*+?.()[\]{}]/g, '');
          const kw = how === 'opp' ? esc(r.opp).slice(0, 10) : esc(r.memo).slice(0, 4);
          if (kw) {
            RULES.unshift({
              id: uid(), kw, dir: r.dir, acct: sel.value,
              scope: how === 'opp' ? 'both' : undefined,
              memo: (how === 'opp' ? r.opp : r.memo).slice(0, 20),
              hits: 0, src: how === 'opp' ? '例外沉淀·按户名' : '例外沉淀·按摘要',
            });
            added++;
          }
        }
      } else still.push(r);
    });
    T2.result.ok.sort((x, y) => x.no - y.no);
    T2.result.ex = still;
    if (added) saveRules(T2.entId, RULES);
    t2Log(0);   // 例外处理完，记录里的匹配数要跟着变
    toast(`已处理 ${fixed} 笔${added ? `，新增 ${added} 条规则` : ''}`);
    T2.step = 5; go('t2');
  }
  else if (act === 't2bindNo') {
    if (!T2.acctId || !T2.sniffNo) { toast('先选一个账户'); return; }
    if (typeof t1BindAcctNo === 'function' && t1BindAcctNo(T2.acctId, T2.sniffNo)) {
      t2SetAcct(T2.acctId);
      T2.autoBind = { accId: T2.acctId, ent: (t1AccById(T2.acctId) || {}).ent, name: (t1AccById(T2.acctId) || {}).name, no: T2.sniffNo };
      t2PushBalance(); t2PushTxns();
      toast('卡号已记进 T1 台账，下次上传自动认出来', 4200); go('t2');
    } else toast('没能写进台账');
  }
  else if (act === 't2export') { T2.step = 5; go('t2'); }
  else if (act === 'dlKingdee') {
    // 金蝶模版必须是 xlsx：日期要真日期、科目代码要文本，CSV 传上去金蝶不认
    const rows = [KD_HEADER].concat(kingdeeRows());
    const period = (T2.result.ok[0] || {}).date ? T2.result.ok[0].date.slice(0, 7) : new Date().toISOString().slice(0, 7);
    downloadBlob(`凭证导入_${T2.ent}_${period}.xlsx`, XLSXWrite.build([{ name: '凭证模版', rows }]));
    t2Log(1);
    toast('金蝶凭证 xlsx 已下载，处理记录已留痕');
  }
  else if (act === 'dlVoucher') {
    const hdr = ['日期', '凭证字', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额', '主体', '业务线', '项目', '合同号', '对方户名', '流水号', '账号'];
    download(`凭证明细_${T2.ent}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV([hdr].concat(vouchers())));
    t2Log(1);
    toast('凭证明细 CSV 已下载，处理记录已留痕');
  }
  else if (act === 'toLedger') {
    if (!T2.entId) { toast('请先选主体'); return; }
    const n = vchImport(T2.entId, vouchers(), 'T2·' + (T2.file ? T2.file.name : '流水'));
    toast(`已入库 ${n} 张凭证，可在「核算 → 凭证库」查看`, 3600);
  }
  else if (act === 'dlEx') {
    const hdr = ['行号', '日期', '摘要', '对方户名', '方向', '金额', '未匹配原因'];
    const rows = T2.result.ex.map(r => [r.no, r.date, r.memo, r.opp, r.dir === 'in' ? '收' : '付', r.amt, r.why]);
    download(`例外清单_${T2.ent}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV([hdr].concat(rows)));
    toast('例外清单已下载');
  }
  else if (act === 'addAcct') {
    if (!T2.entId) { toast('请先在顶栏选主体'); return; }
    if (!RS) { RS = initRSet(T2.entId); }
    const code = prompt('科目编码（如 560303）'); if (!code) return;
    const name = prompt('科目名称（如 财务费用_手续费）'); if (!name) return;
    RS.accounts.push([code.trim(), name.trim()]);
    saveRSet(T2.entId, RS); toast(`已加科目 ${code} ${name}`); go('t2');
  }
  else if (act === 'exportRules') {
    const hdr = ['关键词', '方向', '科目编码', '科目名称', '凭证摘要', '命中次数', '来源'];
    download('T2规则库.csv', toCSV([hdr].concat(RULES.map(r => [r.kw, r.dir, r.acct, acctName(r.acct), r.memo || '', r.hits || 0, r.src || '自建']))));
    toast('规则库已导出');
  }
  else if (act === 'addRule') {
    const kw = prompt('关键词（支持正则，用 | 分隔多个）'); if (!kw) return;
    const acct = prompt('科目编码\n可选：' + ACCOUNTS().slice(0, 8).map(a => a[0]).join(' / ')); if (!acct) return;
    if (!ACCOUNTS().some(x => x[0] === acct)) { toast('科目编码不存在：' + acct); return; }
    const dir = (prompt('方向：in=收入 / out=支出 / any=不限', 'out') || 'out').trim();
    RULES.unshift({ id: uid(), kw, dir, acct, memo: '', hits: 0, src: '手工新增' });
    saveRules(T2.entId, RULES); toast('规则已新增'); go('tool-rules');
  }
  else if (act === 'clearLog') {
    if (confirm('确认清空全部处理记录？')) { saveLog([]); toast('已清空'); go('tool-log'); }
  }
});

/* 主体组合框事件：聚焦/敲字出筛选列表，点 ▾ 出全量，点选项即切换，
   回车按模糊解析走（命中多个不猜）。用 mousedown 选项，抢在 blur 之前。 */
(() => {
  const inp = $('entSel'), list = $('entList'), btn = $('entBtn');
  const show = f => { renderEntBar(f); list.style.display = 'block'; };
  const hide = () => { list.style.display = 'none'; };
  inp.addEventListener('focus', () => show(''));
  inp.addEventListener('input', () => show(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const r = resolveEnt(inp.value);
      if (r.empty) { pickEnt(''); inp.blur(); }
      else if (r.multi) toast(`「${inp.value.trim()}」匹配到 ${r.multi} 个主体，再多打几个字，或从下拉里点选`);
      else if (r.none) toast('没找到这个主体，点 ▾ 看全部');
      else { pickEnt(r.hit.id); inp.blur(); }
    } else if (e.key === 'Escape') { hide(); inp.blur(); renderEntBar(); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { hide(); renderEntBar(); }, 120));
  btn.addEventListener('click', () => {
    if (list.style.display === 'block') hide();
    else { inp.focus(); inp.select(); show(''); }
  });
  document.addEventListener('mousedown', e => {
    const it = e.target.closest('[data-entpick]');
    if (it) { e.preventDefault(); pickEnt(it.dataset.entpick); }
  });
})();
document.addEventListener('change', e => {
  if (e.target.id === 'perFrom' || e.target.id === 'acFrom') setRange('from', e.target.value);
  else if (e.target.id === 'perTo' || e.target.id === 'acTo') setRange('to', e.target.value);
});
$('filePick').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });
$('themeBtn').addEventListener('click', () => {
  const r = document.documentElement, cur = r.getAttribute('data-theme');
  const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
  r.setAttribute('data-theme', (cur || (sys ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark');
});
/* 返回星逸平台工作台。
   优先用 URL 上的 ?from= （门户跳转时带过来），否则回退到本地门户地址。 */
const PORTAL_FALLBACK = 'http://localhost:5173/apps';
function portalUrl() {
  try {
    const from = new URLSearchParams(location.search).get('from');
    if (from) {
      const u = new URL(from, location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    }
  } catch (e) { /* 忽略非法参数 */ }
  return PORTAL_FALLBACK;
}
$('backPortal').addEventListener('click', e => {
  e.preventDefault();
  location.href = portalUrl();
});

/* 启动 */
try { useRuleSet(localStorage.getItem('fsc_cur_ent') || ''); } catch (e) { /* 忽略 */ }
if (CUR_ENT) { const ei = ENTITIES.find(x => x.id === CUR_ENT); T2.entId = CUR_ENT; T2.ent = ei ? ei.full : ''; }
go('home');
