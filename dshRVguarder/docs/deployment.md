# 在 DSH 中安装 RVguarder

RVguarder 提供工具执行前审批、风险分析、运行时验证、基线扫描与审计。管理入口为 **设置 → RVguarder**，审批使用 DSH 原生窗口。

当前版本 **v0.2.1-rc.1**，适用于 **Windows x64 / DSH 0.2.1-rc.3**。整包自带运行环境，**无需安装 Python，也无需单独启动后端**。这是预发布版本，建议先在独立 profile 中试用。

## 从 npm 安装

退出目标 DSH 窗口，运行：

```powershell
dsh plugin --profile desktop add dsh-rvguarder@0.2.1-rc.1
```

也可在 DSH 内置插件下载器选择 **from npm**，填写 `dsh-rvguarder@0.2.1-rc.1`。npm 对应版本须由维护者先发布。

## 从 GitHub Release 下载

1. 打开上游 [v0.2.1-rc.1 Release](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.2.1-rc.1)。
2. 下载 `dsh-rvguarder-0.2.1-rc.1-win32-x64.tgz` 与 `SHA256SUMS`。
3. 在下载目录核对哈希并安装：

```powershell
Get-FileHash .\dsh-rvguarder-0.2.1-rc.1-win32-x64.tgz -Algorithm SHA256
dsh plugin --profile desktop add .\dsh-rvguarder-0.2.1-rc.1-win32-x64.tgz
```

哈希应与 `SHA256SUMS` 一致。选择 Release 附件中的完整 `.tgz`，不要选择 GitHub 自动生成的源码压缩包。

## 从 GitHub 发行仓库安装

维护者将本版本完整包发布到独立发行仓库并创建 `v0.2.1-rc.1` 标签后，可使用以下形式（将 `OWNER/DISTRIBUTION_REPO` 替换为实际发行仓库）：

```powershell
dsh plugin --profile desktop add github:OWNER/DISTRIBUTION_REPO#v0.2.1-rc.1
```

DSH 下载器选择 **from GitHub**，填入相同的仓库和标签。发行仓库根目录必须包含插件 `package.json`、`dist/`、`backend/` 与 bundle 清单。`HorizonExploration/RVguarder` 是源码仓库，直接安装其 GitHub 地址不等于安装完整运行环境。

## 启用与日常使用

重新启动 DSH，在 **插件 → 已安装** 中启用 RVguarder 的核心与管理组件，然后打开 **设置 → RVguarder**。概览显示“插件已连接”和“已就绪”即可使用。

- **概览**：连接、后台状态、调用统计与语义模式。
- **调用与审批**：执行结果与待审批操作，在 DSH 原生窗口确认。
- **规则与 RV**：安全规则、决策证据与运行时验证状态。
- **扫描与报告**：运行基线扫描，下载 JSON/HTML/PDF。
- **审计**：完整性检查与审计导出。
- **设置**：连接信息与管理选项。

界面跟随 DSH 中英文和亮暗主题。默认本地分析无需密钥；选择“宿主子代理”可使用 DSH 当前模型路由，无需专用 API Key。该选项只有在宿主能力检查通过后可用，分析失败时回退本地规则，授权仍由 PMKB/RV 与原生审批决定。

## profile 与停用

命令中的 `desktop` 是桌面默认 profile，其他 profile 替换名称即可。项目开发统一使用 `rvguarder-dev`：

```powershell
dsh plugin --profile rvguarder-dev add dsh-rvguarder@0.2.1-rc.1
dsh rvguarder-dev
```

可从任意目录启动，插件保留会话工作目录；后台数据按 profile 分开保存。通过插件页停用或移除，后台随插件自动退出。

## 连接异常

确认核心和管理组件均已启用，再点“重新连接”。若显示认证失败、实例冲突或恢复锁定，请保留错误码并向维护者反馈；先核实尚未确认的执行结果，避免重复操作。

[本版本更新与验证范围](release-current.md)
