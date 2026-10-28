# DSH 宿主子代理工具隔离修复设计

日期：2026-10-28
状态：设计方案已获用户确认并复核
范围：DSH 0.2.1-rc.2 / rc.3

## 问题

当前 RVguarder 以 `plugins: []` 注册语义子代理 preset，并在 `startActivation()` 返回后检查 child 的工具 schema。DSH 的全局工具仍会被子 Agent 继承；空插件列表不能证明工具表为空。DSH 在 `startActivation()` 返回前会接受并唤醒首条子代理提示，因此事后检查无法保证首轮模型请求前完成隔离。能力探针也把空插件列表直接当作有效工具表为空。

此外，provider 能力检查没有校验 `inheritsParentContext === false`。DSH 对带独立 preset 的调用要求 provider 不继承父上下文；冲突 provider 可导致 UI 报可用、每次调用却回退本地分析。

## 目标

- 子 Agent 首轮提示接受前隐藏所有继承的全局工具。
- 通过 Agent 范围的单调 guard 拒绝任何意外出现的工具调用，包括后续新增的 scoped 工具。
- 只在限制插件成功装载且 provider 满足 DSH preset 前置条件时报告宿主子代理可用。
- 继续使用官方 `ctx.subagents.startActivation()` 和当前父 Agent 模型路由；失败时保持既有本地语义回退。
- 保留运行时 child schema 检查，作为隔离断言和诊断，不再把它当作首轮安全边界。

## 方案

在 `dshRVguarder` 包中新增专用 preset 插件子路径，例如 `dsh-rvguarder/semantic-tools-deny`。该插件在 preset 装载阶段运行于 Agent 的组合范围内：

1. 调用 DSH `tools.restrict({ allow: [] })`，让子 Agent 看不到继承的全局工具；空 allow 列表禁止全部全局工具，并能覆盖之后注册的全局工具。
2. 调用 `tools.presentAs('native')`，避免父 Agent 处于 PTC 模式时向语义子 Agent 呈现保留的 `run_code` 传输工具；RC.2/RC.3 均提供此 scoped API。
3. 注册 Agent 范围的单调 `tools.guard()`，拒绝任何工具执行，作为 schema 限制之外的执行防线。
4. 插件不注册工具，不读取宿主对话，不发起模型请求。

`HostSemanticDelegator` 还会在 `startActivation()` 前创建随机 child ID 并加入活动语义子 Agent 集合。宿主插件的 `tools/pre-execute` 监听器识别集合内 Agent 后立即拒绝调用，不再递归触发语义委派；宿主插件注册的全局单调 guard 也只对集合内 Agent 拒绝工具执行。该限制在 activation dispose 完成后解除。这样即使子 Agent 组合中意外出现 scoped 工具，也不会执行。

RVguarder 注册的私有 preset 改为只包含该插件。DSH 在创建 Agent 时装载 preset，因此限制和 scoped guard 会在发布 Agent、接受首条提示之前安装。能力探针通过 preset registry 的 `resolve()` 和 `inspectCompositions()` 确认内部插件已实际激活，而不是仅检查声明列表；只有确认后才报告准备就绪。`HostSemanticDelegator` 保留运行时 schema 检查；若 schema 非空或无法读取，则释放 activation、将隔离失败状态保持为不可用并回退本地分析。

Provider 能力条件增加 `provider.inheritsParentContext === false`。条件不满足时返回明确原因码，不启动子代理，并由前端现有状态面板显示不可用。

## 兼容与故障处理

- 不改变 Python 语义请求/响应协议、脱敏材料、PMKB/RV 决策、审计格式或 `auto` / `local` / `llm` 模式。
- DSH 包版本解析仍要求 subagent、preset registry、spawn provider 与支持的 DSH SDK 精确匹配；provider 还必须实现 `prepareContinuable()` 且明确声明 `inheritsParentContext === false`。
- preset 插件无法解析、限制或 guard 安装失败、provider 不兼容、子 Agent 工具表异常时，不使用 host-agent 结果，继续本地语义分析。
- 超时、取消与 activation dispose 继续沿用当前子代理生命周期；工具调用 guard 拒绝发生在工具执行阶段，不放宽原有 DSH fail-closed 语义。

## 前端与状态接口

沿用现有 `host_agent_available`、`host_agent_reason` 和 `effective_tools_empty` 字段，不新增前端 API。后端探针模型扩展固定 `provider_reason` 枚举并在有效时保留具体失败原因，避免拒绝新原因码或折叠状态。只有限制插件成功装载且其 preset 已验证时才将宿主子代理 selector 标为可用；运行时断言失败后，现有 HostPanel 展示原因并保留本地回退状态。

## 验证

- 单元覆盖：限制插件对全局工具使用空 allow 过滤、安装拒绝工具的 scoped guard；provider `inheritsParentContext` 为真时能力不可用；preset 声明包含内部限制插件；非空 child schema 导致 activation 释放并回退。
- DSH 集成覆盖：在支持的 rc.2 与 rc.3 环境中确认首轮模型调用前 child 的有效 schema 为空，新增 scoped 工具调用仍被 guard 拒绝。
- 回归覆盖：现有 DSH host-agent bridge、前端模式状态、本地回退、请求绑定和普通模式行为保持兼容。

## 验收标准

1. 有工具的父 Agent（包括 PTC 模式）启动 host-agent 子代理后，子 Agent 首轮模型请求中的工具 schema 为空。
2. 子 Agent 即使遇到意外可见的工具，也无法执行任何工具。
3. 不兼容 provider 或限制插件异常会显示不可用，并回退本地语义分析。
4. DSH rc.2 与 rc.3 的受控集成都通过；不依赖真实 API 密钥即可验证工具隔离边界。
