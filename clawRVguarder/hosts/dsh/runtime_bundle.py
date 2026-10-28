"""校验并部署随包原生运行时到私有版本缓存，不改业务状态。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import secrets

from clawRVguarder.storage.private_files import ensure_private_directory


def verify_bundle(root: Path) -> tuple[dict, str]:
    """校验完整文件清单，拒绝链接、额外文件与路径逃逸。"""
    raw = (root / "manifest.json").read_bytes()
    manifest = json.loads(raw)
    files = manifest.get("files")
    if manifest.get("schema") != 1 or not isinstance(files, dict):
        raise ValueError("runtime_manifest_invalid")
    actual = set()
    for path in root.rglob("*"):
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise ValueError("runtime_link_forbidden")
        if path.is_file() and path != root / "manifest.json":
            actual.add(path.relative_to(root).as_posix())
    if actual != set(files):
        raise ValueError("runtime_inventory_mismatch")
    for name, digest in files.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError("runtime_integrity_mismatch")
    if manifest.get("executable") not in files:
        raise ValueError("runtime_executable_missing")
    return manifest, hashlib.sha256(raw).hexdigest()


def stage_runtime(source: Path, cache: Path, workspace: Path) -> Path:
    """原子部署内容寻址缓存，已有版本重新核验，不清理历史运行时。"""
    source, cache, workspace = source.resolve(), cache.absolute(), workspace.resolve()
    if cache.resolve().is_relative_to(workspace):
        raise ValueError("runtime_cache_inside_workspace")
    manifest, digest = verify_bundle(source)
    ensure_private_directory(cache)
    destination = cache / digest
    if destination.exists():
        if verify_bundle(destination)[1] != digest:
            raise ValueError("runtime_cache_corrupt")
        return destination / manifest["executable"]
    temporary = cache / ("stage-" + secrets.token_hex(12))
    try:
        ensure_private_directory(temporary)
        shutil.copytree(source, temporary, dirs_exist_ok=True)
        if verify_bundle(temporary)[1] != digest:
            raise ValueError("runtime_copy_mismatch")
        try:
            temporary.rename(destination)
        except OSError:
            if not destination.exists() or verify_bundle(destination)[1] != digest:
                raise
        return destination / manifest["executable"]
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main(argv: list[str] | None = None) -> int:
    """冻结程序内部缓存入口，仅接受本地宿主启动参数。"""
    parser = argparse.ArgumentParser(prog="rvguarder-backend runtime-stage")
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args(argv)
    if not getattr(sys, "frozen", False):
        parser.error("runtime-stage requires bundled executable")
    executable = stage_runtime(Path(sys.executable).parent, args.cache, args.workspace)
    print(json.dumps({"executable": str(executable)}, ensure_ascii=False))
    return 0
