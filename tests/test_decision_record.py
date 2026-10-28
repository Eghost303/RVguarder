"""逐调用决策记录与原因码的单元回归。"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from clawRVguarder.engine.decision_record import build_decision_record
from clawRVguarder.models import BehaviorEvent, DetectionDecision
from clawRVguarder.policy import reasons
from clawRVguarder.services import build_services


def _event(**metadata) -> BehaviorEvent:
    return BehaviorEvent(
        event_id="e1", timestamp="2026-10-28T00:00:00Z", action_type="file_write",
        process_name="dsh", pid=None, user=None, target_paths=["notes.md"],
        raw_payload={}, metadata=metadata,
    )


def _decision(*, action: str = "ask", codes: list[str] | None = None) -> DetectionDecision:
    return DetectionDecision(
        event_id="e1", timestamp="2026-10-28T00:00:00Z", action_type="file_write",
        risk_level="caution", action=action, reason="policy",
        policy_decision={"reason_codes": codes or []},
    )


def test_dominant_prefers_hard_block_over_simultaneous_soft_causes() -> None:
    """阻断不能因为同时存在权限差分或缺证证据而被归因成"仅需审批"。"""
    assert reasons.dominant([
        reasons.PERMISSION_EXCESS, reasons.MISSING_EVIDENCE, reasons.HARD_BLOCK,
    ]) == reasons.HARD_BLOCK


def test_dominant_ignores_unknown_codes() -> None:
    assert reasons.dominant(["not_a_code", reasons.RV_ESCALATION]) == reasons.RV_ESCALATION
    assert reasons.dominant([]) is None


def test_decision_record_carries_identity_policy_and_reason() -> None:
    event = _event(
        host="dsh", instance_id="dsh-local", host_workspace="/ws",
        tool_name="write", tool_origin="dsh_native",
        dsh={"session_id": "s1", "call_id": "c1", "root_call_id": "c1", "parent_call_id": None},
        trusted_identity={"principal_id": "dsh:abc", "agent_id": "dsh-instance:dsh-local", "trust": "verified"},
        scope_class="workspace",
        authorization_trace={"operation": {"family": "file.write"}, "coverage": {"status": "complete"}},
        pipeline_timings_ms={"total_ms": 12.5, "rv_ms": 0.0},
    )

    record = build_decision_record(event, _decision(codes=[reasons.PERMISSION_EXCESS]))

    assert record["host"]["kind"] == "dsh"
    assert record["host"]["instance_id"] == "dsh-local"
    assert record["host"]["workspace"] == "/ws"
    assert record["host"]["profile"] is None
    assert record["principal"]["id"] == "dsh:abc"
    assert record["call"]["session_id"] == "s1"
    assert record["call"]["call_id"] == "c1"
    assert record["tool"]["canonical_operation"] == "file.write"
    assert record["decision"]["dominant_reason"] == reasons.PERMISSION_EXCESS
    assert record["decision"]["deciding_layer"] == "policy"
    assert record["approval"]["initiator"] == "guard_policy"
    assert record["approval"]["channel"] == "host_native"
    assert record["timing_ms"]["total_ms"] == 12.5
    # 不保存原始参数或工具正文。
    assert "arguments" not in json.dumps(record)


def test_decision_record_marks_missing_reason_as_unattributed() -> None:
    """没有原因码时不能伪造默认原因，必须显式标记为未归因。"""
    record = build_decision_record(_event(), _decision(action="ask"))
    assert record["decision"]["reason_codes"] == [reasons.UNATTRIBUTED]
    assert record["decision"]["dominant_reason"] == reasons.UNATTRIBUTED
    assert reasons.UNATTRIBUTED not in reasons.ALL_REASON_CODES


def test_rv_escalation_owns_the_dominant_reason() -> None:
    """动作由 RV 抬升时，支配原因码必须是 rv_escalation 而不是原策略码。"""
    event = _event(deciding_layer="rv")
    record = build_decision_record(
        event, _decision(action="ask", codes=[reasons.POLICY_REQUIRES_APPROVAL, reasons.RV_ESCALATION]),
    )
    assert record["decision"]["dominant_reason"] == reasons.RV_ESCALATION


def test_public_hook_record_does_not_echo_decision_record() -> None:
    """决策记录只供审计与面板，不能随 Hook 响应回传给宿主。"""
    with tempfile.TemporaryDirectory() as tmp:
        project = Path(tmp) / "project"
        project.mkdir()
        config = project / "openclaw.json"
        config.write_text(json.dumps({"models": {"providers": {}}}), encoding="utf-8")
        services = build_services(project, config_path=config)
        result = services.handle_before_tool_call({
            "toolName": "custom_exec",
            "params": {"command": "echo safe", "cwd": str(project)},
            "runId": "record-run", "toolCallId": "record-call",
            "sessionId": "record-session", "agentId": "agent-record",
        })

        public_metadata = result["action_record"]["event"]["metadata"]
        assert "decision_record" not in public_metadata

        stored = services.action_service.get_action(result["action_record"]["action_id"])
        record = stored["event"]["metadata"]["decision_record"]
        assert record["decision"]["dominant_reason"] in reasons.ALL_REASON_CODES
