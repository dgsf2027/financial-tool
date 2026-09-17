/* T3 对账单核对器
   通用件：物流账单、一件代发、平台结算、快递集包对账单都能用。
   我方台账 + 对方对账单 → 三类差异（己方多 / 对方多 / 金额不符）
   依赖 app.js 的工具函数与 lib/xlsx-lite.js。 */
'use strict';

const T3_TPL_KEY = 'fsc_t3_tpl_v1';

const T3 = {
  step: 1,
  ours: null,      // {name, rows, headRow, map:{key1,key2,amt,date,memo}}
  theirs: null,
  keyCount: 1,     // 用几列做匹配键
  tol: 0.01,       // 金额容差
  mode: 'row',     // 'row' 逐笔 | 'sum' 同键合并后比对
  result: null,
  tab: 'diff',
  tplName: '',
};

/* 表头别名 */
const T3_FIELDS = [
  { k: 'key1', n: '匹配键 1', alias: ['单号', '订单号', '运单号', '快递单号', '业务编号', '流水号', '结算单号', '波次号'], must: 1 },
  { k: 'key2', n: '匹配键 2（可选）', alias: ['日期', '发生日期', '业务日期', '结算日期'] },
  { k: 'amt', n: '金额', alias: ['金额', '结算金额', '费用', '应付金额', '应收金额', '合计', '总金额', '费用合计'], must: 1 },
  { k: 'date', n: '日期（仅展示）', alias: ['日期', '发生日期', '业务日期', '结算日期', '创建时间'] },
  { k: 'memo', n: '摘要（仅展示）', alias: ['摘要', '备注', '说明', '商品名称', '服务类型', '费用类型'] },
];
const T3_ALIAS = T3_FIELDS.reduce((a, f) => a.concat(f.alias), []);

/** 展示用字段可以和匹配键共用同一列（日期既当键又要显示），不占用 used */
const T3_DISPLAY = new Set(['date', 'memo']);

function t3AutoMap(headerCells) {
  const map = {}, norm = s => String(s || '').replace(/\s|　/g, '');
  const used = new Set();
  const pass = (test) => headerCells.forEach((h, i) => {
    const c = norm(h); if (!c) return;
    for (const f of T3_FIELDS) {
      if (map[f.k] !== undefined) continue;
      const display = T3_DISPLAY.has(f.k);
      if (!display && used.has(i)) continue;          // 键/金额列不复用
      if (f.alias.some(a => test(c, a))) {
        map[f.k] = i;
        if (!display) used.add(i);                    // 展示列不占坑
        return;
      }
    }
  });
  pass((c, a) => c === a);                            // 先精确
  pass((c, a) => c.includes(a));                      // 再包含
  return map;
}

const t3Num = v => {
  const s = String(v == null ? '' : v).replace(/[,，\s¥￥]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
const t3Key = (r, m, cnt) => {
  const parts = [String(r[m.key1] == null ? '' : r[m.key1]).trim()];
  if (cnt >= 2 && m.key2 !== undefined) parts.push(String(r[m.key2] == null ? '' : r[m.key2]).trim().slice(0, 10));
  return parts.join('||');
};

/* 核心：跑核对 */
function t3Run() {
  const A = T3.ours, B = T3.theirs;
  const build = side => {
    const idx = {};
    side.rows.slice(side.headRow + 1).forEach((r, i) => {
      const k = t3Key(r, side.map, T3.keyCount);
      if (!k || k === '||') return;
      const rec = {
        key: k, amt: t3Num(r[side.map.amt]), no: i + 1,
        date: side.map.date !== undefined ? String(r[side.map.date] || '').slice(0, 10) : '',
        memo: side.map.memo !== undefined ? String(r[side.map.memo] || '') : '',
      };
      (idx[k] = idx[k] || []).push(rec);
    });
    return idx;
  };
  const ia = build(A), ib = build(B);
  const keys = new Set([...Object.keys(ia), ...Object.keys(ib)]);
  const same = [], onlyA = [], onlyB = [], amtDiff = [];

  keys.forEach(k => {
    const a = ia[k] || [], b = ib[k] || [];
    if (T3.mode === 'sum') {
      const sa = a.reduce((s, x) => s + x.amt, 0), sb = b.reduce((s, x) => s + x.amt, 0);
      if (!a.length) { onlyB.push({ key: k, amt: sb, n: b.length, memo: b[0] && b[0].memo, date: b[0] && b[0].date }); return; }
      if (!b.length) { onlyA.push({ key: k, amt: sa, n: a.length, memo: a[0] && a[0].memo, date: a[0] && a[0].date }); return; }
      if (Math.abs(sa - sb) <= T3.tol) same.push({ key: k, amt: sa });
      else amtDiff.push({ key: k, a: sa, b: sb, d: sa - sb, na: a.length, nb: b.length, memo: a[0].memo, date: a[0].date });
    } else {
      // 逐笔：同键多行时按顺序配对，多出来的算单边
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const x = a[i], y = b[i];
        if (!x) { onlyB.push({ key: k, amt: y.amt, n: 1, memo: y.memo, date: y.date }); continue; }
        if (!y) { onlyA.push({ key: k, amt: x.amt, n: 1, memo: x.memo, date: x.date }); continue; }
        if (Math.abs(x.amt - y.amt) <= T3.tol) same.push({ key: k, amt: x.amt });
        else amtDiff.push({ key: k, a: x.amt, b: y.amt, d: x.amt - y.amt, na: 1, nb: 1, memo: x.memo, date: x.date });
      }
    }
  });

  const sum = arr => arr.reduce((s, x) => s + (x.amt || 0), 0);
  T3.result = {
    same, onlyA, onlyB, amtDiff,
    totalA: Object.values(ia).flat().reduce((s, x) => s + x.amt, 0),
    totalB: Object.values(ib).flat().reduce((s, x) => s + x.amt, 0),
    cntA: Object.values(ia).flat().length,
    cntB: Object.values(ib).flat().length,
    sumOnlyA: sum(onlyA), sumOnlyB: sum(onlyB),
    sumDiff: amtDiff.reduce((s, x) => s + x.d, 0),
  };
}

/* 模板 */
function t3Tpls() { try { return JSON.parse(localStorage.getItem(T3_TPL_KEY) || '[]'); } catch (e) { return []; } }
function t3SaveTpl(name) {
  const list = t3Tpls().filter(t => t.name !== name);
  list.unshift({
    name, keyCount: T3.keyCount, tol: T3.tol, mode: T3.mode,
    ours: T3.ours.map, theirs: T3.theirs.map, at: new Date().toLocaleString('zh-CN'),
  });
  try { localStorage.setItem(T3_TPL_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) { toast('模板保存失败'); }
}
function t3ApplyTpl(name) {
  const t = t3Tpls().find(x => x.name === name); if (!t) return;
  T3.keyCount = t.keyCount; T3.tol = t.tol; T3.mode = t.mode;
  if (T3.ours) T3.ours.map = { ...t.ours };
  if (T3.theirs) T3.theirs.map = { ...t.theirs };
  toast(`已套用模板「${name}」`);
}

/* ============ 界面 ============ */
function t3Steps() {
  const names = ['选两个文件', '对应列', '核对结果', '导出差异'];
  return `<div class="steps">${names.map((n, i) => {
    const k = i + 1, cls = T3.step === k ? 'on' : T3.step > k ? 'dn' : '';
    return `<span class="stp ${cls}"><i>${T3.step > k ? '✓' : k}</i>${n}</span>${i < 3 ? '<span class="stln"></span>' : ''}`;
  }).join('')}</div>`;
}

S['t3'] = () => {
  let body;
  if (T3.step === 1) body = t3S1();
  else if (T3.step === 2) body = t3S2();
  else if (T3.step === 3) body = t3S3();
  else body = t3S4();
  return head('T3　对账单核对器',
    '我方台账 + 对方对账单，逐笔勾对，输出三类差异。<b>物流账单、一件代发、平台结算、快递集包对账单都能用</b>。',
    '工具箱 · 已上线',
    T3.step > 1 ? `<button class="btn" data-t3act="reset">重新开始</button>` : '')
    + t3Steps() + body;
};

function t3Side(side, label) {
  const s = T3[side];
  if (!s) return `<div class="drop" data-t3pick="${side}">
      <div class="di">⇪</div><div class="dt">${label}</div>
      <div class="dm">.xlsx / .csv / .tsv，点击或拖入</div></div>`;
  return `<div class="frow"><span class="fi">✓</span>
      <span><span class="fn">${H(s.name)}</span><br><span class="fm">${s.rows.length} 行 · ${label}</span></span>
      <span class="sp"></span><button class="btn sm" data-t3pick="${side}">换文件</button></div>`;
}

function t3S1() {
  const tpls = t3Tpls();
  return `<div class="note"><b>两个文件都在浏览器里解析，不上传任何服务器。</b>格式不用统一——表头名不一样也能自动认，认不准可以手工改。</div>`
    + `<div class="cols c2">
        ${cardp('我方台账', t3Side('ours', '我方台账'))}
        ${cardp('对方对账单', t3Side('theirs', '对方对账单'))}
      </div>`
    + (tpls.length ? cardp('用过的模板', table(
      [{ t: '对账对象' }, { t: '匹配键' }, { t: '容差', n: 1 }, { t: '模式' }, { t: '上次使用' }, { t: '' }],
      tpls.map(t => [`<b>${H(t.name)}</b>`, `${t.keyCount} 列`, t.tol.toFixed(2),
        t.mode === 'sum' ? '同键合并' : '逐笔', `<span class="mut">${H(t.at)}</span>`,
        `<button class="btn sm" data-t3tpl="${H(t.name)}">套用</button>`])),
      `<span class="mut" style="font-size:11px">选好两个文件后套用</span>`) : '')
    + cardp('三类差异是什么', table([{ t: '类型' }, { t: '含义' }, { t: '通常原因' }],
      [
        ['<b class="red">己方多</b>', '我方台账有、对方对账单没有', '对方漏计；或我方重复记账'],
        ['<b class="red">对方多</b>', '对方有、我方没有', '我方漏记；或对方多计费'],
        ['<b class="red">金额不符</b>', '两边都有但金额对不上', '费率不一致；或含税不含税口径不同'],
        ['<span class="grn">一致</span>', '键相同、金额在容差内', '无需处理'],
      ]));
}

function t3S2() {
  const mk = (side, label) => {
    const s = T3[side], hd = s.rows[s.headRow] || [];
    const opt = k => hd.map((h, j) => `<option value="${j}" ${s.map[k] === j ? 'selected' : ''}>${H(String(h || '(空)').slice(0, 18))}</option>`).join('');
    const fields = T3_FIELDS.filter(f => f.k !== 'key2' || T3.keyCount >= 2);
    return cardp(label + ' · ' + H(s.name), table(
      [{ t: '字段' }, { t: '对应列' }, { t: '示例' }],
      fields.map(f => {
        const sample = s.map[f.k] !== undefined ? String((s.rows[s.headRow + 1] || [])[s.map[f.k]] || '').slice(0, 18) : '';
        return [H(f.n) + (f.must ? ' <span class="red">*</span>' : ''),
          `<select data-t3map="${side}:${f.k}"><option value="">— 不用 —</option>${opt(f.k)}</select>`,
          `<span class="mut">${H(sample) || '—'}</span>`];
      }))
      + `<div style="margin-top:9px"><label class="fl">表头在第几行</label>
         <select data-t3head="${side}">${s.rows.slice(0, Math.min(s.rows.length, 10)).map((r, i) =>
           `<option value="${i}" ${i === s.headRow ? 'selected' : ''}>第 ${i + 1} 行：${H(r.filter(Boolean).slice(0, 3).join(' | ').slice(0, 34))}</option>`).join('')}</select></div>`);
  };
  const ok = T3.ours.map.key1 !== undefined && T3.ours.map.amt !== undefined
    && T3.theirs.map.key1 !== undefined && T3.theirs.map.amt !== undefined;
  return `<div class="cols c2">${mk('ours', '我方台账')}${mk('theirs', '对方对账单')}</div>`
    + cardp('核对设置', `<div class="cols c2">
        <div>
          <div class="field"><label class="fl">匹配键用几列</label>
            <select data-t3set="keyCount">
              <option value="1" ${T3.keyCount === 1 ? 'selected' : ''}>1 列（单号 / 运单号）</option>
              <option value="2" ${T3.keyCount === 2 ? 'selected' : ''}>2 列（单号 + 日期）</option>
            </select></div>
          <div class="field"><label class="fl">金额容差（元）</label>
            <input type="number" step="0.01" data-t3set="tol" value="${T3.tol}"></div>
        </div>
        <div>
          <div class="field"><label class="fl">比对模式</label>
            <select data-t3set="mode">
              <option value="row" ${T3.mode === 'row' ? 'selected' : ''}>逐笔比对（一单一行）</option>
              <option value="sum" ${T3.mode === 'sum' ? 'selected' : ''}>同键合并后比对（一单多行）</option>
            </select></div>
          <div class="note" style="margin:0;font-size:11.5px"><b>一件代发、物流账单常是一单多行</b>（一个订单拆多条费用），这时选「同键合并」。平台结算单一般一单一行，选「逐笔」。</div>
        </div>
      </div>`)
    + `<div style="display:flex;gap:9px;justify-content:flex-end">
        <button class="btn pri" data-t3act="run" ${ok ? '' : 'disabled'}>开始核对</button></div>`
    + (ok ? '' : `<div class="note c" style="margin-top:11px"><b>还不能开始：</b>两边的<b>匹配键 1</b> 和<b>金额</b>都必须选上。</div>`);
}

function t3S3() {
  const r = T3.result;
  const bad = r.onlyA.length + r.onlyB.length + r.amtDiff.length;
  const rate = (r.cntA + r.cntB) ? Math.round(r.same.length * 2 / (r.cntA + r.cntB) * 100) : 0;
  const tab = T3.tab;
  const rows = tab === 'a' ? r.onlyA.map(x => [`<span class="code">${H(x.key.replace('||', ' / '))}</span>`, H(x.date || ''), H((x.memo || '').slice(0, 24)), money(x.amt), x.n > 1 ? `${x.n} 行` : ''])
    : tab === 'b' ? r.onlyB.map(x => [`<span class="code">${H(x.key.replace('||', ' / '))}</span>`, H(x.date || ''), H((x.memo || '').slice(0, 24)), money(x.amt), x.n > 1 ? `${x.n} 行` : ''])
    : r.amtDiff.map(x => [`<span class="code">${H(x.key.replace('||', ' / '))}</span>`, H(x.date || ''), H((x.memo || '').slice(0, 24)),
        money(x.a), money(x.b), `<b class="red">${money(x.d)}</b>`]);
  const cols = tab === 'diff'
    ? [{ t: '匹配键' }, { t: '日期' }, { t: '摘要' }, { t: '我方', n: 1 }, { t: '对方', n: 1 }, { t: '差额', n: 1 }]
    : [{ t: '匹配键' }, { t: '日期' }, { t: '摘要' }, { t: '金额', n: 1 }, { t: '行数' }];
  return kpis([
    { k: '我方笔数', v: String(r.cntA), u: '笔' },
    { k: '对方笔数', v: String(r.cntB), u: '笔' },
    { k: '一致', v: String(r.same.length), u: '笔', t: 'g' },
    { k: '差异', v: String(bad), u: '笔', t: bad ? 'c' : 'g' },
    { k: '我方合计', v: money(r.totalA) },
    { k: '对方合计', v: money(r.totalB) },
    { k: '合计差额', v: money(r.totalA - r.totalB), t: Math.abs(r.totalA - r.totalB) > T3.tol ? 'c' : 'g' },
  ])
    + (bad
      ? `<div class="note c"><b>${bad} 笔对不上。</b>己方多 ${r.onlyA.length} 笔（${money(r.sumOnlyA)}）、对方多 ${r.onlyB.length} 笔（${money(r.sumOnlyB)}）、金额不符 ${r.amtDiff.length} 笔（差额 ${money(r.sumDiff)}）。<b>工具只指出差异，不替你判断谁对</b>——拿差异清单找对方核。</div>`
      : `<div class="note g"><b>全部对上。</b>${r.same.length} 笔一致，合计差额在容差 ${T3.tol} 元内。</div>`)
    + `<div class="tabs">
        <button data-t3tab="diff" class="${tab === 'diff' ? 'on' : ''}">金额不符<span class="cnt">${r.amtDiff.length}</span></button>
        <button data-t3tab="a" class="${tab === 'a' ? 'on' : ''}">己方多<span class="cnt">${r.onlyA.length}</span></button>
        <button data-t3tab="b" class="${tab === 'b' ? 'on' : ''}">对方多<span class="cnt">${r.onlyB.length}</span></button>
      </div>`
    + card('', rows.length ? table(cols, rows.slice(0, 400)) : `<div style="padding:24px;text-align:center;color:var(--good)">这一类没有差异</div>`)
    + `<div style="display:flex;gap:9px;justify-content:flex-end">
        <button class="btn" data-t3act="back2">← 改设置</button>
        <button class="btn pri" data-t3act="toExport">下一步：导出</button></div>`;
}

function t3S4() {
  const r = T3.result;
  return `<div class="note"><b>导出差异清单，直接发给对方财务。</b>一致的那些不导出——对账要看的是对不上的部分。</div>`
    + `<div class="cols c2">
      ${cardp('差异清单 CSV', `<div style="font-size:12.5px;line-height:1.85">
        金额不符 ${r.amtDiff.length} 笔 · 己方多 ${r.onlyA.length} 笔 · 对方多 ${r.onlyB.length} 笔<br>
        <span class="mut">列：类型·匹配键·日期·摘要·我方金额·对方金额·差额</span></div>
        <button class="btn pri" style="margin-top:11px" data-t3act="dl">下载差异清单</button>`)}
      ${cardp('存成模板', `<div style="font-size:12.5px;line-height:1.8">
        把这次的<b>列对应关系、匹配键、容差、模式</b>存下来，下个月同一个对账对象直接套用。</div>
        <div class="field" style="margin-top:10px"><label class="fl">对账对象名称</label>
          <input type="text" id="t3tplName" placeholder="如：顺丰物流 / 某某一件代发" value="${H(T3.tplName)}"></div>
        <button class="btn" data-t3act="saveTpl">保存模板</button>`)}
    </div>`
    + cardp('核对小结', table([{ t: '项' }, { t: '我方' }, { t: '对方' }, { t: '差额' }],
      [['笔数', String(r.cntA), String(r.cntB), String(r.cntA - r.cntB)],
       ['金额', money(r.totalA), money(r.totalB), `<b class="${Math.abs(r.totalA - r.totalB) > T3.tol ? 'red' : 'grn'}">${money(r.totalA - r.totalB)}</b>`]]));
}

/* ============ 交互 ============ */
async function t3Pick(side) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx,.csv,.tsv,.txt';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      toast('正在解析…');
      const rows = await XLSXLite.readTable(f);
      const hr = XLSXLite.findHeaderRow(rows, T3_ALIAS);
      T3[side] = { name: f.name, rows, headRow: hr, map: t3AutoMap(rows[hr] || []) };
      go('t3', { resetScroll: true });
      toast(`${side === 'ours' ? '我方台账' : '对方对账单'}：${rows.length} 行`);
    } catch (e) { toast('读取失败：' + e.message, 4200); }
  };
  inp.click();
}

function t3Export() {
  const r = T3.result;
  const hdr = ['类型', '匹配键', '日期', '摘要', '我方金额', '对方金额', '差额'];
  const rows = [];
  r.amtDiff.forEach(x => rows.push(['金额不符', x.key.replace('||', ' / '), x.date, x.memo, x.a.toFixed(2), x.b.toFixed(2), x.d.toFixed(2)]));
  r.onlyA.forEach(x => rows.push(['己方多', x.key.replace('||', ' / '), x.date, x.memo, x.amt.toFixed(2), '', x.amt.toFixed(2)]));
  r.onlyB.forEach(x => rows.push(['对方多', x.key.replace('||', ' / '), x.date, x.memo, '', x.amt.toFixed(2), (-x.amt).toFixed(2)]));
  rows.push([]);
  rows.push(['—— 小结 ——', `我方 ${r.cntA} 笔 / ${r.totalA.toFixed(2)}`, `对方 ${r.cntB} 笔 / ${r.totalB.toFixed(2)}`,
    `差额 ${(r.totalA - r.totalB).toFixed(2)}`, `容差 ${T3.tol}`, T3.mode === 'sum' ? '同键合并' : '逐笔']);
  download(`对账差异_${T3.tplName || '未命名'}_${new Date().toISOString().slice(0, 10)}.csv`, toCSV([hdr].concat(rows)));
  toast('差异清单已下载');
}

document.addEventListener('click', e => {
  const p = e.target.closest('[data-t3pick]');
  if (p) { t3Pick(p.dataset.t3pick); return; }
  const tb = e.target.closest('[data-t3tab]');
  if (tb) { T3.tab = tb.dataset.t3tab; go('t3'); return; }
  const tp = e.target.closest('[data-t3tpl]');
  if (tp) {
    if (!T3.ours || !T3.theirs) { toast('先选好两个文件再套模板'); return; }
    t3ApplyTpl(tp.dataset.t3tpl); T3.tplName = tp.dataset.t3tpl; T3.step = 2; go('t3', { resetScroll: true }); return;
  }
  const a = e.target.closest('[data-t3act]');
  if (!a) return;
  const act = a.dataset.t3act;
  if (act === 'reset') { Object.assign(T3, { step: 1, ours: null, theirs: null, result: null }); go('t3', { resetScroll: true }); }
  else if (act === 'run') { t3Run(); T3.step = 3; T3.tab = T3.result.amtDiff.length ? 'diff' : (T3.result.onlyA.length ? 'a' : 'b'); go('t3', { resetScroll: true }); }
  else if (act === 'back2') { T3.step = 2; go('t3', { resetScroll: true }); }
  else if (act === 'toExport') { T3.step = 4; go('t3', { resetScroll: true }); }
  else if (act === 'dl') t3Export();
  else if (act === 'saveTpl') {
    const n = (document.getElementById('t3tplName') || {}).value || '';
    if (!n.trim()) { toast('请先填对账对象名称'); return; }
    T3.tplName = n.trim(); t3SaveTpl(T3.tplName); toast(`模板「${T3.tplName}」已保存`); go('t3');
  }
});
document.addEventListener('change', e => {
  const m = e.target.dataset && e.target.dataset.t3map;
  if (m) {
    const [side, k] = m.split(':');
    if (e.target.value === '') delete T3[side].map[k]; else T3[side].map[k] = +e.target.value;
    go('t3'); return;
  }
  const h = e.target.dataset && e.target.dataset.t3head;
  if (h) { T3[h].headRow = +e.target.value; T3[h].map = t3AutoMap(T3[h].rows[T3[h].headRow] || []); go('t3'); return; }
  const s = e.target.dataset && e.target.dataset.t3set;
  if (s) {
    T3[s] = s === 'tol' ? (Number(e.target.value) || 0) : (s === 'keyCount' ? +e.target.value : e.target.value);
    go('t3');
  }
});
/* 两个文件都就位后自动进第 2 步 */
const _t3go = go;
