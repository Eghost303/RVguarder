# RVguarder 开发记忆

## rc.6 启动目录修复（2026-10-29）

用户从主目录直接运行 `dsh rvguarder-dev` 复现 rc.5 失败：此前脚本切换目录掩盖了托管后台把启动 cwd 当作固定资源根的问题，换 cwd 还会触发实例绑定差异。rc.6 自动托管以 `<DSH_HOME>/workspaces/<profile>` 为固定受控资源根，不修改宿主/会话 cwd；普通工具的认证 cwd 另行传入事件，资源根仍不得与私有数据/状态/运行时重叠。`resourceWorkspace` 是可选的宿主配置，不能由工具参数设置。外部绑定沿用既有显式配置约束。配置错误改为固定分类并显示，不隐藏为网络故障。真实 CMD 与全新整包复验须在完成后记录，不再以便利脚本成功代替直接启动验收。

## 开发收尾约定（2026-10-29）

收尾清理已完成：用户退出 DSH 后，确认原进程 67828 无窗口但仍在后台占用旧测试目录，已结束该残留进程并移除 `runtime/review-20261028/` 的最后空目录。旧资料已私有归档并核对 4988 项；备份位于 `~/.dsh/rvguarder-dev-backups/20261029-finalization/`，不属于公开交付。仓库 runtime 仅保留构建环境、SDK 和前端构建资源。

当前供发布整包为`dist/dsh-rvguarder-0.2.0-rc.5/`，来源011e201，SHA256为57aa38eb03aabc22f4d7f82d7ebc70111224ee3349f2bcb3abd20dd7eeabf66b，npm dry-run通过但未发布。已装入用户目录rvguarder-dev并验证真实启动及宿主探针；其他五个配置块逐字节保留。

真实 DSH 开发和桌面集成测试统一使用 `~/.dsh/profiles/rvguarder-dev`，工作区为 `~/.dsh/workspaces/rvguarder-dev`；不再在仓库下创建 desktop profile。入口为 `dshRVguarder/scripts/start-dev-profile.ps1`，见 [开发指南](dsh-development.md)。历史验收结论保留，但用户安装入口统一为 [DSH 插件下载安装](../deployment/dsh.md)，不引导用户执行旧候选的迁移步骤。平台构建产物解除 private 标记并声明 os/cpu，源码开发包继续保持 private，避免发布不含运行时的轻量包。用户自行执行所有推送、PR、Release 和 npm 发布操作。

## rc.5 审查整改与 Windows 整包（2026-10-29）

桌面续验又发现两项：真实主题快照为`getTheme().active.colorScheme`，修正外层字段误读并补齐深色二级文字/风险标签配色；异常退出旧插件租约会使核心拒绝启动，原overview仍报告后端ready，现通过内部共享状态显式呈现recovery-required，不改变拒绝、租约或队列语义。桌面四组语言/主题、六页签、键盘焦点、关闭重开、恢复锁定及正常退出复验完成，UI-04关闭；追加not_run状态中英文映射。最新包来源b1ffdd9，位于dist/dsh-rvguarder-0.2.0-rc.5-desktop-final，SHA256为54f78fdd4e1b11b67b1c7d768a6c78a9bd7250385726843bddee8a8bc47f3237，原577136…和中间eccebe…已替代。最新13项为12通过（限定矩阵）/REG-01待整改，见rc.5复验表。

基线1539653，直接master提交，不推送/发布。新增挂载独立store/transport、宿主语言active/主题订阅、键盘页签和首次失败重连；后端按manifest内容哈希部署到DSH_HOME私有缓存，避免npm安装目录被常驻executable锁住。冻结程序支持离线inspect/apply/rollback，managedBinding原地保留旧实例、令牌、审计/RV/完成队列；迁移不增加Remote方法。用户新安装Windows x64整包后不必单独启动Python；旧实例需一次离线迁移。见[部署](../../dshRVguarder/docs/deployment-rc5.md)和[复验表](../../dshRVguarder/docs/rc5-revalidation-2026-10-29.md)。

十并发曾复现5秒超时，观测包含握手/排队/决策审计/journal提交。修复并发握手重复、audit连接反复关闭和DELETE journal落盘开销；DSH独占连接使用WAL/FULL，原超时及十路Promise.all不变，无工具重跑。最新完整Node连续三轮52通过/1真实PTC沙箱不可用跳过；组件13/13、末次整包冻结生命周期6/6、冻结维护CLI 1/1。Python两个规则链断言在1539653原始DSH/存储实现同样失败，保留为未关闭问题，不改PMKB或授权语义。历史f3990e8审查5通过/3不通过/5待整改保持。rc.2 UI及Linux整包不能据本轮计通过。

## 独立审查与平台整包（2026-10-28）

已独立审查 f3990e8 并填写任务书第13节：原交付5项通过、3项不通过、5项待整改；见 [审查报告](../../dshRVguarder/docs/ui-review-2026-10-28.md)。发现并修复默认 bundle 非法 return 表达式、下载对象被当 Blob 字节、固定 dsh 实例范围、管理实例身份缺失、500/401 错误吞并、响应事后限额及 E2E 未调用清理。UI 主题/语言/焦点、完整故障矩阵、生命周期/迁移矩阵仍待验收，下方2026-10-27“完成”是原交付陈述，不能代替该结论。

当前插件候选0.2.0-rc.4（未发布），新增 `build-standalone.py` + `managed.ts` 平台整包/宿主托管后端，Windows x64 新安装主路径真实rc.3通过8项页面/下载/凭据扫描测试。整包含Python3.13、基础依赖、UI、PMKB/RV；默认managed配置，无需手工Python/令牌/后端。数据位于 `<DSH_HOME>/rvguarder/dsh-<home/profile哈希>/`，随机回环端口、认证就绪、启动失败保持实际guard、stdin EOF退出；Windows pnpm长路径用命名空间路径处理。普通npm pack仍是外部后端轻量包，既有profile覆盖不会被静默迁移，不能清空历史升级。构建、使用与边界见 [DEP-01实现](../../dshRVguarder/docs/deployment-implementation-2026-10-28.md) 和 [部署指南](../../dshRVguarder/docs/deployment.md)。Linux整包、rc.2 UI、完整桌面生命周期仍未验收，POL-01/02未改规则、未称解决。直接master提交，不推送远程。

更新时间：2026-10-26。此文记录本地源码与仓库文档核对后的状态；不是线上部署状态证明。

## DSH 宿主内嵌界面完成（2026-10-27）

DSH-UX-01/02 已实施并在真实桌面 rc.3 验收通过：插件升级为 `dsh-rvguarder@0.2.0-rc.3`（bundle 化），根因是 `listBundles()` 对"无 `dsh.bundle` 且未选入 `dsh.profile.bundles` 的普通依赖"整条跳过。新结构为双条目 bundle（核心 `rvguarder-dsh` + 管理 `rvguarder-admin`）+ 浏览器客户端包 `dist/webclient.js`（settings.section id=rvguarder + plugins.bundle.config 插槽，内嵌 Preact Guard 经宿主 owner Remote 通道 `rvguarderAdmin` 管理，浏览器不接触桥接令牌）。Python 侧仅新增 `GET /api/dsh/audit-export/{json|csv}` 受控下载端点。构建链 `frontend build + build:embedded → tsc×2 + build-client → npm pack`；旧 profile 用 `scripts/migrate-test-profile.mjs` 迁移（幂等、保身份、备份）。验证：插件 Node 24/24、迁移 3/3、管理 9/9；Python DSH/UI 57 通过（1 项 mklink 沙箱环境失败非回归）+ 共享核心 67/67；E2E：内嵌 6/6、独立 DSH 工作台 4/4、OpenClaw 6/6；真实宿主 RPC/插件页/设置页证据在 `runtime/native-rc3-ui-verify/` 与 `runtime/ui-integration-evidence/`。rc.2 内嵌 UI 未实测（核心兼容沿用既有记录）；DEP-01、POL-01/02 保留。详见 [UI 实现报告](../../dshRVguarder/docs/ui-integration-implementation.md)。

## DSH 宿主内嵌界面交接计划（2026-10-26，已实施）

任务书见 [DSH 内嵌管理界面计划](dsh-ui-integration-plan-2026-10-26.md)。该计划已于 2026-10-27 实施（见上方"宿主内嵌界面完成"记录）；后端仍独立启动，整包部署及 POL-01/02 规则问题不在该阶段范围。

## 人工核验与进度提交（2026-10-26）

用户确认后端启动、新建DSH profile接入及基础运行/拦截正常；同时反馈插件页不可见、Guard前端未嵌入DSH、构建安装和独立启动后端仍繁琐、本地模式频繁ask、完全权限模式下操作被后端拦截。最后两项为人工观察，未完成逐调用复现或根因定位，本阶段只记录，不修复或放宽规则。自动化allow/ask/deny用例通过不替代日常场景验收。详见 [团队交接](dsh-progress-2026-10-26.md) 中的问题编号与证据范围。

用户明确要求直接在master内提交，不为任务新建分支。阶段进度提交9af9d30已快进整合到本地master，临时任务分支已删除，原有提交保留且无合并提交。已备好PR说明，远程推送和上游PR留到下一步；后续从fork的master向HorizonExploration/RVguarder的master提PR。源码部署与PR不要求GitHub Release；后续可按需提供包含已知问题的pre-release配套产物，不能称为一键安装或正式验收。

## 最新原生开发基线（2026-10-26）

当前支持范围为 **Windows 原生 Python 和 Linux/WSL Python**，要求 Python 3.13+ 及兼容依赖；Windows 支持与 Python 的发行渠道无关，不能把本机采用的某个渠道写成运行前提。Windows 部署不依赖启动 WSL，也不要求为桌面 DSH rc.3 另装 rc.2。已实现插件 `0.2.0-rc.2` 本地候选：真实 SDK 版本识别、rc.2/rc.3 握手与探针、桌面 ASAR SDK 只读提取/同版本类型补齐、Windows ACL 私有存储和逐段资源句柄。Windows 使用原生接口，Linux/WSL 保留 POSIX 路径，不跳过原有检查。

本机验收环境示例：`C:/msys64/ucrt64/bin/python.exe` 为 Windows 原生 Python 3.14.8，由 MSYS2 提供；项目 `.venv/bin/python.exe` 复用该渠道的原生系统包。此路径、pacman 和系统包继承均为本机安装细节，不是跨平台支持条件。其他 Windows 发行渠道可使用 `.venv/Scripts/python.exe` 或显式指定解释器；脚本支持两种目录。此次 pip 仅在 venv 引导，未覆盖冲突的系统 pip3.exe。基础 Uvicorn 不强制安装可选原生加速，后者移至 `.[performance]`。桌面 rc.3 CLI 和 archive SDK 实测均为 rc.3，Cordis4.0.5；缓存于 runtime/dsh-sdk-0.2.1-rc.3。SDK peer 由宿主提供，标为可选安装以避免 pnpm 拉入重复运行时，实际版本仍严格校验。

原生专项112通过；SDK24通过/1沙箱不可用跳过。现有桌面CLI的真实离线包安装、独立DSH_HOME/web profile启动、认证握手通过，未调用模型。安装脚本在隔离目录通过，未修改日常web/desktop profile。相关工具为 `start-windows-backend.ps1`、`install-windows-profile.ps1`、`native-profile-smoke.py`；入口和操作见 [Windows 原生开发指南](../../dshRVguarder/docs/windows-native-rc3.md)。当前源码尚未发布，不能混用历史 rc.1 wheel。下方WSL/旧版本路径与验收描述属于历史记录，不能覆盖本节最新约定。

共享回归另有92项分组核对通过；Windows Node测试入口改用file URL，UI打包拒绝junction。配套产物在dist/dsh-rvguarder-0.2.0-rc.2-windows-native。本机验收执行上下文中，从Windows原生Python发起Node写Vite缓存曾EPERM，使用PowerShell分别build/pack后，build-release.py --frontend-built --plugin-tgz <tgz>组合；仍核对资源/包元数据/哈希。此问题只记录实际测试环境，不归因为某个发行渠道，也不限制平台支持范围。

Windows ACL允许当前用户及SYSTEM；不声称隔离同一完整用户令牌下的Agent/进程。真实执行代码工具沙箱、在线模型、完整委派、多插件和长期稳定性仍有门槛。临时目录可能受当前执行上下文限制，测试需显式选可写目录；不通过放宽授权或删除历史来排障。

## 用户目录 WinError 5 修复（2026-10-26）

本机 `.venv/bin/python.exe` 带继承的 Low Mandatory Level，实际进程完整性为 S-1-16-4096；原始 MSYS2 解释器为 Medium（S-1-16-8192）。同一账户的普通 PowerShell 能写用户目录，而低完整性 venv 进程不能，不能据此归因于 MSYS2 或要求管理员运行服务。已仅将项目 Python 启动器恢复到 Medium；用于修复的临时当前用户 FullControl ACE 已撤回，未修改用户目录 ACL。默认 `C:/Users/elect/.rvguarder/dsh-rc3-dev` 已连续两次 prepare-only 成功，runtime ACL 仅当前用户与 SYSTEM。以后重建 venv 若复发，先检查启动器完整性标记；不要通过迁移状态、关闭保护或放宽用户目录权限掩盖。此前 Python 子进程访问部分目录失败的记录应结合该标记核对，不作为发行渠道限制。

## 定位与当前进度

RVguarder 是 OpenClaw Agent 安全插件，当前版本 `0.7.0-dev`（发行元数据 `0.7.0.dev0`），Apache-2.0。当前生产实现是 Python 3.13+ 后端 + 自动生成的 JS Hook + Preact 工作台，不修改 OpenClaw 源码。

最新范围已于 2026-10-20 由用户修订：首个完整 DSH 版本同时迁移 **RV、PMKB、基线扫描、Dashboard、LLM 语义增强与审计**。原 2026-10-19 的“RV 优先、纯 TS + Python 离线校验”计划已被替代。新实施建议为 **TypeScript 宿主适配插件 + Python 共享核心服务 + Preact 工作台**，由 Phase 0 验证 Python 3.13+ 分发、本地传输与生命周期后定稿。DSH 默认 fail-closed，可配置 fail-open；OpenClaw 的严格 fail-open 不变。`dshRVguarder/` 已创建独立 TypeScript 工程骨架（2026-10-20 用户确认命名），当前源码为0.2.0-rc.2本地开发候选（未发布），支持DSH 0.2.1-rc.2/rc.3，完整整机验收尚未完成。详细工作包与发布验收见 [迁移计划](../architecture/dsh-plugin-migration-feasibility-2026-10-19.md) 第 9 节与 [路线图](../ops/roadmap.md)，不能把计划当作已实现能力。

## 源码地图

- `dshRVguarder/`：插件0.2.0-rc.2本地开发候选（未发布），支持DSH 0.2.1-rc.2/rc.3，含真实SDK插件、完成队列、打包和部署脚本；已验证TS构建、SDK管线及真实桌面宿主加载。全功能尚未完成，当前平台与验收范围见本文2026-10-26原生开发基线；2026-10-21记录属于历史候选。

- `clawRVguarder/main.py`：argparse CLI，包括 run、doctor、baseline、install-hook、uninstall-hook、export-audit、build-plugin 与宿主授权命令。
- `services.py`：GuardServices 编排；`manager.py` 是兼容管理器和 mock/patch 锚点。热路径在 `engine/pipeline.py`，业务生命周期在 `core/`。
- `web/app.py`：唯一 FastAPI HTTP 入口；`web/routes/` 负责路由，`api/_handlers.py` 是业务 handler，不是另一套服务器。
- `engine/semantic_enhancer.py`：本地规则或 DeepSeek 语义增强；`policy/` 实现 Trace 编译、覆盖感知匹配、最小权限闭包/差分与组合风险。
- `rv/`：ToolCallIR、ChainRule DSL、滑动窗口、规则、基线学习；`spec/`：规约校验、主体成功证据、跨历史/内容来源证据与宿主精确授权。
- `integrations/hook_runtime.py`：生成 JS 插件；tool_hook_bridge 归一化工具事件，openclaw_adapter 连接 Gateway。
- `storage/`：SQLite / PostgreSQL / 可选 SQLAlchemy，Redis 可选；审计 SQLite + JSONL 双写、SHA-256 哈希链。
- `frontend/`：Vite + Preact、Zustand、preact-router；构建输出 `runtime/ui/`。`e2e/` 使用 Playwright Chromium/Firefox。
- `policies/permissions/`：PMKB 唯一权威源。setup.py 将策略和公开 UI 资源复制入 wheel；包内策略资源不能独立编辑。

## 决策与证据约束

工具调用 → before_tool_call → 语义增强/ToolCallIR → Authorization Trace → PMKB → RV 升级裁决 → allow / requireApproval / block → OpenClaw 审批 → after_tool_call → 审计与成功证据提交。

PMKB 1.2.0：48 operations、79 native rules、76 traces、9 relations、123 vectors；47 migration records 仅用于 provenance/replay，不进入在线候选召回。未知工具、缺失身份与必要特征不能模糊自动放行。

OpenClaw 原生审批卡片是唯一审批源；Dashboard 经 SSE 只读同步。RV 不能降低 PMKB 裁决；前置检查不得提前提交成功历史，只有确认成功的工具完成事件可以扩充证据。session-local 窗口和 principal-global 能力证据应分离，主体状态受 TTL/容量约束，保存在 `runtime/rv-state.json`。

OpenClaw 当前严格 fail-open：后端不可达、HTTP 错误或不可解析响应时所有工具透传，只有明确 block 才阻断；不要把 DSH 规划的 fail-closed 默认值应用到现有 OpenClaw 集成。宿主授权默认不启用，启用时要求宿主独占、位于所有 Agent 工作区之外的授权目录，并绑定身份、任务、资源版本、目的地和时效；工具输入不能自行签发授权。

## 开发与验证

```bash
python -m pip install -e .
python -m clawRVguarder.main --help
python -m pytest tests/ -q
cd frontend && npm run build
cd e2e && npm test
```

日常启动仍用 `openclaw-guard run`（默认 127.0.0.1:8780）。构建需要已有完整 `runtime/ui/`：先构建前端，再构建 wheel。验证安装包应在仓库外使用干净目标目录，检查 UI、PMKB、RV JSON 等资源，避免源码路径掩盖打包缺陷。

注意：GuardServices 初始化会立即生成并安装 Hook（runtime_hook 虽使用 LazyProxy，但构造中调用了 `_get()`）。测试启动必须使用临时 project-dir、openclaw-root 和 config-path，避免改动真实 OpenClaw 配置。.env 含本地密钥，不读取或输出。runtime/output/dist/build、testlab 与部分内部实验脚本被 Git 忽略；忽略不代表本机不存在。

## 包目录迁移约定

Python 主包由 `openclaw_guard/` 迁移为 `clawRVguarder/`，源码导入、动态导入/patch 字符串、CLI 入口、setuptools 发现、资源定位、测试、E2E 启动与文档同步更新。Linux 大小写敏感，须准确使用 `clawRVguarder`。

发行名和命令仍为 `openclaw-guard`；数据库名 `openclaw_guard`、Redis key 前缀、Hook RPC `openclaw_guard.hook_status` 和 JS registrationId 保持原值，以兼容已有运行数据和插件。目录变动后需重新执行 editable 安装以刷新入口与包映射，不能只依赖旧 site-packages 元数据。历史发行包和运行数据不批量改写。setup.py 构建时清理 build/lib 下旧包生成物，防止 setuptools 缓存将新旧包同时装入 wheel。旧 Python 导入与 `python -m openclaw_guard.main` 应改用新包名。

## 待开发与边界

DSH Phase 0 宿主/部署实测 → Phase 1 共享核心及 PMKB/RV/LLM 完整决策 → Phase 2 状态/DSH 基线/Dashboard → Phase 3 全功能打包验收。各阶段属于同一完整版本，PMKB、扫描、面板和 LLM 不能延后排除。共享核心先移除 DSH 启动触发 OpenClaw Hook 安装的副作用；协议绑定可信 host/instance/identity/call，成功完成后去重提交证据。LLM 失败退本地分析，证据不足 ask/deny；核心服务不可用按 DSH failMode 处理，扫描或面板故障不直接阻断所有工具。现有维护项包括熔断告警、规则受控更新、审计轮转、分层健康检查和长期压测。当前拦截仅覆盖宿主 Hook 工具路径，不是系统级沙箱；ptrace/eBPF 采集器仍为预留实现。研究文档里的性能数字不是本次实测结果。

## 本次迁移验证（2026-10-20）

- 改名前后完整 `python -m pytest tests/ -q` 均为 748 passed、18 skipped、4 subtests passed；均有同一条 Starlette/httpx 弃用警告。跳过项不算已验证。
- 前端 `npm run build` 成功；Chromium Playwright 5/5 通过，本次未运行 Firefox。
- `python -m clawRVguarder.main --help` 与 `openclaw-guard --help` 均成功，本机 editable 安装已刷新。
- wheel 构建成功；在仓库外隔离安装，验证 PMKB 1.2.0（48 operations / 79 rules）、RV JSON、UI 与 console entrypoint，确认无旧 openclaw_guard 包目录和运行数据库/密钥文件混入。
- 本次未验证真实 OpenClaw Gateway 在线链路，也未执行 DSH seam 实测。

## Windows DSH 安装定位（2026-10-20）

当前 Windows PATH 的 DSH 为 npm 全局 CLI 0.2.1-rc.2，根目录 `C:\Users\ASUS\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`，CLI 为 `lib/bin.js`，SDK 位于其 `node_modules/@deepseek-ai/`。Windows Node 为 `E:\APP\Nodejs\node.exe`，版本 v24.15.0。已初始化 profile 为 `C:\Users\ASUS\.dsh\profiles\web`，manifest 使用 dsh-base 与 dsh-web-app；未发现 profile node_modules。用户工作区 `Documents/deepseek-harness/default-workspace` 不能当源码安装根。现有 Desktop app.asar 调研属历史记录。已执行 --version，未启动 DSH 或加载插件。完整路径与后续使用约束见 [Windows 开发环境记录](../../dshRVguarder/docs/windows-environment.md)。

## DSH实施状态（2026-10-20）

插件在dshRVguarder/，Python适配在clawRVguarder/hosts/dsh/。已实现认证门禁、原生审批、单次dispatch、风险重评估、完成队列、PMKB/RV/LLM、扫描及工作台。LLM语义缓存30秒/128项、60次每分钟，不缓存授权。主路径为外部托管Python3.13+，数据目录必须独占。Windows真实临时web profile已加载并握手；未改日常配置。证据、性能和剩余PTC/子Agent、在线LLM、ACL、内容血缘验收见[验证记录](../../dshRVguarder/docs/validation-2026-10-20.md)。DSH patch须insert/id；避免从有受限.env的仓库目录启动DSH。

## DSH 全功能核查（2026-10-21）

最新结论：主要模块已接通，尚未全部适配成功；不得称为全功能完成。完整核查见 [适配审计](../../dshRVguarder/docs/adaptation-audit-2026-10-21.md)。本次 Python 773 passed、18 skipped、4 subtests；SDK 12/12；Chromium DSH 3/3、OpenClaw 5/5。未重跑在线模型或真实宿主任务。

已复现：profile 清单 dsh/profile 为 null 时扫描 HTTP 500；DSH 清空历史接口 403，但前端未检查 HTTP 状态并提示成功。功能缺口：DSH 强内容收据/资源版本/宿主授权桥未接入，基线多个关键项仍 unknown/unsupported，MCP/委派等完整语义映射及真实 PTC/子 Agent 验收未完成；显式 fail-open 未记录逐次旁路审计。需完成在线 LLM、Windows ACL、多插件、性能和升级卸载验收。

历史记录已新增 WSL 原生 DSH plugin add 安装成功，不能再笼统描述为“未做任何包管理安装”。当前审计仅新增文档和记忆，不修改业务代码或日常 profile；早期骨架与未实测的描述属于历史状态。

## DSH v2修复实施（2026-10-21）

工程现为0.2.0-rc.1候选，dsh-guard-v2。已修复异常清单扫描500、清空失败误报和跨页面SSE断订阅；新增进程独占、状态schema绑定、精确MCP字段映射、认证探针时效、持久旁路审计、原生read访问证据与受控字节收据分型、本机维护/任务绑定。用户本轮显式允许白名单外发：默认空白名单、双端精确HTTPSURL、每call宿主授权、版本/任务/会话/目的地/时效绑定、授权单次消耗、不跟随重定向/自动重试。本机grant_cli管理入口不对Agent或浏览器开放；原生审批不是持久授权。

真实SDK+Python联调、真实Node PTC内层和十路并发、SDK委派元数据隔离通过。Windows受控复制和临时真实profile加载通过；实际ACL临时workspace-write探针内写允许/外写拒绝，SDK报告partial。WSL包管理安装/升级/回滚/卸载隔离测试通过且数据保留；不等于数据schema任意回滚已验收。真实模型、完整委派生命周期、多插件、两小时稳定性、密钥/状态对Agent实际隔离和基线全部有效配置仍未验收，不能称全功能正式版。代码/测试/用法以[修复记录](../../dshRVguarder/docs/repair-2026-10-21.md)为准；早期审计A1–A7为修复前历史。

最终本轮检查：Python795 passed、18 skipped、4subtests；Node25 passed；DSH浏览器8/8、OpenClaw及403错误提示12/12。配套发行位于dist/dsh-rvguarder-0.2.0-rc.1，wheel仓库外隔离安装、PMKB79、默认空白名单及四项文件哈希通过。Windows SDK最终20次合成只读均值134.33ms、p95 160.78ms；60秒双并发SDK真实文件读取24次、0失败（不替代两小时）。未修改日常profile，未使用真实模型密钥；原有CHANGELOG.md工作区变更保留。

## 真实旧插件替换（2026-10-21）

用户要求重新打包替代旧插件。已从当前源码重新构建完整配套包，刷新dist/dsh-rvguarder-0.2.0-rc.1及四项SHA-256。实际WSL profile ~/.dsh/profiles/rvguarder-wsl 经 dsh plugin add --offline 从0.1.0替换为0.2.0-rc.1，依赖指向仓库根稳定发行tgz。安装入口可加载，dist逐文件与tgz一致；原cordis.patch.yml及17项运行/状态文件哈希保持不变。旧调用日志为空、插件无待提交执行或活动锁，因此未清理或重置历史。

替换前私有备份位于 ~/.local/share/rvguarder/backups/repack-20261021-110225，含before-replacement.tar.gz及结果记录；备份含本地配置/状态，应保持私有，不放进发行包。仓库外确认Python后端导入当前源码且协议v2。未自动启动服务。Windows日常web profile未安装RVguarder，保持原状。
