/* 日常抓取：node fetch.js tmall [YYYY-MM-DD]
   默认抓昨天。用已保存的登录态打开报表页：
   - 店铺配置里写好了 auto 步骤 → 全自动导出并归档；
   - auto 为 null → 半自动：页面打开后人工点“导出”，下载文件自动归档改名。
   归档名：downloads/<店铺名>_<日期>.<原扩展名>，可直接用 T4 对应导入口导入。 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { STORES, PROFILE_DIR, OUT_DIR, BROWSER_CHANNEL } = require('./config');

(async () => {
  const key = process.argv[2] || 'tmall';
  const s = STORES[key];
  if (!s) { console.error(`未知店铺「${key}」，可用：${Object.keys(STORES).join(' / ')}`); process.exit(1); }
  const day = process.argv[3] || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(path.join(PROFILE_DIR, key), {
    channel: BROWSER_CHANNEL, headless: false, viewport: null, acceptDownloads: true,
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  let saved = 0;
  ctx.on('page', p => hook(p));
  hook(page);
  function hook(p) {
    p.on('download', async d => {
      const ext = path.extname(d.suggestedFilename()) || '.csv';
      const file = path.join(OUT_DIR, `${s.name}_${day}${saved ? `_${saved + 1}` : ''}${ext}`);
      await d.saveAs(file);
      saved++;
      console.log('已归档：' + file);
    });
  }

  await page.goto(s.reportUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  if (typeof s.auto === 'function') {
    try {
      await s.auto(page, day);
      console.log('自动导出完成。');
      await page.waitForTimeout(5000);           // 等下载落盘
      await ctx.close();
      process.exit(saved ? 0 : 2);
    } catch (e) {
      console.log('自动导出失败（' + e.message + '），转半自动：请在页面上手动导出，文件会自动归档。');
    }
  } else {
    console.log(`已用保存的登录态打开 ${s.name}。请手动导出 ${day} 的报表，下载会自动归档改名；完成后关闭浏览器。`);
  }
  await new Promise(res => ctx.on('close', res));
  console.log(saved ? `完成，共归档 ${saved} 个文件。` : '浏览器已关闭，本次没有下载文件。');
})();
