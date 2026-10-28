"""效果证据分级：执行前只有预期/潜在能力，不能写成已发生。"""
from __future__ import annotations

from pathlib import Path

import pytest

from clawRVguarder.hosts.dsh.adapter import DshAdapter
from clawRVguarder.integrations.tool_hook_bridge import build_hook_event
from clawRVguarder.policy.catalog import PolicyBundle
from clawRVguarder.policy.trace import TraceCompiler
from clawRVguarder.rv.tool_events import build_tool_call_step


@pytest.fixture(scope="module")
def bundle() -> PolicyBundle:
    return PolicyBundle.load()


def _step(bundle: PolicyBundle, workspace: Path, tool: str, arguments: dict) -> dict:
    adapter = DshAdapter("dsh-local", "binding", workspace, workspace / "token")
    payload = adapter.payload({
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
        "tool_name": tool, "cwd": str(workspace), "arguments": arguments,
    })
    event = build_hook_event(payload, managed_project_root=workspace)
    trace = TraceCompiler(bundle).compile(event, semantic={}, rv_trace=[])
    return build_tool_call_step(event, trace)


def _statuses(step: dict) -> set[str]:
    return {item["status"] for item in step.get("effect_evidence", [])}


def test_pre_execution_effects_are_never_observed(bundle, tmp_path: Path) -> None:
    step = _step(bundle, tmp_path, "write", {"path": "notes.md", "content": "x"})

    assert "write" in step["effects"]
    assert _statuses(step) <= {"expected", "potential", "unknown"}
    assert "observed" not in _statuses(step)


def test_read_only_command_effects_are_expected(bundle, tmp_path: Path) -> None:
    step = _step(bundle, tmp_path, "bash", {"command": "rg TODO ."})

    assert "read" in step["effects"]
    evidence = {item["effect"]: item for item in step["effect_evidence"]}
    assert evidence["read"]["status"] == "expected"
    assert evidence["read"]["basis"] == "static_command"


def test_potential_command_capabilities_are_marked_potential(bundle, tmp_path: Path) -> None:
    """重定向带来 write 能力，但它是静态潜力，不是已发生的写入。"""
    step = _step(bundle, tmp_path, "bash", {"command": "rg TODO . > report.txt"})

    evidence = {item["effect"]: item for item in step["effect_evidence"]}
    assert evidence["write"]["status"] == "potential"


def test_unmapped_tool_effects_are_unknown(bundle, tmp_path: Path) -> None:
    step = _step(bundle, tmp_path, "some_mcp_tool", {"query": "hello"})

    assert step["effects"] == ["unknown"]
    assert _statuses(step) == {"unknown"}
