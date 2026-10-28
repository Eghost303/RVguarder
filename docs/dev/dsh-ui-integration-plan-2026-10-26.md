# DSH 内嵌管理界面开发计划与交接（2026-10-26）

> 状态：**DSH 已交付，Codex 独立审查完成，部分项目待整改**。第13节记录原提交结论；rc.4 已修复部分缺陷并推进平台整包，详见独立审查和DEP-01报告，未验收项不能判为通过。其余章节保留原任务要求。
>
> 实施者：用户在 DSH 中使用的开发 Agent。复核者：DSH 交付后，由 Codex 审查代码并按本文验收。
>
> 基线：本地 `master` 的 `63d8772`；插件 `dsh-rvguarder@0.2.0-rc.2`；优先目标宿主 `DSH 0.2.1-rc.3`。开始时重新核对 HEAD 和用户已有修改，不回退到本基线。

## 1. 给 DSH 的任务

请在 RVguarder 当前代码上直接完成以下开发，不能只返回另一份规划：

1. 让已经接入的 RVguarder 出现在 DSH 原生“插件 → 已安装”页面，并使用宿主的管理机制显示实际安装、启用和加载状态。
2. 在 DSH “设置”中增加 **RVguarder** 选项，在宿主内部管理 Guard，完成页面、导航、主题与认证整合。日常管理不再要求打开另一个浏览器页面或手动粘贴 Guard 令牌。
3. 复用现有 Python 服务与工作台能力；Python 服务仍由用户单独启动。本轮不开发一键安装器、后端自动托管或权限规则修复。
4. 完成代码、相关测试、部署/升级说明和实现报告，保留可供 Codex 复核的命令、结果与截图。

仓库在本机 `D:/E-ghost/Documents/Code/Python/Projects/RVguarder`。先阅读根目录 `AGENTS.md`、[开发记忆](https://github.com/Eghost303/RVguarder/blob/master/docs/dev/project-memory.md)、[阶段交接](dsh-progress-2026-10-26.md) 和本文。按用户要求直接在 **master** 开发，不新建分支、不丢弃既有改动；远程推送、PR、tag 和 Release 留给用户下一步安排。

实施中可自行处理本文范围内的工程细节。遇到接口差异，先查实际安装版本与同版本公开源码，修正方案并记录证据；不能用关闭鉴权、扩大 Agent 权限或修改已安装 DSH 文件来绕过问题。确需修改宿主核心时，说明具体缺口与已完成成果，不把改造宿主安装包作为默认部署前提。

## 2. 用户最终应该看到什么

| 入口/场景 | 预期行为 |
| --- | --- |
| DSH 原生“插件 → 已安装” | 有真实 RVguarder 包条目，显示版本和宿主实际状态；能进入详情，启停/移除沿用 DSH 已有机制和限制 |
| DSH “设置 → RVguarder” | 在 DSH 内直接显示管理页，不跳转外部浏览器，不要求再输入 Guard token |
| 管理页内部 | 可切换概览、调用与审批记录、规则与 RV、扫描/报告、审计和必要设置；保留当前 DSH 已支持的能力 |
| Guard 后端没有启动 | 插件安装事实仍可查询；管理入口说明“后端未连接”，提供重新连接和现有启动说明，不能假装功能可用 |
| 后端恢复 | 自动或手动重连后刷新真实状态，不重放工具执行，不重复提交未确认的管理操作 |
| 关闭设置、切回对话 | 对话和工具运行不受页面挂载/卸载影响，无残留遮罩、全局样式或重复订阅 |

“插件已加载”“Python 后端已连接”“管理页面可用”是不同状态，必须分别表达。设置入口只存在于启用了对应客户端贡献的 profile；插件被真正禁用后，入口消失是正常行为，不能承诺禁用后页面仍在线。

## 3. 范围和现有约束

本轮对应 [阶段交接](dsh-progress-2026-10-26.md) 的 **DSH-UX-01/02**。以下事项留在后续：

- DSH-DEP-01：打包 Python、自动下载依赖、自动启停/升级后端、整包部署与一键安装。
- DSH-POL-01/02：本地模式频繁 ask、“完全权限”下被拦截的归因和规则调整。不能在本轮顺手放宽。
- 新的规则编辑器、密钥配置中心、持久授权、审批签发/恢复历史解锁功能。
- DSH 本身的源码改造、覆盖桌面 ASAR、另装 rc.2、变更日常 profile。

DSH 继续默认 fail-closed；已有显式 fail-open 不得绕过明确拒绝、协议冲突或恢复锁定。OpenClaw 的故障透传约定不变。Guard 页面对审批记录只读，**真正允许/拒绝仍由 DSH 原生审批完成**。隐藏按钮不能代替服务端禁止审批接口。

当前声明同时支持 rc.2/rc.3。本轮优先验收现有 rc.3；不能为了 UI 静默取消 rc.2 的核心接入支持或混装不同 SDK。若 UI 只能支持 rc.3，必须区分“核心兼容范围”和“内嵌 UI 兼容范围”，说明缺少能力时的降级行为，并保留 rc.2 核心回归证据；未实测不能写成 UI 已兼容。

Windows 后端要求原生 Python 3.13+ 和兼容依赖，与安装渠道无关，不要求 WSL。Linux/WSL 路径继续保留。

## 4. 已核实的代码与宿主事实

### 4.1 当前 RVguarder

| 位置 | 事实及对实现的影响 |
| --- | --- |
| `dshRVguarder/package.json` | 只有服务端 `.` 导出，没有 `dsh.bundle`、`dsh.client` 或 `./client` 导出；当前 build 只运行 TypeScript 编译 |
| `dshRVguarder/src/index.ts` | 核心注入 `tools`、`workingDirectory`，负责执行前决策、真正执行前确认和完成队列；新增 UI 依赖不能成为核心启动的必需条件 |
| `dshRVguarder/src/client.ts` | 只允许本机 HTTP 地址，令牌由宿主从私有文件读取；当前 `post()` 是桥接协议调用，不可直接向浏览器开放 |
| `dshRVguarder/scripts/create-test-profile.mjs` | 生成独立 profile，用 `insert` 加载 id 为 `rvguarder-dsh` 的条目；包含 backendUrl、instanceId、tokenFile、stateDir 等配置 |
| `frontend/src/main.jsx` | 自动挂载 `#app`，读取登录片段并操作整页主题，不能原样导入 DSH 页面 |
| `frontend/src/App.jsx`、`components/Layout.jsx` | 根路径路由、完整侧栏和绝对链接；直接复用会争用宿主导航和布局 |
| `frontend/src/api.js`、`useGuardSync.js` | 请求 `/api/*`，用浏览器 EventSource 和定时轮询同步；内嵌后必须换成宿主通道，不能请求到 DSH 的同名路径 |
| `frontend/src/store.js`、`styles.css` | 全局 store、本地存储键和全局样式需要隔离，避免跨实例串数据或污染宿主 |
| `clawRVguarder/hosts/dsh/http.py` | API 有本机 Host、桥接令牌、浏览器 cookie 和同源写入检查；桥接与管理能力尚未在同一令牌内分权 |
| `e2e/tests/dsh-ui.spec.cjs` | 现有测试访问 Python 独立工作台，不能证明 DSH 插件页和设置页已集成 |

### 4.2 rc.3 提供的真实扩展点

已对照本机已安装 rc.3 包和公开 tag `dsh-v0.2.1-rc.3`。该 tag 对应提交 `1f81c047fc48fa190a683e469daa699857e9afe8`。以下链接固定到该版本，不以最新分支行为代替。

| 能力 | 核实结果 | 官方依据 |
| --- | --- | --- |
| 原生包管理页 | “已安装”由 `listBundles()` 的结果构建，普通依赖不必然出现在此处 | [列表控制器](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-plugin-manager/src/client/manager-store.ts)、[宿主管理服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/boot/plugin-manager/src/index.ts) |
| 运行中的插件清单 | `remote.pluginInventory.list()` 从 Loader 读取实际条目；它与“已安装包列表”是不同视图 | [清单服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/host/plugin-inventory/src/index.ts) |
| 设置页入口 | `settings.section` 为列表插槽，包含稳定 id、顺序和显示名称，页内容由贡献者提供 | [设置插槽契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-settings/src/client/contract/slots.ts) |
| 插件详情配置区域 | `plugins.bundle.config` 以包名定位；`plugins.row.config` 以包名和条目 id 定位；另有详情动作/状态区域 | [插件页插槽契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-plugin-manager/src/client/slot-contract.ts) |
| 浏览器扩展声明 | 包提供 `./client` 导出，并以 `dsh.client` 声明平台和依赖包 | [官方插件包示例](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-plugin-manager/package.json) |
| 浏览器加载格式 | 客户端包由宿主模块加载器注册 factory，不能直接把普通 Vite 网页入口当客户端插件 | [客户端构建约定](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/tsdown.client.ts) |
| 已认证通信 | 可通过生成的 Remote 契约及 `remote.$mount()` 接入宿主连接；Host/Client 契约与构建有明确边界 | [Gateway 文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/docs/api-gateway.md)、[Gateway 包说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/api/gateway/README.md) |
| 调用者权限 | Gateway 根据 Peer 身份检查非 owner 的方法权限；连接成功不代表有管理权限 | [Remote 权限说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/api/remote-access/README.md) |

源码已给出可解释 DSH-UX-01 的直接机制：`listBundles()` 在依赖没有 bundle patch、也未被选中时跳过它；当前包恰好只有普通依赖和用户层手动插入的运行条目。**仍需在隔离 profile 复现并对照实际清单，不能把源码推断冒充已在用户界面定位完成。** 设置中的插件清单与侧栏的插件管理页也要分别检查。

本机 SDK 提取缓存 `runtime/dsh-sdk-0.2.1-rc.3/` 可用于已有构建；本次接口核对缓存 `runtime/dsh-ui-planning/` 只供本机参考，不是源码依赖，也不随包分发。实施时按现有 SDK 脚本补齐实际需要的同版本类型，不复制宿主私有运行数据。

## 5. 建议采用的整体结构

```text
DSH 原生插件页
  └─ 识别 RVguarder 包及配置层，显示真实状态，使用宿主启停/管理机制

DSH 设置 → RVguarder
  └─ 原生 React 页面适配层
      └─ 具有独立挂载/卸载、局部导航和样式的 Guard Preact 页面
          └─ 明确命名的管理方法，经 DSH 已认证的 owner 连接调用
              └─ RVguarder 宿主侧管理适配器（仅此处持有桥接令牌）
                  └─ 现有 Python API / 状态 / 审计 / 报告

DSH 工具执行 → 现有 RVguarder 核心 → Python 决策与完成确认
  （不依赖管理页是否打开，也不依赖页面订阅是否成功）
```

DSH 原生页面使用 React，现有 Guard 使用 Preact。优先采用**很薄的原生 React 入口 + 独立 Preact 挂载区域**，复用已有业务组件；不全量重写，也不全局把 DSH 的 React 替换为 Preact。

推荐分两段构建：先构建不自动启动的 Guard 内嵌模块，再将它接入符合 DSH 模块格式的客户端包。Preact 所需的兼容别名只能作用于 Guard 构建，不能改变宿主 React 的解析。客户端包不能引用 Node 文件系统、令牌读取模块或服务端执行代码。

默认采用原生页面挂载。直接把带令牌的本机工作台 URL 填入 iframe 或外部浏览器，不能满足本文的认证和导航验收。若实际 SDK 限制要求改用其他嵌入方式，记录原因，并证明同样具备宿主认证、页面内导航、凭据隔离和完整卸载能力。

原独立工作台作为开发、诊断及 OpenClaw 路径保留；本轮改变的是 DSH 的主要管理入口，不删除 Python 静态服务。

## 6. 工作包 A：复现、接口确认和实施记录

先完成这个小范围验证，再铺开页面开发：

1. 记录 Git HEAD、插件版本、实际 CLI/桌面 DSH 版本、SDK 版本、Node/Python 版本；读取版本不等于读取凭据。
2. 用独立 `DSH_HOME`、测试 profile、临时工作区和独立 Guard 状态目录复现旧接入方式。不要覆盖日常 web/desktop profile，也不要让状态目录落入 Agent 工作区。
3. 对照 profile 依赖、选中的配置层、Loader 条目、`pluginInventory.list()`、`pluginManager.listBundles()`/`listPlugins()` 和两处插件界面，保存脱敏证据，确认 RVguarder 消失在哪一层。
4. 验证第三方包的 `./client` 发现、模块格式、设置插槽、插件详情插槽、主题/语言、生命周期清理；做最小占位入口即可，不能将占位页当交付。
5. 验证第三方管理服务如何注册严格的 Host/Client Remote 契约、挂载贡献及检查 owner 身份。至少跑通一个只读状态方法和一个可取消请求；不以开发用宽松反射替代发布契约。
6. 确认可在当前仓库构建并由现有 rc.3 加载，无需重新构建/安装整个 DSH。若采用其他宿主正式通信扩展点，需说明它如何继承认证、拒绝非 owner、校验参数和回收连接。

产出：在 `dshRVguarder/docs/ui-integration-implementation.md` 记录实际入口、权限边界、缺失接口及最终选型。文件名为本轮建议新增，当前并不存在。

**完成条件：**有真实宿主中的最小设置入口和受认证状态调用证据，明确插件列表的根因和迁移方法；不再依靠猜测 SDK 方法名继续开发。

## 7. 工作包 B：插件包展示与旧 profile 迁移

1. 在现有包中补齐宿主需要的插件配置层元数据、客户端声明、导出和公开显示信息。优先保持 npm 包名 `dsh-rvguarder`，不要因 UI 改造拆出另一套 Guard 核心。
2. 根据工作包 A 的结果提供必要的 `dsh.bundle.patch` 文件；具体 patch 语法以 rc.3 为准。这里的 bundle 是“让 DSH 组合插件配置的清单”，**不包含 Python 解释器打包、后端自动启动或整包安装器**。
3. bundle、profile 用户配置和客户端发现共同作用后，同一个实例只允许一个核心守卫。旧 profile 的 `insert/id=rvguarder-dsh` 与新 bundle 不能各插入一套监听器、完成队列或 `owner.lock`。
4. 为新的测试 profile 提供明确配置生成方式，保留后端地址、实例编号、令牌文件及状态目录的宿主侧绑定。可更新现有 profile 生成/安装脚本；不要引入隐式联网安装或长期服务托管。
5. 为旧测试 profile 提供小范围、可检查、可重复运行的迁移步骤或工具：先备份将修改的文件，验证旧配置形状，只改 RVguarder 自己的条目和配置层选择，保留其他插件与用户配置。未知形状应报告具体差异，不整份覆盖。
6. 迁移不重建令牌、不更换实例身份、不清空完成历史。若要求停宿主后迁移，说明先停止哪个进程；不删除锁文件强行实现热切换。
7. 原生包启用/禁用、重试和移除以 DSH 支持的结果为准；需要重启时显示宿主反馈。插件禁用意味着暂停其保护，应沿用宿主控制与清晰提示，不能把“切换管理视图”做成停守卫。

管理页失败或可选 UI 服务缺失时，已有核心守卫仍应正常加载。可使用独立可选子插件/服务或明确的依赖隔离；不要把 `slots`、前端连接或主题服务加入当前核心的必需 `inject`。

**完成条件：**原生已安装页面显示真实 RVguarder 包，实际状态可追踪；旧配置升级后只存在一个守卫；新旧配置、重启、重复迁移都有验证。

## 8. 工作包 C：宿主认证与管理通道

### 8.1 认证原则

浏览器只连接 DSH 已认证的宿主通道。宿主侧适配器在自己的配置范围内访问本机 Python 服务；后端地址、实例和凭据由宿主配置决定，不能由页面请求临时指定。

当前 `/api/dsh/session` 的浏览器 cookie 使用桥接令牌值；此事实不等于令牌适合交给新的内嵌客户端。**新的内嵌流程不使用 `#guard-token`，不把桥接 token、签名密钥或其读取路径传给前端，不把它们存入 URL、本地存储、DOM、日志、截图或客户端构建包。** 原独立入口的认证边界保持，不为内嵌页开放宽泛跨域权限。

优先使用严格生成的 Remote 契约，在 Host 注册、在 Client 挂载；宿主对每次调用检查当前有效 owner Peer，非 owner、匿名及过期/已销毁连接被拒绝。不能信任客户端提交的 `owner: true`、instanceId 或 profile 名。非 owner 的共享会话权限不能自动获得 Guard 管理权限；不要为兼容 UI 注册允许所有管理动作的全局角色。

将公开管理状态与现有宿主私有 Config 分开。不要为了生成插件配置表单，把包含 tokenFile、evidenceKeyFile、stateDir 等内容的完整配置自动映射到 Settings/ConfigForm 或 Remote 返回对象；只公开本轮明确需要的字段。

这些方法不能注册成 Agent 工具、动态代码能力或模型可调用的管理能力。此处整合的是现有宿主信任边界，不声称隔离持有同一完整用户令牌、可直接读文件的任意本机进程。

### 8.2 明确的方法清单

下表是**待实现的业务契约建议**，不是声称 SDK 已提供同名方法。最终名称、数据类型和错误码应写进实现报告；禁止暴露 `request(url, method, headers, body)` 这样的通用代理。

| 业务操作 | 后端现有来源 | 约束 |
| --- | --- | --- |
| 概览、连接状态、能力与语义状态 | `GET /api/summary`、`/api/dsh/status`、`/api/dsh/capabilities` | 返回明确字段；校验 host/instance/profile 与当前绑定一致，不全量转储配置或内部对象 |
| 调用列表、详情和原生审批同步 | summary、`GET /api/actions/{id}`、事件 | action id 校验、结果有界；不开放批准、拒绝、删除或重置记录 |
| 规则和 RV 状态 | `GET /api/dsh/policy`、`/api/rv/status` | 展示后端实际规则和版本；不拿 OpenClaw 示例规则充当 DSH 当前规则 |
| RV 模式控制 | `POST /api/rv/toggle` | 仅沿用已有能力；核对实际启停影响并准确标注，不称为单纯视觉开关，不扩展 rule_mode 编辑能力 |
| 语义模式设置 | `POST /api/dsh/semantic` | 只接受 local/auto/llm；缺少宿主密钥时展示现有错误，不请求用户把密钥交给页面 |
| 运行扫描、显示结果 | `POST /api/baseline/run`、summary | 限制并发/重复点击，显示真实结果；超时后不盲目重试写操作，不执行报告里的脚本 |
| 审计列表与完整性状态 | `GET /api/dsh/audit` | 有界查询和脱敏，复用现有审计，不新增第二份裁决真相 |
| 审计导出与报告下载 | `POST /api/audit/export`、`GET /api/dsh/reports/{format}` | 用受控文件标识/固定格式返回数据；不把后端绝对路径当下载地址，不接受任意文件路径 |

`hello/before/dispatch/result/degraded/probe` 是核心桥接能力，**不进入管理接口清单**。授权签发、历史恢复、原生审批代理和任意配置写入同样不在清单中。原有读取状态能触发的内部握手应保持在宿主内部，浏览器不能构造工具身份或提交执行证据。

### 8.3 请求、订阅和文件处理

- 每种管理操作固定 HTTP 路径、方法和请求字段；复用现有回环地址校验，禁止重定向，不让页面传入 URL、请求头或令牌。限制请求/响应大小、查询数量和等待时间。
- 按当前插件实例和宿主连接绑定请求。连接重置或 profile/实例切换时取消旧请求、清理旧视图，晚到响应不能覆盖新状态。不能只因两个后端都返回 `host=dsh` 就认为绑定相同。
- 页面所需事件经宿主转发，或者先实现有界轮询并明确刷新时效。首版不必为追求实时另外搭建一套无认证 WebSocket；若转发 SSE，订阅也必须有 owner 检查、取消和重连后的快照对账。
- 宿主的读取/订阅负载不与工具决策共用会被扫描长期占用的执行锁。页面关闭后取消订阅和轮询；不能取消实际工具执行。
- RPC 的 `ok/value/error`、离线、超时、后端 401/403/409、协议或实例不匹配和报告未生成需要明确映射；不能把 HTTP 错误当空数据成功。修改成功后读取真实状态，不先显示成功后忽略失败。
- JSON/HTML/PDF 报告和审计文件通过受认证的宿主通道传输或宿主支持的保存动作交付，设置安全文件名、大小上限及下载类型。HTML 报告以附件处理或在受限查看器打开，不能把原始 HTML 注入 DSH 主页面。
- 不通过 `file://`、直接打开 Guard 端口、泄露服务端路径或宽泛 CORS 解决下载/认证问题。若采用宿主 HTTP 路由，必须落实宿主身份验证和写入请求的来源/防伪造检查，不能只检查浏览器按钮来源。

**完成条件：**浏览器看不到桥接凭据；owner 能执行允许的管理操作；绕过前端直接调用时，匿名/非 owner 及禁止操作仍被服务端拒绝；工具协议接口没有被管理通道间接开放。

## 9. 工作包 D：原生入口、内嵌组件与导航

### 9.1 原生入口

1. 用 `settings.section` 注册稳定 id（建议 `rvguarder`），中文标签为“RVguarder”，按 DSH 语言机制提供英文文本；设置壳负责打开/关闭，插件只负责自己的内容。
2. 在原生插件包详情通过 `plugins.bundle.config` 或合适的详情插槽提供连接摘要和管理入口。若 rc.3 没有公开的跨插件打开设置 API，可在详情复用同一管理组件或清楚指引“设置 → RVguarder”；不得伪造内部路由或操作宿主 DOM。
3. `settings.plugins.tab` 属于设置中的插件区域，不等于侧栏的原生“已安装”列表。不能只增加自定义标签页或假卡片，就宣称解决了包清单问题。
4. 包清单使用实际安装和运行状态；自定义状态区域可补充后端连接、恢复锁定等事实。不要用后端一次心跳代替宿主安装/启用状态。

### 9.2 现有前端的可嵌入化

- 增加独立内嵌入口，例如 `frontend/src/embedded.jsx`，提供显式 `mount(container, options)` 和 `dispose()`。名称可调整，但必须与当前自动启动的 `main.jsx` 分离。
- 注入管理 transport、实例上下文、语言/主题、内部导航和错误回调。由组件调用固定业务方法；独立工作台仍可用自己的 HTTP transport。不要保留散落组件中的直连 fetch、EventSource 或报告绝对链接。
- 内嵌模式用局部页面状态或受控子路由，内部“概览/记录/规则/设置”不改写 DSH 根 pathname/hash，不劫持浏览器后退、宿主键盘快捷键或当前对话选择。
- 收起现有整页品牌侧栏和全屏布局，使其适配 DSH 设置内容区；必要时用局部页签。不要把完整网页缩进一个很小的固定高度容器。
- 样式使用明确前缀、CSS Modules 或隔离根。`body`、`:root`、全局标签样式和 `document.documentElement` 主题写入不能影响 DSH；颜色、字体、滚动、弹层与焦点跟随宿主。
- Preact store 必须按挂载实例创建/清理，或有可证明的等效隔离。持久化键至少区分宿主/profile/实例；禁止用现有全局单例复用上一 profile 的敏感记录。实例切换后重置选择、错误、缓存和订阅。
- 组件卸载时清理计时器、EventSource/Remote 流、AbortController、事件监听、临时样式和 Blob URL。处理 React 开发环境重复挂载、热重载及慢请求回包，不重复加载 Guard 核心。
- 宿主原生 React 只管理外层容器；Preact 只渲染容器内部，不能卸载或覆盖 DSH 根 React 树。

### 9.3 首轮应接入的内容

| 页面内容 | 本轮要求 |
| --- | --- |
| 概览 | 展示插件/后端状态、当前 profile/实例、协议与 SDK、最近错误、待审批/拒绝/执行概况、恢复锁定和审计缺口提示 |
| 调用与审批记录 | 列表、筛选、详情与状态同步可用；标明“请在 DSH 原生审批处理”，无自建批准/拒绝/清空按钮 |
| 规则与 RV | 读取实际规则版本、规则详情/搜索及现有连续行为状态；沿用现有模式控制的实际含义 |
| 扫描与报告 | 发起现有扫描、展示结果、下载已生成报告；运行中防重复，失败可理解；不能只显示后端目录路径 |
| 审计 | 查看近期记录和链完整性状态，按现有能力导出；导出确实交付给用户 |
| 设置 | 语义模式 local/auto/llm 与实际生效状态；连接信息只读，必要的后端启动/诊断帮助可复制 |

DSH 不支持的技能/频道/OpenClaw 配置、持久审批、删除动作等控件应保持隐藏或明确不可用；不能在“迁入界面”时把它们重新开放。

加载中、空记录、后端离线、认证失败、无权限、配置/实例不符、恢复锁定、无报告必须有明确状态。页面不能用无限 spinner 代替故障信息；按钮应有文字和可访问名称，内容在设置窗口内可滚动，支持键盘和亮/暗主题。

**完成条件：**在真实 rc.3 的“设置 → RVguarder”内完成上述操作，不离开 DSH；切页、关闭/重开、语言/主题变化及后端恢复不破坏宿主。

## 10. 工作包 E：构建、配置和文档

1. 保留原服务端导出，添加正确的客户端导出和 `dsh.client` 声明。注意声明中的依赖是包名，Cordis 运行时 `inject` 是服务名，两者不要混用。
2. Host 与 Client 分开类型检查，避免两侧 Context 合并冲突。服务端 SDK 由宿主提供；客户端 React 等共享运行时按 DSH 模块约定解析，不打入第二份宿主 Cordis/React。
3. 在本仓库提供可复现构建命令。普通 `tsc` 或 Vite 网页构建不足以生成 DSH 客户端插件；但也不能要求团队修改/重编译已安装 DSH。若借鉴官方构建器，说明外部插件可使用的依赖和格式，不依赖开发者私有的 DSH 源码目录。
4. 客户端脚本、样式、语言、声明、生成的 Remote 契约、bundle patch 及必须的静态资源均进入 npm 包。若保留异步 chunk，验证宿主内的资源定位；首版可采用独立的单文件客户端产物，减少路径问题。
5. 用 `npm pack --dry-run` 和实际 tgz 检查内容，并在仓库外安装测试；不能依赖源码树、Vite dev server、未打包的 `runtime/ui/` 或外部 CDN 才可打开管理页。
6. `runtime/`、SDK 缓存、真实 profile、令牌、审计数据及本机构建包不提交 Git。如变更插件候选版本，同时同步包/锁文件、构建清单、安装脚本、README、AGENTS、开发记忆及报告中的版本，区分插件版本与 DSH 版本。
7. 更新中英文 README、`dshRVguarder/README.md`、部署指南和 `docs/dev/frontend.md`：说明新的两处原生入口、旧 profile 升级、内嵌认证、后端未启动时的行为、独立工作台保留用途，以及仍需单独启动 Python。
8. 更新阶段交接/开发记忆/路线图：仅在验收证据充分时标记 UX-01/02 已完成；DEP-01 和 POL-01/02 保留。实现报告区分已通过、跳过、环境限制和待 Codex 复核。

本轮源码开发和本地安装验证不要求 GitHub Release。需要验证本地 tgz 是因为新增了客户端资源与元数据；这不等于必须提前发布预发行包或完成整包部署。

## 11. 建议改动地图

此表用于找代码，不要求为了符合表格机械拆文件。

| 区域 | 预期改动 |
| --- | --- |
| `dshRVguarder/package.json`、构建/类型配置 | bundle/client 元数据、导出、打包文件、Host/Client 检查与构建 |
| `dshRVguarder/src/` | 核心与可选 UI 集成分离、宿主侧管理适配器、类型明确的契约、客户端设置/插件详情入口 |
| `dshRVguarder/scripts/` | 新测试 profile 生成和旧 RVguarder 配置迁移，沿用独立后端生命周期 |
| `frontend/src/`、构建配置 | 显式内嵌入口、transport、独立 store、受控导航、样式/主题隔离与卸载 |
| `clawRVguarder/hosts/dsh/http.py` 等 | 只在管理能力/下载契约确有缺口时小范围补齐；不放松现有认证、审批和桥接检查 |
| `dshRVguarder/tests/`、`tests/`、`e2e/` | 加入管理权限、迁移、客户端格式、资源分发与真实宿主集成测试 |
| README、部署/前端指南、实现报告 | 新入口、开发构建、升级、手工启动后端、证据与已知限制 |

不要在 `policies/permissions/`、决策流水线和宿主授权实现中混入规则调整。原有 bug 如确实阻止本轮测试，先记录和最小复现，不能把安全语义变化藏进 UI 重构。

## 12. 验证顺序与自动化要求

先运行与修改直接相关的检查；失败或未覆盖的风险再补测，不把所有历史测试数字复制成此次结果。

1. **类型与构建：**保留 `dshRVguarder` 现有 check/build/test，补齐新增客户端和管理契约的检查；单独构建原工作台和内嵌客户端。
2. **迁移与生命周期：**临时 profile 中验证 plain dependency → bundle、重复迁移、已有其他插件、禁用条目、高优先级覆盖、缺失 UI 服务、重启/禁用/启用；统计一个实例只有一套工具监听器和完成队列。
3. **权限与请求测试：**owner/非 owner/匿名、非法字段、禁止方法、任意 URL/文件路径、过期连接、跨实例、重定向及错误响应；验证不得通过管理通道调用桥接执行接口。若改 Python API，加入相应后端回归。
4. **组件与 transport 测试：**核心页面操作调用正确方法；实例切换后旧响应无效；关闭/重开无重复订阅；所有管理错误可见；下载能拿到正确文件。
5. **既有工作台回归：**保留独立 DSH 工作台和 OpenClaw 页面能力，尤其原生审批只读、DSH 不支持操作不出现、主题及静态资源正常。
6. **真实 rc.3 集成：**用新包在隔离 profile/工作区运行真实 DSH，验证原生插件列表、设置入口、认证通道和主要页面流程。可使用本机既有桌面运行时；用 CLI 启动相同版本 Web profile 的证据不能替代桌面内嵌入口验证。
7. **最小保护回归：**使用已有确定性夹具和实际 SDK 验证 allow/ask/deny、原生审批、执行前复核、完成回写/去重、恢复锁定与后端故障行为未因页面整合改变。不必依赖真实模型密钥或向在线模型发送任务。
8. **安装包验证：**在仓库外安装本地 tgz，证明 UI 与元数据随包交付；rc.2 核心兼容及 Windows/Linux 相关结果分开记录，跳过不算通过。

当前可复用的命令示例（新增命令由实施者补入文档）：

```powershell
# 仓库根目录；python 应指向项目选择的 Windows 原生或 Linux/WSL 解释器
npm --prefix dshRVguarder run check
npm --prefix dshRVguarder test
npm --prefix frontend run build
python -m pytest tests/test_dsh_adapter.py tests/test_ui_asset_delivery.py -q

# 此项仅验证原独立工作台；不能代替新增的宿主内测试
npm --prefix e2e test -- --config=playwright.dsh.config.cjs
```

测试使用独立目录和受控夹具，不读取或输出真实 `.env`、模型密钥、桥接令牌。不要为测试放宽用户目录 ACL、删除历史、关闭拒绝策略或覆盖日常 profile。

## 13. Codex 后续审查验收清单

DSH 实现后逐项填写结果和证据。2026-10-28 已独立审查 `f3990e8`，结论如下；详细证据、发现与本轮整改见 [独立审查报告](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/ui-review-2026-10-28.md)。结论针对原提交，不能用后续修复倒填通过。

| 编号 | 必须满足的条件 | 应提供的证据 | Codex 独立结论（原提交） |
| --- | --- | --- | --- |
| UI-01 | 原生“插件 → 已安装”显示真实 RVguarder 包/版本，详情状态与清单一致 | 真实 rc.3 截图、脱敏清单与配置层对照 | **通过** |
| UI-02 | 设置页直接打开内嵌 Guard，无外部浏览器或 Guard token 输入 | 桌面实际操作截图/录屏、入口测试 | **待整改：Web入口通过；桌面独立复验未完成** |
| UI-03 | 概览、动作只读、规则/RV、扫描、报告、审计和语义模式可用 | 各主要流程的自动化结果及代表性截图 | **不通过：下载对象未转字节** |
| UI-04 | DSH 导航、当前对话、后退/关闭、主题、语言和焦点不受破坏 | 页面测试、亮/暗主题与切换验证 | **待整改：主题/语言/焦点与实际实例隔离** |
| UI-05 | 后端离线/恢复、无权限、过期连接、实例不符、恢复锁定展示正确 | 故障注入结果；错误不变成空数据成功 | **待整改：故障矩阵与错误呈现** |
| SEC-01 | 内嵌构建包/DOM/存储/URL/网络响应不含桥接凭据或签名密钥 | 临时测试凭据的扫描/断言结果，不提交凭据本身 | **通过** |
| SEC-02 | 管理方法服务端仅允许 owner；禁止能力无法绕过 UI 调用 | 匿名/非 owner 负例、禁止方法与任意代理负例 | **通过** |
| SEC-03 | 新通道不开放原生审批代理、执行证据写入、授权签发、任意文件下载 | 接口清单与服务端负例 | **通过** |
| LIFE-01 | UI 不可用不影响核心；反复挂载、连接重置后无重复监听/订阅 | 自动化计数/清理断言与核心回归 | **待整改：连接重置/计数矩阵、E2E 清理** |
| MIG-01 | 旧 profile 安全升级，重复执行无副作用，不丢配置和历史 | 迁移前后脱敏 diff、重复迁移/回滚测试 | **待整改：禁用/覆盖/回滚矩阵** |
| PKG-01 | tgz 包内资源完整，仓库外可加载，无 dev server/CDN/DSH 源码路径依赖 | pack 清单、独立安装及宿主加载结果 | **不通过：默认 bundle 表达式非法** |
| REG-01 | 既有 allow/ask/deny、完成回写、故障与 OpenClaw 行为保持 | 实际命令和结果；所有跳过/未测项列明 | **通过；并发技能页失败已记录，串行 6/6** |
| DOC-01 | 文档与实现一致，未宣称自动启动后端或已解决规则问题 | 更新文件列表、部署说明、剩余问题记录 | **不通过：部署说明/脚本/lock 未同步** |

认证边界未实现、仍须打开独立网页、只伪造插件卡片、依赖未打包开发资源、或新增了绕过守卫的入口，均不能判本轮完成。若环境暂不能完成某项真实验收，交付代码及明确缺口，标记“待验收”，不能用 mock 通过补齐结论。

## 14. 实施顺序与交付包

按 **A → B → C → D → E → 宿主验收** 推进；C 的认证最小验证在 A 中提前完成。不要先改完所有页面再发现外部插件无法接入宿主通信。

完成后交付：

1. 代码与配置改动，按模块说明用途，列出本地提交（如有）及最终 HEAD；不推送远程。
2. `dshRVguarder/docs/ui-integration-implementation.md`：实际 API、包格式、身份校验、管理方法、UI 生命周期、旧配置迁移、测试和剩余问题。记录与本文建议不同的选择及原因。
3. 准确的构建、安装本地包、旧 profile 升级、分别启动后端和 DSH、进入原生页面、回滚步骤；不能只写“参考源码”。
4. 第 13 节逐项结果、真实 rc.3 截图、测试命令和结果摘要；日志须脱敏，大型产物放忽略目录并注明本地位置。
5. 未完成项及其影响，继续保留 DEP-01、POL-01/02；不宣称整包开箱即用或完整安全迁移已验收。

回滚说明必须覆盖包元数据/配置层变化：停止测试宿主，恢复备份的 RVguarder profile 配置和原匹配包，保留实例身份、令牌、完成队列及审计历史，再分别启动后端和宿主核对单一守卫。若涉及持久格式变化，需要提供兼容读取或明确迁移方案，不能靠清空状态回滚。

DSH 的实现报告交回后，再由 Codex 检查代码差异、重跑相关负例和真实入口流程，决定哪些项目可以标记通过。**DSH 自测通过是交付证据，不能预先代替独立审查结论。**
