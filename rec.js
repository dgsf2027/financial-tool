/* 往来对账 · 应收台账 + 应付台账 + 账龄分析 + 应收应付核销
   表体按负责人 2026-08-31 给的样表逐列实现（核销台账样式来自其 CSV）：
   - 应收台账 14 列（2026-08-31 二批拍板去掉「核销状态」列）：客户编码/名称/
     单据编号/类型/业务日期/到期日/币别/期初/本期应收/本期收款/期末余额/
     逾期标志/部门/业务员。期末 = 期初 + 应收 − 收款，判断全现算
   - 应付台账 15 列：供应商编码/名称/单据编号/类型/业务日期/到期日/币别/
     期初/本期应付/本期付款/本期冲销/期末余额/未结算金额/账龄区间/采购员。
     期末 = 期初 + 应付 − 付款 − 冲销；
     未结算金额 = 原币余额 − 已核销累计（核销流水驱动，见下）；
     账龄区间 = 挂账天数（今天 − 业务日期）分桶——注意与应收账龄页的
     「逾期天数」是两个口径，样表 S001 业务日 08-28 挂账 3 天 → 0-30天
   - 核销（样式照负责人 CSV：序列号/名称/业务日期/到期日/原币余额/
     本次核销金额/核销后余额/已核销累计/备注）：核销是独立流水
     fsc_rec_hx_<ent>，单据的「已核销累计」= Σ 流水（派生，不存冗余）；
     原币余额：应收 = 期初+应收，应付 = 期初+应付−冲销；
     核销后余额 = 原币 − 已核销，本次核销不许超过它
   - 账龄分析 10 列：从应收台账派生（见 recAging） */
'use strict';

const REC_AR_KEY = e => 'fsc_rec_ar_' + e + '_v1';
const REC_AP_KEY = e => 'fsc_rec_ap_' + e + '_v1';
const REC_HX_KEY = e => 'fsc_rec_hx_' + e + '_v1';
const REC_CFG_KEY = e => 'fsc_rec_cfg_' + e + '_v1';
const recLoad = () => { try { return JSON.parse(localStorage.getItem(REC_AR_KEY(CUR_ENT)) || '[]'); } catch (e) { return []; } };
const recSave = v => { try { localStorage.setItem(REC_AR_KEY(CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } };
const recApLoad = () => { try { return JSON.parse(localStorage.getItem(REC_AP_KEY(CUR_ENT)) || '[]'); } catch (e) { return []; } };
const recApSave = v => { try { localStorage.setItem(REC_AP_KEY(CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } };
const recHxLoad = () => { try { return JSON.parse(localStorage.getItem(REC_HX_KEY(CUR_ENT)) || '[]'); } catch (e) { return []; } };
const recHxSave = v => { try { localStorage.setItem(REC_HX_KEY(CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } };
function recCfg() {
  try { const c = JSON.parse(localStorage.getItem(REC_CFG_KEY(CUR_ENT)) || 'null'); if (c) return c; } catch (e) { /* 忽略 */ }
  return { r0: 0, r30: 0, r60: 0, r90: 10, r90p: 30 };   // 各桶坏账比例（%），61-90 档学自样表
}
const recCfgSave = c => { try { localStorage.setItem(REC_CFG_KEY(CUR_ENT), JSON.stringify(c)); } catch (e) { /* 忽略 */ } };

/* 本地日期（不能用 toISOString——它按 UTC，早上八点前会给出昨天，逾期判定会错一天） */
const recToday = () => new Date().toLocaleDateString('sv-SE');
const RECV = { edit: '', asof: recToday() };
const recEnd = x => +(((+x.open || 0) + (+x.ar || 0) - (+x.rec || 0))).toFixed(2);
/* 到期日必须是真日期才参与判定——normDate 兜底会把「月结30天」这类文本原样放行，
   拿它比大小/入桶全是错的，一律按「未填」处理并在台账标红提醒补 */
const recDueOk = x => !!(x.due && /^\d{4}-\d{2}-\d{2}$/.test(x.due));
/* 逾期标志——判断永远现算（pill 与 CSV 导出共用同一份文字，阈值只在这里） */
const recOdText = x => (recEnd(x) > 0.005 && recDueOk(x) && recToday() > x.due) ? '已逾期' : '未逾期';
const recOd = x => recOdText(x) === '已逾期' ? pill('已逾期', 'cr') : pill('未逾期', 'ok');
/* 应付：期末 = 期初 + 本期应付 − 本期付款 − 本期冲销 */
const recApEnd = x => +(((+x.open || 0) + (+x.ap || 0) - (+x.pay || 0) - (+x.offset || 0))).toFixed(2);
/* 原币余额（核销的基数）：应收 = 期初+应收；应付 = 期初+应付−冲销（冲销是单据金额的调整） */
const recGross = (kind, x) => kind === 'ap'
  ? +(((+x.open || 0) + (+x.ap || 0) - (+x.offset || 0))).toFixed(2)
  : +(((+x.open || 0) + (+x.ar || 0))).toFixed(2);
/* 某张单据的已核销累计 = Σ 核销流水（派生，不在单据上存冗余字段） */
function recHxSum(kind, docId) {
  return +recHxLoad().reduce((s, h) => s + ((h.kind === kind && h.docId === docId) ? (+h.amt || 0) : 0), 0).toFixed(2);
}
/* 客户/供应商候选名单：本主体的名册（基础→客户/供应商维护）∪ 台账里出现过的名字。
   返回 Map(name → 编码)。名册和台账全都按主体存，切主体各是各的一套 */
function recNameOptions(kind) {
  const m = new Map();
  try {
    if (typeof dimLoad === 'function') {
      dimLoad(kind === 'ap' ? 'supp' : 'cust').forEach(x => { if (x.name && !x.off) m.set(x.name, x.code || ''); });
    }
  } catch (e) { /* 名册模块不可用时只用台账名字 */ }
  (kind === 'ap' ? recApLoad() : recLoad()).forEach(x => { if (x.name && !m.has(x.name)) m.set(x.name, x.cust || ''); });
  return m;
}
const recDatalist = (id, kind) => `<datalist id="${id}">${
  [...recNameOptions(kind).keys()].map(n => `<option value="${H(n)}">`).join('')}</datalist>`;

/* 挂账账龄区间（应付台账列用）：今天 − 业务日期。与应收账龄页的「逾期天数」是两个口径 */
function recAgeBand(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
  const d = Math.round((new Date(recToday()) - new Date(date)) / 86400000);
  return d <= 30 ? '0-30天' : d <= 60 ? '31-60天' : d <= 90 ? '61-90天' : '90天以上';
}
/* 单据编号发生器：扫描同日期前缀的最大序号 +1。
   绝不能用 list.length——删过单据后会撞上还活着的旧号，导入的覆盖逻辑
   会把无关旧单整个冲掉（盲审 P1）。 */
function recNextNo(list, date, kindPre) {
  const pre = (kindPre || 'AR') + String(date || recToday()).replace(/-/g, '') + '-';
  let max = 0;
  list.forEach(x => {
    if (x.no && String(x.no).startsWith(pre)) {
      const n = +String(x.no).slice(pre.length);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  });
  return pre + String(max + 1).padStart(3, '0');
}

/* ============ 账龄分桶（账龄页与看板共用这一份口径） ============ */
function recAging(asof) {
  const by = {};
  recLoad().forEach(x => {
    const end = recEnd(x);
    if (Math.abs(end) < 0.005) return;               // 已核销的单不进账龄
    const k = (x.cust || '') + '|' + (x.name || '');
    const g = by[k] = by[k] || { cust: x.cust || '', name: x.name || '', total: 0, b: [0, 0, 0, 0, 0] };
    g.total = +(g.total + end).toFixed(2);
    // 逾期天数 = 截至日 − 到期日；到期日没填或不是合法日期，一律按未到期
    // （不校验的话 new Date('月结30天') 是 NaN，比较全 false 会静默滑进 90+ 桶、
    //   计 30% 坏账还标「可疑」——坏输入必须落最保守的桶并提示去补）
    const ok = recDueOk(x);
    const d = ok ? Math.round((new Date(asof) - new Date(x.due)) / 86400000) : 0;
    const i = (!ok || d <= 0) ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
    g.b[i] = +(g.b[i] + end).toFixed(2);
  });
  const cfg = recCfg();
  const rates = [cfg.r0, cfg.r30, cfg.r60, cfg.r90, cfg.r90p].map(r => (+r || 0) / 100);
  const rows = Object.values(by).sort((a, b) => b.total - a.total);
  rows.forEach(g => {
    g.bad = +g.b.reduce((s, v, i) => s + Math.max(0, v) * rates[i], 0).toFixed(2);
    g.risk = g.b[4] > 0.005 ? 2 : (g.b[2] > 0.005 || g.b[3] > 0.005) ? 1 : 0;
  });
  return rows;
}

/* ============ 应收账款台账 ============ */
S['p-rec-ar'] = () => {
  if (!CUR_ENT) return needEnt('应收账款台账');
  const list = recLoad().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const editing = RECV.edit ? list.find(x => x.id === RECV.edit) : null;
  const tEnd = +list.reduce((s, x) => s + recEnd(x), 0).toFixed(2);
  const tOd = +list.reduce((s, x) => s + ((recEnd(x) > 0.005 && recDueOk(x) && recToday() > x.due) ? recEnd(x) : 0), 0).toFixed(2);

  const F = (id, ph, v, w) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" value="${v == null ? '' : H(String(v))}" style="${w ? 'width:' + w : ''}"></div>`;
  const FN = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" type="number" step="0.01" value="${v == null || v === '' ? '' : H(String(v))}" placeholder="0.00"></div>`;
  const FD = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" type="date" value="${v || ''}"></div>`;
  const e0 = editing || {};
  const form = cardp(editing ? `编辑单据 ${H(editing.no || '')}` : '新增应收单', `
    <div class="cols c4">
      ${F('rcCust', '客户编码（选了名称且此格为空时自动带出）', e0.cust)}
      <div class="field"><label class="fl">客户名称 *（可从名册选）</label>
        <input id="rcName" list="recNames" value="${e0.name == null ? '' : H(String(e0.name))}"></div>
      ${recDatalist('recNames', 'ar')}
      ${F('rcNo', '单据编号（空=自动编号）', e0.no)}${F('rcType', '单据类型', e0.type || '标准应收单')}
      ${FD('rcDate', '业务日期', e0.date || recToday())}${FD('rcDue', '到期日', e0.due)}
      ${F('rcCcy', '币别', e0.ccy || 'RMB')}${FN('rcOpen', '期初余额', e0.open)}
      ${FN('rcAr', '本期应收', e0.ar)}${FN('rcRec', '本期收款', e0.rec)}
      ${F('rcDept', '部门', e0.dept)}${F('rcSales', '业务员', e0.sales)}
    </div>
    <div style="text-align:right;margin-top:9px">
      ${editing ? '<button class="btn" data-act="recCancel">取消</button> ' : ''}
      <button class="btn pri" data-act="recSaveForm">${editing ? '保存修改' : '新增单据'}</button></div>`);

  const rows = list.map(x => [
    `<span class="code">${H(x.cust || '—')}</span>`, H(x.name || '—'),
    `<span class="code">${H(x.no || '—')}</span>`, H(x.type || '—'),
    H(x.date || '—'),
    recDueOk(x) ? H(x.due) : (x.due ? `<span class="red" title="${H(x.due)}">无效日期</span>` : '<span class="red">未填</span>'),
    H(x.ccy || 'RMB'),
    money(+x.open || 0), money(+x.ar || 0), money(+x.rec || 0),
    `<b>${money(recEnd(x))}</b>`, recOd(x), H(x.dept || '—'), H(x.sales || '—'),
    `<button class="btn sm" data-recedit="${H(x.id)}">编辑</button>
     <button class="btn sm" data-recdel="${H(x.id)}">删除</button>`,
  ]);
  return head('应收账款台账', `${H(entName())} · 期末余额 = 期初 + 本期应收 − 本期收款；逾期标志按数字现算，不用手填。收到款就编辑那张单、改「本期收款」；核销去「应收及应付核销」页做。`, '往来对账',
    `<button class="btn" data-act="recTpl">下载模板</button>
     <button class="btn" data-act="recUp">导入台账(Excel)</button>
     <button class="btn" data-go="p-rec-ap">应付台账</button>
     <button class="btn" data-go="p-rec-hx">核销</button>
     <button class="btn" data-go="p-rec-aging">账龄分析 →</button>
     <button class="btn pri" data-act="recExp">导出</button>`)
    + kpis([
      { k: '单据数', v: String(list.length), u: '张' },
      { k: '期末余额合计', v: money(tEnd) },
      { k: '其中已逾期', v: money(tOd), t: tOd > 0.005 ? 'c' : 'g' },
      { k: '本期收款合计', v: money(+list.reduce((s, x) => s + (+x.rec || 0), 0).toFixed(2)) },
    ])
    + form
    + card('台账', rows.length ? table(
      [{ t: '客户编码' }, { t: '客户名称' }, { t: '单据编号' }, { t: '单据类型' }, { t: '业务日期' }, { t: '到期日' }, { t: '币别' },
       { t: '期初余额', n: 1 }, { t: '本期应收', n: 1 }, { t: '本期收款', n: 1 }, { t: '期末余额', n: 1 },
       { t: '逾期标志' }, { t: '部门' }, { t: '业务员' }, { t: '' }], rows,
      ['<b>合计</b>', '', '', '', '', '', '',
       `<b>${money(+list.reduce((s, x) => s + (+x.open || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.ar || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.rec || 0), 0).toFixed(2))}</b>`,
       `<b>${money(tEnd)}</b>`, '', '', '', ''])
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有应收单——上面表单手工新增，或导入 Excel（列名对着模板）</div>`);
};

/* ============ 账龄分析 ============ */
S['p-rec-aging'] = () => {
  if (!CUR_ENT) return needEnt('账龄与催收');
  const cfg = recCfg();
  const rows0 = recAging(RECV.asof);
  const tTotal = +rows0.reduce((s, g) => s + g.total, 0).toFixed(2);
  const tB = [0, 1, 2, 3, 4].map(i => +rows0.reduce((s, g) => s + g.b[i], 0).toFixed(2));
  const tBad = +rows0.reduce((s, g) => s + g.bad, 0).toFixed(2);
  const nRisk = rows0.filter(g => g.risk === 2).length;
  const riskPill = r => r === 2 ? pill('可疑', 'cr') : r === 1 ? pill('关注', 'wa') : pill('正常', 'ok');
  const rows = rows0.map(g => [
    `<span class="code">${H(g.cust || '—')}</span>`, H(g.name || '—'),
    `<b>${money(g.total)}</b>`, money(g.b[0]), money(g.b[1]), money(g.b[2]), money(g.b[3]),
    g.b[4] > 0.005 ? `<b class="red">${money(g.b[4])}</b>` : money(g.b[4]),
    money(g.bad), riskPill(g.risk),
  ]);
  const rateInp = (k, v) => `<input type="number" step="1" min="0" max="100" data-reccfg="${k}" value="${H(String(v))}" style="width:64px"> %`;
  return head('账龄与催收', `${H(entName())} · 从应收台账<b>自动算出来</b>，不用重复录。每张未核销单据按「截至日 − 到期日」入桶，客户行是合计。`, '往来对账',
    `<span class="mut" style="font-size:12px">账龄截至</span> <input type="date" id="recAsof" value="${RECV.asof}">
     <button class="btn" data-go="p-rec-ar">← 应收台账</button>
     <button class="btn pri" data-act="recAgExp">导出</button>`)
    + kpis([
      { k: '应收账款总额', v: money(tTotal) },
      { k: '已逾期合计', v: money(+(tB[1] + tB[2] + tB[3] + tB[4]).toFixed(2)), t: (tB[1] + tB[2] + tB[3] + tB[4]) > 0.005 ? 'c' : 'g' },
      { k: '坏账准备估计', v: money(tBad), t: tBad > 0.005 ? 'w' : 'g' },
      { k: '可疑客户', v: String(nRisk), u: '户', t: nRisk ? 'c' : 'g' },
    ])
    + cardp('坏账比例（各账龄档 × 比例 = 估计数，按你们口径调）', `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
        <span>未到期 ${rateInp('r0', cfg.r0)}</span><span>0-30天 ${rateInp('r30', cfg.r30)}</span>
        <span>31-60天 ${rateInp('r60', cfg.r60)}</span><span>61-90天 ${rateInp('r90', cfg.r90)}</span>
        <span>90天以上 ${rateInp('r90p', cfg.r90p)}</span>
        <span class="mut" style="font-size:11px">改了即存即算；61-90 默认 10% 学自样表（30,000×10%=3,000）</span></div>`)
    + card('账龄分析（截至 ' + H(RECV.asof) + '）', rows.length ? table(
      [{ t: '客户编码' }, { t: '客户名称' }, { t: '应收账款总额', n: 1 }, { t: '未到期', n: 1 }, { t: '0-30天', n: 1 },
       { t: '31-60天', n: 1 }, { t: '61-90天', n: 1 }, { t: '90天以上', n: 1 }, { t: '坏账准备估计', n: 1 }, { t: '风险等级' }], rows,
      ['<b>合计</b>', '', `<b>${money(tTotal)}</b>`, `<b>${money(tB[0])}</b>`, `<b>${money(tB[1])}</b>`,
       `<b>${money(tB[2])}</b>`, `<b>${money(tB[3])}</b>`, `<b>${money(tB[4])}</b>`, `<b>${money(tBad)}</b>`, ''])
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">台账里还没有未核销的应收单——先去「应收账单」录入或导入</div>`)
    + `<div class="note"><b>催收优先级：</b>先追「90天以上」（红字），再追 61-90；风险等级=可疑的客户建议停止赊销。风险规则：90天以上有余额 → 可疑；31-90 天有 → 关注。</div>`
    + `<div class="note"><b>口径说明：</b>「0-30天」装的是逾期 1〜30 天，到期当天算未到期（与台账「未逾期」口径一致）；
      到期日没填或不是合法日期的单据按未到期算——去台账把标红的补上，账龄才准。
      客户按「编码+名称」归并：同一客户部分单据没填编码会分成两行，编码补齐自然合并。</div>`;
};

/* ============ 应付账款台账 ============ */
S['p-rec-ap'] = () => {
  if (!CUR_ENT) return needEnt('应付账款台账');
  const list = recApLoad().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const editing = RECV.apEdit ? list.find(x => x.id === RECV.apEdit) : null;
  const tEnd = +list.reduce((s, x) => s + recApEnd(x), 0).toFixed(2);
  const tUnhx = +list.reduce((s, x) => s + Math.max(0, recGross('ap', x) - recHxSum('ap', x.id)), 0).toFixed(2);
  const tOd = +list.reduce((s, x) => s + ((recApEnd(x) > 0.005 && recDueOk(x) && recToday() > x.due) ? recApEnd(x) : 0), 0).toFixed(2);

  const F = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" value="${v == null ? '' : H(String(v))}"></div>`;
  const FN = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" type="number" step="0.01" value="${v == null || v === '' ? '' : H(String(v))}" placeholder="0.00"></div>`;
  const FD = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" type="date" value="${v || ''}"></div>`;
  const e0 = editing || {};
  const form = cardp(editing ? `编辑单据 ${H(editing.no || '')}` : '新增应付单', `
    <div class="cols c4">
      ${F('apCust', '供应商编码（选了名称且此格为空时自动带出）', e0.cust)}
      <div class="field"><label class="fl">供应商名称 *（可从名册选）</label>
        <input id="apName" list="apNames" value="${e0.name == null ? '' : H(String(e0.name))}"></div>
      ${recDatalist('apNames', 'ap')}
      ${F('apNo', '单据编号（空=自动编号）', e0.no)}${F('apType', '单据类型', e0.type || '标准采购应付')}
      ${FD('apDate', '业务日期', e0.date || recToday())}${FD('apDue', '到期日', e0.due)}
      ${F('apCcy', '币别', e0.ccy || 'RMB')}${FN('apOpen', '期初余额', e0.open)}
      ${FN('apAp', '本期应付', e0.ap)}${FN('apPay', '本期付款', e0.pay)}
      ${FN('apOffset', '本期冲销', e0.offset)}${F('apBuyer', '采购员', e0.buyer)}
    </div>
    <div style="text-align:right;margin-top:9px">
      ${editing ? '<button class="btn" data-act="apCancel">取消</button> ' : ''}
      <button class="btn pri" data-act="apSaveForm">${editing ? '保存修改' : '新增单据'}</button></div>`);

  const rows = list.map(x => {
    const unhx = +(recGross('ap', x) - recHxSum('ap', x.id)).toFixed(2);
    return [
      `<span class="code">${H(x.cust || '—')}</span>`, H(x.name || '—'),
      `<span class="code">${H(x.no || '—')}</span>`, H(x.type || '—'),
      H(x.date || '—'),
      recDueOk(x) ? H(x.due) : (x.due ? `<span class="red" title="${H(x.due)}">无效日期</span>` : '<span class="red">未填</span>'),
      H(x.ccy || 'RMB'),
      money(+x.open || 0), money(+x.ap || 0), money(+x.pay || 0), money(+x.offset || 0),
      `<b>${money(recApEnd(x))}</b>`,
      unhx < -0.005 ? `<b class="red" title="已核销累计超过原币余额——多半是导入覆盖调小了金额，去核销页撤多余的">超核 ${money(-unhx)}</b>`
        : unhx > 0.005 ? money(unhx) : `<span class="mut">${money(0)}</span>`,
      H(recAgeBand(x.date)), H(x.buyer || '—'),
      `<button class="btn sm" data-apedit="${H(x.id)}">编辑</button>
       <button class="btn sm" data-apdel="${H(x.id)}">删除</button>`,
    ];
  });
  return head('应付账款台账', `${H(entName())} · 期末余额 = 期初 + 本期应付 − 本期付款 − 本期冲销；未结算金额 = 原币余额（期初+应付−冲销）− 已核销累计，核销去「应收及应付核销」页做。账龄区间按挂账天数（今天 − 业务日期）。`, '往来对账',
    `<button class="btn" data-act="apTpl">下载模板</button>
     <button class="btn" data-act="apUp">导入台账(Excel)</button>
     <button class="btn" data-go="p-rec-ar">应收台账</button>
     <button class="btn" data-go="p-rec-hx">核销 →</button>
     <button class="btn pri" data-act="apExp">导出</button>`)
    + kpis([
      { k: '单据数', v: String(list.length), u: '张' },
      { k: '期末余额合计', v: money(tEnd) },
      { k: '未结算金额合计', v: money(tUnhx), t: tUnhx > 0.005 ? 'w' : 'g' },
      { k: '其中已逾期', v: money(tOd), t: tOd > 0.005 ? 'c' : 'g' },
    ])
    + form
    + card('台账', rows.length ? table(
      [{ t: '供应商编码' }, { t: '供应商名称' }, { t: '单据编号' }, { t: '单据类型' }, { t: '业务日期' }, { t: '到期日' }, { t: '币别' },
       { t: '期初余额', n: 1 }, { t: '本期应付', n: 1 }, { t: '本期付款', n: 1 }, { t: '本期冲销', n: 1 },
       { t: '期末余额', n: 1 }, { t: '未结算金额', n: 1 }, { t: '账龄区间' }, { t: '采购员' }, { t: '' }], rows,
      ['<b>合计</b>', '', '', '', '', '', '',
       `<b>${money(+list.reduce((s, x) => s + (+x.open || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.ap || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.pay || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.offset || 0), 0).toFixed(2))}</b>`,
       `<b>${money(tEnd)}</b>`, `<b>${money(tUnhx)}</b>`, '', '', ''])
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有应付单——上面表单手工新增，或导入 Excel（列名对着模板）</div>`);
};

/* ============ 应收及应付核销 ============ */
/* 台账样式照负责人 2026-08-31 的核销 CSV：序列号/名称/业务日期/到期日/
   原币余额/本次核销金额/核销后余额/已核销累计/备注。
   核销是流水：这页录「本次核销」批量保存 → 每笔进 fsc_rec_hx，
   单据的已核销累计与两张台账的「未结算金额」全部由流水派生。 */
S['p-rec-hx'] = () => {
  if (!CUR_ENT) return needEnt('应收及应付核销');
  const kind = RECV.hxKind === 'ap' ? 'ap' : 'ar';
  const isAp = kind === 'ap';
  const q = String(RECV.hxQ || '').trim().toLowerCase();
  const docs = (isAp ? recApLoad() : recLoad())
    .map(x => ({ x, gross: recGross(kind, x), done: recHxSum(kind, x.id) }))
    .map(d => Object.assign(d, { left: +(d.gross - d.done).toFixed(2) }))
    .filter(d => d.left > 0.005)
    .filter(d => !q || `${d.x.name || ''}|${d.x.cust || ''}|${d.x.no || ''}`.toLowerCase().includes(q))
    .sort((a, b) => String(a.x.due || '9999').localeCompare(String(b.x.due || '9999')));
  const tGross = +docs.reduce((s, d) => s + d.gross, 0).toFixed(2);
  const tDone = +docs.reduce((s, d) => s + d.done, 0).toFixed(2);
  const rows = docs.map((d, i) => [
    String(i + 1), H(d.x.name || '—') + `<div class="mut" style="font-size:11px">${H(d.x.no || '')}</div>`,
    H(d.x.date || '—'), recDueOk(d.x) ? H(d.x.due) : '<span class="mut">—</span>',
    money(d.gross),
    `<input type="number" step="0.01" min="0" class="obin" data-hxamt="${H(d.x.id)}" placeholder="0.00">`,
    money(d.left), money(d.done),
    `<input class="obin" data-hxmemo="${H(d.x.id)}" placeholder="如：银行转账 / 8月第一批" style="min-width:130px">`,
  ]);
  const hist = recHxLoad().filter(h => h.kind === kind).slice(-20).reverse();
  const docName = id => {
    const l = isAp ? recApLoad() : recLoad();
    const x = l.find(y => y.id === id);
    return x ? (x.name + '（' + (x.no || '') + '）') : '（单据已删除）';
  };
  const histRows = hist.map(h => [H(h.date), H(docName(h.docId)), money(+h.amt || 0), H(h.memo || '—'),
    `<button class="btn sm" data-hxdel="${H(h.id)}">撤销</button>`]);
  return head('应收及应付核销', `${H(entName())} · 台账样式照核销样表。填「本次核销金额」点保存，一次可核多张；核销后余额 = 原币余额 − 已核销累计，<b>本次核销不能超过核销后余额</b>。`, '往来对账',
    `<select id="hxKind"><option value="ar" ${!isAp ? 'selected' : ''}>应收核销</option><option value="ap" ${isAp ? 'selected' : ''}>应付核销</option></select>
     <input id="hxQ" list="hxNames" value="${H(RECV.hxQ || '')}" placeholder="搜${isAp ? '供应商' : '客户'}/编码/单号…" style="min-width:170px">
     ${recDatalist('hxNames', kind)}
     ${q ? '<button class="btn" data-act="hxQClear">清除筛选</button>' : ''}
     <button class="btn" data-go="${isAp ? 'p-rec-ap' : 'p-rec-ar'}">← ${isAp ? '应付' : '应收'}台账</button>
     <button class="btn pri" data-act="hxSave">保存本次核销</button>`)
    + kpis([
      { k: (isAp ? '待核销单据' : '待核销单据'), v: String(docs.length), u: '张' },
      { k: '原币余额合计', v: money(tGross) },
      { k: '本页单据已核销', v: money(tDone), d: '核满的单不在本页', t: tDone > 0.005 ? 'g' : '' },
      { k: '未核销合计', v: money(+(tGross - tDone).toFixed(2)), t: (tGross - tDone) > 0.005 ? 'w' : 'g' },
    ])
    + (q ? `<div class="note">已按「<b>${H(RECV.hxQ)}</b>」筛选，命中 ${docs.length} 张——合计与 KPI 都只算筛出来的这些。名字可以从输入框的下拉里选（来自本主体的客户/供应商名册和台账）。</div>` : '')
    + card((isAp ? '应付' : '应收') + '核销台账（只列还没核完的单据）', rows.length ? table(
      [{ t: '序列号' }, { t: isAp ? '供应商名称' : '客户名称' }, { t: '业务日期' }, { t: '到期日' },
       { t: '原币余额', n: 1 }, { t: '本次核销金额', n: 1 }, { t: '核销后余额', n: 1 }, { t: '已核销累计', n: 1 }, { t: '备注' }], rows,
      ['<b>合计</b>', '', '', '', `<b>${money(tGross)}</b>`, '', `<b>${money(+(tGross - tDone).toFixed(2))}</b>`, `<b>${money(tDone)}</b>`, ''])
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">${q ? `没有匹配「${H(RECV.hxQ)}」的待核销单据——试试清除筛选` : `没有待核销的${isAp ? '应付' : '应收'}单据——台账里录了单才有得核`}</div>`)
    + `<div class="note"><b>口径：</b>核销是「款项与单据的勾对确认」，独立于收付款：${isAp
      ? '付了款（台账「本期付款」）不等于核销过——两边都记，未结算金额才对'
      : '收了款（台账「本期收款」）不等于核销过——两边都记'}。撤销一笔核销即恢复该单的可核余额。</div>`
    + (histRows.length ? card('核销记录（最近 20 笔，撤销即回滚）', table(
      [{ t: '核销日期' }, { t: '单据' }, { t: '金额', n: 1 }, { t: '备注' }, { t: '' }], histRows)) : '');
};

/* ============ 导入 / 导出 ============ */
const REC_ALIAS = {
  cust: ['客户编码', '客户代码'], name: ['客户名称', '客户'], no: ['单据编号', '单号', '发票号码', '发票号'],
  type: ['单据类型', '类型'], date: ['业务日期', '单据日期', '开单日期', '日期'], due: ['到期日', '到期日期', '应收日期'],
  ccy: ['币别', '币种'], open: ['期初余额', '期初'], ar: ['本期应收', '应收金额', '应收'],
  rec: ['本期收款', '收款金额', '已收金额', '已收'], dept: ['部门'], sales: ['业务员', '销售员', '经办人'],
};
const REC_AP_ALIAS = {
  cust: ['供应商编码', '供应商代码'], name: ['供应商名称', '供应商'], no: ['单据编号', '单号', '发票号码'],
  type: ['单据类型', '类型'], date: ['业务日期', '单据日期', '开单日期', '日期'], due: ['到期日', '到期日期', '应付日期'],
  ccy: ['币别', '币种'], open: ['期初余额', '期初'], ap: ['本期应付', '应付金额', '应付'],
  pay: ['本期付款', '付款金额', '已付金额', '已付'], offset: ['本期冲销', '冲销金额', '冲销'], buyer: ['采购员', '采购'],
};
function recMap(header, aliases) {
  const A = aliases || REC_ALIAS;
  const cells = header.map(h => String(h == null ? '' : h).replace(/\s/g, ''));
  const map = {}, used = new Set();
  [1, 0].forEach(exact => Object.keys(A).forEach(k => {
    if (map[k] !== undefined) return;
    for (const a of A[k]) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && (exact ? c === a : c.includes(a)));
      if (i >= 0) { map[k] = i; used.add(i); return; }
    }
  }));
  return map;
}
async function recApImport(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, Object.values(REC_AP_ALIAS).flat());
    const map = recMap(rows[hr] || [], REC_AP_ALIAS);
    if (map.name === undefined || (map.ap === undefined && map.open === undefined)) {
      toast('缺少必备列：供应商名称，以及 本期应付 或 期初余额 至少一列', 5200); return;
    }
    const list = recApLoad();
    const byNo = {};
    list.forEach(x => { if (x.no) byNo[x.no] = x; });
    const dOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    let add = 0, upd = 0, skip = 0, autoNo = 0, badDue = 0;
    rows.slice(hr + 1).forEach(r => {
      const g = k => (map[k] === undefined ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim());
      const name = g('name');
      if (!name || /^合计|^总计/.test(g('cust') + name)) { if (r.some(c => String(c == null ? '' : c).trim())) skip++; return; }
      const rawDate = normDate(g('date')), rawDue = normDate(g('due'));
      if (g('due') && !dOk(rawDue)) badDue++;
      const rec0 = {
        cust: g('cust'), name, type: g('type') || '标准采购应付',
        date: dOk(rawDate) ? rawDate : recToday(), due: dOk(rawDue) ? rawDue : '',
        ccy: g('ccy') || 'RMB', open: numOf(g('open')), ap: numOf(g('ap')), pay: numOf(g('pay')),
        offset: numOf(g('offset')), buyer: g('buyer'),
      };
      let no = g('no');
      if (!no) { no = recNextNo(list, rec0.date, 'AP'); autoNo++; }
      if (byNo[no]) { Object.assign(byNo[no], rec0, { no }); upd++; }
      else { const nx = Object.assign({ id: uid(), no }, rec0); list.push(nx); byNo[no] = nx; add++; }
    });
    recApSave(list);
    toast(`导入完成：新增 ${add} 张、按单据编号覆盖 ${upd} 张` + (skip ? `、无供应商名跳过 ${skip} 行` : '')
      + (badDue ? `；${badDue} 行到期日不是日期已置空` : '')
      + (autoNo ? `；${autoNo} 行无单据编号已自动编号——重复导入这些行会叠加` : ''), autoNo || badDue ? 8000 : 5600);
    go('p-rec-ap');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}
async function recImport(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, Object.values(REC_ALIAS).flat());
    const map = recMap(rows[hr] || []);
    if (map.name === undefined || (map.ar === undefined && map.open === undefined)) {
      toast('缺少必备列：客户名称，以及 本期应收 或 期初余额 至少一列', 5200); return;
    }
    const list = recLoad();
    const byNo = {};
    list.forEach(x => { if (x.no) byNo[x.no] = x; });
    // normDate 兜底会放行非日期文本，必须再验格式——坏到期日进了账龄会污染坏账数
    const dOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    let add = 0, upd = 0, skip = 0, autoNo = 0, badDue = 0;
    rows.slice(hr + 1).forEach(r => {
      const g = k => (map[k] === undefined ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim());
      const name = g('name');
      if (!name || /^合计|^总计/.test(g('cust') + name)) { if (r.some(c => String(c == null ? '' : c).trim())) skip++; return; }
      const rawDate = normDate(g('date')), rawDue = normDate(g('due'));
      if (g('due') && !dOk(rawDue)) badDue++;
      const rec0 = {
        cust: g('cust'), name, type: g('type') || '标准应收单',
        date: dOk(rawDate) ? rawDate : recToday(), due: dOk(rawDue) ? rawDue : '',
        ccy: g('ccy') || 'RMB', open: numOf(g('open')), ar: numOf(g('ar')), rec: numOf(g('rec')),
        dept: g('dept'), sales: g('sales'),
      };
      let no = g('no');
      // 覆盖语义只属于「文件里显式写了」的编号；自动编号扫最大序号取空号，永不撞旧单
      if (!no) { no = recNextNo(list, rec0.date); autoNo++; }
      if (byNo[no]) { Object.assign(byNo[no], rec0, { no }); upd++; }
      else { const nx = Object.assign({ id: uid(), no }, rec0); list.push(nx); byNo[no] = nx; add++; }
    });
    recSave(list);
    toast(`导入完成：新增 ${add} 张、按单据编号覆盖 ${upd} 张` + (skip ? `、无客户名跳过 ${skip} 行` : '')
      + (badDue ? `；${badDue} 行到期日不是日期已置空（去台账补）` : '')
      + (autoNo ? `；${autoNo} 行没有单据编号已自动编号——这些行重复导入会叠加，源表带编号列才幂等` : ''),
      autoNo || badDue ? 8000 : 5600);
    go('p-rec-ar');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}

/* ============ 事件 ============ */
document.addEventListener('click', e => {
  const ed = e.target.closest('[data-recedit]');
  if (ed) { RECV.edit = ed.dataset.recedit; go('p-rec-ar'); return; }
  const dl = e.target.closest('[data-recdel]');
  if (dl && CUR_ENT) {
    const list = recLoad(); const x = list.find(v => v.id === dl.dataset.recdel);
    if (!x || !confirm(`确认删除单据 ${x.no || ''}（${x.name}）？其核销记录保留在核销页可撤。`)) return;
    if (RECV.edit === x.id) RECV.edit = '';   // 正在编辑的单被删，编辑态一起清，防吞掉后续新增
    recSave(list.filter(v => v.id !== x.id));
    toast('已删除'); go('p-rec-ar'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  if (act === 'recCancel') { RECV.edit = ''; go('p-rec-ar'); return; }
  if (act === 'recSaveForm') {
    const v = id => (($(id) || {}).value || '').trim();
    const name = v('rcName');
    if (!name) { toast('客户名称不能为空'); return; }
    const list = recLoad();
    const rec0 = {
      cust: v('rcCust'), name, type: v('rcType') || '标准应收单',
      date: v('rcDate') || recToday(), due: v('rcDue'), ccy: v('rcCcy') || 'RMB',
      open: numOf(v('rcOpen')), ar: numOf(v('rcAr')), rec: numOf(v('rcRec')),
      dept: v('rcDept'), sales: v('rcSales'),
    };
    if (RECV.edit) {
      const x = list.find(y => y.id === RECV.edit);
      if (x) {
        const newNo = v('rcNo') || x.no;
        // 编辑也要查编号唯一，否则改出重复编号后导入的覆盖逻辑会指鹿为马
        if (list.some(y => y.id !== x.id && y.no === newNo)) { toast('单据编号已被别的单占用：' + newNo); return; }
        Object.assign(x, rec0, { no: newNo });
        RECV.edit = '';
        recSave(list); toast('已保存'); go('p-rec-ar'); return;
      }
      // 编辑目标已不存在（被删/切了主体）——不能装作保存成功，降级按新增走
      RECV.edit = '';
    }
    const no = v('rcNo') || recNextNo(list, rec0.date);
    if (list.some(x => x.no === no)) { toast('单据编号已存在：' + no); return; }
    list.push(Object.assign({ id: uid(), no }, rec0));
    recSave(list); toast('已新增 ' + no); go('p-rec-ar'); return;
  }
  if (act === 'recUp') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt';
    inp.onchange = () => { if (inp.files[0]) recImport(inp.files[0]); };
    inp.click(); return;
  }
  if (act === 'recTpl') {
    download('应收台账导入模板.csv', toCSV([
      ['客户编码', '客户名称', '单据编号', '单据类型', '业务日期', '到期日', '币别', '期初余额', '本期应收', '本期收款', '部门', '业务员'],
      ['C001', '深圳XX科技', 'AR20260831-001', '标准应收单', '2026-08-31', '2026-09-30', 'RMB', '12300', '15000', '5000', '销售一部', '张三'],
    ]));
    toast('模板已下载'); return;
  }
  if (act === 'recExp') {
    // 文本列防 CSV 公式注入：客户名若是 =HYPERLINK(...) 这类，Excel 打开会执行
    const safe = s => (/^[=+@]/.test(String(s || '')) ? "'" + s : (s || ''));
    const rows = [['客户编码', '客户名称', '单据编号', '单据类型', '业务日期', '到期日', '币别', '期初余额', '本期应收', '本期收款', '期末余额', '逾期标志', '部门', '业务员']];
    recLoad().forEach(x => {
      rows.push([safe(x.cust), safe(x.name), safe(x.no), safe(x.type), x.date, x.due, x.ccy || 'RMB',
        (+x.open || 0).toFixed(2), (+x.ar || 0).toFixed(2), (+x.rec || 0).toFixed(2), recEnd(x).toFixed(2),
        recOdText(x), safe(x.dept), safe(x.sales)]);
    });
    download(`应收账款台账_${entName()}.csv`, toCSV(rows)); toast('已导出'); return;
  }
  if (act === 'recAgExp') {
    const safe = s => (/^[=+@]/.test(String(s || '')) ? "'" + s : (s || ''));
    const rows = [['客户编码', '客户名称', '应收账款总额', '未到期', '0-30天', '31-60天', '61-90天', '90天以上', '坏账准备估计', '风险等级']];
    recAging(RECV.asof).forEach(g => rows.push([safe(g.cust), safe(g.name), g.total.toFixed(2),
      ...g.b.map(v => v.toFixed(2)), g.bad.toFixed(2), g.risk === 2 ? '可疑' : g.risk === 1 ? '关注' : '正常']));
    download(`应收账龄分析_${entName()}_截至${RECV.asof}.csv`, toCSV(rows)); toast('已导出'); return;
  }
});
/* ---- 应付 / 核销事件 ---- */
document.addEventListener('click', e => {
  const ed = e.target.closest('[data-apedit]');
  if (ed) { RECV.apEdit = ed.dataset.apedit; go('p-rec-ap'); return; }
  const dl = e.target.closest('[data-apdel]');
  if (dl && CUR_ENT) {
    const list = recApLoad(); const x = list.find(v => v.id === dl.dataset.apdel);
    if (!x || !confirm(`确认删除单据 ${x.no || ''}（${x.name}）？其核销记录保留在核销页可撤。`)) return;
    if (RECV.apEdit === x.id) RECV.apEdit = '';
    recApSave(list.filter(v => v.id !== x.id));
    toast('已删除'); go('p-rec-ap'); return;
  }
  const hd = e.target.closest('[data-hxdel]');
  if (hd && CUR_ENT) {
    const flows = recHxLoad(); const h = flows.find(v => v.id === hd.dataset.hxdel);
    if (!h || !confirm(`撤销这笔 ${money(+h.amt || 0)} 的核销？该单据的可核余额会恢复。`)) return;
    recHxSave(flows.filter(v => v.id !== h.id));
    toast('已撤销'); go('p-rec-hx'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  if (act === 'hxQClear') { RECV.hxQ = ''; go('p-rec-hx'); return; }
  if (act === 'apCancel') { RECV.apEdit = ''; go('p-rec-ap'); return; }
  if (act === 'apSaveForm') {
    const v = id => (($(id) || {}).value || '').trim();
    const name = v('apName');
    if (!name) { toast('供应商名称不能为空'); return; }
    const list = recApLoad();
    const rec0 = {
      cust: v('apCust'), name, type: v('apType') || '标准采购应付',
      date: v('apDate') || recToday(), due: v('apDue'), ccy: v('apCcy') || 'RMB',
      open: numOf(v('apOpen')), ap: numOf(v('apAp')), pay: numOf(v('apPay')),
      offset: numOf(v('apOffset')), buyer: v('apBuyer'),
    };
    if (RECV.apEdit) {
      const x = list.find(y => y.id === RECV.apEdit);
      if (x) {
        const newNo = v('apNo') || x.no;
        if (list.some(y => y.id !== x.id && y.no === newNo)) { toast('单据编号已被别的单占用：' + newNo); return; }
        Object.assign(x, rec0, { no: newNo });
        RECV.apEdit = '';
        recApSave(list); toast('已保存'); go('p-rec-ap'); return;
      }
      RECV.apEdit = '';   // 编辑目标没了，降级走新增（与应收同款兜底）
    }
    const no = v('apNo') || recNextNo(list, rec0.date, 'AP');
    if (list.some(x => x.no === no)) { toast('单据编号已存在：' + no); return; }
    list.push(Object.assign({ id: uid(), no }, rec0));
    recApSave(list); toast('已新增 ' + no); go('p-rec-ap'); return;
  }
  if (act === 'apUp') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt';
    inp.onchange = () => { if (inp.files[0]) recApImport(inp.files[0]); };
    inp.click(); return;
  }
  if (act === 'apTpl') {
    download('应付台账导入模板.csv', toCSV([
      ['供应商编码', '供应商名称', '单据编号', '单据类型', '业务日期', '到期日', '币别', '期初余额', '本期应付', '本期付款', '本期冲销', '采购员'],
      ['S001', '东莞宏达塑胶', 'AP20260831-001', '标准采购应付', '2026-08-28', '2026-09-27', 'RMB', '8200', '15000', '5000', '0', '张磊'],
      ['S002', '佛山鑫源五金', 'AP20260815-014', '费用应付单', '2026-08-15', '2026-09-14', 'RMB', '0', '3390', '0', '0', '李雯'],
    ]));
    toast('模板已下载'); return;
  }
  if (act === 'apExp') {
    const safe = s => (/^[=+@]/.test(String(s || '')) ? "'" + s : (s || ''));
    const rows = [['供应商编码', '供应商名称', '单据编号', '单据类型', '业务日期', '到期日', '币别', '期初余额', '本期应付', '本期付款', '本期冲销', '期末余额', '未结算金额', '账龄区间', '采购员']];
    recApLoad().forEach(x => {
      rows.push([safe(x.cust), safe(x.name), safe(x.no), safe(x.type), x.date, x.due, x.ccy || 'RMB',
        (+x.open || 0).toFixed(2), (+x.ap || 0).toFixed(2), (+x.pay || 0).toFixed(2), (+x.offset || 0).toFixed(2),
        recApEnd(x).toFixed(2), Math.max(0, +(recGross('ap', x) - recHxSum('ap', x.id)).toFixed(2)).toFixed(2),
        recAgeBand(x.date), safe(x.buyer)]);
    });
    download(`应付账款台账_${entName()}.csv`, toCSV(rows)); toast('已导出'); return;
  }
  if (act === 'hxSave') {
    const kind = RECV.hxKind === 'ap' ? 'ap' : 'ar';
    const docs = kind === 'ap' ? recApLoad() : recLoad();
    const flows = recHxLoad();
    let n = 0, tot = 0, neg = 0, gone = 0;
    const bad = [];
    const pend = [];
    document.querySelectorAll('[data-hxamt]').forEach(inp => {
      const amt = +(+inp.value || 0).toFixed(2);
      if (amt < 0) { neg++; return; }   // 跳过要说出来，静默跳与整批拒绝的哲学不符
      if (amt === 0) return;
      const id = inp.dataset.hxamt;
      const x = docs.find(y => y.id === id);
      if (!x) { gone++; return; }
      const left = +(recGross(kind, x) - recHxSum(kind, x.id)).toFixed(2);
      if (amt > left + 0.005) { bad.push(`${x.name || ''} 超核 ${money(+(amt - left).toFixed(2))}`); return; }
      const memoEl = document.querySelector(`[data-hxmemo="${id}"]`);
      pend.push({ id: uid(), kind, docId: id, date: recToday(), amt, memo: memoEl ? memoEl.value.trim() : '' });
      n++; tot = +(tot + amt).toFixed(2);
    });
    // 有超核行就整批不存——存一半会让「保存成功」掩盖没存进去的那几行
    if (bad.length) { toast('有行超过核销后余额，本次全部未保存：' + bad.join('；'), 6800); return; }
    if (neg || gone) { toast(`有 ${neg + gone} 行没法核（${neg ? '金额为负 ' + neg + ' 行' : ''}${neg && gone ? '、' : ''}${gone ? '单据已不存在 ' + gone + ' 行' : ''}），本次全部未保存`, 6200); return; }
    if (!n) { toast('没有填本次核销金额'); return; }
    recHxSave(flows.concat(pend));
    toast(`已核销 ${n} 笔、合计 ${money(tot)}`, 4600); go('p-rec-hx'); return;
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'hxKind') { RECV.hxKind = e.target.value === 'ap' ? 'ap' : 'ar'; go('p-rec-hx'); return; }
  if (e.target.id === 'hxQ') { RECV.hxQ = e.target.value; go('p-rec-hx'); return; }
  // 从名册/台账选了名称 → 编码为空就自动带出（只补空，不覆盖手填的）
  if (e.target.id === 'rcName' || e.target.id === 'apName') {
    const isAp0 = e.target.id === 'apName';
    const code = recNameOptions(isAp0 ? 'ap' : 'ar').get(e.target.value.trim());
    const custEl = $(isAp0 ? 'apCust' : 'rcCust');
    if (code && custEl && !custEl.value.trim()) custEl.value = code;
    return;
  }
  if (e.target.id === 'recAsof') { RECV.asof = e.target.value || recToday(); go('p-rec-aging'); return; }
  if (e.target.dataset && e.target.dataset.reccfg && CUR_ENT) {
    const c = recCfg();
    c[e.target.dataset.reccfg] = Math.max(0, Math.min(100, +e.target.value || 0));
    recCfgSave(c); go('p-rec-aging'); return;
  }
});
