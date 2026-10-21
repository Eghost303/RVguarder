"""DSH 受控执行器证据：复用核心内容模型和授权存储，不信任普通工具正文。"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from clawRVguarder.spec.content_receipts import ContentReceipt, ContentVersion, HostContentReceiptAuthority, _canonical, _freeze_bounded_json
from clawRVguarder.spec.read_access_receipts import NativeReadAccessReceipt
from clawRVguarder.spec.host_authorization import HostAuthorizationStore
from clawRVguarder.spec.resource_evidence import HostResourceObserver

CONTROLLED = {"rvguard_read": "file.read", "rvguard_copy": "file.write", "rvguard_transform": "file.write", "rvguard_send": "network.egress"}


def validate_allowlist(value: Any) -> list[str]:
    """只接受宿主显式登记的精确 HTTPS URL；空列表默认拒绝所有外发。"""
    from urllib.parse import urlsplit
    if not isinstance(value, list) or len(value) > 32:
        raise ValueError("invalid_egress_allowlist")
    for url in value:
        if not isinstance(url, str) or len(url) > 2048:
            raise ValueError("invalid_egress_destination")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or "*" in parsed.hostname or not url.startswith("https://") or any(ord(c) <= 32 or ord(c) == 127 for c in url):
            raise ValueError("egress_allowlist_requires_exact_https_urls")
    return list(dict.fromkeys(value))


class SnapshotProposal(BaseModel):
    """由实际执行器持有的有界字节快照，不宣称已成功执行。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    purpose: Literal["dsh_snapshot_v2"]
    snapshot_id: str = Field(min_length=1, max_length=64)
    instance_id: str
    session_id: str
    agent_id: str
    call_id: str
    root_call_id: str
    tool_name: str
    arguments_sha256: str
    source: ContentVersion
    destination: str | None = None
    issued_at_ms: int
    expires_at_ms: int


class DshEvidenceBridge:
    """有限受控工具的签名证据、任务绑定和跨会话内容查询。"""

    decision_preparation = None
    history_preparation = None
    history_recorder = None

    def __init__(self, manager) -> None:
        self.manager = manager
        root = manager.context.paths.runtime_dir / "authorization"
        root.mkdir(mode=0o700, exist_ok=True)
        config_path = manager.context.paths.runtime_dir / "dsh-evidence.json"
        if config_path.is_symlink():
            raise ValueError("evidence_config_must_not_be_symlink")
        config = json.loads(config_path.read_text()) if config_path.exists() else {}
        self.allowlist = validate_allowlist(config.get("egress_allowlist", []))
        self.store = HostAuthorizationStore(root, agent_workspaces=[manager.context.target.workspace_path])
        self.observer = HostResourceObserver({"workspace": manager.context.target.workspace_path})
        self.authority = HostContentReceiptAuthority(self.store, issuer="dsh-controlled-v2", tool_operations=CONTROLLED)
        with manager._journal() as db:
            db.execute("CREATE TABLE IF NOT EXISTS grant_uses (grant_id TEXT PRIMARY KEY, call_key TEXT UNIQUE NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS receipts (call_key TEXT PRIMARY KEY, body TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS access_receipts (call_key TEXT PRIMARY KEY, body TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS tasks (agent TEXT NOT NULL, session TEXT NOT NULL, task TEXT NOT NULL, PRIMARY KEY(agent,session))")

    def status(self) -> dict:
        """只暴露证据能力，不暴露签名密钥。"""
        with self.manager._journal() as db:
            byte_count = db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0]
            access_count = db.execute("SELECT COUNT(*) FROM access_receipts").fetchone()[0]
        return {"content_receipts": byte_count, "access_receipts": access_count, "enabled": True, "tools": CONTROLLED, "signer": "dsh-controlled-v2", "network_executor": "allowlisted_only", "egress_allowlist_count": len(self.allowlist), "ordinary_results": "execution_status_only"}

    def sync_management_audit(self) -> None:
        """将宿主授权管理事件补入主哈希审计链；崩溃重放保留原事件ID。"""
        with self.store._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS dsh_management_audit (id TEXT PRIMARY KEY, event TEXT NOT NULL, body TEXT NOT NULL, time REAL NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)")
            if "delivered" not in {row[1] for row in db.execute("PRAGMA table_info(dsh_management_audit)")}:
                db.execute("ALTER TABLE dsh_management_audit ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0")
            for event_id, event, body, at in db.execute("SELECT id,event,body,time FROM dsh_management_audit WHERE delivered=0 ORDER BY time LIMIT 100").fetchall():
                self.manager.audit_store.append("dsh_host_grant_management", {"event_id": event_id, "event": event, "detail": json.loads(body), "issued_at": at})
                db.execute("UPDATE dsh_management_audit SET delivered=1 WHERE id=?", (event_id,))

    def task(self, request: dict) -> str:
        """仅复用宿主显式登记任务；默认按原始会话隔离。"""
        with self.manager._journal() as db:
            row = db.execute("SELECT task FROM tasks WHERE agent=? AND session=?", (request["agent_id"], request["session_id"])).fetchone()
        return row[0] if row else "session:" + request["session_id"]

    def _signed(self, envelope: dict) -> dict:
        frozen = _freeze_bounded_json(envelope, 16384)
        if not isinstance(frozen, dict) or set(frozen) != {"payload", "signature"} or not isinstance(frozen["signature"], str):
            raise ValueError("invalid_evidence_envelope")
        expected = hmac.new(self.authority._key, _canonical(frozen["payload"]), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, frozen["signature"]):
            raise ValueError("invalid_evidence_signature")
        return frozen["payload"]

    def proposal(self, request: dict) -> SnapshotProposal | None:
        """精确绑定宿主签名快照，未知工具不能借 proposal 获取权限。"""
        envelope = request.get("proposal")
        if request["tool_name"] not in CONTROLLED:
            if envelope is not None:
                raise ValueError("evidence_for_uncontrolled_tool")
            return None
        if envelope is None:
            raise ValueError("controlled_tool_requires_snapshot")
        proposal = SnapshotProposal.model_validate(self._signed(envelope))
        for key in ("instance_id", "session_id", "agent_id", "call_id", "root_call_id", "tool_name"):
            if getattr(proposal, key) != request[key]:
                raise ValueError("snapshot_context_mismatch")
        now = int(time.time() * 1000)
        if not proposal.issued_at_ms <= now < proposal.expires_at_ms or not 0 < proposal.expires_at_ms - proposal.issued_at_ms <= 300000:
            raise ValueError("snapshot_expired")
        digest = hashlib.sha256(_canonical(request["arguments"])).hexdigest()
        if proposal.arguments_sha256 != digest or not proposal.source.full_resource or proposal.source.size_bytes > 262144 or proposal.source.namespace != "workspace":
            raise ValueError("snapshot_arguments_or_resource_mismatch")
        from .adapter import local_path
        if Path(local_path(request["cwd"])).resolve() != self.manager.context.target.workspace_path.resolve():
            raise ValueError("controlled_namespace_requires_declared_workspace_root")
        if proposal.source.resource_id != "workspace:" + str(request["arguments"].get("file_path", "")):
            raise ValueError("snapshot_source_reference_mismatch")
        expected_destination = request["arguments"].get("url") if request["tool_name"] == "rvguard_send" else request["arguments"].get("destination")
        if request["tool_name"] == "rvguard_send" and proposal.destination not in self.allowlist:
            raise ValueError("egress_destination_not_allowlisted")
        if proposal.destination != expected_destination:
            raise ValueError("snapshot_destination_mismatch")
        return proposal

    def authorize(self, request: dict) -> dict | None:
        """每次外发需白名单和当前单次宿主授权；不替代 PMKB/RV 硬拒绝。"""
        self.sync_management_audit()
        proposal = self.proposal(request)
        if proposal is None or request["tool_name"] != "rvguard_send":
            return None
        expected = {"task_id": self.task(request), "principal_id": f"dsh:{self.manager.host_adapter.binding}", "agent_id": request["agent_id"],
                    "session_id": request["session_id"], "run_id": request["root_call_id"]}
        for grant in self.store.query():
            if grant["revoked"] or grant["expired"] or grant.get("dsh_call_id") != request["call_id"] or any(grant["binding"][key] != value for key, value in expected.items()):
                continue
            resource = grant["resource"]
            if (grant["operation"] == "network.egress" and grant["recipient"] == proposal.destination
                    and resource["resource_id"] == proposal.source.resource_id
                    and resource["content_version"] == "sha256:" + proposal.source.sha256 and resource["size_bytes"] == proposal.source.size_bytes):
                with self.manager._journal() as db:
                    if db.execute("SELECT 1 FROM grant_uses WHERE grant_id=?", (grant["id"],)).fetchone():
                        raise ValueError("egress_grant_already_consumed")
                return {"grant_id": grant["id"], "snapshot_id": proposal.snapshot_id}
        raise ValueError("controlled_egress_requires_current_exact_host_grant")

    def verify_result(self, request: dict, envelope: dict | None, *, succeeded: bool, dispatched: bool) -> ContentReceipt | None:
        """验证实际字节收据，先验证再提交成功历史。"""
        if envelope is None:
            if succeeded and request["tool_name"] in CONTROLLED:
                raise ValueError("controlled_success_requires_receipt")
            return None
        signed_payload = self._signed(envelope)
        if signed_payload.get("kind") == "read_access":
            if not succeeded or not dispatched or request["tool_name"] != "read":
                raise ValueError("access_receipt_without_successful_read")
            receipt = NativeReadAccessReceipt.model_validate(signed_payload)
            expected = {"issuer": "dsh-controlled-v2", "principal_id": f"dsh:{self.manager.host_adapter.binding}", "agent_id": request["agent_id"],
                        "session_id": request["session_id"], "run_id": request["root_call_id"], "tool_call_id": request["call_id"],
                        "task_id": self.task(request), "arguments_sha256": hashlib.sha256(_canonical(request["arguments"])).hexdigest()}
            from .adapter import local_path
            if (any(getattr(receipt, key) != value for key, value in expected.items())
                    or receipt.accessed_resource.resource_id != "workspace:" + str(request["arguments"].get("file_path", ""))
                    or Path(local_path(request["cwd"])).resolve() != self.manager.context.target.workspace_path.resolve()):
                raise ValueError("native_access_context_mismatch")
            return receipt
        if not succeeded or not dispatched or request["tool_name"] not in CONTROLLED:
            raise ValueError("receipt_without_controlled_success")
        receipt = ContentReceipt.model_validate(signed_payload)
        # 补交可以发生在收据过期之后，但签发必须位于该调用的有效快照期间。
        proposal = SnapshotProposal.model_validate(self._signed(request["proposal"]))
        expected = {"issuer": "dsh-controlled-v2", "principal_id": f"dsh:{self.manager.host_adapter.binding}",
                    "agent_id": request["agent_id"], "session_id": request["session_id"], "run_id": request["root_call_id"],
                    "tool_call_id": request["call_id"], "tool_name": request["tool_name"], "task_id": self.task(request),
                    "operation_family": CONTROLLED[request["tool_name"]], "arguments_sha256": proposal.arguments_sha256}
        if any(getattr(receipt, key) != value for key, value in expected.items()) or receipt.inputs != [proposal.source]:
            raise ValueError("receipt_context_or_bytes_mismatch")
        if not proposal.issued_at_ms <= receipt.issued_at_ms <= proposal.expires_at_ms:
            raise ValueError("receipt_outside_snapshot_lifetime")
        kinds = {"rvguard_read": "read", "rvguard_copy": "copy", "rvguard_transform": "transform", "rvguard_send": "egress"}
        if receipt.kind != kinds[request["tool_name"]]:
            raise ValueError("receipt_operation_mismatch")
        if receipt.outputs:
            dest = str(proposal.destination or "").replace("\\", "/")
            if receipt.outputs[0].resource_id != "workspace:" + dest:
                raise ValueError("receipt_output_mismatch")
        return receipt

    def commit(self, request: dict, receipt: ContentReceipt | None) -> None:
        """幂等保存已核验收据，不推断公开分类或自动放行。"""
        if receipt is None:
            return
        key = json.dumps([request["session_id"], request["call_id"]])
        encoded = receipt.model_dump_json()
        table = "access_receipts" if isinstance(receipt, NativeReadAccessReceipt) else "receipts"
        with self.manager._journal() as db:
            old = db.execute(f"SELECT body FROM {table} WHERE call_key=?", (key,)).fetchone()
            if old and old[0] != encoded:
                raise ValueError("receipt_replay_conflict")
            db.execute(f"INSERT OR IGNORE INTO {table} VALUES (?,?)", (key, encoded))

    def history(self, request: dict) -> dict:
        """查询同一可信主体和登记任务的字节关系，不推断分类或授权。"""
        proposal = self.proposal(request)
        if proposal is None:
            return {"status": "no_controlled_snapshot", "witnesses": []}
        task = self.task(request)
        now = int(time.time() * 1000)
        with self.manager._journal() as db:
            records = [ContentReceipt.model_validate_json(row[0]) for row in db.execute("SELECT body FROM receipts ORDER BY rowid DESC LIMIT 4096")]
        target = proposal.source
        keys = {(target.namespace, target.resource_id, target.sha256, target.size_bytes)}
        witnesses, witnessed = [], set()
        for _ in range(16):
            changed = False
            for receipt in records:
                if receipt.task_id != task or receipt.principal_id != f"dsh:{self.manager.host_adapter.binding}":
                    continue
                if not receipt.issued_at_ms <= now < receipt.expires_at_ms or receipt.receipt_id in witnessed:
                    continue
                versions = receipt.outputs if receipt.kind in {"copy", "transform"} else receipt.inputs
                if not any((v.namespace, v.resource_id, v.sha256, v.size_bytes) in keys for v in versions):
                    continue
                witnesses.append({"receipt_id": receipt.receipt_id, "session_id": receipt.session_id, "kind": receipt.kind})
                witnessed.add(receipt.receipt_id)
                for version in receipt.inputs:
                    key = (version.namespace, version.resource_id, version.sha256, version.size_bytes)
                    if key not in keys:
                        keys.add(key)
                        changed = True
            if not changed:
                break
        return {"status": "verified_relations" if witnesses else "no_verified_relation", "witnesses": witnesses,
                "classification_evidence": "not_provided", "decision_eligible": False}

    def submit(self, event, step) -> dict:
        """共享流水线的只读证据适配入口，不降低 PMKB/RV 裁决。"""
        return {"status": "controlled_dsh_bridge", "decision_eligible": False}
