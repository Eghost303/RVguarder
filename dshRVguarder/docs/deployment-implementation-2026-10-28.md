# DEP-01 平台整包与后端托管（2026-10-28）

当前为 `dsh-rvguarder@0.2.0-rc.4` 本地候选，未发布、未推送；在 master 开发。前置 [UX 独立审查](ui-review-2026-10-28.md) 发现的问题与待整改项保留，不能把本次新安装通过当成原提交全项通过。

## 实现

- `scripts/build-standalone.py` 在目标平台冻结 Python 后端、基础依赖、公开工作台、PMKB/RV，打包服务端/客户端/语言/bundle 与平台 manifest；不使用安装期下载脚本。`requirements-standalone.txt` 固定此次构建依赖，包内包含来源信息和许可证。普通 `npm pack` 保持外部后端轻量包。
- 平台 bundle 只包含 `backendMode: managed` 与守卫选项，不预置固定端口、用户目录或令牌。`managed.ts` 用可信 `profileContext`/工作目录确定 home/profile 绑定，校验完整清单和哈希，启动本包内 executable，以随机回环端口和认证 status 确认就绪。Windows 使用命名空间路径，已实际复现并修复 pnpm 272 字符路径的 ENOENT。
- 核心与管理共享一个子进程/引用计数。准备期间已有实际工具 guard；缺运行时、错误平台或启动失败时不会因异步异常卸载防线。真实 SDK 新负例确认即使 fail-open 配置，初始化失败也不执行工具体。
- 子进程只接收固定 argv，无 shell、任意 URL 或下载执行入口。`server --managed-stdio` 监听 stdin EOF；正常卸载最后一个引用关闭管道，超时只终止自己创建的子进程。外部服务不被接管，状态/令牌/审计/队列不被删除。
- 管理通道每次业务请求前检查实际协议/实例，owner 约束保留；500/401 不伪装为正常离线，恢复锁定可见，响应在读取流期间限制 4 MiB。客户端使用实际实例范围，关闭后旧 overview 不能再挂载。下载统一 ArrayBuffer；新增浏览器测试实际解析报告与审计 JSON。基本页签布局已补齐。

## 使用与构建

安装、手工模式兼容、升级与回滚命令以 [部署指南](deployment.md) 首节为准。首次安装平台整包后重新启用插件/重启宿主，直接进入设置页；用户无需 Python、pip、WSL 或源码目录。已有用户层外部连接配置不会被静默覆盖；旧实例迁移必须按部署指南备份/对账，不能自动重置历史。

Windows x64 最终本机产物位于 `dist/dsh-rvguarder-0.2.0-rc.4-final/`（忽略目录），约 18 MB tgz、35 MB 解压后内容；含同批 SHA256SUMS。候选构建不等于可信签名发布。构建期间的失败探针包仅为诊断，不作为可分发产物；以最终说明和哈希清单为准。

```powershell
python -m pip install -r dshRVguarder/requirements-standalone.txt
python dshRVguarder/scripts/build-standalone.py --output dist/<新的平台发行目录>
```

SDK 准备沿用原生开发指南，构建机需要 Node/TypeScript/Python；终端用户安装不需要这些构建依赖。

## 独立验证

证据：`runtime/review-20261028/`，不含入库凭据，临时 profile 不覆盖日常配置。

| 验证 | 结果 |
| --- | --- |
| 类型、工作台、内嵌模块与完整平台打包 | 通过；冻结 CLI --help 已实际运行，修复冻结解释器默认编码后 UTF-8 正常 |
| 修改后 Python DSH/UI/共享核心组 | 123 passed；junction 通过，1 条 Starlette 弃用警告 |
| 确定性 Node 核心/管理/迁移/整包边界 | 32 passed，1 个需指定冻结后端的用例在该组跳过；该用例另用实际 tgz 执行通过 |
| 原生冻结运行时生命周期 | 5/5：匿名401、认证就绪、重复后端独占拒绝、关闭后不可达、令牌保留重启、核心/管理共享引用及快速重启等待旧进程退出 |
| 真实 rc.3 平台整包 E2E | **7/7**：没有执行 prepare-only、没有启动源码 Python、没有写连接覆盖；安装默认 bundle 自动启动后端，概览/局部导航/只读调用/扫描/审计/卸载/报告及审计 JSON 字节下载通过 |
| 浏览器凭据扫描专项 | 1/1：实际插件资源、owner 管理响应、DOM、URL与存储不含临时桥接令牌或签名密钥的编码 |
| 原轻量包内嵌 / 独立 DSH / OpenClaw | 审查阶段分别6/6、4/4、串行6/6；OpenClaw首次并发技能页失败已保留 |

全量 Node 测试另复跑了实际后端受控读/复制/变换、审批时资源变更、HTTPS 精确白名单与单次授权、原生读取证据、委派及并发。真实 PTC 沙箱不可用项不算通过，见日志；没有调用模型推理任务。首次未设 `RVGUARDER_PYTHON` 导致系统解释器缺依赖，已用项目解释器复跑，不隐去该执行问题。

最后一次扩展全量记录为46项：44通过、十并发受控调用1项连接超时失败、真实PTC沙箱1项跳过；十并发随后单独复跑通过（`concurrent-recheck.log`），未修改守卫/超时参数。此结果属于稳定性待查，不能写成全量全绿。此后新增的共享引用/快速重启用实际冻结后端专项5/5验证。

整包 E2E 命令（从 e2e 目录执行）：

```powershell
$env:RVGUARDER_MANAGED_PACKAGE = '<平台 tgz 的绝对路径>'
npx playwright test --config playwright.embedded.config.cjs
```

该分支刻意不调用源码 Python，随机测试 DSH_HOME 内安装后端数据；清理函数已正确交给 Playwright，避免前一轮宿主泄漏占用端口。快照 `runtime/review-20261028/managed-audit.png` 展示本轮真实页面。

## 未完成验收

Windows x64 的新安装主路径已实现并通过；Linux/WSL/arm64 整包构建、rc.2 内嵌 UI、真实桌面客户端独立重装/启停/升级/卸载矩阵、异常关机后的完整恢复流程、旧实例历史迁移、故障注入矩阵及长期稳定性仍待专项验收。旧 profile 沿用外部模式可继续运行，未自动迁入新空实例。

UI-04 的主题/语言/焦点、LIFE-01/MIG-01 的完整矩阵不因新增整包而自动通过。POL-01/02 未动规则、未称解决。后续优先完成这些验收及签名/可信分发，再决定预发行发布；目前不称全平台正式开箱即用。
