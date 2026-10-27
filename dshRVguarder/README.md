# dshRVguarder

DSH **0.2.1-rc.2 / 0.2.1-rc.3** 的 RVguarder 适配插件，当前源码为 **0.2.0-rc.3 本地开发候选**（未发布）。工程位于 `RVguarder/dshRVguarder/`，复用 Python 核心和 Preact Dashboard；自 rc.3 起以 `dsh.bundle` 层提供 **原生插件页展示** 与 **设置 → RVguarder 内嵌管理界面**。

Python 后端支持 **Windows 原生 Python 和 Linux/WSL Python**，要求 Python 3.13+ 及兼容依赖，不限定 Windows 上 Python 的安装渠道。Windows 原生 Python + 当前桌面 rc.3 的部署入口见 [原生开发指南](docs/windows-native-rc3.md)，无需启动 WSL 或另装 rc.2。

rc.3 已在真实桌面宿主完成验收：插件页“已安装”显示 `dsh-rvguarder@0.2.0-rc.3`（可启停/移除），"设置 → RVguarder"在宿主内直接管理 Guard（概览/调用与审批/规则与 RV/扫描与报告/审计/语义模式），认证经宿主 owner 通道，浏览器不接触桥接令牌。后端仍由用户单独启动；整包部署（DEP-01）与规则问题（POL-01/02）保留待办。实现细节、构建/升级/回滚步骤与验收证据见 [实现报告](docs/ui-integration-implementation.md)。

部署顺序为准备依赖 → 构建独立工作台与内嵌模块 → 构建插件（含浏览器客户端包）→ 初始化实例并安装新 profile → 启动 Python → 启动 DSH。`install-windows-profile.ps1` 只初始化并安装，`start-windows-backend.ps1` 才启动长期服务。提交源码/PR 不需要 GitHub Release；后续可按需分发配套 tgz/wheel 的 pre-release，不能因此省略后端进程和配置。

已实现真实 SDK 门禁、原生审批、单调拒绝守卫、PMKB/RV/LLM 桥接、成功历史去重恢复、审批后重评估、DSH 扫描与 JSON/HTML/PDF、工作台认证/规则/审计、**bundle 化插件清单与宿主内嵌管理**和配套打包。

Python 适配在 `../clawRVguarder/hosts/dsh/`，共享边界为 `hosts/base.py`；PMKB、RV 和前端保持单一源。

需要 Python 3.13+、Node 24 和已安装的 DSH 0.2.1-rc.2 或 rc.3；桌面 ASAR 安装先按原生开发指南提取 SDK 和补齐同版本类型声明：

```bash
# 前端（独立工作台 + 内嵌单文件模块）
npm --prefix ../frontend run build
npm --prefix ../frontend run build:embedded
# 插件（宿主端 tsc + 客户端 tsc + 形状校验）
npm ci --ignore-scripts --legacy-peer-deps
node scripts/link-sdk.mjs '<DSH 安装根目录>'
npm run check
npm test
npm pack
```

安装见 [部署说明](docs/deployment.md)，本机路径见 [Windows 环境](docs/windows-environment.md)，实测和未完成项见 [验证记录](docs/validation-2026-10-20.md)；旧 plain-dependency profile 升级到 bundle 见 `scripts/migrate-test-profile.mjs`。

已公开的历史 rc.1 在 [GitHub Releases](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.2.0-rc.1)。当前 rc.3 必须从本地源码构建配套 tgz/wheel，不能用历史同名 Python wheel 替代修改后的后端。

采用外部托管 Python 服务，插件不自动启停 Python。已在临时 Windows DSH web profile、隔离 rc.3 桌面 profile 和 WSL 原生 DSH（`~/.npm-global/bin/dsh`，0.2.1-rc.2）上验证加载与握手；v2 已补充真实 Node PTC 内层测试、受控本地文件字节收据和 Windows ACL 临时边界探针（partial）。**rc.2 上的内嵌 UI 未实测**（核心兼容回归沿用既有记录）；完整子 Agent、在线 LLM、长期稳定性和更广平台边界仍需验收。普通工具返回文本不是可信内容收据。

当前修复、升级约束和未完成门槛以 [v2 修复记录](docs/repair-2026-10-21.md) 和 [UI 实现报告](docs/ui-integration-implementation.md) 为准。必须配套安装 v2 后端；旧队列先使用旧版本排空，不混用协议。

受控外发默认禁用：配置双端精确HTTPS白名单后，还需每次调用的宿主单次授权。私有凭据的实际Agent隔离仍是正式发布门槛。
