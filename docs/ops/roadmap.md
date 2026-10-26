# 发展路线图 · Roadmap

当前版本：**v0.7.0-dev** — PMKB 权限模型、覆盖感知匹配、最小权限闭包/差分、风险组合图、主体能力跨 session RV 和 OpenClaw 单一审批契约已实现。PMKB `1.2.0` 的 79 条 native rules 立即参与运行时决策；47 条历史规则均有 native owner，迁移清单只用于 provenance/replay。

---

## ✅ 已完成 · Completed

| 里程碑 | 版本 | 内容 |
|--------|------|------|
| 语义理解增强 | v0.2.0 | SemanticEnhancer（DeepSeek LLM + 本地规则），7 维度标签体系，检测引擎语义优先模式 |
| 办公场景规则 | v0.2.0 | 5 条办公安全策略（邮件、日报、附件），47+ 语义规则 |
| 原生钩子拦截 | v0.2.1 | `api.on("before_tool_call")`，`requireApproval` 物理挂起，对齐官方 SDK 规范 |
| 审批结果同步 | v0.6.0 | OpenClaw 原生审批唯一入口，`onResolution` 回调 + SSE/增量查询更新 Guard Dashboard |
| 电路熔断器 | v0.2.1 → v0.7.0-dev | 健康检查与熔断状态；后端不可达、HTTP错误或响应不可解析时所有工具透传，恢复后回到正常策略 |
| RV 运行时验证 | v0.2.1 → v0.7.0-dev | ChainRule DSL 生成监视器，滑动窗口 10 步；手写 FSM 已退役 |
| 前端 RV 面板 | v0.2.1 | Trace 时间线、RV 状态面板、RV 模式开关 |
| **FastAPI HTTP 层** | **v0.3.0 → v0.7.0-dev** | `web/` 包统一 HTTP 服务；v0.7.0-dev 起为默认且唯一入口 |
| **Pydantic v2 模型** | **v0.3.0** | models.py 全部迁移至 BaseModel，自动验证 + 序列化，`to_dict()` 兼容别名 |
| **HTTP 双轨收敛** | **v0.7.0-dev** | FastAPI 为唯一入口，旧版 stdlib HTTP 实现已移出生产包 |
| **SQLAlchemyStore 可选存储** | **v0.3.0** | `storage/db_store.py` 内嵌 SQLAlchemyStore，`DB_STORE_MODE=sqlalchemy` 启用 ORM 存储 |
| **RV 规约驱动** | **v0.3.0 → v0.7.0-dev** | ChainRule DSL（`rv/rv_dsl.py` + `rv_rules.json`）编译监视器，唯一生产模式 |
| **IR 结构化透传** | **v0.4.0** | ToolCallIR（11 字段）+ 语义层实体/约束/置信度透传；现由 PMKB 原生谓词和 RV DSL 消费结构化证据，旧约束推理引擎已退役 |
| **基线自动机 + 参数化** | **v0.5.0** | BaselineLearner 偏离检测 + QEA 式 bind_vars + 实体守卫 + 时间原语 + 状态计数器 |
| **NL2Spec + RV 收敛** | **v0.7.0-dev** | Nl2SpecGenerator + SpecValidator 反例验证；生产 RV 仅回放成功执行窗口，不含 revise 或累计会话评分 |
| **PMKB 权限模型与跨 session RV** | **v0.7.0-dev** | PMKB 1.2.0（48 operations / 79 native rules / 47 migration owners / 76 traces / 9 relations / 123 vectors）、Authorization Trace、最小权限闭包/差分、RiskGraph、主体级状态持久化和 OpenClaw 单一审批契约 |

---

## 🔜 下一步规划

### DSH 插件（当前主线）

工程目录：[`dshRVguarder/`](../../dshRVguarder/README.md)，当前源码为 **0.2.0-rc.2 本地开发候选（未发布）**，支持 DSH `0.2.1-rc.2` / `0.2.1-rc.3`，协议 `dsh-guard-v2`。Windows 原生 Python 与 Linux/WSL 路径均保留，用户已确认后端启动、新 profile 接入和基础拦截正常。已公开的历史 rc.1 仍见 [GitHub Releases](https://github.com/HorizonExploration/RVguarder/releases)；此前门槛见 [v2 修复记录](../../dshRVguarder/docs/repair-2026-10-21.md)，当前交接与部署方式见 [阶段记录](../dev/dsh-progress-2026-10-26.md)。

当前仅完成基础接入阶段，后续待办如下，本轮不实施修复：

- [ ] DSH“插件”页中的展示和管理入口（DSH-UX-01）。
- [ ] Guard 工作台与 DSH 的界面、导航和认证整合（DSH-UX-02）。
- [ ] 环境准备、配套包安装及 Python 后端生命周期的部署简化（DSH-DEP-01）；现有脚本不等于一体化安装器。
- [ ] 复现本地规则模式频繁 ask，以及完全权限模式下被拦截的人工反馈（DSH-POL-01/02）；根因未定，不能标为已修复。
- [ ] 完成候选验收后，再按需决定是否通过 pre-release 分发匹配产物；源码 PR 和本地部署不依赖 Release。

> 2026-10-20 范围修订：RV、PMKB、基线扫描、Dashboard、LLM 增强与审计一并进入首个完整 DSH 版本。
> 实施建议调整为 **TypeScript 宿主适配 + Python 共享核心 + Preact 工作台**；Phase 0 验证部署与接口后定稿。DSH 默认 fail-closed，可配置 fail-open；OpenClaw 继续 fail-open。
> 完整工作包、验收矩阵与风险见 [DSH 全功能迁移计划](../architecture/dsh-plugin-migration-feasibility-2026-10-19.md)。

- [ ] **Phase 0：宿主与部署实测** — 版本锁定、工具字段/身份、native/PTC/子 Agent、审批/取消/共存、事件顺序、Python 3.13+、本地传输/服务生命周期、Dashboard 与平台/性能基线
- [ ] **Phase 1：共享核心与完整决策链** — HostAdapter、隔离 OpenClaw 初始化副作用、认证协议、DSH 工具映射、PMKB + RV + LLM/本地双模、DSH 原生审批、完成回写与审计
- [ ] **Phase 2：状态、基线与工作台** — 跨会话证据、去重/并发/恢复、DSH 专用扫描、JSON/HTML/PDF、Dashboard 核心页面/API/SSE/模式配置
- [ ] **Phase 3：全功能发布验收** — TS/Python/UI/规则配套发布、安装升级卸载、多平台与故障注入、回放/E2E、性能和 OpenClaw 回归

各阶段是同一版本的依赖顺序，不是裁剪功能；上述能力全部验收后才视为完整迁移交付。纯 TS 全量重写不列为首期实施路线。

### P0（OpenClaw 维护项）

- [x] **会话级作用域**（已完成）：RV 引擎按 `session_id` 隔离，不同 Agent 会话使用独立的滑动窗口和 DSL 监视器状态（`rv/runtime_verification.py` `_session_windows`）
- [x] **RV 引擎持久化**：主体/能力状态在 `runtime/rv-state.json` 恢复后再处理新 Hook，窗口状态仍按 session 隔离
- [ ] **熔断器告警**：熔断状态变更时通过 Webhook 或邮件通知运维（当前已具备状态和日志）

### P1（下一阶段）

- [ ] **用户自定义规则**：支持通过 `policies/` 配置结构化安全规则（JSON DSL）
- [ ] **规则受控更新**：支持离线回放、有限事件样本和可回滚的版本晋级（不设置自然日 shadow gate）
- [ ] **日志自动归档与轮转**：防止审计日志无限增长
- [ ] **更细粒度 API 健康检查**：区分后端、Gateway、LLM 三类健康状态

### P2（后续扩展）

- [ ] **VuePress 文档站 CI**：自动构建与部署
- [ ] **暗色模式与多端适配**：前端主题切换
- [ ] **运维策略模板**：更多预设安全策略模板
- [ ] **长期稳定性压测**：72 小时连续运行验证

---

## 已知边界

- 当前拦截范围是经过 `before_tool_call` 的工具路径，内部运行路径仍需补充覆盖
- Hook 插件注入后需要重启 OpenClaw Gateway 才能生效
- RV 的窗口大小（默认 10 步）在不同办公场景下可能需要动态调整
- `feishu_doc`/`feishu_wiki` 等频道工具在 Dashboard（WebChat）环境下不可见

## PMKB 发布门禁、指标与回滚

当前 `1.2.0` bundle 已直接接入运行时；高风险阻断、普通审批和明确低风险自动放行立即生效。
新规则或用户化偏好先通过离线规则/攻击向量回放，再进行最多 20 条相关事件的有限样本校验；个人模式也可通过一次显式确认立即启用范围受限的偏好。用户偏好不能降低既有安全下限。

以下指标用于新规则晋级、自动放行范围扩大和回滚判断，而不是基础 PMKB 的生效前置条件：

| 指标 | 目标 |
|---|---:|
| complete coverage（P0） | ≥85% |
| unknown rate | ≤10% |
| low-risk auto-allow precision | ≥99% |
| high-risk recall | ≥98% |
| total manual approvals | −40% |
| low-risk approvals | −60% |
| local evaluator P95 | ≤50 ms |

每个 outcome 都要带 `policy_version`、effect、匹配状态、证据字段和 timing；按事件计数进行比较，不设置自然日等待门槛。若发生 hard-risk false negative、bundle validation error 或 principal-state
merge anomaly，立即 disable 新 bundle version，rollback 到 previous catalog，并保留全部
audit records 供调查；修复后重新执行离线回放与有限样本校验。
