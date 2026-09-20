/* Shared workspace saves use field CAS; retries rebase only this page's edits. */
(function () {
  const state = { ready: false, loading: false, saving: false, version: 0, found: false, document: null };
  const clone = x => JSON.parse(JSON.stringify(x == null ? {} : x));
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const unsafe = key => ['__proto__', 'constructor', 'prototype'].includes(key);
  let loading = null;
  function empty() { return { periods: {}, cfg: {}, channels: [] }; }
  function equal(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && equal(a[k], b[k]));
  }
  function at(doc, path) {
    let value = doc;
    for (const key of path) {
      if (unsafe(key) || !object(value) || !own(value, key)) return { exists: false };
      value = value[key];
    }
    return { exists: true, value };
  }
  function matches(a, b) { return a.exists === b.exists && (!a.exists || equal(a.value, b.value)); }
  function diff(before, after, path = [], oldExists = true, newExists = true, out = []) {
    if (oldExists === newExists && equal(before, after)) return out;
    // Recurse through newly added objects so two clients can add different
    // fields to the same new date/month. Existing subtree deletes stay atomic.
    if (object(after) && (!oldExists || object(before))) {
      const keys = new Set([...Object.keys(before || {}), ...Object.keys(after)]);
      for (const key of keys) {
        if (unsafe(key)) throw new Error('不支持的数据字段');
        diff(before && before[key], after[key], path.concat(key), !!before && own(before, key), own(after, key), out);
      }
    } else {
      out.push({ path, oldExists, ...(oldExists ? { old: before } : {}), newExists,
        ...(newExists ? { value: after } : {}) });
    }
    return out;
  }
  function apply(doc, change) {
    let cur = doc;
    for (const key of change.path.slice(0, -1)) {
      if (unsafe(key)) throw new Error('不支持的数据字段');
      if (!object(cur[key])) {
        if (!change.newExists) return;
        cur[key] = {};
      }
      cur = cur[key];
    }
    const key = change.path[change.path.length - 1];
    if (unsafe(key)) throw new Error('不支持的数据字段');
    if (change.newExists) cur[key] = JSON.parse(JSON.stringify(change.value));
    else delete cur[key];
  }
  function reapply(base, local, remote) {
    const merged = clone(remote);
    diff(base, local).forEach(change => apply(merged, change));
    return merged;
  }
  function failure(x, status) {
    const paths = (x.conflicts || []).slice(0, 5).map(c => c.path.join(' / ')).join('；');
    const message = x.error === 'field_conflict'
      ? `以下字段已被其他人修改：${paths}。本次输入已保留，请核对后再保存`
      : x.error === 'version_conflict' ? '共享数据正在更新，本次输入已保留，请稍后重试'
      : x.error === 'period_locked' ? `${(x.periods || []).join('、')} 已锁定，本次输入已保留`
      // 服务端按路径校验拒收时只回一句英文，用户看不出该改什么。
      : x.error === 'invalid change path' ? '数据结构不被共享存储接受（多为期间月份无效或本地遗留了无效的月份锁定）。本次输入已保留；请确认月份在 2000-01 至 2099-12 之间后重试'
      : status === 401 ? '未完成门户登录' : x.error || `保存失败 (${status})`;
    const e = new Error(message); e.status = status; e.code = x.error; e.response = x; return e;
  }
  async function read() {
    const r = await fetch('/api/t4/workspace', { cache: 'no-store' });
    if (!r.ok) throw failure(await r.json().catch(() => ({})), r.status);
    return r.json();
  }
  function accept(x) {
    state.version = Number(x.version) || 0; state.found = x.found !== false;
    state.document = clone(x.document || empty()); state.ready = true;
    return x;
  }
  function load(force = false) {
    if (loading) return loading;
    if (state.ready && !force) return Promise.resolve(state);
    state.loading = true;
    loading = read().then(x => { accept(x); return state; }).finally(() => { state.loading = false; loading = null; });
    return loading;
  }
  function rebase(original, viewBaseline, candidate, latest, edits) {
    const conflicts = [];
    for (const change of edits) {
      const current = at(latest.document, change.path);
      const desired = { exists: change.newExists, value: change.value };
      let ancestorConflict = false;
      if (change.newExists) {
        for (let i = 1; i < change.path.length; i++) {
          const old = at(original, change.path.slice(0, i)), now = at(latest.document, change.path.slice(0, i));
          if ((old.exists && !now.exists) || (now.exists && !object(now.value))) ancestorConflict = true;
        }
      }
      if (ancestorConflict || (!matches(current, at(original, change.path)) &&
          !matches(current, at(viewBaseline, change.path)) && !matches(current, desired))) {
        conflicts.push({ path: change.path, currentExists: current.exists, current: current.value });
      }
    }
    if (conflicts.length) throw failure({ error: 'field_conflict', version: latest.version, conflicts }, 409);
    // Start with this page's materialized defaults, apply every remote change,
    // then restore only the user's edits. Defaults must not overwrite others.
    const merged = reapply(original, latest.document, candidate);
    edits.forEach(change => apply(merged, change));
    return merged;
  }
  async function save(document, user, viewBaseline) {
    if (state.saving) throw new Error('正在同步，请稍后再操作');
    state.saving = true;
    const candidate = clone(document), baseline = viewBaseline && clone(viewBaseline);
    try {
      if (!state.ready) await load();
      const original = clone(state.document), view = baseline || original;
      const edits = diff(view, candidate);
      if (!edits.length) return accept(await read());
      let latest = { version: state.version, document: original }, next = candidate;
      for (let attempt = 0; attempt < 3; attempt++) {
        const changes = diff(latest.document, next);
        if (!changes.length) return accept(latest);
        const r = await fetch('/api/t4/workspace', { method: 'PUT', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'X-T4-User': user || 'portal-user' },
          body: JSON.stringify({ baseVersion: latest.version, changes }) });
        const x = await r.json().catch(() => ({}));
        if (r.ok) return accept(x);
        if (!['field_conflict', 'version_conflict'].includes(x.error)) throw failure(x, r.status);
        // A failed conflict must leave the acknowledged snapshot untouched.
        // Repeated clicks cannot silently turn stale edits into an overwrite.
        latest = await read();
        next = rebase(original, view, candidate, latest, edits);
      }
      throw failure({ error: 'version_conflict' }, 409);
    } finally { state.saving = false; }
  }
  window.T4Shared = { state, empty, clone, load, save, reapply };
})();
