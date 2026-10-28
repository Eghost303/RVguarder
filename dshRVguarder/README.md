# dshRVguarder

DSH **0.2.1-rc.2 / 0.2.1-rc.3** 的 RVguarder 适配插件，当前源码为 **0.2.0-rc.2 本地开发候选**（未发布）。工程位于 `RVguarder/dshRVguarder/`，复用 Python 核心和 Preact Dashboard。

Python 后端支持 **Windows 原生 Python 和 Linux/WSL Python**，要求 Python 3.13+ 及兼容依赖，不限定 Windows 上 Python 的安装渠道。Windows 原生 Python + 当前桌面 rc.3 的部署入口见 [原生开发指南](docs/windows-native-rc3.md)，无需启动 WSL 或另装 rc.2。

用户已完成人工核验：后端启动、新 profile 接入、基础运行和拦截正常。当前插件未在 DSH“插件”页展示，工作台仍是独立页面，部署仍需构建/配置和单独启动 Python；本地模式频繁 ask、完全权限模式下被拦截的现象待复现定位。本阶段只记录这些问题，不宣称宿主界面、一键安装或规则适配已经完成。详见 [团队交接记录](../docs/dev/dsh-progress-2026-10-26.md)。

部署顺序为准备依赖 → 构建 UI/插件 → 初始化实例并安装新 profile → 启动 Python → 启动 DSH。`install-windows-profile.ps1` 只初始化并安装，`start-windows-backend.ps1` 才启动长期服务。提交源码/PR 不需要 GitHub Release；后续可按需分发配套 tgz/wheel 的 pre-release，不能因此省略后端进程和配置。

已实现真实 SDK 门禁、原生审批、单调拒绝守卫、PMKB/RV/LLM 桥接、成功历史去重恢复、审批后重评估、DSH 扫描与 JSON/HTML/PDF、工作台认证/规则/审计和配套打包。

Python 适配在 `../clawRVguarder/hosts/dsh/`，共享边界为 `hosts/base.py`；PMKB、RV 和前端保持单一源。

需要 Python 3.13+、Node 24 和已安装的 DSH 0.2.1-rc.2 或 rc.3；桌面 ASAR 安装先按原生开发指南提取 SDK 和补齐同版本类型声明：

```bash
npm ci --ignore-scripts --legacy-peer-deps
node scripts/link-sdk.mjs '<DSH 安装根目录>'
npm run check
npm test
npm pack
```

安装见 [部署说明](docs/deployment.md)，本机路径见 [Windows 环境](docs/windows-environment.md)，实测和未完成项见 [验证记录](docs/validation-2026-10-20.md)。

已公开的历史 rc.1 在 [GitHub Releases](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.2.0-rc.1)。当前 rc.2 必须从本地源码构建配套 tgz/wheel，不能用历史同名 Python wheel 替代修改后的后端。

采用外部托管 Python 服务，插件不自动启停 Python。已在临时 Windows DSH web profile 和 WSL 原生 DSH（`~/.npm-global/bin/dsh`，0.2.1-rc.2）上验证加载与握手；v2 已补充真实 Node PTC 内层测试、受控本地文件字节收据和 Windows ACL 临时边界探针（partial）。完整子 Agent、在线 LLM、长期稳定性和更广平台边界仍需验收。普通工具返回文本不是可信内容收据。

当前修复、升级约束和未完成门槛以 [v2 修复记录](docs/repair-2026-10-21.md) 为准。必须配套安装 v2 后端；旧队列先使用旧版本排空，不混用协议。

受控外发默认禁用：配置双端精确HTTPS白名单后，还需每次调用的宿主单次授权。私有凭据的实际Agent隔离仍是正式发布门槛。

## 宿主子代理语义模式

在 Guard 工作台的 DSH 面板选择“宿主子代理（使用当前 DSH 模型路由）”。只有探针确认 DSH 子代理服务、agent preset registry、同版本 in-process provider 与空工具 preset 可用时，选项才可用。宿主 Agent 的模型路由会被子 Agent 继承，不需要另配 RVguarder API key。

每次分析只发送后端生成的脱敏语义任务，不发送完整对话、原始工具参数或用户会话历史。子 Agent 使用空插件 preset；运行时还检查子 Agent 的有效工具列表必须为空。返回内容经过受限 schema 校验，仅作为 suggested 证据。调用失败、超时或结果无效时回退本地规则；授权仍由 PMKB/RV 与 DSH 原生审批决定。

切换到 `host-agent` 前请确保运行中的 DSH profile 提供 `dsh-subagent` 和 `dsh-agent-preset-registry` 服务，且 DSH CLI 运行时包含与 SDK 同版本的 `dsh-subagent-spawn-in-process` 包。插件会自动从当前 DSH 运行时加载并注册私有 provider 和空 preset；无需单独配置模型、provider 或 API key。缺少任一能力时，工作台会显示不可用原因，插件仍可使用其他语义模式。
