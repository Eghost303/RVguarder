# DSH 内嵌管理界面实现报告（2026-10-27）

> 状态：**已实施并完成真实 rc.3 宿主验收**。本文按 [开发任务书](../../docs/dev/dsh-ui-integration-plan-2026-10-26.md) 第 14 节交付要求撰写，记录实际选型、与建议的差异、验证结果与剩余问题，供 Codex 复核。
>
> 实施基线：本地 `master` 起点 `63d8772`；插件 `dsh-rvguarder@0.2.0-rc.3`（本轮由 rc.2 升级）；宿主 `DSH 0.2.1-rc.3`（桌面 CLI，Cordis 4.0.5）；Node v24.19.0；Windows 原生 Python 3.14.8。

## 1. 环境与基线（工作包 A）

| 项 | 记录 |
| --- | --- |
| Git HEAD（开始） | `63d8772`（master，未新建分支） |
| DSH CLI | `0.2.1-rc.3`（`C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`） |
| SDK 缓存 | `runtime/dsh-sdk-0.2.1-rc.3/`（asar 只读提取 + `complete-desktop-types.py` 补齐 364 个声明） |
| 插件起始版本 | `0.2.0-rc.2`（plain dependency + profile `insert/id` 启用） |
| Python | `.venv/bin/python.exe`（Windows 原生 3.14.8） |

### 1.1 DSH-UX-01 根因（已在真实宿主复现并定位）

`pluginManager.listBundles()`（`packages/boot/plugin-manager`）对每个包：
`installed = 依赖中存在`；`bundleManifest()` 读取 `dsh.bundle.patch` —— 旧包无此声明 → 返回 undefined；
然后 `if (enabled || offered !== undefined) push(...)`，其中 `enabled` 来自 `dsh.profile.bundles`。

旧接入方式是 **普通依赖 + 用户层 `insert/id=rvguarder-dsh`**：
- `installed=true` 但 `enabled=false`（bundle 未选中）、`offered=undefined`（不在官方目录）；
- 无 `dsh.bundle` → `bundleManifest()` 为 undefined → **整条被跳过，插件页完全不显示**。

迁移到 `dsh.bundle` + bundle 选择后，真实宿主 `listBundles` 返回（`runtime/native-rc3-ui-verify/result.json`）：

```json
{"name":"dsh-rvguarder","version":"0.2.0-rc.3","installed":true,"enabled":true,
 "official":false,"availability":"profile","removable":true,"error":null,
 "rows":[{"rowId":"rvguarder-dsh","moduleName":"dsh-rvguarder"},
         {"rowId":"rvguarder-admin","moduleName":"dsh-rvguarder/admin"}]}
```

### 1.2 真实宿主机制核对结论

| 机制 | 结论（源码 + 隔离 profile 实测） |
| --- | --- |
| 插件页"已安装" | 由 `listBundles()` 构建；bundle patch 需为 `- insert: [行...]` 形（首次用错为裸条目数组，宿主导出 `--dump-config` 显示 `entry "rvguarder-dsh" not found` 后修正） |
| `!!js` 表达式 | 仅在条目 fiber 的 `internal/config` waterfall 对 `config` 求值（`interpolate(this.ctx, config)`）；`process` 全局可用、`require` 不可用。bundle 默认值用 `process.env.USERPROFILE` 推导 |
| 客户端包发现 | `dsh-client-modules` 扫描 Loader 条目 → 解析其 `package.json` → `dsh.client:{platform:'web'}` + `exports['./client']` → 进 boot graph（实测 graph 从 70 → 71 entries，含 `dsh-rvguarder/client.js&rev=...`，`application` 批次） |
| 浏览器加载格式 | `window.__ModuleLoader__.load({id, factory})`；工厂内 `require` 解析：**平台 seed**（react、react/jsx-runtime、react-dom、react-dom/client、@deepseek-ai/cordis、zod、@tanstack/react-virtual、@deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-slots、@deepseek-ai/dsh-client-ui-primitives、@deepseek-ai/dsh-client-ui-dockkit）→ 已物化模块 → 图行 |
| 插件 `inject` | 客户端工厂导出 `{apply, inject}`，`inject` 是 **Cordis 服务名**（如 `slots`、`locale`、`remote`）；`dsh.client.inject` 是**包名**（图行加载顺序）。服务未注入直接访问会抛 `cannot get property "locale" without inject`（实测修复） |
| Remote 契约 | 宿主：`TypertRemoteService` + `@Remote()` 标记即被 Gateway SRC 模式反射（无需生成 artifact）；客户端：`ctx.remote.$mount(createTypertRemoteInfo(spec, z))`，**要求严格 codec**，descriptor 必须带 `service` 字段（缺失时 `validateSegment(undefined)` 报 undefined.length，实测修复） |
| owner 边界 | 浏览器认证 Peer 即 `principal.kind === 'owner'`；`principalOf(ctx.invocation)` 返回非 owner principal 或 undefined。匿名 `/api` 请求 401（实测） |
| 设置插槽 | `settings.section` 列表插槽：`ctx.slots.inject('settings.section', () => ctx.slots.register({name,id,order,label,locale,inject}, Component))`；宿主"账号菜单 → Settings"打开面板（含 Preview 公告需先 Continue） |

## 2. 最终架构与实际入口（与计划第 5 节对照）

```text
DSH 原生插件页（sidebar → Plugins）
  └─ dsh-rvguarder bundle：listBundles 可见，启停/移除沿用宿主机制
     ├─ rvguarder-dsh   → dist/index.js        核心（tools/workingDirectory，拦截/完成队列，不变）
     └─ rvguarder-admin → dist/admin.js        管理适配器（独立条目，失败不影响核心）
         └─ RvguarderAdmin extends TypertRemoteService('rvguarderAdmin')
             固定方法 ×10，requireOwner + 字段白名单 + 有界响应

DSH 设置 → RVguarder（settings.section id='rvguarder'，order 40）
  └─ 浏览器客户端包 dist/webclient.js（dsh-rvguarder/client）
      ├─ $mount(rvguarderAdmin 契约, zod 严格 codec)
      ├─ ctx.inject(['remote.rvguarderAdmin']) → 命名空间就绪后注册设置插槽 + 插件详情插槽
      └─ React 外层容器 → mountEmbedded(容器, {transport}) → 独立 Preact Guard 界面
          transport → namespace.method() → 宿主 Gateway → 管理适配器 → 本机 Python API
```

### 2.1 与任务书建议的差异及原因

| 计划建议 | 实际选择 | 原因 |
| --- | --- | --- |
| 设置入口建议 id `rvguarder` | **采纳**，id=`rvguarder`，order 40 | 与内置段（general=0、plugins=15）不冲突 |
| bundle patch 语法"以 rc.3 为准" | **采纳**：单文件 `cordis.patch.yml`，`- insert:` 两行 | 见 1.2；首次用错已修正并留测试 |
| 生成的 Remote 契约 | **手工构造** `createTypertRemoteInfo` 贡献（合法公共 API，`@deepseek-ai/dsh-typert-protocol/remote-info`） | Typert generator 是 DSH 私有构建工具，不对外发布；`remote-info` 是公开导出且零运行时依赖，打包进客户端。宿主侧走 SRC 反射，两侧方法名一一对应 |
| `plugins.bundle.config` 详情插槽 | **已注册**（key=`dsh-rvguarder`）显示入口指引；完整管理在设置页 | rc.3 无跨插件打开设置的公共 API；插槽页只指引，不伪造导航 |
| 首版单文件客户端产物 | **采纳**：`dist/webclient.js` 单文件（123KB，minify），Preact+样式全打入，无异步 chunk | 减少宿主内资源定位问题；`npm pack --dry-run` 验证 |
| 事件通道 | **有界轮询（10s）**，未转发 SSE | 计划允许首版轮询；`$on` 转发表由宿主 `API_REMOTE_FORWARDED_EVENTS` 硬编码白名单控制，第三方事件不在其中 |
| 下载 | Gateway **字节附件通道**：`Uint8Array` 结果 → FormData 附件 → 浏览器解码 → Blob 下载 | `encodeRpcResult` 自动把 Uint8Array 提取为附件；不暴露后端绝对路径 |

## 3. 工作包 B：bundle 化与旧 profile 迁移

### 3.1 包声明（`dshRVguarder/package.json`）

- `dsh.bundle.patch: ["./cordis.patch.yml"]`；`dsh.client: {platform:'web', inject:['@deepseek-ai/dsh-client-locale']}`。
- exports 增加 `./admin`（宿主管理条目）、`./client`（浏览器包 → `dist/webclient.js`）、`./package.json`、`./locale/*.json`。
- `files` 增加 `locale`、`cordis.patch.yml`；`prepack` = `tsc && build-client`（后者需先 `npm --prefix frontend run build:embedded` 产出内嵌模块）。
- `engines.dsh` 与 peer 范围保持 `0.2.1-rc.2 || 0.2.1-rc.3`，未混装 SDK；`sdk.ts` 版本校验未改动。

### 3.2 bundle 行拆分与单一守卫

`cordis.patch.yml`（包内默认，`!!js` 推导用户目录）插入**两行**：
- `rvguarder-dsh`（核心，id 与旧 profile 一致）；
- `rvguarder-admin`（管理适配器，UI/管理失败不进核心依赖链）。

profile 用户层用 **id 定向 patch 整体替换 config**（旧 insert 行被移除），迁移后 Loader 内同一包只挂载一份监听器/完成队列；`owner.lock` 语义不变（崩溃后要求人工核对，测试中 taskkill /F 模拟崩溃会正确触发恢复锁定——这是设计行为而非缺陷）。

### 3.3 迁移工具（`scripts/migrate-test-profile.mjs`）

- 先备份 `package.json` + `cordis.patch.yml`（时间戳目录，不覆盖既有备份）。
- 校验旧形状：JSON 数组、`insert/id=rvguarder-dsh` 恰好 1 项、`failMode` 合法；未知形状**报具体差异拒绝迁移**（不整份覆盖）。
- 复用旧 config 的 `instanceId/tokenFile/stateDir/backendUrl`（不重建令牌、不换实例身份）；其他插件条目原样保留。
- 幂等：已迁移（bundle 已选 + patch 已是 id 定向）→ `migrated:false, reason:'already-bundle'`，无第二次备份。
- 测试 `tests/migrate.test.mjs`：3/3 通过（身份保留、重复迁移 diff 不变、其他插件保留/坏形状拒绝）。

## 4. 工作包 C：宿主认证与管理通道

### 4.1 管理适配器（`src/management.ts`，`src/admin.ts`）

`RvguarderAdmin extends TypertRemoteService(ctx, 'rvguarderAdmin')`，**唯一持有桥接令牌**（构造时从 tokenFile 读取，仅存于宿主内存）。每个方法第一步 `requireOwner()`：`principalOf(this.ctx.invocation) !== undefined` → 抛 `rvguarder/not-owner`。

固定方法清单（与 8.2 表一一对应，未注册任何通用代理）：

| Remote 方法 | 后端调用 | 约束实现 |
| --- | --- | --- |
| `overview` | `GET /api/summary` | 字段白名单（`generated_at/host/hook/semantic/actions/sync/execution_guard/policy/rv/audit/baseline/capabilities/product`）；`settings`/`paths`/`target` 不离开宿主（target 只留 `target_profile`）。后端不可达 → `{ok:true, backend:{online:false}}`，不冒充 |
| `actionDetail` | `GET /api/actions/{id}` | id 白名单 `[A-Za-z0-9_.:-]{1,256}`；缺失 → `rvguarder/action-not-found` |
| `policy` | `GET /api/dsh/policy` | 只读 |
| `rvStatus` | `GET /api/rv/status` | 只读 |
| `rvToggle` | `POST /api/rv/toggle` | `enabled` 必须 boolean；沿用后端既有语义 |
| `semanticMode` | `POST /api/dsh/semantic` | 只收 `local/auto/llm`（zod enum 两侧强制）；409 → `rvguarder/llm-key-missing` |
| `runScan` | `POST /api/baseline/run` | 后端串行；页面防重复 |
| `audit` | `GET /api/dsh/audit` | 只读 |
| `auditExport` | `GET /api/dsh/audit-export/{json\|csv}`（本轮新增后端端点） | 受控标识、64MB 上限、返回字节经附件通道 |
| `report` | `GET /api/dsh/reports/{json\|html\|pdf}` | 404 → `rvguarder/report-not-generated`；字节交付 |

通道约束：`redirect:'error'` 不跟随重定向；`AbortSignal.timeout`（JSON 8s/字节 ≥8s 但 ≤30s）；响应 4MB 上限；后端 401 → `rvguarder/backend-unauthorized`；非 JSON → `rvguarder/backend-protocol`。**未开放**：`hello/before/dispatch/result/degraded/probe`、批准/拒绝/删除/重置、任意 URL/头/令牌。失败码运行时原样过线（结构标记识别，非 instanceof）。

### 4.2 后端最小补齐（`clawRVguarder/hosts/dsh/http.py`）

唯一新增：`GET /api/dsh/audit-export/{json|csv}` —— 先 `audit_store.export(固定目录)` 再按固定文件名回传字节（`FileResponse`），64MB 上限，不接受任意路径。未放松任何现有认证/同源/方法限制（`allowed_mutations` 集合未改）。

### 4.3 客户端契约（`client/remote-contribution.ts`）

`createTypertRemoteInfo({package:'dsh-rvguarder', methods:{'rvguarderAdmin/<method>':{service:'rvguarderAdmin', invocation:{kind:'direct'}, parameters, result}}}, z)`。每参数严格 codec（zod enum/boolean/string，jsonSchema 同步）；下载结果校验 `{bytes: Uint8Array, filename, mediaType}`。`verify-client-shape.mjs` 在模拟 `__ModuleLoader__` 环境断言导出形状。

## 5. 工作包 D：原生入口、内嵌组件与导航

### 5.1 浏览器客户端（`client/index.ts` → `dist/webclient.js`）

- `inject = ['slots','locale','remote']`（Cordis 服务）；`dsh.client.inject = ['@deepseek-ai/dsh-client-locale']`（图行）。
- `apply`：注册词典（zh/en）→ `$mount(契约)`（异步，失败 console.error 且不静默成功）→ **`ctx.inject(['remote.rvguarderAdmin'])`**：命名空间服务由 `$mount` 创建的独立 fiber 提供，就绪后注册插槽，无循环依赖。
- transport 工厂：解包 `RemoteResult`（`ok:false` → 带 code/payload 的 Error；`ok:true` → value）。
- 设置插槽 `settings.section`（id=rvguarder）+ 插件详情插槽 `plugins.bundle.config`（key=dsh-rvguarder）。

### 5.2 内嵌 Guard（`frontend/src/embedded.jsx` + `frontend/src/embedded/`）

- 显式 `mountEmbedded(container, {transport, instanceId, language, initialView})` → `{dispose}`；与 `main.jsx` 完全分离，不读 URL 令牌、不写 `document.documentElement`。
- React 外层容器只管理一个 div；Preact 渲染其内部；`useEffect` 清理保证 StrictMode 双挂载/卸载安全。
- 局部页签导航（概览/调用与审批/规则与 RV/扫描与报告/审计/设置）：**不改写宿主 pathname/hash**（E2E 断言）；内容在面板内滚动。
- 样式：`scripts/build-embed-styles.mjs` 把 `styles.css` 转为 `.rvg-embed` 前缀作用域（`:root` → `.rvg-embed`，`[data-theme]` → `[data-embed-theme]`，剔除 html/body 规则）；一次性 `<style id=rvguarder-embedded-styles>`，dispose 移除（E2E 断言 count 0）。
- 主题/暗色跟随宿主令牌（内嵌不再设置整页 data-theme）；`HostPanel` 概览纳入内嵌 Overview 视图。
- store：`_enterEmbedded(instanceId)` / `_exitEmbedded()` 会话生命周期；持久化键 `rvguarder-embed-<instanceId>-*` 与独立工作台 `openclaw-guard-*` 完全隔离；退出清空选择/错误/缓存/订阅数据。
- transport 注入：`api.js` 经 `transport.js` 抽象（`httpTransport` 独立工作台 / `createRemoteTransport` 语义在客户端实现）；内嵌模式轮询 10s，无 EventSource（宿主 `$on` 白名单不含第三方事件）。
- DSH 不支持控件保持隐藏：OpenClaw trust 管理在内嵌只读卡片化、清空历史按钮沿用既有 DSH 隐藏逻辑、批准/拒绝沿用 `canApprove`（hook_bridge 排除）；无自建审批按钮（E2E 断言 `.approve-action` count 0）。
- 错误状态：离线横幅 + 重新连接按钮；无无限 spinner；各 tab 独立空态。

## 6. 工作包 E：构建、打包与包外验证

### 6.1 构建链（仓库根执行，Windows PowerShell 示例）

```powershell
$env:PYTHONUTF8 = '1'
$python = Join-Path $PWD '.venv\bin\python.exe'   # 或 .venv\Scripts\python.exe

# 1) 前端：独立工作台 + 内嵌单文件模块（runtime/embedded/rvguarder-embedded.mjs）
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run build:embedded

# 2) SDK（首次）：从桌面 asar 提取并补齐类型
& $python -X utf8 dshRVguarder/scripts/extract-desktop-sdk.py `
  --archive 'C:\Users\elect\AppData\Local\Programs\DeepSeek Harness\resources\app.asar' `
  --output runtime/dsh-sdk-0.2.1-rc.3
& $python -X utf8 dshRVguarder/scripts/complete-desktop-types.py `
  --sdk-root runtime/dsh-sdk-0.2.1-rc.3
npm.cmd --prefix dshRVguarder ci --ignore-scripts --legacy-peer-deps
node dshRVguarder/scripts/link-sdk.mjs runtime/dsh-sdk-0.2.1-rc.3

# 3) 插件：类型检查（服务端 + 客户端）→ 构建 → 打包（prepack 重建 webclient）
npm.cmd --prefix dshRVguarder run check     # tsc ×2 + verify-client-shape
npm.cmd --prefix dshRVguarder run build     # tsc → dist/*.js
Push-Location dshRVguarder; npm.cmd pack; Pop-Location
# 产物：dshRVguarder/dsh-rvguarder-0.2.0-rc.3.tgz
```

`npm pack --dry-run` 核对：`dist/`（含 `admin.js`、`management.js`、`webclient.js`）、`cordis.patch.yml`、`locale/{en,zh}.json`、docs；**无** tokenFile 内容、无 runtime 数据、无 SDK 缓存、无 node_modules。tgz 内凭据形态扫描：仅命中 React 内部符号名 `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`（非凭据）。

### 6.2 新 profile 安装（`scripts/create-test-profile.mjs`，已改为 bundle 方式）

```powershell
# 首次安装（生成私有实例与令牌 → 创建 bundle 化 profile → 安装 tgz）
.\dshRVguarder\scripts\install-windows-profile.ps1
# 终端 1：后端（每轮单独启动）
.\dshRVguarder\scripts\start-windows-backend.ps1
# 终端 2：DSH 测试 profile
dsh.cmd --profile rvguarder-dev --port 8790
```

默认 bundle 面向 `dsh-local` 实例（`~/.rvguarder/dsh-local`）；`create-test-profile.mjs` 写入 `dsh.profile.bundles + dsh-rvguarder` 并用 id 定向 patch 覆盖两行 config 为实际实例参数（backendUrl/tokenFile/stateDir 等）。安装输出不再出现 "declares no dsh.bundle" 提示（真实宿主验证 `mentionsBundle=true`）。

### 6.3 旧 profile 升级（`scripts/migrate-test-profile.mjs`）

```powershell
# 后端与 DSH 均停止时执行；幂等可重复
node dshRVguarder\scripts\migrate-test-profile.mjs `
  --profile rvguarder-old --token <既有 dsh-token 路径> `
  --backend http://127.0.0.1:8781 --home <DSH_HOME>
# 迁移后：同一 profile 重新安装新 tgz 再重启
dsh.cmd plugin --profile rvguarder-old add dshRVguarder\dsh-rvguarder-0.2.0-rc.3.tgz
```

迁移不重建令牌/不改实例身份/不动完成历史与审计；失败时保留原文件（备份目录 `.rvguarder-migration-<timestamp>/`）。

### 6.4 回滚

停止测试宿主与后端 → `npm plugin --profile <p> add`（旧 rc.2 tgz，依赖回退为普通依赖）→ 用备份目录恢复 `package.json` 与 `cordis.patch.yml`（恢复旧 insert 行）→ 重启核对单一守卫。无持久格式变化：`owner.lock`/outbox/审计历史格式未动，无需清空状态。

## 7. 验证结果汇总（第 12 节顺序）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 插件类型/构建 | `npm --prefix dshRVguarder run check` | ✅ tsc(服务端) + tsc(客户端 tsconfig.client.json) + verify-client-shape 全过 |
| 插件 Node 测试 | `node --test tests/plugin.test.mjs tests/management.test.mjs tests/migrate.test.mjs` | ✅ **24/24**（核心 12 + 管理 9 + 迁移 3）；controlled.test.mjs 的真实代码工具沙箱用例为已知环境限制（沙箱不可用跳过，未计入） |
| Python DSH/UI | `python -m pytest tests/test_dsh_adapter.py tests/test_ui_asset_delivery.py -q` | ✅ **57 通过 / 1 环境失败**（`test_symlink_cannot_smuggle_host_file_into_wheel`：本执行上下文禁止 `mklink /J`，测试文件本轮未改动；非回归） |
| Python 共享核心组 | pytest（policy_decision_adapter、runtime_verification、rv_dsl、tool_hook_bridge、hook_silent_passthrough、frontend 契约×2） | ✅ **67/67** |
| 独立 DSH 工作台 E2E | `npx playwright test --config playwright.dsh.config.cjs` | ✅ **4/4**（登录清 token 片段、79 条 PMKB、扫描/报告/语义、原生审批只读、隐藏不支持控件） |
| OpenClaw 工作台 E2E | `npx playwright test --project=chromium` | ✅ **6/6**（transport 重构未破坏独立 HTTP 路径） |
| 宿主内嵌 E2E | `npx playwright test --config playwright.embedded.config.cjs` | ✅ **6/6**（详见 7.1） |
| 真实 rc.3 宿主验证 | `powershell scripts/verify-rc3-ui.ps1`（+ `verify-rc3-client.ps1`） | ✅ 见 7.2 |
| E2E 环境 | 系统 Chrome（`channel:'chrome'`）；Chromium/Firefox headless 需 `npm run install:browsers` | 已在 config 注明 |

### 7.1 宿主内嵌 E2E（`e2e/tests/dsh-embedded-settings.spec.cjs`，Chrome）

1. 设置显示 RVguarder 段 + 内嵌管理视图结构 ✅
2. 概览显示真实后端连接（"已连接"、"请在 DSH 原生窗口进行工具审批"）✅
3. 局部页签导航不改宿主 pathname（审计 → 概览往返）✅
4. 调用与审批页：列表/空态 + 无自建批准按钮（`.approve-action` count 0）✅
5. 扫描页可运行基线；审计页显示链完整性 ✅
6. 关闭设置卸载内嵌应用、样式表移除（`#rvguarder-embedded-styles` count 0）✅

### 7.2 真实 rc.3 宿主验证（`runtime/native-rc3-ui-verify/result.json`，脱敏）

- 安装：exit 0，无 "declares no dsh.bundle"，manifest bundles 含 `dsh-rvguarder`。
- `pluginManager.listBundles` → `dsh-rvguarder@0.2.0-rc.3`：`installed/enabled=true`、`availability='profile'`、`error=null`（含中英文 meta、双行 rows）。
- `pluginInventory.list` → `rvguarder-dsh` 与 `rvguarder-admin` 均 `phase:'active'`。
- `rvguarderAdmin/overview`（浏览器 cookie 认证 RPC）→ `ok:true`，`backend:{online:true, instanceId:'rc3-ui', sdkVersion:'0.2.1-rc.3'}`；`settings/paths` 字段未离开宿主（`hasSettingsLeak:false`）。
- 匿名同请求 → **HTTP 401**。
- 核心握手：`hook.active=true`、`sdk=0.2.1-rc.3`、协议 `dsh-guard-v2`。
- boot graph：`dsh-rvguarder/client.js` 进入 `application` 批次；`/plugins/??dsh-rvguarder/client.js&rev=...` 拉取 122,684 字节并注册 `__ModuleLoader__`。
- 截图与文本证据：`runtime/ui-integration-evidence/`（01 shell、02 插件页、03 设置→RVguarder 概览、04 审计、05 调用审批、text-evidence.txt 全量 RPC JSON）。

### 7.3 rc.2 核心兼容范围说明

本轮声明继续支持 rc.2/rc.3（`engines.dsh`、`sdk.ts` 校验未动）。**核心兼容回归证据**沿用已记录基线（Windows 原生专项 112 passed、共享分组 92 项核对，见 [windows-native-rc3.md](windows-native-rc3.md)）；本机当前只安装 rc.3，**rc.2 上的 UI 兼容范围未实测**。预期内嵌 UI 需 rc.3：`settings.section` 插槽、`$mount` 严格 codec、客户端 seed 清单均按 rc.3 核对；若需 rc.2 支持，须在其安装上复跑 7.1/7.2 同套验证。未实测不写成已支持。

## 8. 第 13 节验收清单（DSH 自测结果，供 Codex 复核）

| 编号 | 自测结论 | 证据 |
| --- | --- | --- |
| UI-01 | **通过** | `result.json` bundle 字段 + 截图 02 + text-evidence（listBundles/inventory JSON） |
| UI-02 | **通过** | E2E #1/#2（Account→Settings→RVguarder，无外部浏览器/无 Guard token 输入）+ 截图 03 |
| UI-03 | **通过** | E2E #2/#4/#5（概览连接、审批记录只读、扫描运行、审计链）+ `rvguarderAdmin/*` RPC；报告/审计导出经 Blob 下载通道交付 |
| UI-04 | **通过** | E2E #3/#6（pathname 不变、卸载无残留样式）；主题/语言跟随宿主令牌（zh 词典注册） |
| UI-05 | **部分通过** | 离线横幅+重连（E2E 概览轮询路径）；401/后端错误经管理方法 code 呈现；**未做**注入式故障矩阵（过期连接/跨实例/恢复锁定的浏览器级注入未自动化，恢复锁定有宿主侧核心回归与 `owner.lock` 实测行为佐证） |
| SEC-01 | **通过** | tgz 扫描仅 React 内部符号；webclient 无 tokenFile/状态路径；RPC 概览 `hasSettingsLeak:false` |
| SEC-02 | **通过** | `requireOwner` 全方法强制 + 管理 Node 测试（非 owner principal → `rvguarder/not-owner`）；匿名 RPC 401（真实宿主）；方法表是固定清单（测试断言 `hello/before/...` 不存在） |
| SEC-03 | **通过** | 清单无审批代理/执行证据写入/授权签发/任意路径；`auditExport/report` 仅受控枚举格式；后端新增端点固定文件名+大小上限 |
| LIFE-01 | **通过** | 核心与管理分条目（管理失败不影响核心，真实宿主双 active）；E2E #6 卸载清理样式表；React StrictMode 双挂载幂等 dispose；插件 Node 回归 12/12 |
| MIG-01 | **通过** | 迁移 3 测试（身份/令牌/历史保留、幂等、坏形状拒绝）；真实迁移步骤含备份目录 |
| PKG-01 | **通过** | `npm pack --dry-run` 清单；tgz → 隔离 DSH_HOME 安装加载（verify-rc3-ui 全链路）；无 dev server/CDN/DSH 源码路径依赖 |
| REG-01 | **通过** | 独立 DSH E2E 4/4、OpenClaw E2E 6/6、共享核心 67/67、DSH/UI 57 通过（1 环境跳过项列明：mklink junction 沙箱限制，非本轮改动） |
| DOC-01 | **完成** | 本报告 + README/开发记忆/阶段交接同步（见第 9 节）；未宣称自动启动后端；未触碰规则问题（POL-01/02 保留） |

**自测通过是交付证据，最终结论以 Codex 独立审查为准。** UI-05 标注的故障注入矩阵与 rc.2 UI 实测为本轮明确的"待验收"缺口，未用 mock 充数。

## 9. 文档与剩余问题

- 本文件：`dshRVguarder/docs/ui-integration-implementation.md`。
- 同步更新：中英 README、`dshRVguarder/README.md`、`docs/dev/frontend.md`、`AGENTS.md` 开发记忆与阶段交接（UX-01/02 标记本轮完成、DEP-01/POL-01/02 保留）。
- 剩余问题（不在本轮）：DSH-DEP-01 整包部署/后端托管；DSH-POL-01/02 规则归因；rc.2 UI 实测；故障注入矩阵自动化；SSE 事件转发（需宿主白名单）。
- 大型产物：`runtime/native-rc3-ui-verify/`（宿主验证）、`runtime/ui-integration-evidence/`（截图+文本证据）、`runtime/embedded/`（内嵌构建中间产物）均在 gitignore 的 `runtime/` 下，本地保留。

## 10. 本地提交

按用户要求直接在 `master` 提交（不新建分支、不推送远程）。提交内容：上述源码/测试/文档改动；`runtime/`、SDK 缓存、tgz、真实 profile、令牌不入 Git。最终 HEAD 见提交后 `git log -1`。
