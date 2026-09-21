/* 报表中心：三大报表 + 费用明细表
   数据只有一个来源：凭证库（acct.js 的 vchLoad/vchIn）。报表不落库、不缓存，
   每次打开实时汇总——两份数必然对不上，所以干脆只有一份。
   期间用顶栏的 AC.from 〜 AC.to：利润表/现金流量表/费用明细表是期间表，
   资产负债表取 AC.to 为期末时点。 */
'use strict';

/* ============ 科目归类 ============ */
/* 按科目编码前缀归类（项目后缀 _1001/_2001 先剥掉）。
   归不进去的不硬塞——单列出来提醒，塞错科目的报表比不出更糟。 */
const rptBase = c => String(c).split('_')[0];
const rptIsCash = c => /^(1001|1002|1012)/.test(rptBase(c));   // 库存现金/银行存款/其他货币资金

/* 期间内按「基础科目」聚合借贷发生额 */
function rptNet(entId, a, b, inc) {
  const m = {};
  vchIn(entId, a, b, inc).forEach(v => v.lines.forEach(l => {
    const base = rptBase(l.acct);
    const o = m[base] = m[base] || { dr: 0, cr: 0, name: '' };
    o.dr += l.dr; o.cr += l.cr;
    if (!o.name && l.name) o.name = String(l.name).split('_')[0];
  }));
  return m;
}
/* 截至某天（含当天）的累计净额（借-贷），按基础科目 */
function rptBalAt(entId, upto, inc) {
  const m = {};
  vchLoad(entId).forEach(v => {
    if (!(inc || v.posted) || vDate(v) > upto) return;
    v.lines.forEach(l => {
      const base = rptBase(l.acct);
      const o = m[base] = m[base] || { net: 0, name: '' };
      o.net += l.dr - l.cr;
      if (!o.name && l.name) o.name = String(l.name).split('_')[0];
    });
  });
  return m;
}
const rptPick = (m, re) => Object.keys(m).filter(k => re.test(k)).map(k => [k, m[k]]);
const rptCr = arr => arr.reduce((s, x) => s + x[1].cr - x[1].dr, 0);
const rptDr = arr => arr.reduce((s, x) => s + x[1].dr - x[1].cr, 0);

/* ============ 生成前检查 ============ */
function rptChecks() {
  const all = vchLoad(CUR_ENT).filter(v => vDate(v) <= AC.to);
  let unbal = 0;
  all.forEach(v => {
    const dr = v.lines.reduce((s, l) => s + l.dr, 0);
    const cr = v.lines.reduce((s, l) => s + l.cr, 0);
    if (Math.abs(dr - cr) > 0.005) unbal++;
  });
  const unposted = all.filter(v => !v.posted).length;
  // 凭证里出现过固定资产类科目（16xx/17xx）才提折旧；没有就明说不适用，
  // 别拿一条永远待确认的折旧提醒烦没有固定资产的主体
  const hasFA = all.some(v => v.lines.some(l => /^(16|17)/.test(rptBase(l.acct))));
  return { total: all.length, unbal, unposted, hasFA, block: unbal > 0 };
}
function rptCheckNote() {
  const c = rptChecks();
  if (!c.total) return `<div class="note"><b>凭证库是空的。</b>报表从凭证实时汇总——先去 T2 处理流水入库，或在凭证库手工补计提类凭证。</div>`;
  let h = '';
  if (c.block) h += `<div class="note c"><b>${c.unbal} 张凭证借贷不平，报表已禁止生成。</b>出一张自己都不信的报表，比不出更糟——先去凭证库改平。</div>`;
  if (c.unposted) h += `<div class="note w"><b>${c.unposted} 张未过账。</b>当前报表${AC.inc ? '<b>包含</b>' : '<b>不含</b>'}未过账凭证（在科目余额表切换）。正式出表前应全部过账。</div>`;
  h += c.hasFA
    ? `<div class="note"><b>计提类凭证请自查。</b>凭证里有固定资产科目——折旧、工资计提、税金计提这类不走银行的分录，系统看不见缺没缺，需要手工确认已在凭证库里。</div>`
    : `<div class="note"><b>计提提醒：</b>本期凭证未出现固定资产科目，折旧不适用；工资、税金若需计提仍要手工补凭证。</div>`;
  return h;
}

/* ============ 报表首页 ============ */
S['rp-home'] = () => {
  if (!CUR_ENT) return needEnt('报表中心');
  const c = rptChecks();
  const cardOf = (id, t, d, extra) => `
    <div class="card" style="cursor:${c.block ? 'not-allowed' : 'pointer'};opacity:${c.block ? '.5' : '1'}" ${c.block ? '' : `data-s="${id}"`}>
      <div class="cb"><b>${t}</b><div class="mut" style="font-size:12px;margin-top:5px">${d}</div>
      <div class="mut" style="font-size:11px;margin-top:7px;color:var(--text-3)">${extra}</div></div></div>`;
  return head('报表中心', `${H(entName())} · 期间 ${AC.from} 〜 ${AC.to}。四张表全部从凭证库实时算，数据来自账簿，账簿来自凭证。`, '核算 · 报表中心')
    + rptCheckNote()
    + `<div class="cols c4" style="margin-top:12px">
        ${cardOf('rp-bs', '资产负债表', '时点表。年初余额 vs 期末余额（' + AC.to + '），反映家底。', '资产 ＝ 负债 ＋ 所有者权益')}
        ${cardOf('rp-pl', '利润表', '期间表。本期金额 vs 本年累计，反映赚了多少。', '收入 − 成本费用 ＝ 利润')}
        ${cardOf('rp-cf', '现金流量表', '期间表。经营 / 投资 / 筹资三类活动的现金进出。', '与货币资金增减自动勾稽')}
        ${cardOf('rp-exp', '费用明细表', '管理层最常看。费用科目 × 项目两个维度。', '不属三大表，但更常用')}
      </div>`
    + card('生成前检查', table([{ t: '检查项' }, { t: '结果' }, { t: '说明' }], [
      ['凭证借贷平衡', c.unbal ? pill('未通过', 'cr') : pill('通过', 'ok'),
        c.unbal ? `${c.unbal} 张不平，去凭证库处理` : '全部平衡'],
      ['无未过账凭证', c.unposted ? pill('未通过', 'wa') : pill('通过', 'ok'),
        c.unposted ? `${c.unposted} 张待过账（当前报表${AC.inc ? '含' : '不含'}未过账）` : '全部已过账'],
      ['计提类凭证齐全', c.hasFA ? pill('待确认', 'wa') : pill('折旧不适用', 'ok'),
        c.hasFA ? '有固定资产科目，折旧/计提/结转需手工补，系统无法代查'
                : '本期无固定资产科目，折旧不适用；工资/税金计提若有仍需手工补'],
    ]));
};

/* ============ 资产负债表 ============ */
/* 按小企业会计准则（会小01表）标准行次出表：行次固定、全部列出（无发生额也占行），
   科目按编码前缀归入行次。归不进去的进「其他」行并警告，不无声丢数。
   未分配利润 = 标准科目余额 + 全部损益科目累计净额（系统未做年度结转，本年利润直接滚入）。 */
const BS_LINES = {
  // [行次标签, 编码正则]。金额=区间内累计净额，资产取借方向，负债权益取贷方向。
  curAsset: [
    ['货币资金', /^(1001|1002|1012)/],
    ['短期投资', /^1101/],
    ['应收票据', /^1121/],
    ['应收账款', /^1122/],
    ['预付账款', /^1123/],
    ['应收股利', /^1131/],
    ['应收利息', /^1132/],
    ['其他应收款', /^1221/],
    ['存货', /^14/],
  ],
  nonAsset: [
    ['长期债券投资', /^1501|^1511/],
    ['长期股权投资', /^1512|^1521/],
    ['固定资产原值', /^1601/],
    ['减：累计折旧', /^1602/, 'contra'],
    ['在建工程', /^(1604|1605)/],
    ['无形资产', /^1701/],
    ['减：累计摊销', /^1702/, 'contra'],
    ['长期待摊费用', /^1801/],
  ],
  curLiab: [
    ['短期借款', /^2001/],
    ['应付票据', /^2201/],
    ['应付账款', /^2202/],
    ['预收账款', /^2203/],
    ['应付职工薪酬', /^2211/],
    ['应交税费', /^2221/],
    ['应付利息', /^2231/],
    ['应付利润', /^2232/],
    ['其他应付款', /^2241/],
  ],
  nonLiab: [
    ['长期借款', /^2501/],
    ['递延收益', /^2401/],
    ['长期应付款', /^2701/],
  ],
  equity: [
    ['实收资本', /^(3001|4001)/],
    ['资本公积', /^(3002|4002)/],
    ['盈余公积', /^(3101|4101)/],
    ['未分配利润', /^(3103|3104|4103|4104)/],
  ],
};
function rptBsData() {
  const end = rptBalAt(CUR_ENT, AC.to, AC.inc);
  const open = rptBalAt(CUR_ENT, (AC.to.slice(0, 4) - 1) + '-12-31', AC.inc);
  const used = new Set();
  const sumBy = (m, re) => Object.keys(m).filter(k => re.test(k))
    .reduce((s, k) => { used.add(k); return s + m[k].net; }, 0);
  // 每个行次算期末与年初；contra（累计折旧/摊销）在资产侧是贷方余额，取负显示为减项
  const build = (defs, sign) => defs.map(d => {
    const e = sumBy(end, d[1]) * sign, o = sumBy(open, d[1]) * sign;
    return { nm: d[0], e: d[2] === 'contra' ? -e : e, o: d[2] === 'contra' ? -o : o, contra: d[2] === 'contra' };
  });
  const curAsset = build(BS_LINES.curAsset, 1), nonAsset = build(BS_LINES.nonAsset, 1);
  const curLiab = build(BS_LINES.curLiab, -1), nonLiab = build(BS_LINES.nonLiab, -1);
  const equity = build(BS_LINES.equity, -1);
  // 损益累计滚入未分配利润
  let pnlEnd = 0, pnlOpen = 0;
  Object.keys(end).forEach(k => { if (/^5/.test(k)) { used.add(k); pnlEnd += end[k].net; } });
  Object.keys(open).forEach(k => { if (/^5/.test(k)) { used.add(k); pnlOpen += open[k].net; } });
  const rp = equity.find(x => x.nm === '未分配利润');
  rp.nm = '未分配利润（含本年利润，未结转）'; rp.e += -pnlEnd; rp.o += -pnlOpen;
  // 归不进行次的科目：资产/负债各兜一行，其余列警告
  const others = { a: 0, aO: 0, l: 0, lO: 0, list: [] };
  const keys = [...new Set([...Object.keys(end), ...Object.keys(open)])];
  keys.forEach(k => {
    if (used.has(k)) return;
    const e = end[k] ? end[k].net : 0, o = open[k] ? open[k].net : 0;
    const nm = (end[k] && end[k].name) || (open[k] && open[k].name) || k;
    if (/^1/.test(k)) { others.a += e; others.aO += o; others.list.push(k + ' ' + nm); }
    else if (/^2/.test(k)) { others.l += -e; others.lO += -o; others.list.push(k + ' ' + nm); }
    else if (/^[34]/.test(k)) { rp.e += -e; rp.o += -o; others.list.push(k + ' ' + nm + '（并入未分配利润行）'); }
    else others.list.push(k + ' ' + nm + '（未计入！）');
  });
  if (others.a || others.aO) curAsset.push({ nm: '其他流动资产（未归类科目）', e: others.a, o: others.aO });
  if (others.l || others.lO) curLiab.push({ nm: '其他流动负债（未归类科目）', e: others.l, o: others.lO });
  // contra 行已取负，直接求和就是净值口径
  const T = a => a.reduce((s, x) => s + (x.contra ? -x.e : x.e), 0);
  const TO = a => a.reduce((s, x) => s + (x.contra ? -x.o : x.o), 0);
  return { curAsset, nonAsset, curLiab, nonLiab, equity, other: others.list,
    tca: T(curAsset), tcaO: TO(curAsset), tna: T(nonAsset), tnaO: TO(nonAsset),
    tcl: T(curLiab), tclO: TO(curLiab), tnl: T(nonLiab), tnlO: TO(nonLiab),
    te: T(equity), teO: TO(equity) };
}
S['rp-bs'] = () => {
  if (!CUR_ENT) return needEnt('资产负债表');
  const d = rptBsData();
  const ta = d.tca + d.tna, taO = d.tcaO + d.tnaO;
  const tl = d.tcl + d.tnl, tlO = d.tclO + d.tnlO;
  const balanced = Math.abs(ta - tl - d.te) < 0.01;
  const R = a => a.map(x => [`　${H(x.nm)}`, money(x.e), money(x.o)]);
  const g = t => ({ cls: 'lv1', d: [`<b>${t}</b>`, '', ''] });
  const sm = (t, e, o) => ({ cls: 'sum', d: [`<b>${t}</b>`, `<b>${money(e)}</b>`, `<b>${money(o)}</b>`] });
  const cols = [{ t: '项目' }, { t: '期末余额', n: 1 }, { t: '年初余额', n: 1 }];
  return head('资产负债表', `${H(entName())} · 期末 ${AC.to}。小企业会计准则标准行次，行次固定全列（无发生额也占行）。`, '报表中心 · 会小01表',
    `<button class="btn pri" data-act="rptExpBs">导出</button>`)
    + kpis([
      { k: '资产总计', v: money(ta) },
      { k: '负债合计', v: money(tl) },
      { k: '所有者权益合计', v: money(d.te) },
      { k: '平衡校验', v: balanced ? '✓' : money(ta - tl - d.te), t: balanced ? 'g' : 'c' },
    ])
    + (balanced ? '' : `<div class="note c"><b>资产 ≠ 负债 + 权益，差 ${money(ta - tl - d.te)}。</b>通常是有凭证借贷不平——回报表首页看检查项。</div>`)
    + (d.other.length ? `<div class="note w"><b>有科目没归进标准行次：</b>${d.other.map(H).join('、')}。已并入「其他」行，请检查科目编码。</div>` : '')
    + `<div class="cols c2">
      ${card('资产', table(cols,
        [g('流动资产：')].concat(R(d.curAsset))
        .concat([sm('流动资产合计', d.tca, d.tcaO), g('非流动资产：')])
        .concat(R(d.nonAsset))
        .concat([sm('非流动资产合计', d.tna, d.tnaO), sm('资产总计', ta, taO)])))}
      ${card('负债和所有者权益', table(cols,
        [g('流动负债：')].concat(R(d.curLiab))
        .concat([sm('流动负债合计', d.tcl, d.tclO), g('非流动负债：')])
        .concat(R(d.nonLiab))
        .concat([sm('非流动负债合计', d.tnl, d.tnlO), sm('负债合计', tl, tlO), g('所有者权益：')])
        .concat(R(d.equity))
        .concat([sm('所有者权益合计', d.te, d.teO), sm('负债和所有者权益总计', tl + d.te, tlO + d.teO)])))}
    </div>`;
};

/* ============ 利润表 ============ */
function rptPlData(a, b) {
  const m = rptNet(CUR_ENT, a, b, AC.inc);
  const rev = rptCr(rptPick(m, /^(5001|5051)/));
  const cost = rptDr(rptPick(m, /^(5401|5402)/));
  const taxSur = rptDr(rptPick(m, /^5403/));
  const sell = rptDr(rptPick(m, /^5601/));
  const adm = rptDr(rptPick(m, /^5602/));
  const fin = rptDr(rptPick(m, /^5603/));
  const invInc = rptCr(rptPick(m, /^5111/));
  const noIn = rptCr(rptPick(m, /^5301/));
  const noOut = rptDr(rptPick(m, /^5711/));
  const tax = rptDr(rptPick(m, /^5801/));
  const known = /^(5001|5051|5111|5401|5402|5403|5601|5602|5603|5301|5711|5801)/;
  const un = rptPick(m, /^5/).filter(x => !known.test(x[0]));
  const unNet = rptCr(un);
  const op = rev - cost - taxSur - sell - adm - fin + invInc;
  const total = op + noIn - noOut + unNet;
  return { rev, cost, taxSur, sell, adm, fin, invInc, noIn, noOut, tax, op, total, net: total - tax,
    un: un.map(x => x[0] + ' ' + (x[1].name || '')) };
}
S['rp-pl'] = () => {
  if (!CUR_ENT) return needEnt('利润表');
  const cur = rptPlData(AC.from, AC.to);
  const ys = AC.to.slice(0, 4) + '-01-01';
  const yr = rptPlData(ys, AC.to);
  const row = (nm, k, cls) => ({ cls: cls || '', d: [nm, money(cur[k]), money(yr[k])] });
  return head('利润表', `${H(entName())} · 本期 ${AC.from}〜${AC.to}，本年累计 ${ys} 起。`, '报表中心 · 会小02表',
    `<button class="btn pri" data-act="rptExpPl">导出</button>`)
    + kpis([
      { k: '营业收入', v: money(cur.rev) },
      { k: '营业成本', v: money(cur.cost) },
      { k: '期间费用', v: money(cur.sell + cur.adm + cur.fin) },
      { k: '净利润', v: money(cur.net), t: cur.net >= 0 ? 'g' : 'c' },
    ])
    + (cur.un.length ? `<div class="note w"><b>有损益科目没归进标准行次：</b>${cur.un.map(H).join('、')}，已并入「利润总额」。请检查科目编码。</div>` : '')
    + card('利润表 · 本期与本年累计', table(
      [{ t: '项目' }, { t: '本期金额', n: 1 }, { t: '本年累计', n: 1 }], [
        row('一、营业收入', 'rev'),
        row('　减：营业成本', 'cost'),
        row('　　　税金及附加', 'taxSur'),
        row('　　　销售费用', 'sell'),
        row('　　　管理费用', 'adm'),
        row('　　　财务费用', 'fin'),
        row('　加：投资收益', 'invInc'),
        { cls: 'sum', d: ['<b>二、营业利润</b>', `<b>${money(cur.op)}</b>`, `<b>${money(yr.op)}</b>`] },
        row('　加：营业外收入', 'noIn'),
        row('　减：营业外支出', 'noOut'),
        { cls: 'sum', d: ['<b>三、利润总额</b>', `<b>${money(cur.total)}</b>`, `<b>${money(yr.total)}</b>`] },
        row('　减：所得税费用', 'tax'),
        { cls: 'sum', d: ['<b>四、净利润</b>', `<b>${money(cur.net)}</b>`, `<b>${money(yr.net)}</b>`] },
      ]));
};

/* ============ 现金流量表 ============ */
/* 直接从凭证判：每张凭证里货币资金科目的净增减，按对方科目归入
   经营/投资/筹资。混合凭证按金额最大的对方科目归类（已注明简化口径）。
   底部与货币资金期初期末勾稽——勾不上会红字摆出来，不藏。 */
function rptCfClass(code, name) {
  const n = String(name || '');
  if (/^(3001|4001|2001|2501)/.test(code) || /股东|投资款|借款/.test(n)) return 'fin';
  if (/^(15|16|17)/.test(code)) return 'inv';
  return 'op';
}
function rptCfData() {
  const acts = { op: { in: 0, out: 0, items: {} }, inv: { in: 0, out: 0, items: {} }, fin: { in: 0, out: 0, items: {} } };
  vchIn(CUR_ENT, AC.from, AC.to, AC.inc).forEach(v => {
    const delta = v.lines.reduce((s, l) => s + (rptIsCash(l.acct) ? l.dr - l.cr : 0), 0);
    if (Math.abs(delta) < 0.005) return;
    const opp = v.lines.filter(l => !rptIsCash(l.acct));
    if (!opp.length) return;
    const main = opp.reduce((a, b) => (a.dr + a.cr >= b.dr + b.cr ? a : b));
    const act = acts[rptCfClass(rptBase(main.acct), main.name)];
    const key = rptBase(main.acct) + ' ' + String(main.name || '').split('_')[0];
    const it = act.items[key] = act.items[key] || { in: 0, out: 0 };
    if (delta > 0) { act.in += delta; it.in += delta; } else { act.out -= delta; it.out -= delta; }
  });
  const cashEnd = Object.entries(rptBalAt(CUR_ENT, AC.to, AC.inc)).reduce((s, x) => s + (rptIsCash(x[0]) ? x[1].net : 0), 0);
  const dayBefore = (() => { const t = new Date(AC.from); t.setDate(t.getDate() - 1); return ym(t) + '-' + String(t.getDate()).padStart(2, '0'); })();
  const cashOpen = Object.entries(rptBalAt(CUR_ENT, dayBefore, AC.inc)).reduce((s, x) => s + (rptIsCash(x[0]) ? x[1].net : 0), 0);
  return { acts, cashOpen, cashEnd };
}
S['rp-cf'] = () => {
  if (!CUR_ENT) return needEnt('现金流量表');
  const d = rptCfData();
  const netOf = a => a.in - a.out;
  const flowNet = netOf(d.acts.op) + netOf(d.acts.inv) + netOf(d.acts.fin);
  const tie = Math.abs(flowNet - (d.cashEnd - d.cashOpen)) < 0.01;
  const sect = (t, a) => [{ cls: 'lv1', d: [`<b>${t}</b>`, '', ''] }]
    .concat(Object.keys(a.items).sort().map(k =>
      [`　${H(k)}`, a.items[k].in ? money(a.items[k].in) : '', a.items[k].out ? money(a.items[k].out) : '']))
    .concat([{ cls: 'sum', d: [`<b>${t.slice(0, t.length - 1)}净额</b>`, '', `<b>${money(netOf(a))}</b>`] }]);
  return head('现金流量表', `${H(entName())} · ${AC.from}〜${AC.to}。货币资金口径 = 库存现金(1001) + 银行存款(1002) + 其他货币资金(1012)，三者互转不计现金流。从对方科目直接归类；混合凭证按金额最大的对方科目归入，属简化口径。`, '报表中心 · 会小03表',
    `<button class="btn pri" data-act="rptExpCf">导出</button>`)
    + kpis([
      { k: '经营活动净额', v: money(netOf(d.acts.op)), t: netOf(d.acts.op) >= 0 ? 'g' : 'c' },
      { k: '投资活动净额', v: money(netOf(d.acts.inv)) },
      { k: '筹资活动净额', v: money(netOf(d.acts.fin)) },
      { k: '现金净增加', v: money(flowNet) },
      { k: '与账面勾稽', v: tie ? '✓' : money(flowNet - (d.cashEnd - d.cashOpen)), t: tie ? 'g' : 'c' },
    ])
    + (tie ? '' : `<div class="note c"><b>现金流量净额与货币资金账面增减对不上，差 ${money(flowNet - (d.cashEnd - d.cashOpen))}。</b>通常是凭证借贷不平或货币资金科目编码不在 1001/1002/1012。</div>`)
    + card(`现金流量 · 期初 ${money(d.cashOpen)} → 期末 ${money(d.cashEnd)}`, table(
      [{ t: '项目' }, { t: '流入', n: 1 }, { t: '流出', n: 1 }],
      sect('一、经营活动：', d.acts.op).concat(sect('二、投资活动：', d.acts.inv)).concat(sect('三、筹资活动：', d.acts.fin))
        .concat([{ cls: 'sum', d: ['<b>现金及现金等价物净增加额</b>', '', `<b>${money(flowNet)}</b>`] }])));
};

/* ============ 费用明细表 ============ */
S['rp-exp'] = () => {
  if (!CUR_ENT) return needEnt('费用明细表');
  const ys = AC.to.slice(0, 4) + '-01-01';
  const agg = (a, b) => {
    const m = {};
    vchIn(CUR_ENT, a, b, AC.inc).forEach(v => v.lines.forEach(l => {
      if (!/^56/.test(rptBase(l.acct))) return;
      const o = m[l.acct] = m[l.acct] || { name: l.name || '', v: 0 };
      o.v += l.dr - l.cr;
    }));
    return m;
  };
  const cur = agg(AC.from, AC.to), year = agg(ys, AC.to);
  const keys = [...new Set([...Object.keys(cur), ...Object.keys(year)])].sort();
  const projName = code => {
    const ps = (typeof PROJECTS === 'function' ? PROJECTS() : []) || [];
    const p = ps.find(x => x.code === code);
    return p ? p.name : (code || '—');
  };
  let tc = 0, ty = 0;
  const rows = keys.map(k => {
    const [base, proj] = String(k).split('_');
    const c = cur[k] ? cur[k].v : 0, y = year[k] ? year[k].v : 0;
    tc += c; ty += y;
    return [`<span class="code">${H(base)}</span>`, H((cur[k] || year[k]).name || acctName(k)), H(projName(proj)), money(c), money(y)];
  });
  return head('费用明细表', `${H(entName())} · 本期 ${AC.from}〜${AC.to}。费用科目 × 项目，本期与本年累计。`, '报表中心',
    `<button class="btn pri" data-act="rptExpExp">导出</button>`)
    + kpis([
      { k: '本期费用合计', v: money(tc) },
      { k: '本年累计', v: money(ty) },
      { k: '费用科目数', v: String(keys.length), u: '个' },
    ])
    + card('费用明细', rows.length ? table(
      [{ t: '科目' }, { t: '科目名称' }, { t: '项目' }, { t: '本期发生', n: 1 }, { t: '本年累计', n: 1 }], rows,
      ['<b>合计</b>', '', '', `<b>${money(tc)}</b>`, `<b>${money(ty)}</b>`])
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">期间内没有费用发生</div>`);
};

/* ============ 导出 ============ */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  const rng = AC.from + '_' + AC.to;
  if (act === 'rptExpBs') {
    const d = rptBsData();
    const rows = [['项目', '期末余额', '年初余额']];
    const put = (t, a) => { rows.push([t, '', '']); a.forEach(x => rows.push(['　' + x.nm, x.e.toFixed(2), x.o.toFixed(2)])); };
    put('流动资产：', d.curAsset); rows.push(['流动资产合计', d.tca.toFixed(2), d.tcaO.toFixed(2)]);
    put('非流动资产：', d.nonAsset); rows.push(['非流动资产合计', d.tna.toFixed(2), d.tnaO.toFixed(2)]);
    rows.push(['资产总计', (d.tca + d.tna).toFixed(2), (d.tcaO + d.tnaO).toFixed(2)]);
    put('流动负债：', d.curLiab); rows.push(['流动负债合计', d.tcl.toFixed(2), d.tclO.toFixed(2)]);
    put('非流动负债：', d.nonLiab); rows.push(['非流动负债合计', d.tnl.toFixed(2), d.tnlO.toFixed(2)]);
    rows.push(['负债合计', (d.tcl + d.tnl).toFixed(2), (d.tclO + d.tnlO).toFixed(2)]);
    put('所有者权益：', d.equity); rows.push(['所有者权益合计', d.te.toFixed(2), d.teO.toFixed(2)]);
    rows.push(['负债和所有者权益总计', (d.tcl + d.tnl + d.te).toFixed(2), (d.tclO + d.tnlO + d.teO).toFixed(2)]);
    download(`资产负债表_${AC.to}.csv`, toCSV(rows)); toast('已导出');
  } else if (act === 'rptExpPl') {
    const cur = rptPlData(AC.from, AC.to), yr = rptPlData(AC.to.slice(0, 4) + '-01-01', AC.to);
    const L = [['项目', '本期金额', '本年累计'],
      ['一、营业收入', cur.rev, yr.rev], ['减：营业成本', cur.cost, yr.cost], ['税金及附加', cur.taxSur, yr.taxSur],
      ['销售费用', cur.sell, yr.sell], ['管理费用', cur.adm, yr.adm], ['财务费用', cur.fin, yr.fin], ['加：投资收益', cur.invInc, yr.invInc],
      ['二、营业利润', cur.op, yr.op], ['加：营业外收入', cur.noIn, yr.noIn], ['减：营业外支出', cur.noOut, yr.noOut],
      ['三、利润总额', cur.total, yr.total], ['减：所得税费用', cur.tax, yr.tax], ['四、净利润', cur.net, yr.net]]
      .map(r => [r[0], typeof r[1] === 'number' ? r[1].toFixed(2) : r[1], typeof r[2] === 'number' ? r[2].toFixed(2) : r[2]]);
    download(`利润表_${rng}.csv`, toCSV(L)); toast('已导出');
  } else if (act === 'rptExpCf') {
    const d = rptCfData();
    const rows = [['活动', '对方科目', '流入', '流出']];
    [['经营', 'op'], ['投资', 'inv'], ['筹资', 'fin']].forEach(([nm, k]) => {
      Object.keys(d.acts[k].items).sort().forEach(it =>
        rows.push([nm, it, d.acts[k].items[it].in.toFixed(2), d.acts[k].items[it].out.toFixed(2)]));
      rows.push([nm + '净额', '', '', (d.acts[k].in - d.acts[k].out).toFixed(2)]);
    });
    rows.push(['期初货币资金', '', '', d.cashOpen.toFixed(2)]);
    rows.push(['期末货币资金', '', '', d.cashEnd.toFixed(2)]);
    download(`现金流量表_${rng}.csv`, toCSV(rows)); toast('已导出');
  } else if (act === 'rptExpExp') {
    const ys = AC.to.slice(0, 4) + '-01-01';
    const m = {};
    vchIn(CUR_ENT, ys, AC.to, AC.inc).forEach(v => v.lines.forEach(l => {
      if (!/^56/.test(rptBase(l.acct))) return;
      const o = m[l.acct] = m[l.acct] || { name: l.name || '', cur: 0, yr: 0 };
      const d0 = vDate(v);
      if (d0 >= AC.from && d0 <= AC.to) o.cur += l.dr - l.cr;
      o.yr += l.dr - l.cr;
    }));
    const rows = [['科目', '科目名称', '项目', '本期发生', '本年累计']];
    Object.keys(m).sort().forEach(k => {
      const [b, p] = k.split('_');
      rows.push([b, m[k].name, p || '', m[k].cur.toFixed(2), m[k].yr.toFixed(2)]);
    });
    download(`费用明细表_${rng}.csv`, toCSV(rows)); toast('已导出');
  }
});
