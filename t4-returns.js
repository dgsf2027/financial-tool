'use strict';

// A return of money must be classified explicitly before it affects the report.
const T4_RETURN_TYPES = {
  refund: { key: 'refundAmount', name: '退给客户的退款', sign: -1, hint: '按负数写入已有“退款金额”，扣减销售收入，并参与平台扣点及利润计算。' },
  rebate: { key: 'rebateIncome', name: '返利收入', sign: 1, hint: '计入独立“返利收入”行，增加净利润；不增加销售收入，不改变平台扣点。' },
  receipt: { key: 'salesReceipt', name: '销售回款', sign: 1, hint: '记入“销售回款（仅记录）”，不重复增加销售收入或利润。' },
};
const t4ReturnType = key => Object.prototype.hasOwnProperty.call(T4_RETURN_TYPES, key) ? T4_RETURN_TYPES[key] : null;

function t4ReturnChannels() { return T4_CH.filter(c => ['ruimian', 'orange'].includes(c.bu)); }
function t4ReturnEntry() {
  if (!T4.returnEntry || T4.returnEntry.period !== T4.period) T4.returnEntry = { period: T4.period, date: t4DefaultRangeEnd(), channel: t4ReturnChannels()[0]?.id || '', type: '', amount: '' };
  return T4.returnEntry;
}
function t4ReturnCurrent(entry) {
  const type = t4ReturnType(entry.type);
  return type ? t4InputValue(t4Raw(entry.channel, entry.date), type.key) : null;
}
function t4ReturnValues(entry) {
  const type = t4ReturnType(entry.type);
  if (!type) throw new Error('请先选择返款类型，并核对它对报表的影响');
  if (!t4ReturnChannels().some(c => c.id === entry.channel)) throw new Error('请选择瑞眠或橘农的渠道');
  if (!new RegExp(`^${T4.period}-\\d{2}$`).test(entry.date) || +entry.date.slice(8) < 1 || +entry.date.slice(8) > t4Days()) throw new Error('返款日期必须在当前期间内');
  const amount = Number(entry.amount);
  if (String(entry.amount).trim() === '' || !Number.isFinite(amount) || amount < 0) throw new Error('请填写大于或等于 0 的金额；退款由系统自动记为负数');
  return { [type.key]: amount * type.sign };
}

async function t4SaveReturn(entry = t4ReturnEntry()) {
  t4RequireServerReady(); t4AssertEditable();
  const values = t4ReturnValues(entry), period = T4.period, before = t4Clone(T4.data);
  const oldStorage = localStorage.getItem(T4_KEY);
  const controls = [...document.querySelectorAll('[data-return-field], [data-t4return-save]')];
  controls.forEach(el => { el.disabled = true; });
  try {
    const days = T4.data[entry.channel] ||= {};
    const raw = days[entry.date] ||= {};
    Object.assign(raw, values);
    Object.keys(values).forEach(key => { (raw._manualFields ||= {})[key] = true; });
    await t4Save();
  } catch (error) {
    if (T4.period === period) T4.data = before;
    if (oldStorage == null) localStorage.removeItem(T4_KEY); else localStorage.setItem(T4_KEY, oldStorage);
    throw error;
  } finally { controls.forEach(el => { el.disabled = false; }); }
}

S['t4-returns'] = () => {
  t4Load();
  const entry = t4ReturnEntry(), type = t4ReturnType(entry.type), current = t4ReturnCurrent(entry), locked = t4IsPeriodLocked();
  const rows = t4ReturnChannels().flatMap(c => Object.keys(T4.data[c.id] || {}).sort().flatMap(date => {
    const values = Object.values(T4_RETURN_TYPES).map(t => t4InputValue(t4Raw(c.id, date), t.key));
    return values.some(v => v != null) ? [[H(date), H(c.n), ...values.map(v => v == null ? '—' : money(v)), `<button class="btn sm" data-t4return-edit="${H(c.id)}:${H(date)}">修改</button>`]] : [];
  }));
  const disabled = locked ? 'disabled' : '';
  return head('瑞眠 / 橘农 · 返款录入', '先选择返款类型，再填写该渠道当天的同类金额合计。三类金额独立保存；保存会覆盖所选日期同类金额，其他科目保留。', '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4go="sheet">看损益表</button>'))
    + cardp('录入返款', `<div class="frow"><label class="sel">渠道 <select data-return-field="channel" ${disabled}>${t4ReturnChannels().map(c => `<option value="${H(c.id)}" ${entry.channel === c.id ? 'selected' : ''}>${H(c.n)}</option>`).join('')}</select></label>`
      + `<label class="sel">日期 <input type="date" data-return-field="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${H(entry.date)}" ${disabled}></label>`
      + `<label class="sel">返款类型 <select data-return-field="type" ${disabled}><option value="">请选择类型</option>${Object.entries(T4_RETURN_TYPES).map(([k,t]) => `<option value="${k}" ${entry.type === k ? 'selected' : ''}>${H(t.name)}</option>`).join('')}</select></label></div>`
      + `<p>${type ? H(type.hint) : '选择类型后显示计算口径；未选择时不能保存。'}</p>`
      + `<div class="frow"><label class="sel">当日同类合计（元） <input type="number" data-return-field="amount" min="0" step="0.01" value="${H(entry.amount)}" placeholder="金额填正数，可填 0" ${disabled}></label><button class="btn pri" data-t4return-save ${disabled || (!type ? 'disabled' : '')}>保存返款</button></div>`
      + `<p class="mut">目前已记：${current == null ? '无' : money(current) + ' 元'}。${locked ? '当前期间已锁定，请先解锁再修改。' : '退款自动记负数；零金额会明确覆盖原值。'}</p>`)
    + card('本期返款明细', rows.length ? t4PinnedTable([{t:'日期'},{t:'渠道'},{t:'客户退款',n:1},{t:'返利收入',n:1},{t:'销售回款（仅记录）',n:1},{t:'操作'}], rows)
      : '<p class="mut" style="padding:16px">瑞眠和橘农本期还没有返款记录。</p>');
};

document.addEventListener('input', e => {
  if (e.target.dataset.returnField === 'amount') t4ReturnEntry().amount = e.target.value;
});
document.addEventListener('change', e => {
  const key = e.target.dataset.returnField;
  if (!key || key === 'amount') return;
  const entry = t4ReturnEntry(); entry[key] = e.target.value;
  const current = t4ReturnCurrent(entry);
  entry.amount = current == null ? '' : String(Math.abs(current));
  t4Go('returns');
});
document.addEventListener('click', async e => {
  const edit = e.target.closest('[data-t4return-edit]');
  if (edit) {
    const [channel, date] = edit.dataset.t4returnEdit.split(':');
    T4.returnEntry = { period: T4.period, channel, date, type: '', amount: '' }; t4Go('returns'); return;
  }
  const save = e.target.closest('[data-t4return-save]');
  if (!save || save.disabled) return;
  try { await t4SaveReturn(); t4Go('returns'); toast('返款已保存，报表按所选类型更新'); }
  catch (err) { toast(`返款未保存：${err.message}`, 5200); }
});
