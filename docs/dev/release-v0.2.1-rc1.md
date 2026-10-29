# v0.2.1-rc1 发布验证

日期：2026-10-29。合并基线 `d61139b`，保留上游任务授权、宿主子代理隔离、效果模型及本地 UI/托管生命周期能力。本轮统一产品/npm 为 `0.2.1-rc1`，Python 为 `0.2.1rc1`；PMKB `1.2.0`、DSH SDK `0.2.1-rc.2 / rc.3` 独立版本不变。

## 发布内容

- `dsh-rvguarder-0.2.1-rc1-win32-x64.tgz`：用户安装及 npm 发布使用的完整插件。
- `dsh-rvguarder-0.2.1-rc1-win32-x64-distribution.zip`：与 tgz 逐文件一致，解压后根目录可用于独立 GitHub 发行仓库。
- `openclaw_guard-0.2.1rc1-py3-none-any.whl`：OpenClaw/Python 用户入口，需 Python 3.13+。
- 安装说明、版本说明、许可证、构建来源、验证结果及 SHA-256 清单。

当前安装指南统一指向上游 `HorizonExploration/RVguarder`。npm 名称仍为 `dsh-rvguarder`，独立 GitHub 发行仓库地址待维护者创建后确认。二进制包不携带源码开发脚本或历史迁移指引，源码包继续 private；本轮不执行远程发布。

## 本轮验证

构建和回归进行中，最终结果将在本文件补齐。历史 [PR #2 合并复核](pr-2-merge-review-2026-10-29.md)、[rc.6 启动目录复验](https://github.com/HorizonExploration/RVguarder/blob/master/dshRVguarder/docs/rc6-startup-verification-2026-10-29.md) 保留为历史证据，不计入本次新包通过数。

## 范围

本轮不修改规则或授权语义。真实桌面外观、在线模型、真实 PTC 沙箱、rc.2 UI、Linux/arm64 整包、长期稳定性和 OpenClaw Gateway 在线任务未在本次发布准备中重新验收。测试跳过项逐项记录，不计通过。以预发布版交付，所有推送、npm 发布及 GitHub 操作留给维护者。
