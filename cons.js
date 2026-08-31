/* 合并报表：合并资产负债表 / 合并利润表 / 合并现金流量表
   流程照负责人定的规则文件（第四章）：
   ① 合并设置定范围（母公司、子公司、持股比例、长投账面值）
   ② 各单位个别报表数据 = 本系统各主体凭证库实时算（不用另填报）
   ③ 内部交易明细表 = 内部交易登记页（债权债务/存货购销/固定资产/资金往来/分红）
   ④ 抵消分录按规则一至六自动生成，进合并工作底稿
   ⑤ 合并数 = 加总数 + 抵消净额，出三张合并报表
   诚实口径（页面上都写）：
   - 年初列是简单加总，未做期初抵消（首年启用口径，需上年底稿才能做）
   - 规则二的内部坏账准备抵消未做——科目表没有坏账准备/信用减值科目
   - 规则四只做交易当年的两笔，后续年度的期初未分配利润调整需下年手工登记 */
'use strict';

/* ============ 配置与登记（集团级，一份） ============ */
const CS_CFG_KEY = 'fsc_cons_cfg_v1';
const CS_REG_KEY = 'fsc_cons_reg_v1';
function csCfg() { try { return JSON.parse(localStorage.getItem(CS_CFG_KEY) || 'null') || { parent: '', subs: [] }; } catch (e) { return { parent: '', subs: [] }; } }
function csCfgSave(c) { try { localStorage.setItem(CS_CFG_KEY, JSON.stringify(c)); } catch (e) { toast('保存失败'); } }
function csReg() { try { return JSON.parse(localStorage.getItem(CS_REG_KEY) || '[]'); } catch (e) { return []; } }
function csRegSave(v) { try { localStorage.setItem(CS_REG_KEY, JSON.stringify(v)); } catch (e) { toast('保存失败'); } }
const csEntName = id => { const e = ENTITIES.find(x => x.id === id); return e ? e.full : id; };
const csShort = id => csEntName(id).replace(/^(广州市|广州|深圳市|深圳|中山市|中山|海南)/, '').replace(/（广州）/g, '').slice(0, 6);
const CSS_ = { edit: '' };

/* 范围内主体 */
const csEnts = () => { const c = csCfg(); return c.parent ? [c.parent].concat(c.subs.map(s => s.ent)) : []; };
/* 某主体某天的累计净额（借-贷）map、期间发生 map —— 直接复用报表引擎（按 entId 取数） */
const csBalAt = (ent, d) => rptBalAt(ent, d, AC.inc);
const csNetIn = ent => rptNet(ent, AC.from, AC.to, AC.inc);
/* 子公司所有者权益构成（期末）：权益科目 + 全部损益累计（未结转口径，与个别报表一致） */
function csEquityOf(ent) {
  const m = csBalAt(ent, AC.to);
  const g = re => -Object.keys(m).filter(k => re.test(k)).reduce((s, k) => s + m[k].net, 0);
  const cap = g(/^3001/), capRes = g(/^3002/), surplus = g(/^3101/);
  const retained = g(/^(3103|3104|4103|4104)/) + -Object.keys(m).filter(k => /^5/.test(k)).reduce((s, k) => s + m[k].net, 0);
  return { cap, capRes, surplus, retained, total: +(cap + capRes + surplus + retained).toFixed(2) };
}
/* 子公司本期净利润（合并利润表拆少数股东损益用） */
function csPeriodNet(ent) {
  const m = csNetIn(ent);
  return +(-Object.keys(m).filter(k => /^5/.test(k)).reduce((s, k) => s + m[k].dr - m[k].cr, 0)).toFixed(2);
}

/* ============ 抵消分录生成（规则一至六） ============ */
/* 伪科目：合并层才有的行次 */
const CS_GW = '__GW__', CS_MI_EQ = '__MIEQ__', CS_MI_PL = '__MIPL__';
const CS_PSEUDO = { [CS_GW]: '商誉', [CS_MI_EQ]: '少数股东权益', [CS_MI_PL]: '少数股东损益' };
function csElims() {
  const cfg = csCfg();
  const out = [];
  const L = (acct, name, dr, cr) => ({ acct, name, dr: +(+dr || 0).toFixed(2), cr: +(+cr || 0).toFixed(2) });
  // 规则一：长投 × 子公司权益（每个子公司一笔）
  cfg.subs.forEach(s => {
    const eq = csEquityOf(s.ent);
    const share = +s.share || 0;
    const inv = +s.inv || 0;
    const minority = +(eq.total * (1 - share)).toFixed(2);
    const diff = +(inv - eq.total * share).toFixed(2);   // 借差=商誉，贷差=营业外收入（折价购买）
    const lines = [];
    if (eq.cap) lines.push(L('3001', '实收资本（' + csShort(s.ent) + '）', eq.cap, 0));
    if (eq.capRes) lines.push(L('3002', '资本公积', eq.capRes, 0));
    if (eq.surplus) lines.push(L('3101', '盈余公积', eq.surplus, 0));
    if (eq.retained) lines.push(L('3104', '未分配利润-期末', Math.max(eq.retained, 0), Math.max(-eq.retained, 0)));
    if (diff > 0) lines.push(L(CS_GW, '商誉', diff, 0));
    if (inv) lines.push(L('1511', '长期股权投资（母公司）', 0, inv));
    if (minority) lines.push(L(CS_MI_EQ, '少数股东权益', Math.max(0, minority) ? 0 : 0, minority));
    if (diff < 0) lines.push(L('5301', '营业外收入（折价购买贷差）', 0, -diff));
    if (lines.length) out.push({ rule: '一', memo: `股权抵消 · ${csShort(s.ent)}（持股 ${(share * 100).toFixed(0)}%）`, lines });
  });
  // 规则二至六：内部交易登记表
  const months = [];
  { let m = AC.from.slice(0, 7); while (m <= AC.to.slice(0, 7)) { months.push(m); const [y, mo] = m.split('-'); m = ym(new Date(+y, +mo, 1)); } }
  csReg().filter(r => months.includes(r.month)).forEach(r => {
    if (r.type === 'debt') {
      out.push({ rule: '二', memo: `内部债权债务 · ${csShort(r.a)} ⇄ ${csShort(r.b)}`, lines: [
        L(r.debtAcct, acctName(r.debtAcct) || '债务科目', r.amt, 0),
        L(r.credAcct, acctName(r.credAcct) || '债权科目', 0, r.amt)] });
    } else if (r.type === 'inv') {
      const unreal = +((r.price - r.cost) * (r.pct / 100)).toFixed(2);
      out.push({ rule: '三', memo: `内部存货购销 · ${csShort(r.a)} → ${csShort(r.b)}（留存 ${r.pct}%）`, lines: [
        L('5001', '营业收入（内部售价）', r.price, 0),
        L('5401', '营业成本', 0, +(r.price - unreal).toFixed(2)),
        L('1405', '存货（未实现利润）', 0, unreal)] });
    } else if (r.type === 'fa') {
      const gain = +(r.price - r.nbv).toFixed(2);
      const lines = [
        L('5301', '资产处置收益（未实现利润）', Math.max(gain, 0), Math.max(-gain, 0)),
        L('1601', '固定资产-原价', Math.max(-gain, 0), Math.max(gain, 0))];
      if (r.dep) { lines.push(L('1602', '累计折旧（补提）', r.dep, 0)); lines.push(L('5602', '管理费用', 0, r.dep)); }
      out.push({ rule: '四', memo: `内部固定资产转让 · ${csShort(r.a)} → ${csShort(r.b)}`, lines });
    } else if (r.type === 'cash') {
      out.push({ rule: '五', memo: `内部现金流 · ${csShort(r.a)} → ${csShort(r.b)}（${r.outAct}流出 ⇄ ${r.inAct}流入）`,
        cash: { amt: +r.amt, outAct: r.outAct, inAct: r.inAct }, lines: [] });
    } else if (r.type === 'div') {
      const cfg2 = csCfg();
      const sub = cfg2.subs.find(s => s.ent === r.a);
      const minority = sub ? +((+r.total || +r.amt) * (1 - sub.share)).toFixed(2) : 0;
      const total = +r.total || +r.amt;
      out.push({ rule: '六', memo: `投资收益与利润分配 · ${csShort(r.a)} 分红`, lines: [
        L('5111', '投资收益（母公司确认）', r.amt, 0),
        minority ? L(CS_MI_PL, '少数股东损益', minority, 0) : null,
        L('3104', '对所有者的分配', 0, total)].filter(Boolean) });
    }
  });
  return out;
}
/* 抵消净额（借-贷）汇到科目上，合并数 = 加总 + 抵消净额 */
function csElimNet(elims) {
  const m = {};
  elims.forEach(e => e.lines.forEach(l => { m[l.acct] = (m[l.acct] || 0) + l.dr - l.cr; }));
  return m;
}

/* ============ 合并取数 ============ */
function csData() {
  const ents = csEnts();
  const perEnt = ents.map(id => ({ id, end: csBalAt(id, AC.to), open: csBalAt(id, (AC.to.slice(0, 4) - 1) + '-12-31'), net: csNetIn(id) }));
  // 加总（期末/年初净额、期间发生）
  const sumEnd = {}, sumOpen = {}, sumNet = {};
  perEnt.forEach(p => {
    Object.keys(p.end).forEach(k => { sumEnd[k] = (sumEnd[k] || 0) + p.end[k].net; });
    Object.keys(p.open).forEach(k => { sumOpen[k] = (sumOpen[k] || 0) + p.open[k].net; });
    Object.keys(p.net).forEach(k => {
      const o = sumNet[k] = sumNet[k] || { dr: 0, cr: 0 };
      o.dr += p.net[k].dr; o.cr += p.net[k].cr;
    });
  });
  const elims = csElims();
  const elim = csElimNet(elims);
  return { ents, perEnt, sumEnd, sumOpen, sumNet, elims, elim };
}
const csNeedCfg = title => head(title, '先在「合并设置」里定合并范围：母公司、子公司、持股比例。', '核算 · 合并报表')
  + `<div class="note w"><b>还没设合并范围。</b><button class="btn sm" data-s="cs-set">去合并设置</button></div>`;

/* ============ 合并设置 ============ */
S['cs-set'] = () => {
  const cfg = csCfg();
  const entOpts = sel => ENTITIES.filter(e => !e.off).map(e => `<option value="${e.id}" ${sel === e.id ? 'selected' : ''}>${H(e.full)}</option>`).join('');
  const rows = cfg.subs.map((s, i) => {
    // 长投参考值：母公司账上 1511 余额（多个子公司时需人工拆）
    return [H(csEntName(s.ent)), (s.share * 100).toFixed(0) + '%', money(+s.inv || 0),
      money(csEquityOf(s.ent).total),
      `<button class="btn sm" data-csdel="${i}">移除</button>`];
  });
  const parent1511 = cfg.parent ? -0 + (csBalAt(cfg.parent, AC.to)['1511'] || { net: 0 }).net : 0;
  return head('合并设置', '定合并范围：母公司 + 各子公司持股比例与长投账面值。各单位个别报表直接取自本系统各主体的凭证库，不用另外填报。', '核算 · 合并报表')
    + cardp('母公司', `<select id="csParent" style="min-width:320px"><option value="">— 选择 —</option>${entOpts(cfg.parent)}</select>
      ${cfg.parent ? `<span class="mut" style="margin-left:8px">账上长期股权投资（1511）期末余额：${money(parent1511)}</span>` : ''}`)
    + cardp('添加子公司', `<div class="cols c4">
        <div class="field"><label class="fl">子公司</label><select id="csSub"><option value="">— 选择 —</option>${entOpts('')}</select></div>
        <div class="field"><label class="fl">持股比例（%）</label><input type="number" id="csShare" min="1" max="100" placeholder="如 100"></div>
        <div class="field"><label class="fl">母公司长投账面值（对该子公司）</label><input type="number" step="0.01" id="csInv" placeholder="默认取 1511 余额"></div>
        <div class="field" style="display:flex;align-items:flex-end"><button class="btn pri" data-act="csAddSub">添加</button></div>
      </div>`)
    + card('合并范围', rows.length ? table(
      [{ t: '子公司' }, { t: '持股' }, { t: '长投账面值', n: 1 }, { t: '子公司权益合计（期末）', n: 1 }, { t: '' }], rows)
      : `<div style="padding:22px;text-align:center;color:var(--text-3)">还没有子公司</div>`)
    + `<div class="note">长投账面值 = 母公司账上对该子公司的长期股权投资。只有一个子公司时可直接用 1511 余额；多个子公司要人工拆开填，账上不分户。</div>`;
};

/* ============ 内部交易登记 ============ */
S['cs-reg'] = () => {
  if (!csCfg().parent) return csNeedCfg('内部交易登记');
  const ents = csEnts();
  const entOpts = ents.map(id => `<option value="${id}">${H(csShort(id))}</option>`).join('');
  const list = csReg();
  const TYPE_N = { debt: '债权债务', inv: '存货购销', fa: '固定资产', cash: '资金往来', div: '分红/投资收益' };
  const rows = list.map(r => [r.month, TYPE_N[r.type] || r.type, H(csShort(r.a)), H(csShort(r.b)),
    money(+r.amt || +r.price || +r.total || 0),
    H(r.type === 'inv' ? `售${money(r.price)} 成本${money(r.cost)} 留存${r.pct}%` : r.type === 'fa' ? `价${money(r.price)} 账面${money(r.nbv)}` : ''),
    `<button class="btn sm" data-csrdel="${H(r.id)}">删除</button>`]);
  return head('内部交易登记', '合并范围内企业之间的往来，按月登记——这就是规则文件里的「内部交易明细表」。抵消分录从这里自动生成。', '核算 · 合并报表')
    + cardp('新增登记', `<div class="cols c4">
        <div class="field"><label class="fl">类型</label><select id="crType">
          <option value="debt">债权债务（规则二）</option><option value="inv">存货购销（规则三）</option>
          <option value="fa">固定资产转让（规则四）</option><option value="cash">资金往来现金流（规则五）</option>
          <option value="div">分红/投资收益（规则六）</option></select></div>
        <div class="field"><label class="fl">所属月份</label><input type="month" id="crMonth" value="${AC.to.slice(0, 7)}" min="2026-01"></div>
        <div class="field"><label class="fl">甲方（债权/卖方/转出/分红方）</label><select id="crA">${entOpts}</select></div>
        <div class="field"><label class="fl">乙方（债务/买方/转入/收款方）</label><select id="crB">${entOpts}</select></div>
      </div>
      <div class="cols c4" style="margin-top:8px">
        <div class="field"><label class="fl">金额（债务/往来/母公司投资收益）</label><input type="number" step="0.01" id="crAmt"></div>
        <div class="field"><label class="fl">售价/转让价（存货、固资）</label><input type="number" step="0.01" id="crPrice"></div>
        <div class="field"><label class="fl">成本/账面价值</label><input type="number" step="0.01" id="crCost"></div>
        <div class="field"><label class="fl">期末留存比例%（存货）/ 补提折旧（固资）/ 分红总额（分红）</label><input type="number" step="0.01" id="crExtra"></div>
      </div>
      <div class="cols c4" style="margin-top:8px">
        <div class="field"><label class="fl">债权科目（规则二）</label><select id="crCred">${['1122', '1221', '1123', '1121'].map(c => `<option value="${c}">${c} ${H(acctName(c))}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">债务科目（规则二）</label><select id="crDebt">${['2202', '2241', '2203', '2201'].map(c => `<option value="${c}">${c} ${H(acctName(c))}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">现金流出类别（规则五）</label><select id="crOut"><option value="fin">筹资</option><option value="inv">投资</option><option value="op">经营</option></select></div>
        <div class="field"><label class="fl">现金流入类别（规则五）</label><select id="crIn"><option value="inv">投资</option><option value="fin">筹资</option><option value="op">经营</option></select></div>
      </div>
      <div style="text-align:right;margin-top:9px"><button class="btn pri" data-act="crAdd">登记</button></div>`)
    + card('登记表', rows.length ? table(
      [{ t: '月份' }, { t: '类型' }, { t: '甲方' }, { t: '乙方' }, { t: '金额', n: 1 }, { t: '明细' }, { t: '' }], rows)
      : `<div style="padding:22px;text-align:center;color:var(--text-3)">还没有登记。规则一（股权抵消）不用登记，从合并设置自动生成。</div>`);
};

/* ============ 抵消分录 ============ */
S['cs-elim'] = () => {
  if (!csCfg().parent) return csNeedCfg('抵消分录');
  const elims = csElims();
  let tdr = 0, tcr = 0;
  const rows = [];
  elims.forEach(e => {
    rows.push({ cls: 'lv1', d: [`<b>规则${e.rule} · ${H(e.memo)}</b>`, '', '', ''] });
    e.lines.forEach(l => { tdr += l.dr; tcr += l.cr;
      rows.push([`　<span class="code">${H(CS_PSEUDO[l.acct] ? '—' : l.acct)}</span>`, H(l.name),
        l.dr ? money(l.dr) : '', l.cr ? money(l.cr) : '']); });
    if (e.cash) rows.push([`　<span class="mut">仅影响现金流量表</span>`, `${H(e.memo)}`, money(e.cash.amt), money(e.cash.amt)]);
  });
  const bal = Math.abs(tdr - tcr) < 0.01;
  return head('合并抵消分录', `${AC.from} 〜 ${AC.to} · 按规则一至六自动生成：规则一取自合并设置与各主体账面，规则二至六取自内部交易登记。`, '核算 · 合并报表',
    `<button class="btn pri" data-act="csExpElim">导出</button>`)
    + kpis([
      { k: '抵消分录', v: String(elims.length), u: '笔' },
      { k: '借方合计', v: money(tdr) },
      { k: '贷方合计', v: money(tcr) },
      { k: '借贷平衡', v: bal ? '✓' : money(tdr - tcr), t: bal ? 'g' : 'c' },
    ])
    + (elims.length ? '' : `<div class="note">没有可生成的抵消分录——检查合并设置里有没有子公司、登记表里有没有本期间的内部交易。</div>`)
    + `<div class="note"><b>没做的两件事（规则文件里有、系统做不了）：</b>内部坏账准备抵消（科目表没有坏账准备/信用减值科目）；规则四的以后年度期初未分配利润调整（需上年底稿，下年手工登记）。</div>`
    + card('分录明细', table([{ t: '科目' }, { t: '摘要' }, { t: '借方', n: 1 }, { t: '贷方', n: 1 }], rows));
};

/* ============ 合并资产负债表 ============ */
S['cs-bs'] = () => {
  if (!csCfg().parent) return csNeedCfg('合并资产负债表');
  const d = csData();
  const line = (m, re, sign) => Object.keys(m).filter(k => re.test(k)).reduce((s, k) => s + m[k], 0) * sign;
  const eline = (re, sign) => Object.keys(d.elim).filter(k => re.test(k)).reduce((s, k) => s + d.elim[k], 0) * sign;
  const mkRows = (defs, sign) => defs.map(dd => {
    const sum = +(line(d.sumEnd, dd[1], sign) * (dd[2] === 'contra' ? -1 : 1)).toFixed(2);
    const el = +(eline(dd[1], sign) * (dd[2] === 'contra' ? -1 : 1)).toFixed(2);
    return { nm: dd[0], sum, el, tot: +(sum + el).toFixed(2), contra: dd[2] === 'contra' };
  });
  const curA = mkRows(BS_LINES.curAsset, 1), nonA = mkRows(BS_LINES.nonAsset, 1);
  const curL = mkRows(BS_LINES.curLiab, -1), nonL = mkRows(BS_LINES.nonLiab, -1);
  const eq = mkRows(BS_LINES.equity, -1);
  // 商誉进非流动资产；损益累计滚未分配利润；少数股东权益单列
  const gw = +(d.elim[CS_GW] || 0).toFixed(2);
  if (gw) nonA.push({ nm: '商誉（股权抵消借差）', sum: 0, el: gw, tot: gw });
  const pnlSum = Object.keys(d.sumEnd).filter(k => /^5/.test(k)).reduce((s, k) => s + d.sumEnd[k], 0);
  const pnlEl = Object.keys(d.elim).filter(k => /^5/.test(k)).reduce((s, k) => s + d.elim[k], 0);
  const rp = eq.find(x => x.nm === '未分配利润');
  rp.nm = '未分配利润（含本年利润，未结转）';
  rp.sum = +(rp.sum + -pnlSum).toFixed(2); rp.el = +(rp.el + -pnlEl).toFixed(2); rp.tot = +(rp.sum + rp.el).toFixed(2);
  const mi = +(-(d.elim[CS_MI_EQ] || 0) - (d.elim[CS_MI_PL] || 0)).toFixed(2);
  if (mi) eq.push({ nm: '少数股东权益', sum: 0, el: mi, tot: mi });
  const T = (a, f) => +a.reduce((s, x) => s + (x.contra ? -x[f] : x[f]), 0).toFixed(2);
  const ta = T(curA, 'tot') + T(nonA, 'tot'), tl = T(curL, 'tot') + T(nonL, 'tot'), te = T(eq, 'tot');
  const bal = Math.abs(ta - tl - te) < 0.05;
  const cols = [{ t: '项目' }, { t: '加总数', n: 1 }, { t: '抵消调整', n: 1 }, { t: '合并数', n: 1 }];
  const R = a => a.map(x => [`　${H(x.nm)}`, money(x.sum), x.el ? money(x.el) : '', money(x.tot)]);
  const g = t => ({ cls: 'lv1', d: [`<b>${t}</b>`, '', '', ''] });
  const sm = (t, a, b) => ({ cls: 'sum', d: [`<b>${t}</b>`, `<b>${money(T(a, 'sum') + (b ? T(b, 'sum') : 0))}</b>`, '', `<b>${money(T(a, 'tot') + (b ? T(b, 'tot') : 0))}</b>`] });
  return head('合并资产负债表', `合并范围 ${d.ents.length} 家 · 期末 ${AC.to}。合并数 = 各主体加总 + 抵消净额（规则一/二/三/四）。年初列略——期初抵消需上年底稿，首年只出期末。`, '核算 · 合并报表',
    `<button class="btn pri" data-act="csExpBs">导出</button>`)
    + kpis([
      { k: '合并资产总计', v: money(ta) },
      { k: '合并负债', v: money(tl) },
      { k: '归母权益+少数股东', v: money(te) },
      { k: '平衡校验', v: bal ? '✓' : money(+(ta - tl - te).toFixed(2)), t: bal ? 'g' : 'c' },
    ])
    + (bal ? '' : `<div class="note c"><b>合并数不平衡，差 ${money(+(ta - tl - te).toFixed(2))}。</b>先查各主体个别账借贷是否平、抵消分录页是否平。</div>`)
    + `<div class="cols c2">
      ${card('资产', table(cols, [g('流动资产：')].concat(R(curA)).concat([g('非流动资产：')]).concat(R(nonA)).concat([sm('资产总计', curA, nonA)])))}
      ${card('负债和所有者权益', table(cols,
        [g('流动负债：')].concat(R(curL)).concat([g('非流动负债：')]).concat(R(nonL)).concat([sm('负债合计', curL, nonL), g('所有者权益：')])
        .concat(R(eq)).concat([sm('所有者权益合计', eq), sm('负债和权益总计', curL, nonL.concat(eq))])))}
    </div>`;
};

/* ============ 合并利润表 ============ */
function csPlOf(m) {
  const pick = re => Object.keys(m).filter(k => re.test(k)).map(k => m[k]);
  const cr = a => a.reduce((s, x) => s + x.cr - x.dr, 0), dr = a => a.reduce((s, x) => s + x.dr - x.cr, 0);
  const rev = cr(pick(/^(5001|5051)/)), cost = dr(pick(/^(5401|5402)/)), taxSur = dr(pick(/^5403/));
  const sell = dr(pick(/^5601/)), adm = dr(pick(/^5602/)), fin = dr(pick(/^5603/));
  const invInc = cr(pick(/^5111/)), noIn = cr(pick(/^5301/)), noOut = dr(pick(/^5711/)), tax = dr(pick(/^5801/));
  const op = rev - cost - taxSur - sell - adm - fin + invInc;
  const total = op + noIn - noOut;
  return { rev, cost, taxSur, sell, adm, fin, invInc, noIn, noOut, tax, op, total, net: total - tax };
}
S['cs-pl'] = () => {
  if (!csCfg().parent) return csNeedCfg('合并利润表');
  const d = csData();
  // 抵消并进发生额：借方计入 dr、贷方计入 cr（伪科目除外）
  const merged = {};
  Object.keys(d.sumNet).forEach(k => { merged[k] = { dr: d.sumNet[k].dr, cr: d.sumNet[k].cr }; });
  d.elims.forEach(e => e.lines.forEach(l => {
    if (CS_PSEUDO[l.acct] || !/^5/.test(l.acct)) return;
    const o = merged[l.acct] = merged[l.acct] || { dr: 0, cr: 0 };
    o.dr += l.dr; o.cr += l.cr;
  }));
  const sum = csPlOf(d.sumNet), con = csPlOf(merged);
  const cfg = csCfg();
  const miPl = +cfg.subs.reduce((s, x) => s + csPeriodNet(x.ent) * (1 - x.share), 0).toFixed(2);
  const row = (nm, k, cls) => ({ cls: cls || '', d: [nm, money(sum[k]), money(+(con[k] - sum[k]).toFixed(2)) === '0.00' && con[k] === sum[k] ? '' : money(+(con[k] - sum[k]).toFixed(2)), money(con[k])] });
  return head('合并利润表', `合并范围 ${csEnts().length} 家 · ${AC.from}〜${AC.to}。抵消：内部购销收入成本（规则三）、内部投资收益（规则六）、未实现处置收益（规则四）。`, '核算 · 合并报表',
    `<button class="btn pri" data-act="csExpPl">导出</button>`)
    + kpis([
      { k: '合并营业收入', v: money(con.rev) },
      { k: '合并净利润', v: money(con.net), t: con.net >= 0 ? 'g' : 'c' },
      { k: '少数股东损益', v: money(miPl) },
      { k: '归母净利润', v: money(+(con.net - miPl).toFixed(2)), t: 'g' },
    ])
    + card('合并利润表', table(
      [{ t: '项目' }, { t: '加总数', n: 1 }, { t: '抵消调整', n: 1 }, { t: '合并数', n: 1 }], [
        row('一、营业收入', 'rev'),
        row('　减：营业成本', 'cost'),
        row('　　　税金及附加', 'taxSur'),
        row('　　　销售费用', 'sell'), row('　　　管理费用', 'adm'), row('　　　财务费用', 'fin'),
        row('　加：投资收益', 'invInc'),
        { cls: 'sum', d: ['<b>二、营业利润</b>', `<b>${money(sum.op)}</b>`, '', `<b>${money(con.op)}</b>`] },
        row('　加：营业外收入', 'noIn'), row('　减：营业外支出', 'noOut'),
        { cls: 'sum', d: ['<b>三、利润总额</b>', `<b>${money(sum.total)}</b>`, '', `<b>${money(con.total)}</b>`] },
        row('　减：所得税费用', 'tax'),
        { cls: 'sum', d: ['<b>四、净利润</b>', `<b>${money(sum.net)}</b>`, '', `<b>${money(con.net)}</b>`] },
        ['　其中：归属于母公司', '', '', money(+(con.net - miPl).toFixed(2))],
        ['　　　　少数股东损益', '', '', money(miPl)],
      ]));
};

/* ============ 合并现金流量表 ============ */
function csCfOf(ent) {
  const acts = { op: { in: 0, out: 0 }, inv: { in: 0, out: 0 }, fin: { in: 0, out: 0 } };
  vchIn(ent, AC.from, AC.to, AC.inc).forEach(v => {
    const delta = v.lines.reduce((s, l) => s + (rptIsCash(l.acct) ? l.dr - l.cr : 0), 0);
    if (Math.abs(delta) < 0.005) return;
    const opp = v.lines.filter(l => !rptIsCash(l.acct));
    if (!opp.length) return;
    const main = opp.reduce((a, b) => (a.dr + a.cr >= b.dr + b.cr ? a : b));
    const act = acts[rptCfClass(String(main.acct).split('_')[0], main.name)];
    if (delta > 0) act.in += delta; else act.out -= delta;
  });
  return acts;
}
S['cs-cf'] = () => {
  if (!csCfg().parent) return csNeedCfg('合并现金流量表');
  const ents = csEnts();
  const sum = { op: { in: 0, out: 0 }, inv: { in: 0, out: 0 }, fin: { in: 0, out: 0 } };
  ents.forEach(id => { const a = csCfOf(id); ['op', 'inv', 'fin'].forEach(k => { sum[k].in += a[k].in; sum[k].out += a[k].out; }); });
  // 规则五：内部现金流按登记对冲——流出方类别的流出、流入方类别的流入各减同额
  const el = { op: { in: 0, out: 0 }, inv: { in: 0, out: 0 }, fin: { in: 0, out: 0 } };
  csElims().forEach(e => { if (e.cash) { el[e.cash.outAct].out += e.cash.amt; el[e.cash.inAct].in += e.cash.amt; } });
  const N = { op: '经营活动', inv: '投资活动', fin: '筹资活动' };
  let flow = 0;
  const rows = [];
  ['op', 'inv', 'fin'].forEach(k => {
    const cin = +(sum[k].in - el[k].in).toFixed(2), cout = +(sum[k].out - el[k].out).toFixed(2);
    flow += cin - cout;
    rows.push({ cls: 'lv1', d: [`<b>${N[k]}：</b>`, '', '', ''] });
    rows.push([`　现金流入`, money(sum[k].in), el[k].in ? '-' + money(el[k].in) : '', money(cin)]);
    rows.push([`　现金流出`, money(sum[k].out), el[k].out ? '-' + money(el[k].out) : '', money(cout)]);
    rows.push({ cls: 'sum', d: [`<b>${N[k]}净额</b>`, `<b>${money(sum[k].in - sum[k].out)}</b>`, '', `<b>${money(+(cin - cout).toFixed(2))}</b>`] });
  });
  rows.push({ cls: 'sum', d: ['<b>现金及现金等价物净增加额</b>', '', '', `<b>${money(+flow.toFixed(2))}</b>`] });
  return head('合并现金流量表', `合并范围 ${ents.length} 家 · ${AC.from}〜${AC.to}。内部现金流按登记表（规则五）收支两条线对应抵消：流出方类别的流出与流入方类别的流入各减同额。`, '核算 · 合并报表',
    `<button class="btn pri" data-act="csExpCf">导出</button>`)
    + kpis([
      { k: '经营净额', v: money(+(sum.op.in - el.op.in - sum.op.out + el.op.out).toFixed(2)) },
      { k: '投资净额', v: money(+(sum.inv.in - el.inv.in - sum.inv.out + el.inv.out).toFixed(2)) },
      { k: '筹资净额', v: money(+(sum.fin.in - el.fin.in - sum.fin.out + el.fin.out).toFixed(2)) },
      { k: '现金净增加', v: money(+flow.toFixed(2)), t: 'g' },
    ])
    + card('合并现金流量', table([{ t: '项目' }, { t: '加总数', n: 1 }, { t: '抵消', n: 1 }, { t: '合并数', n: 1 }], rows));
};

/* ============ 事件 ============ */
document.addEventListener('change', e => {
  if (e.target.id === 'csParent') { const c = csCfg(); c.parent = e.target.value; csCfgSave(c); go('cs-set'); }
});
document.addEventListener('click', e => {
  const del = e.target.closest('[data-csdel]');
  if (del) { const c = csCfg(); c.subs.splice(+del.dataset.csdel, 1); csCfgSave(c); go('cs-set'); return; }
  const rdel = e.target.closest('[data-csrdel]');
  if (rdel) { csRegSave(csReg().filter(x => x.id !== rdel.dataset.csrdel)); toast('已删除'); go('cs-reg'); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'csAddSub') {
    const c = csCfg();
    const ent = ($('csSub') || {}).value;
    const share = (+($('csShare') || {}).value || 0) / 100;
    if (!c.parent) { toast('先选母公司'); return; }
    if (!ent) { toast('先选子公司'); return; }
    if (ent === c.parent) { toast('子公司不能是母公司自己'); return; }
    if (c.subs.some(s => s.ent === ent)) { toast('该子公司已在范围内'); return; }
    if (share <= 0 || share > 1) { toast('持股比例填 1〜100'); return; }
    let inv = +($('csInv') || {}).value || 0;
    if (!inv) inv = +((csBalAt(c.parent, AC.to)['1511'] || { net: 0 }).net).toFixed(2);
    c.subs.push({ ent, share, inv });
    csCfgSave(c); toast('已加入合并范围'); go('cs-set'); return;
  }
  if (act === 'crAdd') {
    const g = id => ($(id) || {}).value;
    const type = g('crType');
    const rec = { id: uid(), type, month: g('crMonth') || AC.to.slice(0, 7), a: g('crA'), b: g('crB') };
    if (type === 'debt') {
      rec.amt = numOf(g('crAmt')); rec.credAcct = g('crCred'); rec.debtAcct = g('crDebt');
      if (!rec.amt) { toast('填金额'); return; }
    } else if (type === 'inv') {
      rec.price = numOf(g('crPrice')); rec.cost = numOf(g('crCost')); rec.pct = numOf(g('crExtra')) || 100;
      if (!rec.price || !rec.cost) { toast('填售价和成本'); return; }
      if (rec.cost > rec.price) toast('提醒：成本高于售价，按亏损购销抵消');
    } else if (type === 'fa') {
      rec.price = numOf(g('crPrice')); rec.nbv = numOf(g('crCost')); rec.dep = numOf(g('crExtra'));
      if (!rec.price) { toast('填转让价'); return; }
    } else if (type === 'cash') {
      rec.amt = numOf(g('crAmt')); rec.outAct = g('crOut'); rec.inAct = g('crIn');
      if (!rec.amt) { toast('填金额'); return; }
    } else if (type === 'div') {
      rec.amt = numOf(g('crAmt')); rec.total = numOf(g('crExtra')) || rec.amt;
      if (!rec.amt) { toast('填母公司确认的投资收益金额'); return; }
    }
    if (rec.a === rec.b) { toast('甲乙双方不能是同一主体'); return; }
    csRegSave(csReg().concat([rec])); toast('已登记'); go('cs-reg'); return;
  }
  if (act === 'csExpElim') {
    const rows = [['规则', '摘要', '科目', '名称', '借方', '贷方']];
    csElims().forEach(e2 => e2.lines.forEach(l =>
      rows.push([e2.rule, e2.memo, CS_PSEUDO[l.acct] ? '' : l.acct, l.name, l.dr ? l.dr.toFixed(2) : '', l.cr ? l.cr.toFixed(2) : ''])));
    download(`合并抵消分录_${AC.from}_${AC.to}.csv`, toCSV(rows)); toast('已导出');
  }
  if (act === 'csExpBs' || act === 'csExpPl' || act === 'csExpCf') {
    const tbl = document.querySelector('#view .cols table, #view .card table');
    if (tbl) {
      const rows = [...document.querySelectorAll('#view table tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
      const nm = act === 'csExpBs' ? '合并资产负债表' : act === 'csExpPl' ? '合并利润表' : '合并现金流量表';
      download(`${nm}_${AC.to}.csv`, toCSV(rows)); toast('已导出');
    }
  }
});
