"""RV 效果证据等级：只有真正确认过的效果才能满足"已发生"要求。"""
from __future__ import annotations

from clawRVguarder.rv.rv_dsl import StepRequirement, ToolGuard, _matches_requirement


def _step(evidence: list[tuple[str, str]], *, observation: str = "not_started",
          effects: tuple[str, ...] = ("read",)) -> dict:
    return {
        "event_model": "tool-call-v1",
        "tool_name": "read",
        "operation_family": "file.read",
        "effects": list(effects),
        "effect_evidence": [{"effect": effect, "status": status} for effect, status in evidence],
        "observation": {"state": observation},
    }


def _match(guard: ToolGuard, step: dict) -> bool:
    return _matches_requirement(
        StepRequirement(tool=guard), props=set(), event="tool_call",
        window=None, current_step=step,
    )


def test_expected_effect_does_not_satisfy_observed_requirement() -> None:
    assert _match(ToolGuard(effect_statuses=["observed"]), _step([("read", "expected")])) is False


def test_expected_effect_satisfies_expected_requirement() -> None:
    assert _match(ToolGuard(effect_statuses=["expected"]), _step([("read", "expected")])) is True


def test_observed_effect_satisfies_observed_requirement() -> None:
    assert _match(ToolGuard(effect_statuses=["observed"]), _step([("read", "observed")])) is True


def test_legacy_step_without_evidence_never_looks_observed() -> None:
    step = _step([])
    step.pop("effect_evidence")
    assert _match(ToolGuard(effect_statuses=["observed"]), step) is False


def test_observation_state_is_matched_explicitly() -> None:
    step = _step([("read", "observed")], observation="verified_succeeded")
    assert _match(ToolGuard(observation_states=["verified_succeeded"]), step) is True
    assert _match(ToolGuard(observation_states=["reported_succeeded"]), step) is False


def test_empty_status_lists_keep_legacy_matching() -> None:
    """未声明证据要求时，旧规则的匹配行为不变。"""
    assert _match(ToolGuard(names=["read"], effects_any_of=["read"]), _step([("read", "expected")])) is True
