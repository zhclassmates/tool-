# OrderService 持久化到 SQLite · 讨论与落地清单 v1

> 场景：`apps/us-backend/src/services/orderService.ts:40-47` 当前用内存 Map 保存 quote/order，重启丢失，无法满足 MOP-1（链上事件→入库→可审计）。本清单只讨论**设计与流程**，不写代码。

---

## 1) 背景与目标
- **问题**：报价/订单仅在内存，服务重启后全部丢失，链上事件无法对账，审计链路断裂。
- **目标**：以 SQLite 为**单一事实来源（SSOT）**，让 quote/order 全生命周期可持久、可回放、可对账、可审计；接口协议保持不变；达到 MOP‑1。

**不改的边界**
- 不改现有 HTTP 接口路径与响应结构。
- 不改变链上监听与 `contract_events` 的既有入库方式。

---

## 2) 关键决策（D）
- **D1：数据源**：DB 为真相源，内存仅可选 LRU 缓存（不开也可跑）。
- **D2：写入策略**：write‑through（先 DB 后缓存）。所有状态迁移在**事务**中完成。
- **D3：状态机**：`CREATED → PENDING_PAYMENT → PAID | EXPIRED | CANCELED`（理赔另线，暂不扩展）。
- **D4：幂等键**：`order_id`、`quote_id`、（可选）`client_request_id`；支付事件用 `(tx_hash, log_index)` 做唯一对账键。
- **D5：特性开关**：`FEATURE_PERSIST_ORDERS=true`（可灰度、可回滚）。
- **D6：金额口径**：一律使用整数 `premium_usdc_6d`（6 位小数精度）。

---

## 3) 数据模型与约束（表级规则）
### 3.1 orders（主表）
- **主键**：`order_id`（ULID/UUID）
- **字段**：`quote_id(FK)`, `wallet_address`, `premium_usdc_6d`, `status`, `chain_id`, `token_address(USDC)`, `payment_tx_hash?`, `payment_log_index?`, `payment_proof_id?`, `expires_at?`, `metadata_json?`, `created_at`, `updated_at`
- **约束**：
  - `premium_usdc_6d >= 0`
  - `status ∈ {CREATED,PENDING_PAYMENT,PAID,EXPIRED,CANCELED}`
  - 若写入 `payment_tx_hash` 则必须同时写 `payment_log_index`
  - `(payment_tx_hash, payment_log_index)` **唯一**（避免重复事件关联）

### 3.2 quotes（若已有则复用）
- **主键**：`quote_id`
- **字段**：`wallet_address`, `leverage_tier`, `coverage_type(24h/8h/月度)`, `premium_usdc_6d`, `status(ACTIVE/USED/EXPIRED/CANCELED)`, `created_at`, `expires_at`
- **约束**：`quote_id` 唯一；过期/已用不可再次开单。

### 3.3 orders_audit（追加写审计）
- **字段**：`id(PK)`, `order_id(FK)`, `action(CREATE/UPDATE_STATUS/ATTACH_EVENT/EXPIRE/CANCEL)`, `old_status?`, `new_status?`, `diff_json?`, `at`
- **规则**：只追加不更新；任何状态迁移必须落一条记录。

> 说明：`contract_events` 继续保持 `(tx_hash, log_index)` 唯一，用于与 `orders` 关联对账。

---

## 4) 服务改造路线（流程级）
### 4.1 createOrder（创建）
- 校验 quote（存在、未过期、未使用）。
- 生成 `order_id`，开启事务：插入 `orders(status=PENDING_PAYMENT)` + 追加 `orders_audit(CREATE)`。
- 可选：放入内存缓存。
- 返回结构与现有接口保持一致。

### 4.2 markPaid / attachPayment（支付入账）
- 入参包含 `tx_hash`、`log_index`、（可选）`payment_proof_id`。
- 先校验 `contract_events` 存在对应事件；若暂未入库，返回“待补偿/可重试”。
- 事务内：更新 `orders.status=PAID` 且写入事件键；追加 `orders_audit(ATTACH_EVENT, UPDATE_STATUS)`。
- 幂等：若已是 PAID 且绑定同一事件，直接返回现状（不重复写）。

### 4.3 过期与取消
- 定时扫描 `PENDING_PAYMENT` 按 `expires_at` → `EXPIRED`；每次变更写审计。

### 4.4 启动加载（可选）
- 预热最近 N 天订单到内存（默认 3–7 天）；未命中走 DB 直读。启动日志打印预热统计。

---

## 5) 对账与审计（链路串联）
- **写入对账键**：订单落库时预留 `payment_tx_hash/log_index` 字段；支付确认时回填。
- **联表核查**：以 `(tx_hash,log_index)` JOIN `contract_events` 即可追溯链上证据。
- **完整性**：任何状态迁移都在 `orders_audit` 留痕（操作人/来源/差异）。

---

## 6) 验收用例（不写命令版）
- ✅ **用例 A：创建并保活**：创建订单 → DB 出现 `orders` + 一条 `orders_audit(CREATE)`；重启服务 → `/api/v1/orders/:id` 仍返回 `PENDING_PAYMENT`。
- ✅ **用例 B：支付入账**：写入或等待一条 `PremiumPaid` 事件 → 调用标记已付 → `orders` 变为 `PAID`，并能以 `(tx_hash,log_index)` 在 `contract_events` 找到对应事件。
- ✅ **用例 C：过期**：把 `expires_at` 设为近时刻 → 到时自动变成 `EXPIRED`，审计表追加记录。
- ✅ **用例 D：幂等**：重复调用标记已付 → 不新增多余审计，不改变既有绑定。
- ✅ **用例 E：预热**：开启特性并启动 → 启动日志显示预热统计（最近 N 天）。

---

## 7) 推进节奏（灰度/回滚）
- **阶段 1：影子写**（开关开，读内存、写 DB + 内存）
- **阶段 2：主读 DB**（读 DB，缓存只是加速）
- **阶段 3：移除 Map 依赖**（确认稳定后再做）
- **一键回滚**：将 `FEATURE_PERSIST_ORDERS=false` 恢复全内存路径；暂停过期扫描与预热，不清理已写数据。

---

## 8) 风险矩阵与缓解
| 风险 | 级别 | 触发场景 | 缓解/措施 |
|---|---|---|---|
| 双写/脏读 | P0 | 缓存与 DB 不一致 | 严格以 DB 为准；写入用事务；读路径 DB→缓存 |
| 重复事件 | P0 | 同一 `(tx,idx)` 多次到达 | `(tx_hash,log_index)` 唯一约束；处理逻辑幂等 |
| 时序竞态 | P1 | 事件先到或晚到 | 找不到订单/事件时进入补偿队列，后台重试 |
| 性能瓶颈 | P1 | 高并发创建/查询 | SQLite WAL；关键列索引；热点读可缓存 |
| 口径不统一 | P1 | 金额小数/整数混用 | 统一 `premium_usdc_6d`；边界层一次性转换 |

---

## 9) 运维与可观测（指标/日志）
- **日志**：状态迁移时输出结构化日志（`order_id`, `from→to`, `tx_hash`, `log_index`）。
- **指标**：订单总数、PENDING/PAID/EXPIRED 分布；预热条数；DB 错误计数；过期扫描耗时。
- **外显健康**：提供只读健康端点返回关键计数（便于监控面板对比 DB 实际值）。

---

## 10) 讨论清单（逐项勾选）
- [ ] 特性开关命名与默认值（建议：`FEATURE_PERSIST_ORDERS=false` → 预发开）
- [ ] 预热时间窗（建议：3–7 天，可配置）
- [ ] 订单与事件的**唯一对账策略**（是否仅 `(tx,idx)`，是否保留 `payment_proof_id`）
- [ ] 审计字段最小集（是否记录调用来源/IP/actor_id）
- [ ] 过期扫描频率与批量大小（默认 1–5 分钟）
- [ ] 边界错误码口径（找不到事件/订单时返回值与重试语义）

---

## 11) 最小演练脚本（步骤，不含命令）
1. 开启特性开关，启动服务，记录启动日志中的“预热统计”。
2. 发起创建订单请求，立即在 DB 查看是否出现一条 `orders` 与一条 `orders_audit(CREATE)`。
3. 重启服务后，查询同一 `order_id`，确认状态与创建时一致。
4. 注入一条真实或模拟 `PremiumPaid` 事件；执行“标记已付”；检查 `orders` 是否写入 `(tx_hash,log_index)` 并变为 `PAID`。
5. 到期测试：设置 `expires_at` 为近时刻，等待扫描，确认状态转为 `EXPIRED` 且写入审计。
6. 幂等性：重复“标记已付”，确认无重复写。

---

**结论**：按本清单推进，能以最小改造实现“内存 → SQLite 持久化”的收敛，满足 MOP‑1 的审计与对账要求，并保留灰度与一键回滚能力。

