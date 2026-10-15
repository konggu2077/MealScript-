# MCP Integration — MealScript 实际如何接入麦当劳 MCP

本文记录**真实使用**的 Server、Tool、调用流程与失败处理，不是文档抄录。
所有内容来自 2026-10-15 21:59–22:00（GMT+8）的一次已鉴权、只读的真实联调会话。

---

## 1. Server

| 项 | 值 |
|---|---|
| 官方远程地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权 | 请求头 `Authorization: Bearer <TOKEN>` |
| Token 获取 | https://open.mcd.cn/mcp（手机号登录 → 控制台 → 激活 → 复制） |
| 限流 | 每个 Token 每分钟最多 600 次调用 |
| 401 / 429 | 401 = 凭证问题（→ `E401`）；429 = 限流（→ `E429`） |
| 配置示例 | `mcp-config.example.json`（只有 `${MCD_MCP_TOKEN}` 占位符） |

脱敏后的请求/响应字段结构快照存放在 `packages/mcp-adapter/src/schema-snapshot.json`。

---

## 2. 实际调用的 Tool

### P0（已全部真实调通）

| Tool | 用途 | 关键入参 | 真实返回要点 |
|---|---|---|---|
| `query-nearby-stores` | 按位置找门店，拿 `storeCode` | `beType=1`（到店自提）、`searchType=2`、`city`、`keyword` | 返回 `storeCode` / `storeName` / 营业时间 / 是否支持预约 |
| `query-meals` | 取门店当前可售商品与编码 | `storeCode`、`orderType=1`、`beType=1` | `data.categories[]` 分类 → `data.meals{code}` 详情映射；**价格是「元」的字符串**，如 `"33.5"` |
| `query-meal-detail` | 校验候选组成与特调项 | `storeCode`、`orderType=1`、`beType=1`、`code` | `rounds[]` 套餐轮次、`modification.items[]` 特调项（`selectedKey` / `unselectedKey`） |
| `calculate-price` | **最终价格的唯一权威** | `storeCode`、`orderType=1`、`beType=1`、`items[{productCode, quantity}]` | **所有金额单位是「分」**，`data.price=2250` 表示 ¥22.50 |

### P1（未启用）

`query-store-coupons`（优惠券）、`list-nutrition-foods`（营养）。
按任务书 §1.2，营养数据在未建立可靠映射前**不启用强约束**，因此 v0.1 不调用。

### 明确禁止调用

`create-order` / `cancel-order` / `mall-create-order` / `auto-bind-coupons` / `draw-lottery` / `delivery-create-address`。
适配器里有硬编码黑名单（`packages/mcp-adapter/src/types.ts` 的 `FORBIDDEN_TOOLS`），命中即抛 `ForbiddenToolError`。**本项目永不创建真实订单、永不付款、永不自动领券。**

---

## 3. 真实调用证据（已脱敏）

时间均为北京时间 2026-10-15。

| # | Tool | 请求要点 | 结果 |
|---|---|---|---|
| 1 | `now-time-info` | — | `success:true`，服务器时间 `2026-10-15 21:25:42 GMT+8` → 连通性确认 |
| 2 | `query-nearby-stores` | `city=北京市, keyword=海淀区五道口, beType=1, searchType=2` | 返回 5 家门店，取第一家 `1950556 麦当劳北京五道口优盛餐厅` |
| 3 | `query-meals` | `storeCode=1950556, orderType=1, beType=1` | 14 个分类、约 120 个可售商品，价格区间 ¥2–¥73 |
| 4 | `query-meal-detail` | `code=1440` | `麦辣鸡腿汉堡`，`supportModify=true`，2 个默认特调项 |
| 5 | `calculate-price` | `items=[{productCode:"1440", quantity:1}]` | `price=2250`（分）= **¥22.50**，与菜单价 22.5 完全一致 |
| 6 | `calculate-price` | `items=[1440×1, 515837×1]` | `price=2750`（分）= **¥27.50** = 22.5 + 5.0，多商品结算正确 |

**关键发现（写进代码的两个坑）：**

1. `calculate-price` 的金额单位是**分**，必须除 100。这是最容易算错价格的地方，本项目在 `normalizer.ts` 里统一用 `fenToYuan()` 转换，并有单测。
2. `query-nearby-stores` **没有 `location` 参数**，只吃 `city` + `keyword`。因此 DSL 里的 `location: "北京市海淀区五道口"` 必须在编译器里拆成 `city=北京市` / `keyword=海淀区五道口`（见 `packages/compiler/src/location.ts`）。

---

## 4. 调用流程

```
IR.location ──拆分──▶ query-nearby-stores ──storeCode──▶ query-meals ──商品集──▶
   optimizer（有界枚举 + 菜单价粗筛）──Top-K 候选──▶ calculate-price ──官方价──▶
   预算判定 ──▶ Build Report（带 trace 证据）
```

每一步都写进 `Execution Trace`，包含工具名、耗时、状态与**脱敏后**的请求/响应摘要。
trace 在写入前强制经过 `redact()`：Token / 手机号 / 地址 / 账号 / 订单号 / 长 ID 一律脱敏或打码。

**预算判定只认 `calculate-price` 的返回值。** 菜单价仅用于排序和粗筛——因为优惠不可线性叠加，菜单价之和不等于结算价。

**调用上限**：候选 Top-12，官方算价最多 8 次，命中 3 个可行解即停。这是为了守住 600 次/分钟的限流。

---

## 5. 失败处理

| 情况 | 系统行为 | 错误码 |
|---|---|---|
| 401 Token 失效 | 停止，提示重新获取 Token，**不回退成伪造价格** | E401 |
| 429 限流 / 超时 | 结构化错误 + 可重试提示 | E429 |
| 门店无商品 / 返回空 | 明确的空状态，不生成虚构商品 | E301 |
| 价格响应无法解析 | 记为未验证，**不视为通过** | E500 |
| 部分组合校验失败 | 只输出已验证的结果，未验证的绝不标成功 | — |
| 无可行组合 | 只声称「本次已验证范围内无结果」，不宣称全局不可行 | E220 |

---

## 6. 业务价值

- **对用户**：把「35 元以内、要汉堡、不要咖啡」变成一次可复现、可验证的编译，而不是一次聊天。价格来自官方接口，不用怕被模型编造。
- **对麦当劳 MCP**：展示了 MCP 不仅能做「问答式点餐」，还能作为**确定性系统的后端事实来源**——编译器负责逻辑，MCP 负责真实数据，两者职责清晰。
- **对开发者**：`schema-snapshot.json` + Zod 校验 + Replay fixture 提供了一套「如何在不持有凭据的情况下可靠地对接这套接口」的可复用范式。

---

## 7. 复现方式

```bash
# 无需 Token：跑 Replay，验证整套链路与失败处理
npm test

# 有 Token：真实调用
cp .env.example .env && echo "MCD_MCP_TOKEN=你的Token" >> .env
npm run dev   # 页面切到 Live
```

Replay fixture 来自上面第 2–6 条真实调用，已做脱敏处理：
移除门店地址 / 距离 / 经纬度、移除 `traceId`、移除商品图片（品牌素材不重新分发）、移除一切个人信息。
保留的是商品编码、名称与价格——这些是让离线复现有意义的最小真实数据集。
