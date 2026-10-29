---
home: true
title: RVguarder
heroText: RVguarder
tagline: Non-intrusive runtime security plugin for OpenClaw and DSH
actions:
  - text: 快速开始
    link: /deployment/local.html
    type: primary
  - text: DSH 插件下载安装
    link: /deployment/dsh.html
    type: secondary

features:
  - title: 🛡️ 双宿主原生门禁
    details: OpenClaw 通过官方 `api.on("before_tool_call")` 接入；DSH 通过 `tools/pre-execute` 与 `ctx.tools.guard()` 接入，两种宿主都不修改源码。
  - title: 🔄 审批结果同步
    details: OpenClaw 原生审批卡片是唯一 Hook 审批入口，Guard Dashboard 通过 `onResolution`、SSE 和增量查询及时同步结果。
  - title: ⚡ 后端静默透传
    details: OpenClaw 侧后端传输不可达时所有 Agent 的工具调用（含写入与执行）由 OpenClaw 自身规则继续处理，Guard 防护暂停；后端恢复后自动启用。DSH 侧默认 fail-closed，可显式配置 fail-open。
  - title: 🧠 语义理解增强
    details: DeepSeek LLM 驱动的语义分析引擎，理解自然语言约束而非简单关键词匹配。7 维度 50+ 标签，支持本地分析、独立 LLM 和 DSH 当前模型路由。
  - title: 🧩 权限知识库 PMKB
    details: 版本化操作目录、Authorization Trace、最小权限闭包/差分和危险权限组合图，直接参与 before_tool_call 决策并输出可解释证据。
  - title: 📊 运行时验证 RV
    details: 滑动窗口 + ChainRule DSL 生成监视器，检测「搜索→删除→外发」等链式攻击模式。
  - title: 🖥️ Guard 工作台
    details: 动作状态、风险证据、Trace 时间线、安全规则、基线扫描和 RV 状态集中查看；DSH 可直接在“设置 → RVguarder”中使用内嵌工作台。

---

<div class="custom-card-grid">
  <div class="custom-card">
    <h3>🎯 适合谁用</h3>
    <p>高安全终端、内网环境、AI 实训场景，以及希望在不侵入 OpenClaw / DSH 的前提下增加安全管控的团队与个人。</p>
    <p><em>For teams who want OpenClaw or DSH safety without touching a single line of host source.</em></p>
  </div>
  <div class="custom-card">
    <h3>🧱 架构概览</h3>
    <p>插件层 (api.on) → 语义/Authorization Trace → PMKB 权限策略 → session/principal RV → 决策层 (allow/requireApproval/block) → Guard 状态同步 (onResolution + SSE)</p>
    <p><em>Plugin hooks → Semantic/Trace → PMKB policy → session/principal RV → allow/approval/block → Read-only Guard sync</em></p>
  </div>
  <div class="custom-card">
    <h3>📦 当前状态</h3>
    <p>OpenClaw 与 DSH 共享 PMKB、运行时验证和审计能力。DSH 0.2.1-rc1 提供 Windows x64 整包，支持 DSH 0.2.1-rc.3，插件安装后自动启动后端，无需另装 Python。</p>
    <p><em>The DSH Windows x64 package includes its runtime and an embedded management UI.</em></p>
  </div>
</div>

---

当前发布：**v0.2.1-rc1**。[更新与验证记录](./dev/release-v0.2.1-rc1.md)。

## 文档导航

| 章节 | 内容 |
| --- | --- |
| [本地部署](./deployment/local.md) | 安装与首次启动 |
| [DSH 插件下载安装](./deployment/dsh.md) | npm 安装、GitHub 下载与日常使用 |
| [运行时 Hook 拦截](./features/runtime-hook.md) | 插件机制与审批结果同步 |
| [动作审批链](./features/action-gate.md) | 决策流程与 PMKB 策略 |
| [架构总览](./architecture/overview.md) | 分层设计与代码映射 |
| [权限知识库与 RV 运行时架构](./architecture/permission-kb-runtime-architecture.md) | PMKB、语义命中、权限建模与跨 session RV |
| [安全能力与边界](./rvguarder-security-capabilities-and-boundaries.md) | 可防护攻击、已知漏防与部署边界 |
| [DSH 迁移与开发计划](./architecture/dsh-plugin-migration-feasibility-2026-10-19.md) | 扩展点映射、能力矩阵、阶段计划与验收标准 |
| [HTTP 接口清单](./api/http.md) | 后端 API 文档 |
| [语义理解方案](./semantic/method.md) | 语义理解架构设计 |
| [运维 FAQ](./ops/faq.md) | 常见问题 |
| [路线图](./ops/roadmap.md) | 开发计划 |
