/* 票据与纳税申报：进项票/销项票导入 + 无票收入 → 增值税申报表
   → 所得税预缴申报表 → 印花税申报表 → 文化事业建设费 → 个税勾稽 → 残保金。
   口径要点（都在界面上明说，不藏）：
   - 每个主体有税务档案：小规模纳税人（征收率 1%/3%/5%）或一般纳税人（税率 13%/9%/6%）
   - 小规模月销售额 ≤10 万免征增值税；六税两费减半——按 2026 年现行政策预置，可关
   - 申报表按税局样式列行次，但它是「草稿」：以电子税务局最终生成的为准
   口径来源（2026-08-29 批）：除增值税两张外，又学了 7 张真实税表——
   - 残保金 2024 澳乐真表：分档减免（≥1% 减50% / <1% 减10% / ≤30人全免）、
     平均工资有「社平 2 倍」封顶、人数按年平均可带小数
   - 企税 A000000 澳乐 2025：小微三条件（所得≤300万+人数≤300+资产≤5000万），
     澳乐资产均值 7,718 万 → 非小微按 25%
   - 财行税 星逸 2025Q3：印花税实际走「财产和行为税合并申报」按季，零申报也报
   - 文化事业建设费 星逸 2026-07：广告业按月 3%，零申报也报
   - 车购税 澳乐 2025-03：一次性税种，新能源免税有每辆上限（2025 封顶 3 万）
   - 财报报送 星逸 2025Q3：会小企 01/02 按季随申报报送，也是申报义务
   - 个税明细 澳乐 2026-01~07：扣缴端逐人月报，是账上工资基数勾稽的另一头 */
'use strict';

/* ============ 存储 ============ */
const IV_IN_KEY = e => 'fsc_iv_in_' + e + '_v1';       // 进项票
const IV_OUT_KEY = e => 'fsc_iv_out_' + e + '_v1';     // 销项票
const IV_NOINV_KEY = e => 'fsc_iv_noinv_' + e + '_v1'; // 无票收入
const IV_PROF_KEY = e => 'fsc_iv_prof_' + e + '_v1';   // 税务档案
const IV_ADJ_KEY = (e, m) => 'fsc_iv_adj_' + e + '_' + m + '_v1'; // 各期手工数（留抵等）

function ivLoad(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
function ivSave(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } }
function ivProf() {
  try { const p = JSON.parse(localStorage.getItem(IV_PROF_KEY(CUR_ENT)) || 'null'); if (p) return p; } catch (e) { /* 忽略 */ }
  // 默认小规模 1%——集团各主体现行做法（优栖租金按 1% 拆税），改了当场生效
  // biz: 销售额放哪一栏（goods=货物及劳务 / estate=服务不动产）；cjRate: 城建税率（市区7%/县镇5%/其他1%）
  return { type: 'small', rate: 0.01, halve: 1, biz: 'goods', cjRate: 0.07 };
}
function ivProfSave(p) { try { localStorage.setItem(IV_PROF_KEY(CUR_ENT), JSON.stringify(p)); } catch (e) { /* 忽略 */ } }
function ivAdj(m) { try { return JSON.parse(localStorage.getItem(IV_ADJ_KEY(CUR_ENT, m)) || '{}'); } catch (e) { return {}; } }
function ivAdjSave(m, v) { try { localStorage.setItem(IV_ADJ_KEY(CUR_ENT, m), JSON.stringify(v)); } catch (e) { /* 忽略 */ } }

/* 当前申报期间（月），默认上月——申报的都是上个月的事 */
const IV = { month: (() => { const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth() - 1, 1); return ym(t); })() };
const ivQuarterOf = m => { const q = Math.floor((+m.slice(5, 7) - 1) / 3); return { y: m.slice(0, 4), q: q + 1, from: m.slice(0, 4) + '-' + String(q * 3 + 1).padStart(2, '0'), to: m.slice(0, 4) + '-' + String(q * 3 + 3).padStart(2, '0') }; };

/* ============ 发票导入 ============ */
/* 税务局/开票软件导出的表，列名各家不一。必备四列：号码/日期/金额/税额。 */
const IV_ALIAS = {
  no:   ['数电票号码', '发票号码', '全电发票号码', '号码'],
  code: ['发票代码'],
  date: ['开票日期', '日期'],
  who:  ['销售方名称', '销方名称', '销方', '购买方名称', '购方名称', '购方', '对方名称'],
  amt:  ['不含税金额', '合计金额', '金额'],
  tax:  ['合计税额', '税额'],
  total: ['价税合计', '含税金额'],
  state: ['发票状态', '状态'],
  kind: ['发票类型', '票种'],
};
function ivMap(header) {
  const cells = header.map(h => String(h == null ? '' : h).replace(/\s/g, ''));
  const map = {}, used = new Set();
  [1, 0].forEach(exact => Object.keys(IV_ALIAS).forEach(k => {
    if (map[k] !== undefined) return;
    for (const a of IV_ALIAS[k]) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && (exact ? c === a : c.includes(a)));
      if (i >= 0) { map[k] = i; used.add(i); return; }
    }
  }));
  return map;
}
async function ivImport(file, dir) {  // dir: 'in' | 'out'
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, Object.values(IV_ALIAS).flat());
    const map = ivMap(rows[hr] || []);
    const miss = ['no', 'date', 'amt', 'tax'].filter(k => map[k] === undefined);
    if (miss.length) {
      toast('缺少必备列：' + miss.map(k => ({ no: '发票号码', date: '开票日期', amt: '金额', tax: '税额' }[k])).join('、') + '。请用税务局或开票软件的明细导出。', 5200);
      return;
    }
    const key = dir === 'in' ? IV_IN_KEY(CUR_ENT) : IV_OUT_KEY(CUR_ENT);
    const list = ivLoad(key);
    const seen = new Set(list.map(x => x.no));
    let add = 0, dup = 0, bad = 0, voided = 0;
    rows.slice(hr + 1).forEach(r => {
      const g = k => (map[k] === undefined ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim());
      const no = g('no'); const date = normDate(g('date'));
      const amt = numOf(g('amt')), tax = numOf(g('tax'));
      if (!no || !date) { if (r.some(c => String(c == null ? '' : c).trim())) bad++; return; }
      if (seen.has(no)) { dup++; return; }
      const state = g('state');
      if (/作废/.test(state)) { voided++; return; }   // 作废票不进池；红冲票金额本身是负数，正常进
      seen.add(no);
      list.push({ no, code: g('code'), date, month: date.slice(0, 7), who: g('who'),
        amt, tax, total: numOf(g('total')) || +(amt + tax).toFixed(2),
        state: state || '正常', kind: g('kind'), src: file.name });
      add++;
    });
    ivSave(key, list);
    toast(`导入完成：新增 ${add} 张` + (dup ? `、重号跳过 ${dup}` : '') + (voided ? `、作废票剔除 ${voided}` : '') + (bad ? `、缺号码/日期跳过 ${bad}` : ''), 5200);
    go(dir === 'in' ? 'iv-in' : 'iv-out');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}

/* ============ 票池界面（进项/销项共用一套渲染） ============ */
function ivPool(dir) {
  const isIn = dir === 'in';
  const title = isIn ? '进项票' : '销项票';
  if (!CUR_ENT) return needEnt(title);
  const list = ivLoad(isIn ? IV_IN_KEY(CUR_ENT) : IV_OUT_KEY(CUR_ENT));
  const cur = list.filter(x => x.month === IV.month);
  const amt = cur.reduce((s, x) => s + x.amt, 0), tax = cur.reduce((s, x) => s + x.tax, 0);
  const red = cur.filter(x => x.amt < 0).length;
  const rows = cur.slice(0, 300).map(x => [
    x.date, `<span class="code">${H(x.no.slice(-12))}</span>`, H(x.who || '—'),
    money(x.amt), money(x.tax), money(x.total),
    x.amt < 0 ? pill('红冲', 'cr') : pill(x.state, 'ok'),
    `<button class="btn sm" data-ivdel="${dir}:${H(x.no)}">删除</button>`,
  ]);
  return head(title, `${H(entName())} · ${isIn ? '供应商开给我们的票（抵扣/入成本用）' : '我们开出去的票（算销售额用）'}。同号自动查重，作废票剔除，红冲负数原样进池。`, '纳税申报 · ' + IV.month,
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn pri" data-act="ivUp${isIn ? 'In' : 'Out'}">导入${title}</button>`)
    + kpis([
      { k: '本月张数', v: String(cur.length), u: '张' },
      { k: '不含税金额', v: money(amt) },
      { k: '税额', v: money(tax) },
      { k: '价税合计', v: money(amt + tax) },
      { k: '红冲票', v: String(red), u: '张', t: red ? 'w' : 'g' },
      { k: '累计在池', v: String(list.length), u: '张' },
    ])
    + (cur.length ? '' : `<div class="note"><b>本月还没有${title}。</b>从电子税务局（发票查询统计 → 全量发票明细导出）或开票软件导出明细表，点右上角导入。必备列：发票号码、开票日期、金额、税额。</div>`)
    + card(`${IV.month} ${title}明细`, rows.length ? table(
      [{ t: '开票日期' }, { t: '发票号码（后12位）' }, { t: isIn ? '销售方' : '购买方' }, { t: '不含税金额', n: 1 }, { t: '税额', n: 1 }, { t: '价税合计', n: 1 }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">本月没有${title}</div>`);
}
S['iv-in'] = () => ivPool('in');
S['iv-out'] = () => ivPool('out');

/* ============ 无票收入 ============ */
S['iv-noinv'] = () => {
  if (!CUR_ENT) return needEnt('无票收入');
  const p = ivProf();
  const list = ivLoad(IV_NOINV_KEY(CUR_ENT));
  const cur = list.filter(x => x.month === IV.month);
  const net = cur.reduce((s, x) => s + x.net, 0), tax = cur.reduce((s, x) => s + x.tax, 0);
  const rows = cur.map(x => [
    x.date, H(x.memo || '—'), money(x.gross), (x.rate * 100).toFixed(0) + '%',
    money(x.net), money(x.tax),
    `<button class="btn sm" data-ivdel="noinv:${H(x.id)}">删除</button>`,
  ]);
  return head('无票收入', `${H(entName())} · 收了钱没开票的收入也要申报。录含税金额，按征收率自动拆不含税与税额，进增值税申报表「未开具发票」列。`, '纳税申报 · ' + IV.month,
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn pri" data-act="ivDyUp">导入抖音资金账单</button>`)
    + kpis([
      { k: '本月笔数', v: String(cur.length), u: '笔' },
      { k: '不含税收入', v: money(net) },
      { k: '税额', v: money(tax) },
    ])
    + `<div class="note"><b>抖音账单导入口径：</b>吃抖店「资金账单」明细表——只取「入账」方向且场景含
      「结算入账」的（货款结算/福袋业务结算），按月按场景归并成无票收入；提现、保险、运费险不是收入，自动跳过。
      同一份文件重复导入是覆盖不是叠加。</div>`
    + cardp('新增一笔', `<div class="cols c4">
        <div class="field"><label class="fl">日期</label><input type="date" id="nvDate" value="${IV.month}-15" min="2026-01-01"></div>
        <div class="field"><label class="fl">含税金额</label><input type="number" step="0.01" id="nvGross" placeholder="0.00"></div>
        <div class="field"><label class="fl">征收率/税率</label><select id="nvRate">
          ${[0.01, 0.03, 0.05, 0.06, 0.09, 0.13].map(r => `<option value="${r}" ${Math.abs(r - p.rate) < 1e-9 ? 'selected' : ''}>${(r * 100).toFixed(0)}%</option>`).join('')}</select></div>
        <div class="field"><label class="fl">备注</label><input type="text" id="nvMemo" placeholder="如：个人租客现金租金"></div>
      </div>
      <div style="text-align:right;margin-top:8px"><button class="btn pri" data-act="nvAdd">添加</button></div>`)
    + card(`${IV.month} 无票收入`, rows.length ? table(
      [{ t: '日期' }, { t: '备注' }, { t: '含税金额', n: 1 }, { t: '率' }, { t: '不含税', n: 1 }, { t: '税额', n: 1 }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">本月没有无票收入</div>`);
};

/* ============ 抖音资金账单 → 无票收入 ============ */
/* 学自真实账单（澳乐官方旗舰店 2607）：明细页列 = 动账时间(Excel序列数)/
   动账方向(入账/出账)/动账金额/动账场景(货款结算入账/福袋业务结算入账/提现/权益保险/退换货运费险)。
   收入 = 入账 且 场景含「结算入账」；其余是资金调拨或费用，不进销售额。 */
const ivExcelDate = v => {
  const n = +v;
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return normDate(String(v));
};
async function ivDyImport(file) {
  try {
    toast('正在解析…');
    // 抖音账单第一页是汇总透视、第二页才是明细——逐表找含「动账时间」列的那页
    const sheets = await XLSXLite.readSheets(file);
    let rows = null, hr = 0, iDir = -1, iScene = -1, iAmt = -1, iDate = -1;
    for (const sh of sheets) {
      const h = XLSXLite.findHeaderRow(sh, ['动账方向', '动账场景', '动账金额', '动账时间']);
      const cells = (sh[h] || []).map(c => String(c == null ? '' : c).replace(/\s/g, ''));
      const col = n => cells.findIndex(c => c.includes(n));
      if (col('动账时间') >= 0 && col('动账金额') >= 0) {
        rows = sh; hr = h;
        iDir = col('动账方向'); iScene = col('动账场景'); iAmt = col('动账金额'); iDate = col('动账时间');
        break;
      }
    }
    if (!rows || iDir < 0 || iScene < 0) {
      toast('没找到明细页：需要含 动账时间/动账方向/动账金额/动账场景 四列的工作表', 6200); return;
    }
    const p = ivProf();
    const groups = {};
    let skipped = 0;
    rows.slice(hr + 1).forEach(r => {
      const dir = String(r[iDir] == null ? '' : r[iDir]).trim();
      const scene = String(r[iScene] == null ? '' : r[iScene]).trim();
      const amt = numOf(r[iAmt]);
      if (!dir || !amt) return;
      if (dir !== '入账' || !/结算入账/.test(scene)) { skipped++; return; }
      const date = ivExcelDate(r[iDate]);
      if (!date || date < '2026-01-01') return;
      const k = date.slice(0, 7) + '|' + scene;
      const g = groups[k] = groups[k] || { gross: 0, cnt: 0, lastDate: date };
      g.gross += amt; g.cnt++;
      if (date > g.lastDate) g.lastDate = date;
    });
    const ks = Object.keys(groups).sort();
    if (!ks.length) { toast('没找到「入账·结算入账」的行——确认导的是明细那页', 5200); return; }
    const key = IV_NOINV_KEY(CUR_ENT);
    const list = ivLoad(key).filter(x => x.src !== file.name);   // 同文件重复导入=覆盖
    let total = 0;
    ks.forEach(k => {
      const [month, scene] = k.split('|');
      const g = groups[k];
      const gross = +g.gross.toFixed(2);
      const net = +(gross / (1 + p.rate)).toFixed(2);
      total += gross;
      list.push({ id: uid(), date: g.lastDate, month, gross, rate: p.rate, net,
        tax: +(gross - net).toFixed(2), memo: '抖音-' + scene + '（' + g.cnt + '笔）', src: file.name });
    });
    ivSave(key, list);
    IV.month = ks[0].split('|')[0];
    toast(`已导入 ${ks.length} 组、含税合计 ${money(+total.toFixed(2))}（按 ${(p.rate * 100).toFixed(0)}% 拆税）；提现/保险等非收入行跳过 ${skipped} 条。`, 6200);
    go('iv-noinv');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}

/* ============ 增值税申报表 ============ */
/* 口径全部学自负责人给的真实申报表：
   - 小规模：按季申报（优栖 2026Q1 真表）；季度销售额 ≤30 万全额进
     「免税销售额-小微企业」，免税额按法定征收率算（84,087.25×3%=2,522.62 对上）；
     两栏分列「货物及劳务 / 服务、不动产和无形资产」按税务档案放列；
     减按 1% 时：应纳按 3% 计、减征额 2%，合计落 1%
   - 一般纳税人：按月（优趣 2026-02 真表）；无票收入落附列资料一
     「未开具发票」列；上期留抵→实际抵扣→期末留抵链条；本年累计列
   - 附加税费：计税依据=增值税税额；城建税率可配（真表中山 5%、广州 7%）；
     六税两费减半小规模与小型微利一般纳税人都适用 */
/* 附加税费：城建（税率按档案，市区7%/县镇5%）+ 教育费附加3% + 地方教育2%。
   六税两费减半：小规模纳税人和小型微利企业都适用（学自优趣真表——
   一般纳税人小微也减了 50%），档案里可关。 */
function ivSur(vat, p) {
  const k = p.halve ? 0.5 : 1;
  const cj = p.cjRate || 0.07;
  const c = +(vat * cj * k).toFixed(2), e = +(vat * 0.03 * k).toFixed(2), l = +(vat * 0.02 * k).toFixed(2);
  return { c, e, l, cj, sum: +(c + e + l).toFixed(2), halved: k === 0.5 };
}
function ivSumPool(a, b) {
  const out = ivLoad(IV_OUT_KEY(CUR_ENT)).filter(x => x.month >= a && x.month <= b);
  const noinv = ivLoad(IV_NOINV_KEY(CUR_ENT)).filter(x => x.month >= a && x.month <= b);
  const inn = ivLoad(IV_IN_KEY(CUR_ENT)).filter(x => x.month >= a && x.month <= b);
  const isSp = x => /专用/.test(String(x.kind || ''));
  return {
    spNet: +out.filter(isSp).reduce((s0, x) => s0 + x.amt, 0).toFixed(2),
    spTax: +out.filter(isSp).reduce((s0, x) => s0 + x.tax, 0).toFixed(2),
    otNet: +out.filter(x => !isSp(x)).reduce((s0, x) => s0 + x.amt, 0).toFixed(2),
    otTax: +out.filter(x => !isSp(x)).reduce((s0, x) => s0 + x.tax, 0).toFixed(2),
    nvNet: +noinv.reduce((s0, x) => s0 + x.net, 0).toFixed(2),
    nvTax: +noinv.reduce((s0, x) => s0 + x.tax, 0).toFixed(2),
    inTax: +inn.reduce((s0, x) => s0 + x.tax, 0).toFixed(2),
    inAmt: +inn.reduce((s0, x) => s0 + x.amt, 0).toFixed(2),
    inCnt: inn.length, outCnt: out.length, nvCnt: noinv.length,
  };
}
function ivVatData() {
  const p = ivProf();
  const y = IV.month.slice(0, 4);
  if (p.type === 'small') {
    const q = ivQuarterOf(IV.month);
    const cur = ivSumPool(q.from, q.to);
    const ytd = ivSumPool(y + '-01', q.to);
    const legal = p.rate >= 0.05 ? 0.05 : 0.03;   // 法定征收率：3% 档（含减按1%）或 5% 档
    const calc = pool => {
      const saleNet = +(pool.spNet + pool.otNet + pool.nvNet).toFixed(2);
      const free = saleNet <= 300000;             // 季度 ≤30 万免征（真表口径：小微企业免税销售额）
      const base = free ? 0 : +(saleNet * legal).toFixed(2);          // 本期应纳税额（按法定率）
      const cut = free ? 0 : (p.rate < legal ? +(saleNet * (legal - p.rate)).toFixed(2) : 0); // 减征额
      const vat = +(base - cut).toFixed(2);
      const freeTax = free ? +(saleNet * legal).toFixed(2) : 0;       // 本期免税额
      return { saleNet, free, base, cut, vat, freeTax, pool };
    };
    const c = calc(cur), t = calc(ytd);
    return { p, kind: 'small', q, legal, cur: c, ytd: t,
      saleNet: c.saleNet, saleTax: 0, free: c.free, vat: c.vat,
      freeSaleTax: +(cur.spTax + cur.otTax + cur.nvTax).toFixed(2),
      sur: ivSur(c.vat, p), adj: ivAdj('q' + q.y + q.q) };
  }
  const m = IV.month;
  const cur = ivSumPool(m, m);
  const ytd = ivSumPool(y + '-01', m);
  const adj = ivAdj(m);
  const carry = numOf(adj.carry);
  const mk = (pool, carry0) => {
    const saleNet = +(pool.spNet + pool.otNet + pool.nvNet).toFixed(2);
    const saleTax = +(pool.spTax + pool.otTax + pool.nvTax).toFixed(2);
    const dedPool = +(pool.inTax + carry0).toFixed(2);                // 应抵扣合计=进项+上期留抵
    const deduct = Math.min(saleTax, dedPool);                        // 实际抵扣
    const vat = +(saleTax - deduct).toFixed(2);
    return { saleNet, saleTax, inTax: pool.inTax, dedPool, deduct, vat,
      carryEnd: +(dedPool - deduct).toFixed(2), pool };
  };
  const c = mk(cur, carry), t = mk(ytd, 0);
  return { p, kind: 'general', cur: c, ytd: t, carry,
    saleNet: c.saleNet, saleTax: c.saleTax, inTax: c.inTax,
    deduct: c.deduct, vat: c.vat, carryEnd: c.carryEnd, free: false,
    sur: ivSur(c.vat, p), adj };
}
S['iv-vat'] = () => {
  if (!CUR_ENT) return needEnt('增值税申报表');
  const d = ivVatData();
  const p = d.p;
  const profBar = `<div class="note"><b>税务档案：</b>
    <select id="ivType"><option value="small" ${p.type === 'small' ? 'selected' : ''}>小规模纳税人（按季）</option><option value="general" ${p.type === 'general' ? 'selected' : ''}>一般纳税人（按月）</option></select>
    ${p.type === 'small' ? `征收率 <select id="ivRate">${[0.01, 0.03, 0.05].map(r => `<option value="${r}" ${Math.abs(r - p.rate) < 1e-9 ? 'selected' : ''}>${(r * 100).toFixed(0)}%${r === 0.01 ? '（3%减按1%）' : ''}</option>`).join('')}</select>
      栏次 <select id="ivBiz"><option value="goods" ${p.biz !== 'estate' ? 'selected' : ''}>货物及劳务</option><option value="estate" ${p.biz === 'estate' ? 'selected' : ''}>服务、不动产和无形资产</option></select>` : ''}
    城建税率 <select id="ivCj">${[[0.07, '7% 市区'], [0.05, '5% 县城建制镇'], [0.01, '1% 其他']].map(x => `<option value="${x[0]}" ${Math.abs((p.cjRate || 0.07) - x[0]) < 1e-9 ? 'selected' : ''}>${x[1]}</option>`).join('')}</select>
    <label style="margin-left:8px"><input type="checkbox" id="ivHalve" ${p.halve ? 'checked' : ''}> 六税两费减半（小规模/小型微利）</label>
    　<b>此表是申报草稿，行次学自真实税表，以电子税务局最终生成的为准。</b></div>`;
  if (p.kind === 'small' || p.type === 'small') {
    const bizN = p.biz === 'estate' ? '服务、不动产和无形资产' : '货物及劳务';
    const F = (no, nm, c, t, cls) => ({ cls: cls || '', d: [`<span class="code">${no}</span> ${nm}`, money(c), money(t)] });
    const cc = d.cur, tt = d.ytd;
    const rows = [
      { cls: 'lv1', d: [`<b>一、计税依据</b>（金额均填入「${bizN}」栏）`, '<b>本期数</b>', '<b>本年累计</b>'] },
      F('1', `应征增值税不含税销售额（${(d.legal * 100).toFixed(0)}%征收率）`, cc.free ? 0 : cc.saleNet, tt.free ? 0 : tt.saleNet),
      F('2', '　增值税专用发票不含税销售额', cc.free ? 0 : cc.pool.spNet, tt.free ? 0 : tt.pool.spNet),
      F('3', '　其他增值税发票不含税销售额', cc.free ? 0 : cc.pool.otNet, tt.free ? 0 : tt.pool.otNet),
      F('9', '（四）免税销售额', cc.free ? cc.saleNet : 0, tt.free ? tt.saleNet : 0),
      F('10', '　其中：小微企业免税销售额', cc.free ? cc.saleNet : 0, tt.free ? tt.saleNet : 0, 'sum'),
      { cls: 'lv1', d: ['<b>二、税款计算</b>', '', ''] },
      F('15', '本期应纳税额', cc.base, tt.base),
      F('16', '本期应纳税额减征额' + (p.rate < d.legal ? `（减按${(p.rate * 100).toFixed(0)}%）` : ''), cc.cut, tt.cut),
      F('17', '本期免税额（免税销售额×' + (d.legal * 100).toFixed(0) + '%）', cc.freeTax, tt.freeTax),
      F('20', '应纳税额合计', cc.vat, tt.vat, 'sum'),
      F('22', '本期应补（退）税额', cc.vat, tt.vat, 'sum'),
      { cls: 'lv1', d: ['<b>三、附加税费</b>（附列资料二：计税依据=增值税税额' + (d.sur.halved ? '，六税两费减征50%' : '') + '）', '', ''] },
      F('23', `城市维护建设税（${String(Math.round(d.sur.cj * 100))}%）`, d.sur.c, d.sur.c),
      F('24', '教育费附加（3%）', d.sur.e, d.sur.e),
      F('25', '地方教育附加（2%）', d.sur.l, d.sur.l),
    ];
    return head('增值税及附加税费申报表（小规模纳税人适用）',
      `${H(entName())} · 税款所属期 ${d.q.from}-01 至 ${d.q.to} 月末（按季）。销售额 = 销项票 + 无票收入（本季 ${cc.pool.outCnt} 张票 + ${cc.pool.nvCnt} 笔无票）。`, '纳税申报 · 会小规模',
      `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
       <a class="btn" href="https://etax.guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer">电子税务局 ↗</a>
       <button class="btn" data-act="ivVchVat">生成凭证</button>
       <button class="btn pri" data-act="ivExpVat">导出</button>`)
      + profBar
      + kpis([
        { k: '本季不含税销售额', v: money(cc.saleNet) },
        { k: '免税', v: cc.free ? '是（季≤30万）' : '否', t: cc.free ? 'g' : '' },
        { k: '应纳税额合计', v: money(cc.vat) },
        { k: '附加税费', v: money(d.sur.sum) },
        { k: '本期应补（退）合计', v: money(+(cc.vat + d.sur.sum).toFixed(2)), t: 'g' },
      ])
      + (cc.free ? `<div class="note g"><b>本季销售额 ${money(cc.saleNet)} ≤ 30 万，全额免征</b>：进第 9/10 行「免税销售额-小微企业」，免税额 ${money(cc.freeTax)} = 销售额×${(d.legal * 100).toFixed(0)}%（法定率），仍需按期申报。</div>` : '')
      + card('申报表（按税局行次）', table([{ t: '栏次 · 项目' }, { t: '本期数', n: 1 }, { t: '本年累计', n: 1 }], rows));
  }
  const cc = d.cur, tt = d.ytd;
  const F = (no, nm, c, t, cls) => ({ cls: cls || '', d: [`<span class="code">${no}</span> ${nm}`, typeof c === 'string' ? c : money(c), typeof t === 'string' ? t : money(t)] });
  const rows = [
    { cls: 'lv1', d: ['<b>销售额</b>', '<b>本月数</b>', '<b>本年累计</b>'] },
    F('1', '（一）按适用税率计税销售额', cc.saleNet, tt.saleNet),
    { cls: 'lv1', d: ['<b>附列资料一 · 本期销售明细</b>（销售额 / 销项税额）', '', ''] },
    F('', '开具增值税专用发票', money(cc.pool.spNet) + ' / ' + money(cc.pool.spTax), ''),
    F('', '开具其他发票', money(cc.pool.otNet) + ' / ' + money(cc.pool.otTax), ''),
    F('', '未开具发票（无票收入）', money(cc.pool.nvNet) + ' / ' + money(cc.pool.nvTax), ''),
    { cls: 'lv1', d: ['<b>税款计算</b>', '', ''] },
    F('11', '销项税额', cc.saleTax, tt.saleTax),
    F('12', '进项税额（进项票 ' + cc.pool.inCnt + ' 张）', cc.inTax, tt.inTax),
    F('13', '上期留抵税额（手工填报）', `<input type="number" step="0.01" id="ivCarry" value="${d.carry || ''}" placeholder="0.00" style="width:120px">`, ''),
    F('17', '应抵扣税额合计（12+13）', cc.dedPool, ''),
    F('18', '实际抵扣税额', cc.deduct, tt.deduct),
    F('19', '应纳税额（11−18）', cc.vat, tt.vat, 'sum'),
    F('20', '期末留抵税额（17−18）', cc.carryEnd, ''),
    F('24', '应纳税额合计', cc.vat, tt.vat, 'sum'),
    F('34', '本期应补（退）税额', cc.vat, tt.vat, 'sum'),
    { cls: 'lv1', d: ['<b>附加税费</b>（附列资料五：计税依据=增值税税额' + (d.sur.halved ? '，小微六税两费减征50%' : '') + '）', '', ''] },
    F('39', `城市维护建设税（${String(Math.round(d.sur.cj * 100))}%）`, d.sur.c, d.sur.c),
    F('40', '教育费附加（3%）', d.sur.e, d.sur.e),
    F('41', '地方教育附加（2%）', d.sur.l, d.sur.l),
  ];
  return head('增值税及附加税费申报表（一般纳税人适用）',
    `${H(entName())} · 税款所属期 ${IV.month}（按月）。无票收入按真表落「附列资料一·未开具发票」列。`, '纳税申报 · 会一般',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <a class="btn" href="https://etax.guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer">电子税务局 ↗</a>
     <button class="btn" data-act="ivVchVat">生成凭证</button>
     <button class="btn pri" data-act="ivExpVat">导出</button>`)
    + profBar
    + kpis([
      { k: '销项税额', v: money(cc.saleTax) },
      { k: '进项税额', v: money(cc.inTax) },
      { k: '应纳税额', v: money(cc.vat) },
      { k: '期末留抵', v: money(cc.carryEnd) },
      { k: '本期应补（退）合计', v: money(+(cc.vat + d.sur.sum).toFixed(2)), t: 'g' },
    ])
    + card('申报表（按税局行次）', table([{ t: '栏次 · 项目' }, { t: '本月数', n: 1 }, { t: '本年累计', n: 1 }], rows));
};

/* ============ 企业所得税季度预缴 ============ */
/* 数据源两条路：本系统利润表（凭证库实时算）或导入利润表文件。 */
/* 小微企业判定三条件（学自澳乐 2025 年 A000000 真表）：应纳税所得额≤300万
   且 从业人数≤300 人 且 资产总额≤5,000 万（人数/资产按全年季度平均值）。
   澳乐真表：资产均值 7,718.10 万超线 → 小型微利勾「否」、按 25%。
   人数/资产存在税务档案里；没填时该条件不拦，但页面提示补齐。 */
function ivCitSmall(taxable) {
  const p = ivProf();
  const has = v => v !== undefined && v !== null && v !== '' && !isNaN(+v);
  const staffKo = has(p.staff) && +p.staff > 300;
  const assetKo = has(p.assets) && +p.assets > 5000;
  return { small: taxable <= 3000000 && !staffKo && !assetKo,
    filled: has(p.staff) && has(p.assets), staffKo, assetKo, p };
}
S['iv-cit'] = () => {
  if (!CUR_ENT) return needEnt('企业所得税申报表');
  const q = ivQuarterOf(IV.month);
  const adjKey = 'q' + q.y + q.q;
  const adj = ivAdj(adjKey);
  let src = adj.citSrc || 'book';
  // 本系统口径：本年 1 月 1 日到季末，取利润表引擎
  let rev = 0, cost = 0, profit = 0, note = '';
  if (src === 'book') {
    const pl = rptPlData(q.y + '-01-01', q.to + '-31');
    rev = pl.rev; cost = pl.cost + pl.taxSur; profit = pl.total;
    note = `取自本系统利润表（${q.y}-01-01 〜 ${q.to} 月末，含未过账凭证按科目余额表设置）`;
  } else {
    rev = numOf(adj.citRev); cost = numOf(adj.citCost); profit = numOf(adj.citProfit);
    note = '手工/导入填报';
  }
  const loss = numOf(adj.loss);                       // 弥补以前年度亏损
  const taxable = Math.max(0, +(profit - loss).toFixed(2));
  const sm = ivCitSmall(taxable);
  const small = sm.small;
  const rate = small ? 0.05 : 0.25;
  const due = +(taxable * rate).toFixed(2);
  const paid = numOf(adj.paid);                       // 本年已预缴
  const pay = Math.max(0, +(due - paid).toFixed(2));
  const F = (nm, v, cls) => ({ cls: cls || '', d: [nm, typeof v === 'number' ? money(v) : v] });
  return head('企业所得税月（季）度预缴纳税申报表（A类）',
    `${H(entName())} · ${q.y} 年第 ${q.q} 季度（累计 ${q.y}-01-01 起）。${note}。`, '纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <a class="btn" href="https://etax.guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer">电子税务局 ↗</a>\n     <button class="btn" data-act="ivVchCit">生成凭证</button>
     <button class="btn pri" data-act="ivExpCit">导出</button>`)
    + `<div class="note"><b>数据来源：</b>
      <label><input type="radio" name="citSrc" value="book" ${src === 'book' ? 'checked' : ''}> 本系统利润表（推荐，与账一致）</label>
      <label style="margin-left:10px"><input type="radio" name="citSrc" value="manual" ${src === 'manual' ? 'checked' : ''}> 手工填报（账在别处时用）</label>
      ${src === 'manual' ? `<div style="margin-top:8px">营业收入 <input type="number" id="citRev" value="${adj.citRev || ''}" style="width:120px">
        营业成本 <input type="number" id="citCost" value="${adj.citCost || ''}" style="width:120px">
        利润总额 <input type="number" id="citProfit" value="${adj.citProfit || ''}" style="width:120px">
        <button class="btn sm" data-act="citSave">保存</button></div>` : ''}</div>`
    + kpis([
      { k: '累计营业收入', v: money(rev) },
      { k: '累计利润总额', v: money(profit) },
      { k: '实际利润额', v: money(taxable) },
      { k: '适用税负', v: small ? '5%（小微）' : '25%', t: small ? 'g' : '' },
      { k: '本期应补（退）', v: money(pay), t: 'g' },
    ])
    + card('申报表（按税局行次）', table([{ t: '行次 · 项目' }, { t: '本年累计金额', n: 1 }], [
      F('1　营业收入', rev),
      F('2　营业成本', cost),
      F('3　利润总额', profit),
      F('4　减：弥补以前年度亏损（手工）', `<input type="number" step="0.01" id="citLoss" value="${adj.loss || ''}" placeholder="0.00" style="width:130px">`),
      F('5　实际利润额（3-4）', taxable, 'sum'),
      F('6　税率与减免', small ? '小微企业：减按 25% 计入 × 20%，实际 5%' : '25%'),
      F('7　本年应纳所得税额', due, 'sum'),
      F('8　减：本年已预缴（手工）', `<input type="number" step="0.01" id="citPaid" value="${adj.paid || ''}" placeholder="0.00" style="width:130px">`),
      F('9　本期应补（退）所得税额', pay, 'sum'),
    ]))
    + cardp('小微判定档案（三条件，缺一不可）', `<div class="cols c4">
        <div class="field"><label class="fl">从业人数（全年季度平均，人）</label>
          <input type="number" step="0.01" id="citStaff" value="${sm.p.staff != null ? H(String(sm.p.staff)) : ''}" placeholder="如 23"></div>
        <div class="field"><label class="fl">资产总额（全年季度平均，万元）</label>
          <input type="number" step="0.01" id="citAssets" value="${sm.p.assets != null ? H(String(sm.p.assets)) : ''}" placeholder="如 7718.10"></div>
        <div class="note" style="margin:0;grid-column:span 2">判定 = 应纳税所得额 ≤300 万 <b>且</b> 人数 ≤300 <b>且</b> 资产 ≤5,000 万。
          ${sm.filled ? (small ? '按当前档案：<b>符合小微</b>，实际税负 5%。' : `按当前档案：<b>不符合小微</b>（${sm.staffKo ? '人数超 300' : ''}${sm.staffKo && sm.assetKo ? '、' : ''}${sm.assetKo ? '资产超 5,000 万' : ''}${!sm.staffKo && !sm.assetKo ? '所得超 300 万' : ''}），按 25% 报。`)
            : '<b>人数/资产还没填</b>，当前只按「所得 ≤300 万」判了——先把两个数补上（真实例：澳乐 2025 年 A000000 真表填资产均值 7,718.10 万、从业 23 人，资产超线 → 非小微按 25%）。'}
          这两个数按主体存档，年度汇算 A000000 基础信息表也要填同口径的平均值。</div>
      </div>`)
    + `<div class="note w"><b>季度预缴之外还有年度汇算：</b>次年 5 月 31 日前做汇算清缴，随表报《企业所得税年度纳税申报基础信息表》（A000000，含资产总额/从业人数/行业/股东结构）。预缴按本页，多退少补在汇算。</div>`;
};

/* ============ 印花税申报表 ============ */
const STAMP_ITEMS = [
  ['buy', '买卖合同（购销）', 0.0003],
  ['lease', '租赁合同', 0.001],
  ['loan', '借款合同', 0.00005],
  ['tech', '技术合同', 0.0003],
  ['transport', '运输合同', 0.0003],
  ['property', '产权转移书据', 0.0005],
  ['book', '营业账簿（实收资本+资本公积）', 0.00025],
];
S['iv-stamp'] = () => {
  if (!CUR_ENT) return needEnt('印花税申报表');
  const p = ivProf();
  const adjKey = 'st' + IV.month;
  const adj = ivAdj(adjKey);
  const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
  // 计税依据提示：买卖合同可参考本月进销票金额，营业账簿参考账上实收资本+资本公积
  const inAmt = ivLoad(IV_IN_KEY(CUR_ENT)).filter(x => x.month === IV.month).reduce((s, x) => s + x.amt, 0);
  const outAmt = ivLoad(IV_OUT_KEY(CUR_ENT)).filter(x => x.month === IV.month).reduce((s, x) => s + x.amt, 0);
  const bal = rptBalAt(CUR_ENT, IV.month + '-31', 1);
  const capital = -(((bal['3001'] || {}).net || 0) + ((bal['4001'] || {}).net || 0) + ((bal['3002'] || {}).net || 0));
  let total = 0;
  const rows = STAMP_ITEMS.map(it => {
    const base = numOf(adj[it[0]]);
    const tax = +(base * it[2] * k).toFixed(2);
    total += tax;
    return [H(it[1]), (it[2] * 1000).toFixed(2).replace(/\.?0+$/, '') + '‰',
      `<input type="number" step="0.01" data-stamp="${it[0]}" value="${adj[it[0]] || ''}" placeholder="0.00" style="width:150px">`,
      money(tax)];
  });
  return head('印花税申报表', `${H(entName())} · 税款所属期 ${IV.month}。计税金额按合同/账簿实际填，右侧税额实时算${k === 0.5 ? '（小规模六税两费减半已含）' : ''}。电子税务局里它走《财产和行为税纳税申报表》合并申报（星逸 2025Q3 真表：按季、买卖合同税目，<b>零申报也要报</b>）。`, '纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <a class="btn" href="https://etax.guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer">电子税务局 ↗</a>\n     <button class="btn" data-act="stampSave">保存</button>
     <button class="btn" data-act="ivVchStamp">生成凭证</button>
     <button class="btn pri" data-act="ivExpStamp">导出</button>`)
    + `<div class="note"><b>计税金额要按实际签的合同填</b>，系统只给参考：本月进项票不含税 ${money(inAmt)}、销项票不含税 ${money(outAmt)}（买卖合同可参考）；账上实收资本+资本公积 ${money(capital)}（营业账簿税目，首次或增资当期才计）。没签合同的税目留空。</div>`
    + kpis([
      { k: '本期应纳印花税', v: money(+total.toFixed(2)), t: 'g' },
      { k: '优惠', v: k === 0.5 ? '六税两费减半' : '无' },
    ])
    + card('按税目填报', table([{ t: '税目' }, { t: '税率' }, { t: '计税金额', n: 1 }, { t: '应纳税额', n: 1 }], rows,
      ['<b>合计</b>', '', '', `<b>${money(+total.toFixed(2))}</b>`]));
};

/* ============ 文化事业建设费 ============ */
/* 学自星逸文化 2026-07 真实申报表（营改增版）：广告服务、娱乐服务的缴纳人按月申报，
   费率 3%，计费销售额 = 应征收入 − 本期减除额（广告业的减除额 = 付给其他广告公司
   或媒体的广告发布费，凭合规凭证）。真表就是零申报——没有收入也要按月报。 */
const IV_CULT_RATE = 0.03;
S['iv-cult'] = () => {
  if (!CUR_ENT) return needEnt('文化事业建设费');
  const key = 'cult' + IV.month;
  const adj = ivAdj(key);
  const inc = numOf(adj.inc), freeInc = numOf(adj.freeInc), cut = numOf(adj.cut), pre = numOf(adj.pre);
  const relief = numOf(adj.relief);
  const saleBase = Math.max(0, +(inc - cut).toFixed(2));
  const due = +(saleBase * IV_CULT_RATE).toFixed(2);
  const pay = +(due - relief - pre).toFixed(2);
  // 参考数：本月销项票价税合计 + 无票收入含税——计费收入是含税的全部价款和价外费用
  const out = ivLoad(IV_OUT_KEY(CUR_ENT)).filter(x => x.month === IV.month);
  const nv = ivLoad(IV_NOINV_KEY(CUR_ENT)).filter(x => x.month === IV.month);
  const refGross = +(out.reduce((s, x) => s + (x.total || 0), 0) + nv.reduce((s, x) => s + (x.gross || 0), 0)).toFixed(2);
  const inp = (k2, v, ph) => `<input type="number" step="0.01" data-cult="${k2}" value="${v || ''}" placeholder="${ph || '0.00'}" style="width:150px">`;
  const rows = [
    ['<span class="code">1</span> 应征增值税的广告/娱乐服务收入（含税）', inp('inc', adj.inc), money(inc)],
    ['<span class="code">2</span> 免征增值税的收入<div class="mut" style="font-size:11px">本草稿暂不计入计费基数——学习来源（星逸 2026-07）是零申报，验证不了该栏口径，以税局生成为准</div>', inp('freeInc', adj.freeInc), money(freeInc)],
    ['<span class="code">5</span> 本期减除额（付给其他广告公司/媒体的发布费）', inp('cut', adj.cut), money(cut)],
    ['<span class="code">8</span> 计费销售额（1−5）', '', money(saleBase)],
    ['<span class="code">9</span> 费率', '', '3%'],
    ['<span class="code">10</span> 应缴费额（8×9）', '', `<b>${money(due)}</b>`],
    ['<span class="code">—</span> 减免费额（有减征优惠时手工填，以税局核定为准）', inp('relief', adj.relief), money(relief)],
    ['<span class="code">13</span> 本期预缴费额', inp('pre', adj.pre), money(pre)],
    ['<span class="code">18</span> 本期应补（退）费额（10−减免−13）', '', `<b>${money(pay)}</b>`],
  ];
  return head('文化事业建设费申报表（营改增）',
    `${H(entName())} · 费款所属期 ${IV.month}（按月）。广告服务、娱乐服务的缴纳人适用；<b>零申报也要按月报</b>（星逸 2026-07 真表就是零申报）。`, '纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <a class="btn" href="https://etax.guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer">电子税务局 ↗</a>
     <button class="btn" data-act="cultSave">保存</button>
     <button class="btn" data-act="cultVch">生成凭证</button>
     <button class="btn pri" data-act="ivExpCult">导出</button>`)
    + kpis([
      { k: '计费销售额', v: money(saleBase) },
      { k: '应缴费额（3%）', v: money(due), t: due ? 'w' : 'g' },
      { k: '本期应补（退）', v: money(pay) },
      { k: '参考：本月销项+无票（含税）', v: money(refGross) },
    ])
    + `<div class="note"><b>口径（星逸 2026-07 真表）：</b>计费收入按<b>含税</b>全部价款和价外费用填；
      减除额是付给其他广告公司或媒体的广告发布费（要有合规凭证）。本月销项票+无票收入含税合计
      ${money(refGross)} 供参考——只有其中广告/娱乐服务的部分才计费，其他业务收入不算。
      计提分录：借 5403 税金及附加 / 贷 222113 应交税费_文化事业建设费。</div>`
    + card('申报表（按税局栏次）', table([{ t: '栏次 · 项目' }, { t: '填报', n: 1 }, { t: '本期数', n: 1 }], rows));
};

/* ============ 电子税务局入口 ============ */
/* 只放官方 chinatax.gov.cn 域名的链接——报税入口是钓鱼重灾区，
   别用搜索引擎搜「电子税务局登录」。广州企业在广东省电子税务局申报。 */
S['iv-portal'] = () => head('电子税务局', '报税直达。本系统的申报表是草稿，最终以电子税务局生成并提交的为准。', '纳税申报')
  + `<div class="note"><b>认准官方域名 chinatax.gov.cn / gsxt.gov.cn。</b>别用搜索引擎搜「电子税务局登录」——钓鱼站最爱做这个入口。登录用电子营业执照 / 实名账号，证书问题打 12366。</div>`
  + `<div class="bankgrid">
    <a class="bank" href="https://etax.guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer" style="--bc:#c7000b">
      <span class="bi0">税</span><span class="bn">广东省电子税务局 <span class="bcnt">申报入口</span></span><span class="bu">etax.guangdong.chinatax.gov.cn</span></a>
    <a class="bank" href="https://guangdong.chinatax.gov.cn" target="_blank" rel="noopener noreferrer" style="--bc:#00509e">
      <span class="bi0">粤</span><span class="bn">广东省税务局官网</span><span class="bu">guangdong.chinatax.gov.cn</span></a>
    <a class="bank" href="https://www.chinatax.gov.cn" target="_blank" rel="noopener noreferrer" style="--bc:#8a6d3b">
      <span class="bi0">总</span><span class="bn">国家税务总局</span><span class="bu">www.chinatax.gov.cn</span></a>
    <a class="bank" href="https://12366.chinatax.gov.cn" target="_blank" rel="noopener noreferrer" style="--bc:#009944">
      <span class="bi0">12</span><span class="bn">12366 纳税服务平台</span><span class="bu">12366.chinatax.gov.cn</span></a>
    <a class="bank" href="https://www.gsxt.gov.cn" target="_blank" rel="noopener noreferrer" style="--bc:#b02418">
      <span class="bi0">工</span><span class="bn">企业信用信息公示系统 <span class="bcnt">工商年报</span></span><span class="bu">www.gsxt.gov.cn</span></a>
  </div>`
  + `<div class="note" style="margin-top:12px"><b>报税顺序建议：</b>票据导进销项票、录无票收入 → 增值税/印花税申报表核对生成凭证 → 所得税申报表 → 打开电子税务局照着草稿填 → 回凭证库把税费凭证过账。</div>`
  + card('申报义务全景（按真实税表整理 · 零申报也要按期报）', table(
    [{ t: '申报事项' }, { t: '周期' }, { t: '期限' }, { t: '备注（口径来源）' }],
    [
      ['增值税及附加', '小规模按季 / 一般人按月', '期满次月（季后首月）15 日前', '优栖 2026Q1、优趣 2026-02 真表；季销 ≤30 万免征仍要报'],
      ['个税（工资薪金预扣缴）', '按月', '次月 15 日前', '自然人电子税务局扣缴端逐人报；澳乐 2026-01〜07 真表，本系统做账-报勾稽'],
      ['企业所得税预缴', '按季', '季后 15 日内', '小微三条件判定（澳乐 A000000：资产 7,718 万超线 → 25%）'],
      ['企业所得税汇算 + A000000', '按年', '次年 5 月 31 日前', '随汇算报基础信息表（资产/人数/股东结构）'],
      ['财产和行为税（含印花税）', '按季（税源采集后）', '季后 15 日内', '星逸 2025Q3 真表：买卖合同 0.3‰，合并申报、零申报也报'],
      ['文化事业建设费', '按月', '次月 15 日前', '广告/娱乐服务适用，费率 3%（星逸 2026-07 真表，零申报）'],
      ['财务报表报送（会小企 01/02）', '按季', '随季度申报', '小企业会计准则资产负债表+利润表（星逸 2025Q3 真表）'],
      ['残保金', '按年', '广东：当年申报上年（澳乐 2024 年度 2025-11 受理）', '分档减免 10%/50%/100%，见残保金页'],
      ['车购税', '一次性（购车时）', '购车之日起 60 日内', '澳乐 2025-03 真表：新能源免税有每辆上限（2025 封顶 3 万、超出照缴 22,141.59）；2026 年起政策以申报时为准'],
    ]));

/* ============ 个税 / 残保金申报 ============ */
/* 社保不在这里办——公司用社保客户端申报，系统不做这块。
   两个申报的基数都从账上取（与三大报表同一份数）：
   工资基数 = 本月 2211 应付职工薪酬贷方发生（计提数）
            + 名称含「工资/薪酬」的费用科目借方发生（未走计提、直接进费用的部分）
   这条数就是利润表「管理费用」里的工资，申报、报表、账三处永远一个数。
   逐人算税在「员工与工资表」页（pay.js）或官方扣缴端做——本页只备底数与勾稽。 */
function ivWageBase(m) {
  const a = m + '-01';
  const b = m + '-' + String(new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate()).padStart(2, '0');
  const net = rptNet(CUR_ENT, a, b, AC.inc);
  // 工资总额 = 费用侧工资科目借方发生（计提分录也借费用，所以它已含计提数，
  // 不能再把 2211 贷方加一遍——那是重复计）。2211 只用来拆「经计提 / 未计提直发」。
  let expense = 0, accrual = 0;
  Object.keys(net).forEach(k => {
    if (/^2211/.test(k)) accrual += net[k].cr - net[k].dr;
    // rptNet 的名称截掉了下划线后半段，判「工资」用科目设置里的全名
    else if (/^5/.test(k) && /(工资|薪酬|薪金)/.test(acctName(k) || net[k].name || '')) expense += net[k].dr - net[k].cr;
  });
  accrual = Math.min(accrual, expense);
  return { accrual: +accrual.toFixed(2), direct: +(expense - accrual).toFixed(2), total: +expense.toFixed(2) };
}
const IV_PORTALS = {
  its: ['自然人电子税务局（个税扣缴）', 'https://its.chinatax.gov.cn', '#c7000b', '税'],
  etax: ['广东省电子税务局（残保金）', 'https://etax.guangdong.chinatax.gov.cn', '#00509e', '粤'],
};
const ivPortalCards = keys => `<div class="bankgrid">${keys.map(k => { const p = IV_PORTALS[k];
  return `<a class="bank" href="${p[1]}" target="_blank" rel="noopener noreferrer" style="--bc:${p[2]}">
    <span class="bi0">${p[3]}</span><span class="bn">${p[0]}</span><span class="bu">${p[1].replace('https://', '')}</span></a>`; }).join('')}</div>`;
const ivTieNote = w => `<div class="note"><b>与三大报表的勾稽：</b>本页基数取自账上工资科目本月发生
  （其中经计提 ${money(w.accrual)}、未计提直发 ${money(w.direct)}），与利润表「管理费用」同源同数；
  申报后生成的计提凭证回凭证库，自动进资产负债表（应交/应付）与利润表（费用）。只放官方
  chinatax.gov.cn 域名，别用搜索引擎搜申报入口。</div>`;

/* 扣缴端申报数导入（学自澳乐 2026-01〜07 真实《综合所得预扣预缴申报明细表》）：
   自然人电子税务局导出的明细逐人逐月，列含 税款所属期（202607）/姓名/所得项目/本期收入/…。
   这里只按月汇总「人数 + 本期收入合计」留存，同月重复导入=覆盖；
   逐人明细（姓名/证照号）不进本页的留存——员工档案在「员工与工资表」页
   单独维护（也只存本机 localStorage），本页导入的申报明细只留月度汇总。 */
const IV_IIT_KEY = e => 'fsc_iv_iit_' + e + '_v1';
function ivIitLoad() { try { return JSON.parse(localStorage.getItem(IV_IIT_KEY(CUR_ENT)) || '{}'); } catch (e) { return {}; } }
async function ivIitImport(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, ['税款所属期', '姓名', '本期收入']);
    const cells = (rows[hr] || []).map(c => String(c == null ? '' : c).replace(/\s/g, ''));
    const iM = cells.findIndex(c => c.includes('税款所属期'));
    const iInc = cells.findIndex(c => c === '本期收入' || c.includes('本期收入'));
    if (iM < 0 || iInc < 0) { toast('没认出「税款所属期 / 本期收入」两列——请用自然人电子税务局导出的申报明细表', 5600); return; }
    const bym = {};
    let skipped = 0;   // 月份认不出的行要报数——静默丢行会让金额偏小还没人知道
    rows.slice(hr + 1).forEach(r => {
      const cell = String(r[iM] == null ? '' : r[iM]).trim();
      if (!cell && !r.some(c => String(c == null ? '' : c).trim())) return;   // 整行空白不算
      const raw = cell.replace(/[-/.]/g, '');
      if (!/^\d{6}/.test(raw)) { if (cell) skipped++; return; }
      const mm = raw.slice(0, 4) + '-' + raw.slice(4, 6);
      const g = bym[mm] = bym[mm] || { n: 0, inc: 0 };
      g.n++; g.inc += numOf(r[iInc]);
    });
    const ks = Object.keys(bym).sort();
    if (!ks.length) { toast('表里没读到申报数据行——「税款所属期」列要形如 202607 或 2026-07', 5200); return; }
    const store = ivIitLoad();
    const at = new Date().toLocaleString('zh-CN');
    ks.forEach(m => { store[m] = { n: bym[m].n, inc: +bym[m].inc.toFixed(2), at, src: file.name }; });
    try { localStorage.setItem(IV_IIT_KEY(CUR_ENT), JSON.stringify(store)); } catch (e) { toast('保存失败：浏览器存储空间不足'); return; }
    toast(`已导入 ${ks.length} 个月（${ks[0]} 〜 ${ks[ks.length - 1]}）的申报汇总，同月覆盖不叠加`
      + (skipped ? `；${skipped} 行月份没认出被跳过，金额可能偏小` : ''), skipped ? 6200 : 5200);
    go('iv-iit');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}
S['iv-iit'] = () => {
  if (!CUR_ENT) return needEnt('个税申报');
  const w = ivWageBase(IV.month);
  const store = ivIitLoad();
  const cur = store[IV.month];
  const diff = cur ? +(w.total - cur.inc).toFixed(2) : null;
  const months = Object.keys(store).sort().reverse().slice(0, 12);
  const cmpRows = months.map(m => {
    const s = store[m];
    const book = ivWageBase(m).total;
    const d = +(book - s.inc).toFixed(2);
    return [m, `<span class="mono">${s.n}</span>`, money(s.inc), money(book),
      Math.abs(d) <= 1 ? `<span class="grn">${money(d)}</span>` : `<b class="red">${money(d)}</b>`,
      `<span class="mut">${H(s.src || '')}</span>`];
  });
  return head('个人所得税申报', `${H(entName())} · 税款所属期 ${IV.month}。逐人算税在自然人电子税务局扣缴端做；本页做<b>账上基数 与 扣缴端申报数</b>的勾稽（申报明细表导入后逐月比对）。`, '纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn pri" data-act="ivIitUp">导入扣缴端明细表</button>`)
    + kpis([
      { k: '本月工资基数（账上）', v: money(w.total), t: 'g' },
      { k: '扣缴端申报数（本期收入合计）', v: cur ? money(cur.inc) : '未导入', d: cur ? cur.n + ' 条记录' : '' },
      { k: '账-报差额', v: diff === null ? '—' : money(diff), t: diff === null ? '' : (Math.abs(diff) <= 1 ? 'g' : 'c') },
      { k: '其中：经计提（2211）', v: money(w.accrual) },
      { k: '未计提直发', v: money(w.direct) },
    ])
    + ivTieNote(w)
    + (cmpRows.length ? card('账 vs 报 · 逐月勾稽（差额 = 账上基数 − 申报合计）', table(
      [{ t: '月份' }, { t: '申报记录数', n: 1 }, { t: '申报「本期收入」合计', n: 1 }, { t: '账上工资基数', n: 1 }, { t: '差额', n: 1 }, { t: '来源文件' }], cmpRows))
      : `<div class="note"><b>还没导入扣缴端数据。</b>从自然人电子税务局（扣缴端）导出《综合所得预扣预缴申报明细表》
        （列含税款所属期/姓名/本期收入，如澳乐 2026-01〜07 那份），点右上角导入——只留按月汇总，不存逐人隐私明细。</div>`)
    + `<div class="note w"><b>差额怎么读：</b>正数 = 账上有工资没进申报（漏报或走了别的科目）；负数 = 申报了账上没有的
      （兼职/劳务没入账，或月末没计提）。差额超 1 元就该查。个税于次月 15 日前申报。</div>`
    + ivPortalCards(['its']);
};

/* 残保金计算（口径学自澳乐 2024 年真实缴费申报表，页面与凭证共用这一份）：
   基数 = （上年在职职工人数×1.5% − 已安排残疾人数）× 上年职工年平均工资；
   平均工资默认 = 工资总额÷人数，但真表按「当地社会平均工资 2 倍」封顶
   （澳乐 2024：算术平均 73,133.90，实际按 36,292.00 计费）→ 给覆盖输入框；
   人数按年平均、可带小数（真表 32.3333）。
   减免分档（真表列 8 注「7×100%（或50%、10%）」）：
   30 人及以下免 100%；安排比例 ≥1% 减 50%；不足 1%（含 0 人）减 10%。
   澳乐 2024 验证：(32.3333×1.5%−0)×36,292.00 = 17,601.62，减 10% → 实缴 15,841.46 ✓ */
function ivDbfCalc(staff, wageTotal, disabled, avgOverride) {
  const avg = avgOverride > 0 ? avgOverride : (staff ? wageTotal / staff : 0);
  const gap = Math.max(0, +(staff * 0.015 - disabled).toFixed(4));
  const base = +(gap * avg).toFixed(2);
  const ratio = staff ? disabled / staff : 0;
  const reliefRate = (staff > 0 && staff <= 30) ? 1 : (ratio >= 0.01 ? 0.5 : 0.1);
  const relief = +(base * reliefRate).toFixed(2);
  return { avg, gap, base, reliefRate, relief, due: +(base - relief).toFixed(2) };
}
S['iv-dbf'] = () => {
  if (!CUR_ENT) return needEnt('残保金申报');
  const y = IV.month.slice(0, 4);
  const key = 'dbf' + y;
  const adj = ivAdj(key);
  const w = ivWageBase(IV.month);
  // 年工资总额参考：本年 1 月至当前申报月的账上工资累计
  let yWage = 0;
  for (let m = 1; m <= +IV.month.slice(5, 7); m++) yWage += ivWageBase(y + '-' + String(m).padStart(2, '0')).total;
  const staff = +adj.staff || 0, disabled = +adj.disabled || 0;
  const wageTotal = +adj.wage || +yWage.toFixed(2);
  const c = ivDbfCalc(staff, wageTotal, disabled, +adj.avgWage || 0);
  const reliefName = c.reliefRate === 1 ? '免征（≤30人）' : c.reliefRate === 0.5 ? '减免 50%（安排≥1%）' : '减免 10%（安排不足1%）';
  return head('残疾人就业保障金申报', `${H(entName())} · ${y} 年度。按年申报（广东在电子税务局办，费款所属期为上一年度、次年申报——澳乐 2024 年度真表是 2025-11 受理的）。`, '纳税申报',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn" data-act="dbfSave">保存</button>
     <button class="btn" data-act="dbfVch">生成计提凭证</button>`)
    + kpis([
      { k: '本期应纳费额', v: money(c.base) },
      { k: '减免', v: reliefName.replace(/（.*/, ''), d: reliefName.replace(/.*（|）/g, '') || '' },
      { k: '本期应补（退）', v: money(c.due), t: c.due ? 'w' : 'g' },
      { k: '账上工资累计（1月至今）', v: money(+yWage.toFixed(2)) },
    ])
    + cardp('计算（申报口径全用「上年」数——真表列名就是「上年在职职工…」）', `<div class="cols c4">
      <div class="field"><label class="fl">上年在职职工人数（年平均，可带小数）</label><input type="number" step="0.0001" id="dbfStaff" value="${adj.staff || ''}" placeholder="如 32.3333"></div>
      <div class="field"><label class="fl">上年工资总额（留空=取本年账上累计，申报上年请自行填上年数）</label><input type="number" step="0.01" id="dbfWage" value="${adj.wage || ''}" placeholder="${yWage.toFixed(2)}"></div>
      <div class="field"><label class="fl">已安排残疾人就业人数</label><input type="number" step="0.01" id="dbfDisabled" value="${adj.disabled || ''}"></div>
      <div class="field"><label class="fl">年平均工资（超社平2倍时填封顶值）</label><input type="number" step="0.01" id="dbfAvg" value="${adj.avgWage || ''}" placeholder="${(staff ? wageTotal / staff : 0).toFixed(2)}"></div>
    </div>
    <div class="mut" style="margin-top:8px">当前口径：比例 1.5% · 计费平均工资 ${money(+c.avg.toFixed(2))} · 缺口 ${c.gap} 人 · ${reliefName}</div>`)
    + `<div class="note">公式（澳乐 2024 真表原样）：应纳 = （人数×1.5% − 已安排残疾人）× 年平均工资，
      再按档减免——<b>30 人及以下全免；安排比例 ≥1% 减 50%；不足 1%（含 0 人）减 10%</b>。
      平均工资超过当地社平 2 倍的按 2 倍封顶（澳乐 2024 按 36,292.00 计而非算术平均 73,133.90），封顶值以税局核定为准。
      验证例：(32.3333×1.5%−0)×36,292.00=17,601.62，减 10% → 实缴 15,841.46。
      计提分录：借 5602 管理费用 / 贷 222111 应交税费_残保金。</div>`
    + ivTieNote(w)
    + ivPortalCards(['etax']);
};

/* ============ 申报表 → 生成凭证 ============ */
/* 每张申报表可一键生成计提凭证，直接进凭证库：
   - 固定 id（按主体+税种+期间），重复点是覆盖不是重复入库
   - 一律「未过账」状态入库——申报数字该有人核对一遍再过账，
     报表首页的未过账检查会盯着它
   - 增值税本身在 T2 拆销项税时已逐笔计提，这里补的是月末那几笔：
     附加税费计提 / 小规模免税转收入 / 一般纳税人结转未交增值税 */
const ivMonthEnd = m => { const [y, mo] = m.split('-'); return m + '-' + String(new Date(+y, +mo, 0).getDate()).padStart(2, '0'); };
function ivPushVoucher(id, date, lines) {
  lines = lines.filter(l => l.dr > 0.005 || l.cr > 0.005);
  if (!lines.length) { toast('金额为零，本期无需生成凭证'); return; }
  const before = vchLoad(CUR_ENT);
  const list = before.filter(v => v.id !== id);
  const existed = list.length !== before.length;
  list.push({ id, period: date.slice(0, 7), date, word: '记', no: '税', posted: 0, src: '申报表生成', lines });
  vchSave(CUR_ENT, list);
  toast((existed ? '已重新生成（覆盖原凭证）' : '凭证已生成') + '：' + lines.length + ' 行，未过账。去凭证库核对后过账。', 5200);
  go('ac-vch');
}
const IVL = (acct, name, dr, cr, memo) => ({ acct, name, dr: +(+dr).toFixed(2), cr: +(+cr).toFixed(2), memo });

function ivVchVat() {
  const d = ivVatData();
  const isQ = d.p.type === 'small';
  const q = ivQuarterOf(IV.month);
  const date = ivMonthEnd(isQ ? q.to : IV.month);
  const memo = (isQ ? q.y + '年Q' + q.q : IV.month) + ' 增值税申报计提';
  const lines = [];
  if (d.p.type === 'small') {
    if (d.free) {
      // 免征：把本月已逐笔计提的销项税额转营业外收入（小企业准则做法）
      const acc = d.freeSaleTax || 0;   // 本季逐笔已计提的销项税额（票+无票）
      if (acc > 0.005) {
        lines.push(IVL('22210107', '应交税费_应交增值税_销项税额', acc, 0, memo + '（免征，销项税转收入）'));
        lines.push(IVL('5301', '营业外收入', 0, acc, memo + '（免征转收入）'));
      }
    } else if (d.vat > 0.005) {
      lines.push(IVL('5403', '税金及附加', d.sur.sum, 0, memo + '（附加税费）'));
      lines.push(IVL('222106', '应交税费_城建税', 0, d.sur.c, memo));
      lines.push(IVL('222107', '应交税费_教育费附加', 0, d.sur.e, memo));
      lines.push(IVL('222108', '应交税费_地方教育附加', 0, d.sur.l, memo));
    }
  } else {
    if (d.vat > 0.005) {
      lines.push(IVL('222101', '应交税费_应交增值税', d.vat, 0, memo + '（结转未交增值税）'));
      lines.push(IVL('222110', '应交税费_未交增值税', 0, d.vat, memo));
      lines.push(IVL('5403', '税金及附加', d.sur.sum, 0, memo + '（附加税费）'));
      lines.push(IVL('222106', '应交税费_城建税', 0, d.sur.c, memo));
      lines.push(IVL('222107', '应交税费_教育费附加', 0, d.sur.e, memo));
      lines.push(IVL('222108', '应交税费_地方教育附加', 0, d.sur.l, memo));
    }
  }
  ivPushVoucher('__tax_vat_' + (isQ ? q.y + 'q' + q.q : IV.month) + '__', date, lines);
}
function ivVchCit() {
  const q = ivQuarterOf(IV.month);
  const adj = ivAdj('q' + q.y + q.q);
  // 与页面同一套算法：这里只重算应补数，避免两处口径漂移
  let profit = 0;
  if ((adj.citSrc || 'book') === 'book') { profit = rptPlData(q.y + '-01-01', q.to + '-31').total; }
  else profit = numOf(adj.citProfit);
  const taxable = Math.max(0, +(profit - numOf(adj.loss)).toFixed(2));
  const due = +(taxable * (ivCitSmall(taxable).small ? 0.05 : 0.25)).toFixed(2);
  const pay = Math.max(0, +(due - numOf(adj.paid)).toFixed(2));
  const memo = q.y + '年Q' + q.q + ' 企业所得税预缴计提';
  ivPushVoucher('__tax_cit_' + q.y + 'q' + q.q + '__', ivMonthEnd(q.to), [
    IVL('5801', '所得税费用', pay, 0, memo),
    IVL('222105', '应交税费_应交企业所得税', 0, pay, memo),
  ]);
}
function ivVchStamp() {
  const p = ivProf();
  const adj = ivAdj('st' + IV.month);
  const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
  let total = 0;
  STAMP_ITEMS.forEach(it => { total += +((numOf(adj[it[0]]) || 0) * it[2] * k).toFixed(2); });
  total = +total.toFixed(2);
  const memo = IV.month + ' 印花税计提';
  ivPushVoucher('__tax_stamp_' + IV.month + '__', ivMonthEnd(IV.month), [
    IVL('5403', '税金及附加', total, 0, memo),
    IVL('222109', '应交税费_印花税', 0, total, memo),
  ]);
}

/* ============ 事件 ============ */
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'ivMonth') { if (t.value >= '2026-01') { IV.month = t.value; go(CURS); } return; }
  if (t.id === 'ivType' || t.id === 'ivRate' || t.id === 'ivHalve' || t.id === 'ivBiz' || t.id === 'ivCj') {
    const p = ivProf();
    if (t.id === 'ivType') p.type = t.value;
    if (t.id === 'ivRate') p.rate = +t.value;
    if (t.id === 'ivHalve') p.halve = t.checked ? 1 : 0;
    if (t.id === 'ivBiz') p.biz = t.value;
    if (t.id === 'ivCj') p.cjRate = +t.value;
    ivProfSave(p); go(CURS); return;
  }
  if (t.id === 'ivCarry') { const a = ivAdj(IV.month); a.carry = numOf(t.value); ivAdjSave(IV.month, a); go(CURS); return; }
  if (t.id === 'citStaff' || t.id === 'citAssets') {
    const p = ivProf();
    p[t.id === 'citStaff' ? 'staff' : 'assets'] = t.value === '' ? '' : numOf(t.value);
    ivProfSave(p); go(CURS); return;
  }
  if (t.name === 'citSrc') {
    const q = ivQuarterOf(IV.month); const key = 'q' + q.y + q.q;
    const a = ivAdj(key); a.citSrc = t.value; ivAdjSave(key, a); go(CURS); return;
  }
  if (t.id === 'citLoss' || t.id === 'citPaid') {
    const q = ivQuarterOf(IV.month); const key = 'q' + q.y + q.q;
    const a = ivAdj(key); a[t.id === 'citLoss' ? 'loss' : 'paid'] = numOf(t.value); ivAdjSave(key, a); go(CURS); return;
  }
});
document.addEventListener('click', e => {
  const del = e.target.closest('[data-ivdel]');
  if (del && CUR_ENT) {
    const [kind, id] = del.dataset.ivdel.split(':');
    const key = kind === 'in' ? IV_IN_KEY(CUR_ENT) : kind === 'out' ? IV_OUT_KEY(CUR_ENT) : IV_NOINV_KEY(CUR_ENT);
    ivSave(key, ivLoad(key).filter(x => (kind === 'noinv' ? x.id : x.no) !== id));
    toast('已删除'); go(CURS); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  if (act === 'dbfSave' || act === 'dbfVch') {
    const y = IV.month.slice(0, 4); const key = 'dbf' + y;
    const adj = ivAdj(key);
    adj.staff = numOf(($('dbfStaff') || {}).value); adj.wage = numOf(($('dbfWage') || {}).value);
    adj.disabled = numOf(($('dbfDisabled') || {}).value); adj.avgWage = numOf(($('dbfAvg') || {}).value);
    ivAdjSave(key, adj);
    if (act === 'dbfSave') { toast('已保存'); go('iv-dbf'); return; }
    // 与页面共用 ivDbfCalc，页面显示多少凭证就是多少
    let yWage = 0;
    for (let m = 1; m <= +IV.month.slice(5, 7); m++) yWage += ivWageBase(y + '-' + String(m).padStart(2, '0')).total;
    const staff = +adj.staff || 0, wageTotal = +adj.wage || +yWage.toFixed(2);
    const due = ivDbfCalc(staff, wageTotal, +adj.disabled || 0, +adj.avgWage || 0).due;
    const memo = y + ' 年残保金计提';
    ivPushVoucher('__tax_dbf_' + y + '__', ivMonthEnd(IV.month), [
      IVL('5602', '管理费用', due, 0, memo),
      IVL('222111', '应交税费_残疾人就业保障金', 0, due, memo)]);
    return;
  }
  if (act === 'ivVchVat') { ivVchVat(); return; }
  if (act === 'ivVchCit') { ivVchCit(); return; }
  if (act === 'ivVchStamp') { ivVchStamp(); return; }
  if (act === 'ivDyUp') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv';
    inp.onchange = () => { if (inp.files[0]) ivDyImport(inp.files[0]); };
    inp.click(); return;
  }
  if (act === 'ivIitUp') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv';
    inp.onchange = () => { if (inp.files[0]) ivIitImport(inp.files[0]); };
    inp.click(); return;
  }
  if (act === 'ivUpIn' || act === 'ivUpOut') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt';
    inp.onchange = () => { if (inp.files[0]) ivImport(inp.files[0], act === 'ivUpIn' ? 'in' : 'out'); };
    inp.click();
  } else if (act === 'nvAdd') {
    const gross = numOf(($('nvGross') || {}).value);
    if (!gross) { toast('先填含税金额'); return; }
    const rate = +(($('nvRate') || {}).value || ivProf().rate);
    const net = +(gross / (1 + rate)).toFixed(2);
    const list = ivLoad(IV_NOINV_KEY(CUR_ENT));
    const date = ($('nvDate') || {}).value || IV.month + '-15';
    list.push({ id: uid(), date, month: date.slice(0, 7), gross, rate, net,
      tax: +(gross - net).toFixed(2), memo: ($('nvMemo') || {}).value || '' });
    ivSave(IV_NOINV_KEY(CUR_ENT), list);
    toast('已添加'); go('iv-noinv');
  } else if (act === 'citSave') {
    const q = ivQuarterOf(IV.month); const key = 'q' + q.y + q.q;
    const adj = ivAdj(key);
    adj.citRev = numOf(($('citRev') || {}).value); adj.citCost = numOf(($('citCost') || {}).value);
    adj.citProfit = numOf(($('citProfit') || {}).value);
    ivAdjSave(key, adj); toast('已保存'); go('iv-cit');
  } else if (act === 'stampSave') {
    const key = 'st' + IV.month; const adj = ivAdj(key);
    document.querySelectorAll('[data-stamp]').forEach(el => { adj[el.dataset.stamp] = numOf(el.value); });
    ivAdjSave(key, adj); toast('印花税计税金额已保存'); go('iv-stamp');
  } else if (act === 'cultSave' || act === 'cultVch' || act === 'ivExpCult') {
    const key = 'cult' + IV.month; const adj = ivAdj(key);
    document.querySelectorAll('[data-cult]').forEach(el => { adj[el.dataset.cult] = numOf(el.value); });
    ivAdjSave(key, adj);
    const saleBase = Math.max(0, +((numOf(adj.inc) - numOf(adj.cut))).toFixed(2));
    const due = +(saleBase * IV_CULT_RATE).toFixed(2);
    const dueNet = Math.max(0, +(due - numOf(adj.relief)).toFixed(2));   // 计提按扣减免后的实缴口径
    if (act === 'cultSave') { toast('已保存'); go('iv-cult'); return; }
    if (act === 'cultVch') {
      const memo = IV.month + ' 文化事业建设费计提';
      ivPushVoucher('__tax_cult_' + IV.month + '__', ivMonthEnd(IV.month), [
        IVL('5403', '税金及附加', dueNet, 0, memo),
        IVL('222113', '应交税费_文化事业建设费', 0, dueNet, memo)]);
      return;
    }
    download(`文化事业建设费_${entName()}_${IV.month}.csv`, toCSV([
      ['栏次', '项目', '本期数'],
      ['1', '应征收入（含税）', numOf(adj.inc).toFixed(2)],
      ['2', '免征收入（暂不计入基数，以税局为准）', numOf(adj.freeInc).toFixed(2)],
      ['5', '本期减除额', numOf(adj.cut).toFixed(2)],
      ['8', '计费销售额', saleBase.toFixed(2)],
      ['9', '费率', '3%'],
      ['10', '应缴费额', due.toFixed(2)],
      ['—', '减免费额', numOf(adj.relief).toFixed(2)],
      ['13', '本期预缴费额', numOf(adj.pre).toFixed(2)],
      ['18', '本期应补（退）费额', (due - numOf(adj.relief) - numOf(adj.pre)).toFixed(2)],
    ])); toast('已导出'); go('iv-cult');
  } else if (act === 'ivExpVat') {
    const d = ivVatData();
    const rows = [...document.querySelectorAll('#view table tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
    const tag = d.p.type === 'small' ? d.q.y + 'Q' + d.q.q : IV.month;
    download(`增值税申报表_${entName()}_${tag}.csv`, toCSV(rows)); toast('已导出');
  } else if (act === 'ivExpCit') {
    toast('直接用页面数字抄进电子税务局；导出功能沿用页面表格', 3200);
    const q = ivQuarterOf(IV.month);
    const tbl = document.querySelector('#view table');
    if (tbl) {
      const rows = [...tbl.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
      download(`企业所得税预缴_${entName()}_${q.y}Q${q.q}.csv`, toCSV(rows));
    }
  } else if (act === 'ivExpStamp') {
    const key = 'st' + IV.month; const adj = ivAdj(key);
    const p = ivProf(); const k = (p.type === 'small' && p.halve) ? 0.5 : 1;
    const rows = [['税目', '税率', '计税金额', '应纳税额']];
    let total = 0;
    STAMP_ITEMS.forEach(it => {
      const base = numOf(adj[it[0]]); if (!base) return;
      const tax = +(base * it[2] * k).toFixed(2); total += tax;
      rows.push([it[1], it[2], base.toFixed(2), tax.toFixed(2)]);
    });
    rows.push(['合计', '', '', total.toFixed(2)]);
    download(`印花税申报表_${entName()}_${IV.month}.csv`, toCSV(rows)); toast('已导出');
  }
});
