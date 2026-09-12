/* 推广数据抓取 · 店铺配置
   每个店铺一条：loginUrl 用于首次扫码登录，reportUrl 是日常打开的报表页。
   auto 是全自动导出步骤（按实际页面结构补写）；为 null 时进入“半自动”模式——
   脚本打开页面并保持登录态，人工点一下“导出”，下载的文件会被自动归档改名。 */
const path = require('path');

module.exports = {
  PROFILE_DIR: path.join(__dirname, '_profiles'),   // 各店铺登录态（仅存本机，已被 .gitignore 排除）
  OUT_DIR: path.join(__dirname, 'downloads'),       // 归档目录：<店铺名>_<日期>.csv，可直接用 T4 导入
  BROWSER_CHANNEL: 'msedge',                        // 本机用 Edge；装了 Chrome 可改 'chrome'

  STORES: {
    tmall: {
      name: '天猫直通车',
      loginUrl: 'https://one.alimama.com/',         // 万相台无界（阿里妈妈），扫码登录
      reportUrl: 'https://one.alimama.com/',        // 登录后我会按实际报表页地址与结构补全 auto
      auto: null,
    },
    // 后续按同样格式扩展，例如：
    // jd:  { name: '京准通', loginUrl: 'https://jzt.jd.com/', reportUrl: '...', auto: null },
    // pdd: { name: '拼多多推广', loginUrl: 'https://yingxiao.pinduoduo.com/', reportUrl: '...', auto: null },
  },
};
