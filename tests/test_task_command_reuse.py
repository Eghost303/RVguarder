"""测试/构建命令复用：每任务首次审批，同任务内按类别复用。

复用只对宿主显式登记的任务生效；未登记任务的会话不构成任务授权。
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.web.app import create_app


@pytest.fixture
def dsh(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "notes.md").write_text("# notes\n", encoding="utf-8")
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


def _register_task(manager: DshServices, agent: str = "s1", session: str = "s1",
                   task: str = "task-1") -> None:
    with manager._journal() as db:
        db.execute("INSERT OR REPLACE INTO tasks VALUES (?,?,?)", (agent, session, task))


def _call(workspace: Path, command: str, *, call_id: str, session: str = "s1") -> dict:
    return {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": session, "agent_id": session, "call_id": call_id, "root_call_id": call_id,
        "tool_name": "bash", "cwd": str(workspace), "arguments": {"command": command},
    }


def _approve(client: TestClient, call: dict) -> None:
    assert client.post("/api/dsh/dispatch", json=call).status_code == 200
    assert client.post("/api/dsh/result", json={
        "call": call, "dispatched": True, "succeeded": True}).status_code == 200


def test_first_command_asks_then_same_class_reuses(dsh) -> None:
    manager, client, workspace = dsh
    _register_task(manager)
    first = _call(workspace, "npm test", call_id="t1")
    assert client.post("/api/dsh/before", json=first).json()["kind"] == "ask"

    _approve(client, first)

    second = _call(workspace, "npm test", call_id="t2")
    body = client.post("/api/dsh/before", json=second).json()
    assert body["kind"] == "allow"
    record = manager._find_action(body["action_id"]).event.metadata["decision_record"]
    assert record["decision"]["dominant_reason"] == "task_command_reuse"


def test_reuse_is_scoped_to_the_approved_class(dsh) -> None:
    manager, client, workspace = dsh
    _register_task(manager)
    first = _call(workspace, "npm test", call_id="t1")
    client.post("/api/dsh/before", json=first)
    _approve(client, first)

    other = _call(workspace, "cargo test", call_id="c2")
    assert client.post("/api/dsh/before", json=other).json()["kind"] == "ask"


def test_reuse_does_not_cover_destructive_or_unknown_commands(dsh) -> None:
    manager, client, workspace = dsh
    _register_task(manager)
    first = _call(workspace, "npm test", call_id="t1")
    client.post("/api/dsh/before", json=first)
    _approve(client, first)

    for index, command in enumerate(("rm -rf build", "node app.js", "curl https://example.test")):
        body = client.post("/api/dsh/before", json=_call(workspace, command, call_id=f"x{index}")).json()
        # 破坏性命令可能直接拒绝，未知命令保持审批；都不得被复用放行。
        assert body["kind"] != "allow", command


def test_reuse_is_scoped_to_the_task_session(dsh) -> None:
    manager, client, workspace = dsh
    _register_task(manager)
    first = _call(workspace, "npm test", call_id="t1")
    client.post("/api/dsh/before", json=first)
    _approve(client, first)

    other_session = _call(workspace, "npm test", call_id="o1", session="s2")
    assert client.post("/api/dsh/before", json=other_session).json()["kind"] == "ask"


def test_asking_alone_does_not_enable_reuse(dsh) -> None:
    """只有真正批准过（dispatch）之后才复用。"""
    manager, client, workspace = dsh
    _register_task(manager)
    client.post("/api/dsh/before", json=_call(workspace, "npm test", call_id="t1"))

    second = _call(workspace, "npm test", call_id="t2")
    assert client.post("/api/dsh/before", json=second).json()["kind"] == "ask"


def test_unregistered_session_cannot_reuse(dsh) -> None:
    """未登记任务的会话即使批准过同类命令，也不构成可复用授权。"""
    manager, client, workspace = dsh
    first = _call(workspace, "npm test", call_id="t1")
    client.post("/api/dsh/before", json=first)
    _approve(client, first)

    second = _call(workspace, "npm test", call_id="t2")
    assert client.post("/api/dsh/before", json=second).json()["kind"] == "ask"
