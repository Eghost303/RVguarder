"""规则收紧的安全回归：敏感文档与敏感文件读取不得自动放行。"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from clawRVguarder.policy.catalog import PolicyBundle
from clawRVguarder.policy.evaluator import PolicyEvaluator
from clawRVguarder.policy.models import (
    AuthorizationTrace, CoverageResult, DataRef, OperationRef, PrincipalRef, ResourceRef,
)
from clawRVguarder.services import build_services


@pytest.fixture(scope="module")
def bundle() -> PolicyBundle:
    return PolicyBundle.load()


@pytest.fixture(scope="module")
def evaluator() -> PolicyEvaluator:
    return PolicyEvaluator(PolicyBundle.load())


def _trace(family: str, *, scope: str = "workspace", classification: str = "internal",
           ids: tuple[str, ...] = ("doc-1",)) -> AuthorizationTrace:
    return AuthorizationTrace(
        trace_id="trace",
        principal=PrincipalRef(id="agent", type="agent", trust="verified"),
        operation=OperationRef(family=family, tool_id=family),
        resource=ResourceRef(type="path", ids=list(ids), scope=scope),
        coverage=CoverageResult(status="complete"),
        data=DataRef(classification=classification),
    )


def test_document_read_allows_tenant_internal(evaluator) -> None:
    assert evaluator.evaluate(_trace("document.read")).effect == "auto_allow_audit"


def test_document_read_does_not_auto_allow_secret(evaluator) -> None:
    assert evaluator.evaluate(_trace("document.read", classification="secret")).effect != "auto_allow_audit"


def test_document_read_does_not_auto_allow_external(evaluator) -> None:
    assert evaluator.evaluate(_trace("document.read", scope="external")).effect != "auto_allow_audit"


def test_alias_rules_are_candidates_alongside_exact_rules(bundle) -> None:
    """精确规则存在时，带 aliases 的规则不能被丢弃。"""
    file_write = {rule.id for rule in bundle.rules_for_operation("file.write")}
    assert {"NATIVE-FILE-007", "NATIVE-GEN-005", "NATIVE-GEN-006"} <= file_write
    assert "EX-19" in {rule.id for rule in bundle.rules_for_operation("data.export")}


def test_sensitive_export_is_blocked_by_alias_rule(evaluator) -> None:
    """sensitive 级 data.export 由别名规则阻断，而不是只要求审批。"""
    assert evaluator.evaluate(_trace("data.export", scope="workspace",
                                     classification="sensitive")).effect == "block"


def test_workspace_env_read_is_not_auto_allowed() -> None:
    """根目录 .env 没有前导斜杠，仍须被识别为敏感路径。"""
    with tempfile.TemporaryDirectory() as tmp:
        project = Path(tmp) / "project"
        project.mkdir()
        config = project / "openclaw.json"
        config.write_text(json.dumps({"models": {"providers": {}}}), encoding="utf-8")
        (project / ".env").write_text("TOKEN=secret", encoding="utf-8")
        services = build_services(project, config_path=config)

        result = services.handle_before_tool_call({
            "toolName": "read",
            "params": {"path": str(project / ".env")},
            "runId": "env-run", "toolCallId": "env-call",
            "sessionId": "env-session", "agentId": "agent-env",
        })

        assert result["action"] == "require_approval"
