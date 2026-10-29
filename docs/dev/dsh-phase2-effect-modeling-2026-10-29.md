# DSH 阶段二：事件与效果建模交付说明（2026-10-29）

状态：阶段二完成。本阶段把"操作、预期效果、实际证据、授权证据"分开，并把无法观测的执行面显式标记为 partial。

## 一、分层模型（已实现）

| 层 | 承载 | 关键约束 |
| --- | --- | --- |
| 调用身份 | `BehaviorEvent.metadata.trusted_identity` + `dsh` 块 | 只来自宿主令牌；委派 `scope=null` 时不授予任何权限 |
| 规范操作 | `OperationRef` + `policy/selectors.py` | 参数参与选择；未登记子操作保持 `unknown_tool` |
| 预期效果 | `ToolCallIR.effects`（兼容并集）+ `EffectEvidence` | 执行前只有 `expected`/`potential`，绝不写 `observed` |
| 实际证据 | `Observation` + `EffectEvidence.status` | 认证成功 → `observed`（`host_report`，未核验）；收据才可 `verified` |
| 授权证据 | `AuthorizationTrace` + 多值 `ResourceRef.items` | 最小权限只在可验证维度比较 |

## 二、纯建模变更（不改变裁决）

| 提交 | 内容 |
| --- | --- |
| `a4d876f` | 资源类型词表归一（`file/directory/table/document → path`，`config → control_plane`）；`purpose` 不再作为执行约束，语义用途写入 `goal` |
| `c658d7c` | `EffectEvidence` / `Observation` 模型；`effects` 保留为预期并集 |
| `c7e1421` | 决策记录 v2：结构化权限差分、`execution_surface`、`effect_claim`、`observation` |
| `35aa62d` | `ResourceRef.items` 多值资源（target/destination/source/context）；旧字段仍显式赋值 |
| `3055eb1` | 类型化事实：`network.secret_payload`、`channel.admin` 改为结构化判定；关键字降级为 `*_mention` |
| `1d627ad` | 有序委派链与 `delegation{state, scope}`；未声明范围不授权 |

## 三、改变裁决的变更（逐条可回滚）

| 提交 | 变化 | 方向 | 回滚方式 |
| --- | --- | --- | --- |
| `3fee129` | `outcome_unknown` 不再被改写成 `failed` | 更准确（不虚构失败） | 恢复 `handle_after_tool_call` 调用 |
| `b742404` | 持久化位置改由资源证据判定 | 减少误报组合；不减少基础写入审批 | 恢复 family 子串回退 |
| `e7fde14` | 正文/命令文本不再产生资源 | 减少误判；可能使缺少路径键的调用变 partial→ask | 移除 `CONTENT_KEYS` 排除 |
| `d6af1d1` | `P0-DOCUMENT-READ` 加 scope/分类；敏感标记补全 | **收紧** | 恢复旧规则 |
| `8017a1c` | 操作族由参数选择 | 修正工具语义；未登记子操作变 ask | 移除 selector 调用 |
| `8cc9933` | `run_code`/非 bash 方言强制 partial | **收紧** | 移除 `_apply_unobserved_surface_gaps` 的两个分支 |
| `5d1d6de` | 别名规则可达 | **收紧**（`EX-19`、`NATIVE-GEN-006` 首次生效） | 恢复 `rules_for_operation` 旧逻辑 |
| `ccd89eb` | 成功完成后效果升级为 `observed` 并补标签；3 条链式规则要求已观测读 | 链式告警需真实完成；可能减少升级 | 撤回规则改动 + `_mark_step_observed` |
| `6310262` | 映射 v2：未声明入参/缺失来源 → partial；映射 exec 方言未知 | **收紧** | 只接受 v1 文件即可退回 |

## 四、证据

- 全量测试：`python -m pytest -q` → **887 passed, 12 skipped**（阶段二开始时 830 passed / 22 failed 已于上一阶段清零）
- 新增回归：37 → 57 项，覆盖资源词表、purpose、持久化、资源纯度、安全缺口、选择器、效果证据、覆盖降级、记录 v2、类型化事实、别名规则、多值资源、observed 迁移、映射 v2、委派。
- 归因复核（8 个冻结任务）：写入/执行的主导原因从 `permission_excess + combo_risk` 收敛为 `policy_requires_approval`，`unattributed` 从未出现。

## 五、已知限制

| 限制 | 说明 |
| --- | --- |
| 收据覆盖有限 | 只有 `rvguard_*` 受控工具能签发收据；其余步骤的 `observed` 来自宿主成功回调，`verified=false` |
| 规则迁移只覆盖 3 条 | 其余 monitor 仍按预期效果匹配；迁移需逐条正反例 |
| 委派范围未知 | 宿主不提供可验证委派范围，`scope` 恒为 `null`，因此委派不带来额外权限 |
| PTC 审批卡计数 | 仍只有代码链证据，需真实沙箱 |
| 真实宿主任务 | 本阶段验证仍在进程内完成，未运行真实模型任务 |

## 六、参考

Cedar schema 与部分求值、AgentDojo、CaMeL、FIDES、PACT、SARA、CAPMAS、Dogwood、Claude Code permissions 与 Hooks、DSH approval/tools 参考、MCP Tool Annotations、Saltzer & Schroeder。选用与拒绝理由见阶段二设计记录。
