/* Payment receipt review: workbook stays in this browser, images use the finance AI gateway. */
(function () {
  'use strict';
  const state = { book: null, file: null, rows: [], sheet: 'all', filter: 'all', page: 0, running: false,
    pause: false, busy: false, error: '', config: null, auth: false, monthMode: 'payment', fixedMonth: '',
    calls: 0, tokens: 0, cached: 0, selected: null, previewUrl: '', previewSeq: 0,
    startedAt: 0, runDone: 0, runCount: 0, concurrency: 2 };
  const labels = { waiting: '待识别', working: '识别中', passed: '一致 · 可回填', mismatch: '金额差异', review: '待复核', skipped: '原已核对', error: '识别失败' };
  const tones = { passed: 'ok', mismatch: 'cr', review: 'wa', error: 'cr', working: 'in', skipped: 'mu', waiting: 'mu' };
  const statusNames = { success: '付款成功', pending: '待收款', refunded: '已退款', failed: '付款失败', unknown: '不明确' };
  const fmt = n => Number(n).toLocaleString('zh-CN');
  function evaluate(row) { return row.transportError ? {state:'error',reason:row.transportError} : row.working ? {state:'working',reason:'正在识别图片'} : ReceiptRules.assess(row, row.result, state); }
  function scoped() { return state.rows.filter(r => state.sheet === 'all' || r.sheetId === state.sheet); }
  function readyRows() { return scoped().filter(r => ['waiting', 'error'].includes(evaluate(r).state)); }
  function passing() { return state.rows.filter(r => evaluate(r).state === 'passed'); }
  function refresh() { if (CURS === 'receipt-check') go('receipt-check'); }
  function message() { return state.error ? `<div class="note rc-error" role="alert">${H(state.error)}</div>` : ''; }
  async function loadConfig() {
    let ok = false;
    try {
      const [c, s] = await Promise.all([fetch('/api/receipt-check/config', {cache:'no-store'}), fetch('/api/session', {cache:'no-store'})]);
      if (!c.ok || !s.ok) throw Error('服务状态读取失败，请稍后重试');
      state.config = await c.json(); state.auth = !!(await s.json()).authenticated; ok = true;
    } catch (e) { state.error = e.message; }
    refresh();
    return ok;
  }
  S['receipt-check'] = () => {
    if (!state.config && !state.configLoading) { state.configLoading = true; void loadConfig(); }
    const rows = scoped(), counts = {};
    rows.forEach(r => { const s = evaluate(r).state; counts[s] = (counts[s] || 0) + 1; });
    const visible = rows.filter(r => state.filter === 'all' || evaluate(r).state === state.filter);
    state.page = Math.min(state.page, Math.max(0, Math.ceil(visible.length / 30) - 1));
    const done = rows.filter(r => r.result || r.transportError).length;
    const taskCount = done + (counts.waiting || 0) + (counts.working || 0);
    const model = state.config?.model || '连接中';
    const elapsed = state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0;
    const perMinute = state.runDone >= 3 && elapsed > 0 ? state.runDone / elapsed * 60 : 0;
    const eta = perMinute ? Math.ceil((state.runCount - state.runDone) / perMinute) : 0;
    const auth = !state.auth ? `<div class="note">AI 识别需先通过门户登录。<a href="/sso/login" target="_blank" rel="noopener">打开门户并进入财务中心</a>，完成后 <button class="btn sm" data-rc="session">刷新登录状态</button>。可先选择文件查看明细。</div>` : '';
    return head('支付凭证核对', '读取支付截图、逐笔核对金额，自动回填通过记录的「已核对」与月份。', 'AI · 财务工具')
      + `<section class="rc" aria-label="支付凭证核对">${message()}${auth}
      ${state.config && !state.config.configured ? '<div class="note rc-error">AI 中台尚未配置，暂时只能预览表格。</div>' : ''}
      <div class="card"><div class="cb rc-import"><div><h3>1. 选择含支付截图的 Excel</h3><p>支持钉钉 / WPS 导出的 .xlsx，自动识别「支出金额、支付截图、月份、核对」列。</p>
      <label class="rc-file">${state.busy ? '正在读取文件…' : state.file ? '更换 Excel 文件' : '选择 Excel 文件'}<input id="rc-file" type="file" accept=".xlsx" ${state.running || state.busy ? 'disabled' : ''}></label>
      ${state.file ? `<span class="rc-filename">${H(state.file.name)} · ${fmt((state.file.size / 1048576).toFixed(1))} MB</span>` : ''}</div>
      <div class="rc-privacy">原 Excel 留在浏览器，仅待识别的图片发送到 AI 中台及模型服务。导出文件保留原图和其他单元格；不会直接修改钉钉在线表格。</div></div></div>
      ${state.book ? `<div class="card"><div class="ch"><h3>2. 核对设置</h3></div><div class="cb rc-settings">
      <label>工作表<select id="rc-sheet" ${state.running ? 'disabled' : ''}><option value="all">全部工作表</option>${state.book.sheets.map(s => `<option value="${H(s.id)}" ${state.sheet === s.id ? 'selected' : ''}>${H(s.name)}（${s.rows.length} 条）</option>`).join('')}</select></label>
      <label>月份来源<select id="rc-month-mode" ${state.running ? 'disabled' : ''}><option value="payment" ${state.monthMode === 'payment' ? 'selected' : ''}>截图中的付款月份</option><option value="fixed" ${state.monthMode === 'fixed' ? 'selected' : ''}>统一归属月份</option></select></label>
      ${state.monthMode === 'fixed' ? `<label>归属月份<input id="rc-fixed-month" type="month" min="2000-01" max="2099-12" value="${H(state.fixedMonth)}" ${state.running ? 'disabled' : ''}></label>` : ''}
      <div class="rc-help">月份按原表格式写为 YYMM，例如 2610。原有核对内容会跳过；月份冲突、待收款、重复图片及信息不全均留待复核。</div></div></div>
      ${state.book.sheets.filter(s => s.issues?.length).map(s => `<div class="note">${H(s.name)}：${H(s.issues.join('；'))}</div>`).join('')}
      ${kpis([{k:'待识别',v:fmt(counts.waiting || 0)},{k:'一致 · 可回填',v:fmt(counts.passed || 0),t:'g'},{k:'金额差异',v:fmt(counts.mismatch || 0),t:'c'},{k:'待复核 / 失败',v:fmt((counts.review || 0) + (counts.error || 0)),t:'w'},{k:'原表已核对',v:fmt(counts.skipped || 0)}])}
      <div class="card"><div class="ch rc-toolbar"><h3>3. 识别与导出</h3><span class="sp"></span>
      <button class="btn pri" data-rc="start" ${state.running || state.busy || !state.auth || !state.config?.configured || !readyRows().length || (state.monthMode === 'fixed' && !state.fixedMonth) ? 'disabled' : ''}>${counts.error ? '继续识别 / 重试失败' : '开始核对'}（${readyRows().length}）</button>
      ${state.running ? `<button class="btn" data-rc="pause" ${state.pause ? 'disabled' : ''}>${state.pause ? '正在暂停…' : '暂停'}</button>` : ''}
      <button class="btn" data-rc="export" ${state.busy || state.running || !passing().length ? 'disabled' : ''}>导出已回填 Excel（${passing().length}）</button></div>
      <div class="cb"><div class="rc-progress" role="status" aria-live="polite">${state.running ? state.pause ? '等待当前请求结束后暂停' : '正在识别，请保持页面打开' : '本次已识别'} · ${done} / ${taskCount} 条 <progress max="${Math.max(1, taskCount)}" value="${done}" aria-label="本次处理进度"></progress></div>
      <div class="rc-meta">模型 ${H(model)} · 本次成功调用 ${state.calls} 次 · Token ${fmt(state.tokens)} · 缓存复用 ${state.cached} 次 · <a href="https://token.vvaix.com/" target="_blank" rel="noopener">AI 中台统计</a>（财务中心）</div>
      ${state.running ? `<div class="rc-meta">同时处理 ${state.concurrency} 张${perMinute ? ` · 约 ${perMinute.toFixed(0)} 张/分钟 · 预计还需 ${Math.max(1, eta)} 分钟` : ' · 正在估算处理速度'}</div>` : ''}
      <p class="rc-help">导出包含所有工作表中本次通过的记录，月份与核对格沿用同表已核对记录的底色；原有特殊标色保留。暂停会等待正在进行的请求完成；切换模块可保留进度，刷新或关闭页面会丢失本次结果。</p>
      <label class="rc-filter">显示记录<select id="rc-filter">${['all','waiting','passed','mismatch','review','error','skipped'].map(k => `<option value="${k}" ${state.filter === k ? 'selected' : ''}>${k === 'all' ? '全部' : labels[k]}</option>`).join('')}</select></label></div>
      <div class="rc-results"><div class="tw"><table><thead><tr><th>工作表 / 行</th><th>支出项目</th><th class="num">表格金额</th><th class="num">截图金额</th><th>判定</th><th>回填月份</th><th>凭证</th></tr></thead><tbody>${visible.slice(state.page * 30, state.page * 30 + 30).map(r => { const d = evaluate(r); return `<tr ${state.selected === r.key ? 'class="rc-selected"' : ''}><td>${H(r.sheetName)} / ${r.row}</td><td class="rc-label">${H(r.label)}</td><td class="num">${H(r.amount)}</td><td class="num">${r.result?.amount == null ? '—' : H(r.result.amount)}</td><td>${pill(labels[d.state], tones[d.state])}<div class="rc-reason">${H(d.reason)}</div></td><td>${H(d.month || r.month || '—')}</td><td><button class="btn sm" data-rc-detail="${H(r.key)}">查看</button></td></tr>`; }).join('') || '<tr><td colspan="7">没有符合筛选条件的记录</td></tr>'}</tbody></table></div>
      <div class="rc-pagination"><span>共 ${visible.length} 条 · 第 ${state.page + 1} / ${Math.max(1,Math.ceil(visible.length / 30))} 页</span><button class="btn sm" data-rc="prev" ${state.page === 0 ? 'disabled' : ''}>上一页</button><button class="btn sm" data-rc="next" ${(state.page + 1) * 30 >= visible.length ? 'disabled' : ''}>下一页</button></div></div></div>` : `<div class="rc-empty"><h3>先把支付截图与表格放在一起</h3><p>从钉钉导出包含图片的 Excel 后，在这里选择文件。金额一致且付款成功的记录会生成回填结果；有疑点的记录会显示原因。</p><p>已核对记录会自动跳过，减少重复调用。</p></div>`}
      <div id="rc-detail-host"></div></section>`;
  };
  async function importFile(file) {
    if (state.running || state.busy) return;
    state.busy = true; state.error = ''; refresh();
    try {
      const book = await ReceiptWorkbook.open(file);
      const usage = new Map(book.imageUsage.map(u => [u.ref, u.rows.length]));
      const rows = book.sheets.flatMap(s => s.rows.map(r => ({...r, issues:[...(r.issues || []), ...(!s.canExport ? ['工作表缺少必需列，无法回填'] : [])], sheetId:s.id, sheetName:s.name, key:`${s.id}:${r.row}`, duplicate:r.images.some(i => usage.get(i.ref) > 1)})));
      state.book = book; state.file = file; state.rows = rows; state.sheet = 'all'; state.filter = 'all'; state.page = 0;
      state.calls = 0; state.tokens = 0; state.cached = 0; state.selected = null;
      if (!rows.length) state.error = '未找到支出明细，请检查表头以及图片是否随文件导出。';
    } catch (e) { state.error = `读取失败：${e.message}`; }
    finally { state.busy = false; refresh(); }
  }
  function dataUrl(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(Error('图片读取失败')); r.readAsDataURL(blob); }); }
  async function recognize(row) {
    row.working = true; row.transportError = ''; refresh();
    try {
      const blob = await state.book.image(row.images[0]);
      if (blob.size > (state.config?.maxImageBytes || 5 * 1048576)) throw Error('图片超过 5 MB，请人工核对');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 155000);
      let response;
      try { response = await fetch('/api/receipt-check/recognize', {method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify({imageDataUrl:await dataUrl(blob)}), signal:controller.signal}); }
      finally { clearTimeout(timer); }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if ([401,402,403,429,503].includes(response.status)) state.pause = true;
        if (response.status === 401) { state.auth = false; window.financeSessionExpired?.(); }
        throw Error(body.error?.message || (typeof body.error === 'string' ? body.error : `识别服务暂不可用（${response.status}），可重试`));
      }
      if (!body.result) throw Error('识别结果缺失，请重试');
      row.result = body.result; row.callId = body.callId; row.model = body.model;
      if (typeof body.model === 'string') state.config.model = body.model;
      if (body.cached) state.cached++; else { state.calls++; state.tokens += Number(body.usage?.total_tokens) || 0; }
    } catch (e) { row.transportError = e.name === 'AbortError' ? '请求超时，本行未通过，可重试' : e.message; }
    finally { row.working = false; state.runDone++; refresh(); }
  }
  async function start() {
    if (state.running || state.busy || !state.auth || !state.config?.configured) return;
    state.running = true; state.pause = false; state.error = ''; refresh();
    // Refresh the server's model and batch limits without discarding any results.
    if (!await loadConfig() || !state.auth || !state.config?.configured || state.pause) { state.running = false; refresh(); return; }
    const queue = readyRows(); state.startedAt = Date.now(); state.runDone = 0; state.runCount = queue.length;
    const bounded = (value, fallback, max) => Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
    state.concurrency = bounded(state.config.maxConcurrency, 2, 8);
    const rpm = bounded(state.config.requestsPerMinute, 30, 120);
    const interval = Math.max(Math.ceil(66000 / rpm), Number(state.config.requestIntervalMs) || 0);
    refresh();
    // Shared pacing across all workers stays below the server/business-key cap.
    let nextStart = 0;
    const worker = async () => { while (!state.pause && queue.length) {
      const row = queue.shift(); const delay = Math.max(0, nextStart - Date.now()); nextStart = Math.max(Date.now(), nextStart) + interval;
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (state.pause) break;
      await recognize(row);
    }};
    try { await Promise.all(Array.from({length: state.concurrency}, () => worker())); } finally { state.running = false; refresh(); }
  }
  async function exportFile() {
    if (state.busy || state.running) return;
    state.busy = true; state.error = ''; refresh();
    try {
      const patches = passing().map(r => ({sheetId:r.sheetId,row:r.row,month:evaluate(r).month,status:'已核对'}));
      if (!patches.length) throw Error('没有可回填记录');
      const blob = await state.book.export(patches);
      downloadBlob(state.file.name.replace(/\.xlsx$/i, '') + '_已核对.xlsx', blob);
      toast(`已生成文件，回填 ${patches.length} 条；原文件保持不变`, 4500);
    } catch (e) { state.error = `导出失败：${e.message}`; } finally { state.busy = false; refresh(); }
  }
  async function detail(key) {
    const row = state.rows.find(r => r.key === key); if (!row) return;
    state.selected = key;
    const seq = ++state.previewSeq; URL.revokeObjectURL(state.previewUrl); state.previewUrl = '';
    const decision = evaluate(row), result = row.result;
    const el = document.createElement('dialog'); el.className = 'rc-dialog';
    el.innerHTML = `<div class="rc-dialog-head"><h3>${H(row.sheetName)} · 第 ${row.row} 行</h3><button class="btn" data-close>关闭</button></div><div class="rc-detail-body"><div class="rc-image-wrap"><p>正在读取凭证…</p></div><div><h4>${H(labels[decision.state])}</h4><p>${H(decision.reason)}</p><dl><dt>表格金额</dt><dd>${H(row.amount)}</dd><dt>截图金额</dt><dd>${H(result?.amount || '未识别')}</dd><dt>付款状态</dt><dd>${H(statusNames[result?.payment_status] || '未识别')}</dd><dt>付款日期</dt><dd>${H(result?.payment_date || '未识别')}</dd><dt>回填月份</dt><dd>${H(decision.month || '—')}</dd></dl><p>${H(result?.reason || '')}</p>${row.callId ? `<p class="rc-meta">中台调用编号<br>${H(row.callId)}</p>` : ''}<p class="rc-help">有疑点的记录不会自动标记，可根据凭证在原表中人工处理。</p></div></div>`;
    document.body.append(el); el.showModal(); el.querySelector('[data-close]').onclick = () => el.close();
    el.addEventListener('close', () => { ++state.previewSeq; URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; el.remove(); });
    try {
      if (!row.images.length) { el.querySelector('.rc-image-wrap').textContent = '本行没有可预览图片'; return; }
      const blob = await state.book.image(row.images[0]); if (seq !== state.previewSeq) return;
      state.previewUrl = URL.createObjectURL(blob);
      const img = document.createElement('img'); img.src = state.previewUrl; img.alt = `${row.sheetName}第${row.row}行支付凭证`; el.querySelector('.rc-image-wrap').replaceChildren(img);
    } catch (_) { if (el.isConnected) el.querySelector('.rc-image-wrap').textContent = '图片读取失败'; }
  }
  document.addEventListener('change', e => {
    if (e.target.id === 'rc-file' && e.target.files[0]) void importFile(e.target.files[0]);
    if (e.target.id === 'rc-sheet') { state.sheet = e.target.value; state.page = 0; refresh(); }
    if (e.target.id === 'rc-filter') { state.filter = e.target.value; state.page = 0; refresh(); }
    if (e.target.id === 'rc-month-mode') { state.monthMode = e.target.value; refresh(); }
    if (e.target.id === 'rc-fixed-month') { state.fixedMonth = e.target.value; refresh(); }
  });
  document.addEventListener('click', e => {
    const detailButton = e.target.closest('[data-rc-detail]'); if (detailButton) void detail(detailButton.dataset.rcDetail);
    const button = e.target.closest('[data-rc]'); if (!button || button.disabled) return;
    const action = button.dataset.rc;
    if (action === 'start') void start();
    if (action === 'pause') { state.pause = true; refresh(); }
    if (action === 'export') void exportFile();
    if (action === 'prev') { state.page--; refresh(); }
    if (action === 'next') { state.page++; refresh(); }
    if (action === 'session') void loadConfig();
  });
  window.addEventListener('beforeunload', e => { if (state.running || state.rows.some(r => r.result)) { e.preventDefault(); e.returnValue = ''; } });
  if (new URLSearchParams(location.search).get('tool') === 'receipt-check') go('receipt-check');
})();
