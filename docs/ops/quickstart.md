# 部署与使用 RVguarder v0.2.1-rc.1

## DSH 用户

Windows x64 / DSH 0.2.1-rc.3 用户请阅读 [插件下载安装](../deployment/dsh.md)。完整包自动启动后台，无需安装 Python。管理入口为“设置 → RVguarder”，审批仍由 DSH 原生窗口处理。

## OpenClaw 用户

OpenClaw 接入使用 Python 后端与 Hook 插件。Python 3.13+ 为必需，后端需要持续运行。以下为 Bash 示例；Windows 请激活 `.venv\Scripts\activate`。

从 [上游 v0.2.1-rc.1 Release](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.2.1-rc.1) 下载 `openclaw_guard-0.2.1rc.1-py3-none-any.whl` 和 `SHA256SUMS`，核对该 wheel 的 SHA-256 后安装：

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install ./openclaw_guard-0.2.1rc.1-py3-none-any.whl
openclaw-guard run --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json" --no-browser
```

先备份实际 OpenClaw 配置；使用测试 profile 时，将上述路径替换为该 profile 的配置。`run` 自动准备后台与 Hook，随后重启对应 OpenClaw Gateway，使新 Hook 生效。工作台为 **http://127.0.0.1:8780**。

## 确认生效

```bash
openclaw-guard doctor --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json" --json
```

工作台能打开只说明后台在线。让目标 Agent 执行一次正常工具调用，确认新 Hook 活动和审计记录。需要审批时，在 **OpenClaw 原生审批卡片**处理，Guard 只读同步。后台故障时 OpenClaw 工具调用透传，防护暂停。

源码构建与更多配置见 [本地部署](../deployment/local.md)。本轮未复验真实 OpenClaw Gateway 在线任务，支持边界见 [发布验证记录](../dev/release-v0.2.1-rc.1.md)。

## 卸载

```bash
openclaw-guard uninstall-hook --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json"
```

重启同一 Gateway，再停止后台。数据保存在所选目录，按需备份。
