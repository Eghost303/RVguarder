# 部署与使用 RVguarder

[返回首页](../../README.md) · [下载测试候选包](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.7.0-dev-candidate.20261009) · [测试范围与保护边界](../rvguarder-security-capabilities-and-boundaries.md)

## 准备环境

RVguarder 需要 OpenClaw Hook 插件与持续运行的本地 Python 后端。后端 wheel 已包含工作台前端、PMKB 和 RV 数据，用户无需安装前端构建工具。

- Python 3.13+；下面命令适用于 Linux / WSL 的 Bash。
- 已完成初始化、模型配置且可正常调用工具的 OpenClaw。已验证版本为 OpenClaw 2026.9.5、Node 24.19.0；其他版本和系统未核验。
- 先在测试 profile 部署。下文默认配置路径是 `$HOME/.openclaw/openclaw.json`；使用测试 profile 时，替换为该 profile 的实际配置路径，所有 Gateway 操作也必须指向同一 profile。

当前版本是 **Pre-release 测试候选**，新归档的原生安装全套验收尚未完成。后端失联、超时、HTTP 错误或响应无法解析时，插件对工具透传，Guard 防护暂停。

## 下载与校验

在 [Release 页面](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.7.0-dev-candidate.20261009) 的 **Assets** 下载：

| 文件 | 用途 |
| --- | --- |
| `clawRVguarder-0.7.0.dev0-py3-none-any.whl` | 本地后端、工作台及规则；推荐部署入口 |
| `openclaw-guard-hook.tgz` | 通过 OpenClaw 插件管理器安装 Hook |
| `guard.config.example.json` | 插件配置参考 |
| `SHA256SUMS` | 构建目录的文件摘要 |
| `acceptance.json` | 该包已完成的验证范围 |

GitHub 的 Source code ZIP / tar.gz 是标签对应的源码快照；本次二进制包含构建时未提交的生产代码变更，源码快照不能用于精确重建附件。

GitHub 下载的附件位于同一目录，而校验清单保留构建时的 `backend/`、`plugin/` 路径。请先整理路径，再校验已下载的附件：

```bash
mkdir -p backend plugin
mv clawRVguarder-0.7.0.dev0-py3-none-any.whl backend/
mv guard.config.example.json plugin/
sha256sum --ignore-missing -c SHA256SUMS
```

应看到 wheel、tgz、配置示例和 `acceptance.json` 的 `OK`。清单中的其他 `plugin/` 文件位于 tgz 内，未作为单独附件上传。

## 安装后端并自动注册插件

先备份目标 OpenClaw 配置，将以下配置路径替换为你实际使用的文件。`install-hook` 会修改它并设置本地认证信息。

```bash
cp "$HOME/.openclaw/openclaw.json" "$HOME/.openclaw/openclaw.json.before-rvguard"
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install ./backend/clawRVguarder-0.7.0.dev0-py3-none-any.whl
openclaw-guard install-hook --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json"
openclaw-guard run --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json" --no-browser
```

保持最后一条命令运行。它在本机 `127.0.0.1:8780` 提供服务，并在 `$HOME/rvguarder-data` 保存运行状态、插件和审计数据。后续启动继续使用同一 `--project-dir` 和 `--config-path`。

按你平时使用的方式重启目标 Gateway，使新插件生效。如果以 OpenClaw 服务方式运行，可使用 `openclaw gateway restart`；测试 profile 对应 `openclaw --profile rvguard-dev gateway restart`。前台运行的 Gateway 则停止后重新启动。请勿对错误的 profile 执行重启。

打开 **http://127.0.0.1:8780**。后端需要一直运行；关闭终端会停止该前台服务。

## 使用 tgz 注册

自动注册方式已生成同一 Hook 插件。需要使用 OpenClaw 插件管理器记录安装时，可以采用 tgz；同一 ID 应只保留一个加载来源。

1. 完成上面的后端安装与启动，记下自动生成的插件路径以及 `plugins.entries.openclaw-guard-hook.config`；本地认证配置已经自动生成。
2. 停止目标 Gateway。在目标 `openclaw.json` 的 `plugins.load.paths` 中移除刚生成的 `.../runtime/openclaw-guard-plugin` 路径，保留其他插件路径及 Guard 的配置条目。
3. 在下载目录执行归档安装。下面以已初始化的 `rvguard-dev` profile 为例：

```bash
openclaw --profile rvguard-dev plugins install ./openclaw-guard-hook.tgz --force --accept-capabilities
```

4. 检查 Guard 的配置条目：`enabled` 为 `true`，`guardUrl` 指向当前后端，`authToken` 使用同一数据目录 `runtime/hook-bridge.json` 中的 `auth_token`，并设置 `startupHealthCheck: true`。安装命令若重置配置，应恢复这些字段。Token 只保存在本地私有配置中。
5. 重启同一 profile 的 Gateway，并按下节确认实际 Hook 活动。若后续运行维护命令重新加入生成插件路径，再检查并移除重复加载来源。

## 确认已生效

在另一个终端激活同一虚拟环境，运行：

```bash
source .venv/bin/activate
openclaw-guard doctor --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json" --json
```

工作台能打开只说明后端可用。再让目标 OpenClaw Agent 执行一次正常工具调用，在工作台检查新的 Hook 活动及对应审计记录，确认 Gateway 已加载插件且回调进入后端。

正常使用时，Guard 在工具执行前给出允许、审批或阻断决定。需要审批时，在 **OpenClaw 原生审批卡片**操作；工作台展示决策和审计。默认有效 RV 规则为 72 条，可选实验规约须显式配置，研究结果不自动等同于默认保护效果。

## 排查与卸载

| 现象 | 检查 |
| --- | --- |
| 工作台打不开 | 后端终端是否仍运行、8780 端口是否冲突、是否使用本机地址 |
| 工作台可用但没有 Hook 活动 | 配置路径与 Gateway profile 是否一致；注册后是否重启；是否加载了 Guard 插件 |
| 插件一直透传 | 后端健康、`guardUrl` 和本地 Token 是否一致；检查 `doctor` 与 Gateway 日志 |
| 提示重复插件或旧路径不存在 | 检查 `plugins.load.paths`，同一 Guard ID 仅保留一个有效来源 |
| 审批状态没有同步 | 先在 OpenClaw 处理原生审批，再检查工作台中的同步状态和回调连接 |

自动生成插件的卸载：

```bash
openclaw-guard uninstall-hook --project-dir "$HOME/rvguarder-data" --config-path "$HOME/.openclaw/openclaw.json"
```

通过 tgz 注册的插件还需从同一 profile 的安装记录卸载：

```bash
openclaw --profile rvguard-dev plugins uninstall openclaw-guard-hook --force
```

重启对应 Gateway，确认插件不再加载，然后停止 Guard 后端。审计与运行数据保留在所选数据目录，按需备份。
