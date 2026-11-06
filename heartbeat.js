/* 门户应用日报「使用时长」心跳
   页面在前台、且 5 分钟内动过鼠标或键盘时，每分钟向本站 /api/hb 报一次「还在用」；切走、锁屏、挂着不动都不报。
   是谁由服务端从门户会话取，这里什么都不带；未登录（401）就停。上报失败一律静默，不影响业务。 */
'use strict';
(function () {
  const IDLE_MS = 5 * 60 * 1000;
  let last = Date.now(), timer = null;
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach(e =>
    window.addEventListener(e, () => { last = Date.now(); }, { passive: true, capture: true }));
  function beat() {
    if (document.visibilityState !== 'visible' || Date.now() - last > IDLE_MS) return;
    fetch('/api/hb', { method: 'POST', keepalive: true, credentials: 'same-origin' })
      .then(r => { if (r.status === 401 && timer) { clearInterval(timer); timer = null; } })
      .catch(() => {});
  }
  timer = setInterval(beat, 60 * 1000);
  beat();
})();
