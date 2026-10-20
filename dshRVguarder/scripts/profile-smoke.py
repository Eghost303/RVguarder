"""在 Windows 临时 DSH_HOME 中启动真实 web profile，并检查插件认证握手；不触碰日常 profile。"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request

import yaml


def main() -> None:
    """使用已安装 SDK、隔离 profile 和外部托管后端完成加载探针。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True, help='WSL 可执行的 Windows node.exe 路径')
    parser.add_argument('--sdk-root', type=Path, required=True, help='WSL 可读的 Windows DSH 安装根目录')
    parser.add_argument('--windows-temp', type=Path, required=True)
    parser.add_argument('--backend-url', required=True)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--instance-id', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    metadata = json.loads((args.sdk_root / 'package.json').read_text())
    if metadata.get('version') != '0.2.1-rc.2' or metadata.get('name') != '@deepseek-ai/dsh':
        parser.error('expected DSH 0.2.1-rc.2')
    token = args.token_file.read_text().strip()

    def status() -> dict:
        request = urllib.request.Request(args.backend_url.rstrip('/') + '/api/dsh/status', headers={'x-rvguarder-token': token})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def win(path: Path) -> str:
        return subprocess.check_output(['wslpath', '-w', str(path.resolve())], text=True).strip()

    previous = status()['hook'].get('hello_count', 0)
    stage = Path(tempfile.mkdtemp(prefix='rvguarder-dsh-profile-', dir=args.windows_temp))
    process = None
    log = stage / 'startup.log'
    try:
        home, workspace = stage / 'home', stage / 'workspace'
        workspace.mkdir()
        profile = home / 'profiles/rvguarder-dev'
        package = profile / 'node_modules/dsh-rvguarder'
        package.mkdir(parents=True)
        shutil.copytree(root / 'dist', package / 'dist')
        shutil.copy2(root / 'package.json', package / 'package.json')
        (profile / 'package.json').write_text(json.dumps({'name': 'rvguarder-smoke', 'private': True,
            'dsh': {'profile': {'bundles': ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}},
            'dependencies': {'dsh-rvguarder': '0.1.0'}}))
        config = {'backendUrl': args.backend_url, 'tokenFile': win(args.token_file),
                  'instanceId': args.instance_id, 'stateDir': win(stage / 'private'), 'failMode': 'closed'}
        (profile / 'cordis.patch.yml').write_text(yaml.safe_dump([{'insert': [{'id': 'rvguarder-dsh', 'name': 'dsh-rvguarder', 'config': config}]}], sort_keys=False))
        launcher = stage / 'launch.mjs'
        binary = win(args.sdk_root / 'lib/bin.js')
        launcher.write_text('\n'.join(['import {pathToFileURL} from "node:url";',
            'process.env.DSH_HOME=' + json.dumps(win(home)) + ';',
            'process.argv=[process.execPath,' + json.dumps(binary) + ',"--profile","rvguarder-dev","--no-open","--port","0"];',
            'console.log(JSON.stringify({native_pid:process.pid}));',
            'const cli=await import(pathToFileURL(' + json.dumps(binary) + ').href);', 'await cli.runCli();']))
        with log.open('w') as stream:
            process = subprocess.Popen([args.node, win(launcher)], stdout=stream, stderr=subprocess.STDOUT, cwd=workspace)
            deadline = time.monotonic() + 30
            while process.poll() is None and time.monotonic() < deadline:
                time.sleep(.25)
                text = log.read_text(errors='replace')
                if 'dsh web: http://' in text and status()['hook'].get('hello_count', 0) > previous:
                    print(json.dumps({'sdk': metadata['version'], 'profile': 'temporary-web', 'real_loader': 'mounted', 'authenticated_handshake': True}))
                    break
            else:
                text = log.read_text(errors='replace')
                text = re.sub(r'(?i)(token|api_key|secret)=\S+', r'\1=[REDACTED]', text)
                raise RuntimeError('DSH startup/handshake failed: ' + text[-5000:])
    finally:
        if process is not None and process.poll() is None:
            native_pid = None
            for line in log.read_text(errors='replace').splitlines():
                try:
                    native_pid = json.loads(line).get('native_pid', native_pid)
                except (ValueError, AttributeError):
                    pass
            if native_pid:
                subprocess.run(['/mnt/c/WINDOWS/system32/taskkill.exe', '/PID', str(native_pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        shutil.rmtree(stage, ignore_errors=True)


if __name__ == '__main__':
    main()
