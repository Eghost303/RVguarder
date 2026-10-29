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

受控外发默认禁用：配置双端精确HTTPS白名单后，还需每次调用的宿主单次授权。私有凭据的实际Agent隔离仍是正式发布门槛。

## 宿主子代理语义模式

在 Guard 工作台的 DSH 面板选择“宿主子代理（使用当前 DSH 模型路由）”。只有探针确认 DSH 子代理服务、agent preset registry、同版本本地 provider 与受限 preset 可用时，选项才可用。内部 preset 插件会在子 Agent 首轮提示前屏蔽全局工具、强制 native 呈现以隐藏 PTC 传输工具，并拒绝 scoped 工具调用；宿主 Agent 的模型路由会被子 Agent 继承，不需要另配 RVguarder API key。

每次分析只发送后端生成的脱敏语义任务，不发送完整对话、原始工具参数或用户会话历史。子 Agent 使用只装载 RVguarder 限制插件的 preset；运行时还检查子 Agent 的有效工具列表必须为空。返回内容经过受限 schema 校验，仅作为 suggested 证据。调用失败、超时或结果无效时回退本地规则；授权仍由 PMKB/RV 与 DSH 原生审批决定。

切换到 `host-agent` 前请确保运行中的 DSH profile 提供 `dsh-subagent` 和 `dsh-agent-preset-registry` 服务，且 DSH CLI 运行时包含与 SDK 同版本的 `dsh-subagent-spawn-in-process` 包。插件会自动从当前 DSH 运行时加载并注册私有 provider 和受限 preset；preset registry 还会核验内部限制插件确已激活。无需单独配置模型、provider 或 API key。缺少任一能力时，工作台会显示不可用原因，插件仍可使用其他语义模式。
