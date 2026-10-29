"""委派链记录与"子调用不继承父授权"的回归。"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from clawRVguarder.hosts.dsh.adapter import DshAdapter
from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.web.app import create_app


def _call(tool: str, arguments: dict, workspace: Path, **overrides) -> dict:
    call = {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "child-session", "agent_id": "child-session",
        "call_id": "child-call", "root_call_id": "root-call",
        "tool_name": tool, "cwd": str(workspace), "arguments": arguments,
    }
    call.update(overrides)
    return call


def test_child_call_records_ordered_lineage_and_delegation(tmp_path: Path) -> None:
    adapter = DshAdapter("dsh-local", "binding", tmp_path, tmp_path / "token")
    payload = adapter.payload(_call(
        "read", {"file_path": "notes.md"}, tmp_path,
        parent_call_id="parent-call", parent_agent_id="parent-agent",
    ))
    event = adapter.build_event(payload, None)

    identity = event.metadata["trusted_identity"]
    assert identity["capability_lineage"] == ["dsh-agent:parent-agent", "dsh-agent:child-session"]
    assert identity["delegation"]["state"] == "declared"
    assert identity["delegation"]["parent_call_id"] == "parent-call"
    assert identity["delegation"]["scope"] is None


def test_root_call_has_no_delegation(tmp_path: Path) -> None:
    adapter = DshAdapter("dsh-local", "binding", tmp_path, tmp_path / "token")
    payload = adapter.payload(_call("read", {"file_path": "notes.md"}, tmp_path))
    event = adapter.build_event(payload, None)

    identity = event.metadata["trusted_identity"]
    assert identity["delegation"]["state"] == "unrecorded"
    assert identity["capability_lineage"] == ["dsh-instance:dsh-local"]


@pytest.fixture
def dsh(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / ".env").write_text("TOKEN=secret", encoding="utf-8")
    home = tmp_path / "home"
    profile = home / "profiles" / "web"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(
        json.dumps({"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base"]}}}), encoding="utf-8")
    (profile / "cordis.patch.yml").write_text("[]", encoding="utf-8")
    with patch("clawRVguarder.services.ensure_runtime_hook_plugin", side_effect=AssertionError("no")):
        manager = DshServices(tmp_path / "guard", dsh_home=home, profile="web",
                              workspace=workspace, semantic_mode="local")
    client = TestClient(create_app(manager))
    client.headers["x-rvguarder-token"] = manager.bridge_token
    yield manager, client, workspace
    manager.close()


def test_child_call_does_not_inherit_parent_authority(dsh) -> None:
    """子调用即使声明了父调用，也必须重新走完整策略。"""
    manager, client, workspace = dsh
    response = client.post("/api/dsh/before", json=_call(
        "read", {"file_path": ".env"}, workspace,
        parent_call_id="parent-call", parent_agent_id="parent-agent",
    ))

    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "ask"

    record = manager._find_action(body["action_id"]).event.metadata["decision_record"]
    assert record["call"]["delegation"]["state"] == "declared"
    assert record["principal"]["lineage"] == ["dsh-agent:parent-agent", "dsh-agent:child-session"]
