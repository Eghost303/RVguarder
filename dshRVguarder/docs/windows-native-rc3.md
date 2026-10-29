# Windows 原生 Python / DSH rc.3 开发

> 历史验收记录，保留原版本与原结论；当前 **v0.2.1-rc.1** 的使用入口和范围见 [安装指南](deployment.md) 与 [版本说明](release-current.md)。

更新：2026-10-26。插件为 `0.2.0-rc.2` **本地开发候选**，不是 GitHub 上已发布的 rc.1。支持明确列出的 DSH `0.2.1-rc.2`、`0.2.1-rc.3`；本轮使用已有桌面 rc.3 验证，没有安装第二份 DSH，没有启动 WSL。

Python 后端支持 **Windows 原生 Python 和 Linux/WSL Python**，要求 Python 3.13+ 及兼容依赖。Windows 支持不限定 Python 的下载来源、发行渠道或安装工具：Windows 使用原生 ACL 和文件句柄，Linux/WSL 保留 POSIX 权限和文件描述符实现。MSYS2 仅是本机验收环境所用的一个发行渠道，不是运行前提；下文的本机路径和包管理命令均为示例。

用户现已确认后端启动、新 profile 接入和基础拦截可用。当前 DSH 插件页展示、宿主内嵌工作台和开箱即用部署仍未完成；本地模式频繁 ask、完全权限模式下被拦截的人工观察尚待定位。本指南描述现有开发部署方式，不表示这些问题已解决。团队进度、问题编号和 Release 分发选择见 [阶段交接记录](../../docs/dev/dsh-progress-2026-10-26.md)。

## 可行性和实施顺序

| 工作 | 实现和结果 |
| --- | --- |
| 识别 Python | 按运行平台选择实现；Windows 原生 Python 使用 Windows 接口，不要求 `getuid`、`O_NOFOLLOW`。本机验收示例为 `C:\msys64\ucrt64\bin\python.exe` 3.14.8，`os.name=nt`。 |
| 替换权限接口 | 私有目录、授权数据库、桥接令牌和签名密钥使用真实 Windows ACL；逐次核验所有者和允许访问的 SID，不跳过安全检查。 |
| 固定文件路径 | 读取资源时固定每一层目录句柄，禁止删除共享，拒绝 junction/重解析点和多硬链接；保留 POSIX 原实现。 |
| 复用桌面 SDK | 从本机 `app.asar` 只读复制必要依赖。桌面包剥除了声明文件，另从 npm 取得**相同版本**声明并核验完整性；不覆盖桌面运行代码。 |
| 版本适配 | 插件读取真实 SDK 版本；只接受 rc.2/rc.3 且拒绝混装版本。后端握手及探针同步支持两版，通信协议仍为 `dsh-guard-v2`。 |
| 安装准备 | 提供 Windows 原生 Python 启动脚本、新 profile 安装脚本及真实桌面 CLI 加载探针，不限定 Python 安装渠道。 |

系统目前安装的桌面入口为：

```text
C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
```

实际执行 `--version` 得到 `0.2.1-rc.3`，archive 内的 tools/agent/working-directory 也为 rc.3，Cordis 为 4.0.5。这里只针对这份已安装运行时做验证；新 DSH 版本仍需适配。

## 已准备好的本地环境

- 本机已准备的 Windows 原生 Python 由 MSYS2 提供，项目解释器为 `.venv/bin/python.exe`，开启 `--system-site-packages`。其他 Windows 安装渠道的虚拟环境通常位于 `.venv/Scripts/python.exe`；启动脚本支持这两种目录，也可用 `-Python` 显式指定解释器。
- 本机通过该发行渠道的包管理器安装了 Pydantic/Pydantic Core、PyYAML、requests、pytest 及其原生依赖；FastAPI、Uvicorn、httpx、dotenv 等装在项目虚拟环境。这是本机安装记录，通用 Windows 环境可直接用 pip 安装项目依赖。
- 本机曾有系统 `pip3.exe` 与发行渠道包管理器冲突；保留该文件，在虚拟环境执行 `ensurepip`。这不是 Windows 原生 Python 的通用安装要求。
- 前端已构建到 `runtime/ui/`。
- SDK 缓存在 `runtime/dsh-sdk-0.2.1-rc.3/`，`sdk-snapshot.json` 记录 archive 哈希和包版本，`sdk-types.json` 记录声明包完整性。
- 插件包为 `dshRVguarder/dsh-rvguarder-0.2.0-rc.2.tgz`；配套后端必须使用本轮源码或新构建的 wheel。

这些缓存和虚拟环境不会进入 Git。重新克隆仓库时按下一节重建。

## 从源码重建

以下命令用于准备新环境；已有可用的项目虚拟环境可直接复用。先确认所选 `python` 为 Windows 原生 Python 3.13+，在仓库根的 PowerShell 中创建虚拟环境：

```powershell
python -m venv .venv
```

### 发行渠道的依赖差异（仅需要时）

一般 Windows Python 环境使用下面的公共 pip 安装步骤即可。如果选择 MSYS2 UCRT64 这一发行渠道，可用其包管理器安装匹配的原生扩展，避免混用不兼容的二进制包。下面是该渠道的可选示例，不是全部 Windows 用户的必做步骤：

```bash
pacman -S --needed mingw-w64-ucrt-x86_64-python-pydantic \
  mingw-w64-ucrt-x86_64-python-yaml \
  mingw-w64-ucrt-x86_64-python-requests \
  mingw-w64-ucrt-x86_64-python-pytest
```

此渠道下，将上面的虚拟环境创建命令替换为 `python -m venv --without-pip --system-site-packages .venv`，使项目可使用配套原生依赖；不要随意通过 pip 升级到与这些原生依赖不匹配的版本。

### Windows 公共构建步骤

根据实际目录选择解释器，后续 PowerShell 示例复用 `$python`；可直接将其设为已有项目解释器的绝对路径：

```powershell
$env:PYTHONUTF8 = '1'
$python = Join-Path $PWD '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) {
  $python = Join-Path $PWD '.venv\bin\python.exe'
}
if (!(Test-Path -LiteralPath $python)) { throw '请先创建项目虚拟环境或指定解释器路径。' }
& $python -X utf8 -m ensurepip --upgrade --default-pip
& $python -X utf8 -m pip install setuptools wheel

npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
& $python -X utf8 -m pip install -e '.[test]' --no-build-isolation

& $python -X utf8 dshRVguarder/scripts/extract-desktop-sdk.py `
  --archive 'C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\app.asar' `
  --output runtime/dsh-sdk-0.2.1-rc.3
& $python -X utf8 dshRVguarder/scripts/complete-desktop-types.py `
  --sdk-root runtime/dsh-sdk-0.2.1-rc.3

npm.cmd --prefix dshRVguarder ci --ignore-scripts --legacy-peer-deps
node dshRVguarder/scripts/link-sdk.mjs runtime/dsh-sdk-0.2.1-rc.3
npm.cmd --prefix dshRVguarder run check
Push-Location dshRVguarder
npm.cmd pack
Pop-Location
```

提取目录必须是新目录；已有正确缓存直接复用。若当前执行环境的临时目录权限使 `ensurepip` 失败，修复临时目录访问或设置一个明确可写的 `TEMP`/`TMP` 后重试，不覆盖系统 pip。

若当前 npm 的 registry 与锁文件的 `registry.npmmirror.com` 不一致，且 npm 报 `EALLOWREMOTE`，可只为该次 `npm ci` 指定 `--registry https://registry.npmmirror.com`，使下载主机与锁文件一致；无需放宽全局 URL 安装限制。本轮未修改全局 npm 配置。

常规依赖使用基础 `uvicorn`，所有支持平台均不要求安装可选加速扩展组 `.[performance]`。依赖安装方式按所选发行渠道调整，不改变 Windows/Linux 双平台支持范围。

## 在现有 DSH 中安装新测试 profile

以下默认 profile 为 `rvguarder-dev`，实例为 `dsh-rc3-dev`，工作区为当前仓库，状态在工作区外的 `~/.rvguarder/dsh-rc3-dev`。已有同名 profile 会拒绝覆盖。可通过参数指定其他新名称、数据目录、工作区或 `DshHome`。

```powershell
.\dshRVguarder\scripts\install-windows-profile.ps1
```

安装脚本会：

1. 核对当前 `dsh.cmd` 的版本。
2. 用所选 Windows 原生 Python 执行 `--prepare-only`，创建私有实例、令牌和签名密钥，随后关闭服务容器。
3. 创建新 profile 清单和 `insert/id` 启用配置，不覆盖 web/desktop profile。
4. 使用当前桌面 CLI 安装本地 tgz，包缓存放在实例自己的 runtime 目录。

如果提示插件“没有 dsh.bundle，作为普通依赖安装”，这是当前显式 patch 启用方式的预期提示。生成脚本已写好启用条目；实际桌面加载探针已确认插件生效。SDK peer 标记为可选安装是为了复用宿主运行时，防止包管理器拉入第二套 Cordis；运行时仍执行严格版本校验，缺少宿主依赖不会静默放行。

然后分别在两个终端启动：

```powershell
# 终端 1，仓库根目录
.\dshRVguarder\scripts\start-windows-backend.ps1
```

```powershell
# 终端 2，Agent 实际要使用的工作区；必须与后端 Workspace 一致
dsh.cmd --profile rvguarder-dev --port 8790
```

DSH 若拒绝读取启动目录的 `.env` 中的控制变量，可从中立目录启动，选择该工作区或使用此版本 DSH 支持的工作区参数；不要为探针改写仓库真实 `.env`。后端工作区绑定仍必须匹配最终可信工作目录。

例如先用新建的无敏感文件目录测试，可同时为两个脚本传入 `-Workspace 'D:\path\to\test-workspace'`，然后从该目录启动 DSH。`-DataDirectory` 必须位于 Agent 工作区之外；不要将仓库根设为工作区后又把状态放进仓库 runtime。

访问 Guard：`http://127.0.0.1:8781/#guard-token=<实例 runtime/dsh-token 内容>`。令牌不由脚本打印；登录链接不可分享。关闭后端或 DSH 使用各自终端的 Ctrl+C；插件不自动启停后端。

安装和启动脚本应使用相同的 Python、Workspace、DataDirectory、DshHome、Profile、Instance、Port。默认自动寻找项目 `.venv` 下 `bin` 或 `Scripts` 中的解释器；也可给两个脚本都传入 `-Python $python`，使用其他位置的 Windows 原生 Python。默认语义模式为 local，不发送辅助模型请求；需要时再通过 `-SemanticMode auto/llm` 配置。

## 测试证据及限制

2026-10-26 本轮证据：

- Windows 原生 Python 专项回归 **112 passed**：DSH、授权、资源版本、内容签名、rc.3 握手，以及 Windows ACL 放宽、junction、硬链接、访问期间替换等实际边界。该次结果来自上述本机验收解释器，不表示已逐一验收所有发行渠道。
- 实际桌面 SDK 集成 **24 passed / 1 skipped**，包含原生审批、拒绝不执行、受控读取/复制/转换、审批后变更、真实本机 HTTPS 单次授权与撤销、十路并发、子会话身份隔离。被跳过的是沙箱不可用的真实执行代码工具内层测试，不能计为通过。
- 使用**已安装桌面 rc.3 CLI**，在全新 DSH_HOME 中通过真实 `plugin add --offline` 安装并启动 Web profile，后端认证握手成功。未读取日常凭据或调用模型，探针结束后停止测试进程。
- 新 profile 的安装脚本已在隔离目录验证；日常 web/desktop profile 未修改。
- 共享策略、连续行为、工具转换、OpenClaw 透传和 UI 资源分组回归共 **92 项**核对通过；其中原先依赖 POSIX 路径的 Node 测试改用标准文件 URL，Windows 资源链接测试使用实际 junction。不是完整 Python 测试集重跑。

可重跑真实宿主探针，输出目录必须是新的：

```powershell
& $python -X utf8 dshRVguarder/scripts/native-profile-smoke.py `
  --dsh-cli 'C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' `
  --package dshRVguarder/dsh-rvguarder-0.2.0-rc.2.tgz `
  --output runtime/native-rc3-profile-new
```

SDK 测试可用 `RVGUARDER_PYTHON` 明确选择 Python。若系统临时目录在当前执行上下文不可写，显式设置一个可写的临时目录。本轮使用仓库内的临时测试目录；它们不是实际 Agent 工作区。

本轮配套产物在 `dist/dsh-rvguarder-0.2.0-rc.2-windows-native/`。包含 wheel、tgz、说明和 SHA-256 清单，未上传或发布。本机验收时，在当时的执行上下文中由 Windows 原生 Python 启动 Node 写 Vite 临时文件曾遇到 EPERM；直接 PowerShell 构建正常。这是本机问题记录，不作为其他安装渠道的限制。因此也支持先分别构建、再组合核验：

```powershell
# 已执行 frontend build 和插件 npm pack 后
& $python -X utf8 dshRVguarder/scripts/build-release.py `
  --frontend-built `
  --plugin-tgz dshRVguarder/dsh-rvguarder-0.2.0-rc.2.tgz `
  --output dist/another-new-native-bundle
```

`--frontend-built` 不绕过 wheel 的静态资源检查；`--plugin-tgz` 仍核对包名/版本并对最终文件计算哈希。

此适配证明原生启动、工具管线和私有存储可用，不证明同一完整 Windows 用户令牌下的恶意进程隔离。当前用户和 SYSTEM 可访问私有状态；DSH 对 Agent 的实际沙箱隔离仍需单独验证。真实在线模型、完整委派生命周期、两小时稳定性、全部沙箱模式及全部扫描项继续沿用 [此前未完成门槛](repair-2026-10-21.md)。默认空外发白名单、单次宿主授权和故障拒绝策略未放宽。

## 下一步界面与功能开发

用户目录初始化若报 WinError 5，先检查 `icacls .venv\bin\python.exe`。本机曾发现虚拟环境启动器带 Low Mandatory Level，使普通终端启动的 Python 也以低完整性运行，不能写普通用户目录；恢复该启动器为 Medium 后，原 `C:\Users\elect\.rvguarder\dsh-rc3-dev` 连续两次初始化成功。此为启动器安全标记问题，不是 MSYS2 渠道限制，也不要求管理员运行后端。本次仅修复单个启动器标记并恢复其原有访问权限；用户目录 ACL 未改动。以后重建虚拟环境时应核对该标记。

- Python 修改：使用当前 editable 环境，重启后端。
- 插件修改：重新 `npm pack`，在队列排空后用同一 profile 的 `dsh plugin --profile rvguarder-dev add <tgz>` 更新，再重启该 profile；不要重跑只创建新 profile 的安装脚本。
- 前端修改：`npm --prefix frontend run build` 后，停止后端并将仓库 `runtime/ui/` 的内容复制到实例 `runtime/ui/`，再启动。已有实例不会自动覆盖旧入口页面。
- 若使用 Vite 开发服务器，默认 `/api` 代理仍指向 8780；DSH 后端为 8781，需同步处理代理和同源登录，不能只改浏览器地址。
- 本轮未更改 UI 设计或权限规则；后续可在已验证环境中逐项改动并验证。

## 宿主子代理语义增强

HostPanel 提供 `host-agent` 语义模式。该模式经 DSH 正式子代理 API 复用当前模型路由，不需要独立 DeepSeek key。启用前，插件会检查 DSH SDK 精确版本、subagents/preset 服务、明确不继承父上下文的本地 provider，以及内部限制插件是否处于激活组合中。限制插件在 Agent 发布前屏蔽全局工具、切换到不呈现 PTC 传输工具的 native 模式并拒绝工具执行；运行时还会核对 child Agent 的有效工具表。任一条件不满足时，工作台显示不可用原因并保留本地分析回退。

只向子代理发送后端构造的脱敏语义任务。它的结构化回答仅作为 `suggested` 语义证据，schema 校验、PMKB/RV 规则和 DSH 原生审批继续控制最终裁决。原始回答不写入调用日志或 outbox。
