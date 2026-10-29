# RVguarder

**简体中文** | [English](README.en.md)

> **Agent 安全插件**：为 OpenClaw 与 DSH（DeepSeek Harness）提供工具执行前审批、PMKB 授权建模与运行时验证。

[![License](https://img.shields.io/badge/License-Apache%202.0-2563EB.svg)](LICENSE)
![Python](https://img.shields.io/badge/Python-3.13%2B-3776AB?logo=python&logoColor=white)
![Hosts](https://img.shields.io/badge/Hosts-OpenClaw%20%2F%20DSH-111827)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2%20%2F%20rc.3-2563EB)
![PMKB](https://img.shields.io/badge/PMKB-1.2.0-2563EB)
![RV](https://img.shields.io/badge/RV-ChainRule%20DSL-7C3AED)
![Status](https://img.shields.io/badge/Status-v0.2.1--rc1-0F766E)

RVguarder 同时适配 OpenClaw 与 DSH 两个宿主：OpenClaw 侧通过官方 Plugin SDK 的
`before_tool_call` 钩子接入，DSH 侧通过 `tools/pre-execute` 与 `ctx.tools.guard()` 接入，
共享同一套 Python 决策内核。两种接入都不修改宿主源码，在 Agent 真正调用工具之前完成：

- **权限判定** — 把工具调用归一化为 Authorization Trace，由 PMKB 给出可解释的授权结果
- **执行前审批** — 高风险操作交给当前宿主的原生审批，Agent 等待用户决定
- **行为序列验证** — ChainRule DSL 监视器在滑动窗口内识别「读取敏感数据 → 打包 → 外发」等链式风险
- **全链路审计** — SQLite + JSONL 双写，哈希链防篡改，支持导出

项目的目标不是替代沙箱，也不是接管 OpenClaw，而是让 Agent 的每一次工具调用都有明确的权限依据、
审批记录和可回放证据。

---

## 为什么是插件

Agent 的能力来自工具调用，风险也来自工具调用。传统做法要么修改 Agent 源码，要么依赖外部沙箱，
两者都难以回答「这次调用为什么被允许」以及「它和前面几步构成了什么风险」。

RVguarder 选择插件路径：

| 原则 | 含义 |
| --- | --- |
| **非侵入** | 不改宿主源码；OpenClaw 插件由 Guard 生成并注入，DSH 以独立 npm 包加载 |
| **双宿主同核** | OpenClaw 与 DSH 共用 PMKB、RV 与审计内核，不维护两套策略 |
| **单一审批入口** | OpenClaw / DSH 原生审批是唯一决策源，Dashboard 只读同步 |
| **证据驱动** | 每次决策携带 `match_status`、`missing_features`、`requested_delta` 等证据 |
| **可取证** | 审批、执行、阻断和审计结果全部落盘并可导出 |
| **故障策略可配** | OpenClaw 后端不可达时透传；DSH 默认 fail-closed，可显式配置 fail-open |

---

## 核心能力

| 能力 | 说明 |
| --- | --- |
| **原生钩子拦截** | `api.on("before_tool_call")` 官方 API，在工具执行前挂起 Agent |
| **DSH 原生门禁** | `tools/pre-execute` 返回 `allow` / `ask` / `deny`，配合 `ctx.tools.guard()` 单调拒绝与默认 fail-closed |
| **`requireApproval` 挂起** | 返回 `BeforeToolCallResult`，Agent 线程真正等待审批结果 |
| **审批结果同步** | OpenClaw 原生审批卡片唯一决策，Guard Dashboard 通过 SSE 只读同步 |
| **PMKB 权限建模** | PMKB 1.2.0：48 个 canonical operations、79 条原生规则、76 条 Trace、9 个危险组合、123 个回归向量 |
| **最小权限校验** | PermissionClosure + PermissionDiff 计算请求权限与必要权限的差值 |
| **运行时验证 RV** | 滑动窗口 + ChainRule DSL 监视器，检测跨步链式攻击 |
| **跨 session 主体验证** | session-local 与 principal-global 状态分离，TTL 有界持久化 |
| **语义理解增强** | SemanticEnhancer：7 维度标签体系，支持本地规则、独立 LLM 与 DSH 宿主子代理模式 |
| **审计链** | SQLite + JSONL 双写，SHA-256 哈希链防篡改 |
| **基线安全扫描** | 配置、端口、用户、依赖扫描，输出 JSON/HTML/PDF 报告 |
| **Web 工作台** | Preact SPA：动作状态、Trace 时间线、风险证据、RV 状态面板 |

---

## 工作方式

```
OpenClaw 准备调用工具
  → api.on("before_tool_call") 触发
  → 插件 POST /api/hook/before-tool-call
  → SemanticEnhancer → Authorization Trace → PMKB 规则/权限组合 → RV 验证
  → 返回 allow | requireApproval | block
  → requireApproval：Agent 挂起，OpenClaw 弹出原生审批卡片
  → onResolution 回调 → Guard SSE 只读同步
  → 工具继续或终止 → after_tool_call 回写审计
```

DSH 侧走同一内核，但使用宿主原生 seam：

```
DSH 准备调用工具
  → tools/pre-execute（TypeScript 插件）
  → 认证回环 HTTP → Python 共享核心（PMKB + RV + 审计）
  → allow | ask | deny
  → DSH 原生审批 / 执行
  → tools/execute 与 tools/result → 完成回写与审计
```

```
┌─────────────────────────────────────────────────────────┐
│                    Guard Dashboard (SPA)                │
│      概览 · 动作审批 · 安全规则 · 基线扫描 · RV 面板       │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP REST API / SSE
┌──────────────────────▼──────────────────────────────────┐
│                  Guard Bridge (Python)                  │
│   Semantic + Trace │ PMKB Policy │ RV Engine │ Audit    │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/hook/before-tool-call
┌──────────────────────▼──────────────────────────────────┐
│            OpenClaw Agent Plugin (JavaScript)           │
│   before_tool_call → requireApproval                    │
│   after_tool_call  → audit logging                      │
│   Circuit Breaker · Health Check · onResolution         │
└──────────────────────┬──────────────────────────────────┘
                       │ Plugin SDK
┌──────────────────────▼──────────────────────────────────┐
│                   OpenClaw Gateway                      │
│            Agent 运行 · 工具调用 · 原生审批 UI            │
└─────────────────────────────────────────────────────────┘
```

审批由当前宿主的原生窗口完成：OpenClaw 原生审批卡片或 DSH 原生审批。Guard 只提供证据与只读状态，不创建第二个审批源。

---

## 快速开始

### OpenClaw

#### 环境要求

- Python 3.13+
- Node.js 20+（构建前端）
- 已安装并可运行的 OpenClaw

#### 安装

```bash
git clone https://github.com/HorizonExploration/RVguarder.git
cd RVguarder

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .

# 构建工作台静态资源（输出到 runtime/ui/）
cd frontend
npm ci
npm run build
cd ..
```

Python 主包现为 `clawRVguarder`。更新已有开发环境后，请重新执行 `python -m pip install -e .`；模块启动使用 `python -m clawRVguarder.main run`，命令行仍使用 `openclaw-guard`。

#### 启动

```bash
openclaw-guard run
```

启动后会自动完成：发现 OpenClaw 配置 → 准备运行时目录 → 生成并注入 Hook 插件 → 启动本地服务。
浏览器访问 `http://localhost:8780` 进入工作台。

```bash
openclaw-guard run --no-browser   # 不自动打开浏览器
openclaw-guard run --once         # 一次性自检
openclaw-guard doctor             # 查看链路健康状况
openclaw-guard baseline           # 运行基线扫描
openclaw-guard export-audit --output ./audit.json
openclaw-guard install-hook       # 手动注入插件
openclaw-guard uninstall-hook     # 移除插件
```

可选的 LLM 语义增强：

```bash
export DEEPSEEK_API_KEY=...
```

未配置时使用本地规则模式，延迟更低，功能保持可用。

### DSH 插件

**0.2.1-rc1 · Windows x64 · DSH 0.2.1-rc.3**

```powershell
dsh plugin --profile desktop add dsh-rvguarder@0.2.1-rc1
```

重新启动 DSH，在 **插件 → 已安装** 中启用 RVguarder，再打开 **设置 → RVguarder**。整包自带运行环境，**无需安装 Python 或单独启动后端**。

[插件下载安装与使用说明](docs/deployment/dsh.md) 提供 npm 安装、GitHub Release 下载及日常操作。本版本为预发布版本，[验证范围与已知问题](dshRVguarder/docs/release-current.md) 请在使用前阅读。

---

## v0.2.1-rc1 更新

本版本整合 DSH 托管运行环境与内嵌工作台，并加入宿主模型路由语义分析、有界任务授权和任务内命令类别审批复用。工具映射、资源角色、委派链与已观察执行效果均进入决策证据；执行结果未知时不写成成功历史。

详见 [版本更新与支持范围](dshRVguarder/docs/release-current.md)。npm 和独立 GitHub 发行仓库安装需对应版本先发布；完整包也可从 [上游 Release](https://github.com/HorizonExploration/RVguarder/releases/tag/v0.2.1-rc1) 下载。

---

## PMKB：权限知识库

PMKB（Permission Model Knowledge Base）随每次 `before_tool_call` 参与决策，不是离线文档。
当前基线位于 `policies/permissions/`，也是仓库中的唯一源；构建时由 `setup.py` 复制进安装包。

| 数据 | 当前基线 | 用途 |
| --- | --- | --- |
| operations | 48 | 将工具/动作归一化为 canonical operation |
| rules | 79 native | 单步规则、风险等级、效果与 required trace |
| migrations | 47 | 历史规则到 native owner 的 provenance/replay 映射 |
| traces | 76 | 主体在办公场景的最小必要权限范围 |
| relations | 9 | 互斥、聚合和毒性权限组合 |
| vectors | 123 | 规则、Trace、组合与迁移的正反例 |

决策顺序：

```text
原始工具调用
  → SemanticEnhancer（entities / labels / classification / purpose / confidence）
  → TraceCompiler（action / resource / scope / data / context / principal / identity）
  → PolicyEvaluator（matched / partial / unknown / conflict）
  → PermissionClosure + PermissionDiff + RiskGraph
  → effect：auto_allow_audit | openclaw_approval | block
```

未知操作、缺失主体或缺失关键 Trace 特征不会因模糊相似度自动放行。结果会携带
`match_status`、`missing_features`、`requested_delta`、`excessive_permissions`、
`combo_violations` 和 `policy_version`，便于在 Dashboard 中解释与回放。

---

## RV：运行时验证

RV 在 PMKB 单步效果之上验证行为序列，运行时只使用 ChainRule DSL：

```
s1: file_read    /tmp/data.xlsx          ← 读取外部附件
s2: file_read    contains_secret         ← 读到敏感数据
s3: file_write   合并到新文件             ← 敏感数据被写入
s4: network_egress → external_target     ← 数据外传

ChainRule DSL 监视器触发：
  "不可信来源 → 读取敏感数据 → 外传到外部目标"
  → BLOCK（优先级高于单步规则 ASK）
```

状态作用域：

- **session-local**：当前会话内的滑动窗口
- **principal-global**：按 `(principal_id, agent_id, capability_lineage)` 聚合跨 session 能力

状态保存在 `runtime/rv-state.json`，受 TTL 与有界状态约束。

---

## 项目结构

```
clawRVguarder/        Python 后端与 CLI（FastAPI、PMKB、RV、审计、OpenClaw 集成）
dshRVguarder/         DSH 0.2.1-rc.2 / rc.3 适配插件（0.2.1-rc1：内嵌管理界面与托管运行环境）
frontend/              Preact 工作台（Vite 构建，产物输出 runtime/ui/）
policies/permissions/  PMKB 单一源（schema、operations、rules、traces、relations、vectors）
tests/                 后端测试与文档/发布契约
e2e/                   Playwright 端到端测试
scripts/               校验与发布辅助脚本
docs/                  VuePress 文档站
```

---

## 开发与测试

```bash
python -m pytest tests/ -q

cd frontend
npm run dev          # 本地开发，代理 /api 到 127.0.0.1:8780
npm run build        # 构建产物到 runtime/ui/

cd docs
npm install
npm run docs:dev     # 文档站本地预览
```

测试覆盖权限决策、Trace 编译、PMKB 基线、主体级 RV、ChainRule DSL、审计、CLI 与前端契约。

---

## 安全边界

RVguarder 是策略与审批层，不是系统级沙箱：

- 只覆盖通过宿主公开 seam 发起的工具调用（OpenClaw `before_tool_call` / DSH `tools/pre-execute`）
- OpenClaw 侧后端不可达、返回 4xx/5xx 或响应不可解析时，工具调用透传；只有 Guard 明确返回 `block` 才阻断
- DSH 侧默认 fail-closed：核心服务不可达、协议异常或历史未确认时拒绝执行；只有显式 `failMode: open` 才透传服务故障
- 默认 PMKB 针对个人办公场景，其他场景需要扩展策略包
- 未知工具和越权参数保持 `unknown`，不会自动放行
- 审批成本与策略精度需要按实际部署校准

更完整的攻击面与漏防说明见[安全能力与边界](docs/rvguarder-security-capabilities-and-boundaries.md)。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](docs/deployment/local.md) | 本地部署 |
| [运行时 Hook](docs/features/runtime-hook.md) | 拦截机制与审批同步 |
| [动作审批链](docs/features/action-gate.md) | 决策流程与 PMKB 策略 |
| [架构总览](docs/architecture/overview.md) | 分层设计与代码映射 |
| [PMKB 与 RV 运行时架构](docs/architecture/permission-kb-runtime-architecture.md) | 权限建模、Trace 与跨 session RV |
| [RV 权限自动机](docs/architecture/rv-permission-automata.md) | DSL 合同、作用域与迁移 |
| [HTTP API](docs/api/http.md) | 接口清单 |
| [语义理解](docs/semantic/method.md) | SemanticEnhancer 与标签体系 |
| [DSH 插件部署](dshRVguarder/docs/deployment.md) | DSH 共享服务、profile 与 Windows 原生 / Linux/WSL 部署 |
| [DSH 验证记录](dshRVguarder/docs/validation-2026-10-20.md) | 已验证范围、性能基线与剩余门禁 |
| [DSH 迁移与开发计划](docs/architecture/dsh-plugin-migration-feasibility-2026-10-19.md) | 扩展点映射、能力矩阵与阶段计划 |
| [FAQ](docs/ops/faq.md) | 常见问题 |
| [路线图](docs/ops/roadmap.md) | 开发计划 |

---

## License

[Apache-2.0](LICENSE)
