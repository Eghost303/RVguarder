"""本机宿主单次外发授权管理；不对浏览器或 Agent 暴露签发接口。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import time
from uuid import uuid4

from clawRVguarder.spec.host_authorization import HostAuthorizationStore, TaskBinding
from clawRVguarder.spec.resource_evidence import HostResourceObserver
from clawRVguarder.utils import sha256_text
from .evidence import validate_allowlist


def main(argv: list[str] | None = None) -> int:
    """授权库独立事务允许在原生审批等待时操作，不修改后端调用状态。"""
    parser = argparse.ArgumentParser(prog="dsh-rvguarder-grants")
    parser.add_argument("--project-dir", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("query")
    revoke = commands.add_parser("revoke")
    revoke.add_argument("--grant-id", required=True)
    issue = commands.add_parser("issue")
    for key in ("agent", "session", "task", "run", "call", "path", "recipient"):
        issue.add_argument("--" + key, required=True)
    issue.add_argument("--ttl", type=int, default=300)
    args = parser.parse_args(argv)
    runtime = args.project_dir.resolve() / "runtime"
    workspace = args.workspace.resolve()
    with sqlite3.connect(f"file:{runtime / 'dsh-calls.sqlite3'}?mode=ro", uri=True) as db:
        row = db.execute("SELECT value FROM metadata WHERE key='binding'").fetchone()
        state = json.loads(row[0]) if row else {}
        if state.get("protocol") != "dsh-guard-v2" or state.get("workspace") != str(workspace):
            raise ValueError("wrong_instance_or_workspace")
        registered = db.execute("SELECT task FROM tasks WHERE agent=? AND session=?", (getattr(args, "agent", ""), getattr(args, "session", ""))).fetchone()
    store = HostAuthorizationStore(runtime / "authorization", agent_workspaces=[workspace])
    if args.command == "query":
        result = {"grants": store.query()}
    elif args.command == "revoke":
        result = {"revoked": store.revoke(args.grant_id)}
    else:
        config_path = runtime / "dsh-evidence.json"
        if config_path.is_symlink():
            raise ValueError("evidence_config_must_not_be_symlink")
        config = json.loads(config_path.read_text()) if config_path.is_file() else {}
        if args.recipient not in validate_allowlist(config.get("egress_allowlist", [])):
            raise ValueError("recipient_not_in_private_host_allowlist")
        if not 0 < args.ttl <= 300:
            raise ValueError("single_call_grant_ttl_maximum_300_seconds")
        expected_task = registered[0] if registered else "session:" + args.session
        if args.task != expected_task:
            raise ValueError("task_binding_mismatch")
        token_path = runtime / "dsh-token"
        if token_path.is_symlink():
            raise ValueError("invalid_token_path")
        principal = "dsh:" + sha256_text(token_path.read_text().strip())[:32]
        binding = TaskBinding(args.task, principal, args.agent, args.session, args.run)
        result = store.issue(HostResourceObserver({"workspace": workspace}), "workspace", args.path,
                             binding=binding, operation="network.egress", recipient=args.recipient, ttl_seconds=args.ttl)
        result["dsh_call_id"] = args.call
        with store._connect() as db:
            db.execute("UPDATE grants SET payload=? WHERE id=?", (json.dumps(result, sort_keys=True), result["id"]))
    if args.command != "query":
        with store._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS dsh_management_audit (id TEXT PRIMARY KEY, event TEXT NOT NULL, body TEXT NOT NULL, time REAL NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)")
            db.execute("INSERT INTO dsh_management_audit (id,event,body,time) VALUES (?,?,?,?)", (str(uuid4()), args.command,
                        json.dumps({"grant_id": result.get("id", getattr(args, "grant_id", None))}), time.time()))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
