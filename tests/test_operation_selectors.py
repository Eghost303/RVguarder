"""声明式操作选择：子操作由参数决定，未登记不得落回默认族。"""
from __future__ import annotations

from pathlib import Path

import pytest

from clawRVguarder.hosts.dsh.adapter import DshAdapter
from clawRVguarder.integrations.tool_hook_bridge import build_hook_event
from clawRVguarder.policy.catalog import PolicyBundle
from clawRVguarder.policy.selectors import select_family
from clawRVguarder.policy.trace import TraceCompiler


@pytest.fixture(scope="module")
def bundle() -> PolicyBundle:
    return PolicyBundle.load()


def _family(bundle: PolicyBundle, workspace: Path, tool: str, arguments: dict) -> str:
    adapter = DshAdapter("dsh-local", "binding", workspace, workspace / "token")
    payload = adapter.payload({
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
        "tool_name": tool, "cwd": str(workspace), "arguments": arguments,
    })
    event = build_hook_event(payload, managed_project_root=workspace)
    trace = TraceCompiler(bundle).compile(event, semantic={"scenario": "selector_test"}, rv_trace=[])
    return trace.operation.family


def test_selector_maps_editor_view_to_read() -> None:
    assert select_family("str_replace_editor", {"command": "view"}) == "file.read"


def test_selector_maps_editor_mutations_to_write() -> None:
    for command in ("create", "str_replace", "insert"):
        assert select_family("str_replace_editor", {"command": command}) == "file.write"


def test_selector_leaves_unknown_subaction_unresolved() -> None:
    assert select_family("str_replace_editor", {"command": "undo_edit"}) is None
    assert select_family("str_replace_editor", {}) is None


def test_selector_tool_does_not_fall_back_to_tool_default(bundle, tmp_path: Path) -> None:
    """未登记子操作必须保持 unknown，不能被 action_type 兜底成写入。"""
    assert _family(bundle, tmp_path, "str_replace_editor", {"command": "undo_edit"}) == "unknown_tool"


def test_editor_view_and_create_resolve_to_distinct_families(bundle, tmp_path: Path) -> None:
    assert _family(bundle, tmp_path, "str_replace_editor", {"command": "view", "path": "notes.md"}) == "file.read"
    assert _family(bundle, tmp_path, "str_replace_editor", {"command": "create", "path": "notes.md"}) == "file.write"


def test_terminal_send_is_process_execution(bundle, tmp_path: Path) -> None:
    assert _family(bundle, tmp_path, "terminal_send", {"text": "npm test"}) == "process.execute"
