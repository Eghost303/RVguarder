"""DSH 降级审计和有时效的宿主事实；不将探针当作授权证明。"""
from __future__ import annotations

import json
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .adapter import TOOL_ALIASES


class DegradedEvent(BaseModel):
    """有限旁路事件，不接收工具参数或模型正文。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=128)
    instance_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(max_length=512)
    call_id: str = Field(max_length=512)
    tool_name: str = Field(max_length=256)
    time: float = Field(ge=0, allow_inf_nan=False)
    stage: Literal["bypass", "result", "audit_gap"]
    succeeded: bool | None = None
    reason: Literal["bridge_unavailable", "audit_storage_unavailable"]


class ProbeFact(BaseModel):
    """探针只报告有限检查结论，不能携带配置正文。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    key: Literal["ACCOUNT", "PORTS", "SANDBOX", "APPROVAL", "PERMISSIONS", "WINDOWS", "PLUGINS"]
    state: Literal["verified", "risk", "unknown", "unsupported"]
    evidence: str = Field(max_length=1024)


class HostProbe(BaseModel):
    """包含版本、工具清单与来源时间的认证宿主快照。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    instance_id: str
    sdk_version: Literal["0.2.1-rc.2", "0.2.1-rc.3"]
    platform: Literal["win32", "linux", "darwin"]
    observed_at: float = Field(ge=0, allow_inf_nan=False)
    tools: list[str] = Field(max_length=512)
    facts: list[ProbeFact] = Field(max_length=16)
    audit_gap: bool = False


class DshObservability:
    """隔离的旁路与探针接口，复用实例调用日志和审计存储。"""

    def record_degraded(self, payload: dict) -> dict:
        """恢复后幂等接收旁路记录，不写入动作或 RV 成功状态。"""
        event = DegradedEvent.model_validate(payload)
        if event.instance_id != self.instance_id:
            raise ValueError("instance_mismatch")
        encoded = event.model_dump_json()
        with self.bridge_lock, self._journal() as db:
            old = db.execute("SELECT body FROM degraded WHERE id=?", (event.id,)).fetchone()
            if old:
                if old[0] != encoded:
                    raise ValueError("degraded_event_conflict")
                return {"ok": True, "duplicate": True}
            self.audit_store.append("dsh_degraded", event.model_dump())
            db.execute("INSERT INTO degraded VALUES (?,?)", (event.id, encoded))
        return {"ok": True}

    def record_probe(self, payload: dict) -> dict:
        """保存当前宿主投影，不接收 Agent 工具自报结果。"""
        probe = HostProbe.model_validate(payload)
        if probe.instance_id != self.instance_id or abs(time.time() - probe.observed_at) > 60:
            raise ValueError("invalid_probe_instance_or_time")
        if any(not name or len(name) > 256 for name in probe.tools) or len({f.key for f in probe.facts}) != len(probe.facts):
            raise ValueError("invalid_probe_items")
        with self.bridge_lock, self._journal() as db:
            db.execute("INSERT OR REPLACE INTO probes VALUES (1,?,?)", (probe.model_dump_json(), time.time()))
        return {"ok": True}

    def capabilities(self) -> dict[str, Any]:
        """返回映射、未映射工具、旁路和探针新鲜度；不推断支持。"""
        with self._journal() as db:
            row = db.execute("SELECT body,received FROM probes WHERE id=1").fetchone()
            count = db.execute("SELECT COUNT(*) FROM degraded").fetchone()[0]
        probe = json.loads(row[0]) if row else None
        fresh = bool(row and 0 <= time.time() - row[1] < 45)
        tools = probe["tools"] if probe else []
        return {"mapped": self.host_adapter.tool_aliases, "unmapped": [t for t in tools if t not in self.host_adapter.tool_aliases],
                "probe": probe, "probe_fresh": fresh, "degraded_events": count,
                "audit_gap": bool(probe and probe["audit_gap"]),
                "evidence": self.evidence.status() if hasattr(self, "evidence") else {"enabled": False}}
