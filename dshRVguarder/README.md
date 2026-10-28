# dshRVguarder

DSH **0.2.1-rc.2 / 0.2.1-rc.3** 的 RVguarder 适配插件，当前为 **0.2.0-rc.5 本地开发候选**（未发布）。Windows x64 整包自带 Python、UI 和运行依赖，由宿主自动启停后端；新增私有内容哈希运行时缓存与保历史离线迁移。下载安装、迁移和回滚见 [rc.5 部署指南](docs/deployment-rc5.md)，验收范围与剩余问题见 [复验表](docs/rc5-revalidation-2026-10-29.md)。

Python 后端支持 **Windows 原生 Python 和 Linux/WSL Python**，要求 Python 3.13+ 及兼容依赖，不限定 Windows 上 Python 的安装渠道。Windows 原生 Python + 当前桌面 rc.3 的部署入口见 [原生开发指南](docs/windows-native-rc3.md)，无需启动 WSL 或另装 rc.2。

插件页显示真实 bundle，“设置 → RVguarder”经宿主 owner 通道管理，浏览器不接触桥接令牌。原 rc.3 交付的 [独立审查](docs/ui-review-2026-10-28.md) 结论保留；rc.5 对语言/主题订阅、挂载隔离、重连、故障呈现与迁移单列复验。rc.2 UI、Linux 整包不计通过；POL-01/02 未改规则、未称解决。

平台整包：取得匹配平台 tgz 并校验 SHA-256 → DSH 安装 → 重新启用/重启宿主 → 设置页管理。普通源码 `npm pack` 仍为轻量外部模式，需要准备 Python、初始化连接与单独启动后端。已有外部配置不被静默覆盖或清空历史迁移。提交源码/PR 不需要 GitHub Release。

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

已公开的历史 rc.1 在 [GitHub Releases](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.2.0-rc.1)。rc.4 平台候选仍仅本机构建，未发布；外部模式不能混用历史后端 wheel。

外部模式采用独立 Python，平台整包采用宿主托管。**rc.2 内嵌 UI、Linux/arm64 整包未实测**；真实 PTC 沙箱不可用项、完整桌面生命周期、在线 LLM 和长期稳定性仍需验收。历史核心接入证据与当前整包验收分开记录。普通工具返回文本不是可信内容收据。

当前修复、升级约束和未完成门槛以 [v2 修复记录](docs/repair-2026-10-21.md) 和 [UI 实现报告](docs/ui-integration-implementation.md) 为准。必须配套安装 v2 后端；旧队列先使用旧版本排空，不混用协议。

受控外发默认禁用：配置双端精确HTTPS白名单后，还需每次调用的宿主单次授权。私有凭据的实际Agent隔离仍是正式发布门槛。
