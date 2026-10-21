"""DSH 离线维护：独占实例检查和确认后的完成事件补交，不重跑工具。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from clawRVguarder.spec.host_authorization import TaskBinding
from .services import DshServices


def main(argv: list[str] | None = None) -> int:
    """仅提供本地状态检查、完成事件重放和任务绑定，不签发外发授权。"""
    parser = argparse.ArgumentParser(prog="dsh-rvguarder-maintenance")
    for flag in ("project-dir", "dsh-home", "workspace"):
        parser.add_argument("--" + flag, type=Path, required=True)
    for flag in ("profile", "instance-id"):
        parser.add_argument("--" + flag, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("inspect")
    replay = commands.add_parser("reconcile")
    replay.add_argument("--completion", type=Path, required=True)
    replay.add_argument("--confirm", action="store_true", required=True)
    task = commands.add_parser("bind-task")
    for flag in ("agent", "session", "task"):
        task.add_argument("--" + flag, required=True)
    args = parser.parse_args(argv)
    manager = DshServices(args.project_dir, dsh_home=args.dsh_home, workspace=args.workspace,
                          profile=args.profile, instance_id=args.instance_id, semantic_mode="local")
    try:
        if args.command == "inspect":
            with manager._journal() as db:
                rows = db.execute("SELECT id,state FROM calls WHERE state != 'completed'").fetchall()
            result = {"protocol": "dsh-guard-v2", "recovery_required": manager.recovery_required,
                      "calls": [{"id": row[0], "state": row[1]} for row in rows], "audit": manager.audit_store.verify_chain()}
        elif args.command == "reconcile":
            from .http import Completion
            if args.completion.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("completion_file_too_large")
            event = Completion.model_validate_json(args.completion.read_text())
            result = manager.bridge_result(event.call.model_dump(exclude_none=True), succeeded=event.succeeded,
                                           dispatched=event.dispatched, evidence=event.evidence)
            manager.audit_store.append("dsh_operator_reconciliation", {"call_id": event.call.call_id, "succeeded": event.succeeded})
        else:
            binding = TaskBinding(args.task, f"dsh:{manager.host_adapter.binding}", args.agent, args.session)
            binding.validate()
            with manager._journal() as db:
                if db.execute("SELECT 1 FROM calls WHERE state != 'completed' LIMIT 1").fetchone():
                    raise ValueError("drain_calls_before_changing_task_binding")
                db.execute("INSERT OR REPLACE INTO tasks VALUES (?,?,?)", (args.agent, args.session, args.task))
            manager.audit_store.append("dsh_task_binding", binding.__dict__)
            result = {"bound": True}
        print(json.dumps(result, ensure_ascii=False, default=str))
    finally:
        manager.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
