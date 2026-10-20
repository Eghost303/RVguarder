# RVguarder 开发记忆

更新时间：2026-10-20。此文记录本地源码与仓库文档核对后的状态；不是线上部署状态证明。

## 定位与当前进度

RVguarder 是 OpenClaw Agent 安全插件，当前版本 `0.7.0-dev`（发行元数据 `0.7.0.dev0`），Apache-2.0。当前生产实现是 Python 3.13+ 后端 + 自动生成的 JS Hook + Preact 工作台，不修改 OpenClaw 源码。

最新范围已于 2026-10-20 由用户修订：首个完整 DSH 版本同时迁移 **RV、PMKB、基线扫描、Dashboard、LLM 语义增强与审计**。原 2026-10-19 的“RV 优先、纯 TS + Python 离线校验”计划已被替代。新实施建议为 **TypeScript 宿主适配插件 + Python 共享核心服务 + Preact 工作台**，由 Phase 0 验证 Python 3.13+ 分发、本地传输与生命周期后定稿。DSH 默认 fail-closed，可配置 fail-open；OpenClaw 的严格 fail-open 不变。`dshRVguarder/` 已创建独立 TypeScript 工程骨架（2026-10-20 用户确认命名），已开发0.1.0测试候选，完整整机验收尚未完成。详细工作包与发布验收见 [迁移计划](../architecture/dsh-plugin-migration-feasibility-2026-10-19.md) 第 9 节与 [路线图](../ops/roadmap.md)，不能把计划当作已实现能力。

## 源码地图

- `dshRVguarder/`：DSH 适配工程骨架，含 package.json、tsconfig、入口状态导出与测试范围说明。仅 Node 入口语法检查可执行，尚无 SDK、构建或 DSH 集成验证。

- `clawRVguarder/main.py`：argparse CLI，包括 run、doctor、baseline、install-hook、uninstall-hook、export-audit、build-plugin 与宿主授权命令。
- `services.py`：GuardServices 编排；`manager.py` 是兼容管理器和 mock/patch 锚点。热路径在 `engine/pipeline.py`，业务生命周期在 `core/`。
- `web/app.py`：唯一 FastAPI HTTP 入口；`web/routes/` 负责路由，`api/_handlers.py` 是业务 handler，不是另一套服务器。
- `engine/semantic_enhancer.py`：本地规则或 DeepSeek 语义增强；`policy/` 实现 Trace 编译、覆盖感知匹配、最小权限闭包/差分与组合风险。
- `rv/`：ToolCallIR、ChainRule DSL、滑动窗口、规则、基线学习；`spec/`：规约校验、主体成功证据、跨历史/内容来源证据与宿主精确授权。
- `integrations/hook_runtime.py`：生成 JS 插件；tool_hook_bridge 归一化工具事件，openclaw_adapter 连接 Gateway。
- `storage/`：SQLite / PostgreSQL / 可选 SQLAlchemy，Redis 可选；审计 SQLite + JSONL 双写、SHA-256 哈希链。
- `frontend/`：Vite + Preact、Zustand、preact-router；构建输出 `runtime/ui/`。`e2e/` 使用 Playwright Chromium/Firefox。
- `policies/permissions/`：PMKB 唯一权威源。setup.py 将策略和公开 UI 资源复制入 wheel；包内策略资源不能独立编辑。

## 决策与证据约束

工具调用 → before_tool_call → 语义增强/ToolCallIR → Authorization Trace → PMKB → RV 升级裁决 → allow / requireApproval / block → OpenClaw 审批 → after_tool_call → 审计与成功证据提交。

PMKB 1.2.0：48 operations、79 native rules、76 traces、9 relations、123 vectors；47 migration records 仅用于 provenance/replay，不进入在线候选召回。未知工具、缺失身份与必要特征不能模糊自动放行。

OpenClaw 原生审批卡片是唯一审批源；Dashboard 经 SSE 只读同步。RV 不能降低 PMKB 裁决；前置检查不得提前提交成功历史，只有确认成功的工具完成事件可以扩充证据。session-local 窗口和 principal-global 能力证据应分离，主体状态受 TTL/容量约束，保存在 `runtime/rv-state.json`。

OpenClaw 当前严格 fail-open：后端不可达、HTTP 错误或不可解析响应时所有工具透传，只有明确 block 才阻断；不要把 DSH 规划的 fail-closed 默认值应用到现有 OpenClaw 集成。宿主授权默认不启用，启用时要求宿主独占、位于所有 Agent 工作区之外的授权目录，并绑定身份、任务、资源版本、目的地和时效；工具输入不能自行签发授权。

## 开发与验证

```bash
python -m pip install -e .
python -m clawRVguarder.main --help
python -m pytest tests/ -q
cd frontend && npm run build
cd e2e && npm test
```

日常启动仍用 `openclaw-guard run`（默认 127.0.0.1:8780）。构建需要已有完整 `runtime/ui/`：先构建前端，再构建 wheel。验证安装包应在仓库外使用干净目标目录，检查 UI、PMKB、RV JSON 等资源，避免源码路径掩盖打包缺陷。

注意：GuardServices 初始化会立即生成并安装 Hook（runtime_hook 虽使用 LazyProxy，但构造中调用了 `_get()`）。测试启动必须使用临时 project-dir、openclaw-root 和 config-path，避免改动真实 OpenClaw 配置。.env 含本地密钥，不读取或输出。runtime/output/dist/build、testlab 与部分内部实验脚本被 Git 忽略；忽略不代表本机不存在。

## 包目录迁移约定

Python 主包由 `openclaw_guard/` 迁移为 `clawRVguarder/`，源码导入、动态导入/patch 字符串、CLI 入口、setuptools 发现、资源定位、测试、E2E 启动与文档同步更新。Linux 大小写敏感，须准确使用 `clawRVguarder`。

发行名和命令仍为 `openclaw-guard`；数据库名 `openclaw_guard`、Redis key 前缀、Hook RPC `openclaw_guard.hook_status` 和 JS registrationId 保持原值，以兼容已有运行数据和插件。目录变动后需重新执行 editable 安装以刷新入口与包映射，不能只依赖旧 site-packages 元数据。历史发行包和运行数据不批量改写。setup.py 构建时清理 build/lib 下旧包生成物，防止 setuptools 缓存将新旧包同时装入 wheel。旧 Python 导入与 `python -m openclaw_guard.main` 应改用新包名。

## 待开发与边界

DSH Phase 0 宿主/部署实测 → Phase 1 共享核心及 PMKB/RV/LLM 完整决策 → Phase 2 状态/DSH 基线/Dashboard → Phase 3 全功能打包验收。各阶段属于同一完整版本，PMKB、扫描、面板和 LLM 不能延后排除。共享核心先移除 DSH 启动触发 OpenClaw Hook 安装的副作用；协议绑定可信 host/instance/identity/call，成功完成后去重提交证据。LLM 失败退本地分析，证据不足 ask/deny；核心服务不可用按 DSH failMode 处理，扫描或面板故障不直接阻断所有工具。现有维护项包括熔断告警、规则受控更新、审计轮转、分层健康检查和长期压测。当前拦截仅覆盖宿主 Hook 工具路径，不是系统级沙箱；ptrace/eBPF 采集器仍为预留实现。研究文档里的性能数字不是本次实测结果。

## 本次迁移验证（2026-10-20）

- 改名前后完整 `python -m pytest tests/ -q` 均为 748 passed、18 skipped、4 subtests passed；均有同一条 Starlette/httpx 弃用警告。跳过项不算已验证。
- 前端 `npm run build` 成功；Chromium Playwright 5/5 通过，本次未运行 Firefox。
- `python -m clawRVguarder.main --help` 与 `openclaw-guard --help` 均成功，本机 editable 安装已刷新。
- wheel 构建成功；在仓库外隔离安装，验证 PMKB 1.2.0（48 operations / 79 rules）、RV JSON、UI 与 console entrypoint，确认无旧 openclaw_guard 包目录和运行数据库/密钥文件混入。
- 本次未验证真实 OpenClaw Gateway 在线链路，也未执行 DSH seam 实测。

## Windows DSH 安装定位（2026-10-20）

当前 Windows PATH 的 DSH 为 npm 全局 CLI 0.2.1-rc.2，根目录 `C:\Users\ASUS\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`，CLI 为 `lib/bin.js`，SDK 位于其 `node_modules/@deepseek-ai/`。Windows Node 为 `E:\APP\Nodejs\node.exe`，版本 v24.15.0。已初始化 profile 为 `C:\Users\ASUS\.dsh\profiles\web`，manifest 使用 dsh-base 与 dsh-web-app；未发现 profile node_modules。用户工作区 `Documents/deepseek-harness/default-workspace` 不能当源码安装根。现有 Desktop app.asar 调研属历史记录。已执行 --version，未启动 DSH 或加载插件。完整路径与后续使用约束见 [Windows 开发环境记录](../../dshRVguarder/docs/windows-environment.md)。

## DSH实施状态（2026-10-20）

插件在dshRVguarder/，Python适配在clawRVguarder/hosts/dsh/。已实现认证门禁、原生审批、单次dispatch、风险重评估、完成队列、PMKB/RV/LLM、扫描及工作台。LLM语义缓存30秒/128项、60次每分钟，不缓存授权。主路径为外部托管Python3.13+，数据目录必须独占。Windows真实临时web profile已加载并握手；未改日常配置。证据、性能和剩余PTC/子Agent、在线LLM、ACL、内容血缘验收见[验证记录](../../dshRVguarder/docs/validation-2026-10-20.md)。DSH patch须insert/id；避免从有受限.env的仓库目录启动DSH。
