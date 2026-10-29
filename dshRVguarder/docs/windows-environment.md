# Windows DSH 开发环境定位

> 历史验收记录，保留原版本与原结论；当前 **v0.2.1-rc.1** 的使用入口和范围见 [安装指南](deployment.md) 与 [版本说明](release-current.md)。

本文是 2026-10-20 的历史环境记录。当前后端支持 Windows 原生 Python 和 Linux/WSL Python，Windows 支持不限定 Python 安装渠道；当前桌面 rc.3 部署见 [原生开发指南](windows-native-rc3.md)，不要把下列本机旧路径当作安装要求。

检查日期：2026-10-20。以下为本机实测路径，不应硬编码为插件默认路径；安装升级后需重新核对。

## 当前安装

当前 Windows PATH 中的 `dsh` 指向 **npm 全局 CLI 安装**。读取 package.json 与直接执行 `--version` 均确认版本为 **0.2.1-rc.2**。Windows Node 实测为 **v24.15.0**。

| 用途 | Windows 路径 |
| --- | --- |
| DSH 启动器 | `C:\Users\ASUS\AppData\Roaming\npm\dsh.cmd`（另有 dsh.ps1） |
| DSH 安装根 | `C:\Users\ASUS\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` |
| CLI 入口 | 安装根下 `lib\bin.js` |
| SDK 包根 | 安装根下 `node_modules\@deepseek-ai` |
| Windows Node | `E:\APP\Nodejs\node.exe` |
| 用户数据根 | `C:\Users\ASUS\.dsh` |
| 已初始化 profile | `C:\Users\ASUS\.dsh\profiles\web` |
| profile 文件 | profile 下 `package.json`、`cordis.yml`、`cordis.patch.yml` |
| 已存在工作区目录 | `C:\Users\ASUS\Documents\deepseek-harness\default-workspace` |

web profile manifest 包含 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`；检查时该 profile 没有 `node_modules`，包依赖列表为空。用户数据根下存在 sessions 与 storages。配置文件的值和凭据内容未读取。

`Documents\deepseek-harness` 本次只发现 default-workspace，不能当作 DSH 源码仓库。`AppData\Local\DSH Doctor\supervisor.cmd` 是第三方 Doctor 启动脚本，不是 DSH 主程序；其引用的 profile 插件路径本次不存在，不能当作有效开发入口。

未发现正在运行的 DSH 命名进程；所查询的 Node 进程可执行路径均属于其他应用。本次没有启动 DSH，也未验证监听端口或健康状态。常规卸载注册表查询未发现 DSH 条目，此结论不等于全机绝无其他副本。

## WSL 读取位置

```text
/mnt/c/Users/ASUS/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh
/mnt/c/Users/ASUS/.dsh/profiles/web
/mnt/e/APP/Nodejs/node.exe
```

在 WSL 下检查安装文件可使用 /mnt 路径；调用 Windows node.exe 时，脚本参数应使用 Windows 路径，避免将 Linux 路径直接传给 Windows 运行时。

已执行成功的只读版本检查：

```bash
/mnt/e/APP/Nodejs/node.exe \
  'C:\Users\ASUS\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js' \
  --version
```

PowerShell 中可执行 `dsh --version`；若脚本执行策略限制 dsh.ps1，可显式使用 `dsh.cmd --version`。

## SDK 核对入口

在 SDK 包根下已核实以下包，均为 0.2.1-rc.2；`@deepseek-ai/cordis` 为 4.0.5：

- `dsh-tools`：工具门禁、执行、结果观察，类型位于 `lib/types/index.d.ts` 与 `lib/types/types.d.ts`。
- `dsh-user-approval`：原生一次性审批，类型入口 `lib/types/index.d.ts`。
- `dsh-session-projection`：会话投影，类型入口 `lib/types/index.d.ts`。
- `dsh-plugin-manager`：插件安装、版本兼容与 profile 管理。
- `dsh-session`、`dsh-sandbox`、`dsh-sandbox-windows-acl`：事件、沙箱及 Windows 能力核对。

各包安装目录包含 README 和编译产物；插件接口应以这一锁定版本的文档与声明为准。现有调研文档记录的 Desktop app.asar 是历史调查来源，不能替代本次 npm 安装路径。

## 后续开发使用方式

开发源码保留在 WSL 的 `/home/yosoro126/RVguarder/dshRVguarder/`。后续应构建插件产物，并在 Windows 可访问的位置验证包依赖和路径，再用专用测试 profile 接入，避免直接改写日常 web profile。

安装包文档说明支持 `dsh plugin --profile <name> <pnpm args>` 管理插件；profile 初始化、SDK 注册、Windows/WSL 路径、服务启动与实际加载已在 2026-10-20 的专用测试 profile 中验证，结果见 [validation-2026-10-20.md](./validation-2026-10-20.md)。不要在日常 web profile 上做同类验证。

本次操作仅定位、读取公开安装元数据与文档、检查进程路径和运行 --version；没有安装插件、启动服务或修改 Windows DSH 配置。

## WSL 原生安装（2026-10-20）

在 WSL 内单独安装了一份 Linux 原生 DSH，与 Windows 安装完全独立。

| 用途 | WSL 路径 |
| --- | --- |
| 安装命令 | `npm install -g @deepseek-ai/dsh@0.2.1-rc.2` |
| 启动器 | `/home/yosoro126/.npm-global/bin/dsh` |
| 安装根 | `/home/yosoro126/.npm-global/lib/node_modules/@deepseek-ai/dsh` |
| SDK 包根 | 安装根下 `node_modules/@deepseek-ai` |
| 用户数据根 | `/home/yosoro126/.dsh`（首次启动时创建） |
| 测试 profile | `/home/yosoro126/.dsh/profiles/rvguarder-wsl` |

运行环境：Node **v24.15.0**、npm **11.12.1**、pnpm **11.2.2**、Python **3.13.13**（conda base）。

```bash
npm install -g @deepseek-ai/dsh@0.2.1-rc.2
dsh --version    # 0.2.1-rc.2
```

说明：

- Windows 与 WSL 的 `~/.dsh` 不是同一目录，profile、会话和插件配置互不相通。
- 开发链接必须指向 WSL 安装根，不能指向 `/mnt/c`，否则 `npm test` 会因跨文件系统慢约 8 倍：
  `node scripts/link-sdk.mjs /home/yosoro126/.npm-global/lib/node_modules/@deepseek-ai/dsh`
- npm 11.12.1 会拦截 5 个安装脚本，但 `node-pty` 有预编译件、`koffi` 通过平台可选包解析，实测均可加载；该版本不识别 `--allow-scripts`。
- 从含 `.env` 的仓库根启动 DSH 会被拒绝（`DEEPSEEK_BASE_URL` 属启动器变量），应从 `dshRVguarder/` 或中立工作区启动。
