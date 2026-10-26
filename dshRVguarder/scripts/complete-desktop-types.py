"""为桌面 SDK 缓存补齐同版本 npm 类型声明；保留桌面运行代码不变。"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
from urllib.parse import quote, urlsplit
from urllib.request import urlopen


def complete(root: Path) -> list[dict]:
    """仅取 npm 官方同版本包的声明文件，核验下载完整性并记录来源。"""
    snapshot = json.loads((root / "sdk-snapshot.json").read_text(encoding="utf-8"))
    pending = []
    for name, version in snapshot["packages"].items():
        package = root / "node_modules" / name
        data = json.loads((package / "package.json").read_text(encoding="utf-8"))
        types = data.get("types", data.get("typings"))
        if types and not (package / types).is_file():
            pending.append((name, version, package))

    def fetch(item):
        name, version, package = item
        with urlopen(f"https://registry.npmjs.org/{quote(name, safe='')}/{quote(version)}", timeout=30) as response:
            metadata = json.load(response)
        if metadata["name"] != name or metadata["version"] != version:
            raise ValueError("npm SDK identity mismatch")
        dist = metadata["dist"]
        if urlsplit(dist["tarball"]).netloc != "registry.npmjs.org":
            raise ValueError("unexpected SDK tarball origin")
        with urlopen(dist["tarball"], timeout=60) as response:
            payload = response.read(32 * 1024 * 1024 + 1)
        if len(payload) > 32 * 1024 * 1024:
            raise ValueError("SDK type package exceeds limit")
        digest = "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
        if digest != dist["integrity"]:
            raise ValueError("SDK tarball integrity mismatch")
        count = 0
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            packed = json.load(archive.extractfile("package/package.json"))
            if packed["name"] != name or packed["version"] != version:
                raise ValueError("SDK packed identity mismatch")
            for entry in archive:
                path = PurePosixPath(entry.name)
                if not entry.isfile() or not entry.name.endswith((".d.ts", ".d.mts", ".d.cts")):
                    continue
                if path.is_absolute() or path.parts[0] != "package" or any(part in {".", ".."} or ":" in part or "\\" in part for part in path.parts):
                    raise ValueError("unsafe SDK declaration path")
                target = package.joinpath(*path.parts[1:])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(entry).read())
                count += 1
        return {"name": name, "version": version, "integrity": digest, "declarations": count}

    with ThreadPoolExecutor(max_workers=4) as executor:
        result = list(executor.map(fetch, pending))
    report = root / "sdk-types.json"
    previous = json.loads(report.read_text(encoding="utf-8")) if report.exists() else []
    report.write_text(json.dumps(previous + result, indent=2), encoding="utf-8")
    return result


def main() -> None:
    """补齐指定桌面 SDK 缓存的开发声明，不安装 DSH 或执行包脚本。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-root", type=Path, required=True)
    args = parser.parse_args()
    result = complete(args.sdk_root)
    print(json.dumps({"packages": len(result), "declarations": sum(item["declarations"] for item in result)}))


if __name__ == "__main__":
    main()
