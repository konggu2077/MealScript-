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

---

## 阶段：D7–D10 及后续迭代 / 2026-10-15 23:09 – 2026-10-21 21:30

> 上一节之后没有按天续写记录，这里按 **git 提交原文** 补齐。
> 下表每条都能在本仓库 `git log` 里逐字核对，未作美化。

### 一句话概括

D1–D6 交付的是「能跑通的 v0.1」；这一段是把它打磨到「敢让评审真去点」——
修掉 7 个真实缺陷、新增 3 项能力、测试从 75 涨到 130、并部署成可公开访问的网址。

### 提交时间线（真实 git 记录）

| 时间（北京时间） | commit | 内容 |
|---|---|---|
| 10-15 23:09–23:20 | `1424fdf` `1152a7b` `3f06055` | 完整 v0.1 入库，GitHub 远端建立 |
| 10-16 00:29 | `f82328e` | README 落地页化：banner、界面还原图、Demo 入口 |
| 10-16 00:41–01:51 | `71530ed` `f5b2a90` `81fc280` | 按 `ui-preview.svg` 重做单文件版视觉、统一两版风格、UI 冒烟测试 |
| 10-16 11:12 | `d09334d` | 编辑器自动补全；关键词按麦当劳真实分类匹配 |
| 10-16 12:09 | `d57cdc8` | 与 GitHub 初始化提交合流 |
| 10-16 20:07 | `7d71332` | **修复**：候选池被错误限制在关键词命中项；结果总是同几个方案 |
| 10-16 20:30 | `6f4f7a3` | 目录录制脚本（可刷新 fixture）；location 真实地点补全 |
| 10-16 20:47 | `8476682` | **修复**：高亮层字体导致光标错位 |
| 10-16 21:48 | `62bc5b6` | `require_keyword` 支持多关键词（AND 语义） |
| 10-17 00:12 | `bc68fcd` | `build/record-fixture.ts` 纳入版本控制 |
| 10-20 23:08 | `5ca071e` | **修复**：排序键统一、枚举上限不再影响答案、超时真正生效 |
| 10-21 20:53 | `5142499` | 官方折扣透传；`allow_repeat` 同款多份 |
| 10-21 21:11 | `0d106fc` | 抽出 `packages/content`，消掉两套 UI 的数据重复 |
| 10-21 21:2x | —（推送 + 部署） | 推 origin/main，手动触发 Pages 重构，线上产物 sha256 与本地一致 |

### 7 个被修掉的真实缺陷（都不是「改改样式」，而是会给出错误答案的那种）

1. **候选池被限制在关键词命中项内** —— 要「汉堡」时，池里只剩汉堡，`min_items: 2` 的任何请求都无解。
   正确语义是：关键词决定「必须有」，不是「只能用」。改为在完整允许集上枚举，再筛「至少命中一次」。
2. **结果总是同几个方案** —— `min(total_price)` 单独用会返回三个只差「哪个 ¥5 甜品填空」的套餐，
   数学正确但无可选性。新增 `pickDiverse()`：按「件数 + 命中商品集合」去重。
3. **枚举上限会改变答案** —— 原实现「先到先得」填满即停；但按价格排序后字典序并不单调，
   （0,1,60）先于（0,2,3）被访问却更贵。改为 **定容最大堆**，始终保留最便宜的 N 个。
4. **超时参数被静默忽略** —— `timeoutMs` 收下了却没用，上游卡死时整条流水线永久挂起。
   改为 `connect + callTool` 整体超时，错误码 `E408`（原来误报 `E429` 限流）。
5. **光标错位** —— `<code>` 高亮层回落到 UA 样式表的 `monospace`，与 textarea 的字体栈不一致，
   字形宽度差导致光标偏移。显式 `font: inherit` 后偏差收敛到 ≤0.063px。
6. **`require_keyword` 写两个就跑不了** —— 早期只接受单个字符串，第二个关键词直接语法错。
   现支持 `["A","B"]` 与 `"A, B"` 两种写法，语义明确为 AND（每个关键词各占一件）。
7. **官方折扣被丢弃** —— `normalizePrice` 早就解析出原价与优惠，但全项目零消费，用户只看到实付价。

### 新增能力

- **`allow_repeat`**（默认 `false`）：允许同款多份。默认关闭是有意的——`min(total_price)` 下
  一旦允许重复，任何两件套餐都会退化成「最便宜那件 ×2」。打开后枚举由 `i<j<k` 改为 `i<=j<=k`，
  结果按件合并并显示 `×N`。
- **折扣透传**：结果区在 `discountCny > 0` 时显示「原价 ¥X 已省 ¥Y」，无折扣不渲染。
- **`packages/content`**：示例/地点/阶段名此前单文件版与 Playground 各写一份（10 条 vs 7 条，
  id 与文案都不同）。抽成无依赖叶子包，两套 UI 同源。

### 本机验证结果（真实执行）

```
npm test            → Test Files 7 passed (7)   Tests 130 passed (130)
tsc --noEmit        → 根工作区与 playground 两处均 0 error
next build          → 成功
node build/single.mjs → dist/mealscript.html  280,237 字节，外链 0
```

线上：`https://konggu2077.github.io/MealScript-/dist/mealscript.html`
部署校验方式不是「看起来对」，而是把线上产物 `curl` 下来与本地比 **sha256**——
两边 `2caca3b4…a01f8db4` 完全一致，才认为生效。

### 上一节「已知阻塞」的当前状态

1. ~~包管理器降级（pnpm → npm workspaces）~~ —— 已稳定，README 有偏差说明。
2. `CONTEST_DECLARATION.md` —— 仍建议参赛前对照官方仓库再核一次。
3. ~~GitHub 远端仓库尚未创建~~ —— **已解决**：仓库与 Pages 均已上线。

### 仍未完成 / 已知边界（如实记录）

- **`max_items` 硬上限 3**（`MAX_ITEMS_LIMIT = 3`）：4 件及以上的套餐会直接被编译器拒绝。
  放开需要更好的搜索策略（剪枝或 DP），不是改一个常量的事。
- **`optimize` 仅支持 `min(total_price)`**：`max` 与按营养/热量优化都没有实现。
- **`mode: delivery` 被语义检查拒绝（E102）**：v0.1 只做到店自取，尽管官方 MCP 有 `delivery-query-stores`。
- **单文件版是纯 Replay**：不带凭据，`location` 不会真换门店（页面与 trace 都如实标注）。
- **CI 未入库**：`.github/workflows/ci.yml` 已在本地写好，但推送用的 PAT 只有 `repo` scope，
  缺 `workflow` scope 会导致整条 push 被拒，因此该文件暂留工作区。

---

## 阶段：件数放开到 5 件 + `max(total_price)` + 真实截图 / 2026-10-23

### 本轮目标与范围（用户拍板）

用户要求「优化一个新版」，并在四个候选里选定三项，件数上限指定为 **5 件**：

1. 放开套餐件数上限（3 → 5）
2. `optimize` 支持 `max(total_price)`
3. 补真实界面截图

第 4 项（CI 入库 + 补 mcp-client 测试）本轮不做，因为 CI 需要带 `workflow` scope 的 token 才能推。

### 先做体检，再动手

动手前先跑了一遍现状，结论都来自实测而非印象：

- 全仓 **无 TODO / FIXME**；`dist/mealscript.html` 里那堆 `https://` 全是 Chevrotain 错误文案里的字符串，
  **不是资源外链**，产物仍然是零外链（一度容易误判成「页面在偷偷联网」）。
- 写了个探针直接量枚举规模，证实 `max_items: 4/5` 时 `enumerated` 恒等于 3 件的结果（2093），
  即 **4、5 件根本没进搜索**，被 `Math.min(requestedMax, 3)` 静默钳掉了。
- 菜单实测：61 个可售商品，价格 ¥5–¥37，5 件组合裸算 C(61,5) ≈ 540 万。

### 技术方案：三层嵌套 → 通用 DFS + 三类剪枝

原来是三段写死的 `for` 循环，件数一变就得再加一层，且循环里混着三种语义（枚举、去重、保留）。
改成递归 DFS，并按优化方向分两条路径：

- **`min` 走升序索引**（`i<j<k…`），累计价超预算就 `break` —— 因为池升序，后面只会更贵，这个 `break` 是**精确**的。
- **`max` 走降序索引**，此时不能 `break`（越往后越便宜，可能还有戏），改为 `continue` + 分支定界。

三类剪枝：

1. **预算剪枝**（`min` 专用，精确）：上面那条 `break`。
2. **下界剪枝**（两个方向都有）：剩下几个名额就算全填**最便宜**的商品也要超预算，则整枝丢弃。
   用前缀和 O(1) 判断，在浅层就能砍掉大片子树。
3. **分支定界**（`max` 专用）：剩下名额全填**最贵**的也追不上已保留的最优解，则该子树无价值。
   `allowRepeat` 时上界取 `slotsLeft × pool[i]`（可重复取最贵那件），否则取前缀和之差。

**熔断诚实化**：节点访问数超 `maxEnumerations`（默认 40 万）时停止，此时
`stats.exhaustive = false`，`searchScope` 会写明「可能不是全局最优」，界面上的搜索范围文字变成警示色。
不假装搜全了——这是本项目的红线。

保留集也从「最大堆」泛化成 `BoundedCandidates`：根始终是**最差**的候选，
`min` 方向淘汰最贵、`max` 方向淘汰最便宜；`worstValue()` 同时兼作分支定界的比较基准。

### 验证方式：和暴力枚举对拍

新搜索最容易在边界上错，所以没有只靠手写用例，而是**保留一份笨办法的穷举当参照**：

`bruteForceTotals()` 用最直白的递归列出全部合法组合，然后对
**4 件 / 5 件 × 预算 30/40/60 × min/max 两个方向**共 12 组逐一比对首个候选的 `menuTotalCny`，
再加上「允许重复的 4 件」「候选排序方向」「节点熔断要如实上报」三组，共 15 个用例。

另外加了一条**防漂移守卫**：`MAX_SEARCH_ITEMS`（optimizer）必须等于 `MAX_ITEMS_LIMIT`（compiler）。
这两个常量分处两个互不依赖的包，不写测试就一定会有一天悄悄跑偏。

### 实测结果（本机真实执行）

| 场景 | 枚举数 | 是否穷尽 | 耗时 | 结果 |
|---|---|---|---|---|
| 固定 4 件，预算 35 | 487 | 是 | <1ms | 圆筒+灰焰圆筒+苹果片+派 ¥28 |
| 固定 5 件，预算 35 | 5 | 是 | <1ms | 上述再加雪碧 ¥34.5 |
| 5 件 + 关键词「汉堡」，预算 45 | 1935 | 是 | 3ms | 圆筒+灰焰圆筒+苹果片+派+麦香鸡 **¥42.00** |
| `max` 2–3 件 +「汉堡」，预算 45 | 1898 | 是 | 2ms | 板烧鸡腿堡+苹果汁+可乐 **¥45.00**（正好花满） |
| 5 件，预算 200（压力） | 376,325 | **否**（熔断） | 36ms | 最便宜 5 件，界面标注可能非全局最优 |

### 其它改动

- `packages/content` 新增两个示例：**五件套**、**吃满预算**——两套 UI 自动都有，不用改两处。
- 输入补全的 `optimize` 取值从 1 个变成 2 个（`min(...)` / `max(...)`）。
- 搜索范围文字现在带方向（「最低总价」/「尽量花满预算」），未穷尽时两套 UI 都转警示色。
- 新增两张**真实截图**：用无头 Chrome + CDP 打开 `dist/mealscript.html`，真实点击「五件套」示例后抓的，
  不是手绘、不是修图。README 里明确区分了「设计还原图（SVG）」和「真实截图（PNG）」。
- README 的件数上限、`optimize` 说明、错误码表、测试计数、徽章全部同步；偏差说明里**主动记下**
  件数从 1–3 放宽到 1–5、以及新增 `max` 方向这两处与任务书不一致的地方。

### 本轮结果

```
npm test              → 7 files, 152 passed（130 → 152，新增 22）
tsc --noEmit          → 根工作区 0 error；apps/playground 0 error
node build/single.mjs → dist/mealscript.html 276.1 KB，外链 0
next build            → 成功（First Load JS 93.8 kB）
```

### 仍未完成（更新后）

- ~~`max_items` 硬上限 3~~ → 已放到 **5**，并说明这是与任务书的有意偏差。
- ~~`optimize` 仅支持 `min`~~ → 已支持 **`max(total_price)`**。
- 仍缺：`mode: delivery`、按营养/热量优化、CI 入库（缺 workflow scope token）、
  `mcp-client` 只有 1 个超时用例、移动端断点只有 1 个。
