"""平台整包的冻结入口；不读取源码目录或安装 OpenClaw Hook。"""
from __future__ import annotations
import sys

# 冻结解释器不继承普通 Python 的 UTF-8 启动开关；宿主管道始终使用 UTF-8。
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace")

from clawRVguarder.hosts.dsh.server import main

if __name__ == "__main__":
    raise SystemExit(main())
