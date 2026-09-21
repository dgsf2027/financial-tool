/* 固定资产：资产卡片 + 折旧计提 + 清理（照金蝶/用友的规矩）
   - 卡片：编号/名称/类别/部门/启用日期/原值/残值率/年限/费用科目，
     月折旧 = 原值×(1−残值率)÷年限月数（平均年限法，小企业准则主流做法）
   - 当月增加当月不提、下月起提；清理当月照提（中国准则通行规则）
   - 折旧计提按月出表并一键生成凭证：借 费用科目 / 贷 1602 累计折旧
     （凭证按月固定 id，重复生成是覆盖不是重复入库，未过账进凭证库）
   - 清理：卡片转清理状态并生成清理凭证：借 1606 固定资产清理（净值）
     + 借 1602 累计折旧（已提） / 贷 1601 固定资产（原值）；
     出售价款、清理费用等后续分录在录凭证里手工补
   - 已提过折旧的卡片不能删只能清理；新卡未提折旧可删（金蝶同款） */
'use strict';

const FA_KEY = e => 'fsc_fa_' + e + '_v1';
const faLoad = () => { try { return JSON.parse(localStorage.getItem(FA_KEY(CUR_ENT)) || '[]'); } catch (e) { return []; } };
const faSave = v => { try { localStorage.setItem(FA_KEY(CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败'); } };
const FA = { month: ym(new Date()), edit: '' };
const FA_CATS = [['房屋建筑物', 20], ['机器设备', 10], ['运输工具', 4], ['电子设备', 3], ['办公家具', 5], ['其他设备', 5]];

/* ---- 折旧引擎 ---- */
const faMonIdx = m => (+m.slice(0, 4)) * 12 + (+m.slice(5, 7));   // 月份序号，好做加减
const faNextM = m => { const [y, mo] = m.split('-'); return ym(new Date(+y, +mo, 1)); };
const faMonthly = a => +((a.cost * (1 - a.res / 100)) / a.life).toFixed(2);
/* 系统从「启用次月」与 2026-01 的较晚者开始提（更早的用期初累计折旧字段带入） */
const faStartM = a => {
  const nxt = faNextM(String(a.useDate).slice(0, 7));
  return nxt > '2026-01' ? nxt : '2026-01';
};
/* 截至 M 月末的累计折旧（含期初带入；封顶 原值×(1−残值率)；清理后不再增长） */
function faAccumAt(a, M) {
  const cap = +(a.cost * (1 - a.res / 100)).toFixed(2);
  let end = M;
  if (a.status === 'cleared' && a.clearM && a.clearM < M) end = a.clearM;   // 清理当月照提，之后停
  const n = Math.max(0, faMonIdx(end) - faMonIdx(faStartM(a)) + 1);
  if (faMonIdx(end) < faMonIdx(faStartM(a))) return Math.min(cap, +a.initDep || 0);
  return Math.min(cap, +(((+a.initDep || 0) + faMonthly(a) * n)).toFixed(2));
}
/* 上一个月。注意 JS 月份 0 基：'2026-08' 的上月 = new Date(2026, 6, 1) */
const faPrevM = m => { const [y, mo] = m.split('-'); return ym(new Date(+y, +mo - 2, 1)); };
/* 本月计提额 = 截至本月累计 − 截至上月累计（faAccumAt 对起提月之前自动回退到期初） */
const faDepOf = (a, M) => +(faAccumAt(a, M) - faAccumAt(a, faPrevM(M))).toFixed(2);
const faNetAt = (a, M) => +(a.cost - faAccumAt(a, M)).toFixed(2);

/* Depreciation vouchers are historical evidence. New vouchers record their
   contributing cards; legacy aggregate vouchers are checked by month. */
const faDepVoucher = v => String(v.src || '') === '折旧计提' || /^__fa_dep_/.test(String(v.id || ''));
function faHistoryFor(a, next) {
  const old = a || {}, candidate = next || old;
  return vchLoad(CUR_ENT).filter(v => {
    if (!faDepVoucher(v)) return false;
    if (Array.isArray(v.faAssetIds) && v.faAssetIds.length) return v.faAssetIds.includes(old.id || candidate.id);
    const M = String(v.period || v.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(M)) return true; // unknown legacy period: stay conservative
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(old.useDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(candidate.useDate || ''))) return true;
    // The voucher could include this card whenever its old or proposed start
    // month has arrived. This intentionally errs toward blocking edits.
    return M >= faStartM(old) || M >= faStartM(candidate);
  });
}
const FA_FIN_FIELDS = ['useDate', 'cost', 'res', 'life', 'expAcct', 'initDep'];

/* ---- 资产卡片 ---- */
S['p-fa'] = () => {
  if (!CUR_ENT) return needEnt('资产卡片');
  const list = faLoad();
  const M = FA.month;
  const ed = FA.edit ? list.find(x => x.id === FA.edit) : null;
  const exp56 = ACCOUNTS().filter(a => /^56/.test(String(a[0])) && !String(a[0]).includes('{'));
  const rows = list.map(a => {
    const dep = faAccumAt(a, M), net = faNetAt(a, M);
    const canDel = dep - (+a.initDep || 0) < 0.005 && a.status !== 'cleared';
    return [
      `<span class="code">${H(a.no)}</span>`, H(a.name), H(a.cat), H(a.dept || '—'),
      a.useDate, money(a.cost), (a.res) + '%', (a.life / 12) + ' 年', money(faMonthly(a)),
      money(dep), money(net),
      a.status === 'cleared' ? pill('已清理 ' + (a.clearM || ''), 'cr') : pill('在用', 'ok'),
      `${a.status === 'cleared' ? '' : `<button class="btn sm" data-faclr="${H(a.id)}">清理</button>`}
       <button class="btn sm" data-faedit="${H(a.id)}">编辑</button>
       ${canDel ? `<button class="btn sm" data-fadel="${H(a.id)}">删除</button>` : ''}`,
    ];
  });
  const tCost = list.filter(a => a.status !== 'cleared').reduce((s, a) => s + a.cost, 0);
  const tDep = list.filter(a => a.status !== 'cleared').reduce((s, a) => s + faAccumAt(a, M), 0);
  return head('资产卡片', `${H(entName())} · 平均年限法，当月增加下月起提、清理当月照提。累计折旧/净值按右上月份口径显示。`, '核算 · 固定资产',
    `<input type="month" id="faMonth" value="${M}" min="2026-01">`)
    + kpis([
      { k: '在用卡片', v: String(list.filter(a => a.status !== 'cleared').length), u: '张' },
      { k: '原值合计', v: money(tCost) },
      { k: '累计折旧', v: money(tDep) },
      { k: '净值', v: money(+(tCost - tDep).toFixed(2)) },
      { k: '已清理', v: String(list.filter(a => a.status === 'cleared').length), u: '张' },
    ])
    + cardp(ed ? `编辑卡片 ${H(ed.no)}` : '新增卡片', `<div class="cols c4">
      <div class="field"><label class="fl">资产名称 <span class="red">*</span></label><input id="faName" value="${ed ? H(ed.name) : ''}"></div>
      <div class="field"><label class="fl">类别</label><select id="faCat">${FA_CATS.map(c =>
        `<option ${ed && ed.cat === c[0] ? 'selected' : ''}>${c[0]}</option>`).join('')}</select></div>
      <div class="field"><label class="fl">使用部门</label><input id="faDept" value="${ed ? H(ed.dept || '') : ''}"></div>
      <div class="field"><label class="fl">启用日期 <span class="red">*</span></label><input type="date" id="faUse" value="${ed ? ed.useDate : ''}"></div>
      <div class="field"><label class="fl">原值 <span class="red">*</span></label><input type="number" step="0.01" id="faCost" value="${ed ? ed.cost : ''}"></div>
      <div class="field"><label class="fl">残值率 %</label><input type="number" id="faRes" value="${ed ? ed.res : 5}"></div>
      <div class="field"><label class="fl">年限（年）</label><input type="number" id="faLife" value="${ed ? ed.life / 12 : ''}" placeholder="按类别默认"></div>
      <div class="field"><label class="fl">折旧费用科目</label><select id="faExp">${exp56.map(a =>
        `<option value="${H(a[0])}" ${(ed ? ed.expAcct : '5602') === String(a[0]) ? 'selected' : ''}>${H(a[0])} ${H(a[1])}</option>`).join('')}</select></div>
      <div class="field"><label class="fl">期初累计折旧（2026 前的老资产填）</label><input type="number" step="0.01" id="faInit" value="${ed ? (ed.initDep || '') : ''}"></div>
    </div>
    <div style="text-align:right;margin-top:9px">${ed ? '<button class="btn" data-act="faCancel">取消</button> ' : ''}
      <button class="btn pri" data-act="faSave">${ed ? '保存修改' : '新增卡片'}</button></div>`)
    + `<div class="note"><b>规矩：</b>提过折旧的卡片不能删，只能清理（金蝶同款）；清理会生成
      「借 固定资产清理(净值)+累计折旧(已提) / 贷 固定资产(原值)」凭证，出售价款与清理损益去「录凭证」手工补。
      购置入账凭证（借 1601 / 贷 银行存款）由 T2 流水或录凭证处理，卡片只管折旧口径。</div>`
    + card(`卡片台账（截至 ${M}）`, rows.length ? table(
      [{ t: '编号' }, { t: '名称' }, { t: '类别' }, { t: '部门' }, { t: '启用' }, { t: '原值', n: 1 }, { t: '残值率' }, { t: '年限' },
       { t: '月折旧', n: 1 }, { t: '累计折旧', n: 1 }, { t: '净值', n: 1 }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有资产卡片</div>`);
};

/* ---- 折旧计提 ---- */
S['p-fadep'] = () => {
  if (!CUR_ENT) return needEnt('折旧计提');
  const M = FA.month;
  const list = faLoad().filter(a => a.status !== 'cleared' || a.clearM >= M);
  const items = list.map(a => ({ a, dep: faDepOf(a, M) }));
  const active = items.filter(x => x.dep > 0.005);
  const total = +active.reduce((s, x) => s + x.dep, 0).toFixed(2);
  const vId = '__fa_dep_' + M + '__';
  const done = vchLoad(CUR_ENT).some(v => v.id === vId);
  const rows = items.map(x => [
    `<span class="code">${H(x.a.no)}</span>`, H(x.a.name),
    money(x.a.cost), money(faMonthly(x.a)),
    x.dep > 0.005 ? money(x.dep) : '<span class="mut">0（' +
      (faStartM(x.a) > M ? '当月增加下月起提' : '已提足') + '）</span>',
    money(faAccumAt(x.a, M)), money(faNetAt(x.a, M)),
    `<span class="code">${H(x.a.expAcct)}</span> ${H(acctName(x.a.expAcct))}`,
  ]);
  return head('折旧计提', `${H(entName())} · ${M} 月。平均年限法按月计提，生成凭证进凭证库（未过账，核对后过账）。`, '核算 · 固定资产',
    `<input type="month" id="faMonth" value="${M}" min="2026-01">
     <button class="btn pri" data-act="faDepVch">生成计提凭证</button>`)
    + kpis([
      { k: '本月计提', v: money(total), t: 'g' },
      { k: '计提卡片', v: String(active.length) + ' / ' + String(items.length), u: '张' },
      { k: '本月凭证', v: done ? '已生成' : '未生成', t: done ? 'g' : 'w' },
    ])
    + (done ? `<div class="note g"><b>${M} 的计提凭证已在凭证库</b>（未过账的话去过账）。卡片有变动就再点一次生成——同一个月是覆盖不是重复。</div>` : '')
    + card(`${M} 折旧明细`, rows.length ? table(
      [{ t: '编号' }, { t: '名称' }, { t: '原值', n: 1 }, { t: '月折旧', n: 1 }, { t: '本月计提', n: 1 },
       { t: '累计折旧', n: 1 }, { t: '净值', n: 1 }, { t: '费用科目' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">没有需要计提的卡片——先去资产卡片新增</div>`)
    + `<div class="note">分录：按费用科目归并 借 管理费用等 / 贷 1602 累计折旧。报表首页的「计提类凭证」检查会认这张凭证。</div>`;
};

/* ---- 事件 ---- */
document.addEventListener('change', e => {
  if (e.target.id === 'faMonth' && e.target.value >= '2026-01') { FA.month = e.target.value; go(CURS); }
});
document.addEventListener('click', e => {
  const ed = e.target.closest('[data-faedit]');
  if (ed) { FA.edit = ed.dataset.faedit; go('p-fa', { resetScroll: true }); return; }
  const del = e.target.closest('[data-fadel]');
  if (del) {
    const list = faLoad(); const a = list.find(x => x.id === del.dataset.fadel);
    if (!a || !confirm(`确认删除卡片「${a.name}」？（未提过折旧才允许删）`)) return;
    faSave(list.filter(x => x.id !== a.id)); toast('已删除'); go('p-fa'); return;
  }
  const clr = e.target.closest('[data-faclr]');
  if (clr) {
    const list = faLoad(); const a = list.find(x => x.id === clr.dataset.faclr);
    if (!a) return;
    if (!confirm(`确认清理「${a.name}」？清理月按 ${FA.month}（清理当月照提折旧），并生成清理凭证进凭证库。`)) return;
    a.status = 'cleared'; a.clearM = FA.month; faSave(list);
    const accum = faAccumAt(a, FA.month), net = faNetAt(a, FA.month);
    const date = FA.month + '-' + String(new Date(+FA.month.slice(0, 4), +FA.month.slice(5, 7), 0).getDate()).padStart(2, '0');
    const memo = a.name + ' 转入清理';
    const lines = [
      { acct: '1606', name: acctName('1606') || '固定资产清理', dr: net, cr: 0, memo },
      accum > 0.005 ? { acct: '1602', name: acctName('1602') || '累计折旧', dr: accum, cr: 0, memo } : null,
      { acct: '1601', name: acctName('1601') || '固定资产', dr: 0, cr: a.cost, memo },
    ].filter(Boolean);
    const vs = vchLoad(CUR_ENT).filter(v => v.id !== '__fa_clr_' + a.id + '__');
    vs.push({ id: '__fa_clr_' + a.id + '__', period: FA.month, date, word: '记', no: '清', posted: 0, src: '资产清理', lines });
    vchSave(CUR_ENT, vs);
    toast(`已转清理并生成清理凭证（未过账）。清理当月折旧记得在折旧计提里生成。出售价款去录凭证补：借 银行存款 / 贷 1606。`, 6200);
    go('ac-vch'); return;
  }
  const a2 = e.target.closest('[data-act]');
  if (!a2 || !CUR_ENT) return;
  const act = a2.dataset.act;
  if (act === 'faCancel') { FA.edit = ''; go('p-fa'); return; }
  if (act === 'faSave') {
    const g = id => ($(id) || {}).value;
    const name = (g('faName') || '').trim();
    const cost = numOf(g('faCost')); const useDate = g('faUse');
    if (!name || !cost || !useDate) { toast('名称、原值、启用日期必填'); return; }
    const cat = g('faCat') || '其他设备';
    const years = +g('faLife') || (FA_CATS.find(c => c[0] === cat) || [0, 5])[1];
    const res = +g('faRes'); const resV = isNaN(res) ? 5 : Math.min(50, Math.max(0, res));
    const list = faLoad();
    if (FA.edit) {
      const a = list.find(x => x.id === FA.edit);
      if (a) {
        const proposed = Object.assign({}, a, { name, cat, dept: g('faDept') || '', useDate, cost, res: resV,
          life: years * 12, expAcct: g('faExp') || '5602', initDep: numOf(g('faInit')) });
        const changed = FA_FIN_FIELDS.filter(k => String(a[k] == null ? '' : a[k]) !== String(proposed[k] == null ? '' : proposed[k]));
        if (changed.length && faHistoryFor(a, proposed).length) {
          toast('该资产已产生折旧凭证，不能修改影响历史折旧的字段：' + changed.join('、'));
          return;
        }
        Object.assign(a, proposed);
      }
      FA.edit = '';
    } else {
      const no = 'FA' + String(list.length + 1).padStart(3, '0');
      list.push({ id: uid(), no, name, cat, dept: g('faDept') || '', useDate, cost, res: resV,
        life: years * 12, expAcct: g('faExp') || '5602', initDep: numOf(g('faInit')), status: 'use' });
    }
    faSave(list); toast('卡片已保存'); go('p-fa'); return;
  }
  if (act === 'faDepVch') {
    const M = FA.month;
    const items = faLoad().filter(x => x.status !== 'cleared' || x.clearM >= M)
      .map(x => ({ a: x, dep: faDepOf(x, M) })).filter(x => x.dep > 0.005);
    if (!items.length) { toast('本月没有可计提的折旧'); return; }
    const byExp = {};
    items.forEach(x => { byExp[x.a.expAcct] = +((byExp[x.a.expAcct] || 0) + x.dep).toFixed(2); });
    const total = +items.reduce((s, x) => s + x.dep, 0).toFixed(2);
    const date = M + '-' + String(new Date(+M.slice(0, 4), +M.slice(5, 7), 0).getDate()).padStart(2, '0');
    const memo = M + ' 计提折旧（' + items.length + ' 张卡片）';
    const lines = Object.keys(byExp).map(k =>
      ({ acct: k, name: acctName(k) || k, dr: byExp[k], cr: 0, memo }))
      .concat([{ acct: '1602', name: acctName('1602') || '累计折旧', dr: 0, cr: total, memo }]);
    const vId = '__fa_dep_' + M + '__';
    const before = vchLoad(CUR_ENT);
    const oldVoucher = before.find(v => v.id === vId);
    if (oldVoucher && oldVoucher.posted) { toast(M + ' 折旧凭证已过账，禁止覆盖；如需调整请新增更正凭证'); return; }
    const vs = before.filter(v => v.id !== vId);
    const existed = vs.length !== before.length;
    vs.push({ id: vId, period: M, date, word: '记', no: '折', posted: 0, src: '折旧计提',
      faAssetIds: items.map(x => x.a.id).filter(Boolean), lines });
    vchSave(CUR_ENT, vs);
    toast((existed ? '已重新生成（覆盖）' : '计提凭证已生成') + `：${money(total)}，未过账，去凭证库核对`, 5200);
    go('ac-vch'); return;
  }
});
