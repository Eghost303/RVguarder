# DSH 本地部署

当前 Windows x64 rc.5 整包安装、保历史迁移和回滚请使用 [rc.5 部署指南](deployment-rc5.md)。下方 rc.4 部分为历史候选记录；rc.5 已增加私有运行时缓存与 `managedBinding` 离线迁移，不能按 rc.4 的新空实例方案迁移历史。

## 2026-10-28：平台整包候选（DEP-01）

当前开发候选为 `dsh-rvguarder@0.2.0-rc.4`。新增按操作系统/架构分发的整包，Windows x64 在本机验收；Linux 构建入口已提供但未实测，rc.2 内嵌 UI 仍未验收。rc.3 已有插件页与设置页入口。下方手工 wheel/tgz 说明属于**外部后端模式**，不代表平台整包的安装步骤。

终端用户取得与平台匹配的 `dsh-rvguarder-0.2.0-rc.4-win32-x64.tgz` 和同批 `SHA256SUMS` 后，核对 SHA-256，在 DSH 的插件安装入口选择该文件；也可在已准备的 profile 中执行：

```powershell
Get-FileHash .\dsh-rvguarder-0.2.0-rc.4-win32-x64.tgz -Algorithm SHA256
dsh.cmd plugin --profile <你的profile> add .\dsh-rvguarder-0.2.0-rc.4-win32-x64.tgz
```

重新启用插件或重启 DSH 后，进入“设置 → RVguarder”。整包自带 Python 3.13 与基础依赖、UI、PMKB/RV；无需源码仓库、pip、WSL、Vite 或单独启动后端。包安装仍使用 DSH 自身的包管理器；当前验证的离线含义是**运行时无下载**，不是断网条件下整个宿主包管理缓存均已验证。

整包的 bundle 两个条目都使用 `backendMode: managed`。宿主的 `profileContext` 和工作目录服务确定实例，私有数据保存在 `<DSH_HOME>/rvguarder/dsh-<home/profile哈希>/`；Python 现有 ACL/目录独占与历史绑定检查保持。端口由系统分配，仅绑定 127.0.0.1；令牌初始化、状态认证和进程就绪检查在宿主完成，浏览器仍只使用 owner Remote。核心与管理入口共用一个子进程，启动期间拒绝工具，缺包/错误平台/哈希损坏/状态冲突时拒绝执行并呈现连接错误；不清除历史修复故障，不接管外部后端。

正常禁用/卸载时关闭托管进程并保留实例、令牌、审批/完成记录和审计。宿主意外退出导致 stdin EOF 时，后端退出；工具调用中断仍沿用现有恢复锁定，不自动重放或删除 `owner.lock`。重新启用前需要核对不确定执行的历史。直接删除插件包不会删除数据。

**旧 profile 升级**：原有用户层 config 会覆盖 bundle 默认值，整包不会静默迁移已有实例。继续沿用原配置时仍是外部后端模式。先停止 DSH/后端并备份 profile 与数据；只有在完成队列已对账后，才可在宿主原生配置中把核心与管理两行改成 `backendMode: managed`，这会使用新的 home/profile 绑定实例，旧数据保留作证据。需要沿用旧实例时继续使用外部模式，不能把新空实例称为历史迁移成功。回滚恢复备份配置及原匹配包，不能混用新旧实例或删除队列；持久 schema 未改变。

构建者在目标 Windows/Linux 平台准备 Python 3.13+、Node 24 和锁定 SDK（沿用原生开发指南），安装构建依赖后：

```powershell
python -m pip install -r dshRVguarder/requirements-standalone.txt
python dshRVguarder/scripts/build-standalone.py --output dist/dsh-rvguarder-0.2.0-rc.4-platform
```

该命令构建两份前端、类型检查、客户端、PyInstaller onedir 后端，再在临时目录打包，无安装期脚本。输出平台 tgz、SHA256SUMS 与安装说明；包内 `backend/manifest.json` 校验完整文件清单，`build-info.json` 记录 Python/依赖版本与源码基线，`licenses/` 包含 Python 与第三方许可证。哈希用于完整性校验，不能替代可信发布渠道或签名。源码普通 `npm pack` 仍生成轻量**外部后端**包，两类文件名必须区分。

验收与已知缺口见 [独立审查](ui-review-2026-10-28.md) 和 [DEP-01 实现记录](deployment-implementation-2026-10-28.md)。POL-01/02 未改规则，仍待逐调用定位；本轮没有发布到远程。

## 外部后端模式与历史部署记录

2026-10-26：源码支持 DSH rc.3，以及 **Windows 原生 Python 和 Linux/WSL Python** 双平台后端；Windows 支持不限定 Python 的安装渠道，均要求 Python 3.13+ 及兼容依赖。当前为插件 0.2.0-rc.2 本地开发候选。Windows 桌面安装请使用 [原生开发指南](windows-native-rc3.md)；下方 rc.2/WSL 命令保留为另一种部署路径和历史参考，WSL 不是 Windows 部署的必需组件。

此插件在 `RVguarder/dshRVguarder/` 开发，调用 `clawRVguarder.hosts.dsh` 的共享 Python 服务，工作台复用现有 Preact 前端。支持 Node 24 与明确列出的 DSH 0.2.1-rc.2/rc.3；其他版本须重新做兼容验证。

原手工部署支持独立后端；rc.3 已完成 bundle 插件入口与内嵌工作台，独立工作台继续保留。旧阶段现象与规则问题见 [阶段交接与已知问题](../../docs/dev/dsh-progress-2026-10-26.md)。外部后端模式不自动启动 Python。

一般顺序：准备依赖 → 构建 UI/插件或取得同批次 wheel/tgz → 初始化实例和安装新 profile → 单独运行后端 → 启动 DSH profile → 登录独立工作台。首次初始化可以使用 `--prepare-only`，因此无须为了生成令牌而保持后端运行；实际工具接入前仍须启动长期后端。

源码部署、commit 和 PR 均不要求 GitHub Release；Release 仅是可选的候选产物分发方式。需要分发时应提供配套 wheel/tgz、说明和校验清单，并标注 pre-release 和已知问题；当前没有自动安装 Python/Node 依赖或托管后端的一体化安装器。

## 构建

在仓库根安装 Python 3.13+ 依赖并构建前端：

```bash
npm --prefix frontend ci
npm --prefix frontend run build
python -m pip install -e .
cd dshRVguarder
npm ci --ignore-scripts --legacy-peer-deps
node scripts/link-sdk.mjs '<DSH 安装根目录>'
npm run check
npm test
npm pack
```

Windows 本机安装根目录及 WSL 映射见 windows-environment.md。link-sdk 只在本工程的 node_modules 创建开发链接，不修改 DSH。依赖安装使用 legacy-peer-deps 是为了从锁定的宿主安装中解析 SDK，避免 npm 拉取另一版 Cordis；运行时必须由同一个 DSH 安装提供 peer SDK。

构建配套发行目录（目录必须不存在）：

```bash
python dshRVguarder/scripts/build-release.py --output dist/dsh-rvguarder-0.2.0-rc.2
```

发行目录包含插件 tgz、Python wheel、安装说明和 SHA-256 清单；wheel 含公开 UI、PMKB、RV 规则。Python/Node 解释器及 Python 第三方依赖需预先安装，**发行目录不是自带全部依赖的离线安装器**。

## 启动共享服务

先运行服务，再启用插件。数据目录必须独占，位于 Agent 工作区之外；本版本采用外部托管服务，不由插件自动启动 Python。

```bash
python -m clawRVguarder.hosts.dsh.server \
  --project-dir /home/yosoro126/.local/share/rvguarder/dsh-dev \
  --dsh-home /mnt/c/Users/ASUS/.dsh \
  --workspace 'C:\Users\ASUS\Documents\deepseek-harness\default-workspace' \
  --profile web --instance-id dsh-dev --port 8781 --semantic-mode auto
```

后端可直接使用 Windows 原生 Python，也可在 Linux/WSL 中运行；Windows 的依赖安装方式由所选 Python 发行渠道决定，部署与验证范围见原生开发指南。WSL 路径仍支持同机盘符到 `/mnt/<盘符>/` 的转换；UNC/远程工作区路径尚未支持，不能按工作区内路径放行。

服务只绑定 `127.0.0.1`。Windows DSH 到 WSL localhost 的连通性受 WSL 网络配置影响，必须验证；不应为绕过网络问题把服务无认证地暴露到局域网。

服务输出 URL 和 token 文件路径，不输出 token 内容。每个实例的数据目录、instanceId 和 token 必须匹配；不要复用 OpenClaw runtime。token 位于 `<project-dir>/runtime/dsh-token`，只提供给受控插件与本机工作台登录。

LLM 使用宿主环境 `DEEPSEEK_API_KEY` 或受控 runtime/guard-config.json，不能将密钥写入公开插件包。local 模式强制不调用 LLM；auto 优先使用已有配置并可回退；llm 模式要求配置密钥。LLM 输出经过既有受限 schema 校验，失败退回本地分析，不能授予权限或降低硬拒绝。

## 安装和启用插件

先使用单独的测试 profile，禁止用 `--from-default-profile` 重置日常 web profile。在 Windows Node 中运行工程的创建脚本（也随配套发行目录提供），它创建 dsh-base + dsh-web-app 清单及正确的 insert patch，并拒绝覆盖现有 profile：

```powershell
node scripts/create-test-profile.mjs --profile rvguarder-dev --instance dsh-dev --token 'C:\path\to\private\dsh-token' --backend http://127.0.0.1:8781
```

然后通过该版本 DSH 的 profile 管理安装构建好的 tgz：

```powershell
dsh.cmd plugin --profile rvguarder-dev add 'C:\path\to\dsh-rvguarder-0.2.0-rc.2.tgz'
```

创建脚本已写入启用条目。若自行配置，必须使用锁定版本的 `insert`/`id` patch DSL，不能把普通插件列表直接放到 patch 根：

```yaml
- insert:
    - id: rvguarder-dsh
      name: dsh-rvguarder
      config:
        backendUrl: http://127.0.0.1:8781
        instanceId: dsh-dev
        tokenFile: 'C:\path\to\private\dsh-token'
        stateDir: 'C:\Users\ASUS\.rvguarder\dsh-plugin\dsh-dev'
        timeoutMs: 5000
        failMode: closed
```

如 backend 位于 WSL，tokenFile 必须指定 Windows 可读取的路径（可以使用已核实的 WSL UNC 路径）。工作目录服务 workingDirectory、tools 和它们的依赖必须已装配。没有可信 Agent 身份/工作目录的调用默认拒绝。

DSH 原生审批是唯一入口。Dashboard 不提供替代审批或持久 allow-always。默认核心服务故障 fail-closed；只有受控部署明确配置 failMode: open 才透传服务故障，已取得的硬拒绝仍不能降级。

## 工作台登录

首次访问使用本机一次性打开的链接：`http://127.0.0.1:8781/#guard-token=<runtime/dsh-token 内容>`。前端会移除 URL fragment，再换取 HttpOnly、SameSite=Strict 的一小时会话 cookie。不要分享此登录链接。API 与 SSE 需要认证，浏览器会话不能提交宿主决策或工具完成事件。

工作台显示实例、profile、连接、语义模式、动作/原生审批同步、PMKB/RV 证据、DSH 基线和审计导出；每个服务只承载一个实例，通过不同端口切换实例。扫描不能静态证明的沙箱/ACL/端口项显示 unknown/unsupported，而非通过。

## 故障、升级和卸载

- 完成事件先写插件私有 outbox，再通过认证通道提交；后续前置决策会等待积压补交。不要删除未提交的 completions.json。
- 核心 SQLite 日志在决策/成功提交中断时锁住新授权，返回 recovery_required；需核对服务日志、动作、DSH 原生事件和实际执行结果，不能盲目清空数据库以恢复。
- 规则/配置更新后待处理决策有 300 秒有效期；过期审批会拒绝，用户需重新发起操作，不自动重跑。
- 升级先停用插件并排空完成队列，备份实例数据，升级匹配版本 wheel/tgz 后验证。外部托管 Python 服务由部署者启停，插件卸载不会杀死其他进程或删除审计数据。
- 从测试 profile 移除插件包并删除对应启用条目；保留 runtime/outbox/审计目录直至完成取证或归档。

完整 DSH 应用的 Web 卡片、PTC 调度、子 Agent 和 Windows ACL 强制执行仍须以 Phase 0/发布验收记录为准；SDK 管线测试不能替代整机防护证明。

## WSL 原生部署（Linux 全栈）

已在 2026-10-20 复验：与 Windows 宿主使用同一固定版本，但所有路径按 Linux 语义处理。

```bash
# 1. 安装固定版本 DSH（必须与 package.json 的 engines.dsh 一致）
npm install -g @deepseek-ai/dsh@0.2.1-rc.2
dsh --version    # 0.2.1-rc.2

# 2. 开发链接指向 WSL 安装根，不要指向 /mnt/c
cd dshRVguarder
rm -f node_modules/@deepseek-ai
node scripts/link-sdk.mjs /home/yosoro126/.npm-global/lib/node_modules/@deepseek-ai/dsh
npm run check && npm test

# 3. 打包
npm pack --pack-destination /tmp

# 4. 启动共享服务（Python 3.13+）
python3.13 -m clawRVguarder.hosts.dsh.server \
  --project-dir /home/yosoro126/.local/share/rvguarder/dsh-dev \
  --dsh-home /home/yosoro126/.dsh \
  --workspace /home/yosoro126/<实际工作区> \
  --profile rvguarder-dev --instance-id dsh-dev --port 8781 --semantic-mode local

# 5. 创建隔离 profile 并安装插件
node scripts/create-test-profile.mjs --profile rvguarder-dev --instance dsh-dev \
  --token /home/yosoro126/.local/share/rvguarder/dsh-dev/runtime/dsh-token \
  --backend http://127.0.0.1:8781 --home /home/yosoro126/.dsh
dsh plugin --profile rvguarder-dev add /tmp/dsh-rvguarder-0.2.0-rc.2.tgz

# 6. 启动（必须避开含 .env 的目录）
dsh --profile rvguarder-dev --port 8790
```

约束：

- `npm install -g` 提示的安装脚本拦截不影响运行：`node-pty` 自带预编译件，`koffi` 通过平台包解析；npm 11.12.1 不识别 `--allow-scripts`。
- 不要把工程放在 `/mnt/c` 下跑 `npm test`；实测慢约 8 倍（3022ms → 358.9ms）。
- 每个实例独占 `--project-dir`、`--instance-id`、`--port` 和 profile；不要复用 OpenClaw 的 runtime 目录。
- WSL 的 Landlock/沙箱可用性尚未验证；不可用时会以 `SANDBOX_UNAVAILABLE` fail-closed。

## 实测启动注意事项

DSH CLI 会读取启动目录的 .env，并拒绝把部分启动控制项放在 .env 中。本仓库的 .env 可触发该检查；应从实际工作区或中立目录启动 DSH，启动控制变量由受控环境显式提供，不能为通过探针而改写用户 .env。

显式 failMode: open 仅对尚未取得裁决的连接/服务不可用透传；协议冲突、未确认历史、无可信上下文和已经取得的拒绝不透传。已取得裁决后 dispatch 同步失败仍拒绝执行。

## v2 协议升级

历史插件0.2.0-rc.1与当前0.2.0-rc.2均使用dsh-guard-v2；当前原生兼容改动仍须使用匹配源码或wheel。升级前使用旧版排空全部pending/dispatch及完成队列，停止本实例并备份完整project-dir/stateDir，之后同时升级插件和后端。旧协议或残留旧队列拒绝混用；不得删除未确认历史来绕过。若回滚，恢复升级前的配套包与数据备份，不能让旧后端直接写入新版状态。

可选本地受控工具、精确MCP映射、探针、离线检查/核对命令及完整限制见[修复记录](repair-2026-10-21.md)。插件config可增加evidenceKeyFile，指向后端runtime/authorization/content-signing.key的受控Windows可读路径。该文件不等于桥接token，不能输出或公开分发。受控外发默认禁用；启用须配置双端精确HTTPS白名单和每次调用的宿主授权，详见修复记录。

插件owner.lock遇到已退出PID时不会自动竞争接管。先停止本实例所有插件进程，核对executions.json/completions.json与实际结果，再只清理该实例owner.lock；保留两个日志文件。后端deciding/completing中间态不能用普通完成重放强制消除，需人工核对或恢复一致备份。
