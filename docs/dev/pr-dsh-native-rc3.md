# 支持 Windows 原生 Python 与 DSH rc.3，记录开发部署阶段交付

现有 DSH 桥接在 Windows 上仍依赖 POSIX 私有文件接口，且将 SDK 版本固定为 rc.2。本改动补齐 Windows 原生 ACL/文件句柄实现，在保留 Linux/WSL 路径的同时，支持使用已安装的 DSH rc.3 桌面运行时加载插件。

插件版本为 `0.2.0-rc.2` 本地开发候选，支持 DSH `0.2.1-rc.2` / `0.2.1-rc.3`，协议保持 `dsh-guard-v2`。Windows 支持不限定 Python 的安装渠道。

## 主要改动

- 新增跨平台私有文件入口，Windows 使用真实 ACL 核验目录、令牌、授权数据库和签名密钥；读取资源时固定目录句柄并拒绝重解析点、多硬链接和版本替换。
- 插件读取实际 SDK 版本，后端握手和探针同步支持 rc.2/rc.3，拒绝混装或未经支持的版本。
- 新增现有桌面 SDK 提取、同版本类型补齐、独立 profile 安装、后端启动和真实宿主冒烟工具。
- 保留外部 Python 服务的运行方式；基础 Uvicorn 为必需依赖，可选加速组件移入 `performance` 扩展组。
- 更新 README、开发记忆、部署说明、变更日志和路线图，明确已交付范围、团队部署方式及已知问题。

## 验证

- 适配阶段 Windows 原生 Python 专项：112 passed。
- 实际 SDK 集成：24 passed / 1 skipped；跳过项为本机沙箱不可用的代码工具内层调用，未视为通过。
- 共享策略、连续行为、OpenClaw 透传和 UI 资源分组回归：92 项核对通过，不是完整测试集重跑。
- 已安装桌面 rc.3 CLI 在独立 DSH_HOME 中完成真实包安装、profile 加载和认证握手；配套 wheel 的隔离安装、79 条规则与 UI 资源检查通过。
- 用户人工核验确认后端启动、新 profile 接入及基础拦截正常。
- 本轮提交整理：TypeScript 严格检查、变更 Python 源码语法、文档链接/frontmatter、差异格式及提交文件的产物/敏感内容排除检查通过。

以上自动化数据来自适配阶段记录。详细来源、重跑入口和本轮人工反馈见 [阶段交接记录](https://github.com/Eghost303/RVguarder/blob/codex/dsh-native-rc3-checkpoint/docs/dev/dsh-progress-2026-10-26.md)（该分支推送后可访问）。

## 已知问题及范围

- DSH“插件”页未展示 RVguarder 项；工作台仍为独立页面，没有嵌入 DSH。
- 安装和运行仍需环境准备、本地构建或配套包、新 profile 配置与单独启动 Python 后端，不是开箱即用。
- 人工测试观察到本地规则模式频繁 ask，以及完全权限模式下操作被后端拦截；根因尚未复现定位，本 PR 未修改规则解决这些现象。
- 在线模型、完整沙箱/委派/多插件组合和长时间稳定性等仍待验收，不宣称正式安全交付。

源码评审和开发部署不依赖 GitHub Release。本阶段不发布；后续若分发同批次 tgz/wheel，应作为明确列出已知问题的 pre-release，并附说明和哈希清单。
