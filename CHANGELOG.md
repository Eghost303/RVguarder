# v0.7.0-dev 工程统一与文档清查

## 2026-10-28 — DSH 独立审查与平台整包（0.2.0-rc.4，本地候选）

- 独立核对 f3990e8 并填写 UI 任务书第13节：原交付5项通过、3项不通过、5项待整改，未把rc.2 UI/故障矩阵判为通过。
- 修复默认 bundle 表达式、内嵌下载字节、实际实例范围、管理身份/错误状态/流式限额、重连与 E2E 清理。
- 新增按平台冻结的完整后端与宿主进程托管，Windows x64新安装无需Python/源码/手动后端；最终tgz真实rc.3页面/下载/凭据扫描8/8、冻结运行时生命周期5/5、保护/管理/迁移29/29。修复pnpm Windows长路径启动及快速重启竞争。
- Python相关123项通过；扩展Node十并发出现一次连接超时、专项复跑通过，真实PTC沙箱仍跳过，不声称全量全绿。Linux/arm64整包、完整桌面生命周期/迁移/故障矩阵与POL-01/02仍待验收。未发布、未推送。

## 2026-10-26 — DSH 原生部署与 rc.3 接入阶段交付（0.2.0-rc.2，本地候选）

- Python 后端支持 Windows 原生 Python 与 Linux/WSL Python；Windows 使用原生 ACL/文件句柄处理私有状态和资源证据，不限定 Python 安装渠道。
- DSH 适配明确支持 `0.2.1-rc.2` / `0.2.1-rc.3`，使用实际 SDK 版本握手，复用现有桌面运行时；协议保持 `dsh-guard-v2`。
- 新增桌面 SDK 提取、同版本声明补齐、独立 profile 安装、后端启动、真实宿主冒烟和配套构建工具；Uvicorn 加速扩展移入可选 `performance` 组。
- 适配阶段记录：Windows 原生专项112通过，SDK24通过/1沙箱跳过，共享回归92项分组核对；真实桌面 profile 加载/认证握手和 wheel 隔离安装检查通过。这不是本轮全量测试重跑。
- 用户人工核验确认后端启动、新 profile 接入和基础拦截正常；同时报告插件页不可见、工作台未嵌入、部署繁琐，以及本地模式频繁 ask / 完全权限模式下被拦截。规则现象待复现定位，本阶段未修复这些问题。
- 当前仅整理源码进度，不创建 Release；源码部署/PR 不依赖 Release，后续可选以 pre-release 分发同批次 wheel/tgz。本阶段不是正式安全验收或开箱即用产品，交接与部署说明见 [阶段记录](docs/dev/dsh-progress-2026-10-26.md)。

## 2026-10-21 — DSH 插件 0.2.0-rc.1（协议 `dsh-guard-v2`）

- 协议升级到 `dsh-guard-v2`：认证调用携带父调用、父会话、签名快照与可选完成收据，旧协议直接拒绝；普通工具结果不上传正文。
- 新增签名内容收据（ContentReceipt / ContentVersion）与受控工具 `rvguard_read` / `rvguard_copy` / `rvguard_transform` / `rvguard_send`；读取限制为工作区相对路径、单文件 256 KiB、拒绝符号链接，复制与变换只写独占新建文件。
- 受控外发默认禁用：需后端 `runtime/dsh-evidence.json` 与插件 `egressAllowlist` 双端精确 HTTPS 匹配，并在每次 dispatch 消耗宿主签发的单次授权（TTL ≤ 300 秒，`grant_cli` issue / query / revoke）。
- fail-open 改为独立旁路审计队列（含开始/结束事件），恢复后幂等补交；写盘失败在探针中标记审计缺口，不写 RV 成功历史。
- 新增内核文件锁、插件目录锁、schema/实例/工作区/profile 绑定；新增 45 秒时效宿主探针（工具清单、账户、审批服务、Windows ACL）。
- 新增离线维护入口 `maintenance`：`inspect`、`reconcile --completion --confirm`、`bind-task`，独占实例数据、不重跑工具、不清库。
- 启动/重连握手改为 15 秒心跳，移除逐调用重复 `hello`；保留 dispatch 风险重评估与历史补交。
- Dashboard 隐藏 DSH 不适用的清空历史与技能管理，HTTP 失败不再提示成功；SSE/轮询移到公共布局并支持重连补快照。
- 验证：Python 795 passed / 18 skipped，Node 25 项，DSH 浏览器 8 项、OpenClaw 12 项；Windows 20 次合成只读调用均值 134.33ms、p95 160.78ms（LLM 关闭）。
- 发行产物输出到 `dist/dsh-rvguarder-0.2.0-rc.1/`，并通过 GitHub Releases 以 pre-release 发布。`0.2.0-rc.1` 仍有 7 项正式发布门槛未通过，不代表全功能适配完成。

## 2026-10-20 — DSH 插件 0.1.0 适配

- 新增 `dshRVguarder/`：DSH 0.2.1-rc.2 的 TypeScript 薄插件（`tools/pre-execute`、单调 `guard()`、完成 outbox）与 `clawRVguarder/hosts/dsh/` 共享 Python 核心。
- 发行产物输出到 `dist/dsh-rvguarder-0.1.0/`：插件 tgz、Python wheel、`INSTALL.md`、测试 profile 生成器与 SHA-256 清单。
- 已在 Windows 与 WSL 原生 DSH 上验证加载与握手；SDK 管线单测 12/12，WSL 侧 358.9ms。
- 新增 WSL 原生部署说明与 9.6 验收状态；DSH 默认 fail-closed，可显式配置 fail-open。

## 2026-10-20 — Python 主包目录迁移

- 将 `openclaw_guard/` 重命名为 `clawRVguarder/`，同步 Python 导入、CLI、构建资源、测试和文档引用。
- 保留发行名和 `openclaw-guard` 命令、数据库/缓存名称及 OpenClaw Hook 协议标识；已有 editable 安装需重新执行 `python -m pip install -e .`。
- 新增 `docs/dev/project-memory.md`，作为后续开发的架构与状态记忆入口。


**日期**：2026-09-09
**当前口径**：FastAPI 单入口、PMKB `1.2.0`、三态 RV、OpenClaw 原生审批唯一入口

## Checkpoint / Guard UX 升级

- OpenClaw 审批卡片改为展示“要做什么 / 目标 / 风险”的短摘要；完整命令、参数和规则证据留在 Guard 页面，默认脱敏。
- 低风险工作区只读命令支持精确 `allow-always`：绑定工具、完整参数、工作目录和已验证 agent/principal，敏感目标与未收敛参数不会开放，默认 30 天，可在设置页撤销。
- Guard 动作页和 Trace 时间线改为摘要卡 + 分区折叠；新增精确授权列表、过期和撤销入口，Hook 动作仍不提供第二审批按钮。
- FastAPI `--port 0` 在当前 Uvicorn 版本下改为预分配临时端口，恢复端到端冒烟启动能力。
- 清理依赖退役检测路径的 A/B/C 与 AgentDojo 执行器、绑定测试、方案和环境说明；实验产物按约定不纳入仓库。

## 当前状态

- 生产决策统一为 `allow / ask / block`；`ask` 只由 OpenClaw 原生审批承接，Guard Dashboard 只读同步。
- `ConstraintEngine`、累计会话风险和 `revise` 已退出生产路径；RV 只对有效窗口做执行前预览，并在成功 `after_tool_call` 后提交主体证据。
- PMKB 当前包含 48 个 canonical operations、79 条原生规则、47 条迁移归属、76 条 Trace、9 条关系和 123 个回归向量；迁移清单仅用于 provenance/replay，不生成第二套运行时规则。
- 旧版 stdlib HTTP 服务已从生产代码移除；历史方案、实验结果和现场证据保留在 Git 历史中，不参与当前文档站导航。
- 文档导航、代码路径、测试示例和架构描述已按当前代码复核；本轮验证为 Python `412 passed / 19 skipped / 4 subtests passed`、Playwright Chromium/Firefox 各 `5 passed`、前端构建通过、VuePress 渲染 40 页。

---

# 修复记录：RV 落地优化（P0→P1→P2）

**日期**：2026-08-14  
**关联版本**：v0.3.0

---

## 一、更新背景

v0.3.0 落地了「NL→Automata RV 升级方案」（阶段 A–F），但审计发现存在 7 处「验收标准打折」，其中置信度门控失效、revise 干预未落地、ask→escalate 升级链缺失属 High 级异常。本次按审计报告整改方案（P0→P1→P2）完成全部修复，确保升级项真实落地。

---

## 二、修复内容

### P0（高危修复）

- **E3 置信度门控失效**：`constraints.py` 的 `confidence_threshold` 默认值 `0.0→0.5`，`evaluate()` 改为基于 `ToolCallIR.confidence` 语义置信度门控（旧数据无 confidence 按中性 0.5 处理）
- **E2 ask→escalate 升级链缺失**：`SessionSafetyState.record()` 新增连续 3 次 ask 自动升级为 escalate

### P1（规格补齐）

- **E1 revise 干预落地**：`_apply_session_escalation()` 达阈值返回 `revise` 并透出 `revision_hint`；`DetectionDecision` 新增 `revision_hint` 字段；`controller` 映射 revise→`pending_approval`；Hook 返回 `revision_hint`
- **E4 补齐约束类型**：新增 `SensitivityConstraint` / `TemporalConstraint` 并挂载 `ConstraintEngine`，五类约束齐备
- **E5 补齐 ToolCallIR 字段**：补齐 A1 语义模型七字段（tool_name/arguments/permission_level/side_effect/sensitivity/irreversibility/intent，全部可选，向后兼容）
- **E6 前端 revise 交互 + 会话状态展示**：工作台展示修正建议 + 「采用建议」按钮 + 会话状态展示

### P2（清理）

- **E7 过时注释**：清理 `constraints.py` 中引用已删函数的死注释

### 收尾整改（审计报告遗留项）

- **规则双轨一致性测试**：`migrated_constraint_rules()`（10 条）与 `detection.builtin_rules()` 对应规则保留双定义，新增 `tests/test_constraints.py::test_migrated_rules_align_with_detection` 逐字段对齐断言，任一漂移即失败，同步维护成本由 CI 兜底
- **性能冒烟基准**：新增 `tests/test_perf_smoke.py`，覆盖约束引擎/RV 引擎/会话状态三个纯内存热路径（宽松阈值 50ms）。本机实测：约束引擎 0.07ms/次、RV 引擎 0.08ms/次、会话状态 1000 次 0.75ms

---

## 三、影响范围

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| 约束推理引擎 | `openclaw_guard/rv/constraints.py` | 修复 + 新增约束 |
| IR 模型 | `openclaw_guard/rv/ir.py` | 字段补齐 |
| 会话状态 | `openclaw_guard/spec/session_state.py` | 升级链补齐 |
| 决策模型 | `openclaw_guard/models.py` | 新增字段 |
| 编排层 | `openclaw_guard/engine/pipeline.py` | revise 干预 |
| 管控层 | `openclaw_guard/engine/control.py` | revise 映射 |
| 前端 | `frontend/src/components/ActionCard.jsx` / `i18n.js` / `styles.css` | revise 交互 + 会话状态 |
| 测试 | `tests/test_constraints.py` / `tests/test_perf_smoke.py` | 规则双轨一致性 + 性能冒烟基准 |
| 文档 | Git 历史 | 历史审计报告；旧核验清单可从 Git 历史追溯 |

---

## 四、注意事项

1. **revise 为新增干预动作**：`DecisionAction` 由四级（allow/ask/escalate/block）扩展为五级（含 revise），revise 裁决进入 `pending_approval` 状态，前端可一键采用修正建议
2. **ToolCallIR 新字段全部可选**：`tool_name/arguments/permission_level/side_effect/sensitivity/irreversibility/intent` 均默认 None，旧 rv_trace 完全向后兼容
3. **规则双轨由 CI 兜底**：10 条迁移规则保留两处定义，一致性测试保证任何一侧改动另一侧未同步时立即失败
4. **测试回归**：344 passed / 18 skipped / 0 failed（较 v0.3.0 基线 331 增加 13 个用例）

---

# v0.3.0 版本更新说明

**日期**：2026-08-01  
**版本号**：v0.3.0  
**前一版本**：v0.2.1

---

## 一、更新背景

v0.2.1 基于 Python 标准库 `http.server.ThreadingHTTPServer` 提供 HTTP 服务，路由通过字典手动维护，所有数据模型使用 `@dataclass` + 手动 `to_dict()`。随着端点数量增长（22+），手动路由管理和序列化成为最大的技术债务。v0.3.0 分两个阶段解决这些问题。

---

## 二、阶段一：HTTP 层替换

### FastAPI 替代 stdlib HTTP 服务

- **新建 `openclaw_guard/web/` 包**：FastAPI 应用工厂 + 依赖注入 + 路由模块 + 统一异常处理 + SPA 静态文件托管
- **双 HTTP 层并存**：默认仍使用旧版 `legacy_web.py`（原 `web.py` 重命名），通过 `--fastapi` flag 切换到 FastAPI
- **桥接模式**：新路由通过包装现有 `api._handlers` 函数保证响应格式一致，业务代码零变动
- **新增 `--fastapi` CLI flag**：`python -m openclaw_guard.main run --fastapi --port 8781`

**涉及文件**：
- 新建：`web/` 包（`app.py`, `dependencies.py`, `errors.py`, `routes/` 7 个模块）
- 修改：`main.py`（`--fastapi` flag + 延迟导入）
- 重命名：`web.py` → `legacy_web.py`
- 更新：`pyproject.toml`（新增 `fastapi`, `uvicorn` 依赖）

---

## 三、阶段二：Pydantic 模型迁移

### `@dataclass` → `pydantic.BaseModel`

- **`models.py` 全部 10 个数据类迁移至 Pydantic v2**：`BehaviorEvent`, `DetectionDecision`, `ControlledAction`, `AuditRecord` 等
- **`ControlledAction.__post_init__` 移除**：Pydantic 原生支持嵌套 dict 自动转换为嵌套模型
- **`EventStatus` 新增 `"allow"` 兼容状态**：解决 `manager._execute()` 中的运行时赋值
- **`ActionType` 新增 `"unknown"` 兜底类型**：容错外部原始 payload
- **`to_dict()` 保留为兼容别名**：30+ 调用点无需修改，内部委托给 `model_dump()`
- **`ComplianceReport.to_dict()` 保留 computed `summary` 键**

**涉及文件**：
- 重写：`models.py`
- 修复：`tests/test_semantic_enhancer.py`（2 个断言同步 SEM-OFFICE-001/002 迁移）

---

## 四、附带清理

- 删除死代码 `ActionService.ingest()`（75 行，零调用方）
- 删除死代码 `_action_from_mapping()`（18 行，零调用方）
- 删除 25 个孤立 `.pyc` 字节码文件
- 更新 `CLAUDE.md`、`README.md`、`pyproject.toml`、`__init__.py` 至 v0.3.0
- 同步 `docs/architecture/` 文档（index, overview, target-architecture, architecture-analysis）

---

## 五、注意事项

1. **默认 HTTP 层不变**：`openclaw-guard run` 仍使用旧版 stdlib 服务，FastAPI 通过 `--fastapi` 选择性启用
2. **Pydantic 模型向下兼容**：`to_dict()` 别名保留，所有现有代码的序列化行为不变
3. **业务代码零改动**：`manager.py`、`engine/`、`core/`、`storage/`、`integrations/` 未修改一行
4. **测试回归**：162 个测试中 146 通过（9 个失败为环境相关预存问题，7 个跳过为旧版 chat mirroring）


---

# v0.2.1 版本更新说明

**日期**：2026-07-25  
**版本号**：v0.2.1  
**前一版本**：v0.2.0

---

## 一、更新背景

v0.2.0 的 Hook 插件使用了已废弃的 `api.registerHook()` API，`requireApproval` 返回格式与 OpenClaw 官方 Plugin SDK 规范不兼容，导致钩子拦截完全失效——工具调用无法被挂起，Guard 后端也收不到任何事件。v0.2.1 按官方 `api.on()` 规范全面重构钩子，并实现 OpenClaw 原生审批 UI 与 Guard Dashboard 之间的双向状态同步。

---

## 二、核心改动

### 1. 钩子 API 迁移：`api.registerHook()` → `api.on()`

**修改文件**：[`openclaw_guard/integrations/hook_runtime.py`](openclaw_guard/integrations/hook_runtime.py)

- 插件中全部 3 个钩子（`before_prompt_build`、`before_tool_call`、`after_tool_call`）从已废弃的 `api.registerHook("event", handler, opts)` 迁移为官方 `api.on("event", handler, opts)` API
- 生成的插件 JS 通过 `node --check` 语法验证

**影响范围**：Hook 运行时插件代码生成

---

### 2. `requireApproval` 格式对齐官方规范

**修改文件**：[`openclaw_guard/integrations/hook_runtime.py`](openclaw_guard/integrations/hook_runtime.py)

- 移除 `allowedDecisions`（非官方字段），添加 `timeoutBehavior: "deny"`（官方字段：`"allow"` | `"deny"`）
- `onResolution` 回调使用官方类型化决策值：`"allow-once"` | `"allow-always"` | `"deny"` | `"timeout"` | `"cancelled"`
- 事件上下文从 `event.context` 获取（`agentId`/`sessionKey`/`sessionId`），兼容 `hookCtx` 回退
- fail-closed 模式下返回硬阻块（`block: true`）替代残缺的 `requireApproval`，避免 OpenClaw 展示损坏的审批 UI
- 插件清单中 `runtimeExtensions` → `extensions`，新增 `activation.onStartup: true`

**影响范围**：钩子拦截行为、审批卡片展示

---

### 3. 双端状态同步机制

**新增/修改文件**：
- [`openclaw_guard/integrations/openclaw_adapter.py`](openclaw_guard/integrations/openclaw_adapter.py) — 新增 `resolve_plugin_approval()` 函数
- [`openclaw_guard/manager.py`](openclaw_guard/manager.py) — `approve_action` / `reject_action` 中调用同步

- **OpenClaw → Dashboard**（Push 模式）：插件 `onResolution` 回调直接 POST `/api/hook/resolve-approval`，后端同步更新动作状态
- **Dashboard → OpenClaw**（Gateway 远程调用）：审批/拒绝时通过 `openclaw gateway call approvals.resolve` 异步通知 OpenClaw 原生审批系统放行/拒绝
- Gateway 调用采用 `threading.Thread` 异步执行，不阻塞 UI 响应
- 回退机制：`approvals.resolve` 方法不存在时自动尝试 `plugin.resolveApproval`

**影响范围**：审批同步、用户体验

---

### 4. 后端 `resolve_hook_approval` 处理函数修正

**修改文件**：[`openclaw_guard/api/_handlers.py`](openclaw_guard/api/_handlers.py)

- 字段名兼容：同时接受 `actionId`（camelCase）和 `action_id`（snake_case）
- 决策值兼容：同时接受 `allow-once`（官方连字符格式）和 `allow_once`（旧版下划线格式）
- `timeout`/`cancelled` 统一走 reject 路径
- 异常处理细化：`KeyError`/`ValueError` → 400，其他异常 → 500

**影响范围**：Hook 回调 API

---

### 5. 遗留代码清理

**修改文件**：[`openclaw_guard/manager.py`](openclaw_guard/manager.py)

- 移除 `_hook_waiters` 字典和 `_hook_waiters_lock`
- 移除 `_register_hook_waiter`、`_signal_hook_waiter`、`_clear_hook_waiter` 方法
- 移除 `handle_before_tool_call` 中 `threading.Event` 创建逻辑

**原因**：基于 `threading.Event().wait()` 的阻塞方案已被 OpenClaw 原生 `requireApproval` 挂起机制替代，残留代码无实际作用。

**影响范围**：manager.py（主协调层）

---

## 三、影响范围汇总

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| 钩子插件模板 | `openclaw_guard/integrations/hook_runtime.py` | 重构 |
| Gateway 适配器 | `openclaw_guard/integrations/openclaw_adapter.py` | 修改 |
| 主协调层 | `openclaw_guard/manager.py` | 修改 + 清理 |
| HTTP API | `openclaw_guard/api/_handlers.py` | 修改 |
| 运行时插件 | `runtime/openclaw-guard-plugin/index.js` | 自动重新生成 |

---

## 四、注意事项

1. **插件需重新生成**：重启 Guard 服务或执行初始化时，插件会自动重新生成到 `runtime/openclaw-guard-plugin/`
2. **Gateway 重启**：插件 JS 内容变更后需重启 OpenClaw Gateway 使新钩子生效
3. **双端同步为异步**：Dashboard 审批时同步 OpenClaw 使用后台线程，不阻塞前端响应
4. **回退兼容**：`resolve_plugin_approval` 在 Gateway 方法不可用时静默降级，不影响审批本身
5. **决策值格式**：`onResolution` 回调传递的是官方类型化决策值（连字符格式），后端已做双格式兼容

---

# v0.2.0 版本更新说明

**日期**：2026-07-14  
**版本号**：v0.2.0  
**前一版本**：v0.1.0

---

## 一、更新背景

v0.1.0 的检测引擎依赖关键词、前缀和路径匹配进行风险判定，无法理解用户自然语言中的约束条件（时间范围、作用域、排除条件等），也无法识别办公场景中的语义意图。v0.2.0 的核心目标是引入语义理解增强层，在不替换现有 47 条快速规则的前提下，将输入理解从"关键词命中"提升为"意图、约束、Trace 和上下文联合判定"，并全面重构检测引擎以支持语义优先决策模式。

---

## 二、核心改动

### 1. 语义理解增强（核心变更）

**新增模块**：`openclaw_guard/integrations/semantic_enhancer.py`

- 新增独立的 `SemanticEnhancer` 语义层模块，采用双模式架构：
  - **LLM API 模式**：对接 DeepSeek Chat API（`deepseek-chat` 模型），实现真实语义理解
  - **本地规则化降级**：LLM 调用失败、超时或返回非 JSON 时自动降级到本地启发式规则
- API key 加载优先级：构造函数参数 → 环境变量 `DEEPSEEK_API_KEY` → `runtime/guard-config.json` 配置文件
- 语义标签体系覆盖 **7 个维度**：
  - 基础（base）
  - 命令（command）
  - 路径（path）
  - 网络（network）
  - 配置（config）
  - 渠道/技能（channel / skill）
  - 办公场景（office_scenario）
- 识别 **5 种办公场景**：`mail_send` / `mail_read` / `report_send` / `report_generate` / `attachment_download`
- 输出结构：`semantic`（结构化语义结果） + `rv_trace`（RV 层可消费的直接输入）

**影响范围**：检测引擎、manager 主链、审计链路

---

### 2. 检测引擎重构

**修改文件**：`openclaw_guard/integrations/detection.py`

- `DetectionEngine.evaluate()` 决策流程重构为 **语义优先模式**：
  1. **办公场景策略优先判定**（`_office_decision()`）：5 条办公安全策略规则（`SEM-OFFICE-001` ~ `SEM-OFFICE-005`），在语义标签匹配后最早执行
  2. **语义标签规则匹配**（`_semantic_predicates()`）：47 条规则从原始字符串匹配切换为结构化语义标签匹配（label-based）
  3. **兜底决策层**（`_fallback_decision()`）：保留原有 fallback 逻辑，作为最后兜底
- `DetectionEngine.__init__()` 内嵌 `SemanticEnhancer(api_key="")` 实例，确保评测链路自包含
- 新增 `_ensure_semantic_payload()` 方法，优先从 `event.metadata` 获取语义结果，未命中时自动调用增强器
- 决策追踪链（`trace`）记录完整决策路径：`semantic → office_policy / semantic_rules / default → decision`

**影响范围**：所有经过检测引擎的动作判定

---

### 3. 主链接入

**修改文件**：`openclaw_guard/manager.py`

- 三个入口统一接入语义增强：
  - `ingest_event()`：聊天文本入口
  - `handle_before_tool_call()`：Hook 工具调用前拦截入口
  - `reply_scan`：回复扫描入口（路径内已有）
- 新增 `_annotate_event_context()` 方法，统一语义标注逻辑
- 语义结果写入 `event.metadata["semantic"]` 和 `event.metadata["rv_trace"]`，随事件透传到检测引擎和审计链路
- `OpenclawGuardManager.__init__()` 初始化 `SemanticEnhancer` 实例，从 `runtime/guard-config.json` 加载配置

**影响范围**：manager.py（主协调层）

---

### 4. 打包配置

**修改文件**：`pyproject.toml`

- `[tool.setuptools.packages.find]` 从静态包列表 `include` 切换为自动发现子包 `include = ["openclaw_guard*"]`，支持子包自动纳入打包

**影响范围**：构建与分发

---

### 5. 文档体系

**新增文件**：
- `docs/semantic/method.md` — 语义理解增强方案，包含目标与问题、当前真实链路分析、方案设计
- `docs/Sematic/development-plan.md` — 分阶段开发计划（阶段 0~4），阶段 1（语义层最小落地）已标记完成（已于 v0.3.0 文档整理时移除，方案并入 `docs/semantic/method.md`）

**更新文件**：
- `docs/improve/` 下多份文档随项目结构变化同步更新（project-structure.md、project-overview.md 等）

**影响范围**：文档站与开发者参考资料

---

### 6. 测试覆盖

**新增文件**：`tests/test_semantic_enhancer.py`（7 个测试用例）

- 覆盖语义增强器输出结构验证（`semantic` + `rv_trace`）
- 覆盖 manager 接入链路：`ingest_event()` 语义标注附加
- 覆盖检测引擎集成：语义输入 → 规则匹配 → 决策输出
- 使用 `unittest.mock` 模拟 LLM API 响应

**修改文件**：`tests/test_detection.py` — 对齐测试入口路径

**影响范围**：自动化测试套件

---

## 三、影响范围汇总

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| 语义层 | `openclaw_guard/integrations/semantic_enhancer.py` | 新增 |
| 检测引擎 | `openclaw_guard/integrations/detection.py` | 重构 |
| 主协调层 | `openclaw_guard/manager.py` | 修改 |
| 打包配置 | `pyproject.toml` | 修改 |
| 文档 | `docs/semantic/method.md` | 新增 |
| 文档 | `docs/Sematic/development-plan.md` | 新增（已于 v0.3.0 文档整理时移除） |
| 文档 | `docs/improve/*.md` | 更新 |
| 测试 | `tests/test_semantic_enhancer.py` | 新增 |
| 测试 | `tests/test_detection.py` | 对齐 |

---

## 四、注意事项

1. **LLM 依赖为可选**：未配置 `DEEPSEEK_API_KEY` 或 `guard-config.json` 中无 API key 时，`SemanticEnhancer` 自动使用本地规则化模式，不影响核心功能运行
2. **降级行为透明**：LLM 调用失败、超时（默认 10s）、返回非 JSON 时自动降级，调用方无需感知
3. **检测引擎行为变更**：v0.2.0 的 `DetectionEngine.evaluate()` 决策顺序已调整为语义优先，依赖旧版匹配顺序的外部代码需要验证兼容性
4. **event.metadata 扩展**：事件对象新增 `semantic` 和 `rv_trace` 字段，审计存储和导出链路已自动适配
5. **子包打包**：`pyproject.toml` 改为自动发现子包后，新增子包无需手动更新打包配置
6. **Python 版本要求**：保持 `>=3.13` 不变
7. **办公场景规则优先级**：5 条办公安全策略规则（`SEM-OFFICE-001` ~ `SEM-OFFICE-005`）在语义标签判定后优先执行，可能在 47 条常规规则之前返回决策结果
