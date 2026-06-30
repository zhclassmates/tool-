# leverageguard‑attestor — 文档重构蓝图 v1.0

> 目标：把零散笔记与工程约定沉淀为一套可持续维护、可审计、可扩展的文档体系；上线即用、对内对外统一口径；任何新人 30 分钟内可完成最小验证（smoke test）。

---

## 一、设计原则（落地口径）

- **四象限文档**：面向不同读者分四类——教程（Tutorials）、操作指南（How‑to）、参考（Reference）、解释（Explanation）。不要把“为什么/理念”写进“怎么做”的文档里。
- **单一事实来源（SSOT）**：
  - 合约地址/ABI → `packages/abi/addresses.json`、`packages/abi/*.json`
  - 后端 REST/OpenAPI → `apps/us-backend/openapi.yaml`
  - 术语/枚举/状态流转 → `docs/00-overview/glossary.md`
- **可运行为王**：每个 How‑to 至少包含一段“复制即跑”的脚本或命令；每个 Reference 都要有“最小请求→预期响应”样例。
- **安全默认开启**：所有步骤默认启用安全闸门；如果需要关闭，必须在文档里写明风险与回滚。
- **变更必留痕**：版本遵循 SemVer；变更进入 `CHANGELOG.md`；架构变更留 ADR；用户可据日志复现。
- **文档 DoD（Definition of Done）**：
  - 有上下文（背景/前置条件/边界）
  - 有步骤（含复制即用命令/脚本）
  - 有“预期结果/验证点/回滚方式”
  - 有风险提示与排障清单
  - 链接通过（CI 链接检查、Markdown Lint 通过）

---

## 二、总目录规划（Monorepo 与站点）

```
leverageguard-attestor/
├─ docs/                          # 主文档源（Docusaurus/MkDocs 二选一；默认 Docusaurus）
│  ├─ 00-overview/
│  │  ├─ index.md                 # 产品总览（读者画像/问题陈述/价值）
│  │  ├─ architecture.md          # 总体架构（含时序图/组件图/数据流）
│  │  ├─ glossary.md              # 术语表 & 状态机
│  │  └─ security-model.md        # 信任边界/威胁模型/安全闸门
│  ├─ 01-tutorials/               # 从零到一（30min 上手）
│  │  ├─ quickstart-local.md      # 本地 30 分钟跑通
│  │  └─ quickstart-cloud.md      # 云端一键验证（可选）
│  ├─ 02-how-to/                  # 操作指南（可组合）
│  │  ├─ run-smoke-test.md        # 烟囱测试（USDC→事件→入库→验证）
│  │  ├─ deploy-backend.md        # 部署 us-backend（含 env 校验）
│  │  ├─ deploy-jp-verify.md      # 部署 jp-verify（含 API Key 管理）
│  │  ├─ rotate-secrets.md        # 密钥轮换（流程/审计）
│  │  ├─ upgrade-contracts.md     # 合约升级（网关/地址/兼容性核对）
│  │  └─ incident-first-response.md # 故障首响与回滚
│  ├─ 03-reference/
│  │  ├─ api/                     # OpenAPI 生成或手写
│  │  │  ├─ openapi.yaml          # 源（SSOT）
│  │  │  └─ index.md              # 渲染入口（Redocusaurus/MkDocs+Redoc）
│  │  ├─ contracts/
│  │  │  ├─ checkoutusdc.md       # 事件/接口/错误码
│  │  │  └─ addresses.md          # Mainnet/Testnet 地址矩阵
│  │  ├─ data/
│  │  │  └─ schemas.md            # 表结构/索引/迁移约定
│  │  └─ env-variables.md         # 环境变量表（来源/作用/默认/风险）
│  ├─ 04-explanations/
│  │  ├─ pricing-model.md         # 风险定价与赔付逻辑（推导/边界）
│  │  ├─ verification-theory.md   # 交易所验真策略与取证
│  │  └─ fraud-prevention.md      # 反欺诈策略（等待期/限赔/黑名单）
│  ├─ 05-ops/                     # 运维 Runbook
│  │  ├─ probe-and-healthz.md     # 健康探针/SLO/报警
│  │  ├─ backup-restore.md        # 备份/恢复/演练
│  │  └─ release-checklist.md     # 发版清单（冻结→回归→发布→回滚）
│  ├─ 06-testing/
│  │  ├─ e2e-flow.md              # 端到端用例与验收
│  │  ├─ load-and-chaos.md        # 压测/故障注入
│  │  └─ test-matrix.md           # 交易所×杠杆×本金×边界条件矩阵
│  ├─ 07-contributing/
│  │  ├─ contributing.md          # 贡献指南（分支/提交/评审）
│  │  ├─ code-of-conduct.md       # 行为准则（可引用外部）
│  │  ├─ security-policy.md       # SECURITY.md（披露与响应时限）
│  │  └─ adr/                     # ADR 目录（决策沉淀）
│  ├─ 08-faq/
│  │  └─ index.md
│  └─ _assets/                    # 图示（Mermaid/PNG）
├─ leverageguard-docs/            # 文档站点工程（已存在）
├─ .github/
│  ├─ ISSUE_TEMPLATE/             # bug/feature/rfc 模板
│  ├─ PULL_REQUEST_TEMPLATE.md
│  └─ CODEOWNERS
├─ CHANGELOG.md                   # Keep a Changelog 格式
└─ ADR/                           # 与 docs/07-contributing/adr/ 同步或软链
```

> 说明：`docs/` 为内容源；`leverageguard-docs/` 负责渲染站点（Docusaurus）。OpenAPI 采用 `apps/us-backend/openapi.yaml` 为 SSOT，通过插件渲染到 `/docs/03-reference/api/`。

---

## 三、现有文档的归档与迁移映射

| 现有文件 | 迁移目标 | 备注 |
| --- | --- | --- |
| `README.md` | `docs/00-overview/index.md`（精简 README，仅保留电梯陈述 + 快速开始链接） | 首页做“产品卡片 + 30 分钟上手”入口 |
| `OPS_GUIDE.md` | `docs/05-ops/*` | 拆为探针、备份、发布回滚三篇 |
| `TESTING_STEPS.md` | `docs/06-testing/e2e-flow.md` | 增加断言与期望输出 |
| `USDC_AMOUNT_RULES.md` | `docs/03-reference/env-variables.md` + `docs/04-explanations/pricing-model.md` | 规则分“参考/解释”两类 |
| `PR_DESCRIPTION.md` | `.github/PULL_REQUEST_TEMPLATE.md` | 迁入 GitHub 模板体系 |
| `COMMIT_MESSAGE.md` | `docs/07-contributing/contributing.md` | 汇入 Conventional Commits 样例 |
| `CONTRACT_CHANGELOG.md` | 合并进根 `CHANGELOG.md`（合约专章） | 标注合约地址与事件变更 |

---

## 四、关键页面大纲（写作骨架）

### 1）Quickstart（`docs/01-tutorials/quickstart-local.md`）
- 目标：30 分钟本地跑通“支付→事件→入库→验证”
- 前置：Node 20+、Python 3.10+、pnpm、Base RPC、USDC 测试金
- 步骤：
  1. 克隆与安装 → `pnpm -w install`
  2. 环境拷贝 → `cp apps/*/.env.sample .env`
  3. 启动服务 → backend / jp-verify / listener
  4. 触发最小支付（脚本或前端）
  5. 验证点：日志关键行、数据库行数、/healthz
- 预期结果：5 个勾（事件、入库、状态流转、校验、健康探针）
- 故障排查：RPC 不可达、密钥缺失、回放高度错误

### 2）架构（`docs/00-overview/architecture.md`）
- 组件图：us-backend、chain-listener、jp-verify、contracts、DB
- 时序：下单→扣款→事件→监听→入库→取证→理赔
- 数据：核心表（orders、claims、evidence、contract_events）与索引
- 边界：信任边界、外部依赖（CEX API、Base 节点、存储）

### 3）API 参考（`docs/03-reference/api/`）
- `openapi.yaml` 自动渲染，保留示例与错误码
- 每个端点配“请求/响应示例 + 常见 4xx/5xx + 幂等/重试策略”

### 4）合约参考（`docs/03-reference/contracts/checkoutusdc.md`）
- 事件字段、错误码、权限（Owner/Attestor/Policy）
- 地址矩阵（Mainnet/Testnet）与变更历史（链接到 CHANGELOG）

### 5）安全模型（`docs/00-overview/security-model.md`）
- STRIDE 威胁建模（逐模块）
- 凭据管理与最小权限
- 取证与审计（可复核性、日志留存、证据哈希）

### 6）发版清单（`docs/05-ops/release-checklist.md`）
- 冻结窗口/回归用例/DB 迁移/兼容性/回滚计划/验收人
- 发布后验证项（探针、错误率、事件积压、账实对账）

### 7）ADR 模板（`docs/07-contributing/adr/0001-template.md`）
- 背景 → 决策 → 备选 → 取舍 → 后果 → 状态（Accepted/Superseded）

---

## 五、工程化与自动化

- **文档站点**：
  - 推荐继续使用 `leverageguard-docs/`（Docusaurus），启用：
    - OpenAPI 渲染（Redocusaurus 或 docusaurus‑openapi‑docs）
    - Mermaid 支持（架构/时序图）
    - 版本化（仅在稳定里程碑启用，避免早期维护成本）
- **CI 质量闸门**：
  - Markdown Lint、拼写/专有名词检查（可选 textlint 规则）
  - 链接检查（外链/站内链接）
  - OpenAPI 校验（lint + 示例响应）
- **社区与治理**：
  - `.github/ISSUE_TEMPLATE/`：Bug、Feature、RFC 三模板
  - `CODEOWNERS`：按目录分配评审人；与分支保护联动
  - `SECURITY.md`：私密披露渠道、SLA、受支持分支
  - `CHANGELOG.md`：Keep a Changelog；与发布脚本联动

---

## 六、任务拆分（两周落地版）

**Day 1‑2** 目录搭建 + 迁移映射落地（空文档 + 骨架）  
**Day 3‑4** Quickstart（脚本化）+ Smoke Test 文档  
**Day 5** API OpenAPI 首版 + 渲染上线  
**Day 6** 合约参考页 + 地址矩阵（对齐 `packages/abi`）  
**Day 7** 安全模型初稿 + 运行探针  
**Day 8** 发版清单 + 回滚剧本  
**Day 9** ISSUE/PR 模板、CODEOWNERS、SECURITY.md  
**Day 10** 链接检查/文本规范接入 CI + 全量走查

---

## 七、写作规范（最小集）

- 标题句式（Sentence case），动词开头，避免冗词。
- 命令行前置「前置条件」与「预期输出」。
- 每节末尾留“排障”和“回滚”。
- 图片尽量用 Mermaid 生成（可读、可 diff）。

---

## 八、附：模板片段

### 1）Runbook 模板
```
# 目的
# 触发条件
# 前置条件
# 操作步骤（含脚本）
# 验证点（指标/日志/接口）
# 回滚步骤
# 风险与影响
```

### 2）API 端点条目模板
```
## POST /api/v1/orders
用途：创建订单（pending）→ 等待事件对账
请求：示例 JSON + 必填字段表
响应：201 样例 + 错误码表
幂等/重试：Idempotency-Key/签名
安全：鉴权方式/权限范围
```

### 3）ADR 模板（0001-template.md）
```
# 标题
- 状态：Accepted | Proposed | Superseded
- 日期：YYYY-MM-DD
## 背景
## 决策
## 备选方案
## 取舍分析
## 影响与后果
## 相关链接
```

---

## 九、验收标准（通过即合并）
- 新人按 Quickstart 能在 30 分钟内复现 smoke test。
- API/合约/环境变量均可从单一页面找到，且与代码一致。
- CI 报告：链接检查通过；OpenAPI 校验通过；模板文件生效。
- CHANGELOG/ADR 同步更新，至少包含本次文档重构记录。

---

## 十、后续演进（可选）
- 文档版本化（稳定里程碑后落地）。
- 站内搜索/多语言（中文/英文）。
- 将“证据与理赔”流程做成交互式教程（Sandpack/Playground）。

