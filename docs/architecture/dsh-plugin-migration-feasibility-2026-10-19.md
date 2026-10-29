# DSH 插件迁移调研与开发计划：安全现状、生态与可行性评估

> 历史阶段记录：版本、命令和结论保留为当时快照。当前版本 **v0.2.1-rc1**，安装请使用 [现行指南](../deployment/dsh.md)，验收以 [本轮发布记录](../dev/release-v0.2.1-rc1.md) 为准。

> 调研日期：2026-10-19 ｜ 状态：调研完成、开发决策已确认，Phase 0 实测未开始
> 关联文档：[RVguarder 安全能力与防护边界总报告](../rvguarder-security-capabilities-and-boundaries.md)、[RV 权限自动机架构](./rv-permission-automata.md)、[RV vs 主流 Agent 安全工具对比](../comparison/rvguard-vs-agent-security-tools.md)
> 目的：在正式开发 DSH 插件之前，确认「轨迹上用自动机监视规则违反」这套机制在 DeepSeek Harness（下称 DSH）上是否仍然成立、价值落点在哪里、有哪些硬约束。

> **2026-10-20 范围更新**：用户要求首个完整 DSH 版本同时迁移 RV、PMKB、基线扫描、Dashboard、LLM 语义增强与审计。第 9 节为当前实施计划，替代 2026-10-19 的 RV 优先、纯 TS 方案。第 0–8 节保留原调研背景，其中外部产品信息与历史性能数据仍须在锁定的 DSH 版本上复核。

## 0. 结论摘要

**判定：有条件可行。机制在 DSH 上仍然有用，但价值重心发生迁移，且必须重新设计失败策略与状态持久化。**

三条支撑结论：

1. **DSH 内置安全能力比 OpenClaw 强，但强在「单步 + 内核/ACL 沙箱」而非「跨步」**。DSH 用沙箱模式（`read-only`/`workspace-write`/`danger-full-access`）加文件系统围栏，直接覆盖了「越界写入 / 危险文件操作」这一类单步风险；RVguarder 在 OpenClaw 上靠规则拦截的这部分，在 DSH 上边际收益明显下降。
2. **DSH 完全不存在跨步链式策略，且沙箱明确不覆盖网络外发**。沙箱 seam 自述「不表达网络、进程、系统调用、设备或凭据限制」；审批 seam 是**逐调用、一次性、不携带工具参数、不可撤销**的。这意味着「低信任来源成功历史 → 后续受控外发 / 脚本执行 / 控制面变更」这类链式与来源追踪规则，恰好落在 DSH 的能力空白上——正是 RV 引擎的差异化部分。
3. **扩展点足够支撑迁移**。`tools/pre-execute` 是官方支持的可扩展 allow/deny/ask 门禁（实验性的 Auto review 已用同一机制实现逐调用评审），配合 `ctx.tools.guard()`、`tools/post-execute`、`tools/result`、`approval/request`、`session/event` 与 `session-projection`，RV 的输入、状态折叠、决策与观测四个环节都有对应实现位置。

三条必须先解决的问题：**pre-execute 不允许改写参数**（只能放行/拒绝/询问，净化要改为 block 或走 `post-execute`）；**DSH 官方 seam 一律 fail-closed，而 RVguarder 现为 fail-open**，插件作为唯一守卫时必须显式取舍；**会话日志是逐会话的，主体级跨会话状态需要插件自持久化**。

---

## 1. DSH 当前的安全机制与安全水位

### 1.1 官方定位：实验性、未审计

DSH 仓库根目录 [SAFETY.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.zh.md) 原文：

> DeepSeek Harness 是实验性的开发者预览软件。它尚未接受安全审计，不得视为安全或可用于生产环境的软件。
> ……错误的模型输出、缺陷、配置错误、恶意输入或不可信插件可能损坏宿主计算机、修改或删除文件、泄露数据或凭据，或造成其他非预期影响。
> 沙箱、审批提示与权限控制可以降低风险，但不保证隔离，也不能保证防止损害。
> 不要把 DeepSeek Harness 当作不可信工作负载唯一的安全控制措施。

该文档同时把「加载第三方插件」列为风险来源，并建议「在允许运行前检查插件、配置和拟执行命令」。

**对迁移的含义**：DSH 官方不宣称任何安全保证，因此第三方安全插件不是「与官方能力竞争」，而是填补官方明确声明不覆盖的部分。这为 RVguarder 类插件留下了正当且必要的定位空间。

### 1.2 分层安全机制清单

| 层 | 机制 | 关键约束（一手来源：本地运行时各包 README 与源码） |
| --- | --- | --- |
| 子进程沙箱 | `dsh-sandbox` + `dsh-sandbox-local` + `dsh-bash-sandbox` / `dsh-pwsh-sandbox` | 模式 `read-only` / `workspace-write` / `danger-full-access`；无可用后端时以 `SANDBOX_UNAVAILABLE` **失败关闭**，绝不无约束放行；强制执行完整度逐调用报告 `full`/`partial`，**Windows ACL 受限令牌后端属于 partial** |
| 文件系统围栏 | `dsh-fs-sandbox` | 按会话沙箱模式限制 `write`/`edit`；`read-only` 全拒，`workspace-write` 仅允许工作区根与平台临时区；定位是「**可信代码中检查模型控制路径的策略，而非内核边界**」 |
| 审批 | `dsh-user-approval` | 策略仅 `ask`/`never`；`ask` 交给已组合的应答者 waterfall，无应答者则 `unavailable` 并以拒绝方式关闭；**只有一次性授权**（`allowed-once`），无 allow-always、无规则记忆、无撤销、无授权存储；**请求不携带工具参数**（仅工具名、原因、可选 callId）；请求必须处于未结束轮次内 |
| 权限预设 | `dsh-permission-presets` | 只捆绑「沙箱模式 + 审批策略」两个旋钮；`custom` 只能推导，`auto` 由 Auto review 层占用 |
| 模型逐调用评审 | `dsh-experimental-auto-review` | 实验层、**默认关闭**；在 `tools/pre-execute` 前置 listener 中由当前模型评审，`allow` 后以 Full access 执行，`deny` 转人工审批；自述「可能误放行不安全动作、误拒绝有用操作，并消耗额外 token」 |
| 钩子桥接 | `dsh-hook-protocol`（Claude Code / Codex 桥接） | 仅 command handler 会运行；退出码 2 阻塞，其他退出码非阻塞失败；合并策略 `deny > ask > allow` |
| 审计基线 | 会话事件日志（`dsh-session`）、Trajectory 视图 | 追加式事件溯源日志记录每个模型可见事实；Trajectory 是其可视化投影（按轮次分组、工具参数与结果、计时、token 用量） |
| 插件安装 | `dsh-plugin-manager` / 插件市场 | 管理操作要求 `danger-full-access` 或本次调用批准；**已安装的宿主代码在宿主进程内运行，不受工作区沙箱限制** |

### 1.3 关键结构缺口（迁移的价值来源）

1. **没有跨步/有状态策略**：审批逐调用、预设只管两个旋钮、沙箱是逐调用文件策略。任何「先 A 后 B 再 C」的链式判定都没有内置机制。
2. **不覆盖网络外发**：沙箱 seam 自述其策略词汇仅含文件操作，不含网络、进程、系统调用、设备与凭据限制。凭据/数据出网在 DSH 层没有策略位置。
3. **审批证据贫乏**：审批请求不携带工具参数，人类应答者看到的是工具名与原因；参数级证据必须由插件自己投影进 `reason`/`displayReason`。
4. **单步规则生态拥挤、跨步空白**：见第 4、5 节。

---

## 2. DSH 此前暴露的风险与缺陷记录

### 2.1 公开安全公告：无

以 GitHub Security Advisory API 查询 `@deepseek-ai/dsh` 与 `dshmarket`，返回空列表；官方仓库 `has_issues = false`（**issue 追踪被关闭**），`open_issues_count = 0`。因此**不存在官方的公开问题追踪渠道**，社区缺陷只能通过插件仓库、讨论区与目录生态间接观察。

### 2.2 官方事故复盘（postmortem）：4 篇，均非安全漏洞

`docs/postmortem/` 明确其收录标准为「出现在不该出现的地方（真实用户、已合并 PR、已发布版本）」的隐蔽系统性缺陷：

| 编号 | 标题 | 性质 |
| --- | --- | --- |
| 0001 | ACP 服务器在连接时崩溃：`export default` 丢失了插件的 `inject` | 插件装载正确性 |
| 0002 | 文件系统快照工具被一个字面量 `!!js` 对象永久禁用 | 条件式配置语义；**并暴露一条安全相关事实**：ACP 组合刻意只启用 bash，「因为其沙箱无法约束进程内的文件系统提供方」，且「权限控制只应描述其实际管辖的能力」 |
| 0003 | Web agent 验证了替代服务器，而非承载其会话的 GUI | 验证方法学 |
| 0004 | Landlock 部分强制执行通知导致子进程失败被误归类 | 沙箱失败**归因**（明确说明「该缺陷没有削弱约束，也没有让命令在无约束状态下运行」，影响在可用性与诊断完整性） |

**结论**：DSH 有公开的缺陷复盘文化，但**没有任何一篇是安全漏洞**；同时 0002 与 0004 说明沙箱能力与真实执行路径之间存在需要逐项核验的缝隙。

### 2.3 生态侧的风险信号（间接证据）

虽无官方漏洞记录，生态中自发出现了大量以「DSH 自身不安全」为前提的插件，构成需求侧证据：

- 插件供应链静态体检：`dsh-audit`（对 dsh-plugin 话题包做四维评分 + 静态安全扫描高危一票否决）、`dsh-code-security`（40+ 规则、密钥熵、SARIF）。
- 提示注入防护：`dsh-security-guard`（恶意代码 / 提示注入 / 令牌浪费静态扫描 + 运行时拦截）、`QinpanWan/dsh-prompt-antivirus`（"global prompt-injection / context-virus defense"）、`dsh-secure-audit`（提示注入检测 + 中文 PII 脱敏）。
- 审计与取证：`qiushi-dsh-evidence-audit`（把工具结果与会话事件 receipt 写入**本地哈希链 JSONL**，不保存提示词、参数、结果正文与原始会话 ID）。
- 官方自述的插件信任边界（插件在宿主进程内、不受沙箱约束）与 `dsh-plugin-manager` 要求 Full access 才能管理插件，共同说明**插件自身就是最大的信任边界**。

**证据强度声明**：以上均为「无公开漏洞公告 + 官方自述未审计 + 生态需求信号」的组合，**不能反推 DSH 存在已知未修复漏洞**；本报告不主张任何具体漏洞的存在。

---

## 3. DSH 安全插件生态现状

### 3.1 规模

社区目录索引（`dsh-plugin-catalog`，经 jsDelivr 于 2026-10-19 拉取）共 **2953 条**插件，其中 `metadata.category === "security"` 共 **85 条**（分类量级：ui 535、tools 381、session 203、dev 201、workflow 190、model 173、usage 151、memory 129）。再加上 tools/dev 分类中承担安全职责的插件（如自动审批、内容策略、沙箱增强），实际具备安全语义的插件在 150 条以上。

**判断**：安全插件已是 DSH 生态中的成熟赛道，用户预期已被建立；但同时意味着「单步规则/自动审批/审计日志」这几类位置**已高度拥挤**，差异化必须落在别人没做的地方。

### 3.2 分型与代表插件

以下描述均来自目录中的**作者自述**，**未经实测**。

| 分型 | 代表插件 | 自述机制 |
| --- | --- | --- |
| 单步规则策略 | `dsh-permission-rules` | Claude Code 风格声明式 YAML 规则，在 `tools/pre-execute` 瀑布上按序 allow/deny/ask，匹配工具名、参数、工作区路径与 agent 身份；带会话日志审计、干跑模式与热重载 |
| | `@amaster.ai/dsh-policy` | 可配置 allow/deny/ask 规则控制工具调用，含 shell 命令匹配 |
| | `@mrweicodes/dsh-permgate` | 细粒度权限网关：按分类（工作区外目录/命令/读写文件/子代理/重复操作）逐项审查，全局+项目双级黑白名单、自定义规则、审批弹窗、沙箱升级流程 |
| 风险评分与熔断 | `dsh-risk-guard` | 静默记录每次工具调用并做纯规则风险评分（累积加分、风险等级分布、归档保留期清理），只拦不可逆灾难（受保护路径删除、磁盘擦除、force push、凭据外发） |
| | `dsh-riskproof` | 实时安全浮标，随工具调用更新防护状态，可查看调用统计、**风险来源链**与拦截结果，支持只读任务约束与工具元数据变化检测 |
| 模型化审批 | `dsh-approval-llm`、`@dnalec/dsh-auto-approve`、`@log.li/dsh-automode`、`@nanmicoder/dsh-auto-mode`、`@duke-dsh-plugins/dsh-agent-approval` | 由独立审查模型/子代理应答审批，含关键词红线、分级分类器、熔断器、拒绝引导、Auto 权限档 |
| 审计与取证 | `qiushi-dsh-evidence-audit` | 工具结果与会话事件 receipt 写入本地**哈希链 JSONL**，不保存提示词、参数、结果正文与原始会话 ID |
| | `@goodandready/dsh-shadow-auditor` | 后台安全审计器：扫描 Agent 输出中的秘密泄漏，执行前检查命令安全性，发现写入持久审计日志 |
| 内容策略 | `dsh-plugin-content-policy` | 工具结果的预防式内容策略：改写命中文本、按字段路径整段丢弃或截断，让未审查载荷在被规范化/渲染/落盘前进不去；随包为真空操作 |
| 供应链体检 | `dsh-audit`、`dsh-code-security`、`dsh-security-guard` | 插件评分/静态扫描/高危一票否决；代码安全审查；DSH 守卫的静态扫描 + 运行时拦截 + `/scan` + 白名单 |

---

## 4. 同类/相近插件对比与空白点

### 4.1 逐项对比（最接近的六个）

| 能力维度 | RVguarder（OpenClaw） | `dsh-permission-rules` | `dsh-risk-guard` | `dsh-riskproof` | `dsh-permgate` | `qiushi-dsh-evidence-audit` |
| --- | --- | --- | --- | --- | --- | --- |
| 规则形态 | ChainRule DSL（`rv_rules.json`）+ PMKB 79 条原生规则 | 声明式 YAML | 纯规则评分 | 未披露（浮标/统计向） | 分类 + 黑白名单 | 无策略 |
| 跨步/有状态时序 | **有**（滑动窗口 10 步 + 会话隔离 + 主体级跨会话证据） | 无（逐调用匹配） | 部分（累积加分） | 部分（来源链） | 无 | 无 |
| 来源/血缘追踪 | **有**（低信任来源成功历史驱动） | 无 | 无 | 自述有来源链 | 无 | 仅记录 receipt |
| 反例验证闭环 | **有**（SpecValidator + trace 库） | 无 | 无 | 无 | 无 | 无 |
| 审计完整性 | **SHA-256 哈希链 + DB/JSONL 双写** | 会话日志 | 归档保留期清理 | 统计与拦截结果 | 会话日志 | 哈希链 JSONL |
| 精确授权契约 | **有**（宿主签发、绑定资源版本/目的地/时效） | 无 | 无 | 无 | 无 | 无 |
| 决策输出 | allow / ask / block（RV 可独立升 block） | allow/deny/ask | 拦截（仅灾难） | 只读浮标 | allow/deny/ask | 只读 |

### 4.2 空白点

对目录全量描述做「自动机 / automaton / 状态机 / 时序验证 / 跨步 / 滑动窗口 / runtime verification / 链式 / provenance / 来源链」检索，命中的 16 条中**没有一条是安全策略引擎**（多为主题、桌宠、科研工作台等无关命中），唯一实质相关的是 `dsh-riskproof` 的「风险来源链」，但其自述停留在「统计、来源链展示、拦截结果」，**未披露规约 DSL、状态机建模或反例验证**。

**结论**：
1. **DSH 生态当前没有「DSL 编译的有状态自动机 + 跨步轨迹时序验证」实现**；
2. 单步 allow/deny/ask 规则、模型化审批、审计日志三类位置已被充分占据，**不应作为 RVguarder 迁移后的主打卖点**；
3. 差异化应落在 **跨步链式规约 + 来源/授权证据 + 可回放反例验证** 这一组组合能力上。

---

## 5. RVguarder 能力 → DSH 扩展点映射

| RVguarder 组件 | DSH 对应机制 | 可行性 |
| --- | --- | --- |
| `before_tool_call` 拦截 | `tools/pre-execute` waterfall，返回 `{ kind: 'allow' \| 'deny' \| 'ask' }`，`ask` 支持 `reason` 与 `displayReason` | 直接对应 |
| `requireApproval` 物理挂起 | `ask` 决策 → `dsh-user-approval` → `approval/request` waterfall | 直接对应，但**只有一次性授权**，无"记住本次授权" |
| 强制阻断 | `deny`（附原因）或 `ctx.tools.guard()`（单调、后续监听器无法翻回 allow） | 直接对应 |
| ToolCallIR（结构化中间表示） | 由 `exec`（工具名、冻结后的已解析参数、callId、agent、signal）+ 会话事件字段投影 | 可行；注意 pre-execute **不可改写参数** |
| ChainRule DSL / WindowManager | `session-projection` 的 `register({key, stateSchema, stateVersion, init, apply, wire})`：`apply` 做窗口折叠，`stateVersion` 管规约版本 | 可行，且是官方推荐的「不自行重放日志」路径 |
| 成功历史（仅回放成功执行窗口） | `tools/result` 只读观测 + `session/event` 观察者 → 折叠进投影 | 可行；`eventAt/snapshotEvents/ownEvents` **已弃用，禁止新增生产调用** |
| 会话隔离 | 每个 `Session` 独立事件日志与投影 cell | 天然对应 |
| 主体级跨会话状态（`rv-state.json`） | 无内置等价物：会话日志是逐会话的，需插件自有 storage domain 持久化 | 可行，需自建 |
| 审计哈希链 | 自建存储（可复用会话日志事件作为输入） | 可行 |
| 输出侧干预（脱敏/改写） | `tools/post-execute` 可替换内容或值、附加上下文 | 可行 |
| PTC 内层工具调用 | 内层调用同样经过 `tools/pre-execute`（Auto review 即同时覆盖原生与 PTC inner 调用） | 可覆盖，需实测确认 |
| Trace 时间线 UI | `dsh-client-ui-trajectory`（会话事件的客户端投影，纯投影、不读写 Chat 快照） | 无需自建；插件可贡献投影供其消费 |

---

## 6. 可行性评估

### 6.1 分维度结论

| 维度 | 结论 | 依据 / 残余约束 |
| --- | --- | --- |
| 拦截时机 | **可行（强）** | `tools/pre-execute` 在参数校验后、分发前运行；`ctx.tools.guard()` 提供单调否决 |
| 参数可见性 | **可行（强）** | `exec` 携带冻结的已解析参数；模型参数在执行前已被校验 |
| 参数改写/净化 | **不可行（硬约束）** | 官方明确「`tools/pre-execute` 有意不允许改写 `exec.arguments`」，否则日志与呈现参数会和实际运行内容失去同步；净化只能改为 block，或在 `tools/post-execute` 处理结果侧 |
| 结果侧净化 | **可行** | `tools/post-execute` 可替换内容或值；但「替换内容不会移除程序化调用方可读取的规范值」，真正禁止需阻止执行 |
| 决策与审批 | **可行** | `ask` + `reason`/`displayReason`；可注册 `approval/request` responder 做机器应答（模型化或规则化） |
| 历史与状态 | **可行，需换路径** | 必须走 `session/event` + `session-projection`；同步读取 API 已弃用 |
| 跨会话/主体状态 | **可行，需自持久化** | 无内置跨会话证据，需插件 storage domain + 自己的合并与版本语义 |
| PTC 模式覆盖 | **大概率可行，待实测** | Auto review 已同时覆盖原生与 PTC inner 调用，说明内层调用不绕过 pre-execute |
| 语言与进程 | **两条路线均可，需择一** | ① 纯 TS/Node 插件（与宿主同进程，零 IPC，但需重写 RV/DSL 与规则数据）；② TS 薄插件 + 复用现有 Python 后端（RV、PMKB、审计全保留，但需 HTTP/IPC 桥接；且 **DSH 随附的托管 Python 运行时实测为 3.12.14，低于本项目要求的 Python 3.13+**，复用后端须自带 3.13 解释器、或先完成 3.12 兼容性验证） |
| 失败策略 | **必须显式取舍（高优先级）** | DSH 官方 seam 一律 fail-closed（无后端即拒绝）；RVguarder 现为严格 fail-open。作为「唯一守卫」时 fail-open 会形成无防护窗口，需在插件配置中给出明确默认值并写入文档 |
| Windows 强制执行 | **受限（残余风险）** | Windows ACL 受限令牌后端为 `partial` 强制执行；研究环境为 Windows，须在报告中标注为残余风险而非已解决项 |
| 性能预算 | **待实测** | 现有 OpenClaw 实测 p95 增量 381 ms（超过其 50 ms 预注册目标）；DSH 侧尚未测量，需作为独立验收项 |

### 6.2 判定

**有条件可行。** 扩展点、输入可见性、决策与审批、历史读取四条主链路全部有官方支持；阻碍项集中在「参数不可改写」「fail-open 取舍」「跨会话状态自建」「Windows 部分强制执行」四项可设计、可文档化的工程约束上，均不构成机制性否决。

### 6.3 「这套机制还有没有用」的正面回答

- **单步部分收益下降**：DSH 沙箱 + fs 围栏已覆盖越界写入与危险文件操作，RVguarder 在这一层的增量价值小于 OpenClaw（OpenClaw 无同类内置沙箱）。
- **跨步部分价值上升**：DSH **没有任何跨步策略**，且沙箱**明确不管网络外发**。RVguarder 经实验验证的攻击类别中，A02（外部说明诱导 HTTP 上传）、A03（先获批后扩大范围）、A04（编码/打包后外发）、A05（引入脚本后执行）、A07（凭据读取后外发）、A08（跨会话继续外发）都属于「单步合法、组合非法」，恰好是 DSH 结构上无法覆盖的部分。
- **授权证据部分价值持平或上升**：DSH 审批「只有一次性授权、无授权存储、请求不带参数」，因此「许可绑定资源版本与目的地、撤销与过期不可复用」这类证据模型在 DSH 上同样是空白。

---

## 7. 风险、未决问题与迁移前置验证清单

### 7.1 当前决策与待验证项（2026-10-20 更新）

1. **迁移范围已确定**：RV、PMKB、基线扫描、Dashboard、LLM 语义增强和审计一并进入首个完整版本；阶段划分表示依赖顺序，不表示将某项推迟到后续发布。
2. **技术路线调整建议**：DSH TypeScript 适配插件 + Python 共享核心服务 + 现有 Preact Dashboard。纯 TS 全量重写暂不作为首期实施路线；Python 3.13+ 的分发、启动、认证、延迟与故障恢复须通过 Phase 0 实测后形成架构决策记录。
3. **失败策略保留**：DSH 默认 fail-closed、可显式配置 fail-open；现有 OpenClaw 仍严格 fail-open。需区分核心决策服务不可用与可选 LLM 不可用，详见第 9 节。
4. **插件共存待验证**：确认其他安全插件与自动审批组合后的门禁顺序、硬拒绝不可降级及避免重复审批。
5. **平台能力待验证**：以锁定版本实测 native/PTC、子 Agent、取消/并发和 Windows partial 边界；对未支持的工具或扫描项输出明确状态，不能算通过。

### 7.2 迁移前必做的实测项（建议按序）

1. 用最小插件在 `tools/pre-execute` 检查 `exec` 字段结构，确认工具名、参数、callId、agent、会话标识的可得性与形状；调试输出仅保留字段名、类型和脱敏样例；
2. 验证 `ask` 决策在 Web 客户端审批卡片中的 `reason`/`displayReason` 呈现，以及 `deny` 后模型可见的失败文案；
3. 验证 `session/event` 与 `session-projection` 在工具调用前后的事件顺序，确认「成功历史」可在下一次调用前稳定读到；
4. 验证 PTC 模式下内层工具调用确实经过 pre-execute；
5. 实测 Windows 沙箱的 `partial` 边界，记录可绕过与不可绕过的写入场景；
6. 测量 pre-execute 监听的平均与 p95 增量延迟，建立 DSH 侧性能基线；
7. 与其他同类插件同时启用，观察决策合并与审批重复情况；
8. 按全量迁移建议路线，验证自带或指定 Python 3.13+ 解释器、服务生命周期和本地认证；历史调研中的 DSH 托管 Python 3.12.14 不能假定满足本项目要求。

---

## 8. 证据来源与检索限制

### 8.1 来源

| 类型 | 具体来源 |
| --- | --- |
| 本地运行时（一手） | `…\DeepSeek Harness\resources\app.asar` 内 `dsh/node_modules/@deepseek-ai/` 各包 README 与编译产物（`dsh-sandbox`、`dsh-sandbox-policy`、`dsh-fs-sandbox`、`dsh-user-approval`、`dsh-permission-presets`、`dsh-experimental-auto-review`、`dsh-tools`、`dsh-session`、`dsh-session-projection`、`dsh-plugin-manager`、`dsh-client-ui-trajectory`）；desktop runtime 版本 `0.2.1-rc.2`（构建于 2026-10-17） |
| 官方仓库（一手） | `https://github.com/deepseek-ai/deepseek-harness`：`SAFETY.zh.md`、`docs/postmortem/`（4 篇）、`docs/subsystems/`、`packages/experimental/hook-protocol/`；`has_issues=false` |
| 公开公告 | GitHub Security Advisory API：`@deepseek-ai/dsh`、`dshmarket` 均无记录 |
| 社区目录（作者自述） | `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（2026-10-19 拉取，2953 条）；本地缓存 `.dsh/profiles/desktop/.dsh-market/discovery-compatibility-v1.json` |
| 本项目档案 | [RVguarder 安全能力、具体攻击案例与防护边界总报告](../rvguarder-security-capabilities-and-boundaries.md)、[发展路线图](../ops/roadmap.md)、[运行时 Hook 实现](../features/runtime-hook.md)、[RV vs 主流 Agent 安全工具对比](../comparison/rvguard-vs-agent-security-tools.md) |

### 8.2 检索限制（如实声明）

1. 本会话的通用网页检索工具不可用（端点/模型配置返回 404），外部信息改由 GitHub REST API 与 npm/jsDelivr 目录获取，**缺少社区博客、论坛、issue 讨论类证据**；官方仓库又关闭了 issue 追踪，因此「DSH 是否暴露过安全问题」只能以上述组合证据回答，**证据强度为中等偏低**，不排除存在未被本报告覆盖的社区报告。
2. 社区插件的机制描述全部来自目录中的**作者自述**，本报告**未安装、未运行、未实测**任何第三方插件；对比表中的「无/部分」判断仅基于自述文本。
3. 本报告**未在 DSH 上运行任何实验**；第 6.3 节的结论是结构分析，不是实测结果。所有「已验证」表述仅适用于 OpenClaw 上的既有实验（见项目档案）。


---

## 9. 全功能 DSH 迁移实施计划（2026-10-20 修订）

### 9.1 目标、范围与技术路线

**首个完整版本交付：DSH 工具执行前门禁 + PMKB + 跨步/跨会话 RV + LLM/本地双模语义增强 + DSH 基线扫描 + Dashboard + 全链路审计 + 可安装发布包。**

用户已明确全量范围。为控制重写成本与语义漂移，新的**实施建议**是 TypeScript 薄适配插件调用 Python 共享核心服务，复用 Preact 工作台。该建议取代原来的纯 TS 优先实施计划，具体通信与部署方式须由 Phase 0 实测后定稿。

首期测试候选已完成打包：发行目录 `dist/dsh-rvguarder-0.1.0/`（`manifest.json` 四项 SHA-256 全部匹配），插件包 `dsh-rvguarder-0.1.0.tgz`（12.3 kB，哈希 `e57ba4aa…`）、Python wheel `openclaw_guard-0.7.0.dev0-py3-none-any.whl`（352 kB）、`INSTALL.md` 与 `create-test-profile.mjs` 均校验一致；临时副本 `/tmp/dsh-rvguarder-0.1.0.tgz`、`/tmp/rvguarder-dsh-release-20261020/` 与发行包同哈希。实际验证及剩余门禁见[验证记录](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/validation-2026-10-20.md)。

2026-10-21 更新：`0.1.0`（`dsh-guard-v1`）作为首期测试候选保留归档；当前预发行版为 **`0.2.0-rc.1`**（`dsh-guard-v2`），发行目录 `dist/dsh-rvguarder-0.2.0-rc.1/`，四项 SHA-256 全部匹配，并已通过 GitHub Releases 发布。v2 增加签名内容收据（ContentReceipt/ContentVersion）、受控工具 `rvguard_read` / `rvguard_copy` / `rvguard_transform` / `rvguard_send`、宿主单次授权 CLI、fail-open 独立旁路审计队列、内核与插件目录文件锁、45 秒时效宿主探针、离线维护入口，并将逐调用 `hello` 收敛为 15 秒心跳。20 次合成只读调用复验均值 `134.33ms`、p95 `160.78ms`（LLM 关闭）。仍未通过的 7 项正式发布门槛见[v2 修复记录](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/repair-2026-10-21.md)。

```text
DSH 原生工具 / PTC 内层工具 / 子 Agent（覆盖范围需逐项验证）
  → TypeScript 适配插件：身份、参数、工作目录、调用关联、审批、结果观测
  → 经认证的本地传输（Phase 0 选择回环 HTTP 或受限 IPC）
  → Python 共享核心：语义增强 → ToolCallIR / Trace → PMKB → RV → 决策
  → DSH 原生审批与执行
  → 完成事件 → 去重提交成功证据 / 审计 / SSE → Dashboard

DSH 资产发现 → DSH 基线扫描 → JSON / HTML / PDF 报告 → Dashboard
```

| 部分 | 复用与适配方式 |
| --- | --- |
| PMKB | 复用 `policy/` 与 `policies/permissions/` 单一源；新增 DSH operation、参数、身份和资源映射，对缺口增加版本化规则与回归向量 |
| RV | 复用 Python DSL、窗口、主体级状态、规约校验；新增 DSH 事件与成功结果适配 |
| LLM 增强 | 复用 SemanticEnhancer 与受限事实模型；适配 DSH 工具上下文、提示词和配置；保持本地模式 |
| 基线扫描 | 提取通用 OS/账户/端口/文件检查；OpenClaw 与 DSH 各自提供发现器、配置解析和宿主专用检查 |
| Dashboard | 复用 Preact 页面、API 与 SSE；增加宿主/实例筛选、DSH 连接和审批状态、规则证据及扫描结果 |
| 审计与持久化 | 复用 SQLite/JSONL 哈希链与现有存储抽象；增加宿主、实例、调用、规则版本关联及迁移兼容性 |
| DSH 插件 | 新增 TS 包，负责 SDK 接入、门禁、原生审批、结果观测、连接与生命周期，不复制 Python 策略引擎 |

### 9.2 工作包与接口约束

**A. 共享核心与宿主边界**

- 从 GuardServices 中分离宿主发现、Hook 安装、Gateway 探测、审批回调和扫描配置；定义 HostAdapter 与宿主能力描述，保留现有 OpenClaw 兼容管理器。
- DSH 服务初始化不得调用 OpenClaw 插件生成/配置注入；构造当前 GuardServices 会立即触发 Hook 写盘，必须先解除这一副作用。
- 复用 `clawRVguarder/` 实现，首期不再改名 Python 主包；独立 `dshRVguarder/` 工程骨架已创建；建议后续新增 `hosts/base.py`、`hosts/openclaw/`、`hosts/dsh/`。宿主适配代码布局在实施时按现有模块边界细化。
- 定义带版本的请求/响应协议：host、instance、principal、agent、session、run/turn、call、parent-call、原始/归一化工具、已解析参数、cwd、时间、策略版本与完成状态；身份来自宿主可信上下文，参数中的自报身份不能替代。
- 调用关联使用宿主/实例/会话/调用组合键，ID 按不透明值处理；同时记录判定与完成，拒绝重复提交、冲突完成或过期回复。

**B. PMKB + RV + 语义增强完整决策**

- 建立 DSH 原生工具、MCP、PTC、子 Agent、命令执行的能力与字段映射表；可表达的工具映射到 canonical operation，未知/缺失特征保持显式 unknown，不按名称近似自动放行。
- 复用最小权限闭包/差分、RiskGraph、单步硬约束、会话 RV 与主体跨会话证据；补齐 DSH 工具正反例与命令复合效果边界。
- LLM 仅提供经 schema 校验的受限语义事实，不能签发授权或降低 PMKB/RV 硬拒绝；凭据只保存在宿主受控配置，模型输入按现有隐私边界裁剪。
- 支持 local/LLM 双模、超时、限额与带版本缓存。LLM 不可用或输出无效时退回本地分析，缺少必要证据时 ask/deny，不能推断为允许。
- 前置仅评估候选调用；确认成功后才提交历史。重试、取消、超时、结果缺失、并发和重启后的未完成调用须有显式状态。
- 宿主签发授权、资源版本、内容来源和执行证据能力一并纳入适配检查；无法获得可信证据时输出不支持/证据不足，不以模型描述代替。

**C. 审批与故障策略**

- Python 内部效果转换为 DSH allow/ask/deny，统一输出规则 ID、风险、资源、缺失特征、权限差分与规则版本；DSH 原生审批为唯一审批入口，Dashboard 只读同步。
- 核心服务不可达、协议错误、策略加载失败或关键状态损坏：DSH 默认拒绝，可由受控配置显式选择 fail-open，并记录降级状态；OpenClaw 的现有 fail-open 不变。
- 基线扫描失败、Dashboard 离线等非决策组件故障不应直接阻断全部工具；LLM 故障按 B 的本地回退处理。
- 设计审批等待期间的取消、权限变化、资源变化与规则更新处理；需要时重新校验，但不得自动重跑已执行工具或制造重复审批。
- 验证多插件合并顺序；硬拒绝不得被后续 allow 或自动审批翻回，具体使用 waterfall 与 monotonic guard 的分工由 Phase 0 核验。

**D. DSH 基线扫描与 Dashboard**

- DSH 扫描覆盖：版本/profile 与配置发现、敏感配置权限、插件来源/信任、沙箱与审批配置、工作区、运行账户、监听地址/端口/认证、依赖与日志；仅对实际可见和支持的能力下结论。
- 去除 OpenClaw 专用目录、gateway、端口和配置键假设；扫描项声明宿主、平台、证据、状态与修复建议。unsupported/unknown 不得计为 pass。
- 保留 JSON/HTML/PDF 导出并验证目标平台渲染依赖；扫描在决策热路径外执行，不自动修改宿主配置。
- Dashboard 同期提供连接与实例状态、动作/审批只读同步、Trace 与 RV、PMKB/规则证据、基线扫描/报告、语义模式/降级、审计查询导出。
- API/SSE 按宿主实例过滤，支持断线重连、快照补偿和事件去重；敏感配置脱敏。先以独立本地工作台交付，DSH 内嵌入口仅在官方能力实测可行时采用。

**E. 服务分发、存储与安装包**

- 验证独立 Python 3.13+ 解释器或配套安装包，不依赖 DSH 托管 Python 的版本假设；明确在线安装与离线安装的前置条件。
- 确定插件启动服务、连接外部托管服务两种模式的支持范围；至少完成一种可重复部署的主路径。实现就绪探测、协议版本握手、端口冲突、异常退出与受控重启，卸载只终止本实例拥有的进程。
- 本地通道认证、实例隔离、配置与密钥权限、Dashboard 访问控制纳入设计；认证凭据不随公开插件包分发。
- 宿主/实例数据隔离并保留 OpenClaw 旧记录兼容性；验证原子状态保存、重启恢复、schema 版本、规则回滚和哈希链完整性。
- 分发包包含匹配版本的 TS 插件、Python 服务、UI、PMKB、RV 数据与安装说明；规则仍保留单一源，构建时记录版本/哈希。

### 9.3 阶段顺序与出口

以下为同一完整版本内的实施里程碑，所有阶段通过后才能称为全功能 DSH 适配完成。

| 阶段 | 工作内容 | 出口条件 |
| --- | --- | --- |
| **Phase 0：宿主与部署实测** | 锁版本、最小插件、字段/事件顺序、native/PTC/子 Agent、审批/取消/共存、Python 3.13+ 与传输、Dashboard 可达性、平台边界及性能基线 | 形成能力矩阵与架构决策记录；明确支持平台、字段缺口、传输与服务生命周期；无阻塞性接口缺口 |
| **Phase 1：共享核心与完整决策链** | HostAdapter、解除 OpenClaw 初始化副作用、协议/认证、DSH 工具映射、PMKB + RV + LLM/本地双模、原生审批和审计 | 真实 DSH 调用跑通前置决策→审批→执行结果→成功历史；PMKB 和 LLM 已接入；故障与取消符合约定 |
| **Phase 2：状态、基线与工作台** | 跨会话证据、去重/并发/重启恢复、DSH 基线、报告、Dashboard API/SSE/全部核心页面与配置 | 面板可观测真实 DSH 事件，扫描结果有宿主证据，跨会话风险和状态恢复可复现，LLM 降级可见 |
| **Phase 3：全功能发布验收** | 安装/升级/卸载、依赖与资源打包、平台矩阵、离线回放、浏览器 E2E、多插件/故障注入、性能及 OpenClaw 回归 | 六类能力逐项通过；无 OpenClaw 行为回退；干净环境按文档安装运行，兼容性和限制可审查 |

Phase 1 的共享协议确定后，基线扫描与 Dashboard 可独立推进；跨会话证据须在 Phase 1 确定可信身份来源后完善。并行工作是实施依赖建议，不代表已分配代理或已开始实现。

### 9.4 发布验收矩阵

| 能力 | 必须通过的证据 |
| --- | --- |
| PMKB | 既有 123 个 bundle vectors 与新增 DSH 向量通过；明确测试 allow/ask/deny、unknown、缺失身份、越权差分和危险组合；不适用项单列而非计为通过 |
| RV/证据 | 正反例、目标调用前阻断、失败不提交、重放不重复、并发、session 隔离、主体跨 session、撤销/过期、资源版本与重启恢复 |
| LLM | 本地与真实受控 LLM 两模式测试；超时、无效输出、注入样例与缓存失效；敏感字段不泄露、硬拒绝不降级 |
| 基线 | DSH 配置/沙箱/审批/插件等检查有实际证据；unknown/unsupported 单列；JSON/HTML/PDF 可导出 |
| Dashboard | 连接、动作、审批只读、Trace/RV、规则/PMKB、扫描、语义模式、审计页面和 SSE 重连；浏览器 E2E 通过 |
| 打包与运维 | 干净环境安装、Python 版本、资源完整性、服务就绪/退出/恢复、配置认证、升级回滚/卸载与数据保留策略 |
| 兼容与性能 | OpenClaw 既有回归仍通过；锁定 DSH 版本上覆盖 native/PTC 与声明支持的子 Agent/平台；记录端到端平均、p95、超时率及并发吞吐，本地与 LLM 路径分别测量，阈值由 Phase 0 数据确定 |

### 9.5 风险与控制

- **Python 服务引入部署与可用性成本**：Phase 0 先验证解释器、生命周期、认证与延迟；未通过前不宣称可安装交付。
- **全量范围扩大宿主耦合面**：先建立宿主边界与协议，复用既有引擎；不在本次迁移中同时进行全语言重写。
- **故障策略混用**：按 host/instance 显式配置；DSH fail-closed 与 OpenClaw fail-open 分别回归；LLM/扫描/面板与核心门禁故障分开处理。
- **LLM 与本地性能差异**：分别建立预算，扫描不进入热路径；缓存绑定事件、策略、模型/提示词版本，不能缓存并复用过期授权。
- **事件可见性与可信身份缺口**：native/PTC/子 Agent 逐项验证；未知映射、缺失可信证据不伪造支持。
- **窗口并发与跨进程一致性**：调用去重、明确排序/提交边界；丢失结果标为未确认，不把未知当成功；完成与状态提交须可恢复。
- **DSH API/Windows 边界变化**：固定版本与平台能力矩阵，保留回归和升级检查；partial 能力如实呈现。

### 9.6 当前验收状态（2026-10-20）

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| Windows 宿主 | 已跑通 | web profile 启动、真实工具门禁、审批与完成回写；见[验证记录](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/validation-2026-10-20.md) |
| WSL 原生宿主 | 已跑通 | `dsh@0.2.1-rc.2` 全局安装于 `~/.npm-global/bin/dsh`；自定义 profile 启动成功，后端记录 2 次 `session_started`，插件状态目录生成 |
| TS 构建与单测 | 通过 | `tsc --noEmit` 无错误；对 WSL SDK 运行 `12/12` 通过，耗时 `358.9ms`（原先链接 `/mnt/c` 时 `3022ms`） |
| 打包与安装 | 通过 | `dsh plugin add` 装入测试 profile（+25 包，`600ms`）；发行包四项 SHA-256 全部匹配 |
| Python 后端 | 通过 | WSL `Python 3.13.13` 可导入并监听；FastAPI 依赖就绪 |
| 每次调用延迟 | 未达标 | Windows 实测平均 `218ms`、p95 `234.6ms`；瓶颈为桥接往返，`ready()` 每次重复握手。WSL 侧工具调用基线尚未测量 |
| PTC / 子 Agent / Windows ACL | 未覆盖 | 仍需按 9.4 逐项补证 |

已知启动约束：DSH 会拒绝加载工作目录 `.env` 中的启动器变量（本仓库含 `DEEPSEEK_BASE_URL`），须从中立目录或无 `.env` 的工程子目录启动。

---

*当前范围依据 2026-10-20 用户要求修订。该节是开发计划，不代表功能已经实现；Phase 0 完成后更新架构决策和验收阈值。*
