# 测试

现有逻辑、同步及安全测试使用 Node 内置测试运行器：

```sh
node --test tests/*.test.js
```

`form-interaction.browser.test.js` 使用真实 Chromium 验证表单交互：T4 参数保存与增删规则、页面和表格滚动、焦点与选区、Tab 连续填写、按住后松开的导航点击，以及打开编辑表单。

浏览器测试需要 Playwright。可使用已有安装（通过 `NODE_PATH` 指向其 `node_modules`），或在本地安装测试依赖；应用运行仍不依赖第三方包：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium --only-shell
node --test tests/form-interaction.browser.test.js
```

未提供 Playwright 时，浏览器测试会明确标记为跳过。测试使用临时本地静态服务器、独立浏览器会话和模拟共享 API，不访问线上数据。

`login-channel.browser.test.js` 另行启动真实 Node 网关和 Python 数据服务（代理鉴权模式），使用临时 SQLite 数据库与两个独立浏览器上下文，验证登录回调后 xlsx 导入对另一同事可见。只有门户的授权码回验为测试替身，不使用生产账号或数据。运行两套浏览器测试：

```sh
node --test tests/*.browser.test.js
```

如已安装完整 Chromium 而非 Headless Shell，可设置 `PLAYWRIGHT_CHANNEL=chromium` 使用该浏览器。

同一页面调用 `go(id)` 默认保留操作位置；打开新的编辑对象或切换向导步骤时，使用 `go(id, { resetScroll: true })`。不同页面之间的导航默认回到顶部。

T4 渠道导入回归覆盖：表头和列顺序变化、横向清单、多工作表、新增渠道去重、附加字段页签、模板回导，以及共享保存后另一客户端读取。浏览器用真实 xlsx 上传检查桌面和手机端；测试数据仅进入模拟共享 API。

部署后可设置 `FINANCE_BROWSER_BASE_URL=https://finance.vvaix.com` 复用浏览器测试，验证线上静态资源；工作区 API 仍由测试拦截，不会写入线上财务数据。

`t4-source-roster.test.js` 覆盖销售门店独立编辑、改名链与归集迁移、下载重导、别名可见、基础行去重和多人保存冲突。`t4-channel-roster.browser.test.js` 验证实际 xlsx 上传、默认名单、刷新与另一客户端读取、单店编辑、新增及失败时保留输入。

可用 `FINANCE_CHANNEL_ROSTER_XLSX` 指定真实渠道表、`FINANCE_CHANNEL_METADATA` 指定只含渠道配置的核查 JSON，运行对应浏览器验收；这两类业务样本不纳入仓库。未提供样本时会明确跳过真实文件用例，通用工作簿用例仍运行。
