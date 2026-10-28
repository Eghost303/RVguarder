"""在目标平台构建自带 Python 和依赖的 DSH 插件 tgz；用户安装时无需构建工具。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main() -> None:
    """产物只写入新目录，前端、核心与冻结运行时来自同一次源码构建。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frontend-built", action="store_true")
    args = parser.parse_args()
    if sys.version_info < (3, 13):
        parser.error("Python 3.13+ required")
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    if output.exists():
        parser.error("output must be a new directory")
    target = {"win32": "win32", "linux": "linux"}.get(sys.platform)
    arch = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    if not target or not arch:
        parser.error("build on supported Windows/Linux x64/arm64 target")
    # 冻结必须使用构建机的同平台依赖；不作跨平台打包或安装期联网。
    importlib.metadata.version("pyinstaller")
    npm = "npm.cmd" if sys.platform == "win32" else "npm"

    def run(command: list[str], cwd: Path = root) -> None:
        """执行参数数组，子进程失败即终止整包生成。"""
        subprocess.run(command, cwd=cwd, check=True)

    if not args.frontend_built:
        run([npm, "run", "build"], root / "frontend")
        run([npm, "run", "build:embedded"], root / "frontend")
    run([npm, "run", "check"], root / "dshRVguarder")
    run([npm, "run", "build"], root / "dshRVguarder")
    run([npm, "run", "build:client"], root / "dshRVguarder")
    with tempfile.TemporaryDirectory(prefix="rvg-standalone-") as temporary:
        stage = Path(temporary)
        run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
             "--name", "rvguarder-backend", "--distpath", str(stage / "frozen"),
             "--workpath", str(stage / "build"), "--specpath", str(stage),
             "--paths", str(root), "--collect-all", "clawRVguarder", "--collect-submodules", "uvicorn",
             "--add-data", f"{root / 'runtime/ui'}:clawRVguarder/static_ui",
             "--add-data", f"{root / 'policies/permissions'}:clawRVguarder/policy/data/permissions",
             str(root / "dshRVguarder/scripts/backend-entry.py")])
        package = stage / "package"
        package.mkdir()
        for directory in ("dist", "locale", "docs"):
            shutil.copytree(root / "dshRVguarder" / directory, package / directory)
        for name in ("package.json", "README.md", "cordis.patch.yml"):
            shutil.copy2(root / "dshRVguarder" / name, package / name)
        metadata = json.loads((package / "package.json").read_text(encoding="utf-8"))
        metadata.pop("scripts", None)
        metadata["files"].extend(["backend", "LICENSE"])
        (package / "package.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        shutil.copy2(root / "LICENSE", package / "LICENSE")
        patch = [{"insert": [
            {"id": "rvguarder-dsh", "name": "dsh-rvguarder", "config": {"backendMode": "managed", "failMode": "closed", "timeoutMs": 5000}},
            {"id": "rvguarder-admin", "name": "dsh-rvguarder/admin", "config": {"backendMode": "managed"}},
        ]}]
        (package / "cordis.patch.yml").write_text(json.dumps(patch, indent=2), encoding="utf-8")
        backend = package / "backend"
        shutil.copytree(stage / "frozen/rvguarder-backend", backend, symlinks=False)
        dependencies = sorted(({"name": dist.metadata["Name"], "version": dist.version}
                               for dist in importlib.metadata.distributions()), key=lambda item: item["name"].lower())
        licenses = backend / "licenses"
        licenses.mkdir()
        python_license = Path(sys.base_prefix) / "LICENSE.txt"
        if python_license.is_file():
            shutil.copy2(python_license, licenses / "Python-LICENSE.txt")
        for dist in importlib.metadata.distributions():
            for file in dist.files or []:
                if ".dist-info" in str(file) and any(part.lower().startswith(("license", "copying", "notice")) for part in file.parts):
                    source = Path(dist.locate_file(file))
                    if source.is_file():
                        destination = licenses / dist.metadata["Name"] / Path(*file.parts[1:])
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source, destination)
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=root, text=True).strip())
        (backend / "build-info.json").write_text(json.dumps({"source_commit": commit, "source_tree_dirty": dirty,
            "plugin_version": metadata["version"], "protocol": "dsh-guard-v2", "python": sys.version,
            "platform": platform.platform(), "dependencies": dependencies}, indent=2), encoding="utf-8")
        manifest = {"schema": 1, "platform": target, "arch": arch,
                    "executable": "rvguarder-backend.exe" if target == "win32" else "rvguarder-backend",
                    "files": {file.relative_to(backend).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
                              for file in sorted(backend.rglob("*")) if file.is_file()}}
        (backend / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        run([str(backend / manifest["executable"]), "--help"], cwd=stage)
        # npm 包保留原包名；平台在下载文件名区分，内部 manifest 拒绝错误平台。
        run([npm, "pack", "--ignore-scripts", "--pack-destination", str(stage)], cwd=package)
        tgz = stage / f"{metadata['name']}-{metadata['version']}.tgz"
        output.mkdir(parents=True)
        destination = output / f"{metadata['name']}-{metadata['version']}-{target}-{arch}.tgz"
        shutil.copy2(tgz, destination)
        (output / "SHA256SUMS").write_text(f"{hashlib.sha256(destination.read_bytes()).hexdigest()}  {destination.name}\n", encoding="utf-8")
        shutil.copy2(root / "dshRVguarder/docs/deployment.md", output / "INSTALL.md")
    print(output)


if __name__ == "__main__":
    main()
