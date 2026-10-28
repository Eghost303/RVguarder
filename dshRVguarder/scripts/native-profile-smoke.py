"""用现有 Windows 桌面 CLI 和原生 Python 验证隔离 profile 的真实安装及握手，不限定 Python 安装渠道。"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import Request, urlopen
from uuid import uuid4


def main() -> None:
    """只使用新建目录，不读取模型凭据，不向真实模型发送任务。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsh-cli", type=Path, required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    stage = args.output.resolve()
    stage.mkdir(parents=True, exist_ok=False)
    home, workspace, project = (stage / name for name in ("home", "workspace", "guard"))
    workspace.mkdir()
    (stage / "temp").mkdir()
    (workspace / "probe.txt").write_text("isolated native deployment probe\n", encoding="utf-8")
    instance = "native-" + uuid4().hex[:12]
    env = {**os.environ, "PYTHONUTF8": "1", "DEEPSEEK_API_KEY": "", "DSH_HOME": str(home),
           "DSH_AGENTS_HOME": str(stage / "agents"), "TEMP": str(stage / "temp"), "TMP": str(stage / "temp")}
    backend = host = None
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def status(url, token):
        with urlopen(Request(url.rstrip("/") + "/api/dsh/status", headers={"x-rvguarder-token": token}), timeout=3) as response:
            return json.load(response)

    def capabilities(url, token):
        with urlopen(Request(url.rstrip("/") + "/api/dsh/capabilities", headers={"x-rvguarder-token": token}), timeout=3) as response:
            return json.load(response)

    def stop(process):
        if process is None or process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"], capture_output=True, creationflags=flags)
        else:
            process.terminate()
        process.wait(timeout=10)

    with (stage / "backend.log").open("w", encoding="utf-8") as backend_log, (stage / "host.log").open("w", encoding="utf-8") as host_log:
        try:
            backend = subprocess.Popen([sys.executable, "-X", "utf8", "-m", "clawRVguarder.hosts.dsh.server",
                "--project-dir", str(project), "--dsh-home", str(home), "--workspace", str(workspace),
                "--profile", "rvguarder-smoke", "--instance-id", instance, "--port", "0", "--semantic-mode", "local"],
                cwd=root, env=env, stdout=backend_log, stderr=backend_log, creationflags=flags)
            url = None
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline and backend.poll() is None:
                for line in (stage / "backend.log").read_text(encoding="utf-8", errors="replace").splitlines():
                    try:
                        value = json.loads(line)
                        if isinstance(value, dict) and value.get("url"):
                            url = value["url"]
                    except ValueError:
                        pass
                if url:
                    break
                time.sleep(.25)
            if not url:
                raise RuntimeError("Backend startup failed; inspect the private backend.log")
            token_file = project / "runtime" / "dsh-token"
            token = token_file.read_text(encoding="ascii").strip()
            subprocess.run(["node", str(root / "dshRVguarder/scripts/create-test-profile.mjs"), "--profile", "rvguarder-smoke",
                "--instance", instance, "--token", str(token_file), "--home", str(home), "--backend", url, "--state", str(stage / "plugin")],
                cwd=workspace, env=env, check=True, capture_output=True, creationflags=flags)
            installed = subprocess.run([str(args.dsh_cli.resolve()), "plugin", "--profile", "rvguarder-smoke", "add", "--offline", "--store-dir", str(stage / "pnpm-store"), str(args.package.resolve())],
                cwd=workspace, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90, creationflags=flags)
            (stage / "install.log").write_text(installed.stdout + installed.stderr, encoding="utf-8")
            if installed.returncode:
                raise RuntimeError("Desktop plugin package installation failed; inspect install.log")
            host = subprocess.Popen([str(args.dsh_cli.resolve()), "--profile", "rvguarder-smoke", "--no-open", "--port", "0"],
                cwd=workspace, env=env, stdout=host_log, stderr=host_log, creationflags=flags)
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline and host.poll() is None:
                current = status(url, token)
                current_capabilities = capabilities(url, token)
                text = (stage / "host.log").read_text(encoding="utf-8", errors="replace")
                if current["hook"].get("active") and current_capabilities.get("probe_fresh") and re.search(r"http://(?:127\.0\.0\.1|localhost):\d+", text):
                    report = {"python": sys.executable, "sdk_version": current["hook"]["sdk_version"],
                              "protocol": current["protocol"], "installed_with_desktop_cli": True,
                              "real_profile_loaded": True, "authenticated_handshake": True,
                              "host_agent_capability": current_capabilities.get("host_agent", {}),
                              "model_calls": 0, "profile": "rvguarder-smoke"}
                    (stage / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
                    print(json.dumps(report))
                    return
                time.sleep(.5)
            raise RuntimeError("Desktop profile startup/handshake failed; inspect the private host.log")
        finally:
            stop(host)
            stop(backend)


if __name__ == "__main__":
    main()
