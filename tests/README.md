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

同一页面调用 `go(id)` 默认保留操作位置；打开新的编辑对象或切换向导步骤时，使用 `go(id, { resetScroll: true })`。不同页面之间的导航默认回到顶部。
