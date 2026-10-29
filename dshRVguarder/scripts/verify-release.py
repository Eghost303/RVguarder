"""核对完整发行包的版本、来源、文件摘要及独立发行仓库 ZIP 一致性。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile
import zipfile


def main() -> None:
    """只读验证构建产物，失败退出，不读取用户配置或运行数据。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    root = Path(__file__).resolve().parents[2]
    expected = json.loads((root / "dshRVguarder/package.json").read_text(encoding="utf-8"))
    tgz, = directory.glob("*.tgz")
    distribution, = directory.glob("*-distribution.zip")
    with tarfile.open(tgz, "r:gz") as archive:
        payload = {}
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            assert not path.is_absolute() and ".." not in path.parts
            assert path.parts[0] == "package" and not member.issym() and not member.islnk()
            if member.isfile():
                name = path.relative_to("package").as_posix()
                assert name not in payload
                payload[name] = archive.extractfile(member).read()
    with zipfile.ZipFile(distribution) as archive:
        assert len(archive.namelist()) == len(set(archive.namelist()))
        assert set(archive.namelist()) == set(payload)
        assert all(archive.read(name) == data for name, data in payload.items())
    metadata = json.loads(payload["package.json"])
    assert (metadata["name"], metadata["version"]) == (expected["name"], expected["version"])
    assert not metadata.get("private") and "scripts" not in metadata
    assert metadata["os"] == ["win32"] and metadata["cpu"] == ["x64"]
    assert metadata["repository"]["url"] == "git+https://github.com/HorizonExploration/RVguarder.git"
    assert metadata["publishConfig"] == {"access": "public", "tag": "next"}
    for name in ("dist/index.js", "dist/admin.js", "dist/webclient.js", "dist/semantic-tools-deny.js",
                 "cordis.patch.yml", "LICENSE", "SECURITY.md", "docs/deployment.md", "docs/release-current.md"):
        assert name in payload, name
    patch = json.loads(payload["cordis.patch.yml"])
    assert all(item["config"]["backendMode"] == "managed" for item in patch[0]["insert"])
    assert patch[0]["insert"][0]["config"]["failMode"] == "closed"
    forbidden_parts = {".git", "node_modules", ".env", ".npmrc", "__pycache__"}
    for name in payload:
        path = PurePosixPath(name)
        assert not forbidden_parts.intersection(path.parts), name
        assert path.suffix.lower() not in {".db", ".sqlite", ".sqlite3", ".jsonl", ".log"}, name
        assert path.name not in {"owner.lock", "hook-bridge.json", "binding.json", "outbox.json"}, name
    manifest = json.loads(payload["backend/manifest.json"])
    actual = {name.removeprefix("backend/") for name in payload if name.startswith("backend/")}
    assert actual == set(manifest["files"]) | {"manifest.json"}
    for name, digest in manifest["files"].items():
        assert hashlib.sha256(payload["backend/" + name]).hexdigest() == digest, name
    info = json.loads(payload["backend/build-info.json"])
    assert info["plugin_version"] == expected["version"] and not info["source_tree_dirty"]
    assert payload["backend/build-info.json"] == (directory / "BUILD-INFO.json").read_bytes()
    for line in (directory / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", 1)
        assert PurePosixPath(name).name == name
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest, name
    print(json.dumps({"version": metadata["version"], "source_commit": info["source_commit"],
                      "files": len(payload), "runtime_files": len(manifest["files"]),
                      "distribution_identical": True, "checksums": "passed", "private_data_scan": "passed",
                      "sha256": hashlib.sha256(tgz.read_bytes()).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
