"""构建匹配版本的 DSH 插件、Python wheel、UI 和带哈希的离线安装目录。"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main() -> None:
    """只创建新目录，不覆盖现有发行包或包含任何运行凭据。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    if output.exists():
        parser.error('output must be a new directory')
    npm = 'npm.cmd' if sys.platform == 'win32' else 'npm'
    subprocess.run([npm, 'run', 'build'], cwd=root / 'frontend', check=True)
    with tempfile.TemporaryDirectory(prefix='rvguarder-release-') as temp:
        staging = Path(temp)
        subprocess.run([sys.executable, '-m', 'pip', 'wheel', str(root), '--no-deps', '--no-build-isolation', '--wheel-dir', str(staging)], check=True)
        subprocess.run([npm, 'pack', '--pack-destination', str(staging)], cwd=root / 'dshRVguarder', check=True)
        shutil.copy2(root / 'dshRVguarder/docs/deployment.md', staging / 'INSTALL.md')
        shutil.copy2(root / 'dshRVguarder/scripts/create-test-profile.mjs', staging / 'create-test-profile.mjs')
        manifest = {'host': 'dsh', 'sdk_version': '0.2.1-rc.2', 'protocol': 'dsh-guard-v1', 'python': '>=3.13',
                    'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in staging.iterdir() if p.is_file()}}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(staging, output)
    print(str(output))


if __name__ == '__main__':
    main()
