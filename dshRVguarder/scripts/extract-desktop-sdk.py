"""只读提取已安装桌面 DSH 的开发依赖，不安装第二份 DSH 或改动 app.asar。"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct

SDK_PACKAGES = (
    "cordis", "dsh-tools", "dsh-agent", "dsh-working-directory", "dsh-subagent",
    "dsh-session", "dsh-system-prompt", "dsh-ptc-runtime-node", "dsh-fs-local",
    "dsh-subprocess-local", "dsh-sandbox-local",
)
OPTIONAL_SDK_PACKAGES = (
    "dsh-agent-preset-registry", "dsh-subagent-spawn-in-process",
)


def extract(archive: Path, output: Path) -> dict:
    """按包依赖闭包提取 SDK 和测试依赖，核对版本并记录源 archive 哈希。"""
    if output.exists():
        raise ValueError("output must be a new directory")
    with archive.open("rb") as stream:
        prefix = stream.read(16)
        _, header_size, _, json_size = struct.unpack("<4I", prefix)
        tree = json.loads(stream.read(json_size))
        base = 8 + header_size

        def entry(path):
            node = tree
            for part in PurePosixPath(path).parts:
                if part in {".", ".."}:
                    raise ValueError("invalid archive path")
                node = node["files"][part]
            if "link" in node:
                return entry(node["link"])
            return node

        def read(path):
            node = entry(path)
            if node.get("unpacked"):
                return Path(str(archive) + ".unpacked").joinpath(*PurePosixPath(path).parts).read_bytes()
            stream.seek(base + int(node["offset"]))
            result = stream.read(node["size"])
            if len(result) != node["size"]:
                raise ValueError("truncated ASAR entry")
            return result

        metadata = json.loads(read("dsh/package.json"))
        if metadata.get("name") != "@deepseek-ai/dsh-desktop-runtime" or metadata.get("version") not in {"0.2.1-rc.2", "0.2.1-rc.3"}:
            raise ValueError("unsupported desktop runtime")
        pending = ["@deepseek-ai/" + name for name in (*SDK_PACKAGES, *OPTIONAL_SDK_PACKAGES)]
        packages = {}
        while pending:
            name = pending.pop()
            if name in packages:
                continue
            try:
                package = json.loads(read(f"dsh/node_modules/{name}/package.json"))
            except KeyError:
                # 未随 Windows 桌面包分发的可选平台依赖不从网络补装。
                continue
            packages[name] = package
            pending.extend(package.get("dependencies", {}))
            pending.extend(package.get("optionalDependencies", {}))
            pending.extend(package.get("peerDependencies", {}))
        for name in SDK_PACKAGES:
            key = "@deepseek-ai/" + name
            if key not in packages:
                raise ValueError(f"desktop SDK missing {key}")
            expected = "4.0.5" if name == "cordis" else metadata["version"]
            if packages[key]["version"] != expected:
                raise ValueError(f"desktop SDK version mismatch: {key}")
        for name in OPTIONAL_SDK_PACKAGES:
            key = "@deepseek-ai/" + name
            if key in packages and packages[key]["version"] != metadata["version"]:
                raise ValueError(f"desktop semantic SDK version mismatch: {key}")
        output.mkdir(parents=True)
        (output / "package.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        files = 0

        def copy(node, source, destination):
            nonlocal files
            if "link" in node:
                raise ValueError(f"SDK archive link is not supported: {source}")
            if "files" in node:
                destination.mkdir(parents=True, exist_ok=True)
                for name, child in node["files"].items():
                    if name in {".", ".."} or any(c in name for c in "/\\:"):
                        raise ValueError("unsafe SDK archive name")
                    copy(child, source + "/" + name, destination / name)
            else:
                destination.write_bytes(read(source))
                files += 1

        for name in sorted(packages):
            source = f"dsh/node_modules/{name}"
            destination = output / "node_modules" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy(entry(source), source, destination)
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    report = {"sdk_version": metadata["version"], "source": str(archive.resolve()), "archive_sha256": digest,
              "packages": {name: value["version"] for name, value in sorted(packages.items())}, "files": files}
    (output / "sdk-snapshot.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    """从用户指定的桌面安装提取 SDK 到新的本地缓存目录。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.archive, args.output)
    print(json.dumps({"sdk_version": result["sdk_version"], "packages": len(result["packages"]),
                      "files": result["files"], "output": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
