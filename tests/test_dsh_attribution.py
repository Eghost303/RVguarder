"""阶段一验收：冻结的正常任务集与逐调用归因。

验收门槛来自计划第二阶段：测试集内每一次审批都能归因，"未知原因"计数为零。
这里驱动真实 DSH 桥接（TestClient + DshServices），不修改放行策略。

任务集以 `tests/fixtures/dsh_normal_tasks.json` 为唯一来源，其规范化内容的
SHA-256 固定在本文件；修改任务集必须同时更新哈希与归因报告。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.policy import reasons
from clawRVguarder.web.app import create_app

TASK_SET_PATH = Path(__file__).parent / "fixtures" / "dsh_normal_tasks.json"
FROZEN_CANONICAL_SHA256 = "faf22c4bb2fc1d7f82e66149943ebdb6c38cbd04fa0b9dfdd3f89273c3d8a8fb"


def _load_tasks() -> list[dict]:
    """读取冻结任务集并校验内容未被静默修改。"""
    tasks = json.loads(TASK_SET_PATH.read_text(encoding="utf-8"))
    canonical = json.dumps(tasks, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert hashlib.sha256(canonical).hexdigest() == FROZEN_CANONICAL_SHA256, (
        "冻结任务集已变更；如属有意修改，请同步更新哈希与归因报告"
    )
    return tasks


@pytest.fixture
def dsh(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "notes.md").write_text("# notes\n", encoding="utf-8")
    home = tmp_path / "home"
    profile = home / "profiles" / "web"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(
        json.dumps({"dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base"]}}}), encoding="utf-8"
    )
    (profile / "cordis.patch.yml").write_text("[]", encoding="utf-8")
    with patch("clawRVguarder.services.ensure_runtime_hook_plugin",
               side_effect=AssertionError("OpenClaw install forbidden")):
        manager = DshServices(tmp_path / "guard", dsh_home=home, profile="web",
                              workspace=workspace, semantic_mode="local")
    client = TestClient(create_app(manager))
    client.headers["x-rvguarder-token"] = manager.bridge_token
    yield manager, client, workspace
    manager.close()


def _call(workspace: Path, task: dict, index: int) -> dict:
    return {
        "protocol": "dsh-guard-v2", "instance_id": "dsh-local",
        "session_id": "attribution-session", "agent_id": "attribution-session",
        "call_id": f"call-{index}", "root_call_id": f"call-{index}",
        "tool_name": task["tool"], "cwd": str(workspace),
        "arguments": task["arguments"],
    }


def test_frozen_normal_tasks_have_attributable_decisions(dsh) -> None:
    manager, client, workspace = dsh
    tasks = _load_tasks()
    rows: list[dict] = []

    for index, task in enumerate(tasks):
        response = client.post("/api/dsh/before", json=_call(workspace, task, index))
        assert response.status_code == 200, (task["id"], response.text)
        body = response.json()
        action = manager._find_action(body["action_id"])
        record = action.event.metadata.get("decision_record")
        assert isinstance(record, dict), task["id"]
        rows.append({
            "task": task["id"],
            "expected_kind": task["expected_kind"],
            "kind": body["kind"],
            "dominant_reason": record["decision"].get("dominant_reason"),
            "reason_codes": record["decision"].get("reason_codes") or [],
            "deciding_layer": record["decision"].get("deciding_layer"),
            "canonical_operation": record["tool"].get("canonical_operation"),
            "scope_class": record["resources"].get("scope_class"),
        })

    # 验收门槛一：每一次审批/阻断都必须有真实原因码。
    # UNATTRIBUTED 是哨兵值，不计入有效原因，出现即视为未知原因。
    unattributed = [
        row["task"] for row in rows
        if row["kind"] in {"ask", "block"}
        and row["dominant_reason"] in {None, reasons.UNATTRIBUTED}
    ]
    assert unattributed == [], f"审批无法归因: {unattributed}"

    # 验收门槛二：原因码必须来自冻结词表，不能出现自由文本码。
    stray = sorted(
        {code for row in rows for code in row["reason_codes"]}
        - reasons.ALL_REASON_CODES - {reasons.UNATTRIBUTED}
    )
    assert stray == [], f"未登记的原因码: {stray}"

    # 验收门槛三：任务集冻结的是决策类别，不是具体规则。
    mismatched = [
        (row["task"], row["expected_kind"], row["kind"])
        for row in rows if row["kind"] != row["expected_kind"]
    ]
    assert mismatched == [], f"任务预期类别变化: {mismatched}"

    # 归因分布，供实验报告引用。
    summary = {"approvals": 0, "total": len(rows), "by_reason": {}, "by_layer": {}}
    for row in rows:
        summary["by_layer"][row["deciding_layer"]] = summary["by_layer"].get(row["deciding_layer"], 0) + 1
        if row["kind"] == "ask":
            summary["approvals"] += 1
            key = row["dominant_reason"]
            summary["by_reason"][key] = summary["by_reason"].get(key, 0) + 1
    assert summary["approvals"] == sum(summary["by_reason"].values())
