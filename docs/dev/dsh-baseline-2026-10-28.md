# DSH 安全内核改造：测试基线（2026-10-28）

状态：阶段一 P1-0 产物。本文件记录当前 HEAD 上可复现的测试基线、已修复项与剩余产品缺陷，作为后续阶段排期依据。

## 环境

- Windows 11，Python 3.13.12（`.venv` 为工作树 editable 安装），Node.js 24.15.0
- pytest 9.2.0（此前未在任何解释器中安装，也不是声明依赖）
- 复现命令：`python -m pytest -q`

## 基线

| 轮次 | 通过 | 失败 | 跳过 | 耗时 |
|---|---:|---:|---:|---:|
| 首次可运行（含网关探测） | 792 | 22 | 9 | 125 s |
| P0 修复后 | 797 | 21 | 9 | 110 s |
| 测试噪声清理后 | 802 | 13 | 12 | 113 s |
| 产品缺陷修复后 | **823** | **0** | **12** | 106 s |

历史文档记录的 748 / 795 全绿在当前 HEAD 上无法复现，不能作为对照基线。

## 已修复

### 测试基础设施

- `tests/conftest.py`：短路 `discover_openclaw` 的同步端口探测。`build_services` 每次构造原本固定多花约 9.4 秒（`(19001, 18789) × (127.0.0.1, localhost)` 逐个等待套接字超时），823 个用例累加导致套件看起来像挂死。修复后单文件从 86.5 s 降到 4.6 s。**产品行为未改**；`build_services` 在生产启动时仍有同样的 9 秒开销，记为待修项。
- `pyproject.toml`：测试 extra 补上 `pytest`。

### 测试自身缺陷

- `tests/test_sqlalchemy_store.py`：`patch.DEFAULT` 是函数属性，应为 `mock.DEFAULT`。
- `tests/test_policy_security_contracts.py`：Node ESM 在 Windows 上只接受 `file://` URI；子进程输出显式按 UTF-8 解码。
- `tests/test_hook_persistence.py`：读取持久化文件未指定编码，Windows 默认 GBK 解码失败。
- 符号链接用例按平台能力显式 `skip`（见 `tests/platform_support.py`），不再伪装成通过。

### P0 建模缺陷（已修）

| 缺陷 | 位置 | 修复 |
|---|---|---|
| 工作目录被当作资源目标，污染 `target_paths` 与 scope | `clawRVguarder/integrations/tool_hook_bridge.py` | 新增 `WORKING_DIRECTORY_KEYS`，cwd 不再进入 `_collect_paths` |
| URL 目的地被拼成相对路径，scope 恒为 `workspace` | `clawRVguarder/engine/pipeline.py` | `_classify_scope` 在路径解析前判定 `http(s)` 为 `external` |
| Windows 反斜杠路径被 `shlex` 吃掉，只读命令落到 workspace 自动放行 | `clawRVguarder/engine/command_safety.py` | `_raw_windows_path_hints` 从原始命令补回绝对路径 |
| DSH 的 Guard 数据目录被登记为 `managed_project`，读取令牌可走只读自动放行 | `clawRVguarder/engine/pipeline.py` | DSH 宿主不传 `project_dir` 作为受管根 |
| dispatch 确认丢失被当成不一致结果，409 使 outbox 永久阻塞 | `clawRVguarder/hosts/dsh/services.py` | 服务端已派发而客户端报未派发时记 `outcome_unknown`：不扩充成功历史，允许排空；`succeeded=true` 仍拒绝 |

回归用例：`tests/test_dsh_security_regressions.py`（4 项）、`tests/test_dsh_dispatch_outcome.py`（2 项）。

### P0 配套调整

- `dshRVguarder/src/client.ts`：`post()` 支持单独的超时预算；`dispatch` 用 30 秒（默认 5 秒），降低"再评估期间客户端先超时"的概率。
- 服务端再评估**仍在 `bridge_lock` 内**。将其移出需要并发安全验证，暂缓；当前靠 30 秒预算 + `outcome_unknown` 兜底。

## 产品缺陷（已修复）

| # | 位置 | 现象 | 修复 |
|---|---|---|---|
| 1 | `clawRVguarder/storage/db_store.py:735` | `sqlalchemy_inspect(engine)` 在另一连接上反射 `audit_log`，创建事务未提交 → `NoSuchTableError` | 改为 `sqlalchemy_inspect(conn)`，绑定当前事务连接；文件型 SQLite 改用 `NullPool` 释放文件句柄 |
| 2 | `clawRVguarder/integrations/host_authorization_bridge.py:73-81` | `os.getuid`/`st_uid`/`O_NOFOLLOW` 在 Windows 不可用，私有配置校验直接抛 `AttributeError` | 改用跨平台 `private_file`：POSIX 校验属主与权限位，Windows 校验真实 DACL 并拒绝重解析点与硬链接；仍保持 fail-closed |
| 3 | `clawRVguarder/engine/approval.py:132-141` | `shlex` 剥掉 Windows 路径反斜杠后冒号被当成远程/凭据分隔符，导致 `allow-always` 永久不可选 | 盘符路径参数先于命令行启发式判定为非敏感目标；`_path_has_sensitive_segment` 与多冒号值仍拦截 |
| 4 | `clawRVguarder/integrations/hook_runtime.py:105-110,149-154` | 陈旧插件路径按 `/runtime/...` 匹配且只认平台临时目录，Windows 反斜杠与 `/tmp` 都不命中 | 后缀比较分隔符无关；`_is_transient_path` 增加 POSIX 临时根识别 |

回归用例：`tests/test_hook_runtime.py` 新增 3 项、`tests/test_checkpoint_upgrade.py` 新增 1 项；`tests/test_sqlalchemy_store.py` 与 `tests/test_host_authorization_bridge.py` 的既有用例被修正为平台无关。

## 环境限制（非产品缺陷）

- Windows 默认不允许创建符号链接（`WinError 1314`），3 个用例已按能力探测跳过。启用开发者模式后可自动恢复执行。

## 尚未验证

- `run_code` / PTC 外层与内层的审批卡计数（代码链已确认两次独立裁决，无测试计量）。
- DSH `0.2.1-rc.2` 的运行时管线顺序；当前仅 vendored rc.3 SDK。

## 下一步

1. 进入阶段一的逐调用决策记录与原因码埋点。
