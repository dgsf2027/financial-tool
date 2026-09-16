(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.T4Allocation = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const fields = {
    directLaborMonth: '直接人工', directRentMonth: '直接租金物业', directOtherMonth: '直接其他管理',
    sharedLaborMonth: '人力公摊', sharedRentMonth: '房租水电公摊', sharedOtherMonth: '其他公摊'
  };
  const channelNames = new Set(['渠道', '销售渠道', '渠道名称', '店铺', '店铺名称', '归属渠道']);
  const socialNames = new Set(['社保(企业)', '企业社保', '社保企业', '社会保险(企业)']);

  function blank(value) {
    return value == null || (typeof value === 'string' && value.trim() === '');
  }

  function label(value) {
    return typeof value === 'string' ? value.replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[:：]$/, '').replace(/\(元\)$/, '') : '';
  }

  function amount(value) {
    if (blank(value)) return { empty: true };
    if (typeof value === 'number') return Number.isFinite(value) ? { value } : { invalid: true };
    if (typeof value !== 'string') return { invalid: true };
    let text = value.trim().replace(/（/g, '(').replace(/）/g, ')').replace(/，/g, ',');
    const negative = /^\(.*\)$/.test(text);
    if (negative) text = text.slice(1, -1).trim();
    text = text.replace(/^(?:[¥￥$]|RMB|CNY)\s*/i, '').trim();
    // Validate separators before removing them; "1,2,3" is not a valid amount.
    if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return { invalid: true };
    if (negative && /^[+-]/.test(text)) return { invalid: true };
    const parsed = Number(text.replace(/,/g, '')) * (negative ? -1 : 1);
    return Number.isFinite(parsed) ? { value: parsed } : { invalid: true };
  }

  function add(left, right) {
    // Excel amounts have at most 15 significant digits. Remove binary addition
    // artifacts without rounding allocations (often fractional cents) to cents.
    return Number((left + right).toPrecision(15));
  }

  function totalName(value) {
    return /(?:合计|小计|总计|汇总)(?:金额)?$/.test(label(value)) || /^total$/i.test(label(value));
  }

  function headerTokens(rows, start, end, column) {
    const tokens = [];
    for (let row = start; row <= end; row++) {
      const cells = rows[row] || [];
      let token = label(cells[column]);
      // SheetJS leaves all but the first cell of a merged parent header blank.
      // Only propagate a recognized social-insurance group, never arbitrary text.
      if (!token && row < end) {
        for (let previous = column - 1; previous >= 0; previous--) {
          const parent = label(cells[previous]);
          if (!parent) continue;
          if (socialNames.has(parent)) token = parent;
          break;
        }
      }
      if (token) tokens.push(token);
    }
    return tokens;
  }

  function identify(tokens) {
    const combined = tokens.join('').replace(/[\/·_-]/g, '');
    const social = /(?:社保\(企业\)|企业社保|社保企业|社会保险\(企业\))/.test(combined);
    if (social) {
      if (/(?:间接|公摊)/.test(combined)) return { component: 'sharedSocial', field: 'sharedLaborMonth' };
      if (/直接/.test(combined)) return { component: 'directSocial', field: 'directLaborMonth' };
      return null;
    }
    for (const [field, name] of Object.entries(fields)) {
      if (tokens.includes(name)) return { field };
    }
    if (tokens.includes('店铺直接人工')) return { component: 'directWages', field: 'directLaborMonth' };
    if (tokens.includes('公摊人工')) return { component: 'sharedWages', field: 'sharedLaborMonth' };
    return null;
  }

  function findHeader(rows, kind) {
    for (let anchor = 0; anchor < Math.min(rows.length, 60); anchor++) {
      const row = rows[anchor];
      if (!Array.isArray(row)) continue;
      const channel = row.findIndex(cell => channelNames.has(label(cell)));
      if (channel < 0) continue;
      let end = anchor;
      for (let next = anchor + 1; next <= Math.min(anchor + 2, rows.length - 1); next++) {
        const cells = rows[next];
        if (!Array.isArray(cells) || !blank(cells[channel])) break;
        const labels = cells.map(label).filter(Boolean);
        if (!labels.some(token => ['直接', '间接'].includes(token) || identify([token]))) break;
        if (cells.some(cell => !blank(cell) && !amount(cell).invalid)) break;
        end = next;
      }
      const start = Math.max(0, anchor - 2);
      const width = Math.max(...rows.slice(start, end + 1).map(cells => Array.isArray(cells) ? cells.length : 0));
      const totals = {}, components = {};
      for (let column = 0; column < width; column++) {
        if (column === channel) continue;
        const match = identify(headerTokens(rows, start, end, column));
        if (!match) continue;
        if (kind === 'payroll' && !['directLaborMonth', 'sharedLaborMonth'].includes(match.field)) continue;
        const target = match.component ? components : totals;
        const key = match.component || match.field;
        (target[key] ||= []).push(column);
      }
      const columns = {};
      for (const field of Object.keys(fields)) {
        if (totals[field]) columns[field] = totals[field];
      }
      if (kind === 'payroll') {
        if (!columns.directLaborMonth) columns.directLaborMonth = [...(components.directWages || []), ...(components.directSocial || [])];
        if (!columns.sharedLaborMonth) columns.sharedLaborMonth = [...(components.sharedWages || []), ...(components.sharedSocial || [])];
      }
      for (const field of Object.keys(columns)) if (!columns[field].length) delete columns[field];
      if (Object.keys(columns).length) {
        const ambiguous = [];
        for (const [field, matches] of Object.entries(totals)) if (matches.length > 1) ambiguous.push(field);
        if (kind === 'payroll') {
          for (const [component, matches] of Object.entries(components)) {
            const field = component.startsWith('direct') ? 'directLaborMonth' : 'sharedLaborMonth';
            if (!totals[field] && matches.length > 1 && !ambiguous.includes(field)) ambiguous.push(field);
          }
        }
        return { channel, end, columns, ambiguous };
      }
    }
    return null;
  }

  /**
   * Analyze only: does not alter rows, channel configuration or saved allocations.
   * headerRow is zero-based; provenance and issue row numbers are one-based.
   * Missing/blank fields are omitted from values, while an explicit zero is kept.
   */
  function analyze(rows, kind, resolveChannel) {
    const result = {
      entries: [], errors: [], unknown: [], matchedRows: 0,
      totals: Object.fromEntries(Object.keys(fields).map(field => [field, 0])), headerRow: -1
    };
    if (!Array.isArray(rows) || !['payroll', 'expense'].includes(kind) || typeof resolveChannel !== 'function') {
      result.errors.push({ row: 0, message: '导入参数无效，请选择工资底稿或费用分摊表。' });
      return result;
    }
    const header = findHeader(rows, kind);
    if (!header) {
      result.errors.push({ row: 0, message: '未找到渠道和可识别的分摊列。请提供已按渠道计算的直接人工／人力公摊或费用分摊表；不能仅凭实发工资推算分摊。' });
      return result;
    }
    result.headerRow = header.end;
    if (header.ambiguous.length) {
      for (const field of header.ambiguous) result.errors.push({ row: header.end + 1, message: `${fields[field]}存在重复表头，无法确定应使用哪一列。` });
      return result;
    }
    const byChannel = new Map();
    for (let index = header.end + 1; index < rows.length; index++) {
      const row = rows[index];
      if (!Array.isArray(row) || row.every(blank)) continue;
      const name = blank(row[header.channel]) ? '' : String(row[header.channel]).trim();
      if (channelNames.has(label(name)) || totalName(name)) continue;
      if (!name && row.slice(0, header.channel).some(totalName)) continue;
      const values = {};
      const errorStart = result.errors.length;
      let populated = false;
      for (const [field, columns] of Object.entries(header.columns)) {
        for (const column of columns) {
          const parsed = amount(row[column]);
          if (parsed.empty) continue;
          populated = true;
          if (parsed.invalid) {
            result.errors.push({ row: index + 1, message: `${fields[field]}（第${column + 1}列）不是有效金额：${String(row[column])}` });
          } else values[field] = add(values[field] || 0, parsed.value);
        }
        if (field in values && !Number.isFinite(values[field])) result.errors.push({ row: index + 1, message: `${fields[field]}合计超出有效金额范围。` });
      }
      if (!populated) continue;
      if (!name) {
        result.errors.push({ row: index + 1, message: '存在分摊金额，但渠道为空。' });
        continue;
      }
      const channel = resolveChannel(name);
      if (!channel) result.unknown.push({ row: index + 1, name });
      if (!channel || result.errors.length !== errorStart) continue;
      let entry = byChannel.get(channel);
      const nextValues = {}, nextTotals = {};
      for (const [field, value] of Object.entries(values)) {
        nextValues[field] = add(entry?.values[field] || 0, value);
        nextTotals[field] = add(result.totals[field], value);
        if (!Number.isFinite(nextValues[field]) || !Number.isFinite(nextTotals[field])) result.errors.push({ row: index + 1, message: `${fields[field]}合计超出有效金额范围。` });
      }
      if (result.errors.length !== errorStart) continue;
      if (!entry) {
        entry = { channel, values: {}, rows: [], sourceNames: [] };
        byChannel.set(channel, entry);
        result.entries.push(entry);
      }
      Object.assign(entry.values, nextValues);
      Object.assign(result.totals, nextTotals);
      entry.rows.push(index + 1);
      if (!entry.sourceNames.includes(name)) entry.sourceNames.push(name);
      result.matchedRows++;
    }
    return result;
  }
  return { analyze };
});
