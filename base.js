/* 基础 · 科目设置
   与核算共用同一份科目（SE_CHART 标准表 + 各主体自建），这里是维护入口。
   参考金蝶/用友的科目管理：
   - 编码级次 4-2-2：一级 4 位（1002）、二级 6 位（100201）、三级 8 位（10020101）
   - 只能在上级科目下加下级；有下级的科目按惯例不该直接记账（本系统提示不硬拦，
     因为已有规则挂在上级科目上，硬拦会打断在用的流程）
   - 辅助核算：客户/供应商/部门/职员/项目 五类标记
   - 有发生额（凭证/规则在用）的科目不许删，只能停用
   - 标准科目不可删；改名/加辅助会落成本主体的自建覆盖，不动别的主体 */
'use strict';

const BS_AUX = [['customer', '客户'], ['supplier', '供应商'], ['dept', '部门'], ['staff', '职员'], ['project', '项目']];
const BSS = { parent: '', edit: '' };   // edit = 正在编辑的科目编码

/* 类别与默认余额方向：按小企业会计准则编码段判，背离方向的备抵科目单列 */
const BS_CONTRA = new Set(['1602', '1702', '1622']);   // 累计折旧/累计摊销
function bsClass(code) {
  const c = String(code)[0];
  return c === '1' ? '资产' : c === '2' ? '负债' : c === '3' ? '权益' : c === '4' ? '成本' : c === '5' ? '损益' : '其他';
}
function bsDir(code, opts) {
  if (opts && opts.dir) return opts.dir;
  const base = String(code).slice(0, 4);
  if (BS_CONTRA.has(base)) return '贷';
  const c = String(code)[0];
  if (c === '1' || c === '4') return '借';
  if (c === '2' || c === '3') return '贷';
  return /^(5001|5051|5111|5301)/.test(code) ? '贷' : '借';
}
const bsLevel = code => { const n = String(code).replace(/\D/g, '').length; return n <= 4 ? 1 : n <= 6 ? 2 : 3; };
const bsIsStd = code => SE_CHART.some(a => a[0] === String(code));
const bsCustom = () => (RS ? RS.accounts : []);
const bsFind = code => ACCOUNTS(1).find(a => String(a[0]) === String(code));
const bsChildren = code => ACCOUNTS(1).filter(a => String(a[0]).length === String(code).length + 2 && String(a[0]).startsWith(String(code)));

/* 科目有没有在被用——凭证行、规则里挂着都算「在用」，在用不许删（金蝶同款规矩） */
function bsUsed(code) {
  const c = String(code);
  try {
    if (vchLoad(CUR_ENT).some(v => v.lines.some(l => {
      const b = String(l.acct).split('_')[0];
      return b === c || b.startsWith(c) && b.length > c.length;
    }))) return '凭证';
  } catch (e) { /* 忽略 */ }
  if ((RULES || []).some(r => String(r.acct).split('_')[0] === c)) return '规则';
  return '';
}
/* 下一个可用的下级编码后缀（01 起顺延） */
function bsNextCode(parent) {
  const kids = bsChildren(parent).map(a => +String(a[0]).slice(-2)).filter(n => !isNaN(n));
  return String(parent) + String((kids.length ? Math.max(...kids) : 0) + 1).padStart(2, '0');
}

S['bs-acct'] = () => {
  if (!CUR_ENT) return needEnt('科目设置');
  const all = ACCOUNTS(1);
  const editing = BSS.edit ? bsFind(BSS.edit) : null;
  const eOpts = editing && editing[2] ? editing[2] : {};

  /* 新增/编辑表单 */
  const parentOpts = all.filter(a => bsLevel(a[0]) < 3 && !String(a[0]).includes('{'))
    .map(a => `<option value="${H(a[0])}" ${String(BSS.parent) === String(a[0]) ? 'selected' : ''}>${H(a[0])} ${H(a[1])}</option>`).join('');
  const nextCode = editing ? String(editing[0]) : (BSS.parent ? bsNextCode(BSS.parent) : '');
  const form = cardp(editing ? `编辑科目 ${H(editing[0])}` : '新增下级科目', `
    <div class="cols c4">
      <div class="field"><label class="fl">上级科目</label>
        ${editing ? `<input value="${H(String(editing[0]).slice(0, -2) || '（一级）')}" disabled>` :
      `<select id="bsParent"><option value="">— 选上级 —</option>${parentOpts}</select>`}</div>
      <div class="field"><label class="fl">科目编码（上级 + 2 位）</label>
        <input id="bsCode" value="${H(nextCode)}" ${editing ? 'disabled' : ''} placeholder="选上级后自动给号"></div>
      <div class="field"><label class="fl">科目名称</label>
        <input id="bsName" value="${editing ? H(editing[1]) : ''}" placeholder="如：管理费用_差旅费"></div>
      <div class="field"><label class="fl">余额方向</label>
        <select id="bsDir">${['默认', '借', '贷'].map(d =>
      `<option ${((eOpts.dir || '默认') === d) ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:9px">辅助核算：${BS_AUX.map(([k, n]) =>
      `<label style="margin-right:12px"><input type="checkbox" data-bsaux="${k}" ${(eOpts.aux || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}
      <span class="mut" style="font-size:11px">项目辅助已在凭证里落地（科目_项目码，T2 在用）；其余类别先登记，录凭证界面接入后生效。</span></div>
    <div style="text-align:right;margin-top:9px">
      ${editing ? '<button class="btn" data-act="bsCancel">取消</button> ' : ''}
      <button class="btn pri" data-act="bsSave">${editing ? '保存修改' : '新增科目'}</button></div>`);

  /* 科目树 */
  const customSet = new Set(bsCustom().map(a => String(a[0])));
  const rows = all.filter(a => !String(a[0]).includes('{')).map(a => {
    const code = String(a[0]), opts = a[2] || {};
    const lv = bsLevel(code);
    const kids = bsChildren(code).length;
    const used = bsUsed(code);
    const isStd = bsIsStd(code) && !customSet.has(code);
    const off = opts.off;
    return [
      `<span style="padding-left:${(lv - 1) * 22}px"><span class="code">${H(code)}</span></span>`,
      `<span style="${off ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${H(a[1])}</span>`,
      bsClass(code), bsDir(code, opts), String(lv),
      (opts.aux || []).map(k => { const f = BS_AUX.find(x => x[0] === k); return f ? pill(f[1], 'ok') : ''; }).join('') || '<span class="mut">—</span>',
      kids ? pill(`${kids} 个下级`, 'mu') : (used ? pill('在用·' + used, 'wa') : ''),
      isStd ? pill('标准', 'mu') : pill('自建', 'ok'),
      `${lv < 3 ? `<button class="btn sm" data-bssub="${H(code)}">加下级</button>` : ''}
       <button class="btn sm" data-bsedit="${H(code)}">编辑</button>
       ${customSet.has(code) ? (off
        ? `<button class="btn sm" data-bson="${H(code)}">启用</button>`
        : `<button class="btn sm" data-bsoff="${H(code)}">停用</button>`) : ''}
       ${customSet.has(code) && !used && !kids ? `<button class="btn sm" data-bsdel="${H(code)}">删除</button>` : ''}`,
    ];
  });
  return head('科目设置', `${H(entName())} · 与核算模块同一份科目：小企业会计准则标准表 + 本主体自建。编码级次 4-2-2（一级4位/二级6位/三级8位）。`, '基础 · 科目',
    `<button class="btn" data-go="bs-imp">主数据导入（科目余额表/辅助核算）</button>
     <button class="btn pri" data-act="bsExp">导出科目表</button>`)
    + kpis([
      { k: '科目总数', v: String(rows.length), u: '个' },
      { k: '标准科目', v: String(SE_CHART.length), u: '个' },
      { k: '本主体自建', v: String(bsCustom().length), u: '个' },
      { k: '停用', v: String(bsCustom().filter(a => a[2] && a[2].off).length), u: '个' },
    ])
    + `<div class="note"><b>规矩（照金蝶/用友的惯例）：</b>有下级或在用（凭证/规则挂着）的科目不能删，只能停用；
      标准科目不可删、改名会落成本主体的覆盖；有下级的科目按惯例不该直接记账——系统提示但不硬拦，因为已有规则挂在上级科目上。停用的科目不再出现在 T2 科目下拉和期初余额里，历史数据不受影响。</div>`
    + form
    + card('科目树', table(
      [{ t: '编码' }, { t: '名称' }, { t: '类别' }, { t: '方向' }, { t: '级次' }, { t: '辅助核算' }, { t: '状态' }, { t: '来源' }, { t: '' }], rows));
};

/* ============ 事件 ============ */
document.addEventListener('change', e => {
  if (e.target.id === 'bsParent') {
    BSS.parent = e.target.value;
    const c = $('bsCode'); if (c && BSS.parent) c.value = bsNextCode(BSS.parent);
  }
});
document.addEventListener('click', e => {
  const sub = e.target.closest('[data-bssub]');
  if (sub) { BSS.parent = sub.dataset.bssub; BSS.edit = ''; go('bs-acct'); return; }
  const ed = e.target.closest('[data-bsedit]');
  if (ed) { BSS.edit = ed.dataset.bsedit; go('bs-acct'); return; }
  const del = e.target.closest('[data-bsdel]');
  if (del && RS) {
    const code = del.dataset.bsdel;
    const used = bsUsed(code);
    if (used) { toast(`该科目在${used}里在用，不能删，只能停用`); return; }
    if (!confirm(`确认删除科目 ${code}？`)) return;
    RS.accounts = RS.accounts.filter(a => String(a[0]) !== code);
    saveRSet(CUR_ENT, RS); toast('已删除'); go('bs-acct'); return;
  }
  const off = e.target.closest('[data-bsoff]') || e.target.closest('[data-bson]');
  if (off && RS) {
    const code = off.dataset.bsoff || off.dataset.bson;
    const a = RS.accounts.find(x => String(x[0]) === code);
    if (a) { a[2] = a[2] || {}; a[2].off = off.dataset.bsoff ? 1 : 0; saveRSet(CUR_ENT, RS); }
    toast(off.dataset.bsoff ? '已停用（不再出现在录入下拉里）' : '已启用'); go('bs-acct'); return;
  }
  const act = e.target.closest('[data-act]');
  if (!act || !CUR_ENT) return;
  if (act.dataset.act === 'bsCancel') { BSS.edit = ''; go('bs-acct'); return; }
  if (act.dataset.act === 'bsSave') {
    if (!RS) RS = initRSet(CUR_ENT);
    const name = (($('bsName') || {}).value || '').trim();
    if (!name) { toast('科目名称不能为空'); return; }
    const dirSel = ($('bsDir') || {}).value;
    const aux = [...document.querySelectorAll('[data-bsaux]:checked')].map(x => x.dataset.bsaux);
    const opts = {};
    if (dirSel && dirSel !== '默认') opts.dir = dirSel;
    if (aux.length) opts.aux = aux;
    if (BSS.edit) {
      // 编辑：自建的就地改；标准的落成本主体覆盖（同编码进 RS.accounts）
      const code = BSS.edit;
      let a = RS.accounts.find(x => String(x[0]) === code);
      if (!a) { a = [code, name]; RS.accounts.push(a); }
      const keep = a[2] || {};
      a[1] = name;
      a[2] = Object.assign({}, opts, keep.off ? { off: keep.off } : {});
      if (opts.dir) a[2].dir = opts.dir; else delete a[2].dir;
      if (aux.length) a[2].aux = aux; else delete a[2].aux;
      saveRSet(CUR_ENT, RS); BSS.edit = '';
      toast(`科目 ${code} 已更新`); go('bs-acct'); return;
    }
    const code = (($('bsCode') || {}).value || '').trim();
    if (!BSS.parent) { toast('先选上级科目'); return; }
    if (!new RegExp('^' + BSS.parent + '\\d{2}$').test(code)) {
      toast(`编码必须是「${BSS.parent} + 2 位数字」，如 ${bsNextCode(BSS.parent)}`); return;
    }
    if (bsFind(code)) { toast('编码已存在：' + code); return; }
    RS.accounts.push([code, name, Object.keys(opts).length ? opts : undefined].filter(x => x !== undefined));
    saveRSet(CUR_ENT, RS);
    toast(`已新增 ${code} ${name}`); go('bs-acct'); return;
  }
  if (act.dataset.act === 'bsExp') {
    const rows = [['编码', '名称', '类别', '余额方向', '级次', '辅助核算', '来源', '状态']];
    ACCOUNTS(1).filter(a => !String(a[0]).includes('{')).forEach(a => {
      const opts = a[2] || {};
      rows.push([a[0], a[1], bsClass(a[0]), bsDir(a[0], opts), bsLevel(a[0]),
        (opts.aux || []).map(k => (BS_AUX.find(x => x[0] === k) || [])[1] || '').join(' '),
        bsIsStd(a[0]) && !bsCustom().some(c => String(c[0]) === String(a[0])) ? '标准' : '自建',
        opts.off ? '停用' : '启用']);
    });
    download(`科目表_${entName()}.csv`, toCSV(rows)); toast('已导出');
  }
});

/* ============ 客户 / 供应商维护 ============ */
/* 按主体各存各的（垂直下放）。这是 科目设置 里「客户/供应商」辅助核算的名册。
   销项票的购方就是客户、进项票的销方就是供应商——可一键从票池收进来，不用手抄。 */
const DIM_KEY = (kind, e) => 'fsc_dim_' + kind + '_' + e + '_v1';
const dimLoad = kind => { try { return JSON.parse(localStorage.getItem(DIM_KEY(kind, CUR_ENT)) || '[]'); } catch (e) { return []; } };
const dimSave = (kind, v) => { try { localStorage.setItem(DIM_KEY(kind, CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败'); } };
const DIMS = { edit: '' };

function dimScreen(kind) {
  const isCust = kind === 'cust';
  const title = isCust ? '客户维护' : '供应商维护';
  if (!CUR_ENT) return needEnt(title);
  const list = dimLoad(kind);
  const editing = DIMS.edit ? list.find(x => x.id === DIMS.edit) : null;
  // 票据里出现次数（信息参考，也是「在用」判断）
  const pool = ivLoad(isCust ? IV_OUT_KEY(CUR_ENT) : IV_IN_KEY(CUR_ENT));
  const cnt = {};
  pool.forEach(x => { if (x.who) cnt[x.who] = (cnt[x.who] || 0) + 1; });
  const rows = list.map(x => [
    x.code ? `<span class="code">${H(x.code)}</span>` : '<span class="mut">—</span>',
    H(x.name), H(x.taxno || '—'), H(x.contact || '—'), H(x.phone || '—'), H(x.memo || '—'),
    cnt[x.name] ? pill(`票据 ${cnt[x.name]} 张`, 'ok') : '<span class="mut">—</span>',
    x.off ? pill('停用', 'wa') : pill('启用', 'ok'),
    `<button class="btn sm" data-dimedit="${H(x.id)}">编辑</button>
     <button class="btn sm" data-dimtoggle="${H(x.id)}">${x.off ? '启用' : '停用'}</button>
     <button class="btn sm" data-dimdel="${H(x.id)}">删除</button>`,
  ]);
  return head(title, `${H(entName())} · ${isCust ? '销项票的购买方就是客户' : '进项票的销售方就是供应商'}，可从票池一键收录。名册按主体隔离。`, '基础 · 辅助核算',
    `<button class="btn" data-act="dimHarvest">从${isCust ? '销项票收客户' : '进项票收供应商'}</button>
     <button class="btn pri" data-act="dimExp">导出</button>`)
    + kpis([
      { k: isCust ? '客户数' : '供应商数', v: String(list.length), u: '个' },
      { k: '票池可收录', v: String(Object.keys(cnt).filter(n => !list.some(x => x.name === n)).length), u: '个', t: 'g' },
      { k: '停用', v: String(list.filter(x => x.off).length), u: '个' },
    ])
    + cardp(editing ? `编辑：${H(editing.name)}` : '新增' + (isCust ? '客户' : '供应商'), `
      <div class="cols c4">
        <div class="field"><label class="fl">编码</label><input id="dmCode" value="${editing ? H(editing.code || '') : ''}" placeholder="如 00001"></div>
        <div class="field"><label class="fl">名称 <span class="red">*</span></label><input id="dmName" value="${editing ? H(editing.name) : ''}"></div>
        <div class="field"><label class="fl">纳税人识别号</label><input id="dmTax" value="${editing ? H(editing.taxno || '') : ''}"></div>
        <div class="field"><label class="fl">联系人</label><input id="dmContact" value="${editing ? H(editing.contact || '') : ''}"></div>
        <div class="field"><label class="fl">电话</label><input id="dmPhone" value="${editing ? H(editing.phone || '') : ''}"></div>
      </div>
      <div class="field" style="margin-top:8px"><label class="fl">备注</label><input id="dmMemo" value="${editing ? H(editing.memo || '') : ''}"></div>
      <div style="text-align:right;margin-top:9px">
        ${editing ? '<button class="btn" data-act="dimCancel">取消</button> ' : ''}
        <button class="btn pri" data-act="dimSave">${editing ? '保存修改' : '新增'}</button></div>`)
    + card('名册', rows.length ? table(
      [{ t: '编码' }, { t: '名称' }, { t: '纳税人识别号' }, { t: '联系人' }, { t: '电话' }, { t: '备注' }, { t: '票据' }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有${isCust ? '客户' : '供应商'}——手工新增，或从票池一键收录</div>`);
}
S['bs-cust'] = () => dimScreen('cust');
S['bs-supp'] = () => dimScreen('supp');

/* ============ 项目维护 ============ */
/* 项目就是 T2 在用的那份（RS.projects）——单一真相源，不另存一份。
   关键词（kw）是 T2 自动认项目的依据：摘要/户名里含关键词就归到该项目。 */
S['bs-proj'] = () => {
  if (!CUR_ENT) return needEnt('项目维护');
  const ps = (RS && RS.projects) || [];
  const editing = DIMS.edit ? ps.find(x => x.code === DIMS.edit) : null;
  const usedCnt = code => {
    try { return vchLoad(CUR_ENT).reduce((s, v) => s + v.lines.filter(l => String(l.acct).endsWith('_' + code)).length, 0); }
    catch (e) { return 0; }
  };
  const rows = ps.map(x => {
    const n = usedCnt(x.code);
    return [`<span class="code">${H(x.code)}</span>`, H(x.name), `<span class="code">${H(x.kw || '—')}</span>`,
      n ? pill(`凭证 ${n} 行`, 'ok') : '<span class="mut">—</span>',
      `<button class="btn sm" data-pjedit="${H(x.code)}">编辑</button>
       ${n ? '' : `<button class="btn sm" data-pjdel="${H(x.code)}">删除</button>`}`];
  });
  return head('项目维护', `${H(entName())} · 项目按主体隔离，是科目后缀（如 5001_${ps[0] ? H(ps[0].code) : '2001'}）和 T2 自动归项的依据。`, '基础 · 辅助核算')
    + kpis([{ k: '项目数', v: String(ps.length), u: '个' }])
    + `<div class="note"><b>关键词是 T2 自动认项目的依据：</b>银行流水的摘要或对方户名里含关键词（支持正则，| 分隔多个），就自动归到该项目。凭证里项目落在科目后缀上（科目编码_项目代码），报表按项目拆分靠它。有凭证在用的项目不能删。</div>`
    + cardp(editing ? `编辑项目 ${H(editing.code)}` : '新增项目', `
      <div class="cols c4">
        <div class="field"><label class="fl">项目代码（4 位数字）<span class="red">*</span></label>
          <input id="pjCode" value="${editing ? H(editing.code) : ''}" ${editing ? 'disabled' : ''} placeholder="如 3001"></div>
        <div class="field"><label class="fl">项目名称 <span class="red">*</span></label><input id="pjName" value="${editing ? H(editing.name) : ''}"></div>
        <div class="field" style="grid-column:span 2"><label class="fl">识别关键词（正则，| 分隔）</label>
          <input id="pjKw" value="${editing ? H(editing.kw || '') : ''}" placeholder="如 花都|UU公寓"></div>
      </div>
      <div style="text-align:right;margin-top:9px">
        ${editing ? '<button class="btn" data-act="pjCancel">取消</button> ' : ''}
        <button class="btn pri" data-act="pjSave">${editing ? '保存修改' : '新增项目'}</button></div>`)
    + card('项目清单', rows.length ? table(
      [{ t: '代码' }, { t: '名称' }, { t: '识别关键词' }, { t: '在用' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有项目</div>`);
};

/* ============ 主体档案（主体名录维护） ============ */
/* 主体名录从代码写死改成可维护（2026-08-31 负责人拍板）：预置只是首次种子，
   之后以 fsc_entities_v1 为准。规矩照科目/账户台账的惯例：
   - id 是数据的根（所有存储键都拼着它），建了就不许改
   - 有数据的主体不许删，只能停用——停用不进各处主体下拉，数据原样保留
   - 删除只对「一处数据都没有」的主体开放 */
const ENT_ADM = { edit: '' };
/* 存储键里的固定段——新主体 id 撞上任何一个，entHasData 的 `_<id>_` 匹配
   会把全公司的数据都算到它头上（比如 id 取 'ar' 会命中 fsc_rec_ar_e05_v1 里的 _ar_） */
const ENT_RESERVED = new Set(['ar', 'ap', 'hx', 'rec', 'cfg', 'cust', 'supp', 'dept', 'staff', 'proj',
  'dim', 'iv', 'in', 'out', 'noinv', 'prof', 'adj', 'iit', 'fa', 'vch', 'pay', 'emp', 'sal',
  'rset', 'rules', 't1', 't2', 't3', 't4', 'cur', 'ac', 'cons', 'reg', 'entities', 'accounts',
  'daily', 'balsrc', 'txns', 'log', 'tpl', 'data']);
function entHasData(id) {
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('fsc_') && k.includes('_' + id + '_')) n++;
  }
  // localStorage 键之外还有三处「该主体的数据」，漏了会在鲜浏览器上把 youqi 都放行删掉：
  // ①代码内置规则集 ②T1 账户台账（按主体全称挂）③合并范围配置
  try { if (typeof RULE_SETS !== 'undefined' && RULE_SETS[id]) n++; } catch (e) { /* 忽略 */ }
  try {
    const full = (ENTITIES.find(x => x.id === id) || {}).full;
    if (full && typeof T1_ACC !== 'undefined' && T1_ACC.some(a => a.ent === full)) n++;
  } catch (e) { /* 忽略 */ }
  try {
    const cc = localStorage.getItem('fsc_cons_cfg_v1');
    if (cc && cc.includes('"' + id + '"')) n++;
  } catch (e) { /* 忽略 */ }
  try {
    const reg = localStorage.getItem('fsc_cons_reg_v1');
    if (reg && (reg.includes('"a":"' + id + '"') || reg.includes('"b":"' + id + '"'))) n++;
  } catch (e) { /* 忽略 */ }
  return n;
}
function entNextId() {
  // 扫现存最大序号 +1。只防「现存主体」撞号——删掉的零数据主体序号可能复用（它名下本就没数据，无害）
  let max = 0;
  ENTITIES.forEach(e => { const m = /^e(\d+)$/.exec(e.id); if (m) max = Math.max(max, +m[1]); });
  return 'e' + String(Math.max(max, 25) + 1).padStart(2, '0');
}
S['p-entity'] = () => {
  const list = ENTITIES;
  const editing = ENT_ADM.edit ? list.find(x => x.id === ENT_ADM.edit) : null;
  const e0 = editing || {};
  const onN = list.filter(x => !x.off).length;
  const form = cardp(editing ? `编辑主体 ${H(editing.id)}` : '新增主体', `
    <div class="cols c4">
      <div class="field"><label class="fl">主体编号${editing ? '（不可改——所有数据都挂在它上）' : '（空=自动编号，或小写字母数字 2-16 位）'}</label>
        <input id="enId" value="${H(e0.id || '')}" ${editing ? 'disabled' : ''} placeholder="如 ${entNextId()}"></div>
      <div class="field"><label class="fl">主体全称 *</label>
        <input id="enFull" value="${H(e0.full || '')}" placeholder="如：广州XX科技有限公司"></div>
      <div class="field"><label class="fl">业务线（选填）</label>
        <input id="enLine" value="${H(e0.line || '')}" placeholder="如：出租屋 / 电商"></div>
    </div>
    <div style="text-align:right;margin-top:9px">
      ${editing ? '<button class="btn" data-act="enCancel">取消</button> ' : ''}
      <button class="btn pri" data-act="enSave">${editing ? '保存修改' : '新增主体'}</button></div>`);
  const rows = list.map(x => {
    const n = entHasData(x.id);
    return [
      `<span class="code">${H(x.id)}</span>`,
      `<span style="${x.off ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${H(x.full)}</span>${x.id === CUR_ENT ? ' ' + pill('当前', 'ok') : ''}`,
      H(x.line || '—'),
      n ? pill(`${n} 处数据`, 'ok') : '<span class="mut">无数据</span>',
      x.off ? pill('停用', 'wa') : pill('在管', 'ok'),
      `<button class="btn sm" data-enedit="${H(x.id)}">编辑</button>
       ${x.off ? `<button class="btn sm" data-enon="${H(x.id)}">启用</button>` : `<button class="btn sm" data-enoff="${H(x.id)}">停用</button>`}
       <button class="btn sm" data-endel="${H(x.id)}">删除</button>`,
    ];
  });
  return head('主体档案', `全集团主体名录：新主体在这里加，右上角主体下拉、T2、往来对账等所有按主体的功能立即可用。<b>有数据的主体不能删，只能停用</b>（数据保留，下拉里不再出现）。`, '基础 · 主体',
    `<button class="btn pri" data-act="enExp">导出名录</button>`)
    + kpis([
      { k: '主体总数', v: String(list.length), u: '个' },
      { k: '在管', v: String(onN), u: '个', t: 'g' },
      { k: '停用', v: String(list.length - onN), u: '个', t: (list.length - onN) ? 'w' : '' },
      { k: '有数据的主体', v: String(list.filter(x => entHasData(x.id)).length), u: '个' },
    ])
    + `<div class="note"><b>主体编号是数据的根</b>（台账/凭证/名册的存储都按它隔离），建好就不能改。
      无数据的主体一键删除；<b>有数据的主体也能删，但会连名下数据一起彻底删掉</b>——要先看清数据清单、再手输主体全称双重确认，删了找不回来。
      只是不想让它出现在下拉里的话，用「停用」：数据原样保留，随时启用。</div>`
    + form
    + card('主体名录', table(
      [{ t: '编号' }, { t: '主体全称' }, { t: '业务线' }, { t: '数据' }, { t: '状态' }, { t: '' }], rows));
};

/* ============ 主体档案事件 ============ */
document.addEventListener('click', e => {
  const ed = e.target.closest('[data-enedit]');
  if (ed) { ENT_ADM.edit = ed.dataset.enedit; go('p-entity'); return; }
  const off = e.target.closest('[data-enoff]');
  if (off) {
    const x = ENTITIES.find(v => v.id === off.dataset.enoff);
    if (!x || !confirm(`停用「${x.full}」？它不再出现在主体下拉里，数据原样保留，随时可启用。`)) return;
    x.off = 1; entSaveAll(ENTITIES);
    if (CUR_ENT === x.id) { pickEnt(''); }   // 停的是当前主体 → 切到未选
    toast('已停用'); go('p-entity'); return;
  }
  const on = e.target.closest('[data-enon]');
  if (on) {
    const x = ENTITIES.find(v => v.id === on.dataset.enon);
    if (x) { delete x.off; entSaveAll(ENTITIES); toast('已启用'); }
    go('p-entity'); return;
  }
  const dl = e.target.closest('[data-endel]');
  if (dl) {
    const x = ENTITIES.find(v => v.id === dl.dataset.endel);
    if (!x) return;
    const done = why => {
      entSaveAll(ENTITIES.filter(v => v.id !== x.id));
      if (CUR_ENT === x.id) pickEnt('');
      if (ENT_ADM.edit === x.id) ENT_ADM.edit = '';
      toast(why, 5600); go('p-entity');
    };
    const n = entHasData(x.id);
    if (!n) {
      if (!confirm(`确认删除主体「${x.full}」（${x.id}）？它名下没有任何数据。`)) return;
      done('已删除'); return;
    }
    // 有数据也允许删（2026-08-31 负责人要求），但要看清删什么 + 手输全称双确认——
    // 删的是这套账本身，手滑没有回头路
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fsc_') && k.includes('_' + x.id + '_')) keys.push(k);
    }
    let accIds = [];
    try { if (typeof T1_ACC !== 'undefined') accIds = T1_ACC.filter(a => a.ent === x.full).map(a => a.id); } catch (e2) { /* 忽略 */ }
    const t1n = accIds.length;
    const desc = [keys.length ? `${keys.length} 处存储数据` : '',
      t1n ? `T1 台账 ${t1n} 个账户（连同其余额与流水历史）` : ''].filter(Boolean).join('、')
      || '内置规则集/合并模块引用这类代码级残留';
    if (!confirm(`「${x.full}」名下有 ${desc}。\n\n要连同这些一起彻底删除吗？删了找不回来。\n（只是不想让它出现在下拉里的话，用「停用」就够了，数据能保住）`)) return;
    const typed = prompt(`危险操作最后确认：请原样输入主体全称\n${x.full}`);
    if (typed === null) return;
    if (typed.trim() !== x.full) { toast('输入的全称对不上，没有删'); return; }
    keys.forEach(k => { try { localStorage.removeItem(k); } catch (e2) { /* 忽略 */ } });
    try {
      if (t1n && typeof T1_ACC !== 'undefined') {
        T1_ACC = T1_ACC.filter(a => a.ent !== x.full);
        if (typeof t1SaveAcc === 'function') t1SaveAcc(T1_ACC);
      }
    } catch (e2) { /* 忽略 */ }
    // 日报余额/余额来源/流水明细都按「账户 id」存（键名不带主体 id，上面的扫键扫不到）——
    // 账户删了这些必须跟着清：t1NextSeq 会复用最高号，孤儿余额会被将来同号的新账户继承
    if (accIds.length) {
      const wipeByAcc = (key, byDate) => {
        try {
          const o = JSON.parse(localStorage.getItem(key) || '{}');
          if (byDate) {
            Object.keys(o).forEach(d => { accIds.forEach(id2 => delete o[d][id2]); if (!Object.keys(o[d]).length) delete o[d]; });
          } else accIds.forEach(id2 => delete o[id2]);
          localStorage.setItem(key, JSON.stringify(o));
        } catch (e2) { /* 忽略 */ }
      };
      wipeByAcc('fsc_t1_daily_v1', 1); wipeByAcc('fsc_t1_balsrc_v1', 1); wipeByAcc('fsc_t1_txns_v1', 0);
    }
    // 合并模块联动剔除：留着悬空 id 会让内部交易抵消变成单边抵、报表出错数
    try {
      const cc = JSON.parse(localStorage.getItem('fsc_cons_cfg_v1') || 'null');
      if (cc) {
        let chg = 0;
        if (cc.parent === x.id) { cc.parent = ''; chg = 1; }
        if (Array.isArray(cc.subs) && cc.subs.indexOf(x.id) >= 0) { cc.subs = cc.subs.filter(v => v !== x.id); chg = 1; }
        if (chg) localStorage.setItem('fsc_cons_cfg_v1', JSON.stringify(cc));
      }
    } catch (e2) { /* 忽略 */ }
    try {
      const reg = JSON.parse(localStorage.getItem('fsc_cons_reg_v1') || 'null');
      if (Array.isArray(reg)) {
        const left = reg.filter(r => r && r.a !== x.id && r.b !== x.id);
        if (left.length !== reg.length) localStorage.setItem('fsc_cons_reg_v1', JSON.stringify(left));
      }
    } catch (e2) { /* 忽略 */ }
    done(`已彻底删除「${x.full}」：${desc}`);
    return;
  }
  const a0 = e.target.closest('[data-act]');
  if (a0 && a0.dataset.act === 'enCancel') { ENT_ADM.edit = ''; go('p-entity'); return; }
  if (a0 && a0.dataset.act === 'enSave') {
    const full = (($('enFull') || {}).value || '').trim();
    if (!full) { toast('主体全称不能为空'); return; }
    const line = (($('enLine') || {}).value || '').trim();
    if (ENT_ADM.edit) {
      const x = ENTITIES.find(v => v.id === ENT_ADM.edit);
      if (x) {
        if (ENTITIES.some(v => v.id !== x.id && v.full === full)) { toast('已有同名主体：' + full); return; }
        const oldFull = x.full;
        x.full = full; x.line = line;
        entSaveAll(ENTITIES); ENT_ADM.edit = '';
        // T1 账户台账按「主体全称」挂账户（T2 认户、资金日报都靠字字相同）——
        // 改名必须把台账里的旧全称一起改掉，否则该主体的账户全部失联
        let nAcc = 0;
        try {
          if (oldFull !== full && typeof T1_ACC !== 'undefined') {
            T1_ACC.forEach(a => { if (a.ent === oldFull) { a.ent = full; nAcc++; } });
            if (nAcc && typeof t1SaveAcc === 'function') t1SaveAcc(T1_ACC);
          }
        } catch (e) { /* 忽略 */ }
        renderEntBar();   // 顶栏显示的当前主体名可能改了
        toast('已保存' + (nAcc ? `；T1 台账 ${nAcc} 个账户的主体名已同步` : ''), nAcc ? 5200 : 2600);
        go('p-entity'); return;
      }
      ENT_ADM.edit = '';
    }
    let id = (($('enId') || {}).value || '').trim().toLowerCase();
    if (!id) id = entNextId();
    else if (!/^[a-z][a-z0-9]{1,15}$/.test(id)) { toast('编号要小写字母开头、字母数字 2-16 位，如 ' + entNextId()); return; }
    if (ENT_RESERVED.has(id)) { toast('「' + id + '」是系统保留字（会跟存储键撞车），换一个，比如 ' + entNextId()); return; }
    if (ENTITIES.some(v => v.id === id)) { toast('编号已存在：' + id); return; }
    if (ENTITIES.some(v => v.full === full)) { toast('已有同名主体：' + full); return; }
    entSaveAll(ENTITIES.concat([{ id, full, line }]));
    toast(`已新增主体 ${full}（${id}），右上角下拉即可选用`, 5200); go('p-entity'); return;
  }
  if (a0 && a0.dataset.act === 'enExp') {
    download('主体名录.csv', toCSV([['编号', '主体全称', '业务线', '状态', '数据项数']]
      .concat(ENTITIES.map(x => [x.id, x.full, x.line || '', x.off ? '停用' : '在管', entHasData(x.id)]))));
    toast('已导出'); return;
  }
});

/* ============ 客商/项目事件 ============ */
document.addEventListener('click', e => {
  const kindOf = () => (CURS === 'bs-cust' ? 'cust' : CURS === 'bs-supp' ? 'supp'
    : CURS === 'bs-dept' ? 'dept' : CURS === 'bs-staff' ? 'staff' : 'supp');
  const de = e.target.closest('[data-dimedit]');
  if (de) { DIMS.edit = de.dataset.dimedit; go(CURS); return; }
  const dt = e.target.closest('[data-dimtoggle]');
  if (dt) {
    const list = dimLoad(kindOf());
    const x = list.find(v => v.id === dt.dataset.dimtoggle);
    if (x) { x.off = x.off ? 0 : 1; dimSave(kindOf(), list); }
    go(CURS); return;
  }
  const dd = e.target.closest('[data-dimdel]');
  if (dd) {
    const list = dimLoad(kindOf());
    const x = list.find(v => v.id === dd.dataset.dimdel);
    if (!x || !confirm(`确认删除「${x.name}」？票据数据不受影响。`)) return;
    dimSave(kindOf(), list.filter(v => v.id !== x.id));
    toast('已删除'); go(CURS); return;
  }
  const pe = e.target.closest('[data-pjedit]');
  if (pe) { DIMS.edit = pe.dataset.pjedit; go('bs-proj'); return; }
  const pd = e.target.closest('[data-pjdel]');
  if (pd && RS) {
    if (!confirm('确认删除该项目？')) return;
    RS.projects = (RS.projects || []).filter(x => x.code !== pd.dataset.pjdel);
    saveRSet(CUR_ENT, RS); toast('已删除'); go('bs-proj'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  if (act === 'dimCancel' || act === 'pjCancel') { DIMS.edit = ''; go(CURS); return; }
  if (act === 'dimSave') {
    const name = (($('dmName') || {}).value || '').trim();
    if (!name) { toast('名称不能为空'); return; }
    const kind = kindOf(); const list = dimLoad(kind);
    if (!DIMS.edit && list.some(x => x.name === name)) { toast('已存在同名记录'); return; }
    const rec = DIMS.edit ? list.find(x => x.id === DIMS.edit)
      : (list.push({ id: uid() }), list[list.length - 1]);
    Object.assign(rec, { name, code: (($('dmCode') || {}).value || '').trim(),
      taxno: ($('dmTax') || {}).value || '', contact: ($('dmContact') || {}).value || '',
      phone: ($('dmPhone') || {}).value || '', memo: ($('dmMemo') || {}).value || '',
      dept: (($('dmDept') || {}).value || '').trim() });
    dimSave(kind, list); DIMS.edit = '';
    toast('已保存'); go(CURS); return;
  }
  if (act === 'dimHarvest') {
    const kind = kindOf();
    const pool = ivLoad(kind === 'cust' ? IV_OUT_KEY(CUR_ENT) : IV_IN_KEY(CUR_ENT));
    const list = dimLoad(kind);
    const have = new Set(list.map(x => x.name));
    let n = 0;
    [...new Set(pool.map(x => x.who).filter(Boolean))].forEach(nm => {
      if (!have.has(nm)) { list.push({ id: uid(), name: nm, memo: '从票池收录' }); n++; }
    });
    dimSave(kind, list);
    toast(n ? `收录 ${n} 个（票池里已有名册的跳过）` : '票池里没有新名字', 4200); go(CURS); return;
  }
  if (act === 'dimExp') {
    const kind = kindOf(); const list = dimLoad(kind);
    download(`${DIM_NAME[kind]}名册_${entName()}.csv`,
      toCSV([['编码', '名称', '纳税人识别号', '联系人', '电话', '备注', '状态']]
        .concat(list.map(x => [x.code || '', x.name, x.taxno || '', x.contact || '', x.phone || '', x.memo || '', x.off ? '停用' : '启用']))));
    toast('已导出'); return;
  }
  if (act === 'pjSave') {
    if (!RS) RS = initRSet(CUR_ENT);
    RS.projects = RS.projects || [];
    const name = (($('pjName') || {}).value || '').trim();
    const kw = (($('pjKw') || {}).value || '').trim();
    if (!name) { toast('项目名称不能为空'); return; }
    try { if (kw) new RegExp(kw); } catch (err) { toast('关键词不是合法正则：' + err.message); return; }
    if (DIMS.edit) {
      const x = RS.projects.find(v => v.code === DIMS.edit);
      if (x) { x.name = name; x.kw = kw; }
    } else {
      const code = (($('pjCode') || {}).value || '').trim();
      if (!/^\d{4}$/.test(code)) { toast('项目代码要 4 位数字，如 3001'); return; }
      if (RS.projects.some(v => v.code === code)) { toast('代码已存在：' + code); return; }
      RS.projects.push({ code, name, kw });
    }
    saveRSet(CUR_ENT, RS); DIMS.edit = '';
    toast('已保存'); go('bs-proj'); return;
  }
});

/* ============ 部门 / 职员维护 ============ */
/* 跟客户/供应商同一套存储（fsc_dim_<类别>_<主体>_v1），只是字段少：
   编码 + 名称 + 备注（职员多一个所属部门）。金蝶那边就是这四类辅助核算，
   凭证模版的「部门」「职员」两列填的是编码，所以编码必须留住。 */
const DIM_NAME = { cust: '客户', supp: '供应商', dept: '部门', staff: '职员' };

function dimSimpleScreen(kind) {
  const nm = DIM_NAME[kind];
  if (!CUR_ENT) return needEnt(nm + '维护');
  const list = dimLoad(kind);
  const editing = DIMS.edit ? list.find(x => x.id === DIMS.edit) : null;
  const depts = dimLoad('dept');
  const rows = list.map(x => [
    x.code ? `<span class="code">${H(x.code)}</span>` : '<span class="mut">—</span>',
    H(x.name),
    ...(kind === 'staff' ? [H(x.dept || '—')] : []),
    H(x.memo || '—'),
    x.off ? pill('停用', 'wa') : pill('启用', 'ok'),
    `<button class="btn sm" data-dimedit="${H(x.id)}">编辑</button>
     <button class="btn sm" data-dimtoggle="${H(x.id)}">${x.off ? '启用' : '停用'}</button>
     <button class="btn sm" data-dimdel="${H(x.id)}">删除</button>`,
  ]);
  return head(nm + '维护', `${H(entName())} · ${nm}是凭证上的辅助核算之一，按主体隔离。金蝶导入模版的「${nm}」列填的是编码。`, '基础 · 辅助核算',
    `<button class="btn" data-go="bs-imp">批量导入</button>
     <button class="btn pri" data-act="dimExp">导出</button>`)
    + kpis([
      { k: nm + '数', v: String(list.length), u: '个' },
      { k: '停用', v: String(list.filter(x => x.off).length), u: '个' },
    ])
    + cardp(editing ? `编辑：${H(editing.name)}` : '新增' + nm, `
      <div class="cols c4">
        <div class="field"><label class="fl">编码</label><input id="dmCode" value="${editing ? H(editing.code || '') : ''}" placeholder="如 1001"></div>
        <div class="field"><label class="fl">名称 <span class="red">*</span></label><input id="dmName" value="${editing ? H(editing.name) : ''}"></div>
        ${kind === 'staff' ? `<div class="field"><label class="fl">所属部门</label>
          <input id="dmDept" list="dmDeptList" value="${editing ? H(editing.dept || '') : ''}" placeholder="选或填">
          <datalist id="dmDeptList">${depts.map(d => `<option value="${H(d.name)}">`).join('')}</datalist></div>` : ''}
        <div class="field"><label class="fl">备注</label><input id="dmMemo" value="${editing ? H(editing.memo || '') : ''}"></div>
      </div>
      <div style="text-align:right;margin-top:9px">
        ${editing ? '<button class="btn" data-act="dimCancel">取消</button> ' : ''}
        <button class="btn pri" data-act="dimSave">${editing ? '保存修改' : '新增'}</button></div>`)
    + card('名册', rows.length ? table(
      [{ t: '编码' }, { t: '名称' }, ...(kind === 'staff' ? [{ t: '所属部门' }] : []),
        { t: '备注' }, { t: '状态' }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有${nm}——手工新增，或去「主数据导入」把金蝶导出的辅助核算表整份导进来</div>`);
}
S['bs-dept'] = () => dimSimpleScreen('dept');
S['bs-staff'] = () => dimSimpleScreen('staff');

/* ============ 主数据导入 ============ */
/* 金蝶那边导出的两类表，一次全导进来（可多选文件）：
   ① 科目余额表 —— 建科目 + 落两张系统凭证：
      「年初余额」（2025-12-31）与「本年累计」（期间末日）。
      为什么要拆两张：期末余额 = 年初 + 本年累计发生额，
      拆开之后 8 月起的账簿三组数才各就各位——
      期初 = 年初 + 本年累计（= 上期期末）、本期 = 只有 8 月自己录的凭证、
      本年累计 = 1〜7 月 + 8 月。三张报表跟着自动对上。
   ② 辅助核算表（客户/供应商/项目/部门/职员）—— 各进各的名册，按编码认、重复即更新。 */
const MDI = { files: [] };
const MDI_KIND = { 客户: 'cust', 供应商: 'supp', 部门: 'dept', 职员: 'staff', 项目: 'proj' };
const YTD_ID = '__ytd__';
const mdiTrim = v => String(v == null ? '' : v).replace(/\s|　/g, '');
const mdiNum = v => {
  const n = Number(String(v == null ? '' : v).replace(/[,，¥￥\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

/* 认表：辅助核算表第一行就是 类别|编码|名称；科目余额表要找「科目编码」那行 */
function mdiSniff(rows) {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = (rows[i] || []).map(mdiTrim);
    if (r[0] === '类别' && r[1] === '编码' && r[2] === '名称') {
      const first = (rows[i + 1] || []).map(mdiTrim);
      const kind = MDI_KIND[first[0]];
      return kind ? { type: 'aux', kind, kindName: first[0], head: i }
        : { type: '?', why: '认不出是哪类辅助核算：' + (first[0] || '(空)') };
    }
    if (r.some(c => c === '科目编码')) {
      // 合并单元格被解析成左右两格同名（期初余额|期初余额），
      // 只认第一次出现的那格——它才是借方列，紧挨着的下一格是贷方
      const col = {};
      const put = (k, j) => { if (col[k] === undefined) col[k] = j; };
      r.forEach((c, j) => {
        if (c === '科目编码') put('code', j);
        else if (c === '科目名称') put('name', j);
        else if (/^期初/.test(c)) put('ob', j);
        else if (/^本期/.test(c)) put('cur', j);
        else if (/^本年/.test(c)) put('ytd', j);
        else if (/^期末/.test(c)) put('eb', j);
      });
      if (col.code === undefined || col.eb === undefined || col.ytd === undefined) {
        return { type: '?', why: '像科目余额表，但缺「期末余额」或「本年累计发生额」列' };
      }
      // 下一行是「借方/贷方」子表头的话，数据从再下一行开始
      const sub = (rows[i + 1] || []).map(mdiTrim);
      const dataFrom = sub.some(c => c === '借方' || c === '贷方') ? i + 2 : i + 1;
      return { type: 'bal', head: i, col, dataFrom };
    }
  }
  return { type: '?', why: '既不像科目余额表，也不像辅助核算表' };
}

/* 期间末日：从「2026年第7期」这种字样里抠，抠不出就用当前期间 */
function mdiPeriodEnd(rows) {
  const txt = rows.slice(0, 4).map(r => (r || []).join(' ')).join(' ');
  const m = /(\d{4})\s*年\s*第?\s*(\d{1,2})\s*期/.exec(txt) || /(\d{4})[-/](\d{1,2})/.exec(txt);
  if (!m) return '';
  const y = +m[1], mo = +m[2];
  const last = new Date(y, mo, 0).getDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

async function mdiLoad(fileList) {
  const files = [].slice.call(fileList || []);
  if (!files.length) return;
  toast(`正在解析 ${files.length} 份文件…`);
  const ok = [], bad = [];
  for (const file of files) {
    try {
      const rows = await XLSXLite.readTable(file);
      const sn = mdiSniff(rows);
      ok.push({ fileName: file.name, rows, sn, periodEnd: sn.type === 'bal' ? mdiPeriodEnd(rows) : '' });
    } catch (e) { bad.push(file.name + '：' + e.message); }
  }
  if (!ok.length) { toast('读取失败：' + bad.join('；'), 4600); return; }
  MDI.files = MDI.files.concat(ok);
  go('bs-imp');
  toast(`读到 ${ok.length} 份` + (bad.length ? `；${bad.length} 份读不了` : ''), 4200);
}

/* 辅助核算表 → 名册条目 */
function mdiAuxPlan(f) {
  const { head, kind } = f.sn;
  const c = (f.rows[head] || []).map(mdiTrim);
  const items = [];
  f.rows.slice(head + 1).forEach(r => {
    const at = n => { const j = c.indexOf(n); return j < 0 ? '' : String(r[j] == null ? '' : r[j]).trim(); };
    const code = at('编码'), name = at('名称');
    if (!name) return;
    items.push({ code, name, memo: at('备注'), dept: at('部门'), off: at('启用状态') === '否' ? 1 : 0 });
  });
  if (kind === 'proj') {
    const have = new Set(((RS && RS.projects) || []).map(p => p.code));
    return { kind, items, add: items.filter(x => !have.has(x.code)).length, upd: items.filter(x => have.has(x.code)).length };
  }
  const list = dimLoad(kind);
  const hit = x => list.find(v => (x.code && v.code === x.code) || v.name === x.name);
  return { kind, items, add: items.filter(x => !hit(x)).length, upd: items.filter(x => hit(x)).length };
}

/* 科目余额表 → 科目清单 + 两张凭证的行 */
function mdiBalPlan(f) {
  const { col, dataFrom } = f.sn;
  const raw = [];
  f.rows.slice(dataFrom).forEach(r => {
    const code = mdiTrim(r[col.code]);
    if (!code || !/^\d/.test(code)) return;          // 小计/合计行没有科目编码
    raw.push({
      code, name: String(r[col.name] == null ? '' : r[col.name]).trim(),
      ebDr: mdiNum(r[col.eb]), ebCr: mdiNum(r[col.eb + 1]),
      ydr: mdiNum(r[col.ytd]), ycr: mdiNum(r[col.ytd + 1]),
    });
  });
  // 末级才取数：上级科目是下级之和，两头都取会翻倍
  const codes = raw.map(x => x.code);
  const isLeaf = c => !codes.some(x => x !== c && x.startsWith(c));
  const leaves = raw.filter(x => isLeaf(x.code));

  // 科目表：项目后缀（5001_2001）不是科目，砍掉后缀再去重
  const acctSeen = new Set(), accts = [];
  raw.forEach(x => {
    const base = x.code.split('_')[0];
    if (acctSeen.has(base)) return;
    acctSeen.add(base);
    const nm = x.name.split('_').slice(0, x.code.includes('_') ? -1 : undefined).join('_') || x.name;
    accts.push({ code: base, name: nm, exists: !!bsFind(base) });
  });

  /* 金蝶那边损益科目每月结转过（收入借贷各一次、期末为 0），本系统不做结转、
     损益累计到年末才滚进未分配利润。原样导会让利润表本年累计全变成 0，
     所以损益科目只导自然方向那一半（收入取贷方累计、成本费用取借方累计），
     结转那一半连同「本年利润」科目整段丢掉——丢掉的借贷两边金额相等，凭证仍然平。
     代价：期间内红字冲销的部分会算进毛额里（结转与冲红在累计数上分不开）。 */
  const isPnl = c => /^5/.test(c);
  const isCarry = c => /^(3103|4103)/.test(c);       // 本年利润：本年发生额全是结转
  const ob = [], ytd = [];
  let dropDr = 0, dropCr = 0;
  leaves.forEach(x => {
    const base = x.code.split('_')[0];
    const ytdNet = x.ydr - x.ycr;
    const ebNet = x.ebDr - x.ebCr;
    const obNet = +(ebNet - ytdNet).toFixed(2);      // 年初 = 期末 − 本年累计发生净额（用原始数）
    if (Math.abs(obNet) > 0.005) {
      ob.push({ acct: x.code, name: x.name, memo: '年初余额（金蝶导入）',
        dr: obNet > 0 ? obNet : 0, cr: obNet < 0 ? -obNet : 0 });
    }
    let dr = x.ydr, cr = x.ycr;
    if (isCarry(base)) { dropDr += dr; dropCr += cr; dr = 0; cr = 0; }
    else if (isPnl(base)) {
      const carry = Math.min(Math.abs(dr), Math.abs(cr));
      if (bsDir(base) === '贷') { dropDr += carry; dr = +(dr - carry).toFixed(2); }
      else { dropCr += carry; cr = +(cr - carry).toFixed(2); }
    }
    if (Math.abs(dr) > 0.005 || Math.abs(cr) > 0.005) {
      ytd.push({ acct: x.code, name: x.name, memo: '本年累计发生额（金蝶导入）',
        dr: +dr.toFixed(2), cr: +cr.toFixed(2) });
    }
  });
  const sum = (l, k) => +l.reduce((s, x) => s + x[k], 0).toFixed(2);
  /* 丢结转时，损益科目上「贷方冲红」这类跟结转混在一起的部分分不开，
     两边丢的金额可能差几百块。差额单独挂一行本年利润，凭证保持借贷平——
     它在利润表里不参与行次，在资产负债表里跟损益一起滚进未分配利润，两头都不歪。 */
  const carryDiff = +(sum(ytd, 'dr') - sum(ytd, 'cr')).toFixed(2);
  if (Math.abs(carryDiff) > 0.005) {
    ytd.push({ acct: '3103', name: '本年利润', memo: '结转差额（导入平衡）',
      dr: carryDiff < 0 ? -carryDiff : 0, cr: carryDiff > 0 ? carryDiff : 0 });
  }
  return {
    accts, leaves: leaves.length, rows: raw.length, ob, ytd, carryDiff,
    dropDr: +dropDr.toFixed(2), dropCr: +dropCr.toFixed(2),
    obDiff: +(sum(ob, 'dr') - sum(ob, 'cr')).toFixed(2),
    ytdDiff: +(sum(ytd, 'dr') - sum(ytd, 'cr')).toFixed(2),
    obDr: sum(ob, 'dr'), ytdDr: sum(ytd, 'dr'),
    newAccts: accts.filter(a => !a.exists).length,
  };
}

const mdiPlan = f => (f.sn.type === 'aux' ? mdiAuxPlan(f) : f.sn.type === 'bal' ? mdiBalPlan(f) : null);

function mdiApply() {
  if (!CUR_ENT) { toast('先在右上角选主体'); return; }
  if (!RS) RS = initRSet(CUR_ENT);
  let nAux = 0, nAcct = 0, nOb = 0, nYtd = 0, nFile = 0;
  const done = [];

  MDI.files.forEach(f => {
    if (f.sn.type === 'aux') {
      const p = mdiAuxPlan(f);
      if (p.kind === 'proj') {
        RS.projects = RS.projects || [];
        p.items.forEach(x => {
          const hit = RS.projects.find(v => v.code === x.code);
          if (hit) hit.name = x.name;                       // kw 是本地养出来的，导入不覆盖
          else RS.projects.push({ code: x.code, name: x.name, kw: '' });
          nAux++;
        });
        saveRSet(CUR_ENT, RS);
      } else {
        const list = dimLoad(p.kind);
        p.items.forEach(x => {
          const hit = list.find(v => (x.code && v.code === x.code) || v.name === x.name);
          if (hit) Object.assign(hit, { code: x.code || hit.code, name: x.name, memo: x.memo || hit.memo, dept: x.dept || hit.dept, off: x.off });
          else list.push({ id: uid(), code: x.code, name: x.name, memo: x.memo, dept: x.dept, off: x.off });
          nAux++;
        });
        dimSave(p.kind, list);
      }
      done.push(DIM_NAME[p.kind] || '项目');
      nFile++;
    } else if (f.sn.type === 'bal') {
      const p = mdiBalPlan(f);
      // 科目：标准表里没有的、或名称对不上的，落成本主体自建
      p.accts.forEach(a => {
        if (String(a.code).includes('{')) return;
        const cur = bsFind(a.code);
        const mine = RS.accounts.find(x => String(x[0]) === a.code);
        if (mine) { if (a.name && mine[1] !== a.name) { mine[1] = a.name; nAcct++; } return; }
        if (cur && cur[1] === a.name) return;               // 标准表已有且同名，不必自建
        RS.accounts.push([a.code, a.name, {}]);
        nAcct++;
      });
      saveRSet(CUR_ENT, RS);

      const list = vchLoad(CUR_ENT).filter(v => v.id !== OB_ID && v.id !== YTD_ID);
      if (p.ob.length) {
        list.unshift({ id: OB_ID, period: '2025-12', date: '2025-12-31', word: '期初', no: '0',
          posted: 1, src: '主数据导入', lines: p.ob });
        nOb = p.ob.length;
      }
      if (p.ytd.length) {
        const d = f.periodEnd || '2026-07-31';
        list.unshift({ id: YTD_ID, period: d.slice(0, 7), date: d, word: '累计', no: '0',
          posted: 1, src: '主数据导入', lines: p.ytd });
        nYtd = p.ytd.length;
      }
      // 保存失败绝不能报成功——vchSave 自己的失败 toast 会被后面的成功 toast 顶掉
      if (!vchSave(CUR_ENT, list)) { MDI.saveFail = 1; return; }
      done.push('科目余额表');
      nFile++;
    }
  });

  if (MDI.saveFail) {
    MDI.saveFail = 0;
    toast('系统凭证没存进去（浏览器存储空间不足）。凭证之前的部分已导入；清理空间后再点一次「全部导入」即可补上（重复导入不会翻倍）。', 8000);
    return;   // 保留文件清单，腾出空间可直接重试
  }
  MDI.files = [];
  toast(`${nFile} 份导入完成：科目 ${nAcct} 个、辅助核算 ${nAux} 条、年初 ${nOb} 行、本年累计 ${nYtd} 行`, 5200);
  go('bs-imp');
}

S['bs-imp'] = () => {
  if (!CUR_ENT) return needEnt('主数据导入');
  const tools = `<button class="btn" data-go="bs-acct">科目设置</button>`;
  const picker = `<input type="file" id="mdiFile" accept=".xlsx,.csv,.txt" multiple>`;

  if (!MDI.files.length) {
    return head('主数据导入', `${H(entName())} · 金蝶导出的科目余额表与辅助核算表，一次全导进来。`, '基础 · 主数据', tools)
      + cardp('选择文件', picker
        + `<div class="note" style="margin-top:11px"><b>可以一次选多份</b>：一份科目余额表 + 客户/供应商/项目/部门/职员五份辅助核算，一起丢进来，系统自己认是哪张表。</div>
        <div class="note"><b>科目余额表会落两张系统凭证</b>：「年初余额」（2025-12-31）与「本年累计」（期间末日，如 2026-07-31）。
          年初 = 期末余额 − 本年累计发生净额，倒算出来的。这样从下个月起：<b>期初</b>= 上期期末 ✓、<b>本期发生额</b>= 只有你自己录的凭证 ✓、<b>本年累计</b>= 之前几个月 + 本月 ✓，资产负债表与利润表跟着自动对上。</div>
        <div class="note w"><b>会覆盖已有的期初。</b>「核算 → 期初余额」页手工录的那张期初凭证，导入时按这份表重写。</div>`);
  }

  const rows = MDI.files.map((f, i) => {
    const p = mdiPlan(f);
    const t = f.sn.type;
    const what = t === 'aux' ? `辅助核算 · ${H(f.sn.kindName)}` : t === 'bal' ? '科目余额表' : `<span class="red">认不出</span>`;
    const detail = t === 'aux' ? `${p.items.length} 条（新增 ${p.add} / 更新 ${p.upd}）`
      : t === 'bal' ? `科目 ${p.accts.length} 个（新建 ${p.newAccts}）· 末级 ${p.leaves} 个 · 年初 ${p.ob.length} 行 · 本年累计 ${p.ytd.length} 行`
        : `<span class="red">${H(f.sn.why || '')}</span>`;
    return [
      H(f.fileName.slice(0, 30)), what, String(f.rows.length), detail,
      t === 'bal' ? (f.periodEnd || '<span class="red">认不出期间</span>') : '<span class="mut">—</span>',
      `<button class="btn sm" data-mdirm="${i}">移除</button>`,
    ];
  });
  const bal = MDI.files.map(f => (f.sn.type === 'bal' ? mdiBalPlan(f) : null)).find(Boolean);
  const usable = MDI.files.filter(f => f.sn.type !== '?').length;

  return head('主数据导入', `${H(entName())} · ${MDI.files.length} 份文件，可导 ${usable} 份`, '基础 · 主数据', tools)
    + (bal ? kpis([
      { k: '科目', v: String(bal.accts.length), u: '个' },
      { k: '其中新建', v: String(bal.newAccts), u: '个', t: bal.newAccts ? 'g' : '' },
      { k: '年初借方合计', v: money(bal.obDr) },
      { k: '年初借贷差', v: money(bal.obDiff), t: Math.abs(bal.obDiff) < 0.05 ? 'g' : 'c' },
      { k: '本年累计借贷差', v: money(bal.ytdDiff), t: Math.abs(bal.ytdDiff) < 0.05 ? 'g' : 'c' },
    ]) : '')
    + (bal && Math.abs(bal.obDiff) > 0.05
      ? `<div class="note c"><b>倒算出来的年初借贷不平，差 ${money(bal.obDiff)}。</b>多半是这份表的期末余额或本年累计发生额本身不平，先在金蝶那边核一下再导。</div>` : '')
    + (bal ? `<div class="note"><b>损益科目只导自然方向那一半：</b>收入取贷方累计、成本费用取借方累计，
        金蝶每月结转的那一半（连同「本年利润」科目）不导——本系统不做月度结转，损益累计到出表时才滚进未分配利润，
        原样导会让利润表本年累计全变 0。${Math.abs(bal.carryDiff) > 0.005
        ? `本份表结转与冲红分不开，差 <b>${money(Math.abs(bal.carryDiff))}</b>，已单独挂一行 3103 本年利润把凭证配平（不进利润表行次，资产负债表里跟损益一起滚进未分配利润）。` : ''}</div>` : '')
    + card('文件清单', table(
      [{ t: '文件' }, { t: '认成什么表' }, { t: '行数', n: 1 }, { t: '会导入什么' }, { t: '期间末日' }, { t: '' }], rows))
    + cardp('再加文件', picker + `<span class="mut" style="margin-left:9px">再选是往上加</span>`,
      `<button class="btn sm" data-act="mdiClear">清空</button>`)
    + (bal ? card('年初余额预览（前 12 行 · 倒算值）', table(
      [{ t: '科目' }, { t: '名称' }, { t: '年初借方', n: 1 }, { t: '年初贷方', n: 1 }],
      bal.ob.slice(0, 12).map(l => [`<span class="code">${H(l.acct)}</span>`, H(l.name),
        l.dr ? money(l.dr) : '', l.cr ? money(l.cr) : '']))) : '')
    + `<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:6px">
        <button class="btn pri" data-act="mdiApply" ${usable ? '' : 'disabled'}>全部导入（${usable} 份）</button>
      </div>`;
};

document.addEventListener('change', e => {
  if (e.target.id === 'mdiFile' && e.target.files && e.target.files.length) {
    const fs = e.target.files; e.target.value = '';
    mdiLoad(fs);
  }
});
document.addEventListener('click', e => {
  const rm = e.target.closest('[data-mdirm]');
  if (rm) { MDI.files.splice(+rm.dataset.mdirm, 1); go('bs-imp'); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'mdiClear') { MDI.files = []; go('bs-imp'); return; }
  if (a.dataset.act === 'mdiApply') mdiApply();
});
