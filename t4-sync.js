/* T4 shared workspace client.  It is intentionally tiny and framework-free so
   the existing static app can adopt server storage without a second build. */
(function () {
  const state = { ready: false, loading: false, version: 0, document: null };
  const clone = x => JSON.parse(JSON.stringify(x == null ? {} : x));
  function empty() { return { periods: {}, cfg: {}, channels: [] }; }
  async function load() {
    if (state.loading || state.ready) return state;
    state.loading = true;
    try {
      const r = await fetch('/api/t4/workspace', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 401 ? '未完成门户登录' : `服务端 ${r.status}`);
      const x = await r.json(); state.version = Number(x.version) || 0;
      state.document = x.document && typeof x.document === 'object' ? x.document : empty();
      state.ready = true; return state;
    } finally { state.loading = false; }
  }
  async function save(document, user) {
    if (!state.ready) await load();
    const r = await fetch('/api/t4/workspace', { method: 'PUT', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-T4-User': user || 'portal-user' },
      body: JSON.stringify({ baseVersion: state.version, document }) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(x.error || `保存失败 (${r.status})`); e.response = x; throw e; }
    state.version = Number(x.version) || state.version + 1; state.document = clone(document); return x;
  }
  window.T4Shared = { state, empty, clone, load, save };
})();
