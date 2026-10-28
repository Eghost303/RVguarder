"""DSH 共享核心容器：不启动 OpenClaw，提供幂等门禁、审批同步与结果提交。"""
from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from clawRVguarder.config import AppContext, GuardSettings, OpenClawTarget, default_paths
from clawRVguarder.engine.semantic_enhancer import SemanticEnhancer
from clawRVguarder.services import GuardServices
from clawRVguarder.utils import sha256_text, utc_now_iso
from .adapter import DshAdapter, PROTOCOL_VERSION, SUPPORTED_SDK_VERSIONS
from .semantic import DshSemanticEnhancer
from clawRVguarder.storage.private_files import ensure_private_directory, private_file
import os
from contextlib import contextmanager


class BridgeConflict(ValueError):
    """载荷重用、状态冲突或无法恢复的中断必须拒绝。"""


from .observability import DshObservability


class DshServices(DshObservability, GuardServices):
    """隔离一个 DSH 实例的数据；共享 PMKB、RV、语义、审计和 Dashboard API。"""

    def __init__(self, project_dir: Path, *, dsh_home: Path, profile: str, workspace: Path,
                 instance_id: str = "dsh-local", semantic_mode: str = "auto") -> None:
        """初始化失败时立即释放锁，避免半构造对象阻塞后续修复启动。"""
        try:
            self._initialize(project_dir, dsh_home=dsh_home, profile=profile, workspace=workspace,
                             instance_id=instance_id, semantic_mode=semantic_mode)
        except BaseException:
            lease = getattr(self, "_lease", None)
            if lease is not None:
                lease.close()
            journal = getattr(self, "_journal_connection", None)
            if journal is not None:
                journal.close()
            raise

    def _initialize(self, project_dir: Path, *, dsh_home: Path, profile: str, workspace: Path,
                 instance_id: str = "dsh-local", semantic_mode: str = "auto") -> None:
        self.instance_id = instance_id
        self.bridge_lock = threading.RLock()
        if os.environ.get("RVGUARDER_DSH_TIMINGS") == "1":
            from .timing import MeasuredRLock
            self.bridge_lock = MeasuredRLock()
        self.last_seen = 0.0
        self.hello_count = 0
        self.sdk_version: str | None = None
        self.semantic_mode = semantic_mode
        project_dir, workspace = project_dir.resolve(), workspace.resolve()
        if project_dir == workspace or project_dir.is_relative_to(workspace):
            raise ValueError("guard_state_must_be_outside_agent_workspace")
        paths = default_paths(project_dir)
        # Windows 也在任何令牌/密钥产生前建立真实私有 ACL，不使用 chmod 假定隔离。
        ensure_private_directory(paths.runtime_dir)
        paths.ensure()
        from .ownership import DirectoryLease
        self._lease = DirectoryLease(paths.runtime_dir)
        self.semantic_settings_path = paths.runtime_dir / "dsh-settings.json"
        if semantic_mode == "auto" and self.semantic_settings_path.is_file():
            stored = json.loads(self.semantic_settings_path.read_text())
            semantic_mode = stored.get("semantic_mode", "auto")
            if semantic_mode not in {"auto", "local", "llm"}:
                raise ValueError("invalid_persisted_semantic_mode")
        self.semantic_mode = semantic_mode
        token_path = paths.runtime_dir / "dsh-token"
        if token_path.is_symlink():
            raise ValueError("token_path_must_not_be_symlink")
        if not token_path.exists():
            # 独占创建，避免覆盖现有 token；不把 token 放进公开包或日志。
            with private_file(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL) as fd:
                os.write(fd, secrets.token_urlsafe(48).encode("ascii"))
        with private_file(token_path, os.O_RDONLY) as fd:
            self.bridge_token = os.read(fd, 4096).decode("ascii").strip()
        if len(self.bridge_token) < 32:
            raise ValueError("invalid_dsh_token")
        mappings_path = paths.runtime_dir / "dsh-tool-mappings.json"
        if mappings_path.is_symlink():
            raise ValueError("tool_mappings_must_not_be_symlink")
        mappings = json.loads(mappings_path.read_text()) if mappings_path.is_file() else None
        adapter = DshAdapter(instance_id, sha256_text(self.bridge_token)[:32], workspace, token_path, mappings=mappings)
        target = OpenClawTarget(root=dsh_home, config_path=dsh_home / "profiles" / profile / "package.json",
                                workspace_path=workspace, profile=profile)
        super().__init__(AppContext(paths, target, GuardSettings()), host_adapter=adapter)
        from clawRVguarder.storage.db_store import SQLiteStore
        if isinstance(self.audit_store._db, SQLiteStore):
            self.audit_store._db.enable_connection_reuse()
        self.semantic_enhancer = DshSemanticEnhancer(policy_version=self.policy_engine.bundle.version,
            api_key="" if semantic_mode == "local" else None, config_path=paths.runtime_dir / "guard-config.json")
        self.action_service.semantic_enhancer = self.semantic_enhancer
        if semantic_mode == "llm" and not self.semantic_enhancer._llm_enabled:
            raise ValueError("llm_mode_requires_host_api_key")
        self.action_service.host_kind = "dsh"
        self.journal = paths.runtime_dir / "dsh-calls.sqlite3"
        self._journal_lock = threading.RLock()
        self._journal_connection = sqlite3.connect(self.journal, timeout=10, check_same_thread=False)
        # WAL 避免每个桥接事务反复创建/删除回滚日志；FULL 同步仍在返回前落盘。
        self._journal_connection.execute("PRAGMA journal_mode=WAL")
        self._journal_connection.execute("PRAGMA synchronous=FULL")
        with self._journal() as db:
            db.execute("CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, digest TEXT NOT NULL, response TEXT, state TEXT NOT NULL, completion TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            binding = json.dumps({"schema": 2, "protocol": PROTOCOL_VERSION, "instance": instance_id, "workspace": str(workspace), "profile": profile, "dsh_home": str(dsh_home.resolve())}, sort_keys=True)
            prior = db.execute("SELECT value FROM metadata WHERE key='binding'").fetchone()
            if prior and prior[0] != binding:
                raise ValueError("dsh_state_binding_mismatch")
            if not prior and db.execute("SELECT 1 FROM calls WHERE state != 'completed' LIMIT 1").fetchone():
                raise ValueError("drain_legacy_calls_before_v2_upgrade")
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('binding', ?)", (binding,))
            db.execute("CREATE TABLE IF NOT EXISTS degraded (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS probes (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, received REAL NOT NULL)")
        from .evidence import DshEvidenceBridge
        self.evidence = DshEvidenceBridge(self)
        self.host_authorization_bridge = self.evidence
        adapter.probe_provider = self.capabilities
        # 核心初始化已恢复已有 RV 快照；中断中的提交不能默认为成功或自动重跑。
        self.recovery_required = self._interrupted_calls()
        if self.rv_state_path.exists():
            snapshot = json.loads(self.rv_state_path.read_text(encoding="utf-8"))
            if not isinstance(snapshot, dict) or "session_windows" not in snapshot:
                raise ValueError("invalid_dsh_rv_snapshot")

    def close(self) -> None:
        """释放实例所有权；调用者必须先停止 HTTP 服务及所有请求。"""
        with self._journal_lock:
            self._journal_connection.close()
        self.audit_store._db.close()
        self._lease.close()

    @contextmanager
    def _journal(self):
        """在实例内串行复用连接；事务提交/回滚边界保持不变。"""
        with self._journal_lock:
            connection = self._journal_connection
            try:
                yield connection
            except BaseException:
                connection.rollback()
                raise
            else:
                started = time.perf_counter()
                writing = connection.in_transaction
                connection.commit()
                if writing:
                    from .timing import emit_timing
                    emit_timing("journal_commit", started)

    def _interrupted_calls(self) -> bool:
        """检查决策/提交中断标记，阻止不确定状态下继续授权。"""
        with self._journal() as db:
            return db.execute("SELECT 1 FROM calls WHERE state IN ('deciding','completing','dispatched') LIMIT 1").fetchone() is not None

    def touch(self, sdk_version: str) -> dict[str, Any]:
        """认证握手后才声明有插件连入，不据配置存在推测在线。"""
        if sdk_version not in SUPPORTED_SDK_VERSIONS:
            raise BridgeConflict("unsupported_dsh_sdk_version")
        self.evidence.sync_management_audit()
        self.sdk_version, self.last_seen = sdk_version, time.monotonic()
        self.hello_count += 1
        return {"ok": True, "protocol": PROTOCOL_VERSION, "instance_id": self.instance_id,
                "sdk_version": sdk_version, "policy_version": self.policy_engine.bundle.version,
                "recovery_required": self.recovery_required}

    def bridge_before(self, request: dict[str, Any]) -> dict[str, Any]:
        """同一调用只判定一次，冲突载荷及终态重用拒绝。"""
        with self.bridge_lock:
            if self.recovery_required:
                raise BridgeConflict("interrupted_commit_requires_reconciliation")
            self.evidence.proposal(request)
            payload = self.host_adapter.payload(request)
            key = f"{payload['runId']}:{payload['toolCallId']}"
            digest = sha256_text(json.dumps(request, ensure_ascii=False, sort_keys=True))
            with self._journal() as db:
                prior = db.execute("SELECT digest,response,state FROM calls WHERE id=?", (key,)).fetchone()
                if prior:
                    if prior[0] != digest:
                        raise BridgeConflict("call_payload_conflict")
                    if prior[2] != "pending" or not prior[1]:
                        raise BridgeConflict("call_already_terminal_or_interrupted")
                    return json.loads(prior[1])
                # 历史写盘/决策异常保留 deciding，后续请求不能绕过该故障。
                db.execute("INSERT INTO calls(id,digest,state) VALUES(?,?,'deciding')", (key, digest))
            try:
                started = time.perf_counter()
                result = self.handle_before_tool_call(payload)
                from .timing import emit_timing
                emit_timing("decision_and_audit", started)
                record = result["action_record"]
                if request.get("proposal"):
                    action = self._find_action(record["action_id"])
                    action.event.metadata["dsh_content_history"] = self.evidence.history(request)
                    self._replace_action(action)
                kind = {"allow": "allow", "require_approval": "ask", "block": "deny"}[result["action"]]
                message = str(result.get("message") or record.get("decision", {}).get("reason") or "DSH 工具安全检查")
                message = message.replace("OpenClaw", "DSH")
                response = {"protocol": PROTOCOL_VERSION, "instance_id": self.instance_id,
                            "call_id": request["call_id"], "session_id": request["session_id"],
                            "kind": kind, "reason": message[:1024], "action_id": record["action_id"],
                            "policy_version": self.policy_engine.bundle.version,
                            "rule_ids": record.get("decision", {}).get("rule_ids", []),
                            "issued_at": time.time(), "expires_at": time.time() + 300,
                            "evidence_binding": {"principal_id": f"dsh:{self.host_adapter.binding}", "task_id": self.evidence.task(request)}}
                with self._journal() as db:
                    db.execute("UPDATE calls SET response=?,state='pending' WHERE id=?", (json.dumps(response), key))
            except BaseException:
                self.recovery_required = True
                raise
            self.last_seen = time.monotonic()
            return response

    def bridge_result(self, request: dict[str, Any], *, succeeded: bool, dispatched: bool, evidence: dict | None = None) -> dict[str, Any]:
        """幂等提交最终结果；仅实际 dispatch 且成功的工具扩充历史。"""
        with self.bridge_lock:
            payload = self.host_adapter.payload(request)
            key = f"{payload['runId']}:{payload['toolCallId']}"
            completion = json.dumps({"succeeded": succeeded, "dispatched": dispatched, "evidence": evidence}, sort_keys=True)
            with self._journal() as db:
                row = db.execute("SELECT response,state,completion,digest FROM calls WHERE id=?", (key,)).fetchone()
                if not row or row[3] != sha256_text(json.dumps(request, ensure_ascii=False, sort_keys=True)):
                    raise BridgeConflict("completion_context_mismatch")
                if row[1] == "completed":
                    if row[2] != completion:
                        raise BridgeConflict("completion_outcome_conflict")
                    return {"ok": True, "duplicate": True}
                if row[1] not in {"pending", "dispatched"}:
                    raise BridgeConflict("interrupted_commit_requires_reconciliation")
                response = json.loads(row[0])
                if dispatched != (row[1] == "dispatched"):
                    raise BridgeConflict("dispatch_evidence_mismatch")
                if succeeded and (not dispatched or response["kind"] == "deny"):
                    raise BridgeConflict("success_without_execution_permission")
                receipt = self.evidence.verify_result(request, evidence, succeeded=succeeded, dispatched=dispatched)
                db.execute("UPDATE calls SET state='completing' WHERE id=?", (key,))
            try:
                action = self._find_action(response["action_id"])
                if action is None:
                    raise BridgeConflict("action_missing")
                if action.status == "pending_approval":
                    action.status = "executing" if dispatched else "rejected"
                    action.decision_state = "allowed" if dispatched else "denied"
                    action.execution_state = "running" if dispatched else "not_started"
                    action.sync_state = "synced"
                    self._replace_action(action)
                outcome = self.handle_after_tool_call({**payload, "toolResultFailed": not succeeded,
                                                      "error": None if succeeded else "dsh_tool_failed_or_cancelled"})
                if not outcome.get("ok"):
                    raise BridgeConflict(str(outcome.get("error")))
                self.evidence.commit(request, receipt)
                with self._journal() as db:
                    db.execute("UPDATE calls SET state='completed',completion=? WHERE id=?", (completion, key))
            except BaseException:
                self.recovery_required = True
                raise
            if self.recovery_required:
                self.recovery_required = self._interrupted_calls()
            self.last_seen = time.monotonic()
            return {"ok": True, "duplicate": False}

    def bridge_dispatch(self, request: dict[str, Any]) -> dict[str, Any]:
        """宿主原生审批已放行并进入 dispatch 时同步；面板不能调用此操作。"""
        with self.bridge_lock:
            payload = self.host_adapter.payload(request)
            action = self._find_action_by_hook_key(f"{payload['runId']}:{payload['toolCallId']}")
            if action is None or action.status in {"blocked", "rejected", "failed", "executed"}:
                raise BridgeConflict("dispatch_not_permitted")
            # 检查完整请求匹配，禁止以同一 call-id 变更参数。
            with self._journal() as db:
                row = db.execute("SELECT digest,response,state FROM calls WHERE id=?", (action.event.metadata["hook_key"],)).fetchone()
            if not row or row[0] != sha256_text(json.dumps(request, ensure_ascii=False, sort_keys=True)) or row[2] != "pending":
                raise BridgeConflict("dispatch_context_mismatch")
            if json.loads(row[1])["expires_at"] < time.time():
                raise BridgeConflict("decision_expired")
            permit = self.evidence.authorize(request)
            # 审批等待期间可能有其他会话/调用提交成功历史；dispatch 前重新评估。
            from clawRVguarder.engine.pipeline import _annotate_event_context, _apply_rv_if_available
            event = self.host_adapter.build_event(payload, self.context)
            source = self.host_adapter.source_message(event)
            _annotate_event_context(self, event, source_message=source, origin="hook")
            current = self.policy_engine.decide(event, source_message=source)
            current = _apply_rv_if_available(self, event, current)
            reviewed = self.controller.decide(event, current, source)
            original = json.loads(row[1])
            new_rules = set(reviewed.decision.rule_ids) - set(action.decision.rule_ids)
            if reviewed.status == "blocked" or (reviewed.status == "pending_approval" and (original["kind"] == "allow" or new_rules)):
                action.status, action.decision_state, action.execution_state = "blocked", "denied", "not_started"
                action.decision = reviewed.decision
                self._replace_action(action)
                self.audit_store.append("dsh_dispatch_revalidation_denied", {"action_id": action.action_id, "rule_ids": reviewed.decision.rule_ids})
                self.events.publish("action.updated", {"action_id": action.action_id, "status": "blocked"})
                raise BridgeConflict("decision_changed_requires_new_call")
            if action.status == "pending_approval":
                action.status, action.decision_state, action.execution_state = "executing", "allowed", "running"
                action.sync_state = "synced"
                self._replace_action(action)
                self.events.publish("action.resolved", {"action_id": action.action_id, "decision": "allow-once", "host": "dsh"})
                self.audit_store.append("dsh_native_approval", {"action_id": action.action_id, "decision": "allow-once"})
            with self._journal() as db:
                if permit:
                    db.execute("INSERT INTO grant_uses VALUES (?,?)", (permit["grant_id"], action.event.metadata["hook_key"]))
                db.execute("UPDATE calls SET state='dispatched' WHERE id=?", (action.event.metadata["hook_key"],))
            if permit:
                self.audit_store.append("dsh_host_grant_consumed", {"grant_id": permit["grant_id"], "call_id": request["call_id"]})
            return {"ok": True, "permit": permit}

    def hook_status(self) -> dict[str, Any]:
        """最近认证心跳判断桥接在线，恢复未确认状态单独报告。"""
        active = bool(self.last_seen and time.monotonic() - self.last_seen < 45)
        return {"host": "dsh", "instance_id": self.instance_id, "active": active,
                "state": "active" if active else "runtime_unreachable", "installed": bool(self.sdk_version),
                "sdk_version": self.sdk_version, "hello_count": self.hello_count, "recovery_required": getattr(self, "recovery_required", False),
                "error_detail": None if active else "等待 DSH 插件认证握手。"}

    def chat_status(self):
        """DSH 宿主不使用 OpenClaw Gateway/chat relay。"""
        active = self.hook_status()["active"]
        return SimpleNamespace(connected=active, to_dict=lambda: {"connected": active, "connection_state": "connected" if active else "disconnected", "host": "dsh"})

    def summary(self, *, compact: bool = False) -> dict[str, Any]:
        """复用面板数据，明确宿主及语义模式。"""
        result = super().summary(compact=compact)
        result["host"] = {"kind": "dsh", "instance_id": self.instance_id, "profile": self.context.target.profile}
        result["capabilities"] = self.capabilities()
        result["semantic"] = {"configured_mode": self.semantic_mode, "llm_enabled": self.semantic_enhancer._llm_enabled,
                              "fallback": "local", "model": self.semantic_enhancer.model,
                              "last_llm_status": next((a.event.metadata.get("semantic_audit", {}).get("llm_status") for a in reversed(self._load_actions()) if a.event.metadata.get("semantic_audit")), "not_run")}
        return result

    def _mark_orphaned_previous_actions(self, session_id: str) -> None:
        """DSH 并发和原生审批可能超过 30 秒，不套用 OpenClaw 孤儿超时。"""

    def refresh_runtime_target(self) -> dict[str, Any]:
        """不执行 OpenClaw 发现或写配置。"""
        return self.hook_status()

    def clear_actions(self) -> dict[str, Any]:
        """DSH 调用日志依赖动作证据，禁止面板删除待提交或可恢复记录。"""
        raise PermissionError("dsh_actions_retained_for_completion_recovery")

    def load_runtime_config(self) -> dict[str, Any]:
        """DSH 配置仅由宿主管理，兼容面板技能/频道只读空列表。"""
        return {}

    def save_runtime_config(self, payload: dict[str, Any]) -> None:
        """禁止旧面板 OpenClaw 配置写入 DSH profile。"""
        raise PermissionError("dsh_configuration_owned_by_host")
