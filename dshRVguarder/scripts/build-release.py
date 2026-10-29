"""构建匹配版本的 DSH 插件、Python wheel、UI 和带哈希的发行目录。"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tarfile


def main() -> None:
    """只创建新目录，不覆盖现有发行包或包含任何运行凭据。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--frontend-built', action='store_true', help='使用已单独构建的前端；wheel 构建仍严格核验资源')
    parser.add_argument('--plugin-tgz', type=Path, help='使用已单独 npm pack 的插件，核对包名及版本')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    if output.exists():
        parser.error('output must be a new directory')
    npm = 'npm.cmd' if sys.platform == 'win32' else 'npm'
    if not args.frontend_built:
        subprocess.run([npm, 'run', 'build'], cwd=root / 'frontend', check=True)
        subprocess.run([npm, 'run', 'build:embedded'], cwd=root / 'frontend', check=True)
    with tempfile.TemporaryDirectory(prefix='rvguarder-release-') as temp:
        staging = Path(temp)
        subprocess.run([sys.executable, '-m', 'pip', 'wheel', str(root), '--no-deps', '--no-build-isolation', '--wheel-dir', str(staging)], check=True)
        if args.plugin_tgz:
            with tarfile.open(args.plugin_tgz, 'r:gz') as archive:
                metadata = json.load(archive.extractfile('package/package.json'))
            expected = json.loads((root / 'dshRVguarder/package.json').read_text(encoding='utf-8'))
            if (metadata.get('name'), metadata.get('version')) != (expected['name'], expected['version']):
                raise ValueError('prebuilt plugin name/version mismatch')
            shutil.copy2(args.plugin_tgz, staging / args.plugin_tgz.name)
        else:
            subprocess.run([npm, 'pack', '--pack-destination', str(staging)], cwd=root / 'dshRVguarder', check=True)
        shutil.copy2(root / 'dshRVguarder/docs/deployment.md', staging / 'INSTALL.md')
        for document in ('windows-native-rc3.md', 'repair-2026-10-21.md'):
            shutil.copy2(root / 'dshRVguarder/docs' / document, staging / document)
        shutil.copy2(root / 'dshRVguarder/scripts/create-test-profile.mjs', staging / 'create-test-profile.mjs')
        sdk_version = subprocess.check_output(['node', '--input-type=module', '-e', "import {sdkVersion} from './dist/sdk.js'; console.log(sdkVersion)"], cwd=root / 'dshRVguarder', text=True).strip()
        manifest = {'plugin_version': json.loads((root / 'dshRVguarder/package.json').read_text(encoding='utf-8'))['version'], 'host': 'dsh', 'sdk_version': sdk_version, 'supported_sdk_versions': ['0.2.1-rc.2', '0.2.1-rc.3'], 'protocol': 'dsh-guard-v2', 'python': '>=3.13',
                    'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in staging.iterdir() if p.is_file()}}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(staging, output)
    print(str(output))


if __name__ == '__main__':
    main()
