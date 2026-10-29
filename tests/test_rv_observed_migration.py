"""已观测效果迁移：成功完成后才允许链式判定把效果当作已发生。"""
from __future__ import annotations

import json
from pathlib import Path

from clawRVguarder.engine.pipeline import _mark_step_observed

RULES_PATH = Path(__file__).resolve().parents[1] / "clawRVguarder" / "rv" / "rv_rules.json"


def _step(step_id: str, props: list[str], evidence: list[dict], observation: str) -> dict:
    return {
        "step_id": step_id, "event": "tool_call", "event_model": "tool-call-v1",
        "props": props,
        "effect_evidence": evidence, "observation": {"state": observation},
    }


def test_mark_step_observed_upgrades_expected_but_not_unknown() -> None:
    step = {
        "effect_evidence": [
            {"effect": "read", "status": "expected"},
            {"effect": "write", "status": "potential"},
            {"effect": "transform", "status": "unknown"},
        ],
        "execution_state": "proposed",
    }

    marked = _mark_step_observed(step, {"source": "after_tool_call"})

    statuses = [item["status"] for item in marked["effect_evidence"]]
    assert statuses == ["observed", "observed", "unknown"]
    assert "effect_observed:read" in marked["props"]
    assert "effect_observed:transform" not in marked["props"]
    assert marked["observation"]["state"] == "reported_succeeded"
    # 宿主报告成功不等于收据核验。
    assert marked["observation"]["verified"] is False


def test_migrated_rules_require_observed_effects() -> None:
    document = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    by_id = {}
    for monitor in document["monitors"]:
        for rule in monitor.get("rules", []):
            by_id[rule["id"]] = json.dumps(rule.get("when"), ensure_ascii=False)

    for rule_id in ("batch_idle_to_searching", "export_idle_to_sensitive_query",
                    "sec_idle_to_sensitive_access_secret_read"):
        assert "effect_observed:" in by_id[rule_id], rule_id


def test_migrated_rule_rejects_a_proposed_read() -> None:
    """迁移后的规则只在读操作真正完成后才进入敏感状态。"""
    from clawRVguarder.rv.rv_dsl import StepRequirement, _matches_requirement

    document = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    when = next(rule["when"]
                for monitor in document["monitors"]
                for rule in monitor.get("rules", [])
                if rule["id"] == "sec_idle_to_sensitive_access_secret_read")
    requirement = StepRequirement.model_validate(when)

    proposed = _step("s1", ["effect:read", "contains_secret"],
                     [{"effect": "read", "status": "expected"}], "not_started")
    observed = _step("s1", ["effect:read", "effect_observed:read", "contains_secret"],
                     [{"effect": "read", "status": "observed"}], "reported_succeeded")

    def matches(step: dict) -> bool:
        return _matches_requirement(requirement, props=set(step["props"]),
                                    event="tool_call", window=None, current_step=step)

    assert matches(proposed) is False
    assert matches(observed) is True
