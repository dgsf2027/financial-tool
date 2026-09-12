/* 首次登录：node login.js tmall
   打开真实浏览器让你扫码；登录成功后直接关掉浏览器窗口，登录态自动保存到 _profiles/。 */
const { chromium } = require('playwright-core');
const path = require('path');
const { STORES, PROFILE_DIR, BROWSER_CHANNEL } = require('./config');

(async () => {
  const key = process.argv[2] || 'tmall';
  const s = STORES[key];
  if (!s) { console.error(`未知店铺「${key}」，可用：${Object.keys(STORES).join(' / ')}`); process.exit(1); }
  const ctx = await chromium.launchPersistentContext(path.join(PROFILE_DIR, key), {
    channel: BROWSER_CHANNEL, headless: false, viewport: null,
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(s.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log(`已打开 ${s.name} 登录页，请扫码登录。登录完成后关闭浏览器窗口即可，登录态会保存。`);
  await new Promise(res => ctx.on('close', res));
  console.log('浏览器已关闭，登录态已保存。之后运行 node fetch.js ' + key + ' 抓取数据。');
})();
