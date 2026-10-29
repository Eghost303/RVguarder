"""热路径安全决策流水线 —— 从 manager.py 提取的协调函数。

本模块包含：
- ingest_event_pipeline: 聊天路径流水线（collect → detect → RV → controller → save）
- handle_before_tool_call_pipeline: Hook 路径流水线（OpenClaw 审批门）
- handle_after_tool_call_pipeline: 执行后流水线（状态更新 + 审计）
- 共享私有工具函数: _annotate_event_context, _apply_rv_if_available 等

所有函数接收 GuardServices 容器作为首个参数，
从中读取 PMKB policy_engine / controller / rv_engine / audit_store 等组件。
"""

from __future__ import annotations

from copy import deepcopy
import time
from pathlib import Path
from typing import Any, TYPE_CHECKING

from clawRVguarder.integrations.tool_hook_bridge import (
    build_hook_event,
    build_hook_source_message,
    hook_key_from_payload,
)
from clawRVguarder.engine.command_safety import analyze_command
from clawRVguarder.engine.approval import build_approval_presentation
from clawRVguarder.engine.decision_record import build_decision_record
from clawRVguarder.engine.experiment_components import current as _experiment_components
from clawRVguarder.policy import reasons
from clawRVguarder.utils import utc_now_iso
if TYPE_CHECKING:
    from clawRVguarder.services import GuardServices


MAX_OPENCLAW_APPROVAL_DESCRIPTION_CHARS = 512
MAX_OPENCLAW_APPROVAL_TITLE_CHARS = 80


# ---------------------------------------------------------------------------
# 共享工具函数
# ---------------------------------------------------------------------------


def _ensure_pipeline_timings(event: Any) -> dict[str, Any]:
    """确保 event.metadata 中存在 pipeline_timings_ms 字典。"""
    metadata = getattr(event, "metadata", None)
    if not isinstance(metadata, dict):
        return {}
    timings = metadata.get("pipeline_timings_ms")
    if not isinstance(timings, dict):
        timings = {}
        metadata["pipeline_timings_ms"] = timings
    return timings


def _resolve_rv_session_key(event: Any) -> str:
    """解析 RV 会话键用于 per-session 窗口隔离。

    优先级：
    1. Hook bridge 事件：使用 metadata 中的 session_id/hook_key
    2. Chat 事件：使用 raw_payload 中的 sessionId
    3. 默认："_default"（向后兼容）
    """
    metadata = getattr(event, "metadata", {}) or {}
    raw = getattr(event, "raw_payload", {}) or {}

    # Hook 事件优先使用 session_id
    session_id = str(metadata.get("session_id") or raw.get("sessionId") or "")
    if session_id:
        return f"session_{session_id}"

    # 回退到 session_key
    session_key = str(metadata.get("session_key") or raw.get("sessionKey") or "")
    if session_key:
        return f"session_{session_key}"

    return "_default"


def annotate_scope(
    event: Any,
    *,
    workspace_path: str | Path | None,
    source_root: str | Path | None = None,
    project_dir: str | Path | None = None,
) -> str:
    """标注事件的工作区边界元数据（原地修改 ``event.metadata``）。

    该函数是"事件预处理"的唯一实现，被**在线 Hook 流水线**与**离线语义录制器**
    共用。语义提示词只包含净化后的字段，其中 ``outside_workspace`` 是唯一的派生
    事实；只要录制与运行时使用同一份预处理，两者的 ``prompt_sha256`` 才可比，
    冻结回放才不会因预处理分叉而漂移。
    """
    roots: list[tuple[str, Path]] = []
    if workspace_path:
        roots.append(("workspace", Path(workspace_path).expanduser()))
    if source_root:
        roots.append(("managed_project", Path(source_root).expanduser()))
    if project_dir:
        roots.append(("managed_project", Path(project_dir).expanduser()))
    command_safety = analyze_command(event.command)
    event.metadata["command_safety"] = command_safety.to_dict()
    scope_class = _classify_scope(
        [*event.target_paths, *event.network_targets, *command_safety.path_hints],
        roots=roots,
        working_directory=event.working_directory,
    )
    if scope_class == "unknown" and command_safety.safe_read_only:
        scope_class = "workspace" if workspace_path else "managed_project"
    event.metadata["scope_class"] = scope_class
    event.metadata["outside_workspace"] = scope_class in {"outside", "external", "unknown"}
    if len(event.target_paths) > 1:
        event.metadata["multi-target"] = True
    return scope_class


def _annotate_event_context(
    services: GuardServices,
    event: Any,
    *,
    source_message: str = "",
    origin: str = "unknown",
    host_semantic_response: str | None = None,
    host_semantic_mode: bool = False,
) -> None:
    """为事件标注工作区边界 + 语义分析 + RV trace。

    原地修改 event.metadata。
    """
    if "current_permissions" not in event.metadata and isinstance(event.raw_payload, dict):
        raw_grants = event.raw_payload.get("current_permissions")
        if isinstance(raw_grants, list):
            event.metadata["current_permissions"] = raw_grants
    workspace = event.metadata.get("host_workspace") or services.context.target.workspace_path
    # DSH 的 project_dir 是 Guard 实例数据目录（令牌、授权库、审计），不是受管项目；
    # 把它登记成 managed_project 会让 P1-PROCESS-READONLY 自动放行读取令牌。
    host_kind = getattr(getattr(services, "action_service", None), "host_kind", "openclaw")
    annotate_scope(
        event,
        workspace_path=workspace,
        source_root=services.context.target.source_root,
        project_dir=None if host_kind == "dsh" else services.context.paths.project_dir,
    )
    semantic_started = time.perf_counter()
    semantic_context = {
        "source_message": source_message,
        "origin": origin,
        "workspace_path": str(workspace) if workspace else None,
    }
    if host_semantic_mode:
        semantic_payload = services.semantic_enhancer.evaluate_host_response(
            event, semantic_context, host_semantic_response
        )
    else:
        semantic_payload = services.semantic_enhancer.evaluate(event, semantic_context)
    _merge_deterministic_semantics(event, semantic_payload)
    timings = _ensure_pipeline_timings(event)
    timings["semantic_ms"] = round((time.perf_counter() - semantic_started) * 1000.0, 3)
    event.metadata["semantic"] = semantic_payload["semantic"]
    event.metadata["semantic_match"] = semantic_payload["semantic_match"]
    event.metadata["semantic_audit"] = semantic_payload["semantic_audit"]
    run_id = str(event.metadata.get("run_id") or "").strip()
    tool_call_id = str(event.metadata.get("tool_call_id") or "").strip()
    call_identity = f"{run_id}:{tool_call_id}" if run_id and tool_call_id else str(event.event_id)
    event.metadata["rv_trace"] = [
        {**step, "step_id": f"{call_identity}:{index}"}
        for index, step in enumerate(semantic_payload["rv_trace"], 1)
    ]
    policy_engine = getattr(services, "policy_engine", None)
    if policy_engine is not None:
        authorization_trace = policy_engine.compile_trace(event, source_message=source_message)
        event.metadata["authorization_trace"] = authorization_trace.model_dump()
    from clawRVguarder.rv.tool_events import build_tool_call_step
    event.metadata["semantic_rv_trace"] = event.metadata["rv_trace"]
    event.metadata["rv_trace"] = (
        [] if event.action_type == "chat_message" and not event.metadata.get("hook_bridge")
        else [build_tool_call_step(event, event.metadata.get("authorization_trace"))]
    )

    # 一个真实工具调用仍仅有一个ToolCallIR；引用证据不新增工具事件、
    # 不改变效果或标签，也不作为自动放行证明。
    event.metadata.pop("host_authorization", None)
    bridge = getattr(services, "host_authorization_bridge", None)
    if bridge is not None and _experiment_components().authorization and event.metadata["rv_trace"]:
        step = event.metadata["rv_trace"][0]
        evidence = bridge.submit(event, step)
        event.metadata["host_authorization"] = evidence
        step["context"]["host_authorization"] = evidence
        preparation = getattr(bridge, "decision_preparation", None)
        if preparation is not None:
            event.metadata["call_authorization_preparation"] = preparation.prepare(event, step)
    if bridge is not None and _experiment_components().cross_session_rv and event.metadata["rv_trace"]:
        history_preparation = getattr(bridge, "history_preparation", None)
        if history_preparation is not None:
            event.metadata["cross_session_history_preparation"] = history_preparation.prepare(event, event.metadata["rv_trace"][0])




def _classify_scope(
    paths: list[str],
    *,
    roots: list[tuple[str, Path]],
    working_directory: str | None = None,
) -> str:
    """Classify targets against workspace and explicitly managed project roots."""
    if not roots:
        return "unknown"
    default_base = Path(working_directory).expanduser() if working_directory else roots[0][1]
    if working_directory and not default_base.is_absolute():
        default_base = roots[0][1] / default_base
    if not paths and not working_directory:
        return "unknown"
    candidates = list(paths) or [str(default_base)]
    matched: list[str] = []
    for raw in candidates:
        # 网络目的地在任何根之外，必须先于路径解析判定，否则会被拼成相对路径。
        if str(raw).strip().lower().startswith(("http://", "https://")):
            return "external"
        path = Path(str(raw)).expanduser()
        if not path.is_absolute():
            path = default_base / path
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path.absolute()
        labels = []
        for label, root in roots:
            try:
                resolved.relative_to(root.resolve())
                labels.append(label)
            except (OSError, ValueError):
                continue
        if not labels:
            return "external" if str(raw).lower().startswith(("http://", "https://")) else "outside"
        matched.append("workspace" if "workspace" in labels and "managed_project" not in labels else "managed_project")
    if "managed_project" in matched:
        return "managed_project"
    return "workspace"


def _merge_deterministic_semantics(event: Any, semantic_payload: dict[str, Any]) -> None:
    """Overlay non-LLM command facts before PMKB/RV consume semantic labels."""
    safety = event.metadata.get("command_safety")
    if not isinstance(safety, dict):
        return
    semantic = semantic_payload.get("semantic")
    if not isinstance(semantic, dict):
        return
    labels = {str(item) for item in semantic.get("labels", [])}
    if safety.get("safe_read_only") is True:
        labels.add("command_readonly")
    semantic["labels"] = sorted(labels)
    semantic["command_safety"] = safety
    for step in semantic_payload.get("rv_trace", []):
        if isinstance(step, dict):
            props = {str(item) for item in step.get("props", [])}
            if safety.get("safe_read_only") is True:
                props.add("command_readonly")
            step["props"] = sorted(props)


def _apply_policy_engine(
    services: GuardServices,
    event: Any,
    decision: Any,
    *,
    source_message: str = "",
) -> Any:
    """Attach PMKB evidence to the controller decision if it is absent."""
    if getattr(decision, "policy_decision", None):
        return decision
    policy_engine = getattr(services, "policy_engine", None)
    if policy_engine is None:
        return decision
    policy_started = time.perf_counter()
    policy_decision = policy_engine.evaluate(event, source_message=source_message)
    timings = _ensure_pipeline_timings(event)
    timings["policy_ms"] = round((time.perf_counter() - policy_started) * 1000.0, 3)
    decision.policy_decision = policy_decision.model_dump(mode="json")
    decision.trace = list(decision.trace) + [{
        "stage": "pmkb",
        "effect": policy_decision.effect,
        "match_status": policy_decision.match_status,
        "selected_rule_ids": list(policy_decision.selected_rule_ids),
        "combo_violations": list(policy_decision.combo_violations),
    }]

    action_for_effect = {
        "block": "block",
        "openclaw_approval": "ask",
        "auto_allow_audit": "allow",
    }
    severity = {"allow": 1, "ask": 2, "block": 3}
    prior_action = getattr(decision, "action", "allow")
    policy_action = action_for_effect[policy_decision.effect]
    if severity[policy_action] > severity.get(prior_action, 1):
        decision.action = policy_action
        decision.reason = f"[PMKB] {policy_decision.effect} (原有: {prior_action})"
        if policy_action == "block":
            decision.risk_level = "blocked"
        elif policy_action == "ask":
            decision.risk_level = "caution"
        decision.rule_ids = list(decision.rule_ids) + list(policy_decision.selected_rule_ids) + list(policy_decision.combo_violations)
    return decision


def _mark_step_observed(step: dict[str, Any], completion_evidence: dict[str, Any]) -> dict[str, Any]:
    """把认证成功完成后的步骤标记为已观测。

    仅升级预期/潜在效果；未识别效果保持 unknown。``verified`` 只有在收据
    核验后才为真，宿主成功回调只能证明"报告成功"。
    """
    evidence = [
        {**item, "status": "observed", "basis": "host_report", "verified": False}
        if item.get("status") in {"expected", "potential"} else item
        for item in step.get("effect_evidence", [])
    ]
    observed_props = [f"effect_observed:{item['effect']}" for item in evidence
                      if item.get("status") == "observed" and item.get("effect")]
    return {
        **step,
        "execution_state": "succeeded",
        "effect_evidence": evidence,
        # 规则按标签匹配，提交时必须把已观测标签一并补上。
        "props": list(dict.fromkeys([*step.get("props", []), *observed_props])),
        "observation": {
            "state": "reported_succeeded", "source": "host_callback",
            "verified": False, "receipt_id": None,
            "content_lineage_verified": False,
        },
        "provenance": {**step.get("provenance", {}), "completion_evidence": completion_evidence},
    }


def _apply_task_authorization(services: Any, event: Any, decision: Any) -> Any:
    """把落在有界任务授权内的"纯策略审批"降为允许。

    只处理和 RV 之前完全由策略要求审批的调用：任何未知工具、缺失证据、
    权限差分、组合风险或 RV 升权都不会被任务授权覆盖。
    """
    store = getattr(services, "task_authorization", None)
    resolve_task = getattr(services, "resolve_task_id", None)
    if store is None or resolve_task is None or getattr(decision, "action", "") != "ask":
        return decision
    policy = dict(getattr(decision, "policy_decision", None) or {})
    if str(policy.get("effect")) != "openclaw_approval":
        return decision
    # 只允许"策略本身要求审批"这一种原因；其他原因一律保持原裁决。
    if set(policy.get("reason_codes") or []) != {reasons.POLICY_REQUIRES_APPROVAL}:
        return decision
    metadata = getattr(event, "metadata", None) or {}
    trace = metadata.get("authorization_trace") or {}
    operation = str((trace.get("operation") or {}).get("family") or "")
    if str(metadata.get("scope_class")) != "workspace":
        return decision
    task_id = resolve_task(event)
    if not task_id:
        return decision
    trusted = metadata.get("trusted_identity") or {}
    workspace_path = metadata.get("host_workspace")
    if workspace_path is None:
        return decision
    common = {
        "task_id": task_id,
        "principal_id": str(trusted.get("principal_id") or ""),
        "agent_id": str((metadata.get("dsh") or {}).get("agent_id") or ""),
        "session_id": str((metadata.get("dsh") or {}).get("session_id") or ""),
    }

    if operation in {"file.read", "file.write"}:
        paths = list(getattr(event, "target_paths", None) or [])
        if len(paths) != 1:
            return decision
        grant = store.match(operation=operation, scope="workspace", path=paths[0],
                            workspace_root=workspace_path, **common)
        if grant is None:
            return decision
        _allow_with_reason(decision, metadata, reasons.TASK_GRANT)
        metadata["task_grant_id"] = grant["grant_id"]
        return decision

    return decision


def _apply_task_command_reuse(services: Any, event: Any, decision: Any) -> Any:
    """测试/构建命令复用。

    只降级两种"纯策略"情形：策略本身要求审批，或 RV 因该命令**效果未建模**
    而要求审批。链式升权（其它 monitor/规则）与阻断一律保持原判。
    必须在 RV overlay 之后调用。
    """
    store = getattr(services, "task_authorization", None)
    resolve_task = getattr(services, "resolve_task_id", None)
    if store is None or resolve_task is None or getattr(decision, "action", "") != "ask":
        return decision
    metadata = getattr(event, "metadata", None) or {}
    policy = dict(getattr(decision, "policy_decision", None) or {})
    codes = set(policy.get("reason_codes") or [])
    policy_ask = (str(policy.get("effect")) == "openclaw_approval"
                  and codes == {reasons.POLICY_REQUIRES_APPROVAL})
    rv = metadata.get("rv_result") or {}
    unmodeled_ask = (
        metadata.get("deciding_layer") == "rv"
        and str(rv.get("verdict") or "") == "ask"
        and str(rv.get("triggered_rule_id") or "") == "tool_unmodeled_effect_ask"
        and not rv.get("hard_block_evidence")
    )
    if not (policy_ask or unmodeled_ask):
        return decision
    if str(metadata.get("scope_class")) != "workspace":
        return decision
    task_id = resolve_task(event)
    if not task_id:
        return decision
    from clawRVguarder.policy.command_classes import classify_command

    command_class = classify_command(getattr(event, "command", None))
    if command_class is None:
        return decision
    metadata["command_class"] = command_class
    trusted = metadata.get("trusted_identity") or {}
    dsh = metadata.get("dsh") or {}
    if not store.match_command_approval(
        task_id=task_id,
        principal_id=str(trusted.get("principal_id") or ""),
        agent_id=str(dsh.get("agent_id") or ""),
        session_id=str(dsh.get("session_id") or ""),
        command_class=command_class,
    ):
        return decision
    _allow_with_reason(decision, metadata, reasons.TASK_COMMAND_REUSE)
    return decision


def _allow_with_reason(decision: Any, metadata: dict[str, Any], reason_code: str) -> None:
    """把裁决降为允许，并留下可审计的依据。"""
    decision.action = "allow"
    decision.risk_level = "safe"
    decision.reason = "符合宿主签发的任务范围，自动放行。"
    policy = dict(getattr(decision, "policy_decision", None) or {})
    metadata["policy_before_task_grant"] = dict(policy)
    policy["effect"] = "auto_allow_audit"
    policy["reason_codes"] = [reason_code]
    decision.policy_decision = policy
    metadata["deciding_layer"] = reason_code


def _apply_rv_if_available(
    services: GuardServices,
    event: Any,
    decision: Any,
) -> Any:
    """在现有 detection decision 上叠加 RV 判定。

    RV 判定仅在 rv_trace 存在时执行。如果 RV 的风险等级高于
    原有 detection 判定，则覆盖 action/reason/rule_ids。

    支持 per-session 窗口隔离：不同 OpenClaw 会话拥有独立的 RV 窗口。
    """
    rv_trace = event.metadata.get("rv_trace", [])
    if not rv_trace:
        timings = _ensure_pipeline_timings(event)
        timings.setdefault("rv_ms", 0.0)
        return decision

    # RV 总开关（preferences.rv_mode）：关闭后跳过 RV overlay 判定
    if not services.rv_enabled():
        timings = _ensure_pipeline_timings(event)
        timings.setdefault("rv_ms", 0.0)
        return decision

    # Per-session 窗口隔离
    session_key = _resolve_rv_session_key(event)

    rv_started = time.perf_counter()
    rv_result = services.rv_engine.preview(
        rv_trace,
        session_key=session_key,
        authorization_trace=event.metadata.get("authorization_trace"),
        policy_decision=getattr(decision, "policy_decision", None),
    )
    timings = _ensure_pipeline_timings(event)
    timings["rv_ms"] = round((time.perf_counter() - rv_started) * 1000.0, 3)
    event.metadata["rv_result"] = rv_result
    event.metadata["rv_session_key"] = session_key

    rv_severity = {"block": 3, "escalate": 2, "ask": 2, "ok": 1}
    det_severity = {"block": 3, "ask": 2, "allow": 1}

    rv_level = rv_severity.get(rv_result["verdict"], 0)
    det_action = getattr(decision, "action", "allow")
    det_level = det_severity.get(det_action, 1)

    if rv_level > det_level:
        decision.action = "ask" if rv_result["verdict"] == "escalate" else rv_result["verdict"]
        decision.reason = (
            f"[RV] {rv_result.get('reason', '')} "
            f"(原有: {det_action})"
        )
        if rv_result.get("triggered_by"):
            decision.rule_ids = list(decision.rule_ids) + [
                f"RV-{rv_result['triggered_by']}"
            ]
        policy = getattr(decision, "policy_decision", None)
        if isinstance(policy, dict):
            codes = list(policy.get("reason_codes") or [])
            if "rv_escalation" not in codes:
                codes.append("rv_escalation")
            policy["reason_codes"] = codes
        event.metadata["deciding_layer"] = "rv"
    return decision


# ---------------------------------------------------------------------------
# 公共流水线入口
# ---------------------------------------------------------------------------


def ingest_event_pipeline(
    services: GuardServices,
    payload: dict[str, Any],
    source_message: str = "",
    *,
    auto_execute: bool = True,
) -> dict[str, Any]:
    """聊天路径安全判定流水线。

    collect → annotate → PMKB decision → RV overlay → controller → save → audit.
    """
    started = time.perf_counter()
    event = services.collectors.ingest(payload)
    _annotate_event_context(services, event, source_message=source_message, origin="chat")
    policy_started = time.perf_counter()
    decision = services.policy_engine.decide(event, source_message=source_message)
    timings = _ensure_pipeline_timings(event)
    timings["policy_ms"] = round((time.perf_counter() - policy_started) * 1000.0, 3)
    decision = _apply_rv_if_available(services, event, decision)
    timings = _ensure_pipeline_timings(event)
    timings.setdefault("rv_ms", 0.0)
    controller_started = time.perf_counter()
    controlled = services.controller.decide(event, decision, source_message or payload.get("raw_user_intent", ""))
    timings = _ensure_pipeline_timings(event)
    timings["controller_ms"] = round((time.perf_counter() - controller_started) * 1000.0, 3)
    timings["total_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
    services._save_action(controlled)
    event_record = services.events.publish("action.created", {
        "action_id": controlled.action_id,
        "source": controlled.source,
        "status": controlled.status,
    })
    controlled.last_event_seq = event_record["seq"]
    services._save_all(services._replace_action(controlled))
    services.audit_store.append("detection_decision", controlled.to_dict())
    services._log("detection_decision", action_id=controlled.action_id, status=controlled.status, decision=controlled.decision.action)
    if auto_execute and controlled.status == "proposed":
        return services._execute(controlled.action_id)
    return controlled.to_dict()


def handle_before_tool_call_pipeline(
    services: GuardServices,
    payload: dict[str, Any],
    *,
    wait_timeout_ms: int | None = None,
    host_semantic_response: str | None = None,
    host_semantic_mode: bool = False,
) -> dict[str, Any]:
    """Hook 路径安全判定流水线 —— OpenClaw 审批门。

    build_hook_event → annotate → PMKB decision → RV overlay → controller → save → 返回 Hook 响应。
    """
    started = time.perf_counter()

    # 标记该会话中缺失 after 回调的孤儿动作，避免伪造成功状态。
    services.action_service.expire_pending_hook_actions()
    session_id = str(payload.get("sessionId") or "")
    if session_id:
        services._mark_orphaned_previous_actions(session_id)

    adapter = getattr(services, "host_adapter", None)
    event = adapter.build_event(payload, services.context) if adapter else build_hook_event(payload, managed_project_root=services.context.paths.project_dir)
    hook_source_message = adapter.source_message(event) if adapter else build_hook_source_message(event)
    _annotate_event_context(
        services,
        event,
        source_message=hook_source_message,
        origin="hook",
        host_semantic_response=host_semantic_response,
        host_semantic_mode=host_semantic_mode,
    )
    policy_started = time.perf_counter()
    decision = services.policy_engine.decide(event, source_message=hook_source_message)
    timings = _ensure_pipeline_timings(event)
    timings["policy_ms"] = round((time.perf_counter() - policy_started) * 1000.0, 3)
    decision = _apply_task_authorization(services, event, decision)
    decision = _apply_rv_if_available(services, event, decision)
    decision = _apply_task_command_reuse(services, event, decision)
    timings = _ensure_pipeline_timings(event)
    timings.setdefault("rv_ms", 0.0)
    controller_started = time.perf_counter()
    controlled = services.controller.decide(event, decision, hook_source_message)
    presentation = build_approval_presentation(controlled.event, controlled.decision)
    controlled.event.metadata["approval_presentation"] = presentation
    if (
        controlled.status == "pending_approval"
        and adapter is None
        and presentation["allow_always"]["eligible"]
        and _experiment_components().approval_trust
        and services.approval_trust.contains(presentation["allow_always"]["fingerprint"])
    ):
        controlled.status = "proposed"
        controlled.decision.action = "allow"
        controlled.decision.risk_level = "safe"
        controlled.decision.reason = "命中已授权的精确命令信任，自动放行。"
        controlled.decision.trace = list(controlled.decision.trace) + [{"stage": "approval_trust", "outcome": "allow"}]
        controlled.decision_trace = controlled.decision.trace
        controlled.decision_state = "allowed"
        controlled.execution_state = "running"
        controlled.event.metadata["approval_trust_reused"] = True
        controlled.event.metadata["deciding_layer"] = "approval_trust"
        presentation["risk_summary"] = {
            "level": "safe",
            "reason": controlled.decision.reason,
        }
        controlled.event.metadata["approval_presentation"] = presentation
    if controlled.status in {"blocked", "pending_approval"}:
        user_title, user_message = _user_explanation(controlled.event, controlled.decision)
        controlled.decision.user_title = user_title
        controlled.decision.user_message = user_message
    timings = _ensure_pipeline_timings(event)
    timings["controller_ms"] = round((time.perf_counter() - controller_started) * 1000.0, 3)
    timings["total_ms"] = round((time.perf_counter() - started) * 1000.0, 3)

    hook_key = str(event.metadata.get("hook_key") or hook_key_from_payload(payload))
    controlled.event.metadata["hook_key"] = hook_key
    controlled.event.metadata["hook_bridge"] = True
    controlled.execution_result = {
        "mode": "openclaw-before-tool-call",
        "tool_name": event.metadata.get("tool_name"),
    }
    controlled.source = "hook_bridge"
    controlled.decision_state = "pending" if controlled.status == "pending_approval" else ("denied" if controlled.status == "blocked" else "allowed")
    controlled.execution_state = "not_started" if controlled.status in {"pending_approval", "blocked"} else "running"
    controlled.sync_state = "local_only"
    controlled.event.metadata["decision_record"] = build_decision_record(
        controlled.event, controlled.decision, action=controlled,
    )
    services._save_action(controlled)
    event_record = services.events.publish("action.created", {
        "action_id": controlled.action_id,
        "source": "hook_bridge",
        "status": controlled.status,
    })
    controlled.last_event_seq = event_record["seq"]
    # _replace_action already durably saves the updated action list. Preserve
    # that synchronous commit before audit/response without a second full write.
    services._replace_action(controlled)
    services.audit_store.append("hook_before_tool_call", controlled.to_dict())
    services._log(
        "hook_before_tool_call",
        action_id=controlled.action_id,
        hook_key=hook_key,
        tool_name=event.metadata.get("tool_name"),
        decision=controlled.decision.action,
    )

    if controlled.status == "blocked":
        title, message = _user_explanation(controlled.event, controlled.decision)
        policy = controlled.decision.policy_decision or {}
        return {
            "action": "block",
            "blockReason": message,
            "title": title,
            "message": message,
            "technical_reason": controlled.decision.reason,
            "user_summary": _user_summary(controlled.event, controlled.decision),
            "approval": presentation,
            "policy_version": policy.get("policy_version", ""),
            "action_record": _public_hook_action_record(controlled, presentation),
        }

    if controlled.status == "proposed":
        controlled.status = "executing"
        controlled.execution_result["approved_at"] = utc_now_iso()
        services._replace_action(controlled)
        return {
            "action": "allow",
            **_execution_permit_response(services, event),
            "params": payload.get("params") if isinstance(payload.get("params"), dict) else {},
            "action_record": _public_hook_action_record(controlled, presentation),
        }

    if controlled.status == "pending_approval":
        title, message = _approval_prompt_text(presentation, controlled.decision)
        policy = controlled.decision.policy_decision or {}
        return {
            "action": "require_approval",
            **_execution_permit_response(services, event),
            "title": title,
            "message": message,
            "technical_reason": controlled.decision.reason,
            "user_summary": _user_summary(controlled.event, controlled.decision),
            "approval": presentation,
            "allowed_decisions": [
                "allow-once",
                "allow-always",
                "deny",
            ] if presentation["allow_always"]["eligible"] else ["allow-once", "deny"],
            "policy_version": policy.get("policy_version", ""),
            "severity": "warning",
            "action_record": _public_hook_action_record(controlled, presentation),
        }

    return {
        "action": "allow",
        **_execution_permit_response(services, event),
        "params": payload.get("params") if isinstance(payload.get("params"), dict) else {},
        "action_record": _public_hook_action_record(controlled, presentation),
    }


def _execution_permit_response(services: GuardServices, event: Any) -> dict:
    """只向实际发生授权例外的单次调用返回宿主执行许可，block不走此分支。"""
    preparation = getattr(getattr(services, "host_authorization_bridge", None), "decision_preparation", None)
    exceptions = (event.metadata.get("rv_result") or {}).get("authorization_exceptions") or []
    steps = event.metadata.get("rv_trace") or []
    if preparation is None or not exceptions or len(steps) != 1:
        return {}
    permit = preparation.permit_for_exceptions(steps[0].get("step_id"), exceptions)
    # 例外与响应之间若事实失效，执行器仍必须核验许可；缺失许可不能
    # 静默回到未检查撤销的默认执行分支。
    return {"executionPermitRequired": True, "executionPermit": permit}


def _user_summary(event: Any, decision: Any) -> dict[str, str]:
    native_operation = {
        "session.read": "读取会话",
        "memory.read": "搜索记忆",
        "goal.read": "读取目标",
        "plan.write": "更新计划",
        "goal.write": "更新目标",
    }.get(str(event.metadata.get("permission_family") or ""))
    operation = {
        "command_exec": "执行命令",
        "file_read": "读取文件",
        "file_write": "修改文件",
        "file_delete": "删除文件",
        "network_egress": "访问网络",
        "channel_send": "发送消息",
        "config_modify": "修改配置",
        "skill_run": "运行技能",
    }.get(str(getattr(event, "action_type", "")), "调用工具")
    if native_operation:
        operation = native_operation
    scope = str(event.metadata.get("scope_class") or "未知范围")
    risk = {"safe": "低风险", "caution": "需确认", "dangerous": "高风险", "blocked": "已阻断"}.get(str(getattr(decision, "risk_level", "")), "需确认")
    return {"operation": operation, "target": scope, "risk": risk, "recommendation": "确认目标和范围后允许一次"}


def _user_explanation(event: Any, decision: Any) -> tuple[str, str]:
    summary = _user_summary(event, decision)
    action_type = str(getattr(event, "action_type", ""))
    target = str(build_approval_presentation(event, decision).get("target_summary") or "")
    labels = {
        "command_exec": ("执行命令", "执行命令"),
        "file_delete": ("删除文件", "删除文件"),
        "file_write": ("修改文件", "修改文件"),
        "network_egress": ("访问网络", "访问网络"),
        "channel_send": ("发送消息", "发送消息"),
    }
    detail, title_detail = labels.get(action_type, (summary["operation"], summary["operation"]))
    if getattr(decision, "action", "") == "block":
        title = f"已阻止：{title_detail}"
        message = f"检测到一次{detail}操作，目标范围为{summary['target']}，存在{summary['risk']}风险，已阻止执行。"
        return _bound_user_explanation(title, message)
    target_text = f"目标为 {target}。" if target else f"目标范围为{summary['target']}。"
    title = f"需要确认：{title_detail}"
    message = f"OpenClaw 请求{detail}。{target_text}当前判断为{summary['risk']}，请确认目标和范围后再继续。"
    return _bound_user_explanation(title, message)


def _public_hook_action_record(action: Any, presentation: dict[str, Any]) -> dict[str, Any]:
    """Return the Hook response record without replaying the raw request.

    Guard keeps the complete event internally for audit and the dashboard.
    OpenClaw only needs the action id and compact decision evidence; returning
    the original payload here would echo credentials back through the Hook.
    """
    record = deepcopy(action.to_dict())
    record["source_message"] = str(presentation.get("intent_summary") or "OpenClaw 工具请求")
    record["target_summary"] = str(presentation.get("target_summary") or "未知范围")
    event = record.get("event") if isinstance(record.get("event"), dict) else {}
    event["raw_payload"] = {}
    event["command"] = presentation.get("command_preview") or None
    if event.get("target_paths"):
        event["target_paths"] = [record["target_summary"]]
    if event.get("network_targets"):
        event["network_targets"] = [record["target_summary"]]
    metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    metadata["derived_paths"] = []
    # 逐调用决策记录只供审计与面板使用，不回传给宿主。
    metadata.pop("decision_record", None)
    semantic = metadata.get("semantic")
    if isinstance(semantic, dict):
        intent = semantic.get("intent")
        if isinstance(intent, dict):
            intent["goal"] = str(presentation.get("intent_summary") or "调用工具")
    _scrub_public_trace(metadata)
    event["metadata"] = metadata
    record["event"] = event
    _scrub_public_trace(record.get("decision"))
    return record


def _scrub_public_trace(value: Any) -> None:
    """Remove path/URL/resource collections from a public Hook record."""
    if isinstance(value, dict):
        if "arguments" in value:
            value["arguments"] = {}
        if value.get("kind") in {"paths", "urls", "recipients"} and "values" in value:
            value["values"] = ["[REDACTED]"] if value["values"] else []
        if "type" in value and "ids" in value:
            value["ids"] = ["[REDACTED]"] if value["ids"] else []
        for key in ("paths", "urls", "target_paths", "network_targets", "resource_ids", "path_hints"):
            if key in value:
                value[key] = ["[REDACTED]"] if value[key] else []
        if "command" in value:
            value["command"] = "[REDACTED]"
        if "argv" in value:
            value["argv"] = ["[REDACTED]"] if value["argv"] else []
        for child in value.values():
            _scrub_public_trace(child)
    elif isinstance(value, list):
        for child in value:
            _scrub_public_trace(child)


def _approval_prompt_text(presentation: dict[str, Any], decision: Any) -> tuple[str, str]:
    """Build the compact OpenClaw prompt; full evidence stays on Guard."""
    intent = str(presentation.get("intent_summary") or "调用工具")
    target = str(presentation.get("target_summary") or "未知范围")
    risk = presentation.get("risk_summary") if isinstance(presentation.get("risk_summary"), dict) else {}
    risk_level = str(risk.get("level") or getattr(decision, "risk_level", "caution"))
    risk_label = {"safe": "低风险", "caution": "需确认", "dangerous": "高风险", "blocked": "已阻断"}.get(risk_level, "需确认")
    title = f"需要确认：{intent}"
    message = f"要做什么：{intent}。目标：{target}。风险：{risk_label}。请在 OpenClaw 中选择是否继续。"
    return _bound_user_explanation(title, message)


def _bound_user_explanation(title: str, message: str) -> tuple[str, str]:
    """Keep OpenClaw-visible approval fields within documented schema limits."""
    bounded_title = title.strip()[:MAX_OPENCLAW_APPROVAL_TITLE_CHARS]
    bounded_message = message.strip()
    if len(bounded_message) > MAX_OPENCLAW_APPROVAL_DESCRIPTION_CHARS:
        bounded_message = bounded_message[: MAX_OPENCLAW_APPROVAL_DESCRIPTION_CHARS - 1].rstrip() + "…"
    return bounded_title, bounded_message


def handle_after_tool_call_pipeline(
    services: GuardServices,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """执行后状态更新流水线。

    查找 → 更新 execution_result → 标记 failed/executed → save → audit.
    """
    hook_key = hook_key_from_payload(payload)
    action = services._find_action_by_hook_key(hook_key)
    if action is None:
        return {"ok": False, "error": "action_not_found", "hook_key": hook_key}
    expected = action.event.metadata
    authenticated_before = expected.get("hook_auth_verified") is True
    if authenticated_before and (
        payload.get("_hook_auth_verified") is not True
        or not expected.get("hook_auth_binding")
        or payload.get("_hook_auth_binding") != expected.get("hook_auth_binding")
    ):
        return {"ok": False, "error": "hook_auth_binding_mismatch", "hook_key": hook_key}
    context_pairs = (
        ("tool_name", payload.get("toolName")),
        ("run_id", payload.get("runId")),
        ("tool_call_id", payload.get("toolCallId")),
        ("agent_id", payload.get("agentId")),
        ("session_key", payload.get("sessionKey")),
        ("session_id", payload.get("sessionId")),
    )
    mismatches = [
        key for key, actual in context_pairs
        if str(expected.get(key) or "").strip()
        and (authenticated_before or str(actual or "").strip())
        and str(expected.get(key)).strip() != str(actual or "").strip()
    ]
    if mismatches:
        return {
            "ok": False,
            "error": "hook_context_mismatch",
            "fields": mismatches,
            "hook_key": hook_key,
        }
    if action.status in {"executed", "failed"} or action.execution_state in {"executed", "failed"}:
        return {
            "ok": False,
            "error": "action_already_terminal",
            "hook_key": hook_key,
            "action": action.to_dict(),
        }
    error = str(payload.get("error") or "").strip()
    if not error and payload.get("toolResultFailed") is True:
        error = "tool_result_reported_failure"
    result_summary = str(payload.get("resultSummary") or "").strip()
    action.execution_result.update(
        {
            "tool_name": payload.get("toolName"),
            "duration_ms": payload.get("durationMs"),
            "result_summary": result_summary or None,
            "completed_at": utc_now_iso(),
        }
    )
    if error:
        tool_name = str(payload.get("toolName") or "").lower()
        capability_error = (
            tool_name in {"memory_search", "memory_get"}
            and any(marker in error.lower() for marker in ("index", "metadata", "not configured", "unavailable"))
        )
        action.status = "failed"
        action.execution_state = "failed"
        action.execution_result.update(
            {
                "error_code": "capability_error" if capability_error else "tool_execution_failed",
                "message": error,
                "error_class": "capability" if capability_error else "execution",
                "user_message": (
                    "OpenClaw 工具能力暂不可用，请检查索引或运行配置。"
                    if capability_error
                    else "OpenClaw 工具执行失败，请查看动作详情。"
                ),
            }
        )
    elif action.status not in {"blocked", "rejected"}:
        action.status = "executed"
        action.execution_state = "executed"
        action.execution_result.update({"status": "completed"})
        completion_evidence = {
            "source": "authenticated_after_tool_call" if authenticated_before else "legacy_internal_callback",
            "hook_auth_binding": expected.get("hook_auth_binding") if authenticated_before else None,
            "content_lineage_verified": False,
            "content_evidence": "not_provided",
        }
        action.event.metadata["rv_execution_evidence"] = completion_evidence
        action.event.metadata["principal_rv_commit_effect"] = services.record_executed_principal_action(action) or "none"
        rv_trace = action.event.metadata.get("rv_trace", [])
        if isinstance(rv_trace, list) and rv_trace and services.rv_enabled():
            rv_trace = [_mark_step_observed(step, completion_evidence) for step in rv_trace]
            action.event.metadata["rv_trace"] = rv_trace
            rv_result = services.rv_engine.evaluate(
                rv_trace,
                session_key=_resolve_rv_session_key(action.event),
                authorization_trace=action.event.metadata.get("authorization_trace"),
                policy_decision=action.decision.policy_decision,
            )
            action.event.metadata["rv_commit_result"] = rv_result
            services.persist_rv_state()

    # 内容证据仅在既有成功历史提交后补充，不解析结果摘要、不修改裁决。
    # 非阻塞提交，宿主任务查询/核验在后台；缺失/无效证据不阻碍原有RV历史。
    if action.execution_state == "executed" and _experiment_components().authorization:
        ledger = getattr(services, "content_evidence_ledger", None)
        envelope = payload.get("executionReceipt")
        trace = action.event.metadata.get("rv_trace", [])
        if ledger is not None and envelope is not None and isinstance(trace, list) and len(trace) == 1:
            try:
                evidence = ledger.submit(envelope, event=action.event, step={**trace[0], "execution_state": "succeeded"})
            except Exception:
                evidence = {"status": "unverified", "content_lineage_verified": False}
            action.event.metadata["executed_content_evidence"] = evidence

    if action.execution_state == "executed" and _experiment_components().cross_session_rv:
        recorder = getattr(getattr(services, "host_authorization_bridge", None), "history_recorder", None)
        envelope = payload.get("executionReceipt")
        trace = action.event.metadata.get("rv_trace", [])
        if recorder is not None and envelope is not None and isinstance(trace, list) and len(trace) == 1:
            try:
                action.event.metadata["cross_session_history_submission"] = recorder.submit(
                    envelope, event=action.event, step={**trace[0], "execution_state": "succeeded"})
            except Exception:
                action.event.metadata["cross_session_history_submission"] = {"status": "unverified"}

    # 如果动作已经被拦截或拒绝，但仍然收到了 after_tool_call
    if action.status in {"blocked", "rejected"} and not error:
        action.execution_result["unexpected_execution"] = True
        services._log("unexpected_execution_after_block", action_id=action.action_id, status=action.status)

    services._save_all(services._replace_action(action))
    services.audit_store.append("hook_after_tool_call", action.to_dict())
    event_record = services.events.publish("action.updated", {
        "action_id": action.action_id,
        "status": action.status,
        "execution_state": action.execution_state,
    })
    action.last_event_seq = event_record["seq"]
    services._save_all(services._replace_action(action))
    services._log(
        "hook_after_tool_call",
        action_id=action.action_id,
        hook_key=hook_key,
        status=action.status,
        tool_name=payload.get("toolName"),
    )
    return {"ok": True, "action": action.to_dict()}
