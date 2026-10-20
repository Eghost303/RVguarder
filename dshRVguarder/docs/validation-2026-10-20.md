# DSH 0.1.0 测试候选验证记录

日期：2026-10-20。范围为本地开发、模拟工具管线、临时真实 profile 加载和工作台，不是线上生产防护证明。

| 验证 | 结果与范围 |
| --- | --- |
| SDK/构建 | Windows DSH 0.2.1-rc.2、Cordis 4.0.5、Windows Node v24.15.0；TypeScript 5.9.3 严格检查通过 |
| SDK管线 | 12项通过：实际ToolRuntime允许/拒绝、原生ask、单调守卫、故障策略、嵌套ID、完成队列/中断标记；工具体、后端、审批回答为夹具 |
| DSH Python | 25项通过：认证/绑定、幂等、单次dispatch、审批、窗口恢复、成功/失败历史、风险重评估、未知工具、报告、LLM合约/回退/缓存预算 |
| 完整回归 | 新增缓存专项前为772 passed、18 skipped、4 subtests passed；新增缓存已在上述25项中验证。保留既有Starlette/httpx弃用警告 |
| 浏览器 | Chromium：DSH 3/3，OpenClaw既有5/5。本轮未运行Firefox |
| Windows→WSL | 原生Node加载真实SDK与插件，连接认证WSL后端：合成read允许、write经原生审批接口批准、危险命令在工具体前拒绝；没有真实文件/命令操作 |
| 真实宿主 | 临时Windows DSH_HOME/web profile由实际CLI加载器挂载插件，web启动且认证握手计数增加；清理专用进程/目录，没有修改日常profile |
| 性能 | 20次无IO合成只读SDK调用平均218.02ms、p95 234.60ms，含桥接/持久化/重评估，LLM关闭；不是纯PMKB或线上模型任务指标 |

## WSL 原生宿主复验（2026-10-20）

| 验证 | 结果与范围 |
| --- | --- |
| 安装 | `npm install -g @deepseek-ai/dsh@0.2.1-rc.2` 成功，二进制 `~/.npm-global/bin/dsh`；Node v24.15.0、npm 11.12.1、pnpm 11.2.2 |
| 原生依赖 | npm 11.12.1 拦截 5 个安装脚本（提示的 `--allow-scripts` 不被该版本识别）；实测 `node-pty` 预编译件与 `koffi` 平台包均可加载，不影响运行 |
| SDK/构建 | `scripts/link-sdk.mjs` 指向 WSL 安装根后，TypeScript 严格检查通过 |
| SDK管线 | 12/12 通过，耗时 358.9ms（链接 `/mnt/c` 时为 3022ms）；夹具与 Windows 轮次相同 |
| 打包与安装 | `npm pack` 生成 12.3 kB 包；`dsh plugin --profile rvguarder-wsl add` 经 pnpm 装入，+25 包、约 600ms |
| 真实宿主 | 自定义 profile `rvguarder-wsl` 启动成功（`--port 8790`）；插件生成 stateDir，后端 `guard.log` 记录 2 次 `session_started`；未产生工具调用，`calls` 表为 0 |
| Python 后端 | WSL 自带 `Python 3.13.13`（conda base），可导入 `hosts/dsh/server` 并监听 8791 |
| 启动目录约束 | 在仓库根启动会被 `.env` 中的 `DEEPSEEK_BASE_URL` 拒绝；从无 `.env` 的 `dshRVguarder/` 启动正常，已复现 |
| 未覆盖 | WSL 侧工具调用延迟基线、Landlock/沙箱可用性、PTC/子 Agent、Windows ACL |

## 已核对约束

使用workingDirectory.ensure与原始session目录，不信任工具自报身份/cwd。SDK原生审批后再次评估；单次dispatch和完成结果绑定。tools/result不等待异步监听，插件先同步落盘，后续前置先补交。未确认历史保持拒绝，不能清库恢复。

DSH patch必须使用insert/id。DSH启动目录的.env受独立限制，本仓库可触发该检查；从中立目录或真实工作区启动，不改写用户.env。

## 发布前仍需验证

1. 真实模型驱动的原生/PTC全流程、PTC并行与子Agent/委派；当前嵌套ID测试不等于完整PTC验收。
2. Windows ACL full/partial与实际越界行为，静态项保持unknown/unsupported。
3. 在线LLM质量/成本/延迟；当前只用合约夹具，未读取或发送本机API密钥。
4. DSH资源/内容收据与跨会话强内容血缘采集；现有主体状态复用不等于已有可信字节收据。
5. 多安全插件组合、长时稳定性、真实包管理安装/升级/卸载和跨平台矩阵；临时复制加载不是完整包管理验收。
6. 每个后端数据目录和插件stateDir必须独占，不支持多进程共用。显式fail-open只覆盖未取得裁决的连接/服务不可用，不绕过协议/身份冲突或恢复锁定。

配套发行目录包含tgz、wheel、安装说明、测试profile生成器与哈希清单；wheel含UI/PMKB/RV。解释器与第三方依赖需预先安装，主路径为外部托管Python服务。
