# 一致性收敛清单 v1（只谈商品后端逻辑）—ENV/金额/监听/DB 对齐

> 范围：只讨论商品**后端逻辑**与其直接相关的系统契约（前后端/监听器/合约/证据服务之间的输入输出约定）。不写代码、只给可执行决策与验收标准。

---

## 0. 总体评价与目标
- 结构清晰、执行顺序合理、契约边界明确，符合“只信事件 + 最小可运行 + 可复核”的方向。
- 当前仓库存在命名/ENV/监听/表结构若干不一致，需一次收敛，**7 天兼容期**后落日旧口径。
- 本文产出：统一口径、PR 拆分、验收清单、落日与回退策略。

---

## 1) 统一口径（拍板项）

### 1.1 ENV 键与样例（7 天兼容期）
**统一键（文档与样例口径）**：
- `PAYMENT_VAULT_ADDRESS`、`PAYMENT_CHAIN_ID`、`USDC_ADDRESS`
- `DB_FILE`、`CONFIRMATIONS`、`LISTENER_POLL_INTERVAL_SEC`、`REPLAY_FROM_BLOCK`

**兼容旧键（代码层兼容 7 天）**：
- 兼容读取：`BASE_RPC`、`CHECKOUT_USDC_ADDRESS`、`BASE_USDC_ADDRESS`、`TREASURY_ADDRESS`、`DB_URL`
- 兼容策略：新键优先，旧键映射到新语义；在启动日志打印**兼容告警**；第 8 天移除。

**样例与校验落点**：
- `apps/us-backend/.env.sample`、`src/utils/envValidator.ts`、`src/database/db.ts`

**验收**：复制样例即可一次启动；缺任一必填键 Fail‑Fast；启动日志打印契约摘要（脱敏）。

---

### 1.2 金额字段（系统内一律 6 位整数)
- **最终口径：`premiumUSDC_6d`（已拍板）**。
- **全链路单位**：micro‑USDC（6 位整数）。
- **API 字段**：统一为 `premiumUSDC_6d`（若全局改名为 `premiumUSDC6d`，需整库/整路由一致替换）。
- **兼容期**：后端在兼容期内可接受 `premiumUSDC` 小数，但**入库必须 `*_6d`**，7 天后移除小数入口。
- **错误码**：`ERR_SCHEMA_FIELD_MISMATCH`（携带期望字段与示例值）。
- **落点**：`apps/us-backend/src/routes/orders.ts`、`apps/us-frontend/src/pages/Products.tsx`

**验收**：
- 0.01/0.1/1 USDC 下单返回 201，入库均为整数 6 位；
- 发错字段/单位返回 400 + 统一错误码；前端 Toast 明确“金额单位不匹配：应为 6 位整数（*_6d）”。

---

### 1.3 数据库路径/模式与单库
- **单一 DB**：后端与监听器共用同一 SQLite 文件，统一变量 `DB_FILE`。
- **目录与默认**：统一为 `./data/liqpass.db`（或 `data/us-backend.db`，二选一；本文默认 `data/liqpass.db`）。
- **类型与列**：`orders.premium_usdc_6d` 用 `INTEGER NOT NULL`，并加 `CHECK(premium_usdc_6d % 1 = 0 AND premium_usdc_6d >= 10000)`（最小 0.01 USDC）；移除 `REAL/TEXT` 混用（margin/premium 等列统一）。
- **唯一与幂等**：`UNIQUE(order_id)`；`contract_events` 加 `UNIQUE(tx_hash, log_index)`，所有写入按“读→计算→幂等写”。
- **游标表**：统一为 `event_cursors(chain_id INTEGER, contract_address TEXT, topic TEXT, last_block INTEGER, PRIMARY KEY (chain_id, contract_address, topic))`，替换分散的 `chain_listener/chain_cursor`。
- **SQLite 初始化**：显式启用 `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;` 并在启动日志打印。
- **落点**：`apps/chain-listener/db/migrations/002_orders.sql`、`apps/us-backend/src/database/migrations/*`

**验收**：
- 单库可读写；`order_id` 唯一；事件不重复；
- 迁移 up/down 可回滚；
- WAL+busy_timeout 生效，重启不丢。

---

### 1.4 监听确认与补扫（统一参数）
- **参数**：`CONFIRMATIONS=12`、`SAFE_DEPTH=14`、`LISTENER_POLL_INTERVAL_SEC=4`（默认，可调）、轮询重算 + 回放；`REPLAY_FROM_BLOCK` 用于冷启动回放起点。
- **统一行为**：
  - 首见事件：写入 `paid_unconfirmed`，记录 `first_seen_block`；
  - 周期复算：`confirms = tip - block + 1`，达标升级为 `paid_confirmed`；
  - 冷启动回放：`REPLAY_FROM_BLOCK`；reorg 回滚至 `SAFE_DEPTH` 后重放。
- **落点**：将 `apps/us-backend/src/services/contractListenerService.ts` 改为**依赖数据库状态或下线**，以 `apps/chain-listener` 为单一来源。

**验收**：12 确认后自动升级；重启后续跑；回滚场景可回退并重放。

---

### 1.5 订单状态机
- 统一为：`paid_unconfirmed → paid_confirmed`（禁止直接写 `paid`）。
- API/查询与前端状态枚举保持一致。
- 落点：`apps/chain-listener/src/services/orderService.mjs` 与后端查询接口。

---

### 1.6 错误码与路由
- 在 `ERROR_CODES` 中补齐：`ERR_SCHEMA_FIELD_MISMATCH`、`ERR_AMOUNT_STEP_INVALID`、`ERR_AMOUNT_RANGE_INVALID`。
- 路由统一引用枚举，去除散落的 `INVALID_REQUEST`。

---

### 1.7 CORS 与健康探针
- **CORS**：prod 精确白名单，dev 仅 `localhost`；来源 ENV `ALLOWED_ORIGINS`；在 `/readyz` 打印摘要。
- **探针**：`/healthz`（存活）与 `/readyz`（就绪=SQLite 可写 + RPC 可用 + ENV 校验通过），为现有 `/api/v1/health/ready` 增加别名。
- 落点：`apps/us-backend/src/routes/health.ts` 与网关配置。

---

### 1.8 证据服务（去示例化）
- 采用 **Canonical JSON（JCS） + evidence_root**；
- `apps/jp-verify` 增加最小字段映射与复核脚本，禁止样例污染；
- 失败进入 `pending_evidence` 状态，不产伪数据。

---

### 1.9 订单 ID 策略
- 与链上 `bytes32 orderId` 对齐：**后端生成**，回传前端用于合约调用；
- **存储口径**：数据库以**小写 0x 开头的 66 长度十六进制文本**存储（便于日志/比对），并设 `UNIQUE(order_id)`；
- 若存在 `policy_id` 等其他标识，建立**一对一映射**但**一切查询以 `orderId` 为锚**。

---

### 1.10 常量广播：金额步长与阈值
- 集中定义并透传给前端：`min/max/step`（`step=1e-6`）；
- `GET /orders/preview` 返回 `{min: 0.01, max: 100, step: 1e-6}`，避免硬编码漂移。

---

## 2) 迁移与脚本

### 2.1 迁移目录新增/更新
- 新增：`event_cursors`（复合主键 `chain_id, contract_address, topic`）、`orders.status`（含 `paid_unconfirmed/paid_confirmed`）、`orders.premium_usdc_6d`（INTEGER + CHECK）。
- 补充索引：`orders UNIQUE(order_id)`、`contract_events UNIQUE(tx_hash, log_index)`；必要处加外键/检查约束。
- 提供 down 脚本；一次性迁移脚本完成旧列重命名与类型调整，并把旧游标表数据迁入新复合主键结构。

### 2.2 E2E 自测脚本（上线前 Smoke）
- 流程：创建订单 → 模拟/拉取 `PremiumPaid` → 等待确认 → 校验状态升级与金额一致。
- 纳入 CI：最小端到端烟囱测试。

--- E2E 自测脚本（上线前 Smoke）
- 流程：创建订单 → 模拟/拉取 `PremiumPaid` → 等待确认 → 校验状态升级与金额一致。
- 纳入 CI：最小端到端烟囱测试。

---

## 3) 文档与新人 30 分钟上手
- 新增“一页契约卡”（金额单位、字段名、示例请求/响应、确认规则、失败处理）。
- 新增“代码落点索引”（文件路径 + 职责）。

---

## 4) PR 拆分与执行顺序（Blocking → Critical → High）

**PR‑1｜ENV 契约与样例**（Blocking）
- 补 `.env.sample` 与 `EnvValidator`；Fail‑Fast；启动打印契约摘要与旧键兼容告警。

**PR‑2｜金额字段统一 + 兼容期**（Blocking）
- API 只接受 `premiumUSDC_6d`；兼容小数入口 7 天；错误码统一；前端 Toast。

**PR‑3｜单库与类型/约束统一**（Blocking）
- 合并监听器与后端 DB；`INTEGER` 承载 `premium_usdc_6d` + CHECK；`UNIQUE(order_id)`；`contract_events UNIQUE(tx_hash, log_index)`；启用 WAL/timeout；迁移旧列。

**PR‑4｜监听确认 + 回放 + 复合游标**（Critical）
- `CONFIRMATIONS=12 / SAFE_DEPTH=14 / LISTENER_POLL_INTERVAL_SEC=4`；周期复算与冷启动回放；监听单一来源；`event_cursors` 复合主键（`chain_id, contract_address, topic`）。

**PR‑5｜状态机与订单 ID 策略**（Critical）
- `paid_unconfirmed → paid_confirmed`；后端生成 bytes32 `orderId` 并全链路对齐。

**PR‑6｜证据服务 JCS + root**（High）
- 去示例化，最小映射集与复核脚本。

**PR‑7｜CORS 与探针**（High）
- 精确白名单；`/healthz` `/readyz` 对齐（ready 条件含 DB 可写 + RPC 可用 + ENV 校验）。

**PR‑8｜文档与“一页卡”**（High）
- 新人 30 分钟跑通的契约与落点索引。

---

## 5) 7 天迁移节奏（默认口径）
- **D1**：合入 PR‑1/2（ENV + 金额），前端开始发 `premiumUSDC_6d`，后端保留小数兼容；
- **D2‑D3**：合入 PR‑3/4（单库 + 监听），跑 E2E；
- **D4**：上 PR‑5（状态机/错误码），统一前端枚举；
- **D5**：上线证据最小闭环（PR‑6）；
- **D6**：CORS/探针、文档卡（PR‑7/8）；
- **D7**：移除小数入口与旧 ENV 兼容；CI 加“旧键/小数入口检测”。

---

## 6) 验收清单（一次性）
- **ENV**：复制样例即启动；缺键 Fail‑Fast；日志有契约摘要与旧键兼容告警。
- **金额**：0.01/0.1/1 USDC 下单 201；错字段/单位 400 + 统一错误码；入库 `*_6d`。
- **DB**：单库存在；`orders/event_cursors` 可写；迁移 up/down 有效；`UNIQUE(order_id)`、`UNIQUE(tx_hash, log_index)` 生效；`premium_usdc_6d` CHECK 生效。
- **监听**：12 确认自动升级；重启续跑；回滚可重放；`LISTENER_POLL_INTERVAL_SEC` 为 4 或项目指定值。
- **状态机**：无直接 `paid`；仅 `paid_unconfirmed/paid_confirmed`。
- **证据**：三件套（原始/规范化/root）；失败 pending，不产伪数据。
- **CORS/探针**：prod 精确白名单；`/healthz` 与 `/readyz` 200（ready 含 DB 可写 + RPC 可用 + ENV 校验通过）。
- **文档**：新人 30 分钟跑通；“一页契约卡”齐全。

---

## 7) 回退与风控
- **回退**：每 PR 保留开关/回滚点；迁移提供 down；兼容层仅 7 天。
- **监控**：请求成功率、201 比例、`paid_unconfirmed` 停留时长中位数、监听滞后高度、DB 错误码频次。

---

## 8) 决策速签（勾选区）
- [x] 字段名最终口径：`premiumUSDC_6d`（已拍板）
- [x] 旧 ENV 键兼容窗口：**7 天**（第 8 天移除）
- [x] 单库路径：`data/liqpass.db`
- [x] 确认与安全深度：`12 / 14` 固化 
- [x] 监听单一来源：保留 `apps/chain-listener`，后端监听依赖 DB 或下线
- [x] 错误码三项补齐并落地
- [x] 证据服务切换至 JCS + root（最小映射集）
- [x] CORS 精确白名单 + `/healthz|/readyz` 生效
- [x] E2E 烟囱脚本进 CI
- [x] `event_cursors` 复合主键：`(chain_id, contract_address, topic)`
- [x] 唯一与幂等：`UNIQUE(order_id)`、`UNIQUE(tx_hash, log_index)`
- [x] 轮询节奏：`LISTENER_POLL_INTERVAL_SEC=4`（默认）
- [x] `orderId` 存储口径：小写 0x 十六进制文本（长度 66）

> 备注：以上勾选内容已合并至各章节与 PR 卡，CI 将在“落日日”自动阻断旧口径。


---

## 9) 给 AI 的提示词卡（PR‑1 至 PR‑8）—可直接复制给 IDE/Agent
> 说明：以下为“无代码示例”的**系统提示词模板**。每张卡都包含背景→任务→修改点→输出→验收（DoD）→回退。复制整张卡给你的编码助手即可生成 PR。

### PR‑1｜ENV 契约与样例（Fail‑Fast + 启动摘要）
**系统指令**：你是一名后端与运维工程师，目标是在不改变业务逻辑的前提下收敛 ENV 契约并提供 Fail‑Fast 校验与启动日志摘要。
**背景**：仓库结构 `apps/us-backend`（Express/TypeScript/SQLite），现有 ENV 键不统一。新口径键：`PAYMENT_VAULT_ADDRESS, PAYMENT_CHAIN_ID, USDC_ADDRESS, DB_FILE, CONFIRMATIONS, LISTENER_POLL_INTERVAL_SEC, REPLAY_FROM_BLOCK`；旧键仍需兼容 7 天：`BASE_RPC, CHECKOUT_USDC_ADDRESS, BASE_USDC_ADDRESS, TREASURY_ADDRESS, DB_URL`（新键优先）。
**任务**：
1) 在 `apps/us-backend/.env.sample` 补齐全部新键与注释；
2) 在 `src/utils/envValidator.ts` 实现必填校验、类型校验、默认值与**兼容旧键映射**（打印兼容告警）；
3) 启动时输出**契约摘要**（脱敏）：`chain_id / usdc / vault / listener{confirmations,safe_depth,poll,from_block} / db_file`；
4) 缺少必填键→进程直接退出（Fail‑Fast，非 try/catch 吞错）。
**修改点**：上述两个文件 + `src/database/db.ts` 读取 `DB_FILE`；不改业务路由。
**输出**：PR 标题、变更点列表、示例启动日志截图（文本版即可）。
**DoD**：复制样例即可启动；缺键时退出码≠0；日志包含兼容告警；CI 增“旧键探测”预警。
**回退**：保留旧键读取路径 7 天（第 8 天移除）。

### PR‑2｜金额字段统一：`premiumUSDC_6d` + 7 天兼容
**系统指令**：你是接口契约与前端协同工程师，目标是**全链路 6 位整数（micro‑USDC）**，API 只接受 `premiumUSDC_6d`，兼容小数入口 7 天。
**背景**：当前前后端存在 `premiumUSDC` 小数与文本混用。
**任务**：
1) 后端路由 `apps/us-backend/src/routes/orders.ts` 仅接受 `premiumUSDC_6d`（整数）；兼容期接受 `premiumUSDC` 小数→在入库前转换为整数并记录兼容日志；
2) 错误码统一：`ERR_SCHEMA_FIELD_MISMATCH / ERR_AMOUNT_STEP_INVALID / ERR_AMOUNT_RANGE_INVALID`；
3) 前端 `apps/us-frontend/src/pages/Products.tsx` 与 `CreateLink.tsx` 请求体字段统一为 `premiumUSDC_6d`；400 时 Toast 固定文案：“金额单位不匹配：应为 6 位整数（*_6d）”；
4) 在 README/一页卡补充“金额单位/示例”。
**输出**：PR 描述、接口示例、前端截取的请求 payload 对比、错误码枚举位置。
**DoD**：0.01/0.1/1 USDC 下单 201 且入库整数；错字段/单位 400 + 统一错误码；CI 带“旧字段/小数入口检测”。
**回退**：保留小数入口 7 天；到期 CI 阻断。

### PR‑3｜单库合并 + 约束与 WAL/timeout
**系统指令**：你是数据库工程师，目标是让监听器与后端使用同一 SQLite，并完成类型/约束与并发参数统一。
**背景**：目前存在多处 DB 路径与 REAL/TEXT 混用。
**任务**：
1) 统一 `DB_FILE=./data/liqpass.db`；
2) 迁移：`orders.premium_usdc_6d INTEGER NOT NULL CHECK(premium_usdc_6d % 1 = 0 AND premium_usdc_6d >= 10000)`；移除 `REAL/TEXT` 混用；
3) 唯一与去重：`UNIQUE(order_id)`；`contract_events` 增 `UNIQUE(tx_hash, log_index)`；
4) `event_cursors` 新结构：`(chain_id INTEGER, contract_address TEXT, topic TEXT, last_block INTEGER, PRIMARY KEY(chain_id, contract_address, topic))`；
5) DB 初始化显式启用 `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;` 并打印到启动日志；
6) 提供 up/down 迁移与一次性数据搬迁脚本（老游标/老列→新结构）。
**输出**：迁移说明、影响面（读/写路径）、回滚策略。
**DoD**：单库生效；唯一/检查约束生效；WAL/timeout 生效；up/down 循环可通过；E2E 正常。
**回退**：保留备份 DB 并提供 down 脚本。

### PR‑4｜监听统一：确认/回放/轮询 + 单一来源
**系统指令**：你是链上监听与一致性工程师，目标是以 `apps/chain-listener` 为**唯一写入来源**，统一确认与回放策略。
**任务**：
1) 参数统一：`CONFIRMATIONS=12`、`SAFE_DEPTH=14`、`LISTENER_POLL_INTERVAL_SEC=4`、`REPLAY_FROM_BLOCK`；
2) 行为：首见→`paid_unconfirmed`；达到确认→升级 `paid_confirmed`；reorg→回退至 `SAFE_DEPTH` 再重放；
3) 后端 `ContractListenerService` 下线或只读 DB，避免双写；
4) 幂等：所有状态写均以 DB 现状对比后再写；
5) `/readyz` 暴露“最新处理高度/链头高度/滞后块数”。
**输出**：监听状态机描述、参数读取点、/readyz 示例响应。
**DoD**：12 确认自动升级；重启续跑；reorg 可回放；无重复写。
**回退**：保留旧服务开关，默认关闭。

### PR‑5｜状态机对齐 + bytes32 `orderId` 统一锚点
**系统指令**：你是契约对齐工程师，目标是统一订单状态机与 `orderId` 策略。
**任务**：
1) 明确仅两态：`paid_unconfirmed`、`paid_confirmed`；禁用直接写 `paid`；
2) 后端**生成 bytes32 `orderId`**（小写 0x 66 长度文本存库，UNIQUE），下单时回传前端用于合约调用；
3) 统一 `PremiumPaid` 与 `PolicyPurchased` 语义到 `orderId` 维度；如存在 `policy_id`，建立 1:1 映射；
4) API/前端查询与展示以 `orderId` 为主键。
**输出**：流程图（文本描述即可）、API 契约更新说明。
**DoD**：`orderId` 全链路贯通；状态机无“直写 paid”。
**回退**：保留旧查询参数一轮迭代，返回弃用告警。

### PR‑6｜证据服务：JCS + evidence_root（去示例化）
**系统指令**：你是证据与可复核工程师，目标是采用 Canonical JSON（JCS）与 `evidence_root`，去除样例污染。
**任务**：
1) `apps/jp-verify` 定义**最小字段映射**（订单锚、交易所只读数据指纹、时间窗、签名/公钥）；
2) 生成 **JCS 规范化 JSON** 与 `evidence_root`（哈希/Merkle 根），落库三件套；
3) 复核脚本：校验入库记录可重建同一 root；失败进入 `pending_evidence`，不产伪数据；
4) 文档补“证据链可复核流程”。
**输出**：接口说明、样例字段键名、复核脚本调用方式（无代码粘贴）。
**DoD**：同一输入多次生成 root 恒定；失败有告警与重试队列。
**回退**：保留“禁用证据生成功能”开关。

### PR‑7｜CORS 白名单 + 健康/就绪探针对齐
**系统指令**：你是平台与网关工程师，目标是按文档对齐 CORS 与探针。
**任务**：
1) `ALLOWED_ORIGINS`：prod 精确域名白名单，dev 仅 `http://localhost:*`；删除通配符；
2) 路由：`/healthz`（存活）与 `/readyz`（就绪=SQLite 可写 + RPC 可用 + ENV 校验通过）；兼容别名 `/api/v1/health/ready`；
3) `/readyz` 打印 `origins` 摘要与监听参数摘要。
**输出**：网关/后端配置差异说明、示例响应。
**DoD**：白名单生效；就绪条件三项缺一则 503；监控可拉取指标。
**回退**：提供“宽松模式”开关，仅在开发启用。

### PR‑8｜文档：“一页契约卡” + “代码落点索引” + E2E 烟囱进 CI
**系统指令**：你是文档与发布工程师，目标是让新人 30 分钟内跑通。
**任务**：
1) 新增“一页契约卡”：金额单位/字段名/示例请求响应/确认规则/失败处理/错误码；
2) 新增“代码落点索引”：文件路径→职责（ENV、金额、DB、监听、证据、探针、前端请求体）；
3) 把 **E2E 自测脚本**（下单→抓事件→确认→校验）挂入 CI 的“上线前 Smoke”；
4) CI 加“落日闸”两条：禁旧 ENV 键；禁小数入口。
**输出**：文档链接（仓库相对路径）、CI 任务名与触发条件描述。
**DoD**：新人按卡操作 30 分钟内跑通；CI 有烟囱任务且默认执行；落日规则可见。
**回退**：提供 docs 版本化与回滚 PR。
