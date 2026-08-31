/* 员工与工资表 → 个税扣缴端桥
   扣缴客户端不对企业系统开放 API，唯一可行的对接是它的「批量导入模板」——
   金蝶用友也是这么接的。本页：员工花名册 + 月工资表（可从 Excel 导入）
   → 一键导出扣缴端「正常工资薪金」导入模板（xlsx）+ 个税试算（累计预扣法）
   → 工资计提凭证进凭证库 → 与账上工资基数勾稽（个税申报页同屏对比）。
   姓名/身份证号只存本机浏览器 localStorage，不上传任何服务器（负责人拍板）。 */
'use strict';

const PAY_EMP_KEY = e => 'fsc_pay_emp_' + e + '_v1';
const PAY_SAL_KEY = (e, m) => 'fsc_pay_sal_' + e + '_' + m + '_v1';
const payEmp = () => { try { return JSON.parse(localStorage.getItem(PAY_EMP_KEY(CUR_ENT)) || '[]'); } catch (e) { return []; } };
const payEmpSave = v => { try { localStorage.setItem(PAY_EMP_KEY(CUR_ENT), JSON.stringify(v)); } catch (e) { toast('保存失败'); } };
const paySal = m => { try { return JSON.parse(localStorage.getItem(PAY_SAL_KEY(CUR_ENT, m)) || '{}'); } catch (e) { return {}; } };
const paySalSave = (m, v) => { try { localStorage.setItem(PAY_SAL_KEY(CUR_ENT, m), JSON.stringify(v)); } catch (e) { toast('保存失败'); } };

/* 个税累计预扣率表（工资薪金） */
const IIT_BRACKETS = [
  [36000, 0.03, 0], [144000, 0.10, 2520], [300000, 0.20, 16920], [420000, 0.25, 31920],
  [660000, 0.30, 52920], [960000, 0.35, 85920], [Infinity, 0.45, 181920]];
const iitOf = cum => {
  if (cum <= 0) return 0;
  const b = IIT_BRACKETS.find(x => cum <= x[0]);
  return +(cum * b[1] - b[2]).toFixed(2);
};
/* 某员工截至 M 月的试算（只累计系统里有工资表的月份；年中启用会偏差，页面明说） */
function payCalc(empId, M) {
  const y = M.slice(0, 4);
  let gross = 0, ded = 0, sf = 0, months = 0, prevTax = 0;
  for (let m = 1; m <= +M.slice(5, 7); m++) {
    const mm = y + '-' + String(m).padStart(2, '0');
    const s = paySal(mm)[empId];
    if (!s) continue;
    months++;
    gross += +s.gross || 0;
    ded += (+s.pension || 0) + (+s.medical || 0) + (+s.unemp || 0) + (+s.fund || 0) + (+s.other || 0);
    sf += +s.sf || 0;
    if (mm < M) {
      const taxable0 = gross - 5000 * months - ded - sf;
      prevTax = Math.max(prevTax, iitOf(taxable0));
    }
  }
  const taxable = gross - 5000 * months - ded - sf;
  const tax = Math.max(0, +(iitOf(taxable) - prevTax).toFixed(2));
  return { gross, months, taxable: +taxable.toFixed(2), tax };
}

/* Excel 导入列别名 */
const PAY_ALIAS = {
  name: ['姓名', '员工姓名'], idno: ['身份证号', '证件号码', '身份证', '证件号'], dept: ['部门'],
  gross: ['应发工资', '应发', '工资', '本期收入', '应发合计'],
  pension: ['养老', '养老保险'], medical: ['医疗', '医疗保险'], unemp: ['失业', '失业保险'],
  fund: ['公积金', '住房公积金'], sf: ['专项附加', '专项附加扣除'], other: ['其他扣除'],
};
function payMap(header) {
  const cells = header.map(h => String(h == null ? '' : h).replace(/\s/g, ''));
  const map = {}, used = new Set();
  [1, 0].forEach(exact => Object.keys(PAY_ALIAS).forEach(k => {
    if (map[k] !== undefined) return;
    for (const a of PAY_ALIAS[k]) {
      const i = cells.findIndex((c, idx) => c && !used.has(idx) && (exact ? c === a : c.includes(a)));
      if (i >= 0) { map[k] = i; used.add(i); return; }
    }
  }));
  return map;
}
async function payImport(file) {
  try {
    toast('正在解析…');
    const rows = await XLSXLite.readTable(file);
    const hr = XLSXLite.findHeaderRow(rows, Object.values(PAY_ALIAS).flat());
    const map = payMap(rows[hr] || []);
    if (map.name === undefined || map.gross === undefined) {
      toast('缺少必备列：姓名、应发工资。身份证号/养老/医疗/失业/公积金/专项附加为选填列。', 5200); return;
    }
    const emps = payEmp();
    const sal = paySal(IV.month);
    let nEmp = 0, nSal = 0, dup = 0;
    rows.slice(hr + 1).forEach(r => {
      const g = k => (map[k] === undefined ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim());
      const name = g('name'); if (!name) return;
      let e = emps.find(x => x.name === name);
      if (!e) { e = { id: uid(), name, idno: g('idno'), dept: g('dept'), on: 1 }; emps.push(e); nEmp++; }
      else {
        if (!e.idno && g('idno')) e.idno = g('idno');
        if (!e.on) { e.on = 1; nEmp++; }   // 移除过的人重新出现在工资表里 = 重新在职
      }
      if (sal[e.id]) dup++;
      sal[e.id] = { gross: numOf(g('gross')), pension: numOf(g('pension')), medical: numOf(g('medical')),
        unemp: numOf(g('unemp')), fund: numOf(g('fund')), sf: numOf(g('sf')), other: numOf(g('other')) };
      nSal++;
    });
    payEmpSave(emps); paySalSave(IV.month, sal);
    toast(`导入 ${IV.month} 工资表：${nSal} 人` + (nEmp ? `（新增/恢复员工 ${nEmp}）` : '') + (dup ? `，覆盖已有 ${dup} 人` : ''), 5200);
    go('iv-pay');
  } catch (e) { toast('读取失败：' + e.message, 4200); }
}

S['iv-pay'] = () => {
  if (!CUR_ENT) return needEnt('员工与工资表');
  const emps = payEmp().filter(x => x.on);
  const sal = paySal(IV.month);
  let tGross = 0, tTax = 0, noId = 0;
  const rows = emps.map(e => {
    const s = sal[e.id] || {};
    const c = s.gross ? payCalc(e.id, IV.month) : null;
    if (s.gross) { tGross += +s.gross; tTax += c.tax; }
    if (!e.idno) noId++;
    return [H(e.name),
      e.idno ? `<span class="code">${H(String(e.idno).replace(/^(.{4}).+(.{4})$/, '$1**********$2'))}</span>` : '<span class="red">缺身份证号</span>',
      `<input type="number" step="0.01" class="obin" data-pay="${H(e.id)}:gross" value="${s.gross || ''}" placeholder="应发">`,
      `<input type="number" step="0.01" class="obin" data-pay="${H(e.id)}:pension" value="${s.pension || ''}" placeholder="养老">`,
      `<input type="number" step="0.01" class="obin" data-pay="${H(e.id)}:medical" value="${s.medical || ''}" placeholder="医疗">`,
      `<input type="number" step="0.01" class="obin" data-pay="${H(e.id)}:unemp" value="${s.unemp || ''}" placeholder="失业">`,
      `<input type="number" step="0.01" class="obin" data-pay="${H(e.id)}:fund" value="${s.fund || ''}" placeholder="公积金">`,
      `<input type="number" step="0.01" class="obin" data-pay="${H(e.id)}:sf" value="${s.sf || ''}" placeholder="专项附加">`,
      c ? money(c.tax) : '—',
      `<button class="btn sm" data-paydel="${H(e.id)}">移除</button>`];
  });
  const acc = ivWageBase(IV.month);
  const diff = +(tGross - acc.total).toFixed(2);
  return head('员工与工资表', `${H(entName())} · ${IV.month}。扣缴端不开放 API，对接走它的批量导入模板——这里录好工资，导出模板去扣缴端两次点击导入。`, '纳税申报 · 个税桥',
    `<input type="month" id="ivMonth" value="${IV.month}" min="2026-01">
     <button class="btn" data-act="payUp">导入工资表(Excel)</button>
     <button class="btn" data-act="payAddEmp">+ 员工</button>
     <button class="btn" data-act="paySave">保存工资</button>
     <button class="btn" data-act="payVch">生成计提凭证</button>
     <button class="btn pri" data-act="payExp">导出扣缴端模板</button>`)
    + kpis([
      { k: '员工数', v: String(emps.length), u: '人' },
      { k: '本月应发合计', v: money(tGross) },
      { k: '个税试算合计', v: money(+tTax.toFixed(2)) },
      { k: '与账上工资差异', v: money(diff), t: Math.abs(diff) < 0.01 ? 'g' : 'w' },
      { k: '缺身份证号', v: String(noId), u: '人', t: noId ? 'c' : 'g' },
    ])
    + (Math.abs(diff) >= 0.01 && tGross ? `<div class="note w"><b>工资表合计 ${money(tGross)} 与账上工资基数 ${money(acc.total)} 差 ${money(diff)}。</b>要么账上没计提全，要么工资表没录全——申报前把这两个数对平（这就是与利润表的勾稽）。</div>` : '')
    + `<div class="note"><b>隐私：</b>姓名与身份证号只存这台电脑的浏览器里，不上传任何服务器；列表里身份证号打码显示。
      <b>个税试算是参考数</b>（累计预扣法，只累计系统里有工资表的月份，年中启用会偏差），以扣缴端算出的为准。
      Excel 导入列名认：姓名/身份证号/应发工资/养老/医疗/失业/公积金/专项附加。</div>`
    + card(`${IV.month} 工资表（改完点「保存工资」）`, emps.length ? table(
      [{ t: '姓名' }, { t: '身份证号' }, { t: '应发', n: 1 }, { t: '养老', n: 1 }, { t: '医疗', n: 1 },
       { t: '失业', n: 1 }, { t: '公积金', n: 1 }, { t: '专项附加', n: 1 }, { t: '个税试算', n: 1 }, { t: '' }], rows)
      : `<div style="padding:26px;text-align:center;color:var(--text-3)">还没有员工——点「+ 员工」手工加，或直接导入工资表 Excel（会自动建花名册）</div>`);
};

/* ---- 事件 ---- */
document.addEventListener('click', e => {
  const pd = e.target.closest('[data-paydel]');
  if (pd) {
    const emps = payEmp(); const x = emps.find(v => v.id === pd.dataset.paydel);
    if (!x || !confirm(`把「${x.name}」移出花名册？历史月份工资表数据保留。`)) return;
    x.on = 0; payEmpSave(emps); go('iv-pay'); return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || !CUR_ENT) return;
  const act = a.dataset.act;
  const harvest = () => {
    const sal = paySal(IV.month);
    document.querySelectorAll('[data-pay]').forEach(inp => {
      const [id, k] = inp.dataset.pay.split(':');
      sal[id] = sal[id] || {};
      sal[id][k] = numOf(inp.value);
    });
    paySalSave(IV.month, sal); return sal;
  };
  if (act === 'payAddEmp') {
    const name = prompt('员工姓名'); if (!name) return;
    const idno = prompt('身份证号（可留空，导出模板前补上）') || '';
    const emps = payEmp();
    if (emps.some(x => x.on && x.name === name.trim())) { toast('已有同名员工'); return; }
    emps.push({ id: uid(), name: name.trim(), idno: idno.trim(), on: 1 });
    payEmpSave(emps); toast('已加入花名册'); go('iv-pay'); return;
  }
  if (act === 'paySave') { harvest(); toast('工资已保存'); go('iv-pay'); return; }
  if (act === 'payUp') {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.csv,.txt';
    inp.onchange = () => { if (inp.files[0]) payImport(inp.files[0]); };
    inp.click(); return;
  }
  if (act === 'payVch') {
    const sal = harvest();
    // 只算在册员工——移除是软删，全量求和会让凭证金额悄悄大于页面合计和导出模板
    const on = new Set(payEmp().filter(x => x.on).map(x => x.id));
    const ids = Object.keys(sal).filter(k => on.has(k) && +sal[k].gross > 0);
    const total = +ids.reduce((s, k) => s + (+sal[k].gross || 0), 0).toFixed(2);
    if (!total) { toast('工资表是空的'); return; }
    const memo = IV.month + ' 工资计提（工资表 ' + ids.length + ' 人）';
    // 科目必须带「工资」字样：ivWageBase 的勾稽只认名字含 工资|薪酬|薪金 的费用科目，
    // 挂 5602 管理费用会让本页与个税页的账-报勾稽永远闭不上。
    // 主体科目表里没有这两个末级时先自建——否则 acctName 查不到名（rptNet 的
    // 聚合名又会截掉「_工资」后缀），标准表主体的勾稽还是闭不上
    if (typeof bsFind === 'function' && typeof saveRSet === 'function') {
      if (!RS) RS = initRSet(CUR_ENT);
      let added = 0;
      if (!bsFind('560209')) { RS.accounts.push(['560209', '管理费用_工资']); added++; }
      if (!bsFind('221101')) { RS.accounts.push(['221101', '应付职工薪酬_工资']); added++; }
      if (added) saveRSet(CUR_ENT, RS);
    }
    ivPushVoucher('__pay_' + IV.month + '__', ivMonthEnd(IV.month), [
      IVL('560209', '管理费用_工资', total, 0, memo),
      IVL('221101', '应付职工薪酬_工资', 0, total, memo)]);
    return;
  }
  if (act === 'payExp') {
    harvest();
    const emps = payEmp().filter(x => x.on);
    const sal = paySal(IV.month);
    const miss = emps.filter(x => sal[x.id] && sal[x.id].gross && !x.idno);
    if (miss.length) { toast('有 ' + miss.length + ' 人缺身份证号（' + miss.slice(0, 3).map(x => x.name).join('、') + '…），扣缴端不收，先补齐', 5200); return; }
    const rows = [['工号', '姓名', '证件类型', '证件号码', '本期收入', '本期免税收入',
      '基本养老保险费', '基本医疗保险费', '失业保险费', '住房公积金',
      '企业(职业)年金', '商业健康保险', '税延养老保险', '其他扣除', '准予扣除的捐赠额', '减免税额', '备注']];
    let n = 0;
    emps.forEach(x => {
      const s = sal[x.id]; if (!s || !s.gross) return;
      n++;
      rows.push([String(n), x.name, '居民身份证', x.idno, (+s.gross).toFixed(2), '0',
        (+s.pension || 0).toFixed(2), (+s.medical || 0).toFixed(2), (+s.unemp || 0).toFixed(2), (+s.fund || 0).toFixed(2),
        '0', '0', '0', (+s.other || 0).toFixed(2), '0', '0', '']);
    });
    if (n === 0) { toast('工资表是空的'); return; }
    downloadBlob(`扣缴端导入_正常工资薪金_${entName()}_${IV.month}.xlsx`,
      XLSXWrite.build([{ name: '正常工资薪金所得', rows }]));
    toast(`已导出 ${n} 人。扣缴端 → 综合所得申报 → 正常工资薪金 → 导入 → 选这个文件；列名若与你的扣缴端版本不一致，以它的最新模板列名为准调整。`, 6800);
    return;
  }
});
