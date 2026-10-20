"""共享核心需要的最小宿主边界，不依赖任一宿主的 SDK 或启动器。"""
from __future__ import annotations
from pathlib import Path
from typing import Any, Protocol
from clawRVguarder.config import AppContext
from clawRVguarder.core.baseline_service import BaselineService
from clawRVguarder.models import BehaviorEvent


class HostAdapter(Protocol):
    """提供纯事件映射、扫描与桥接状态，隔离宿主安装副作用。"""

    def runtime_hook(self, context: AppContext) -> dict[str, Any]:
        """初始化当前宿主的桥接状态。"""
        ...

    def baseline_service(self, context: AppContext, latest_path: Path) -> BaselineService:
        """提供宿主扫描与报告服务。"""
        ...

    def build_event(self, payload: dict[str, Any], context: AppContext) -> BehaviorEvent:
        """只从受控宿主上下文构造可信事件。"""
        ...

    def source_message(self, event: BehaviorEvent) -> str:
        """提供适合语义分析的宿主工具说明。"""
        ...
