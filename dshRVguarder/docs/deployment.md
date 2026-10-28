# 在 DSH 中安装 RVguarder

RVguarder 为 DSH 提供执行前审批、风险分析、运行时验证、基线扫描和审计。在 **设置 → RVguarder** 中使用全部管理功能，工具审批仍在 DSH 原生窗口完成。

当前版本 **0.2.0-rc.6**，适用于 **Windows x64、DSH 0.2.1-rc.3**。整包自带运行环境，**无需安装 Python，也无需单独启动后端**。这是预发布版本，建议先在独立 profile 中试用。

## 从 npm 安装

退出目标 DSH 窗口，在终端运行：

```powershell
dsh plugin --profile desktop add dsh-rvguarder@0.2.0-rc.6
```

重新启动 DSH，打开 **插件 → 已安装**，确认 RVguarder 已启用；随后进入 **设置 → RVguarder**，看到“插件已连接”和“已就绪”即可开始使用。

如果使用 DSH 内置插件下载器，选择 **from npm**，填写 `dsh-rvguarder@0.2.0-rc.6`，安装后启用插件。

## 从 GitHub Release 下载

1. 打开 [下载页面](https://github.com/Eghost303/RVguarder/releases/tag/dsh-v0.2.0-rc.6)。
2. 下载 `dsh-rvguarder-0.2.0-rc.6-win32-x64.tgz` 和 `SHA256SUMS`。请选择附件中的 tgz。
3. 在下载目录核对 SHA-256，然后安装：

```powershell
Get-FileHash .\dsh-rvguarder-0.2.0-rc.6-win32-x64.tgz -Algorithm SHA256
dsh plugin --profile desktop add .\dsh-rvguarder-0.2.0-rc.6-win32-x64.tgz
```

哈希应与 `SHA256SUMS` 中该文件的值一致。也可在 DSH 插件页选择本地 tgz 安装，再重新启动 DSH。

## 日常使用

- **概览**：查看插件连接、运行状态和调用统计。
- **调用与审批**：查看执行结果与待审批操作；在 DSH 原生窗口确认审批。
- **规则与 RV**：查看安全规则和运行时验证状态。
- **扫描与报告**：运行基线扫描并下载报告。
- **审计**：查看完整性结果并导出审计记录。
- **设置**：查看连接信息；语义模式可在概览中选择。

界面跟随 DSH 的语言与亮暗主题。默认可使用本地分析，LLM 增强为可选项。

## profile 与停用

可以从任意启动目录运行命令，无需预先切换到固定目录。插件保留 DSH 会话的工作目录，后台服务按 profile 使用独立的固定目录。

示例命令中的 `desktop` 是 DSH 桌面默认 profile。使用其他 profile 时替换该名称即可，例如：

```powershell
dsh plugin --profile rvguarder-dev add dsh-rvguarder@0.2.0-rc.6
dsh --profile rvguarder-dev
```

在插件页停用 RVguarder 即可停止防护；后端随插件自动启停。卸载可使用插件页的“移除”。

## 连接异常

先确认两个 RVguarder 组件均已启用，再在设置页点击“重新连接”。若显示认证失败、实例冲突或恢复锁定，请保留错误码并向维护者反馈，不要重复执行尚未确认结果的工具调用。

[验证范围与已知问题](rc6-startup-verification-2026-10-29.md)
