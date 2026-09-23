'use strict';

// User-confirmed rule: return payments are a separate deduction from revenue.
function t4ReturnChannels() { return T4_CH.filter(c => ['ruimian', 'orange'].includes(c.bu)); }
function t4ReturnEntry() {
  if (!T4.returnEntry || T4.returnEntry.period !== T4.period) T4.returnEntry = { period: T4.period, date: t4DefaultRangeEnd(), channel: t4ReturnChannels()[0]?.id || '', amount: '' };
  return T4.returnEntry;
}
function t4ReturnCurrent(entry) {
  return t4InputValue(t4Raw(entry.channel, entry.date), 'rebateAmount');
}
function t4ReturnValues(entry) {
  if (!t4ReturnChannels().some(c => c.id === entry.channel)) throw new Error('请选择瑞眠或橘农的渠道');
  if (!new RegExp(`^${T4.period}-\\d{2}$`).test(entry.date) || +entry.date.slice(8) < 1 || +entry.date.slice(8) > t4Days()) throw new Error('返款日期必须在当前期间内');
  const amount = Number(entry.amount);
  if (entry.amount == null || String(entry.amount).trim() === '' || !Number.isFinite(amount) || amount < 0) throw new Error('请填写大于或等于 0 的返款金额，系统自动扣减收入');
  return { rebateAmount: amount === 0 ? 0 : -amount };
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
  const entry = t4ReturnEntry(), current = t4ReturnCurrent(entry), locked = t4IsPeriodLocked();
  const rows = t4ReturnChannels().flatMap(c => Object.keys(T4.data[c.id] || {}).sort().flatMap(date => {
    const value = t4InputValue(t4Raw(c.id, date), 'rebateAmount');
    return value != null ? [[H(date), H(c.n), money(-Math.abs(value) || 0), `<button class="btn sm" data-t4return-edit="${H(c.id)}:${H(date)}">修改</button>`]] : [];
  }));
  const disabled = locked ? 'disabled' : '';
  return head('瑞眠 / 橘农 · 返款录入', '返款统一扣减销售收入。填写渠道当天的返款合计，保存后更新对应日期的返款金额。', '工具箱 · T4',
    t4PeriodControl('<button class="btn" data-t4go="overview">← 返回</button><button class="btn" data-t4go="sheet">看损益表</button>'))
    + cardp('录入返款', `<div class="frow"><label class="sel">渠道 <select data-return-field="channel" ${disabled}>${t4ReturnChannels().map(c => `<option value="${H(c.id)}" ${entry.channel === c.id ? 'selected' : ''}>${H(c.n)}</option>`).join('')}</select></label>`
      + `<label class="sel">日期 <input type="date" data-return-field="date" min="${t4Date(1)}" max="${t4Date(t4Days())}" value="${H(entry.date)}" ${disabled}></label></div>`
      + '<p>返款金额填正数，系统自动记为负数扣减销售收入；平台扣点按扣减后的销售收入计算。返款单独保存，已有退款金额保留。</p>'
      + `<div class="frow"><label class="sel">当日返款合计（元） <input type="number" data-return-field="amount" min="0" step="0.01" value="${H(entry.amount)}" placeholder="金额填正数，可填 0" ${disabled}></label><button class="btn pri" data-t4return-save ${disabled}>保存返款</button></div>`
      + `<p class="mut">目前已记：${current == null ? '无' : money(-Math.abs(current) || 0) + ' 元'}。${locked ? '当前期间已锁定，请先解锁再修改。' : '填 0 可将当天返款改为零。'}</p>`)
    + card('本期返款明细', rows.length ? t4PinnedTable([{t:'日期'},{t:'渠道'},{t:'返款金额（扣减收入）',n:1},{t:'操作'}], rows)
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
    T4.returnEntry = { period: T4.period, channel, date, amount: '' };
    const current = t4ReturnCurrent(T4.returnEntry);
    T4.returnEntry.amount = current == null ? '' : String(Math.abs(current));
    t4Go('returns'); return;
  }
  const save = e.target.closest('[data-t4return-save]');
  if (!save || save.disabled) return;
  try { await t4SaveReturn(); t4Go('returns'); toast('返款已保存，已按金额扣减销售收入'); }
  catch (err) { toast(`返款未保存：${err.message}`, 5200); }
});
