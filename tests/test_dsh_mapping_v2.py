"""MCP/自定义工具映射 v2：角色化参数、未建模入参显式降级。"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from clawRVguarder.hosts.dsh.adapter import DshAdapter
from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.policy.catalog import PolicyBundle
from clawRVguarder.policy.trace import TraceCompiler

V2_MAPPING = {
    "mcp_docs": {
        "canonical": "web_fetch",
        "server_id": "mcp:docs",
        "schema_sha256": "a" * 64,
        "arguments": {
            "url": {"source": "target_url", "role": "destination"},
            "path": {"source": "document_path", "role": "source"},
        },
    },
}


def _adapter(mappings: dict, schema: int = 2, workspace: Path | None = None) -> DshAdapter:
    root = workspace or Path.cwd()
    return DshAdapter("dsh-local", "binding", root, root / "token",
                      mappings=mappings, mapping_schema=schema)


def _call(tool: str, arguments: dict, cwd: Path | None = None) -> dict:
    return {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "s1", "agent_id": "s1", "call_id": "c1", "root_call_id": "c1",
        "tool_name": tool, "cwd": str(cwd or Path.cwd()), "arguments": arguments,
    }


def test_v2_mapping_projects_params_and_roles() -> None:
    payload = _adapter(V2_MAPPING).payload(
        _call("mcp_docs", {"target_url": "https://example.test", "document_path": "notes.md"})
    )

    assert payload["params"]["url"] == "https://example.test"
    assert payload["params"]["path"] == "notes.md"
    assert payload["mcpUnmodeled"] == []
    assert payload["mcpMissingSources"] == []


def test_v2_unmodeled_arguments_are_reported() -> None:
    payload = _adapter(V2_MAPPING).payload(
        _call("mcp_docs", {"target_url": "https://example.test", "extra_flag": "x"})
    )

    assert payload["mcpUnmodeled"] == ["extra_flag"]


def test_v2_missing_required_source_is_reported() -> None:
    payload = _adapter(V2_MAPPING).payload(_call("mcp_docs", {"target_url": "https://example.test"}))

    assert payload["mcpMissingSources"] == ["path"]


def test_v2_unmodeled_argument_makes_coverage_partial() -> None:
    adapter = _adapter(V2_MAPPING)
    event = adapter.build_event(
        adapter.payload(_call("mcp_docs", {"target_url": "https://example.test", "extra_flag": "x"})), None
    )
    trace = TraceCompiler(PolicyBundle.load()).compile(event, semantic={}, rv_trace=[])

    assert trace.coverage.status != "complete"
    assert "mcp.argument_unmodeled" in trace.coverage.missing_features


def test_mapped_exec_reports_unknown_dialect() -> None:
    adapter = _adapter({"mcp_shell": {"canonical": "exec",
                                      "arguments": {"command": {"source": "cmd"}}}}, workspace=Path.cwd())
    event = adapter.build_event(adapter.payload(_call("mcp_shell", {"cmd": "ls"})), None)
    trace = TraceCompiler(PolicyBundle.load()).compile(event, semantic={}, rv_trace=[])

    assert "shell.dialect_unmodeled" in trace.coverage.missing_features


@pytest.mark.parametrize("mappings,schema", [
    ({"rvguard_fetch": {"canonical": "read", "arguments": {}}}, 2),
    ({"mcp": {"canonical": "read", "arguments": {"path": {"source": "cwd"}}}}, 2),
    ({"mcp": {"canonical": "read", "arguments": {"path": {"source": "a"}, "content": {"source": "a"}}}}, 2),
    ({"mcp": {"canonical": "read", "arguments": {"path": {"source": "a", "role": "root"}}}}, 2),
    ({"mcp": {"canonical": "read", "arguments": {"path": {"source": "a"}}, "extra": 1}}, 2),
    ({"mcp": {"canonical": ["read"], "arguments": {}}}, 2),
    ({"mcp": {"canonical": "read", "arguments": {}}}, 3),
])
def test_invalid_mappings_are_rejected(mappings, schema) -> None:
    with pytest.raises(ValueError):
        _adapter(mappings, schema)


def _prepare_instance(tmp_path: Path, mapping_document: dict | None) -> tuple[Path, Path, Path]:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    home = tmp_path / "home"
    profile = home / "profiles" / "web"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(
        json.dumps({"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base"]}}}), encoding="utf-8")
    (profile / "cordis.patch.yml").write_text("[]", encoding="utf-8")
    project = tmp_path / "guard"
    if mapping_document is not None:
        from clawRVguarder.storage.private_files import ensure_private_directory

        runtime = project / "runtime"
        ensure_private_directory(runtime)
        (runtime / "dsh-tool-mappings.json").write_text(
            json.dumps(mapping_document), encoding="utf-8")
    return project, home, workspace


def test_services_loads_v2_envelope(tmp_path: Path) -> None:
    project, home, workspace = _prepare_instance(
        tmp_path, {"schema_version": 2, "tools": V2_MAPPING})
    with patch("clawRVguarder.services.ensure_runtime_hook_plugin", side_effect=AssertionError("no")):
        manager = DshServices(project, dsh_home=home, profile="web",
                              workspace=workspace, semantic_mode="local")
    try:
        assert manager.host_adapter.mapping_schema == 2
        assert "mcp_docs" in manager.host_adapter.mappings
    finally:
        manager.close()


def test_services_rejects_unsupported_mapping_schema(tmp_path: Path) -> None:
    project, home, workspace = _prepare_instance(
        tmp_path, {"schema_version": 3, "tools": V2_MAPPING})
    with patch("clawRVguarder.services.ensure_runtime_hook_plugin", side_effect=AssertionError("no")):
        with pytest.raises(ValueError, match="unsupported_tool_mappings_schema"):
            DshServices(project, dsh_home=home, profile="web",
                        workspace=workspace, semantic_mode="local")
