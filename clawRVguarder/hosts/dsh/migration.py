"""离线配置迁移：只读预检、保留实例与队列的托管切换、配置回滚。"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, nullcontext
import difflib
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import time
import tempfile
import shutil
from typing import Iterator

import yaml
from yaml.nodes import MappingNode, ScalarNode, SequenceNode

from clawRVguarder.storage.private_files import ensure_private_directory, private_file


def _hash(data: bytes) -> str:
    """生成文件摘要供二次检查与回滚比较。"""
    return hashlib.sha256(data).hexdigest()


def _read(path: Path) -> bytes:
    """拒绝迁移输入中的链接，避免配置或历史重定向到其他实例。"""
    if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (path, *path.parents)):
        raise ValueError("migration_links_forbidden")
    return path.read_bytes()


def _plain(node):
    """提取普通节点，动态标签不求值。"""
    if not node.tag.startswith("tag:yaml.org,2002:"):
        raise ValueError("dynamic_rvguarder_configuration_unsupported")
    return yaml.safe_load(yaml.serialize(node))


def _mapping(node: MappingNode) -> dict:
    """按键读取映射节点并拒绝重复键。"""
    result = {}
    for key, value in node.value:
        name = _plain(key)
        if name in result:
            raise ValueError("duplicate_yaml_key")
        result[name] = value
    return result


def _rows(root: SequenceNode) -> list[tuple[MappingNode, dict]]:
    """识别自身 insert/id 条目，保留其他节点与自定义标签。"""
    result = []
    for patch in root.value:
        if not isinstance(patch, MappingNode):
            raise ValueError("invalid_patch_shape")
        fields = _mapping(patch)
        if "include" in fields:
            raise ValueError("included_configuration_requires_manual_review")
        inserted = fields.get("insert")
        nodes = inserted.value if isinstance(inserted, SequenceNode) else [patch]
        for row in nodes:
            if not isinstance(row, MappingNode):
                raise ValueError("invalid_entry_shape")
            values = _mapping(row)
            entry_id = _plain(values["id"]) if "id" in values else None
            if entry_id in {"rvguarder-dsh", "rvguarder-admin"}:
                result.append((row, values))
    return result


@contextmanager
def _lease(path: Path) -> Iterator[None]:
    """只锁已存在的实例锁文件，预检不创建文件或改动业务数据。"""
    with path.open("r+b") as stream:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def _private(path: Path) -> None:
    """不修改 ACL 地核验现有私有目录和路径链。"""
    if os.name == "nt":
        from clawRVguarder.storage.windows_files import open_directory_chain
        with open_directory_chain(path, private=True):
            pass
    else:
        info = path.stat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("instance_directory_not_private")
    if any(p.is_symlink() or getattr(p, "is_junction", lambda: False)() for p in (path, *path.parents)):
        raise ValueError("migration_links_forbidden")


@contextmanager
def _database(path: Path) -> Iterator[sqlite3.Connection]:
    """在临时快照中读取 WAL，避免 SQLite 对原目录创建 shm/wal 文件。"""
    with tempfile.TemporaryDirectory(prefix="rvguarder-inspect-") as folder:
        target = Path(folder) / path.name
        target.write_bytes(_read(path))
        wal = path.with_name(path.name + "-wal")
        if wal.exists():
            target.with_name(target.name + "-wal").write_bytes(_read(wal))
        db = sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)
        try:
            yield db
        finally:
            db.close()


def _inspect(profile_dir: Path, *, locked: bool = False) -> dict:
    """计算迁移方案并验证历史，返回内部方案；调用者只输出脱敏信息。"""
    profile_dir = profile_dir.resolve()
    home = profile_dir.parent.parent
    if profile_dir.parent.name != "profiles":
        raise ValueError("expected_dsh_profiles_directory")
    paths = [profile_dir / "package.json", profile_dir / "cordis.patch.yml"]
    originals = [_read(p) for p in paths]
    manifest = json.loads(originals[0])
    root = yaml.compose(originals[1].decode("utf8"))
    if not isinstance(root, SequenceNode):
        raise ValueError("profile_patch_must_be_array")
    rows = _rows(root)
    core = [(row, fields) for row, fields in rows if _plain(fields["id"]) == "rvguarder-dsh"]
    if len(core) != 1:
        raise ValueError("ambiguous_rvguarder_entry")
    core_config = _plain(core[0][1].get("config", yaml.compose("{}")))
    binding = core_config.get("managedBinding")
    already = core_config.get("backendMode") == "managed"
    if already and not binding:
        raise ValueError("fresh_managed_instance_needs_no_legacy_migration")
    token = Path(core_config.get("tokenFile", ""))
    project = Path(binding["projectDir"]) if binding else token.parent.parent
    instance = binding["instanceId"] if binding else core_config.get("instanceId")
    state = Path(binding["stateDir"] if binding else core_config.get("stateDir", ""))
    if not project.is_absolute() or not state.is_absolute() or (not binding and (token.name != "dsh-token" or token.parent.name != "runtime")):
        raise ValueError("noncanonical_legacy_paths")
    runtime = project / "runtime"
    _private(runtime)
    _private(state)
    lock = state / "owner.lock/pid"
    if lock.exists():
        pid = int(lock.read_text())
        if pid <= 0:
            raise ValueError("invalid_plugin_owner_pid")
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            raise ValueError("stale_plugin_lease_requires_reconciliation") from None
        raise ValueError("stop_dsh_before_migration")
    higher = home / "cordis.patch.yml"
    if higher.exists():
        text = _read(higher).decode("utf8")
        if text.strip() not in {"", "[]"}:
            raise ValueError("higher_priority_configuration_requires_review")
    executions = json.loads(_read(state / "executions.json")) if (state / "executions.json").exists() else []
    completions = json.loads(_read(state / "completions.json")) if (state / "completions.json").exists() else []
    if not isinstance(executions, list) or not isinstance(completions, list):
        raise ValueError("invalid_completion_history")
    if any(not isinstance(item, dict) for item in [*executions, *completions]) or any(not isinstance(item.get("call"), dict) for item in completions):
        raise ValueError("invalid_completion_history")
    if any(item.get("call", {}).get("protocol") != "dsh-guard-v2" for item in completions):
        raise ValueError("legacy_completion_protocol_unsupported")
    if any(not any(item.get("call") == call for item in completions) for call in executions):
        raise ValueError("unconfirmed_executions_require_reconciliation")
    from .http import Completion
    confirmed = {}
    for item in completions:
        parsed = Completion.model_validate(item)
        call = parsed.call.model_dump(exclude_none=True)
        if call["instance_id"] != instance or not Path(call["cwd"]).is_absolute():
            raise ValueError("completion_instance_mismatch")
        confirmed[_hash(json.dumps(call, ensure_ascii=False, sort_keys=True).encode())] = parsed
    with (nullcontext() if locked else _lease(runtime / "dsh-owner.lock")), _database(runtime / "dsh-calls.sqlite3") as db:
        stored = db.execute("SELECT value FROM metadata WHERE key='binding'").fetchone()
        security = json.loads(stored[0]) if stored else {}
        if security.get("schema") != 2 or security.get("protocol") != "dsh-guard-v2" or security.get("instance") != instance or security.get("profile") != profile_dir.name or Path(security.get("dsh_home", "")).resolve() != home:
            raise ValueError("instance_binding_mismatch")
        for digest, completion in confirmed.items():
            row = db.execute("SELECT state FROM calls WHERE digest=?", (digest,)).fetchone()
            if not row or row[0] not in {"pending", "dispatched", "completed"} or row[0] == "pending" and completion.dispatched:
                raise ValueError("completion_journal_mismatch")
        for digest, status in db.execute("SELECT digest,state FROM calls WHERE state IN ('deciding','completing','dispatched')"):
            if status != "dispatched" or digest not in confirmed or not confirmed[digest].dispatched:
                raise ValueError("unconfirmed_calls_require_reconciliation")
    workspace = Path(security["workspace"]).resolve()
    if project.resolve().is_relative_to(workspace) or state.resolve().is_relative_to(workspace):
        raise ValueError("guard_state_inside_workspace")
    # 直接核验 JSONL 哈希链，不构造会写入数据库的服务容器。
    audit = project / "output/audit/audit.jsonl"
    if audit.exists():
        previous = "GENESIS"
        for line in _read(audit).decode("utf8").splitlines():
            record = json.loads(line)
            payload = json.dumps(record["payload"], sort_keys=True, ensure_ascii=False)
            expected = hashlib.sha256((previous + payload).encode()).hexdigest()
            if record["previous_hash"] != previous or record["record_hash"] != expected:
                raise ValueError("audit_chain_invalid")
            previous = record["record_hash"]
    audit_db = project / "output/audit/audit.db"
    if audit_db.exists():
        with _database(audit_db) as db:
            columns = {row[1] for row in db.execute("PRAGMA table_info(audit_log)")}
            payload_column = "payload_json" if "payload_json" in columns else "payload"
            previous = "GENESIS"
            for payload, prior, digest in db.execute(f"SELECT {payload_column},previous_hash,record_hash FROM audit_log ORDER BY timestamp,rowid"):
                expected = _hash((previous + payload).encode())
                if prior != previous or digest != expected:
                    raise ValueError("audit_database_chain_invalid")
                previous = digest
    managed = {"projectDir": str(project.resolve()), "instanceId": instance, "stateDir": str(state.resolve())}
    if not already:
        for row, fields in rows:
            config = _plain(fields.get("config", yaml.compose("{}")))
            config.update(backendMode="managed", managedBinding=managed)
            node = yaml.compose(yaml.safe_dump(config, allow_unicode=True))
            row.value = [(k, v) for k, v in row.value if _plain(k) != "config"] + [(ScalarNode("tag:yaml.org,2002:str", "config"), node)]
        if not any(_plain(fields["id"]) == "rvguarder-admin" for _, fields in rows):
            root.value.append(yaml.compose(yaml.safe_dump({"id": "rvguarder-admin", "name": "dsh-rvguarder/admin", "config": {"backendMode": "managed", "managedBinding": managed}})))
        bundles = manifest.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
        if "dsh-rvguarder" not in bundles:
            bundles.append("dsh-rvguarder")
        # bundle 已提供 insert，移除旧自身 insert 后以 id 覆盖，保留同组其他插件。
        for patch in list(root.value):
            fields = _mapping(patch)
            inserted = fields.get("insert")
            if isinstance(inserted, SequenceNode):
                selected = [row for row in inserted.value if any(row is own for own, _ in rows)]
                inserted.value = [row for row in inserted.value if row not in selected]
                root.value.extend(selected)
                if not inserted.value:
                    root.value.remove(patch)
    changed = [json.dumps(manifest, ensure_ascii=False, indent=2).encode() + b"\n", yaml.serialize(root, allow_unicode=True).encode()]
    if already:
        changed = originals
    digest = _hash(b"\0".join(originals))
    return {"paths": paths, "originals": originals, "changed": changed, "digest": digest,
            "binding": managed, "workspace": str(workspace), "already": already,
            "pending_completions": len(completions), "runtime": runtime}


def inspect(profile_dir: Path) -> dict:
    """返回无凭据的摘要与配置差异，不写文件。"""
    plan = _inspect(profile_dir)
    # diff 的私有路径仅供本机操作者查看，不经浏览器或 Remote 返回。
    return {"ready": True, "already_managed": plan["already"], "digest": plan["digest"],
            "pending_completions": plan["pending_completions"],
            "diff": "\n".join("\n".join(difflib.unified_diff(a.decode().splitlines(), b.decode().splitlines(), fromfile=p.name, tofile=p.name)) for p, a, b in zip(plan["paths"], plan["originals"], plan["changed"]))}


def _replace(path: Path, content: bytes) -> None:
    """同目录原子替换配置文件。"""
    temporary = path.with_name(path.name + ".rvguarder-tmp")
    with temporary.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def apply(profile_dir: Path, digest: str) -> dict:
    """核对方案摘要、备份并更新自身配置，失败立即恢复。"""
    plan = _inspect(profile_dir)
    if plan["digest"] != digest:
        raise ValueError("configuration_changed_since_inspect")
    if plan["already"]:
        return {"migrated": False, "reason": "already-managed"}
    with _lease(plan["runtime"] / "dsh-owner.lock"):
        plan = _inspect(profile_dir, locked=True)
        if _hash(b"\0".join(p.read_bytes() for p in plan["paths"])) != digest:
            raise ValueError("configuration_changed_since_inspect")
        backup = profile_dir.resolve() / (".rvguarder-migration-" + str(time.time_ns()))
        ensure_private_directory(backup)
        metadata = {"files": {}, "binding": plan["binding"]}
        for path, before, after in zip(plan["paths"], plan["originals"], plan["changed"]):
            with private_file(backup / path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL) as fd:
                os.write(fd, before)
            metadata["files"][path.name] = {"before": _hash(before), "after": _hash(after)}
        with private_file(backup / "migration.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL) as fd:
            os.write(fd, json.dumps(metadata).encode())
        try:
            for path, after in zip(plan["paths"], plan["changed"]):
                _replace(path, after)
        except BaseException:
            for path, before in zip(plan["paths"], plan["originals"]):
                if path.read_bytes() != before:
                    _replace(path, before)
            raise
    return {"migrated": True, "backup": backup.name, "history_preserved": True}


def rollback(profile_dir: Path, backup_id: str) -> dict:
    """仅恢复匹配摘要的配置，不回退或删除业务数据。"""
    if Path(backup_id).name != backup_id or not backup_id.startswith(".rvguarder-migration-"):
        raise ValueError("invalid_backup_id")
    backup = profile_dir.resolve() / backup_id
    _private(backup)
    metadata = json.loads((backup / "migration.json").read_text())
    plan = _inspect(profile_dir)
    with _lease(plan["runtime"] / "dsh-owner.lock"):
        _inspect(profile_dir, locked=True)
        for name, hashes in metadata["files"].items():
            if name not in {"package.json", "cordis.patch.yml"} or _hash(_read(profile_dir / name)) != hashes["after"] or _hash(_read(backup / name)) != hashes["before"]:
                raise ValueError("configuration_changed_since_migration")
        current = {name: _read(profile_dir / name) for name in metadata["files"]}
        try:
            for name in metadata["files"]:
                _replace(profile_dir / name, _read(backup / name))
        except BaseException:
            for name, content in current.items():
                if _read(profile_dir / name) != content:
                    _replace(profile_dir / name, content)
            raise
    return {"rolled_back": True, "history_preserved": True}


def main(argv: list[str] | None = None) -> int:
    """离线维护入口，不注册 HTTP 或 Remote 配置修改方法。"""
    parser = argparse.ArgumentParser(prog="rvguarder-backend migrate")
    parser.add_argument("command", choices=["inspect", "apply", "rollback"])
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--digest")
    parser.add_argument("--backup")
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            result = inspect(args.profile_dir)
        elif args.command == "apply":
            if not args.digest:
                parser.error("apply requires --digest from inspect")
            result = apply(args.profile_dir, args.digest)
        else:
            if not args.backup:
                parser.error("rollback requires --backup")
            result = rollback(args.profile_dir, args.backup)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except yaml.YAMLError:
        print(json.dumps({"ready": False, "error": "unsupported_or_invalid_yaml"}))
        return 1
    except (ValueError, OSError, sqlite3.Error) as error:
        print(json.dumps({"ready": False, "error": str(error)}, ensure_ascii=False))
        return 1
