"""DSH 共享核心服务 CLI；只绑定本机，不安装或改写任一宿主插件。"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
import signal
import sys
import threading

from .adapter import local_path
from .services import DshServices


def main(argv: list[str] | None = None) -> int:
    """启动独立实例工作台，token 仅保存到本机私有 runtime 文件。"""
    parser = argparse.ArgumentParser(prog="dsh-rvguarder")
    parser.add_argument("--project-dir", type=Path, required=True, help="此实例独占的数据目录")
    parser.add_argument("--dsh-home", type=Path, default=Path.home() / ".dsh")
    parser.add_argument("--workspace", required=True, help="DSH 的可信工作区根目录，支持 Windows 绝对路径")
    parser.add_argument("--profile", default="web")
    parser.add_argument("--instance-id", default="dsh-local")
    parser.add_argument("--port", type=int, default=8781)
    parser.add_argument("--semantic-mode", choices=["auto", "local", "llm", "host-agent"], default="auto")
    parser.add_argument("--prepare-only", action="store_true", help="只初始化独占实例与私有令牌，不启动服务")
    parser.add_argument("--managed-stdio", action="store_true", help="宿主托管模式：stdin 关闭时停止服务")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", args.instance_id):
        parser.error("invalid instance-id")
    if Path(args.profile).name != args.profile or args.profile in {".", ".."}:
        parser.error("invalid profile")
    manager = DshServices(args.project_dir.resolve(), dsh_home=args.dsh_home.resolve(),
                          workspace=Path(local_path(args.workspace)).resolve(), profile=args.profile,
                          instance_id=args.instance_id, semantic_mode=args.semantic_mode)
    if args.prepare_only:
        try:
            print(json.dumps({"prepared": True, "host": "dsh", "instance_id": args.instance_id,
                              "token_file": str(manager.host_adapter.token_path)}, ensure_ascii=False))
        finally:
            manager.close()
        return 0
    from clawRVguarder.web.app import launch_web
    handle, _, url = launch_web(manager, "127.0.0.1", args.port, no_browser=True)
    # stdout 供受控启动器读取，不能打印 token 本身。
    print(json.dumps({"url": url, "host": "dsh", "instance_id": args.instance_id,
                      "token_file": str(manager.host_adapter.token_path)}, ensure_ascii=False), flush=True)
    stop = threading.Event()
    if args.managed_stdio:
        def watch_parent() -> None:
            """宿主断开私有管道后退出，不依赖可重用的父进程 PID。"""
            try:
                while sys.stdin.buffer.read(1):
                    pass
            finally:
                stop.set()
        threading.Thread(target=watch_parent, daemon=True).start()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    try:
        stop.wait()
    finally:
        handle.shutdown()
        handle.server_close()
        manager.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
