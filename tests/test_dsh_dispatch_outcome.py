"""dispatch 确认丢失后的结果一致性回归。

场景：客户端 dispatch 超时，但服务端已完成派发并消费授权；客户端随后补交
``dispatched=false``。旧行为直接 409，使该条完成事件永久留在 outbox，此后
每次 ``flush`` 都失败，实例全部调用被拒。现在记录为 ``outcome_unknown``：
不扩充成功历史，但允许 outbox 排空。
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from clawRVguarder.hosts.dsh.services import BridgeConflict, DshServices


@pytest.fixture
def dsh(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    home = tmp_path / "home"
    profile = home / "profiles" / "web"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(
        json.dumps({"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base"]}}}), encoding="utf-8"
    )
    (profile / "cordis.patch.yml").write_text("[]", encoding="utf-8")
    with patch("clawRVguarder.services.ensure_runtime_hook_plugin",
               side_effect=AssertionError("OpenClaw install forbidden")):
        manager = DshServices(tmp_path / "guard", dsh_home=home, profile="web",
                              workspace=workspace, semantic_mode="local")
    yield manager, workspace
    manager.close()


def _call(workspace: Path) -> dict:
    return {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
        "tool_name": "write", "cwd": str(workspace),
        "arguments": {"path": str(workspace / "out.txt"), "content": "x"},
    }


def test_lost_dispatch_ack_is_recorded_as_outcome_unknown(dsh) -> None:
    manager, workspace = dsh
    call = _call(workspace)
    assert manager.bridge_before(dict(call))["kind"] == "ask"
    assert manager.bridge_dispatch(dict(call))["ok"] is True

    first = manager.bridge_result(dict(call), succeeded=False, dispatched=False)

    assert first["ok"] is True
    assert first.get("outcome_unknown") is True
    assert manager.recovery_required is False

    payload = manager.host_adapter.payload(dict(call))
    action = manager._find_action_by_hook_key(f"{payload['runId']}:{payload['toolCallId']}")
    assert action is not None
    assert action.execution_state == "unknown"
    assert action.status != "failed"
    assert action.execution_result["status"] == "outcome_unknown"

    duplicate = manager.bridge_result(dict(call), succeeded=False, dispatched=False)
    assert duplicate.get("duplicate") is True
    assert duplicate.get("outcome_unknown") is True


def test_incoherent_success_after_dispatch_is_still_rejected(dsh) -> None:
    """客户端不能借"补交未派发"伪造成功。"""
    manager, workspace = dsh
    call = _call(workspace)
    manager.bridge_before(dict(call))
    manager.bridge_dispatch(dict(call))

    with pytest.raises(BridgeConflict) as excinfo:
        manager.bridge_result(dict(call), succeeded=True, dispatched=False)

    assert "dispatch_evidence_mismatch" in str(excinfo.value)


def test_outcome_unknown_is_counted_separately(dsh) -> None:
    manager, workspace = dsh
    call = _call(workspace)
    manager.bridge_before(dict(call))
    manager.bridge_dispatch(dict(call))
    manager.bridge_result(dict(call), succeeded=False, dispatched=False)

    counts = manager.summary(compact=True)["actions"]["counts"]

    assert counts["unknown"] == 1
    assert counts["executed"] == 0
    assert counts["failed"] == 0


def test_cancelled_before_dispatch_is_not_a_failure(dsh) -> None:
    manager, workspace = dsh
    call = _call(workspace)
    manager.bridge_before(dict(call))
    manager.bridge_result(dict(call), succeeded=False, dispatched=False, cancelled=True)

    payload = manager.host_adapter.payload(dict(call))
    action = manager._find_action_by_hook_key(f"{payload['runId']}:{payload['toolCallId']}")

    assert action.status == "cancelled"
    assert action.execution_state == "not_started"
    counts = manager.summary(compact=True)["actions"]["counts"]
    assert counts["cancelled"] == 1
    assert counts["failed"] == 0
    assert counts["unknown"] == 0


def test_result_route_accepts_cancelled_flag(dsh) -> None:
    from fastapi.testclient import TestClient

    from clawRVguarder.web.app import create_app

    manager, workspace = dsh
    client = TestClient(create_app(manager))
    client.headers["x-rvguarder-token"] = manager.bridge_token
    call = _call(workspace)

    assert client.post("/api/dsh/before", json=call).status_code == 200
    response = client.post("/api/dsh/result", json={
        "call": call, "dispatched": False, "succeeded": False, "cancelled": True})

    assert response.status_code == 200
