# DSH 宿主子代理工具隔离修复实施计划

> **For agentic workers:** 本计划由当前会话内联执行，逐项完成并检查工作区。

**Goal:** 在 DSH host-agent 子 Agent 首轮提示前隐藏并禁止工具调用，且准确报告隔离/provider 能力。

**Architecture:** 将空 preset 替换为只装载 RVguarder 内部限制插件的私有 preset。插件用 `tools.restrict({ allow: [] })` 屏蔽所有全局工具，`tools.presentAs('native')` 隐藏 PTC 的保留传输工具，并安装 Agent 范围的拒绝 guard；HostSemanticDelegator 还会在启动前登记随机 child ID，`tools/pre-execute` 立即拒绝这些子 Agent 的调用，全局单调 guard 阻止任何工具执行。DSH preset registry 确认内部插件处于激活状态后才报告隔离可用。运行时 schema 检查保留为断言，provider 校验增加 `inheritsParentContext === false`。

**Tech Stack:** DSH 0.2.1-rc.2/rc.3、TypeScript、Preact、Vite。

---

### Task 1: 增加受限 preset 插件

**Files:**
- Create: `dshRVguarder/src/semantic-tools-deny.ts`
- Modify: `dshRVguarder/package.json`
- Modify: `dshRVguarder/tests/host-semantic.test.mjs`
- Create: `dshRVguarder/tests/semantic-tools-deny.test.mjs`

- [x] 新建 preset 插件。它只依赖 DSH tools 服务，不注册工具、不触发模型请求：

```ts
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';

export const name = 'dsh-rvguarder-semantic-tools-deny';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  ctx.tools.restrict({ allow: [] });
  ctx.tools.presentAs('native');
  ctx.tools.guard(() => 'RVguarder semantic child tools are disabled');
}
```

- [x] 在包 `exports` 增加 `./semantic-tools-deny`，指向 `dist/semantic-tools-deny.js` 与其声明文件，供 DSH preset loader 从已安装包解析。
- [x] 更新现有 host-semantic fixture，模拟私有 preset 插件成功装载与 `resolve()` 无 broken 诊断，并断言启动 activation 前限制、native 呈现和 guard 已安装；PTC 父上下文的保留传输 schema 在 native 子 Agent 中消失。
- [x] 新增限制插件单测：确认它调用空 allow 限制、强制 native 呈现并安装一个对任意工具都返回拒绝原因的 guard。

### Task 2: 在 Agent 启动前启用限制并校验 provider

**Files:**
- Modify: `dshRVguarder/src/host-semantic.ts`

- [x] 将 preset 定义改为只包含内部插件：

```ts
plugins: [{ id: 'semantic-tools-deny', name: 'dsh-rvguarder/semantic-tools-deny' }]
```

- [x] 确认 provider 除支持 `agentPreset` 与本地启动接口外，还满足 `inheritsParentContext === false`；否则使用固定原因码并保持 host-agent 不可用。
- [x] 限制本地 provider 的能力判定为 `prepareContinuable()`，避免把不承载当前 DSH Agent 路由的外部 `start()` provider 报为受支持。
- [x] 在调用 `startActivation()` 前将随机 child ID 加入活跃语义子代理集合并传入 activation spec；全局 guard 只拒绝集合中的 Agent。activation dispose 后移除 ID。
- [x] 在 DSH 主 `tools/pre-execute` 监听器入口识别活跃语义 child ID，直接拒绝并跳过后端请求，阻断递归语义委派。
- [x] 通过 preset registry 的 `resolve(presetId)` 检查已注册 preset 的实际装载诊断；仅在内部插件成功加载时置 `isolated_preset_ready` 与 `effective_tools_empty` 为真。注册冲突或诊断失败时不复用不匹配 preset。
- [x] 使用 `inspectCompositions()` 验证内部限制插件确实处于激活组合中，避免被 profile 兼容策略静默禁用。
- [x] 保留 `run()` 中的实际 child schema 检查；若 schema 非空或不可读，释放 activation、置隔离能力为不可用并返回本地回退。

### Task 3: 对接状态提示与说明文档

**Files:**
- Modify: `frontend/src/components/HostPanel.jsx`
- Modify: `clawRVguarder/hosts/dsh/observability.py`
- Modify: `tests/test_dsh_host_semantic.py`
- Modify: `dshRVguarder/README.md`
- Modify: `dshRVguarder/docs/windows-native-rc3.md`
- Modify: `dshRVguarder/docs/deployment.md`

- [x] 为 provider 上下文不兼容和 preset 工具隔离初始化失败添加固定原因码的中文显示。
- [x] 扩展 `HostAgentProbe.provider_reason` 的允许值；能力汇总优先保留有效的隔离失败原因，避免把运行时工具表异常折叠成通用 preset 错误。
- [x] 将文档中“空工具 preset”描述改为受限 preset 插件屏蔽全局工具、隐藏 PTC 传输工具并拒绝工具执行，保持前端字段与后端响应 schema 不变。

### Task 4: 静态构建检查

**Files:**
- Build output: `dshRVguarder/dist/`

- [x] 执行 TypeScript 类型检查：`npm run check`（工作目录：`dshRVguarder`）。
- [x] 执行 DSH 插件构建：`npm run build`（工作目录：`dshRVguarder`），确认 preset 子路径生成 JS 与声明文件。
- [x] 执行前端构建：`npm run build`（工作目录：`frontend`），确认状态原因映射无 JSX/build 错误。
- [x] 执行 DSH 插件定向回归：`node --test --test-concurrency=1 tests/host-semantic.test.mjs tests/semantic-tools-deny.test.mjs tests/plugin.test.mjs`（工作目录：`dshRVguarder`）。
- [x] 执行 DSH 探针原因码回归：`.venv/Scripts/python.exe -m unittest tests.test_dsh_host_semantic -v`；当前运行环境没有 pytest，改用该测试模块自带的 unittest runner，9 项通过。
- [x] 检查最终 diff、工作区状态和路径/包导出，提交实现到当前 `master` 分支。

全量 `npm test` 已尝试；新增 host-agent 与工具隔离测试通过，其余 11 项因当前环境缺少 Python FastAPI 依赖和 OpenSSL 配置而失败。此环境阻塞不影响上面的定向回归结果。
