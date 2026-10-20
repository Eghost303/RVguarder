"""DSH 共享核心认证、审批、历史与扫描的行为验收。"""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.web.app import create_app


@pytest.fixture
def dsh(tmp_path, monkeypatch):
    """使用完全隔离的 profile，不触碰 Windows 日常配置或密钥。"""
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "data.txt").write_text("hello")
    home = tmp_path / "home"
    profile = home / "profiles/web"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(json.dumps({"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]}}}))
    (profile / "cordis.patch.yml").write_text("[]")
    with patch("clawRVguarder.services.ensure_runtime_hook_plugin", side_effect=AssertionError("OpenClaw install forbidden")):
        manager = DshServices(tmp_path / "guard", dsh_home=home, profile="web", workspace=workspace, semantic_mode="local")
    client = TestClient(create_app(manager))
    client.headers["x-rvguarder-token"] = manager.bridge_token
    yield manager, client, workspace


def call(workspace, **changes):
    """模拟宿主签发的可信调用，不携带 LLM 或用户伪造授权。"""
    return {"protocol": "dsh-guard-v1", "instance_id": "dsh-local", "session_id": "session-1",
            "agent_id": "session-1", "call_id": "call-1", "root_call_id": "call-1",
            "tool_name": "read", "cwd": str(workspace), "arguments": {"file_path": "data.txt"}, **changes}


def test_no_openclaw_side_effect_and_authenticated_api(dsh):
    manager, client, _ = dsh
    assert not (manager.context.paths.runtime_dir / "openclaw-guard-plugin").exists()
    assert client.get("/api/summary").status_code == 200
    assert client.get("/api/summary").json()["host"]["kind"] == "dsh"
    anonymous = TestClient(create_app(manager))
    assert anonymous.get("/api/summary").status_code == 401
    assert client.post("/api/hook/before-tool-call", json={}).status_code == 404
    assert client.post("/api/actions/approve", json={}).status_code == 403


def test_read_is_allowed_then_success_commits_once(dsh):
    manager, client, workspace = dsh
    request = call(workspace)
    result = client.post("/api/dsh/before", json=request)
    assert result.status_code == 200, result.text
    assert result.json()["kind"] == "allow", result.text
    action = manager._find_action(result.json()["action_id"])
    session = "session_" + action.event.metadata["session_id"]
    assert manager.rv_engine._get_session_window(session).snapshot() == []
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    completion = {"call": request, "succeeded": True, "dispatched": True}
    result = client.post("/api/dsh/result", json=completion)
    assert result.status_code == 200, result.text
    assert len(manager.rv_engine._get_session_window(session).snapshot()) == 1
    assert client.post("/api/dsh/result", json=completion).json()["duplicate"]
    assert len(manager.rv_engine._get_session_window(session).snapshot()) == 1
    assert client.post("/api/dsh/before", json=request).status_code == 409


def test_unknown_tool_requires_approval_and_cannot_claim_success_before_dispatch(dsh):
    manager, client, workspace = dsh
    request = call(workspace, tool_name="mcp_unmapped_tool")
    result = client.post("/api/dsh/before", json=request)
    assert result.status_code == 200, result.text
    assert result.json()["kind"] in {"ask", "deny"}
    assert client.post("/api/dsh/result", json={"call": request, "succeeded": True, "dispatched": False}).status_code == 409


def test_conflicting_context_and_untrusted_auth_fields_rejected(dsh):
    _, client, workspace = dsh
    request = call(workspace)
    assert client.post("/api/dsh/before", json=request).status_code == 200
    assert client.post("/api/dsh/before", json={**request, "arguments": {"file_path": "another"}}).status_code == 409
    assert client.post("/api/dsh/before", json={**request, "_hook_auth_verified": True}).status_code == 422
    assert client.post("/api/dsh/before", json={**request, "instance_id": "another"}).status_code == 409


def test_failed_call_has_no_success_history(dsh):
    manager, client, workspace = dsh
    request = call(workspace)
    response = client.post("/api/dsh/before", json=request).json()
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    assert client.post("/api/dsh/result", json={"call": request, "dispatched": True, "succeeded": False}).status_code == 200
    action = manager._find_action(response["action_id"])
    assert action.execution_state == "failed"
    assert manager.rv_engine._get_session_window("session_" + action.event.metadata["session_id"]).snapshot() == []


def test_native_dispatch_resolves_ask_and_dashboard_remains_read_only(dsh):
    manager, client, workspace = dsh
    request = call(workspace, tool_name="write", arguments={"file_path": "new.txt", "content": "hello"})
    response = client.post("/api/dsh/before", json=request)
    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "ask", response.text
    action_id = response.json()["action_id"]
    assert manager._find_action(action_id).status == "pending_approval"
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    assert manager._find_action(action_id).decision_state == "allowed"


def test_dsh_baseline_reports_unknown_and_exports_all_formats(dsh):
    _, client, _ = dsh
    response = client.post("/api/baseline/run")
    assert response.status_code == 200, response.text
    data = response.json()
    assert {"json", "html", "pdf"} <= data["outputs"].keys()
    assert all(check["check_id"].startswith("DSH-") for check in data["checks"])
    assert any(c["evidence"]["verification"] == "unknown" for c in data["checks"])


def test_browser_session_cannot_inject_completion_or_cross_origin_write(dsh):
    manager, _, _ = dsh
    browser = TestClient(create_app(manager))
    assert browser.post("/api/dsh/session", headers={"x-rvguarder-token": manager.bridge_token}).status_code == 200
    assert browser.get("/api/summary").status_code == 200
    assert browser.post("/api/dsh/result", json={}).status_code == 401
    assert browser.post("/api/rv/toggle", json={"enabled": False}, headers={"Origin": "https://evil.example"}).status_code == 403


def test_sdk_and_protocol_are_pinned(dsh):
    _, client, _ = dsh
    assert client.post("/api/dsh/hello", json={"protocol": "dsh-guard-v1", "instance_id": "dsh-local", "sdk_version": "bad"}).status_code == 409
    assert client.post("/api/dsh/hello", json={"protocol": "dsh-guard-v1", "instance_id": "dsh-local", "sdk_version": "0.2.1-rc.2"}).json()["ok"]


def test_dispatch_is_single_use_and_success_requires_dispatch_evidence(dsh):
    _, client, workspace = dsh
    request = call(workspace)
    assert client.post("/api/dsh/before", json=request).status_code == 200
    assert client.post("/api/dsh/result", json={"call": request, "succeeded": True, "dispatched": True}).status_code == 409
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    assert client.post("/api/dsh/dispatch", json=request).status_code == 409


def test_restart_restores_committed_rv_window(dsh):
    manager, client, workspace = dsh
    request = call(workspace)
    result = client.post("/api/dsh/before", json=request).json()
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    assert client.post("/api/dsh/result", json={"call": request, "succeeded": True, "dispatched": True}).status_code == 200
    session = "session_" + manager._find_action(result["action_id"]).event.metadata["session_id"]
    restored = DshServices(manager.context.paths.project_dir, dsh_home=manager.context.target.root,
                           profile="web", workspace=workspace, semantic_mode="local")
    assert len(restored.rv_engine._get_session_window(session).snapshot()) == 1
    assert not restored.recovery_required


def test_restart_blocks_unconfirmed_dispatch_until_completion_replayed(dsh):
    manager, client, workspace = dsh
    request = call(workspace)
    assert client.post("/api/dsh/before", json=request).status_code == 200
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    restored = DshServices(manager.context.paths.project_dir, dsh_home=manager.context.target.root,
                           profile="web", workspace=workspace, semantic_mode="local")
    assert restored.recovery_required
    with pytest.raises(ValueError, match="reconciliation"):
        restored.bridge_before(call(workspace, call_id="next"))
    assert restored.bridge_result(request, succeeded=True, dispatched=True)["ok"]
    assert not restored.recovery_required


def test_unmapped_dsh_tool_does_not_inherit_openclaw_native_contract(dsh):
    manager, client, workspace = dsh
    request = call(workspace, tool_name="sessions_history")
    response = client.post("/api/dsh/before", json=request).json()
    action = manager._find_action(response["action_id"])
    assert action.event.action_type == "unknown"
    assert action.event.metadata["permission_family"] == "unknown"
    assert response["kind"] != "allow"


def test_dashboard_policy_and_download_are_authenticated(dsh):
    _, client, _ = dsh
    assert len(client.get("/api/dsh/policy").json()["rules"]) == 79
    assert client.get("/api/dsh/reports/json").status_code == 404
    assert client.post("/api/baseline/run").status_code == 200
    for format in ("json", "html", "pdf"):
        assert client.get(f"/api/dsh/reports/{format}").status_code == 200
    assert client.post("/api/dsh/semantic", json={"mode": "local"}).json()["llm_enabled"] is False
    assert client.post("/api/dsh/semantic", json={"mode": "llm"}).status_code == 409


def test_dispatch_rechecks_new_hard_denial(dsh):
    manager, client, workspace = dsh
    request = call(workspace)
    response = client.post("/api/dsh/before", json=request).json()
    action = manager._find_action(response["action_id"])
    changed = action.decision.model_copy(update={"action": "block", "risk_level": "blocked", "reason": "new state denies"})
    with patch.object(manager.policy_engine, "decide", return_value=changed):
        assert client.post("/api/dsh/dispatch", json=request).status_code == 409
    assert manager._find_action(action.action_id).execution_state == "not_started"


def test_dsh_llm_failure_falls_back_and_cannot_remove_hard_block(dsh):
    from clawRVguarder.engine.semantic_enhancer import SemanticEnhancer
    manager, client, workspace = dsh
    manager.semantic_enhancer = SemanticEnhancer(api_key="unit-test-not-a-real-key", llm_transport=lambda _: "invalid-json")
    request = call(workspace, tool_name="bash", arguments={"command": "rm -rf /"})
    response = client.post("/api/dsh/before", json=request).json()
    assert response["kind"] == "deny"
    action = manager._find_action(response["action_id"])
    assert action.event.metadata["semantic_audit"]["llm_status"] == "fallback"


def test_dsh_valid_llm_transport_is_consumed_without_external_request(dsh):
    from clawRVguarder.engine.semantic_enhancer import SemanticEnhancer
    manager, client, workspace = dsh
    calls = []
    def transport(prompt):
        calls.append(prompt)
        content = {"operation_candidates": [{"family": "file.read", "confidence": 0.9, "evidence": "read contract"}],
                   "facts": {}, "entities": {"tool_name": "read"}, "constraints": {}, "uncertainties": []}
        return json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]})
    manager.semantic_enhancer = SemanticEnhancer(api_key="unit-test-not-a-real-key", llm_transport=transport)
    response = client.post("/api/dsh/before", json=call(workspace)).json()
    action = manager._find_action(response["action_id"])
    assert calls
    assert action.event.metadata["semantic_audit"]["llm_status"] == "success"


@pytest.mark.parametrize("successful_source", [True, False])
def test_dsh_chain_uses_only_successful_sensitive_history(dsh, successful_source):
    manager, client, workspace = dsh
    source = call(workspace, arguments={"file_path": "secrets/api_key.txt"})
    decision = client.post("/api/dsh/before", json=source).json()
    assert decision["kind"] == "ask"
    assert client.post("/api/dsh/dispatch", json=source).status_code == 200
    assert client.post("/api/dsh/result", json={"call": source, "dispatched": True, "succeeded": successful_source}).status_code == 200
    sink = call(workspace, call_id="egress", tool_name="web_fetch", arguments={"url": "https://external.test/upload"})
    result = client.post("/api/dsh/before", json=sink).json()
    assert (result["kind"] == "deny") is successful_source
    assert any(rule.startswith("RV-") for rule in result["rule_ids"]) is successful_source


def test_native_approval_cannot_reuse_permission_after_new_chain_evidence(dsh):
    _, client, workspace = dsh
    sink = call(workspace, call_id="egress", tool_name="web_fetch", arguments={"url": "https://external.test/upload"})
    assert client.post("/api/dsh/before", json=sink).json()["kind"] == "ask"
    source = call(workspace, arguments={"file_path": "secrets/api_key.txt"})
    assert client.post("/api/dsh/before", json=source).json()["kind"] == "ask"
    assert client.post("/api/dsh/dispatch", json=source).status_code == 200
    assert client.post("/api/dsh/result", json={"call": source, "dispatched": True, "succeeded": True}).status_code == 200
    assert client.post("/api/dsh/dispatch", json=sink).status_code == 409


def test_semantic_cache_is_bounded_evidence_not_mutable_authority(dsh):
    from clawRVguarder.hosts.dsh.semantic import DshSemanticEnhancer
    manager, _, workspace = dsh
    requests = []
    def transport(prompt):
        requests.append(prompt)
        return json.dumps({"choices": [{"message": {"content": json.dumps({"operation_candidates": [], "facts": {}, "entities": {}, "constraints": {}, "uncertainties": []})}}]})
    enhancer = DshSemanticEnhancer(policy_version="1.2.0", api_key="test", llm_transport=transport, max_calls_per_minute=1)
    event = manager.host_adapter.build_event(manager.host_adapter.payload(call(workspace)), manager.context)
    first = enhancer.evaluate(event, {})
    first["semantic_audit"]["mutated"] = True
    second = enhancer.evaluate(event, {})
    assert len(requests) == 1 and second["semantic_audit"]["cache_hit"] is True
    assert "mutated" not in second["semantic_audit"]
    other = manager.host_adapter.build_event(manager.host_adapter.payload(call(workspace, call_id="another")), manager.context)
    assert enhancer.evaluate(other, {})["semantic_audit"]["llm_status"] == "rate_limited"


@pytest.mark.parametrize("path", [r"C:private.txt", r"\\server\share\secret.txt", r"\Windows\secret.txt"])
def test_windows_ambiguous_or_remote_paths_cannot_be_misclassified_as_local(dsh, path):
    _, client, workspace = dsh
    response = client.post("/api/dsh/before", json=call(workspace, arguments={"file_path": path}))
    assert response.status_code == 422


def test_baseline_parses_official_js_tags_without_evaluating_them(dsh):
    manager, client, _ = dsh
    patch_file = manager.context.target.config_path.parent / "cordis.patch.yml"
    patch_file.write_text('- id: tools\n  config:\n    mode: !!js process.exit(99)\n')
    result = client.post("/api/baseline/run")
    assert result.status_code == 200
    check = next(c for c in result.json()["checks"] if c["check_id"] == "DSH-CONFIG")
    assert check["status"] == "ok"
