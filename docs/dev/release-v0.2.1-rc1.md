# v0.2.1-rc1 发布验证

日期：2026-10-29。合并基线 `d61139b`，保留上游任务授权、宿主子代理隔离、效果模型及本地 UI/托管生命周期能力。本轮统一产品/npm 为 `0.2.1-rc1`，Python 为 `0.2.1rc1`；PMKB `1.2.0`、DSH SDK `0.2.1-rc.2 / rc.3` 独立版本不变。

## 发布内容

- `dsh-rvguarder-0.2.1-rc1-win32-x64.tgz`：用户安装及 npm 发布使用的完整插件。
- `dsh-rvguarder-0.2.1-rc1-win32-x64-distribution.zip`：与 tgz 逐文件一致，解压后根目录可用于独立 GitHub 发行仓库。
- `openclaw_guard-0.2.1rc1-py3-none-any.whl`：OpenClaw/Python 用户入口，需 Python 3.13+。
- 安装说明、版本说明、许可证、构建来源、验证结果及 SHA-256 清单。

当前安装指南统一指向上游 `HorizonExploration/RVguarder`。npm 名称仍为 `dsh-rvguarder`，独立 GitHub 发行仓库地址待维护者创建后确认。二进制包不携带源码开发脚本或历史迁移指引，源码包继续 private；本轮不执行远程发布。

## 本轮验证

最终冻结整包来源 **`06e4974ee65c7d416e4b7a45e0f04528879966bf`**，构建时 tracked tree 干净。Windows x64 / CPython 3.13.5、Node 24、真实桌面 rc.3 提取 SDK；测试屏蔽本地模型密钥。源码版本与 npm lock、Python 元数据已同步。

| 检查 | 本轮结果 |
| --- | --- |
| 全部受版本控制的 Python 测试 | 929 passed、19 skipped、10 subtests passed；1 条既有依赖弃用警告。 |
| 最终冻结维护命令及数据兼容 | 16/16，包括冻结 inspect/apply/rollback；保留历史数据、重复操作和回滚负例。 |
| 最终整包 Node 回归 | 67 passed、1 PTC skipped、0 failed；包含原始十并发超时与并行度、全新数据引导、跨 cwd 保身份及生命周期。 |
| TypeScript、客户端 factory、前端与内嵌构建 | 通过。 |
| 内嵌 UI 组件 | 16/16，通过 host-agent Remote、语言/主题、焦点、实例隔离和故障重连。 |
| DSH 独立工作台 / OpenClaw 浏览器 | 4/4、6/6；系统 Chrome。 |
| VuePress | 39 页构建通过，无新增坏链接；仅 browserslist 数据提醒。 |
| Python wheel | Python -I 隔离导入通过，版本 0.2.1-rc1，PMKB 1.2.0 / 79 规则，包含工作台静态资源。 |
| tgz / 发行仓库 ZIP | 327 个文件逐字节一致，288 个运行时文件摘要通过；无凭据/运行数据库/完成队列。 |
| npm publish dry-run | 最终 tgz 通过；未登录发布、未上传。公共 registry 查询包名返回 E404，不能称 npm 已可下载安装。 |

Python 跳过项涉及可选 SQLAlchemy、未配置冻结程序输入及需真实 OpenClaw/模型的链路等；额外冻结测试结果单列，不把它们与全量结果重复累加。真实 PTC 沙箱不可用单独跳过，不计通过。PR 复核曾记录的两项链式安全断言已包含在本轮全量测试并通过；没有修改这些断言或规则。

构建中首轮 npm pack 因全局缓存 EPERM 失败，改用本任务私有缓存后完成。首次冻结/Node 测试遇到外部 TEMP 访问限制，改用工作区内临时目录；没有改动产品 ACL。首次 Node 48 通过/20 失败还包含旧 SDK 快照缺少 `dsh-subagent-spawn-in-process` 的问题，已从实际 rc.3 ASAR 补齐同版本包，并修正提取器的可选语义依赖闭包；修复环境后首个候选 67 通过/1 PTC 跳过，最终包另行完整回归。失败日志与成功日志均随 EVIDENCE.zip 保留，不以重跑掩盖首次结果。

复现入口：`dshRVguarder/scripts/build-standalone.py`、`verify-release.py`、`npm --prefix dshRVguarder test`；冻结测试需设置 `RVGUARDER_TEST_PACKAGE`、`RVGUARDER_TEST_BACKEND` 和本机原生 `RVGUARDER_PYTHON`。本地使用工作区 TEMP/TMP，HTTPS 测试使用实际 OpenSSL 配套配置，不关闭证书检查。

历史 [PR #2 合并复核](pr-2-merge-review-2026-10-29.md)、[rc.6 启动目录复验](https://github.com/HorizonExploration/RVguarder/blob/master/dshRVguarder/docs/rc6-startup-verification-2026-10-29.md) 保留为历史证据，不计入本次新包通过数。

## 发布文件校验

最终 tgz SHA-256：`5d7b902290aa6a9e17068256534cf116bedddffafdaf5ac9609efe40c86c64fa`。

Python wheel SHA-256：`d65c9c7da724c5ead30da85b8a49e7e41739a07db1fc0ecd5150f94a645c91a2`。完整附件摘要见交付目录 SHA256SUMS；附件未纳入源码 Git。验收记录的后续提交只补证据，不改变整包源代码。

## 范围

本轮不修改规则或授权语义。真实桌面外观、在线模型、真实 PTC 沙箱、rc.2 UI、Linux/arm64 整包、长期稳定性和 OpenClaw Gateway 在线任务未在本次发布准备中重新验收。测试跳过项逐项记录，不计通过。以预发布版交付，所有推送、npm 发布及 GitHub 操作留给维护者。
