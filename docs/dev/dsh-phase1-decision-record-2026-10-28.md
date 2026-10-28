# DSH 阶段一：逐调用决策记录与审批归因（2026-10-28）

状态：阶段一观测层交付。只增加记录与归因，**不修改放行策略**。

## 交付内容

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| 原因码词表 | `clawRVguarder/policy/reasons.py` | 11 个有效码 + 1 个未归因哨兵，固定优先级 |
| 策略裁决携带原因码 | `clawRVguarder/policy/models.py`、`policy/evaluator.py`、`policy/engine.py` | 只保留真正决定最终效果的分支 |
| 逐调用决策记录 | `clawRVguarder/engine/decision_record.py` | 在 `event.metadata["decision_record"]` 生成，随动作记录持久化 |
| 冻结任务集 | `tests/fixtures/dsh_normal_tasks.json` + `tests/test_dsh_attribution.py` | 8 个正常开发任务，内容哈希固定 |
| 单元回归 | `tests/test_decision_record.py` | 原因码优先级、未归因哨兵、公开记录不回传 |

## 原因码

按优先级从高到低：

| 优先级 | 码 | 含义 |
| ---: | --- | --- |
| 1 | `hard_block` | 明确禁止行为，直接阻断 |
| 2 | `backend_failure` | 决策服务不可达或响应不可解析 |
| 3 | `unknown_tool` | 工具/操作未映射到 canonical operation |
| 4 | `scope_unknown` | 作用域无法判定 |
| 5 | `permission_excess` | 请求权限超出最小权限闭包 |
| 6 | `grant_invalid` | 已有授权不适用于本次调用 |
| 7 | `combo_risk` | 跨操作组合关系命中 |
| 8 | `missing_evidence` | 覆盖不完整、事实冲突或证据可信度不足 |
| 9 | `rv_escalation` | 跨步或主体 RV 提高了风险等级 |
| 10 | `host_approval` | 宿主原生审批发起 |
| 11 | `policy_requires_approval` | 规则本身要求审批且证据充分 |

`unattributed` 是**哨兵值而非有效原因**，不在有效词表内；出现即表示某条分支漏了归因，阶段一验收把它计为"未知原因"，不能用默认值掩盖。

设计取舍：

- **只归因决定最终效果的分支**。每个候选效果连同原因码与具体程度一起记录，取与最终效果相同的分支，再按"规则 > 组合 > 权限差分 > 覆盖 > 授权 > 工具映射"排序，`reason_codes[0]` 即支配码。次要原因保留在列表中供诊断，但不会抢占统计。
- **`hard_block` 优先级最高**，阻断不会被同时存在的差分或缺证归因成"仅需审批"。
- **`deciding_layer` 独立记录**：`policy` / `rv` / `principal_rv` / `whitelist` / `approval_trust`。动作由 RV 抬升时支配码是 `rv_escalation`，不是原策略码。
- **`reason_codes` 不参与 `replay_hash`**，新增归因口径不改变历史回放哈希。
- **审批发起方与通道分开**：`initiator` 恒为 `guard_policy`（是 Guard 决定要审批），`channel` 才是 `host_native` / `openclaw_native`。不能把宿主通道当成审批发起方。
- 决策记录只保存在内部动作记录与审计中；公开 Hook 记录会剔除它，避免身份、会话、任务标识回传宿主。

## 本机归因结果

语义模式 `local`，DSH 0.2.1-rc.3 SDK，隔离临时 profile。任务集内容哈希：`faf22c4bb2fc1d7f82e66149943ebdb6c38cbd04fa0b9dfdd3f89273c3d8a8fb`。

| 任务 | 结果 | 层级 | 规范操作 | scope | 支配原因码 | 全部原因码 |
| --- | --- | --- | --- | --- | --- | --- |
| workspace-read | allow | policy | file.read | workspace | — | — |
| workspace-search | allow | policy | process.execute | workspace | — | — |
| workspace-edit | ask | policy | file.write | workspace | `policy_requires_approval` | `policy_requires_approval`, `combo_risk`, `permission_excess` |
| workspace-create | ask | policy | file.write | workspace | `policy_requires_approval` | 同上 |
| project-test | ask | policy | process.execute | workspace | `policy_requires_approval` | `policy_requires_approval`, `permission_excess` |
| project-build | ask | policy | process.execute | workspace | `policy_requires_approval` | 同上 |
| public-fetch | ask | policy | network.egress | external | `policy_requires_approval` | `policy_requires_approval` |
| unmapped-tool | ask | policy | unknown_tool | workspace | `unknown_tool` | `unknown_tool` |

**验收：每一次审批都有真实原因码，"未知原因"计数为 0；未归因哨兵未出现。**

## 结果解读

1. **写入与执行的阻碍是策略设计，不是证据缺失**。`P1-FILE-WRITE` / `P1-PROCESS-EXECUTE` 本身就要求审批，支配码是 `policy_requires_approval`。要降低审批率必须走阶段三的任务授权，而不是修证据。
2. **`combo_risk` 在每一次写入上都出现**。`COMBO-FILE-PERSISTENCE-001` 的 `persistence_location` 对任何 write 族都为真，实际等于"所有写入都是持久化组合"——这是阶段二要收敛的规则粒度问题。
3. **`permission_excess` 作为次要原因伴随写入与执行**。规则 trace 声明 `resource_type=file/command`，TraceCompiler 产出 `path`/资源，差分因此判定为超出最小权限。这很可能是"假超范围"，属于阶段二事件与效果建模。
4. **`network.egress` 的 scope 已正确为 `external`**，且没有额外的组合或差分噪声。
5. **未映射工具落在 `unknown_tool`**，符合"未知不自动放行"。

## 观测缺口

| 缺口 | 说明 |
| --- | --- |
| DSH 原生审批无 request id | DSH 审批请求只带工具名与原因，`approval.request_id` 记录为 `null`；不能伪造 ID |
| 适配插件版本 | 协议不携带插件版本，`tool.adapter_version` 保持 `null`，只记录 `backend_version`；`host.sdk_version` 取最近一次握手值 |
| OpenClaw 侧无 call/parent 标识 | 聊天与 Hook 路径没有 call 树，相关字段保持 `null` |
| 宿主发起的 ask/deny | 下游监听器或宿主原生审批产生的 ask 不回传后端，只体现在动作状态上 |
| OpenClaw 后端故障 | 该路径严格 fail-open 且不写决策记录，`backend_failure` 在 OpenClaw 上不可观测 |
| DSH 桥接错误原因 | HTTP 409 的具体原因在插件侧被折叠成统一的 fail-closed 文案，未逐条落库 |
| PTC 内层审批卡计数 | 仍只有代码链证据，需真实沙箱实测 |
| 任务成功率与延迟分布 | 当前只驱动 `/before`，未执行工具，因此不统计执行结果 |

## 兼容性

- 旧动作记录没有 `decision_record` 与 `reason_codes`，读取方必须按"未记录"处理，不能默认为安全或自动放行。
- `PolicyDecision.reason_codes` 是新增可选字段，`replay_hash` 已排除该字段，历史回放哈希保持不变。
- 归因只读决策，不回写效果选择；`action` / `effect` / `rule_ids` 的计算路径未改变。
