# 有界任务授权（2026-10-29）

目的：在不放宽未知与证据缺失路径的前提下，降低日常开发任务中的重复审批。

## 适用范围

- 只覆盖 **`file.read` 与 `file.write`**，且必须落在 **工作区**（`scope=workspace`）内、单一目标。
- 只由可信宿主管理入口签发；Agent 参数、文档内容、模型解释都不能签发。
- 绑定 **任务 + 主体 + Agent + 会话 + 工作区**；任一维度不匹配即视为没有授权。
- 任务级有效期，默认 1800 秒，上限 3600 秒；撤销或过期后必须重新决策，重启不恢复。

## 绝不覆盖的情况

| 情况 | 原因 |
| --- | --- |
| 未知工具 / 未映射操作 | `unknown_tool` 不因任务授权放行 |
| 证据缺失、覆盖冲突 | `missing_evidence` 保持审批 |
| 权限差分超出 | `permission_excess` 保持审批 |
| 组合风险 | `combo_risk` 保持审批 |
| RV 或主体 RV 升权 | `rv_escalation` 保持升权 |
| 凭据与受保护文件 | `.env`、`.ssh`、`*.pem`、`.npmrc`、`.kube` 等一律排除 |
| 工作区外、外发、命令执行 | 不在授权范围内 |

实现上只有一种裁决会被降级：**原因码恰好是 `policy_requires_approval`** 的 `file.read`/`file.write`。任何其他原因码都保持原判。

## 使用

```bash
# 为某个任务签发（宿主在原生审批等待期间也可操作）
python -m clawRVguarder.hosts.dsh.grant_cli \
  --project-dir <实例数据目录> --workspace <工作区根> \
  task-issue --task session:<会话ID> --agent <agentID> --session <会话ID> \
  --operations file.read,file.write --ttl 1800

# 查询 / 撤销
python -m clawRVguarder.hosts.dsh.grant_cli --project-dir <数据目录> --workspace <工作区根> task-query
python -m clawRVguarder.hosts.dsh.grant_cli --project-dir <数据目录> --workspace <工作区根> task-revoke --grant-id <ID>
```

`--principal` 默认由实例令牌派生，通常无需手动指定。`--task` 应与宿主登记的任务一致；未登记时使用 `session:<会话ID>`，与证据层的默认口径相同。

## 记录与审计

被任务授权放行的调用在决策记录中体现为：

- `decision.action = allow`
- `decision.deciding_layer = task_grant`
- `decision.dominant_reason = task_grant`
- `metadata.task_grant_id` 记录具体授权

## 测试/构建命令复用

`pytest`、`npm test`、`cargo build` 这类命令会执行任意项目代码，因此**不能**被标记为只读，也不由任务授权覆盖。它们的降审批方式是"每任务首次审批一次，同类命令复用"：

- 首次遇到某类别命令时正常审批；原生审批放行（dispatch）后记录"本任务已批准该类别"。
- 之后的同类命令在同任务、同主体、同 Agent、同会话内复用，`deciding_layer=task_command_reuse`。
- 复用按**命令类别**绑定，不按工具名：`npm test` 的批准不会放行 `cargo test`。
- 类别由确定性分类器识别（`clawRVguarder/policy/command_classes.py`）：只接受已知运行器的固定子命令，且命令中不得出现 `; & | < > $ \`` 或换行。
- 未识别命令（`node app.js`、`make deploy`）、破坏性命令（`rm -rf`）、外发命令一律保持原判。
- 复用有效期默认 1800 秒，与任务授权同量级；撤销任务授权不会自动撤销命令复用，需单独等待过期（后续可合并到同一生命周期）。

实测（11 个代表调用）：无授权 4 allow / 7 ask；仅任务授权 6 / 5；任务授权 + 一次 `npm test` 批准后 **7 allow / 4 ask**。

## 未完成

- PMKB 规则本身的范围修正（例如规则级 purpose/scope 语义）。
- 通用的审批去重（当前只覆盖测试/构建命令类别）。
- 任务授权与 Dashboard 的展示（范围、剩余有效期、已批准的类别）。
- 宿主未提供可信任务标识时的跨任务复用限制已有，但尚无真实任务链路验证。
