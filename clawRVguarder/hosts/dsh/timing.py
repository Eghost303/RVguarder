"""可选的本机桥接时延观测；只输出阶段耗时，不包含工具参数或凭据。"""
from __future__ import annotations

import json
import sys
import threading
import time
import os
from pathlib import Path


def emit_timing(stage: str, started: float) -> None:
    """只输出固定阶段名和耗时，不含请求、路径或认证数据。"""
    if os.environ.get("RVGUARDER_DSH_TIMINGS") == "1":
        print(json.dumps({"event": "dsh.bridge.phase", "stage": stage, "elapsed_ms": round((time.perf_counter() - started) * 1000, 2)}), file=sys.stderr, flush=True)


class MeasuredRLock:
    """保持 RLock 语义，诊断模式记录排队和持锁时长。"""

    def __init__(self) -> None:
        """创建线程私有嵌套计时栈。"""
        self.lock = threading.RLock()
        self.local = threading.local()

    def __enter__(self):
        """取得锁并测量等待时间。"""
        started = time.perf_counter()
        self.lock.acquire()
        acquired = time.perf_counter()
        stack = getattr(self.local, "stack", [])
        operation = sys._getframe(1).f_code.co_name
        profiler = None
        if os.environ.get("RVGUARDER_DSH_PROFILE_DIR"):
            import cProfile
            profiler = cProfile.Profile()
            profiler.enable()
        stack.append((started, acquired, operation, profiler))
        self.local.stack = stack
        return self

    def __exit__(self, *_):
        """释放后输出诊断，避免将日志 I/O 放入临界区。"""
        started, acquired, operation, profiler = self.local.stack.pop()
        if profiler:
            profiler.disable()
        ended = time.perf_counter()
        self.lock.release()
        print(json.dumps({"event": "dsh.bridge.lock", "operation": operation, "wait_ms": round((acquired - started) * 1000, 2), "held_ms": round((ended - acquired) * 1000, 2)}), file=sys.stderr, flush=True)
        if profiler:
            destination = Path(os.environ["RVGUARDER_DSH_PROFILE_DIR"])
            destination.mkdir(parents=True, exist_ok=True)
            profiler.dump_stats(destination / f"{operation}-{time.time_ns()}.pstats")
