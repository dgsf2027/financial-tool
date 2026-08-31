/* 往来对账 · 应收账款台账 + 账龄分析
   表体按负责人 2026-08-31 给的两张样表逐列实现：
   - 台账 15 列：客户编码/客户名称/单据编号/单据类型/业务日期/到期日/币别/
     期初余额/本期应收/本期收款/期末余额/核销状态/逾期标志/部门/业务员。
     只录事实（期初/应收/收款），判断全部现算不落库：
     期末余额 = 期初 + 本期应收 − 本期收款；
     核销状态 = 期末 0 → 已核销、收过款但没收完 → 部分核销、没收款 → 未核销；
     逾期标志 = 期末 >0 且今天已过到期日 → 已逾期
   - 账龄 10 列：从台账派生（不重复录入）。每张单据按「截至日 − 到期日」
     分桶（未到期 / 0-30 / 31-60 / 61-90 / 90天以上），客户行 = 各单合计；
     坏账准备估计 = Σ 桶金额 × 桶比例（可配，默认 0/0/0/10%/30%——
     61-90 档 10% 学自样表：30,000×10% = 3,000）；
     风险等级：90+ 有余额 → 可疑，31-90 有 → 关注，其余 → 正常 */
'use strict';

const REC_AR_KEY = e => 'fsc_rec_ar_' + e + '_v1';
const REC_CFG_KEY = e => 'fsc_rec_cfg_' + e + '_v1';
const recLoad = () => { try { return JSON.parse(localStorage.getItem(REC_AR_KEY(CUR_ENT)) || '[]'); } catch (e) { return []; } };
const recSave = v => { try { localStorage.setItem(REC_AR_KEY(CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败：浏览器存储空间不足'); } };
function recCfg() {
  try { const c = JSON.parse(localStorage.getItem(REC_CFG_KEY(CUR_ENT)) || 'null'); if (c) return c; } catch (e) { /* 忽略 */ }
  return { r0: 0, r30: 0, r60: 0, r90: 10, r90p: 30 };   // 各桶坏账比例（%），61-90 档学自样表
}
const recCfgSave = c => { try { localStorage.setItem(REC_CFG_KEY(CUR_ENT), JSON.stringify(c)); } catch (e) { /* 忽略 */ } };

const RECV = { edit: '', asof: new Date().toISOString().slice(0, 10) };
const recEnd = x => +(((+x.open || 0) + (+x.ar || 0) - (+x.rec || 0))).toFixed(2);
const recToday = () => new Date().toISOString().slice(0, 10);
/* 核销状态与逾期标志——判断永远现算，录入的只有事实 */
function recHx(x) {
  const end = recEnd(x), base = (+x.open || 0) + (+x.ar || 0);
  if (Math.abs(end) < 0.005 && base > 0.005) return pill('已核销', 'ok');
  if (end < -0.005) return pill('多收 ' + money(-end), 'cr');
  if ((+x.rec || 0) > 0.005) return pill('部分核销', 'wa');
  return pill('未核销', 'mu');
}
const recOd = x => (recEnd(x) > 0.005 && x.due && recToday() > x.due)
  ? pill('已逾期', 'cr') : pill('未逾期', 'ok');

/* ============ 账龄分桶（账龄页与看板共用这一份口径） ============ */
function recAging(asof) {
  const by = {};
  recLoad().forEach(x => {
    const end = recEnd(x);
    if (Math.abs(end) < 0.005) return;               // 已核销的单不进账龄
    const k = (x.cust || '') + '|' + (x.name || '');
    const g = by[k] = by[k] || { cust: x.cust || '', name: x.name || '', total: 0, b: [0, 0, 0, 0, 0] };
    g.total = +(g.total + end).toFixed(2);
    // 逾期天数 = 截至日 − 到期日；没填到期日按未到期算（页面会提示补）
    const d = x.due ? Math.round((new Date(asof) - new Date(x.due)) / 86400000) : 0;
    const i = (!x.due || d <= 0) ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
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
  const tOd = +list.reduce((s, x) => s + ((recEnd(x) > 0.005 && x.due && recToday() > x.due) ? recEnd(x) : 0), 0).toFixed(2);
  const nPart = list.filter(x => (+x.rec || 0) > 0.005 && recEnd(x) > 0.005).length;

  const F = (id, ph, v, w) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" value="${v == null ? '' : H(String(v))}" style="${w ? 'width:' + w : ''}"></div>`;
  const FN = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" type="number" step="0.01" value="${v == null || v === '' ? '' : v}" placeholder="0.00"></div>`;
  const FD = (id, ph, v) => `<div class="field"><label class="fl">${ph}</label>
    <input id="${id}" type="date" value="${v || ''}"></div>`;
  const e0 = editing || {};
  const form = cardp(editing ? `编辑单据 ${H(editing.no || '')}` : '新增应收单', `
    <div class="cols c4">
      ${F('rcCust', '客户编码', e0.cust)}${F('rcName', '客户名称 *', e0.name)}
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
    H(x.date || '—'), x.due ? H(x.due) : '<span class="red">未填</span>', H(x.ccy || 'RMB'),
    money(+x.open || 0), money(+x.ar || 0), money(+x.rec || 0),
    `<b>${money(recEnd(x))}</b>`, recHx(x), recOd(x), H(x.dept || '—'), H(x.sales || '—'),
    `<button class="btn sm" data-recedit="${H(x.id)}">编辑</button>
     <button class="btn sm" data-recdel="${H(x.id)}">删除</button>`,
  ]);
  return head('应收账款台账', `${H(entName())} · 期末余额 = 期初 + 本期应收 − 本期收款；核销状态与逾期标志按数字现算，不用手填。收到款就编辑那张单、改「本期收款」。`, '往来对账',
    `<button class="btn" data-act="recTpl">下载模板</button>
     <button class="btn" data-act="recUp">导入台账(Excel)</button>
     <button class="btn" data-go="p-rec-aging">账龄分析 →</button>
     <button class="btn pri" data-act="recExp">导出</button>`)
    + kpis([
      { k: '单据数', v: String(list.length), u: '张' },
      { k: '期末余额合计', v: money(tEnd) },
      { k: '其中已逾期', v: money(tOd), t: tOd > 0.005 ? 'c' : 'g' },
      { k: '部分核销', v: String(nPart), u: '张', t: nPart ? 'w' : '' },
    ])
    + form
    + card('台账', rows.length ? table(
      [{ t: '客户编码' }, { t: '客户名称' }, { t: '单据编号' }, { t: '单据类型' }, { t: '业务日期' }, { t: '到期日' }, { t: '币别' },
       { t: '期初余额', n: 1 }, { t: '本期应收', n: 1 }, { t: '本期收款', n: 1 }, { t: '期末余额', n: 1 },
       { t: '核销状态' }, { t: '逾期标志' }, { t: '部门' }, { t: '业务员' }, { t: '' }], rows,
      ['<b>合计</b>', '', '', '', '', '', '',
       `<b>${money(+list.reduce((s, x) => s + (+x.open || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.ar || 0), 0).toFixed(2))}</b>`,
       `<b>${money(+list.reduce((s, x) => s + (+x.rec || 0), 0).toFixed(2))}</b>`,
       `<b>${money(tEnd)}</b>`, '', '', '', '', ''])
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
  const rateInp = (k, v) => `<input type="number" step="1" min="0" max="100" data-reccfg="${k}" value="${v}" style="width:64px"> %`;
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
    + `<div class="note"><b>催收优先级：</b>先追「90天以上」（红字），再追 61-90；风险等级=可疑的客户建议停止赊销。
      到期日没填的单据按未到期算——台账里标红的「未填」补上，账龄才准。风险规则：90天以上有余额 → 可疑；31-90 天有 → 关注。</div>`;
};

/* ============ 导入 / 导出 ============ */
const REC_ALIAS = {
  cust: ['客户编码', '客户代码'], name: ['客户名称', '客户'], no: ['单据编号', '单号', '发票号码', '发票号'],
  type: ['单据类型', '类型'], date: ['业务日期', '单据日期', '开单日期', '日期'], due: ['到期日', '到期日期', '应收日期'],
  ccy: ['币别', '币种'], open: ['期初余额', '期初'], ar: ['本期应收', '应收金额', '应收'],
  rec: ['本期收款', '收款金额', '已收金额', '已收'], dept: ['部门'], sales: ['业务员', '销售员', '经办人'],
};
function recMap(header) {
  const cells = header.map(h => String(h == null ? '' : h).replace(/\s/g, ''));
  const map = {}, used = new Set();
  [1, 0].forEach(exact => Object.keys(REC_ALIAS).forEach(k => {
    if (map[k] !== undefined) return;
    for (const a of REC_ALIAS[k]) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && (exact ? c === a : c.includes(a)));
      if (i >= 0) { map[k] = i; used.add(i); return; }
    }
  }));
  return map;
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
    let add = 0, upd = 0, seq = list.length, skip = 0;
    rows.slice(hr + 1).forEach(r => {
      const g = k => (map[k] === undefined ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim());
      const name = g('name');
      if (!name || /^合计|^总计/.test(g('cust') + name)) { if (r.some(c => String(c == null ? '' : c).trim())) skip++; return; }
      const rec0 = {
        cust: g('cust'), name, type: g('type') || '标准应收单',
        date: normDate(g('date')) || recToday(), due: normDate(g('due')) || '',
        ccy: g('ccy') || 'RMB', open: numOf(g('open')), ar: numOf(g('ar')), rec: numOf(g('rec')),
        dept: g('dept'), sales: g('sales'),
      };
      const no = g('no') || ('AR' + rec0.date.replace(/-/g, '') + '-' + String(++seq).padStart(3, '0'));
      // 同单据编号 = 覆盖不叠加（重复导同一张表结果一致）
      if (byNo[no]) { Object.assign(byNo[no], rec0, { no }); upd++; }
      else { const nx = Object.assign({ id: uid(), no }, rec0); list.push(nx); byNo[no] = nx; add++; }
    });
    recSave(list);
    toast(`导入完成：新增 ${add} 张、按单据编号覆盖 ${upd} 张` + (skip ? `、无客户名跳过 ${skip} 行` : ''), 5600);
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
    if (!x || !confirm(`确认删除单据 ${x.no || ''}（${x.name}）？`)) return;
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
      if (x) Object.assign(x, rec0, { no: v('rcNo') || x.no });
      RECV.edit = '';
      recSave(list); toast('已保存'); go('p-rec-ar'); return;
    }
    const no = v('rcNo') || ('AR' + rec0.date.replace(/-/g, '') + '-' + String(list.length + 1).padStart(3, '0'));
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
    const rows = [['客户编码', '客户名称', '单据编号', '单据类型', '业务日期', '到期日', '币别', '期初余额', '本期应收', '本期收款', '期末余额', '核销状态', '逾期标志', '部门', '业务员']];
    recLoad().forEach(x => {
      const end = recEnd(x);
      const hx = Math.abs(end) < 0.005 ? '已核销' : end < -0.005 ? '多收' : (+x.rec || 0) > 0.005 ? '部分核销' : '未核销';
      rows.push([x.cust, x.name, x.no, x.type, x.date, x.due, x.ccy || 'RMB',
        (+x.open || 0).toFixed(2), (+x.ar || 0).toFixed(2), (+x.rec || 0).toFixed(2), end.toFixed(2),
        hx, (end > 0.005 && x.due && recToday() > x.due) ? '已逾期' : '未逾期', x.dept, x.sales]);
    });
    download(`应收账款台账_${entName()}.csv`, toCSV(rows)); toast('已导出'); return;
  }
  if (act === 'recAgExp') {
    const rows = [['客户编码', '客户名称', '应收账款总额', '未到期', '0-30天', '31-60天', '61-90天', '90天以上', '坏账准备估计', '风险等级']];
    recAging(RECV.asof).forEach(g => rows.push([g.cust, g.name, g.total.toFixed(2),
      ...g.b.map(v => v.toFixed(2)), g.bad.toFixed(2), g.risk === 2 ? '可疑' : g.risk === 1 ? '关注' : '正常']));
    download(`应收账龄分析_${entName()}_截至${RECV.asof}.csv`, toCSV(rows)); toast('已导出'); return;
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'recAsof') { RECV.asof = e.target.value || recToday(); go('p-rec-aging'); return; }
  if (e.target.dataset && e.target.dataset.reccfg && CUR_ENT) {
    const c = recCfg();
    c[e.target.dataset.reccfg] = Math.max(0, Math.min(100, +e.target.value || 0));
    recCfgSave(c); go('p-rec-aging'); return;
  }
});
