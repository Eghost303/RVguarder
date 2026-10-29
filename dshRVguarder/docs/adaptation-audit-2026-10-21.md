# DSH 全功能适配核查（2026-10-21）

> 历史验收记录，保留原版本与原结论；当前 **v0.2.1-rc.1** 的使用入口和范围见 [安装指南](deployment.md) 与 [版本说明](release-current.md)。

结论：**尚未全部成功适配**。当前是可试用的 0.1.0 测试候选，主要模块已接通，但存在功能缺口、已复现缺陷和未完成的真实宿主验收。按迁移计划第 9 节，不能认定 Phase 0–3 全部完成。

本次依据工作区源码、既有记录和隔离复测；未修改日常 DSH profile，未读取或调用真实模型密钥，未运行破坏性工具。本次不修改业务实现。

## 功能矩阵

| 功能 | 代码情况及证据 | 判断 |
| --- | --- | --- |
| 宿主隔离、认证和协议 | 独立 HostAdapter、回环 HTTP、token、实例绑定；DSH 初始化不安装 OpenClaw Hook；回归覆盖 | 已实现，测试范围通过 |
| 执行前门禁、原生审批、结果提交 | 实际 SDK 管线覆盖 allow/ask/deny、单调守卫、单次 dispatch、结果去重；工具体和审批回答为夹具 | 主链路实现，真实模型任务验收不足 |
| PMKB | 复用 79 条规则；明确映射 9 个工具名称，其余 dsh-unmapped；未知工具保守审批/拒绝 | 已接入，工具语义映射不完整 |
| RV、跨会话主体证据 | 成功后提交、失败不扩权、重启恢复和 dispatch 重评估；主体按实例聚合 | 基础能力实现，委派/并发/真实跨会话覆盖不足 |
| 强内容血缘与宿主授权 | 完成协议只有 call/dispatched/succeeded；无 DSH 内容收据、资源版本或执行提案协议，DshServices 未配置 host_authorization_bridge | 尚未完成 DSH 专属接入；不能把共享核心存在视为迁移完成 |
| LLM 增强 | local/auto/llm、受限事实、失败回退、缓存和预算均已接入，合约夹具通过 | 已实现；在线质量、隐私、成本和延迟未验收 |
| 基线扫描与报告 | 配置、工作区和依赖清单可扫描，JSON/HTML/PDF 已有测试 | 部分适配；关键项仍 unknown/unsupported，且异常配置存在 500 |
| Dashboard | 认证、连接、原生审批只读、PMKB、扫描、语义切换、审计已接入 | 部分适配；遗留清空按钮行为错误，SSE 重连完整验收不足 |
| 审计和持久化 | 复用哈希链、SQLite/JSONL；有调用 journal 和插件 outbox | 已实现基础流程；多存储提交非单一事务，恢复须核对，不支持目录多进程共享 |
| 打包和部署 | tgz/wheel/资源/说明齐备；历史记录含 Windows 临时加载和 WSL plugin add 成功 | 安装主路径已有证据；升级、回滚、卸载及干净环境完整验收不足 |
| Windows 与性能 | 绝对盘符路径可转 WSL；UNC/盘符相对路径主动拒绝；ACL 尚未核验 | 不能宣称完整 Windows 支持；218ms 均值是历史合成测量，本次未重测 |

## 已确认问题及代码位置

### A1：强内容证据和宿主授权未接入（发布前功能缺口）

`clawRVguarder/hosts/dsh/http.py:16` 的 Call/Completion 为严格有限字段；`dshRVguarder/src/index.ts:80` 只上报 dispatch/成功布尔值。`clawRVguarder/services.py` 初始化 host_authorization_bridge=None，DshServices 未替换为 DSH 桥。现有工具成功历史不等于可信字节收据，也不足以证明跨会话同内容来源、资源版本或受控快照执行。应补齐宿主可信任务绑定、收据签发/验证、资源版本和受控执行协议，或明确标为不支持；不能直接信任工具文本。

### A2：基线扫描的多个关键检查仍没有有效运行时证据（发布前功能缺口）

`clawRVguarder/hosts/dsh/baseline.py:91` 起，沙箱、审批、插件信任、实际宿主账户、监听/认证和 Windows 完整性采用固定 unknown/unsupported。保守标记是正确的，但这意味着完整基线迁移尚未完成。需增加宿主探针及平台证据，不得改成无依据的通过。

### A3：异常 profile 清单导致扫描 HTTP 500（已复现）

`clawRVguarder/hosts/dsh/baseline.py:53` 和 57 未检查嵌套 dsh/profile 的类型；对有效 JSON `{"dsh":null}` 或 `{"dsh":{"profile":null}}`，在临时 profile 请求 POST /api/baseline/run 均返回 500。预期应输出结构异常风险项并继续可执行检查及报告导出。JSON 顶层非对象也需要防御。

### A4：Dashboard 清空历史在被拒绝后提示成功（代码确认，接口已复现）

`frontend/src/pages/Dashboard.jsx:116` 直接 fetch，未检查 response.ok，随后无条件提示“已清空历史记录”；132 行仍对 DSH 展示按钮。`clawRVguarder/hosts/dsh/http.py:66` 的 mutation allowlist 不含 /api/actions/clear，实测认证请求返回 403；这保护了恢复证据，但界面误导用户。应按宿主隐藏/禁用该操作并检查 HTTP 错误，不应解除后端限制。

### A5：工具语义和执行路径未完成逐项映射/验收（功能和证据缺口）

`clawRVguarder/hosts/dsh/adapter.py:16` 只有 read/write/edit/bash/pwsh/read_image/web_fetch/web_search/run_code 九个明确别名。MCP、自定义工具和委派不能因为经过通用门禁就算完成语义适配；未知 ask/deny 是保守行为。真实 PTC 内层、并发、子 Agent 及取消需要按 SDK 的真实执行路径逐项测试。当前不据此断言存在绕过。

### A6：显式 fail-open 缺少逐次降级审计（代码确认）

`dshRVguarder/src/index.ts:57` 只用 WeakSet 标记 bypass 并 next，结果回调因没有 pending 而直接返回；没有可重放的逐次旁路审计队列。心跳离线只能反映连接状态，不能补足哪些调用曾绕过 Guard。默认 closed 不受此问题影响；选择 open 时应持久记录降级调用并在恢复后补交。

### A7：部署和运行约束未完成产品化（发布验收缺口）

插件只连接外部 Python，不自动启停服务；这符合已选主路径。仍需完成故障重启和恢复操作手册、升级/回滚/卸载与数据保留、独占目录约束验证、多插件组合、持续压力测试以及真实 LLM/PTC/子 Agent/平台矩阵。ready() 每次调用都会 flush 和 hello，存在可量化的额外往返；不能把历史合成延迟当作完整性能验收。

## 本次复测

- TypeScript：npm run check 通过；npm test 为 12/12，通过真实 SDK 的夹具管线。
- Chromium：DSH 3/3；OpenClaw 既有 5/5。本次未运行 Firefox。
- Python 全量：773 passed、18 skipped、4 subtests passed，耗时 146.22 秒；1 条既有 Starlette/httpx 弃用警告。跳过项不计为已验证。
- 独立异常探针：清空历史 403；两种 null 清单扫描均为 500，均在临时目录复现。
- Windows/WSL 真实宿主启动和包管理安装：本次未重跑，引用 2026-10-20 记录；该记录有后续新增的 WSL plugin add 成功证据，故不能再笼统称“从未安装验证”。

## 建议处理顺序

1. 修复 A3/A4，并补异常输入及错误提示回归。
2. 补齐 DSH 工具能力矩阵和真实 native/PTC/子 Agent/取消/并发测试；先确认执行路径，再扩展映射。
3. 完成内容收据、资源版本和宿主授权接入，以及 DSH 基线运行时探针、fail-open 审计。
4. 在线 LLM、Windows ACL、多插件、性能与升级/卸载验收通过后，才更新为全功能适配完成。
