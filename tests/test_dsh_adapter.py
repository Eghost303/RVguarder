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
    manager.close()


def call(workspace, **changes):
    """模拟宿主签发的可信调用，不携带 LLM 或用户伪造授权。"""
    return {"protocol": "dsh-guard-v2", "instance_id": "dsh-local", "session_id": "session-1",
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


@pytest.mark.parametrize("version", ["0.2.1-rc.2", "0.2.1-rc.3"])
def test_supported_sdk_version_handshake(dsh, version):
    """仅接受明确支持的真实 SDK 版本，不将 rc.3 伪装成 rc.2。"""
    manager, client, _ = dsh
    response = client.post("/api/dsh/hello", json={"protocol": "dsh-guard-v2", "instance_id": "dsh-local", "sdk_version": version})
    assert response.status_code == 200
    assert response.json()["sdk_version"] == version
    assert manager.sdk_version == version
    assert client.post("/api/dsh/hello", json={"protocol": "dsh-guard-v2", "instance_id": "dsh-local", "sdk_version": "0.2.1-rc.4"}).status_code == 409


def test_authenticated_call_cwd_is_not_the_managed_resource_namespace(dsh, tmp_path):
    """后台资源根固定时，普通调用仍使用宿主签发的真实cwd，拒绝参数冒充。"""
    manager, _, resource_root = dsh
    actual = tmp_path / "another-session-project"
    actual.mkdir()
    request = call(actual, arguments={"file_path": "data.txt", "cwd": str(resource_root)})
    payload = manager.host_adapter.payload(request)
    assert payload["params"]["cwd"] == str(actual)
    event = manager.host_adapter.build_event(payload, manager.context)
    assert event.metadata["host_workspace"] == str(actual)
    assert event.metadata["resource_workspace"] == str(resource_root)


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
    assert client.post("/api/dsh/hello", json={"protocol": "dsh-guard-v2", "instance_id": "dsh-local", "sdk_version": "bad"}).status_code == 409
    assert client.post("/api/dsh/hello", json={"protocol": "dsh-guard-v2", "instance_id": "dsh-local", "sdk_version": "0.2.1-rc.2"}).json()["ok"]


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
    manager.close()
    restored = DshServices(manager.context.paths.project_dir, dsh_home=manager.context.target.root,
                           profile="web", workspace=workspace, semantic_mode="local")
    assert len(restored.rv_engine._get_session_window(session).snapshot()) == 1
    assert not restored.recovery_required
    restored.close()


def test_restart_blocks_unconfirmed_dispatch_until_completion_replayed(dsh):
    manager, client, workspace = dsh
    request = call(workspace)
    assert client.post("/api/dsh/before", json=request).status_code == 200
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    manager.close()
    restored = DshServices(manager.context.paths.project_dir, dsh_home=manager.context.target.root,
                           profile="web", workspace=workspace, semantic_mode="local")
    assert restored.recovery_required
    with pytest.raises(ValueError, match="reconciliation"):
        restored.bridge_before(call(workspace, call_id="next"))
    assert restored.bridge_result(request, succeeded=True, dispatched=True)["ok"]
    assert not restored.recovery_required
    restored.close()


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


@pytest.mark.parametrize("manifest", [None, [], {"dsh": None}, {"dsh": {"profile": None}},
                                      {"dsh": {"profile": {"bundles": "wrong"}}},
                                      {"dsh": {"profile": {}}, "dependencies": []}])
def test_malformed_profile_still_exports_reports(dsh, manifest):
    """结构异常清单必须生成风险报告，不能导致扫描 API 500。"""
    manager, client, _ = dsh
    manager.context.target.config_path.write_text(json.dumps(manifest))
    response = client.post("/api/baseline/run", json={})
    assert response.status_code == 200, response.text
    report = client.get("/api/dsh/reports/json").json()
    assert next(c for c in report["checks"] if c["check_id"] == "DSH-PROFILE")["status"] == "risk"


def test_backend_directory_has_exclusive_owner(dsh):
    """重复启动不能并发写同一实例数据。"""
    manager, _, workspace = dsh
    with pytest.raises(ValueError, match="already_owned"):
        DshServices(manager.context.paths.project_dir, dsh_home=manager.context.target.root,
                    profile="web", workspace=workspace, semantic_mode="local")


def test_v1_protocol_cannot_mix_with_v2(dsh):
    """旧协议不能以新版身份获得裁决。"""
    _, client, workspace = dsh
    assert client.post("/api/dsh/before", json=call(workspace, protocol="dsh-guard-v1")).status_code == 422


def test_degraded_audit_is_idempotent_and_not_success_history(dsh):
    """旁路记录补交不扩充能力或创建正常动作。"""
    import time
    manager, client, _ = dsh
    event = {"id": "degraded-1", "instance_id": "dsh-local", "session_id": "s", "call_id": "c",
             "tool_name": "read", "time": time.time(), "stage": "bypass", "reason": "bridge_unavailable"}
    assert client.post("/api/dsh/degraded", json=event).json()["ok"]
    assert client.post("/api/dsh/degraded", json=event).json()["duplicate"]
    assert client.post("/api/dsh/degraded", json={**event, "call_id": "different"}).status_code == 422
    assert not manager._load_actions()
    assert client.get("/api/dsh/capabilities").json()["degraded_events"] == 1
    browser = TestClient(create_app(manager))
    browser.cookies.set("rvguarder_dsh_session", manager.bridge_token)
    assert browser.post("/api/dsh/degraded", json=event).status_code == 401


def test_probe_is_fresh_bounded_and_not_browser_owned(dsh):
    """探针时效失效后不能继续证明宿主配置。"""
    import time
    manager, client, _ = dsh
    probe = {"instance_id": "dsh-local", "sdk_version": "0.2.1-rc.2", "platform": "win32", "observed_at": time.time(),
             "tools": ["read", "mcp_unknown"], "facts": [{"key": "APPROVAL", "state": "verified", "evidence": "native service present"}], "audit_gap": True}
    assert client.post("/api/dsh/probe", json=probe).status_code == 200
    result = client.get("/api/dsh/capabilities").json()
    assert result["probe_fresh"] and result["audit_gap"]
    assert "mcp_unknown" in result["unmapped"]
    assert client.post("/api/dsh/probe", json={**probe, "observed_at": time.time()-120}).status_code == 422
    with manager._journal() as db:
        db.execute("UPDATE probes SET received=0")
    assert not client.get("/api/dsh/capabilities").json()["probe_fresh"]


def controlled_fixture(manager, workspace, *, tool="rvguard_read", destination=None):
    """为后端验证构造私有测试执行器的签名快照与成功收据。"""
    import hashlib
    import hmac
    import time
    from clawRVguarder.spec.content_receipts import _canonical, content_version
    def signed(payload):
        return {"payload": payload, "signature": hmac.new(manager.evidence.authority._key, _canonical(payload), hashlib.sha256).hexdigest()}
    request = call(workspace, tool_name=tool)
    if destination:
        request["arguments"]["destination"] = destination
    now = int(time.time()*1000)
    source = content_version("workspace", "data.txt", b"hello").model_dump()
    digest = hashlib.sha256(_canonical(request["arguments"])).hexdigest()
    proposal = {"purpose": "dsh_snapshot_v2", "snapshot_id": "snapshot-1", **{k: request[k] for k in ("instance_id", "session_id", "agent_id", "call_id", "root_call_id", "tool_name")},
                "arguments_sha256": digest, "source": source, "destination": destination, "issued_at_ms": now, "expires_at_ms": now+300000}
    request["proposal"] = signed(proposal)
    receipt = {"format_version": 1, "receipt_id": "receipt-1", "issuer": "dsh-controlled-v2", "task_id": "session:session-1",
               "principal_id": f"dsh:{manager.host_adapter.binding}", "agent_id": request["agent_id"], "session_id": request["session_id"], "run_id": request["root_call_id"],
               "tool_call_id": request["call_id"], "tool_name": tool, "operation_family": "file.read" if tool=="rvguard_read" else "file.write", "arguments_sha256": digest,
               "kind": "read" if tool=="rvguard_read" else "copy", "inputs": [source],
               "outputs": [content_version("workspace", destination, b"hello").model_dump()] if destination else [],
               "issued_at_ms": now, "expires_at_ms": now+300000, "success": True}
    return request, signed(receipt), signed


def test_controlled_receipt_success_is_bound_and_idempotent(dsh):
    """受控读取必须携带真实签名收据才能提交成功。"""
    manager, client, workspace = dsh
    request, receipt, _ = controlled_fixture(manager, workspace)
    before = client.post("/api/dsh/before", json=request)
    assert before.status_code == 200, before.text
    assert before.json()["evidence_binding"]["task_id"] == "session:session-1"
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    event = {"call": request, "succeeded": True, "dispatched": True}
    assert client.post("/api/dsh/result", json=event).status_code == 422
    assert client.post("/api/dsh/result", json={**event, "evidence": receipt}).status_code == 200
    assert client.post("/api/dsh/result", json={**event, "evidence": receipt}).json()["duplicate"]
    with manager._journal() as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 1


def test_forged_expired_and_mismatched_snapshot_are_rejected(dsh):
    """工具输入不能修改、错绑或重放过期的快照。"""
    manager, client, workspace = dsh
    request, _, signed = controlled_fixture(manager, workspace)
    assert client.post("/api/dsh/before", json={**request, "call_id": "different"}).status_code == 422
    forged = {**request, "proposal": {**request["proposal"], "signature": "0"*64}}
    assert client.post("/api/dsh/before", json=forged).status_code == 422
    expired = signed({**request["proposal"]["payload"], "issued_at_ms": 0, "expires_at_ms": 1})
    assert client.post("/api/dsh/before", json={**request, "proposal": expired}).status_code == 422
    ordinary = call(workspace, proposal=request["proposal"])
    assert client.post("/api/dsh/before", json=ordinary).status_code == 422


def test_copy_receipt_rejects_different_bytes_and_output(dsh):
    """复制关系必须绑定相同字节和快照指定的输出位置。"""
    manager, _, workspace = dsh
    request, receipt, signed = controlled_fixture(manager, workspace, tool="rvguard_copy", destination="out.txt")
    assert manager.evidence.verify_result(request, receipt, succeeded=True, dispatched=True).kind == "copy"
    altered = json.loads(json.dumps(receipt["payload"]))
    altered["outputs"][0]["resource_id"] = "workspace:other.txt"
    with pytest.raises(ValueError, match="output"):
        manager.evidence.verify_result(request, signed(altered), succeeded=True, dispatched=True)
    altered["outputs"][0]["sha256"] = "0"*64
    with pytest.raises(ValueError):
        manager.evidence.verify_result(request, signed(altered), succeeded=True, dispatched=True)


def test_child_agent_does_not_inherit_root_identity(dsh):
    """委派关系可审计，但不会自动继承父 Agent 能力。"""
    manager, client, workspace = dsh
    request = call(workspace, agent_id="child", session_id="child", parent_agent_id="root")
    response = client.post("/api/dsh/before", json=request).json()
    identity = manager._find_action(response["action_id"]).event.metadata["trusted_identity"]
    assert identity["agent_id"] == "dsh-agent:child"
    assert identity["capability_lineage"] == ["dsh-agent:child"]


def test_private_exact_tool_mapping_does_not_guess_mcp_names(dsh):
    """只有宿主配置的完整工具名和字段映射可以声明有限能力。"""
    from clawRVguarder.hosts.dsh.adapter import DshAdapter
    manager, _, workspace = dsh
    adapter = DshAdapter("dsh-local", manager.host_adapter.binding, workspace, manager.host_adapter.token_path,
                         mappings={"mcp_docs_fetch": {"canonical": "read", "arguments": {"path": "document_path"}}})
    payload = adapter.payload(call(workspace, tool_name="mcp_docs_fetch", arguments={"document_path": "doc.txt", "claim_admin": True}))
    assert payload["toolName"] == "read"
    assert payload["params"]["path"] == "doc.txt"
    assert "claim_admin" not in payload["params"]
    assert adapter.payload(call(workspace, tool_name="mcp_docs_fetch_other"))["toolName"].startswith("dsh-unmapped:")
    with pytest.raises(ValueError):
        DshAdapter("x", "y", workspace, manager.host_adapter.token_path, mappings={"read": {"canonical": "exec", "arguments": {}}})


def test_baseline_runtime_evidence_expires_instead_of_passing_forever(dsh):
    """扫描只使用新鲜宿主探针；过期后重新回到未知。"""
    import time
    manager, client, _ = dsh
    probe = {"instance_id": "dsh-local", "sdk_version": "0.2.1-rc.2", "platform": "linux", "observed_at": time.time(), "tools": [],
             "facts": [{"key": "ACCOUNT", "state": "verified", "evidence": "uid=1000"}]}
    assert client.post("/api/dsh/probe", json=probe).status_code == 200
    client.post("/api/baseline/run", json={})
    account = next(c for c in client.get("/api/dsh/reports/json").json()["checks"] if c["check_id"] == "DSH-ACCOUNT")
    assert account["status"] == "ok" and account["evidence"]["source"] == "authenticated_host_probe"
    with manager._journal() as db:
        db.execute("UPDATE probes SET received=0")
    client.post("/api/baseline/run", json={})
    account = next(c for c in client.get("/api/dsh/reports/json").json()["checks"] if c["check_id"] == "DSH-ACCOUNT")
    assert account["evidence"]["verification"] == "unknown"


def test_content_cross_session_requires_explicit_host_task_binding(dsh):
    """跨会话血缘只复用宿主显式绑定的任务，不传播到未绑定子 Agent。"""
    manager, _, workspace = dsh
    request, receipt, signed = controlled_fixture(manager, workspace)
    with manager._journal() as db:
        db.executemany("INSERT INTO tasks VALUES (?,?,?)", [("session-1", "session-1", "task-A"), ("session-2", "session-2", "task-A")])
    receipt = signed({**receipt["payload"], "task_id": "task-A"})
    manager.evidence.commit(request, manager.evidence.verify_result(request, receipt, succeeded=True, dispatched=True))
    next_call = {**request, "agent_id": "session-2", "session_id": "session-2", "call_id": "next"}
    next_call["proposal"] = signed({**request["proposal"]["payload"], "agent_id": "session-2", "session_id": "session-2", "call_id": "next"})
    assert manager.evidence.history(next_call)["witnesses"]
    child = {**next_call, "agent_id": "unbound-child", "session_id": "unbound-child"}
    child["proposal"] = signed({**next_call["proposal"]["payload"], "agent_id": "unbound-child", "session_id": "unbound-child"})
    assert not manager.evidence.history(child)["witnesses"]


def test_native_read_access_receipt_cannot_claim_byte_lineage(dsh):
    """原生 read 的前后观察只进入访问表，不进入字节关系表。"""
    import hashlib
    import time
    from clawRVguarder.spec.content_receipts import _canonical
    manager, client, workspace = dsh
    template, _, signed = controlled_fixture(manager, workspace)
    request = call(workspace)
    now = int(time.time()*1000)
    payload = {"format_version": 1, "receipt_id": "access-1", "issuer": "dsh-controlled-v2", "task_id": "session:session-1",
               "principal_id": f"dsh:{manager.host_adapter.binding}", "agent_id": request["agent_id"], "session_id": request["session_id"], "run_id": request["root_call_id"],
               "tool_call_id": request["call_id"], "tool_name": "read", "operation_family": "file.read", "arguments_sha256": hashlib.sha256(_canonical(request["arguments"])).hexdigest(),
               "kind": "read_access", "observation": "observed_before_after", "accessed_resource": template["proposal"]["payload"]["source"],
               "details_content_sha256": hashlib.sha256(b"projection").hexdigest(), "details_content_size_bytes": 10,
               "inputs": [], "outputs": [], "issued_at_ms": now, "expires_at_ms": now+300000, "success": True}
    assert client.post("/api/dsh/before", json=request).status_code == 200
    assert client.post("/api/dsh/dispatch", json=request).status_code == 200
    assert client.post("/api/dsh/result", json={"call": request, "succeeded": True, "dispatched": True, "evidence": signed(payload)}).status_code == 200
    with manager._journal() as db:
        assert db.execute("SELECT COUNT(*) FROM access_receipts").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 0


def send_fixture(manager, workspace):
    """只构造本机测试地址的协议夹具，不发起任何网络连接。"""
    import hashlib
    from clawRVguarder.spec.content_receipts import _canonical
    request, _, signed = controlled_fixture(manager, workspace)
    request["tool_name"] = "rvguard_send"
    url = "https://127.0.0.1:9443/approved"
    request["arguments"]["url"] = url
    proposal = {**request["proposal"]["payload"], "tool_name": "rvguard_send", "destination": url,
                "arguments_sha256": hashlib.sha256(_canonical(request["arguments"])).hexdigest()}
    request["proposal"] = signed(proposal)
    return request


@pytest.mark.parametrize("invalidate", ["revoked", "expired", "other_call"])
def test_exact_single_call_grant_cannot_be_reused_or_revoked(dsh, capsys, invalidate):
    """每次发送必须有未撤销、未过期且绑定实际 call 的精确授权。"""
    from clawRVguarder.hosts.dsh.grant_cli import main as grant_cli
    manager, client, workspace = dsh
    request = send_fixture(manager, workspace)
    assert client.post("/api/dsh/before", json=request).status_code == 422
    url = request["arguments"]["url"]
    manager.evidence.allowlist = [url]
    (manager.context.paths.runtime_dir / "dsh-evidence.json").write_text(json.dumps({"egress_allowlist": [url]}))
    assert client.post("/api/dsh/before", json=request).status_code == 200
    args = ["--project-dir", str(manager.context.paths.project_dir), "--workspace", str(workspace)]
    assert grant_cli([*args, "issue", "--agent", "session-1", "--session", "session-1", "--task", "session:session-1", "--run", "call-1", "--call", "call-1", "--path", "data.txt", "--recipient", url]) == 0
    grant = json.loads(capsys.readouterr().out)
    if invalidate == "revoked":
        grant_cli([*args, "revoke", "--grant-id", grant["id"]])
    elif invalidate == "expired":
        with manager.evidence.store._connect() as db:
            db.execute("UPDATE grants SET expires=0")
    else:
        with manager.evidence.store._connect() as db:
            grant["dsh_call_id"] = "other-call"
            db.execute("UPDATE grants SET payload=?", (json.dumps(grant),))
    assert client.post("/api/dsh/dispatch", json=request).status_code == 422
    with manager._journal() as db:
        assert db.execute("SELECT COUNT(*) FROM grant_uses").fetchone()[0] == 0


def test_default_egress_allowlist_is_empty_and_not_wildcard(dsh):
    """白名单不能按域名后缀或星号隐式扩大。"""
    from clawRVguarder.hosts.dsh.evidence import validate_allowlist
    manager, _, workspace = dsh
    assert manager.evidence.allowlist == []
    with pytest.raises(ValueError):
        manager.evidence.proposal(send_fixture(manager, workspace))
    for value in [["http://127.0.0.1/upload"], ["https://user:password@example.test/upload"], "*"]:
        with pytest.raises(ValueError):
            validate_allowlist(value)


def test_audit_export_download_delivers_files_not_paths(dsh):
    """宿主管理适配器用受控标识下载审计导出：返回文件字节而非绝对路径，且格式受限。"""
    manager, client, _ = dsh
    manager.audit_store.append("probe_event", {"note": "for export"})
    for fmt, head in (("json", b"{"), ("csv", b"record_id")):
        response = client.get(f"/api/dsh/audit-export/{fmt}")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("application/json" if fmt == "json" else "text/csv")
        assert response.content.startswith(head)
    assert client.get("/api/dsh/audit-export/exe").status_code == 422


def test_reports_route_rejects_unknown_format(dsh):
    """报告格式只接受 json/html/pdf。"""
    _, client, _ = dsh
    assert client.get("/api/dsh/reports/exe").status_code == 422
