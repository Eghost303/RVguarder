"""有界任务授权：只覆盖工作区普通读写，绝不绕过未知与危险路径。"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.spec.task_authorization import (
    TaskAuthorizationStore, is_excluded_path,
)
from clawRVguarder.web.app import create_app


@pytest.fixture
def dsh(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "notes.md").write_text("# notes\n", encoding="utf-8")
    (workspace / ".env").write_text("TOKEN=x", encoding="utf-8")
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


def _call(workspace: Path, tool: str, arguments: dict, *, call_id: str = "c1") -> dict:
    return {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": call_id, "root_call_id": call_id,
        "tool_name": tool, "cwd": str(workspace), "arguments": arguments,
    }


def _issue(manager: DshServices, workspace: Path, *, operations=None, ttl: int = 1800) -> dict:
    return manager.task_authorization.issue(
        task_id="session:s1",
        principal_id=f"dsh:{manager.host_adapter.binding}",
        agent_id="dsh-instance:dsh-local",
        session_id="s1",
        workspace_root=workspace,
        operations=operations or ["file.read", "file.write"],
        ttl_seconds=ttl,
    )


def test_excluded_paths_cover_credentials_and_env() -> None:
    assert is_excluded_path("workspace/notes.md") is False
    assert is_excluded_path("workspace/.env") is True
    assert is_excluded_path("workspace/.env.local") is True
    assert is_excluded_path("workspace/.ssh/id_rsa") is True
    assert is_excluded_path("workspace/keys/server.pem") is True


def test_store_match_requires_every_dimension(tmp_path: Path) -> None:
    store = TaskAuthorizationStore(tmp_path / "auth")
    grant = store.issue(task_id="t1", principal_id="dsh:abc", agent_id="a1", session_id="s1",
                        workspace_root=tmp_path, operations=["file.write"], ttl_seconds=60)
    base = dict(task_id="t1", principal_id="dsh:abc", agent_id="a1", session_id="s1",
                operation="file.write", scope="workspace", workspace_root=tmp_path)

    assert store.match(path=str(tmp_path / "notes.md"), **base) is not None
    assert store.match(path=str(tmp_path / "notes.md"), **{**base, "operation": "file.read"}) is None
    assert store.match(path=str(tmp_path / "notes.md"), **{**base, "principal_id": "dsh:other"}) is None
    assert store.match(path=str(tmp_path / ".env"), **base) is None

    store.revoke(grant["grant_id"])
    assert store.match(path=str(tmp_path / "notes.md"), **base) is None


def test_task_grant_allows_workspace_write(dsh) -> None:
    manager, client, workspace = dsh
    _issue(manager, workspace)

    body = client.post("/api/dsh/before", json=_call(
        workspace, "write", {"path": "notes.md", "content": "x"}, call_id="w1")).json()
    assert body["kind"] == "allow"
    record = manager._find_action(body["action_id"]).event.metadata["decision_record"]
    assert record["decision"]["dominant_reason"] == "task_grant"
    assert record["decision"]["deciding_layer"] == "task_grant"


def test_workspace_read_auto_allows_without_a_grant(dsh) -> None:
    """普通只读本来就不需要审批，不必依赖任务授权。"""
    manager, client, workspace = dsh
    body = client.post("/api/dsh/before", json=_call(
        workspace, "read", {"file_path": "notes.md"}, call_id="r1")).json()
    assert body["kind"] == "allow"


def test_task_grant_does_not_cover_sensitive_or_unknown(dsh) -> None:
    manager, client, workspace = dsh
    _issue(manager, workspace)

    env = client.post("/api/dsh/before", json=_call(workspace, "write",
                                                    {"path": ".env", "content": "x"}, call_id="e1")).json()
    assert env["kind"] == "ask"

    unmapped = client.post("/api/dsh/before", json=_call(workspace, "some_mcp_tool",
                                                         {"query": "x"}, call_id="u1")).json()
    assert unmapped["kind"] == "ask"

    egress = client.post("/api/dsh/before", json=_call(workspace, "web_fetch",
                                                       {"url": "https://example.test"}, call_id="g1")).json()
    assert egress["kind"] == "ask"


def test_revoked_or_expired_grant_falls_back_to_approval(dsh) -> None:
    manager, client, workspace = dsh
    grant = _issue(manager, workspace, ttl=60)
    manager.task_authorization.revoke(grant["grant_id"])

    body = client.post("/api/dsh/before", json=_call(workspace, "write",
                                                     {"path": "notes.md", "content": "x"})).json()
    assert body["kind"] == "ask"


def test_without_grant_workspace_write_still_asks(dsh) -> None:
    _, client, workspace = dsh
    body = client.post("/api/dsh/before", json=_call(workspace, "write",
                                                     {"path": "notes.md", "content": "x"})).json()
    assert body["kind"] == "ask"
