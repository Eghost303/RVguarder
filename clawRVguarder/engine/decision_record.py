"""逐调用决策记录。

一次工具调用生成一条记录，用于审批归因与实验统计。记录只保存标识、规则、
计数、缺失特征与稳定原因码，不保存工具正文、模型输出或密钥。

调用方在决策最终确定后构造一次，写入 ``event.metadata["decision_record"]``，
随动作记录持久化并进入审计链；后续 dispatch / 完成状态由宿主桥接更新到
动作记录本身，不在此重复。
"""
from __future__ import annotations

from typing import Any

from clawRVguarder import __version__
from clawRVguarder.policy import reasons

FORMAT_VERSION = 1
_MAX_ITEMS = 32
_MAX_TEXT = 512


def _bounded_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [str(item)[:_MAX_TEXT] for item in list(value)[:_MAX_ITEMS]]


def _bounded_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text[:_MAX_TEXT] if text else None


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def build_decision_record(event: Any, decision: Any, *, action: Any = None) -> dict[str, Any]:
    """构造一条逐调用决策记录；缺失字段保持显式未知，不推断补齐。"""
    metadata = _mapping(getattr(event, "metadata", None))
    policy = _mapping(getattr(decision, "policy_decision", None))
    trace = _mapping(metadata.get("authorization_trace"))
    trusted = _mapping(metadata.get("trusted_identity"))
    dsh = _mapping(metadata.get("dsh"))
    timings = _mapping(metadata.get("pipeline_timings_ms"))
    rv = _mapping(metadata.get("rv_result"))
    semantic_audit = _mapping(metadata.get("semantic_audit"))

    operation = _mapping(trace.get("operation"))
    coverage = _mapping(trace.get("coverage"))
    codes = _bounded_list(policy.get("reason_codes"))
    action_name = str(getattr(decision, "action", "") or "")
    deciding_layer = str(metadata.get("deciding_layer") or "policy")
    # 不设"默认原因"：没有码就是没有归因，交给验收统计成未知并补码。
    dominant: str | None = None
    if action_name in {"ask", "block"}:
        if deciding_layer in {"rv", "principal_rv"}:
            dominant = reasons.RV_ESCALATION
        elif codes:
            dominant = codes[0]
        else:
            codes = [reasons.UNATTRIBUTED]
            dominant = reasons.UNATTRIBUTED

    host_kind = str(metadata.get("host") or "openclaw")
    record: dict[str, Any] = {
        "format_version": FORMAT_VERSION,
        "host": {
            "kind": host_kind,
            "instance_id": _bounded_text(metadata.get("instance_id")),
            "workspace": _bounded_text(metadata.get("host_workspace")),
            "profile": _bounded_text(metadata.get("host_profile")),
            "protocol": None,
            "sdk_version": None,
        },
        "principal": {
            "id": _bounded_text(trusted.get("principal_id")),
            "type": _bounded_text(trusted.get("principal_type")),
            "agent_id": _bounded_text(trusted.get("agent_id")),
            "trust": _bounded_text(trusted.get("trust")) or "unknown",
            "lineage": _bounded_list(trusted.get("capability_lineage")),
        },
        "call": {
            "session_id": _bounded_text(dsh.get("session_id") or metadata.get("session_id")),
            "call_id": _bounded_text(dsh.get("call_id") or metadata.get("tool_call_id")),
            "parent_call_id": _bounded_text(dsh.get("parent_call_id")),
            "root_call_id": _bounded_text(dsh.get("root_call_id")),
            "parent_agent_id": _bounded_text(dsh.get("parent_agent_id")),
            "task_id": _bounded_text(metadata.get("task_id")),
        },
        "tool": {
            # 适配层会把原始工具名换成别名；原始名只保留在宿主上下文里。
            "raw_name": _bounded_text(dsh.get("tool_name") or metadata.get("tool_name")),
            "canonical_operation": _bounded_text(operation.get("family")),
            "origin": _bounded_text(metadata.get("tool_origin")) or "unknown",
            # 适配插件版本由宿主提供；DSH 协议当前不携带该字段，保持未知，
            # 不能用后端版本冒充。
            "adapter_version": _bounded_text(metadata.get("adapter_version")),
            "backend_version": __version__,
        },
        "resources": {
            "paths": _bounded_list(getattr(event, "target_paths", None)),
            "network": _bounded_list(getattr(event, "network_targets", None)),
            "scope_class": _bounded_text(metadata.get("scope_class")) or "unknown",
        },
        "evidence": {
            "coverage_status": _bounded_text(coverage.get("status")) or "unknown",
            "missing_features": _bounded_list(policy.get("missing_features")),
            "conflicts": _bounded_list(policy.get("conflicts")),
            "semantic_provider": _bounded_text(semantic_audit.get("provider")) or "local",
            "semantic_status": _bounded_text(semantic_audit.get("llm_status")) or "not_run",
        },
        "policy": {
            "version": _bounded_text(policy.get("policy_version")) or "",
            "effect": _bounded_text(policy.get("effect")) or "unknown",
            "match_status": _bounded_text(policy.get("match_status")) or "unknown",
            "selected_rule_ids": _bounded_list(policy.get("selected_rule_ids")),
            "candidate_rule_ids": _bounded_list(policy.get("candidate_rule_ids")),
            "combo_violations": _bounded_list(policy.get("combo_violations")),
            "grant_source": _bounded_text(policy.get("grant_source")) or "",
            "grant_validation_gaps": _bounded_list(policy.get("grant_validation_gaps")),
            "permission_diff": {
                "requested_delta": _bounded_list(policy.get("requested_delta")),
                "excessive": _bounded_list(policy.get("excessive_permissions")),
                "scope_expansions": _bounded_list(policy.get("scope_expansions")),
            },
        },
        "rv": {
            "verdict": _bounded_text(rv.get("verdict")) or "not_run",
            "triggered_by": _bounded_text(rv.get("triggered_by")),
            "triggered_rule_id": _bounded_text(rv.get("triggered_rule_id")),
            "trigger_step_id": _bounded_text(rv.get("trigger_step_id")),
            "matched_steps": _bounded_list(rv.get("matched_history_step_ids")),
            "session_key": _bounded_text(metadata.get("rv_session_key")),
        },
        "principal_rv": {
            "effect": _bounded_text(_mapping(metadata.get("principal_rv")).get("effect")) or "none",
            "reason": _bounded_text(_mapping(metadata.get("principal_rv")).get("reason")) or "no_escalation",
        },
        "decision": {
            "action": action_name or "unknown",
            "risk_level": _bounded_text(getattr(decision, "risk_level", None)) or "unknown",
            "deciding_layer": deciding_layer,
            "reason_codes": codes,
            "dominant_reason": dominant,
        },
        "approval": {
            # Guard 决定是否审批，宿主负责呈现与应答；两者分开记录，
            # 不能把宿主通道当成审批发起方。
            "initiator": "guard_policy",
            "channel": "host_native" if host_kind == "dsh" else "openclaw_native",
            "request_id": None,
            "decision": _bounded_text(getattr(action, "decision_state", None)) if action is not None else None,
        },
        "execution": {
            "state": _bounded_text(getattr(action, "execution_state", None)) if action is not None else None,
            "dispatch": "pending",
            "completion": "pending",
        },
        "timing_ms": {
            key: timings.get(key)
            for key in ("semantic_ms", "policy_ms", "rv_ms", "controller_ms", "total_ms")
            if timings.get(key) is not None
        },
    }
    return record
