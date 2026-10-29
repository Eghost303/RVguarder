# PR #2 合并复核与冲突处理

日期：2026-10-29。目标 PR：https://github.com/HorizonExploration/RVguarder/pull/2。

合并基线为 master `8ae513bacdf8dff790ec6075e07835dfe1388139`，PR 头为
`3fd3d025d681ed082a180fa77d0ad5610c65d602`。按项目约定直接在 master
创建保留双方历史的 merge commit，不重写 PR 分支或强制推送。

## 冲突原因与处理

PR 引入托管后端、内嵌管理页面、双语 UI、连接复用与耗时观测；与此同时，
master 引入宿主子代理语义模式、工具隔离、审批归因与任务范围授权。
八个文件发生文本冲突，不能整文件选择某一方：

| 文件 | 合并结果 |
|---|---|
| `clawRVguarder/hosts/dsh/services.py` | 保留 host semantic 消费与传参，外包 PR 的计时记录；保留 master 的任务授权、决策记录及 PR 的 SQLite 串行连接复用。 |
| `dshRVguarder/src/index.ts` | 托管生命周期与 HostSemanticDelegator 同时保留；保留子代理递归拒绝、能力探针、关闭清理和 30 秒 dispatch 预算。 |
| `dshRVguarder/src/client.ts` | 合并并发握手复用与 semanticMode 更新；维持 master 的 5 秒缓存和请求预算，增加 PR 的 HTTP 计时。 |
| `dshRVguarder/package.json` | 保留 rc.6 管理入口、客户端、bundle 元数据，以及 semantic-tools-deny 导出和相关 SDK peer 声明。 |
| `frontend/src/api.js` | 保留原有语义切换导出和新增的 scoped transport / 报告下载能力。 |
| `frontend/src/components/HostPanel.jsx` | 同时支持独立 HTTP 与内嵌 Remote；保留 host-agent 选项、可用性和回退状态，补齐英文说明。 |
| `dshRVguarder/README.md` | 采用新整包说明，同时保留语义子代理隔离和能力前提。 |
| `dshRVguarder/docs/deployment.md` | 采用新安装指南，保留 host-agent 使用说明；不混入过时的 rc.2 安装命令。 |

另外修复无文本冲突的集成缺陷：PR 的宿主管理方法与客户端 Remote codec
原本仅允许 local/auto/llm，会拒绝 master 已实现的 host-agent。
两端均补齐该枚举，仍由后端执行能力门禁。host-agent 的 HTTP 409 不再被错误
映射为“缺少 LLM 密钥”。内嵌界面使用后端确认的语义状态，不自行假定切换成功。

新增回归覆盖：并发握手保留 host-agent 模式、管理方法透传且保留后端拒绝、
内嵌页面只通过本实例 Remote 切换 host-agent，不能向页面 origin 发起 `/api/` 请求。

## 本轮验证

环境：Windows、Python 3.13.12、Node 24.15.0、真实 DSH SDK 0.2.1-rc.3、
Playwright 1.63.0、系统 Chrome。测试使用隔离目录，不调用在线模型。

| 检查 | 结果 |
|---|---|
| 全部受版本控制的 `tests/test_*.py` | 935 passed，13 skipped，10 subtests passed，1 warning，153.60 秒。 |
| DSH、授权、权限、RV 专项 | 302 passed，1 skipped，6 subtests passed（属于上述全量子集）。 |
| `npm test`（dshRVguarder） | 65 passed，3 skipped；真实 Node PTC 内层与 HTTPS 受控字节测试通过。 |
| `npm run check` | 后端及客户端 TypeScript 检查、客户端 factory 形状检查通过。 |
| 前端 `build` / `build:embedded`、插件 `build:client` | 全部通过。 |
| 内嵌组件 Playwright | 16 passed，包括本次 host-agent 通道回归。 |
| DSH 独立工作台 Playwright | 4 passed。 |
| OpenClaw 工作台 Chromium 回归 | 6 passed。 |
| `npm pack --dry-run --json` | 通过，确认 index/admin/webclient/semantic-tools-deny 及 cordis.patch.yml 都在清单中。 |
| 合并冲突、空白检查 | 无未解决冲突；`git diff --cached --check` 通过。 |

PR 描述提到的 `test_dsh_chain_uses_only_successful_sensitive_history[True]`
和 `test_native_approval_cannot_reuse_permission_after_new_chain_evidence`
包含在当前 DSH 测试中，本次合并树不再复现失败。没有通过修改这些断言或放宽
PMKB/RV 规则使其通过。

复现命令（仓库根 PowerShell，环境变量只用于测试进程）：

```powershell
$env:PYTHONUTF8 = '1'
$env:DEEPSEEK_API_KEY = ' '
$files = git ls-files 'tests/test_*.py'
.venv/Scripts/python.exe -m pytest $files -q --disable-warnings --maxfail=5

$env:RVGUARDER_PYTHON = 'E:/RVguarder/.venv/Scripts/python.exe'
$env:OPENSSL_CONF = 'E:/APP/minianconda/Library/ssl/openssl.cnf'
npm --prefix dshRVguarder test
```

浏览器分别运行 `playwright.embedded-unit.config.cjs`、`playwright.dsh.config.cjs`
与 `playwright.config.cjs --project chromium`。本机镜像下载超时后，使用官方 npm
源在 `runtime/pr2-e2e-deps` 安装锁定版本，通过 NODE_PATH 加载；未修改项目锁文件。

## 环境问题与验证边界

- 首轮 Node 三项 HTTPS 失败源于本机 OpenSSL 默认 openssl.cnf 不存在；显式指定
  已安装 OpenSSL 配套配置后全通过，没有关闭证书校验。
- 补装 esbuild 时 npm 沿现有开发 SDK junction 清理了全局 DSH 的依赖。
  已根据原 DSH 0.2.1-rc.3 包依赖恢复，重新通过 SDK 版本检查、CLI `--version`、
  TypeScript 和整套 Node 测试；未修改用户 profile 配置。
- 三项 Node 跳过要求冻结后端或完整平台包；本轮未构建或安装新的冻结整包。
  打包 dry-run 只验证源码插件清单，不等于平台整包验收或发布。
- 全量 Python 跳过项不算验证通过；真实桌面安装、在线模型、rc.2 UI、Linux 整包、
  长期稳定性不在本轮完成范围。
- GitHub 对该 PR 头的 combined statuses 和 workflow runs 查询均为空；不能称为远程 CI 通过。
- 既有 rc.6 下载产物不是本次合并代码的构建产物。需要分发合并后的功能时必须重新构建并验收配套整包。
