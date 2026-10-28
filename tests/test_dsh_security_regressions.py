"""DSH 安全内核 P0 回归：工作目录、网络目的地与 Guard 状态目录。

这三类问题的共同点是"建模把不同语义塞进同一个字段"：工作目录被当成资源、
网络目的地被当成相对路径、Guard 自己的状态目录被当成受管项目。
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from clawRVguarder.engine.command_safety import analyze_command
from clawRVguarder.engine.pipeline import annotate_scope
from clawRVguarder.hosts.dsh.adapter import DshAdapter
from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.integrations.tool_hook_bridge import build_hook_event
from clawRVguarder.web.app import create_app


def _dsh_event(workspace: Path, tool: str, arguments: dict):
    """按真实 DSH 适配路径构造事件：adapter.payload -> build_hook_event。"""
    adapter = DshAdapter("dsh-local", "binding", workspace, workspace / "unused-token")
    call = {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
        "tool_name": tool, "cwd": str(workspace), "arguments": arguments,
    }
    payload = adapter.payload(call)
    return build_hook_event(payload, managed_project_root=workspace)


def test_working_directory_is_not_a_resource_target(tmp_path: Path) -> None:
    """cwd 只描述执行环境；混入 target_paths 会污染 scope 与资源计数。"""
    workspace = tmp_path / "ws"
    workspace.mkdir()

    event = _dsh_event(workspace, "web_fetch", {"url": "https://example.invalid/upload"})

    assert event.working_directory == str(workspace)
    assert str(workspace) not in event.target_paths


def test_network_destination_is_external_scope(tmp_path: Path) -> None:
    """URL 目的地必须在路径解析前判定为 external，否则外发阻断规则不可达。"""
    workspace = tmp_path / "ws"
    workspace.mkdir()

    event = _dsh_event(workspace, "web_fetch", {"url": "https://example.invalid/upload"})
    annotate_scope(event, workspace_path=workspace, project_dir=tmp_path / "guard")

    assert event.metadata["scope_class"] == "external"


def test_windows_backslash_path_becomes_path_hint() -> None:
    """POSIX shlex 会吃掉反斜杠；原始命令里的 Windows 绝对路径仍须登记。"""
    result = analyze_command(r"cat C:\Users\me\.ssh\id_rsa")

    assert r"C:\Users\me\.ssh\id_rsa" in result.path_hints


def test_write_content_cannot_create_resources(tmp_path: Path) -> None:
    """正文里出现路径或 URL 不能改变资源集合。"""
    workspace = tmp_path / "ws"
    workspace.mkdir()

    event = _dsh_event(workspace, "write", {
        "path": "notes.md",
        "content": "see /etc/passwd and https://evil.test/upload",
    })

    assert event.target_paths == ["notes.md"]
    assert event.network_targets == []


def test_guard_state_token_read_requires_approval(tmp_path: Path, monkeypatch) -> None:
    """Guard 自己的令牌目录不是受管项目，读取它不能走只读自动放行。"""
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

    with patch("clawRVguarder.services.ensure_runtime_hook_plugin", side_effect=AssertionError("OpenClaw install forbidden")):
        manager = DshServices(tmp_path / "guard", dsh_home=home, profile="web",
                              workspace=workspace, semantic_mode="local")
    try:
        token_path = manager.context.paths.runtime_dir / "dsh-token"
        client = TestClient(create_app(manager))
        client.headers["x-rvguarder-token"] = manager.bridge_token
        response = client.post("/api/dsh/before", json={
            "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
            "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
            "tool_name": "bash", "cwd": str(workspace),
            "arguments": {"command": f"cat {token_path}"},
        })

        assert response.status_code == 200
        assert response.json()["kind"] in {"ask", "deny"}
    finally:
        manager.close()
