# RVguarder for DSH

为 DeepSeek Harness 提供执行前审批、语义风险分析、运行时验证、基线扫描与审计。

**0.2.0-rc.6 · Windows x64 · DSH 0.2.1-rc.3**

```powershell
dsh plugin --profile desktop add dsh-rvguarder@0.2.0-rc.6
```

重新启动 DSH，在 **插件 → 已安装** 中启用 RVguarder，然后打开 **设置 → RVguarder**。整包自带运行环境，无需安装 Python 或单独启动后端。

- [下载安装与使用](docs/deployment.md)
- [验证范围与已知问题](docs/rc6-startup-verification-2026-10-29.md)
- [参与开发](https://github.com/Eghost303/RVguarder/blob/master/docs/dev/dsh-development.md)

本版本为预发布版本，建议先在独立 profile 中试用。界面支持中英文和亮暗主题，工具审批使用 DSH 原生入口。
