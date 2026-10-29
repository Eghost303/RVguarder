"""有界任务授权：由宿主显式签发、绑定单一任务、只覆盖工作区普通读写。

设计约束（来自计划第三阶段）：

- 授权由可信宿主管理入口签发；Agent 参数、文档内容与模型解释都不能签发。
- 排除项优先于范围授权：凭据文件、Guard 状态目录、宿主配置、外发能力
  一律不因"开发任务"标签获得权限。
- 授权只在任务存续期内有效；撤销或过期后必须重新决策。
- 授权不得绕过未知工具、缺失证据、权限差分、组合风险与 RV 升权；
  调用方（pipeline）负责只对"纯粹因策略要求审批"的裁决应用本授权。
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from clawRVguarder.storage.private_files import ensure_private_directory

TaskOperation = Literal["file.read", "file.write"]
TASK_OPERATIONS = frozenset({"file.read", "file.write"})
MAX_TTL_SECONDS = 3600

# 这些路径既不随任务授权放行，也不因范围匹配而覆盖。
_EXCLUDED_SEGMENTS = frozenset({
    ".ssh", ".aws", ".gnupg", "secrets", "secret", "credentials", "credential",
    "id_rsa", "id_ed25519", "authorized_keys", ".kube", ".git", ".dsh", ".rvguarder",
})
_EXCLUDED_NAMES = frozenset({".env", ".envrc", ".npmrc", ".netrc", ".pypirc", ".pgpass",
                             "cordis.patch.yml", "openclaw.json", "guard-config.json",
                             ".bashrc", ".bash_profile", ".profile", ".zshrc"})
_EXCLUDED_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".kdb", ".jks")


class TaskGrant(BaseModel):
    """一个任务级授权；只表达"本任务内在该工作区做普通读写"。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    grant_id: str
    task_id: str = Field(min_length=1, max_length=512)
    principal_id: str = Field(min_length=1, max_length=512)
    agent_id: str = Field(min_length=1, max_length=512)
    session_id: str = Field(min_length=1, max_length=512)
    scope: Literal["workspace"] = "workspace"
    operations: list[TaskOperation] = Field(default_factory=list, max_length=2)
    workspace_root: str = Field(min_length=1, max_length=4096)
    issued_at: float
    expires_at: float
    revoked: bool = False
    runtime_id: str = ""


def is_excluded_path(path: str) -> bool:
    """凭据与受保护文件不随任何任务授权放行。"""
    normalized = str(path or "").replace("\\", "/").lower()
    if not normalized:
        return True
    name = normalized.rsplit("/", 1)[-1]
    if name in _EXCLUDED_NAMES or name.startswith(".env."):
        return True
    if any(name.endswith(suffix) for suffix in _EXCLUDED_SUFFIXES):
        return True
    parts = normalized.split("/")
    return any(segment in _EXCLUDED_SEGMENTS for segment in parts) or "/.config/gh/" in "/" + normalized + "/"


class TaskAuthorizationStore:
    """任务授权的持久存储；签发与撤销只经由本机管理入口。"""

    def __init__(self, root: Path) -> None:
        ensure_private_directory(root)
        self.path = root / "task-grants.sqlite3"
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS task_runtime (id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS task_grants ("
                "grant_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS task_command_approvals ("
                "approval_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, principal_id TEXT NOT NULL,"
                "agent_id TEXT NOT NULL, session_id TEXT NOT NULL, command_class TEXT NOT NULL,"
                "expires_at REAL NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def begin_runtime(self) -> str:
        """在独占服务启动时更新授权世代；旧许可保留审计但不再匹配。"""
        epoch = str(uuid4())
        with self._connect() as db:
            db.execute("INSERT OR REPLACE INTO task_runtime VALUES (1,?)", (epoch,))
        return epoch

    def issue(self, *, task_id: str, principal_id: str, agent_id: str, session_id: str,
              workspace_root: Path, operations: Iterable[str], ttl_seconds: int) -> dict[str, Any]:
        if not 0 < int(ttl_seconds) <= MAX_TTL_SECONDS:
            raise ValueError("task_grant_ttl_out_of_range")
        ops = sorted(set(operations))
        if not ops or not set(ops) <= TASK_OPERATIONS:
            raise ValueError("unsupported_task_operation")
        now = time.time()
        with self._connect() as db:
            runtime = db.execute("SELECT epoch FROM task_runtime WHERE id=1").fetchone()
        if not runtime:
            raise ValueError("task_runtime_not_started")
        grant = TaskGrant(
            grant_id=str(uuid4()), task_id=task_id, principal_id=principal_id,
            agent_id=agent_id, session_id=session_id, operations=ops,
            workspace_root=str(workspace_root.resolve()), issued_at=now, expires_at=now + int(ttl_seconds),
            runtime_id=runtime[0],
        )
        with self._connect() as db:
            db.execute("INSERT INTO task_grants VALUES (?,?,?)",
                       (grant.grant_id, grant.task_id, grant.model_dump_json()))
        return grant.model_dump()

    def revoke(self, grant_id: str) -> bool:
        with self._connect() as db:
            row = db.execute("SELECT body FROM task_grants WHERE grant_id=?", (grant_id,)).fetchone()
            if not row:
                return False
            grant = TaskGrant.model_validate_json(row[0])
            grant = grant.model_copy(update={"revoked": True})
            db.execute("UPDATE task_grants SET body=? WHERE grant_id=?",
                       (grant.model_dump_json(), grant_id))
        return True

    def end_task(self, *, task_id: str, agent_id: str, session_id: str) -> int:
        """可信管理入口结束任务时撤销其许可，保留历史记录。"""
        count = 0
        with self._connect() as db:
            for row in db.execute("SELECT body FROM task_grants WHERE task_id=?", (task_id,)).fetchall():
                grant = TaskGrant.model_validate_json(row[0])
                if grant.agent_id == agent_id and grant.session_id == session_id and not grant.revoked:
                    grant = grant.model_copy(update={"revoked": True})
                    db.execute("UPDATE task_grants SET body=? WHERE grant_id=?", (grant.model_dump_json(), grant.grant_id))
                    count += 1
        return count

    def query(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT body FROM task_grants ORDER BY rowid DESC").fetchall()
        return [TaskGrant.model_validate_json(row[0]).model_dump() for row in rows]

    def match(self, *, task_id: str, principal_id: str, agent_id: str, session_id: str,
              operation: str, scope: str, path: str, workspace_root: Path) -> dict[str, Any] | None:
        """返回覆盖本次调用的授权；任一维度不匹配即视为没有授权。"""
        if operation not in TASK_OPERATIONS or scope != "workspace":
            return None
        if is_excluded_path(path):
            return None
        now = time.time()
        with self._connect() as db:
            runtime = db.execute("SELECT epoch FROM task_runtime WHERE id=1").fetchone()
            rows = db.execute("SELECT body FROM task_grants WHERE task_id=?", (task_id,)).fetchall()
        if not runtime:
            return None
        for row in rows:
            grant = TaskGrant.model_validate_json(row[0])
            if (grant.revoked or grant.expires_at <= now or grant.runtime_id != runtime[0]
                    or grant.principal_id != principal_id
                    or grant.agent_id != agent_id
                    or grant.session_id != session_id
                    or operation not in grant.operations):
                continue
            try:
                root = Path(grant.workspace_root).resolve()
                if root != Path(workspace_root).resolve():
                    continue
                candidate = Path(path)
                if not candidate.is_absolute():
                    # 工具参数常是工作区相对路径；不能按进程 cwd 解析。
                    candidate = root / candidate
                resolved = candidate.resolve()
                resolved.relative_to(root)
                if is_excluded_path(str(resolved)):
                    continue
            except (OSError, ValueError):
                continue
            return grant.model_dump()
        return None

    def record_command_approval(self, *, task_id: str, principal_id: str, agent_id: str,
                                session_id: str, command_class: str,
                                ttl_seconds: int = 1800) -> None:
        """记录"本任务内该类别命令已被批准"；只按类别复用，不按工具名。"""
        if not task_id or not command_class:
            raise ValueError("invalid_command_approval")
        if not 0 < int(ttl_seconds) <= MAX_TTL_SECONDS:
            raise ValueError("command_approval_ttl_out_of_range")
        key = "|".join([task_id, principal_id, agent_id, session_id, command_class])
        with self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO task_command_approvals VALUES (?,?,?,?,?,?,?)",
                (key, task_id, principal_id, agent_id, session_id, command_class,
                 time.time() + int(ttl_seconds)),
            )

    def match_command_approval(self, *, task_id: str, principal_id: str, agent_id: str,
                               session_id: str, command_class: str) -> bool:
        key = "|".join([task_id, principal_id, agent_id, session_id, command_class])
        with self._connect() as db:
            row = db.execute(
                "SELECT expires_at FROM task_command_approvals WHERE approval_key=?", (key,)
            ).fetchone()
        return bool(row and row[0] > time.time())

    def active_command_approvals(self) -> list[dict[str, Any]]:
        """未过期的命令复用记录，供面板只读展示。"""
        now = time.time()
        with self._connect() as db:
            rows = db.execute(
                "SELECT task_id, principal_id, agent_id, session_id, command_class, expires_at"
                " FROM task_command_approvals WHERE expires_at > ? ORDER BY expires_at",
                (now,),
            ).fetchall()
        return [
            {"task_id": row[0], "principal_id": row[1], "agent_id": row[2],
             "session_id": row[3], "command_class": row[4],
             "expires_at": row[5], "remaining_seconds": int(row[5] - now)}
            for row in rows
        ]
