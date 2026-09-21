# 财务中心审查问题修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审查中确认的财务数据完整性、导入解析、导出一致性、邮件结果和 T4 渠道列表问题，并以回归测试证明修复。

**Architecture:** 保留现有浏览器端工具和 T4 共享工作区边界。修复优先放在产生错误数据的源头：解析器返回可判断的合法性，导入流程显式处理状态与歧义，服务端返回完整逐收件人结果；不进行无关重构或整体迁移到服务端。

**Tech Stack:** 原生 JavaScript、Node `node:test`、Playwright 浏览器测试、Python `unittest`、Node HTTP 服务、SQLite T4 同步服务。

**Spec:** `docs/superpowers/specs/2026-09-21-finance-review-fixes-design.md`

## Global Constraints

- 所有修复先添加能够复现原问题的自动化测试，再修改生产代码。
- 不把 T1/T2/T3/核算模块的浏览器 `localStorage` 整体迁移到服务端。
- 不改变 T4 当前共享工作区、锁账和字段 CAS 的数据模型。
- 不更改税务、折旧或往来业务口径；只修复数据完整性、状态处理和导出一致性。
- 最终提交不包含用户已有的 `tests/t4-sync.test.js` 未提交改动。

## Review Focus

- 同日倒序银行流水：必须不取错期末余额，也不能在顺序不明时自动回写；由 Task 1 测试锁定。
- 合法 0、括号负数、公式错误和空单元格：必须被区分；由 Task 1 测试锁定。
- 同号发票状态变化与超核应付：必须更新/暴露真实差异；由 Task 2 测试锁定。
- 同名员工、已计提固定资产和临时文件并发：必须避免覆盖历史数据；由 Task 2/3 测试锁定。
- 部分渠道清单和标题行 TSV：必须保留可见数据并正确识别；由 Task 4/1 测试锁定。

---

### Task 1: T1/T2/T3 与通用表格解析

**Files:**
- Modify: `app.js:538-585,987-1114`（T2 数值/日期/账号匹配/期末余额）
- Modify: `t1.js:131-145,210-220,442-450,1100-1152`（保存状态和不唯一账号）
- Modify: `t3.js:55-118,122-129,336-343`（可解析金额与模板保存反馈）
- Modify: `lib/xlsx-lite.js:216-313,334-375`（日期、工作表顺序、CSV 分隔符）
- Test: `tests/t1-t2-t3-review.test.js`

**Interfaces:**
- 解析金额函数继续被 T2/T3/T1 共用，但必须返回或配套提供 `valid` 判断，合法数字 0 不得被判为空。
- `t1FindAccByNo` 在候选超过一个时返回候选集合/明确歧义状态；T2 自动绑定遇到歧义必须不写余额。
- `t2ClosingBal` 返回 `{date,val,asc}` 或 `{ambiguous:true}`，调用方据此显示提示。

- [ ] **Step 1: 写失败测试**
  - 测试 T2 两行同日倒序余额返回最新时间行；同日没有时间可比较时返回歧义。
  - 测试 T2 账号前后四位命中多个账户时不自动绑定。
  - 测试 T3 `(100)` 解析为 `-100`，`#VALUE!`/空串进入差异或例外，不再成为 0。
  - 测试 `标题\n日期\t摘要\t金额` 的 TSV 仍拆成 3 列；工作簿重排页签按 workbook 顺序读取。
  - 测试 T1 保存函数失败时返回 `false`，事件处理不弹成功提示。
- [ ] **Step 2: 运行新增测试确认 RED**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules node --test tests/t1-t2-t3-review.test.js`
  - Expected: new regression assertions fail against current implementation。
- [ ] **Step 3: 最小实现**
  - 用日期时间解析判断排序；同日顺序不明时禁止自动回写。
  - 账号候选不唯一时返回歧义；保留人工选择路径。
  - 金额解析保留合法 0，识别括号负数，非法文本携带 `valid:false`。
  - CSV 根据前若干非空行的分隔列数投票；XLSX 读取 workbook relationships 的 sheet 顺序。
  - 保存函数返回布尔值，调用方根据结果提示。
- [ ] **Step 4: 运行新增测试确认 GREEN**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules node --test tests/t1-t2-t3-review.test.js`
  - Expected: all tests pass。
- [ ] **Step 5: 运行相关既有测试**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules PLAYWRIGHT_CHANNEL=chromium node --test tests/form-interaction.browser.test.js tests/t4-channel-import.test.js`
  - Expected: 0 failures。
- [ ] **Step 6: 提交**
  - Run: `git add app.js t1.js t3.js lib/xlsx-lite.js tests/t1-t2-t3-review.test.js && git commit -m "fix: harden finance imports and balance detection"`

### Task 2: 发票、往来、固定资产、工资和报表导出

**Files:**
- Modify: `inv.js:79-99`（同号状态更新）
- Modify: `rec.js:617-621`（超核导出）
- Modify: `fa.js:43-91,169-188`（已计提资产编辑保护）
- Modify: `pay.js:66-95`（身份证优先和同名处理）
- Modify: `rpt.js:392-400`（利润表导出重复行）
- Test: `tests/finance-review-modules.test.js`

**Interfaces:**
- 发票同号更新保留原记录标识，状态为作废的同号记录不进入当前池汇总。
- 固定资产编辑保存遇到已有折旧凭证时返回并提示，不改变原卡片。
- 工资导入以身份证号作为稳定身份；同名不同身份证建为不同员工，并保持工资分录分别归属。

- [ ] **Step 1: 写失败测试**
  - 正常票后导入同号作废票，断言旧记录被标记/移除且月度汇总不再包含。
  - 应付原币余额 100、核销 120，断言导出未结算金额为 `-20.00`。
  - 已生成折旧凭证的卡片尝试修改原值，断言保存失败且卡片不变。
  - 两名同名不同身份证员工导入，断言产生两条员工与两笔工资。
  - 利润表导出断言“税金及附加”只出现一次。
- [ ] **Step 2: 运行新增测试确认 RED**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules node --test tests/finance-review-modules.test.js`
  - Expected: regression assertions fail。
- [ ] **Step 3: 最小实现**
  - 先按号码定位，再合并状态/金额字段；作废状态从池中剔除。
  - 导出使用实际未结算值，不用 `Math.max(0, ...)`。
  - 编辑前检查凭证库中该资产/月的计提记录，存在历史凭证则阻断并说明。
  - 工资导入建立身份证索引，姓名只在无证件且唯一时使用。
  - 删除利润表导出数组中的重复行。
- [ ] **Step 4: 运行新增测试确认 GREEN**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules node --test tests/finance-review-modules.test.js`
  - Expected: all tests pass。
- [ ] **Step 5: 运行相关既有测试**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules node --test tests/*.test.js`
  - Expected: 0 failures。
- [ ] **Step 6: 提交**
  - Run: `git add inv.js rec.js fa.js pay.js rpt.js tests/finance-review-modules.test.js && git commit -m "fix: preserve finance module reconciliation data"`

### Task 3: T4 服务端邮件和临时文件并发安全

**Files:**
- Modify: `server.js:142-164,214-237`（唯一临时文件名、scope 校验、完整结果）
- Modify: `suite/send_mail.py:45-64`（SMTP 拒收结果）
- Test: `tests/server-mail-review.test.js`, `tests/test_server_mail_review.py`

**Interfaces:**
- 未知 scope 的邮件请求返回 400，响应中列出未发送收件人。
- 每个请求的临时输入/输出/job 文件名独立，不依赖毫秒时间戳唯一性。
- Python 结果中的 `ok` 只有在 `send_message()` 没有拒收地址时才为真；拒收字典转换成错误信息。

- [ ] **Step 1: 写失败测试**
  - POST 收件人 scope 不存在，断言 400 且不会生成/执行邮件任务。
  - 模拟 SMTP 返回拒收字典，断言对应收件人 `ok:false`。
  - 固定时间戳并行调用构建/邮件任务，断言请求文件不互相覆盖。
- [ ] **Step 2: 运行新增测试确认 RED**
  - Run: `node --test tests/server-mail-review.test.js && python3 -m unittest tests.test_server_mail_review`
  - Expected: regression assertions fail。
- [ ] **Step 3: 最小实现**
  - 临时文件名使用 `crypto.randomUUID()` 后缀，并在 finally 清理输出文件。
  - 预先计算未知 scope，返回明确错误；只对已验证 scope 建任务。
  - 检查 `send_message` 返回映射，拒收地址计为失败。
- [ ] **Step 4: 运行新增测试确认 GREEN**
  - Run: `node --test tests/server-mail-review.test.js && python3 -m unittest tests.test_server_mail_review`
  - Expected: all tests pass。
- [ ] **Step 5: 运行相关既有测试**
  - Run: `node --test tests/server-security.test.js tests/t4-sync.test.js && python3 -m unittest discover -s tests -p 'test_*.py'`
  - Expected: 0 failures。
- [ ] **Step 6: 提交**
  - Run: `git add server.js suite/send_mail.py tests/server-mail-review.test.js tests/test_server_mail_review.py && git commit -m "fix: make T4 mail results and jobs reliable"`

### Task 4: T4 渠道列表部分导入可见性

**Files:**
- Modify: `t4.js:1179-1186`（基础渠道行保留）
- Test: `tests/t4-channel-import.test.js`

**Interfaces:**
- 一旦存在 imported details，仍为无明细的基础渠道生成可见占位行；其 target/source 使用归集渠道名称，fields 为空。
- 已导入销售渠道的明细与附加字段继续优先显示，不能改变已有映射和财务数据。

- [ ] **Step 1: 写失败测试**
  - 先导入一条销售渠道，再断言 `t4ChSourceRows()` 同时包含该条和未导入的基础渠道。
- [ ] **Step 2: 运行新增测试确认 RED**
  - Run: `node --test tests/t4-channel-import.test.js`
  - Expected: new partial-import assertion fails。
- [ ] **Step 3: 最小实现**
  - 调整 source rows fallback，不因全局 imported 标志而丢弃基础渠道；避免重复 source。
- [ ] **Step 4: 运行测试确认 GREEN**
  - Run: `node --test tests/t4-channel-import.test.js`
  - Expected: all tests pass。
- [ ] **Step 5: 提交**
  - Run: `git add t4.js tests/t4-channel-import.test.js && git commit -m "fix: keep base channels visible after partial import"`

### Task 5: 集成验证、线上部署与复测

**Files:**
- Modify: none unless a final review finding requires a focused fix.
- Test: all existing and new tests.

- [ ] **Step 1: 检查所有任务提交与用户改动边界**
  - Run: `git status --short --branch` and `git diff -- tests/t4-sync.test.js`。
  - Expected: user-owned test remains unstaged/uncommitted; only task commits contain fixes。
- [ ] **Step 2: 运行完整 JavaScript/浏览器套件**
  - Run: `NODE_PATH=/Users/aole/.npm/_npx/e41f203b7505f1fb/node_modules PLAYWRIGHT_CHANNEL=chromium node --test tests/*.test.js`。
- [ ] **Step 3: 运行完整 Python 套件**
  - Run: `python3 -m unittest discover -s tests -p 'test_*.py'`。
- [ ] **Step 4: 做最终代码审查**
  - 检查金额、日期、状态、结果计数和错误提示是否与规格一致。
- [ ] **Step 5: 提交并推送本次修复**
  - 只 stage 本次修复文件，保留 `tests/t4-sync.test.js`；推送当前部署跟踪分支。
- [ ] **Step 6: 按服务器参考执行部署**
  - 部署前重新核对远端和服务器 HEAD；部署后验证 `/healthz`、T4 工作区读取、渠道列表导入错误提示、未知邮件 scope 拒绝。
- [ ] **Step 7: 输出提交版本、测试结果和线上验证结果**

