# workbuddy.md — MealScript 真实开发记录

> 本文件用于 WorkBuddy 专项奖励核验。内容为**真实发生的开发过程**，未作任何虚构或美化。
> 开发全程由腾讯 WorkBuddy 在本机工作区 `G:\麦当劳\mealscript` 执行。

---

## 阶段：D1–D6 / 日期（北京时间）：2026-10-15 21:22 – 22:30

### 本阶段目标

读完《MealScript 麦门编译器｜WorkBuddy 项目开发任务书》，确认开工参数，然后一路做到
Playground 端到端可演示（任务书 D1–D6）。

### 开工前确认的四项参数（用户拍板）

1. 项目落地 `G:/麦当劳/mealscript/`
2. Live MCP 走「项目自身读 `.env` 的 `MCD_MCP_TOKEN` 直连 `mcp.mcd.cn`」，开发期复用 WorkBuddy 已连的 mcd-mcp 连接器做 schema 发现与真实取证
3. Parser 由我决定 → 选 **Chevrotain**（理由：手写式 API 能给出最精确的行列级诊断，「可解释失败」是本作品的核心卖点；Peggy 需要额外包装才能达到同等效果）
4. 本轮范围 **D1–D6 一路做到 Playground 端到端**

### 完成的文件（相对路径）

```
package.json                                   根工作区（npm workspaces）
tsconfig.base.json / tsconfig.json              TypeScript 配置（strict + noUncheckedIndexedAccess）
vitest.config.ts                                测试配置（含 workspace 别名）
.gitignore                                      .env / node_modules / dist 等，防 Token 泄露
.env.example / mcp-config.example.json          只有占位符，无真实凭据
LICENSE                                         MIT + 第三方声明
packages/compiler/src/{tokens,parser,ast,semantic,ir,location,diagnostics,cli}.ts
packages/mcp-adapter/src/{types,client,fixture,normalizer}.ts + schema-snapshot.json
packages/optimizer/src/{index,ir}.ts
packages/verifier/src/{index,pipeline}.ts
packages/trace/src/{types,recorder,redact}.ts
apps/playground/                                Next.js 14 + Tailwind + Monaco
  app/{layout,page,globals.css}  app/api/build/route.ts
  components/{MealEditor,StageRail,ResultCard,TracePanel}.tsx  lib/examples.ts
examples/{budget,invalid-syntax,invalid-semantic}.meal
fixtures/{replay-success,replay-failure}.json
tests/{compiler,optimizer,verifier,trace,pipeline}.test.ts
README.md / MCP_INTEGRATION.md / CONTEST_DECLARATION.md
```

### 本机运行 / 测试命令

```bash
npm install
npm run compile:cli examples/budget.meal     # 不依赖任何凭据
npm test                                     # vitest run
npm run dev                                  # 启动 Playground
```

### 测试结果：通过 75 / 失败 0 / 跳过 0

```
✓ tests/compiler.test.ts  (32 tests)
✓ tests/optimizer.test.ts (14 tests)
✓ tests/trace.test.ts     (12 tests)
✓ tests/verifier.test.ts  ( 7 tests)
✓ tests/pipeline.test.ts  (10 tests)
Test Files  5 passed (5)      Tests  75 passed (75)
```

编译器 CLI 实测输出（真实执行，未编辑）：

```
$ npm run compile:cli examples/budget.meal
BUILD_PASSED (front half — no MCP call was made)
{ "name": "lunch", "location": { "raw": "北京市海淀区五道口", "city": "北京市", "keyword": "海淀区五道口" },
  "mode": "pickup", "budget": { "amountCny": 35 }, "requireKeywords": ["汉堡"],
  "excludeKeywords": ["咖啡"], "minItems": 1, "maxItems": 2, "allowRepeat": false,
  "optimize": { "fn": "min", "target": "total_price" }, "execution": "dry_run" }

$ npm run compile:cli examples/invalid-semantic.meal
COMPILATION_ERROR
  E102  5: 9  SemanticConstraintError — v0.1 仅支持到店自取（pickup），当前取餐模式为 delivery
      ↳ 改为 mode: pickup;
  E101  6:11  SemanticConstraintError — 预算必须为正数，当前为 -10
      ↳ 把预算改成正数，例如 budget: <= 35 CNY;
```

### 真实 MCP 调用记录（已脱敏）

北京时间 2026-10-15 21:25–22:00，全部为**只读**调用：

| 时间 | 工具 | 结果 |
|---|---|---|
| 21:25:42 | `now-time-info` | 成功，服务器时间 2026-10-15 21:25:42 GMT+8 → 连通性确认 |
| 21:59:28 | `query-nearby-stores` | 成功，5 家门店，取 `1950556 麦当劳北京五道口优盛餐厅` |
| 21:59:36 | `query-meals` | 成功，14 个分类、约 120 个可售商品 |
| 21:59:53 | `query-meal-detail` | 成功，`code=1440` 麦辣鸡腿汉堡 |
| 22:00:04 | `calculate-price` | 成功，`price=2250`（分）= ¥22.50 |
| 22:00:14 | `calculate-price` | 成功，双商品 `price=2750`（分）= ¥27.50 |

**两个必须写进代码的真实发现：**

1. `calculate-price` 所有金额单位是**分**，必须除 100。
2. `query-nearby-stores` 没有 `location` 参数，只接受 `city` + `keyword` → DSL 的 `location` 必须在编译器内拆分。

### 已知阻塞

1. **包管理器降级**：任务书指定 pnpm，本机 pnpm 12 无法创建目录 junction，导致 `node_modules` 链接不完整（`next`、`react` 等未落地，`next dev` 报 MODULE_NOT_FOUND）。改用 **npm workspaces** 后恢复正常。已在 README「与官方标准的偏差说明」中如实记录。
2. **`CONTEST_DECLARATION.md`** 已按官方原文逐字复制（从官方仓库获取），参赛前请再核对一次官方仓库是否有更新版本。
3. **GitHub 远端仓库尚未创建**：本机 `git` 未配置 `user.name/email`，未安装 `gh`。建公开仓库与推送需用户完成。

### 安全 / 合规检查

- [x] Token 只存在于本地 `.env`（已 gitignore），未写入任何源码、fixture、日志或文档
- [x] `mcp-config.example.json` 只有 `${MCD_MCP_TOKEN}` 占位符
- [x] 适配器硬编码黑名单，拒绝 `create-order` 等全部写操作；本次开发**一次都没有调用**
- [x] trace 写入前强制 `redact()`：Token / 手机号 / 地址 / 账号 / 订单号 / 长 ID 全部脱敏或打码
- [x] fixture 已剔除门店地址、距离、经纬度、`traceId`
- [x] 商品图片（品牌素材）未复制进仓库
- [x] Replay 结果状态固定为 `REPLAY_RESULT`，永远不会显示成 `BUILD_PASSED`
- [x] 界面明确标注「非麦当劳官方产品 / 独立参赛作品」
- [x] 未调用官方未授权的能力，未做竞品贬损对比

### 下阶段计划（D7–D10）

- D7：Trace 打磨、营养/优惠可行性探索、报告卡
- D8：Vitest / Playwright 补全、脱敏与安全扫描复核
- D9：README 定稿、录制 90 秒演示视频、准备报名 Issue（**必须用户确认后才提交**）
- D10：修复与社区展示

### 需要用户介入事项

1. 创建 GitHub 公开仓库（`mealscript`），并配置本机 git 身份或授权我提交
2. 报名 Issue 与任何公开推送，**我只出草稿，等你确认后才发**
3. 如需 Live 演示，确认 `.env` 中的 Token 已就绪
