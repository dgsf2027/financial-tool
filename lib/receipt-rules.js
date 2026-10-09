/* Deterministic receipt decisions. Model output is evidence, never an instruction. */
(function (root) {
  'use strict';
  function cents(value) {
    const s = String(value == null ? '' : value).trim();
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    const n = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
    return Number.isSafeInteger(n) ? n : null;
  }
  function validDate(date) {
    return typeof date === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(date)
      && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  }
  function assess(row, result, options = {}) {
    const out = (state, reason, month = '') => ({ state, reason, month });
    if (String(row.status || '').trim() === '已核对') return out('skipped', '原表已核对，保留原值');
    if (String(row.status || '').trim()) return out('review', '核对列已有内容，保留原值');
    if (row.issues?.length) return out('review', row.issues.join('；'));
    if (row.duplicate) return out('review', '同一凭证被多行使用，请人工复核');
    if (cents(row.amount) == null || cents(row.amount) <= 0) return out('review', '支出金额需为大于零、最多两位小数的金额');
    if (row.images?.length !== 1) return out('review', row.images?.length ? '一行包含多张图片，请人工复核' : '未找到对应的支付截图');
    if (!result) return out('waiting', '等待识别');
    if (result.currency !== 'CNY' || cents(result.amount) == null) return out('review', '无法确认人民币付款金额');
    if (cents(row.amount) !== cents(result.amount)) return out('mismatch', '表格金额与截图付款金额不一致');
    if (result.payment_status !== 'success') return out('review', ({pending:'尚未完成收款',refunded:'凭证显示退款',failed:'凭证显示付款失败'})[result.payment_status] || '无法确认付款成功');
    if (result.multiple_transactions !== false || result.needs_review !== false) return out('review', result.reason || '图片有多笔交易或信息不明确');
    let month;
    if (options.monthMode === 'fixed') {
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(options.fixedMonth || '')) return out('review', '请选择统一归属月份');
      month = options.fixedMonth.slice(2).replace('-', '');
    } else {
      if (!validDate(result.payment_date)) return out('review', '图片缺少完整付款日期，无法确定月份');
      month = result.payment_date.slice(2, 7).replace('-', '');
    }
    if (row.month && String(row.month).trim() !== month) return out('review', '原有月份与本次归属月份不同，保留原值');
    return out('passed', '金额一致，付款成功', month);
  }
  const api = { cents, validDate, assess };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReceiptRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
