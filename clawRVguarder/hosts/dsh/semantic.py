"""DSH 有界语义缓存和调用预算；不缓存权限裁决。"""
from __future__ import annotations
from collections import OrderedDict, deque
from copy import deepcopy
import json
import threading
import time
from clawRVguarder.engine.semantic_enhancer import SemanticEnhancer
from clawRVguarder.utils import sha256_text


class DshSemanticEnhancer(SemanticEnhancer):
    """成功 LLM 证据缓存 30 秒、最多128项；预算耗尽退回本地分析。"""

    def __init__(self, *, policy_version: str, max_calls_per_minute: int = 60, **kwargs) -> None:
        super().__init__(**kwargs)
        self.policy_version = policy_version
        self.max_calls_per_minute = max_calls_per_minute
        self._cache = OrderedDict()
        self._calls = deque()
        self._lock = threading.RLock()

    def evaluate(self, event, context=None):
        """绑定精确调用、策略、模型及提示词版本，返回独立证据副本。"""
        if not self._llm_enabled:
            return super().evaluate(event, context)
        key = sha256_text(json.dumps({"contract": "bounded-semantic-v1", "policy": self.policy_version,
            "model": self.model, "endpoint": self.base_url, "call": event.raw_payload,
            "action": event.action_type, "paths": event.target_paths, "network": event.network_targets,
            "command": event.command, "cwd": event.working_directory, "context": context}, ensure_ascii=False, sort_keys=True))
        with self._lock:
            now = time.monotonic()
            for stale in [k for k, (at, _) in self._cache.items() if now - at >= 30]:
                self._cache.pop(stale)
            if key in self._cache:
                self._cache.move_to_end(key)
                result = deepcopy(self._cache[key][1])
                result["semantic_audit"]["cache_hit"] = True
                return result
            while self._calls and now - self._calls[0] >= 60:
                self._calls.popleft()
            if len(self._calls) >= self.max_calls_per_minute:
                result = SemanticEnhancer(api_key="").evaluate(event, context)
                result["semantic_audit"].update({"llm_status": "rate_limited", "fallback": "local"})
                return result
            self._calls.append(now)
            result = super().evaluate(event, context)
            if result.get("semantic_audit", {}).get("llm_status") == "success":
                self._cache[key] = (now, deepcopy(result))
                while len(self._cache) > 128:
                    self._cache.popitem(last=False)
            return result
