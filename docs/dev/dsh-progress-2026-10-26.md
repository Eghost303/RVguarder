# DSH 原生部署阶段进度与团队交接（2026-10-26）

> 历史阶段记录：版本、命令和结论保留为当时快照。当前版本 **v0.2.1-rc1**，安装请使用 [现行指南](../deployment/dsh.md)，验收以 [本轮发布记录](../dev/release-v0.2.1-rc1.md) 为准。

## 2026-10-28 后续进度

已完成 f3990e8 独立审查并逐项填写任务书第13节，原交付5项通过、3项不通过、5项待整改；见 [审查报告](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/ui-review-2026-10-28.md)。rc.4 新增 Windows x64 整包/宿主后端托管，真实 rc.3 无手工后端的新安装流程与下载内容验证通过；见 [DEP-01 实现](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/deployment-implementation-2026-10-28.md)。以下为2026-10-26/27历史阶段记录，不能覆盖该独立结论。POL-01/02未修改规则。

## 当前结论

本阶段交付的是 **Windows 原生 Python 后端适配 + DSH rc.3 接入 + 可复现的开发部署工具**。用户已完成后端启动、新建 DSH profile 接入和基础拦截的人工测试，确认基础运行、对接和拦截链路可用。

这仍是插件 `0.2.0-rc.2` 本地开发候选，支持 DSH `0.2.1-rc.2` / `0.2.1-rc.3`，通信协议为 `dsh-guard-v2`。它尚不是具备宿主内嵌界面、一键安装和完整规则验收的正式产品。本阶段只记录下方问题，不修复插件页展示、界面整合、自动托管后端或规则行为。

后续 UX-01/02 的开发交接已写入 [DSH 内嵌管理界面计划](dsh-ui-integration-plan-2026-10-26.md)，**该计划已于 2026-10-27 实施并在真实桌面 rc.3 完成验收**（插件 bundle 化进入"插件 → 已安装"，"设置 → RVguarder"内嵌管理页，宿主 owner 认证通道）；实现、构建/迁移/回滚步骤与证据见 [UI 实现报告](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/ui-integration-implementation.md)。rc.2 上的内嵌 UI 未实测。整包部署（DEP-01）和规则适配（POL-01/02）另行安排，不改变本轮完成范围。

Python 后端同时支持 **Windows 原生 Python 和 Linux/WSL Python**，要求 Python 3.13+ 及兼容依赖；Windows 支持不限定安装渠道，也不要求运行 WSL。平台支持与逐个 Python 发行渠道的实际验收是两个范围，本次 Windows 测试使用本机现有解释器。

## 已完成的工作

| 范围 | 结果 | 主要源码/工具 |
| --- | --- | --- |
| Windows 私有存储 | 用原生 ACL 核验目录、令牌、授权数据库和签名密钥；资源读取固定目录句柄并拒绝重解析点和多硬链接；保留 POSIX 实现 | `clawRVguarder/storage/private_files.py`、`windows_files.py`、`spec/` |
| DSH rc.3 适配 | 从实际加载的 SDK 读取版本；握手和探针明确接受 rc.2/rc.3，拒绝混装或其他未支持版本 | `dshRVguarder/src/sdk.ts`、`client.ts`、`probe.ts`、`clawRVguarder/hosts/dsh/` |
| 复用现有桌面运行时 | 只读提取已安装桌面包所需 SDK，补齐同版本类型声明并校验完整性，不要求另装 rc.2 | `extract-desktop-sdk.py`、`complete-desktop-types.py`、`link-sdk.mjs` |
| 开发部署脚本 | 初始化实例、新建独立 profile、安装本地 tgz、单独启动后端；脚本支持指定 Python 和配置路径 | `install-windows-profile.ps1`、`start-windows-backend.ps1`、`server --prepare-only` |
| 构建交付 | 生成匹配的插件 tgz、后端 wheel、部署说明和 SHA-256 清单；可使用已单独构建的 UI 和插件 | `build-release.py` |
| 依赖与兼容检查 | FastAPI 和基础 Uvicorn 为必需依赖；`uvicorn[standard]` 移至可选 `performance` 组；补充 Windows 资源链接与标准文件 URL 测试 | `pyproject.toml`、`tests/` |
| 文档 | 同步候选版本、宿主版本、双平台支持、一般部署流程和阶段边界 | 中英文 README、AGENTS、部署指南及本交接记录 |

现有权限规则、连续行为检查、原生审批和审计继续复用共享核心。本阶段未调整权限规则或承诺降低审批比例。

## 当前结构与用户入口

```text
DSH 的任务与工具调用
  → profile 中加载的 TypeScript 插件
  → 本机认证 HTTP
  → 独立 Python 服务（权限规则 / 连续行为检查 / 审计）
  → 允许、DSH 原生审批或拒绝

浏览器单独访问 RVguarder 工作台 → 同一个 Python 服务
```

- **DSH 插件代码已加载**：已有真实 CLI 安装、宿主加载和握手证据，用户也确认了实际拦截。
- **DSH 插件页中可见**：已解决（2026-10-27）。插件以 `dsh.bundle` 层安装，"插件 → 已安装"显示 `dsh-rvguarder@0.2.0-rc.3`，启停/移除沿用宿主机制。
- **Guard 工作台已存在**：已内嵌（2026-10-27）。"设置 → RVguarder"在宿主内管理（概览/调用与审批/规则与 RV/扫描与报告/审计/语义模式）；独立工作台保留作开发/诊断/OpenClaw 路径。
- **后端仍是外部进程**：插件不会自动启动、停止或升级 Python 服务。

当前包没有声明 `dsh.bundle`，采用独立依赖加 profile `insert/id` patch 的启用方式；CLI 的 plain dependency 提示不等于加载失败。它与插件页未展示现象是否存在直接关系，尚未定位。

## 人工核验发现的问题（本阶段仅记录）

| 编号 | 观察到的现象 | 当前结论与后续核验 |
| --- | --- | --- |
| DSH-UX-01 | DSH 的“插件”页中看不到已接入的 RVguarder 项 | **已解决（2026-10-27）**：根因为普通依赖且无 `dsh.bundle` 时 `listBundles()` 整条跳过；bundle 化后真实 rc.3 验收通过 |
| DSH-UX-02 | RVguarder 前端与 DSH 界面分离 | **已解决（2026-10-27）**：内嵌 Preact 管理页 + 宿主 owner Remote 通道 + 局部页签导航，真实 rc.3 E2E 6/6 通过 |
| DSH-DEP-01 | 需要准备 Python/Node 依赖、构建 UI/插件、安装 profile，并单独启动后端 | rc.4已实现Windows x64整包/后端托管新安装；Linux/arm64、完整桌面生命周期与旧实例迁移仍待专项验收 |
| DSH-POL-01 | 本地规则模式下，人工测试中请求似乎普遍被判为 `ask`，需要人工审批 | 用户观察，未做逐请求归因，不能断言所有请求必为 ask；后续结合实际工具映射、参数、身份、匹配规则与缺失证据复现 |
| DSH-POL-02 | DSH 开启“完全权限”模式后，人工测试中操作被后端拦截 | 用户观察，待区分 ask/deny、可信上下文、原生审批和真正执行前复核；DSH 的权限模式不会自动成为 Guard 授权，但当前行为是否符合预期尚需验证 |

自动化用例中的允许/审批/拒绝通过，不等于上述日常任务场景已经验收。也不能据现象直接放宽规则、关闭拒绝策略或将完全权限视为绕过 Guard 的依据。后续问题定位应保存脱敏的调用、裁决、规则编号和证据，不将令牌或密钥放入问题报告。

## 团队成员的一般部署流程

### 方式 A：从源码运行（当前开发推荐路径）

1. 获取包含本阶段提交的源码，准备 Python 3.13+、Node 24 和受支持的 DSH；选择一个新测试 profile。
2. 建立 Python 环境并安装项目依赖，构建 `frontend/` 静态工作台。
3. 将 SDK 连接到实际使用的 DSH 运行时。桌面 ASAR 安装需先提取 SDK、补齐同版本类型声明；普通安装可直接指定安装根目录。
4. 构建插件并 `npm pack` 得到 `dsh-rvguarder-0.2.0-rc.2.tgz`。
5. 初始化独占实例并安装新 profile。Windows 可使用 `install-windows-profile.ps1`：它执行 `--prepare-only` 生成私有令牌，再创建配置和安装包，**不启动长期后端服务**。
6. 单独启动 Python 服务，再从对应工作区启动 DSH 测试 profile。两端的工作区、profile、实例编号、端口和令牌路径必须一致。
7. 登录独立 Guard 工作台，验证连接、动作记录和拦截。需要审批时仍在 DSH 原生界面处理。

首次构建完成后，Windows 的典型日常入口如下（仓库根目录执行；已有 profile 不再重复创建）：

```powershell
# 首次安装，仅使用一个新的 profile 名称
.\dshRVguarder\scripts\install-windows-profile.ps1

# 终端 1：每次运行均需单独启动后端
.\dshRVguarder\scripts\start-windows-backend.ps1
```

```powershell
# 终端 2：从实际 Agent 工作区启动对应 DSH profile
dsh.cmd --profile rvguarder-dev --port 8790
```

默认 Guard 工作台为 `http://127.0.0.1:8781`，上述 DSH 测试界面为 `http://127.0.0.1:8790`。首次工作台登录使用实例令牌链接；它们目前是分开的入口。详细构建、路径、登录、更新和临时目录说明见 [Windows 原生开发指南](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/windows-native-rc3.md)；Linux/WSL 见 [通用部署说明](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/deployment.md)。个人安装路径均为示例，不是团队成员的固定路径。

### 方式 B：使用配套构建产物

维护者可分发同批次的 tgz、wheel、说明和 `manifest.json`。成员安装 wheel 和 Python 依赖、通过 DSH CLI 安装 tgz，并配置实例/profile；之后仍需单独运行 Python 服务。已内含 UI/规则的 wheel 和已编译的 tgz 可省去成员自行编译，但**不会省去运行环境、profile 配置、后端进程或独立工作台**。

当前公开的历史 rc.1 不能替代本阶段修改后的后端；后端 wheel 的版本名仍为 `openclaw_guard-0.7.0.dev0`，不能只按文件名判断是否配套，应同时核对来源、协议与 manifest 哈希。

## GitHub 是否必须构建 Release

**提交源码、评审 PR 和从源码部署均不要求 GitHub Release。** 本阶段先提交代码与文档，不创建 tag 或 Release，也不把缓存、运行数据和构建包放进源码提交。

Release 是让其他成员下载同批次产物的可选分发渠道。需要开展无需源码编译的团队候选测试时，可在单独确认后：

1. 从明确的提交或 tag 重新构建匹配的插件、wheel、公开 UI 和规则。
2. 验证安装、基础启动、文件完整性和凭据排除，再准备安装说明与当前已知问题。
3. 发布标注 **pre-release / 开发候选** 的 Release，将 tgz、wheel、说明、profile 生成器及校验清单作为附件。
4. 在 Release 说明中保留上述插件页、独立 UI、手动部署和规则适配问题；不要宣称一键安装或正式安全验收完成。

构建工具可生成本地产物，无需先推送 GitHub：

```powershell
# 已完成 frontend build 和插件 npm pack；输出目录必须不存在
python -X utf8 dshRVguarder/scripts/build-release.py `
  --frontend-built `
  --plugin-tgz dshRVguarder/dsh-rvguarder-0.2.0-rc.2.tgz `
  --output dist/dsh-rvguarder-team-candidate
```

若 `python` 不是项目所选解释器，应使用项目虚拟环境的完整路径。构建脚本没有上传 Release 的步骤；生成的目录也不是包含 Python/Node 全部依赖的离线安装器。

## 验证证据的范围

以下为此前适配阶段的实际记录，本轮文档整理不会将其改写为新一轮全量测试：

本轮提交准备另完成 TypeScript 严格检查、变更 Python 源码语法检查、文档链接/frontmatter 检查，以及提交候选文件的产物和敏感内容排除检查；本轮不重启用户实例或执行规则修复。

| 验证 | 已记录结果 | 范围 |
| --- | --- | --- |
| Windows 原生 Python 专项 | 112 passed | DSH 接口、授权、资源证据、内容签名、真实 ACL/链接/替换边界 |
| 实际 SDK 集成 | 24 passed / 1 skipped | 允许/审批/拒绝、完成队列、受控文件、单次授权及并发；沙箱不可用的代码工具内层用例跳过 |
| 共享回归分组检查 | 92 项核对通过 | 规则、连续行为、工具转换、OpenClaw 透传及 UI 资源；不是完整 Python 测试集重跑 |
| 已安装桌面 rc.3 CLI | 隔离 profile 安装、加载和认证握手通过 | 未向模型发送任务，不等于全部真实任务验收 |
| 配套 wheel | 隔离安装、79 条规则、工作台资源检查通过 | 本机构建产物，不等于已发布 Release |
| 用户当前人工测试 | 后端启动、新 profile 接入、基础运行和拦截正常 | 同时发现上表五项问题，规则与产品体验未验收完毕 |

Windows ACL 不隔离持有同一完整用户令牌的任意进程。完整沙箱矩阵、在线模型、委派、多插件组合、长时间稳定性及其他尚未完成的门槛仍需独立验收。历史基线见 [v2 修复记录](https://github.com/Eghost303/RVguarder/blob/master/dshRVguarder/docs/repair-2026-10-21.md)。

## 本地提交与下一步 PR

按用户要求，本阶段及后续工作直接在本地 `master` 内提交，不为任务新建分支。阶段进度提交 `9af9d30` 已归入 `master`，临时任务分支已删除。目标上游为 `HorizonExploration/RVguarder` 的 `master`；PR 正文草稿见 [PR 说明](pr-dsh-native-rc3.md)。本轮不推送远程、不创建远程 PR 或 Release。

后续由提交者核对正文，将本地 `master` 推送到 fork，再从 `Eghost303:master` 向上游 `master` 创建草稿 PR。PR 应以“原生部署与 rc.3 接入阶段交付”为范围，规则和 UI 问题保留为后续工作，不写成已经修复。

## 2026-10-28 宿主子代理语义委派实现

- 新增 DSH `host-agent` 语义模式：由插件通过 DSH 子代理服务启动工具隔离子代理，沿用当前 DSH agent 的模型路由，不要求 RVguarder 单独配置 API key、模型或 provider；不传递父级对话记录。缺少 DSH 子代理 / 空 preset / in-process provider 能力时，语义增强退回本地规则。
- 子代理只返回受限语义建议。插件在接受结果前检查子代理运行时工具 schema 为空；调用受 2 秒上限和 16 KiB 响应上限约束。后端将请求 ID 绑定单次工具调用，8 秒过期并单次消费；仅在内存中暂存解析后的语义结构，不记录原始模型正文。授权决策仍由 PMKB 和 RV 产生。
- DSH 工作台语义模式选择器接入现有状态与能力 API；能力探针过期或宿主能力缺失时禁用该选项，并显示当前委派状态与本地回退原因。
- 本轮验证：新增 Python 用例 7 项通过；DSH `npm run check` 通过；DSH 完整插件套件 30 项通过；前端 production build 通过；本地打包的插件经已安装 DSH `0.2.1-rc.3` 桌面 CLI 在临时 profile 安装、加载及认证握手通过，子代理能力探针为 `available=true / ready`，模型调用数为 0。真实宿主验证发现并修正了 provider 模块必须从 DSH 运行时入口解析、且注册时显式绑定宿主 subagents 服务的问题。
- 验收边界：`0.2.1-rc.2` API 按版本约束纳入并做过接口兼容检查，但本机未安装 rc.2 CLI，未进行该版本的运行时冒烟；本轮也未触发真实子代理推理。RC3 启动冒烟不代表在线模型、真实委派或长期稳定性验收，当前包仍为本地候选，未发布。
