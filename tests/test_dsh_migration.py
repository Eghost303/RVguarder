"""离线迁移与运行时缓存：真实历史、只读预检、事务回滚与负例。"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from clawRVguarder.hosts.dsh import migration
from clawRVguarder.hosts.dsh.services import DshServices
from clawRVguarder.hosts.dsh.runtime_bundle import stage_runtime
from clawRVguarder.storage.private_files import ensure_private_directory


@pytest.fixture
def legacy(tmp_path, monkeypatch):
    """建立有真实审计、令牌与完成队列的停止实例。"""
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    home = tmp_path / "home"
    profile = home / "profiles/legacy"
    profile.mkdir(parents=True)
    (profile / "package.json").write_text(json.dumps({"name": "legacy", "dependencies": {"dsh-rvguarder": "old.tgz", "other": "1.0"}, "dsh": {"profile": {"bundles": ["other"]}}}))
    project = tmp_path / "data"
    manager = DshServices(project, dsh_home=home, profile="legacy", workspace=workspace, instance_id="old-id", semantic_mode="local")
    manager.audit_store.append("migration_fixture", {"safe": True})
    call = {"protocol": "dsh-guard-v2", "instance_id": "old-id", "session_id": "test", "agent_id": "test", "call_id": "confirmed", "root_call_id": "confirmed", "tool_name": "read", "cwd": str(workspace), "arguments": {"file_path": "source.txt"}}
    manager.bridge_before(call)
    manager.bridge_dispatch(call)
    manager.close()
    state = project / "runtime/plugin-state"
    ensure_private_directory(state)
    (state / "executions.json").write_text("[]")
    (state / "completions.json").write_text(json.dumps([{"call": call, "succeeded": True, "dispatched": True}]))
    config = {"instanceId": "old-id", "tokenFile": str(project / "runtime/dsh-token"), "stateDir": str(state), "backendUrl": "http://127.0.0.1:8781", "failMode": "open", "evidenceKeyFile": "keep-key-reference", "egressAllowlist": ["https://example.org/exact"]}
    rows = [{"insert": [{"id": "rvguarder-dsh", "name": "dsh-rvguarder", "disabled": True, "config": config}, {"id": "other", "name": "other", "config": {"keep": True}}]}]
    (profile / "cordis.patch.yml").write_text(yaml.safe_dump(rows))
    return profile, project, state, manager


def _files(root: Path) -> dict:
    """计算业务历史摘要，证明配置迁移未修改或删除数据。"""
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob("*") if p.is_file() and p.name != "dsh-owner.lock"}


def test_inspect_apply_repeat_and_rollback_preserve_history(legacy):
    profile, project, state, _ = legacy
    before = _files(project)
    old = {p.name: p.read_bytes() for p in profile.iterdir() if p.is_file()}
    preview = migration.inspect(profile)
    assert preview["ready"] and preview["pending_completions"] == 1
    assert _files(project) == before
    result = migration.apply(profile, preview["digest"])
    patches = yaml.safe_load((profile / "cordis.patch.yml").read_text())
    core = next(p for p in patches if p.get("id") == "rvguarder-dsh")
    assert core["disabled"] is True
    assert core["config"]["egressAllowlist"] == ["https://example.org/exact"]
    assert core["config"]["failMode"] == "open"
    assert core["config"]["managedBinding"]["instanceId"] == "old-id"
    assert patches[0]["insert"][0]["id"] == "other"
    assert _files(project) == before
    again = migration.inspect(profile)
    assert migration.apply(profile, again["digest"])["migrated"] is False
    migration.rollback(profile, result["backup"])
    assert all((profile / name).read_bytes() == data for name, data in old.items())
    assert _files(project) == before


@pytest.mark.parametrize("problem", ["executions", "higher", "changed", "owned", "legacy-protocol", "include"])
def test_unsafe_migration_is_refused_without_changes(legacy, problem):
    profile, project, state, manager = legacy
    preview = migration.inspect(profile)
    if problem == "executions":
        (state / "executions.json").write_text('[{"call_id":"uncertain"}]')
    elif problem == "higher":
        (profile.parent.parent / "cordis.patch.yml").write_text('- id: rvguarder-dsh\n  disabled: true\n')
    elif problem == "changed":
        (profile / "package.json").write_text((profile / "package.json").read_text() + "\n")
    elif problem == "owned":
        from clawRVguarder.hosts.dsh.ownership import DirectoryLease
        owner = DirectoryLease(project / "runtime")
    elif problem == "legacy-protocol":
        (state / "completions.json").write_text('[{"call":{"protocol":"v1"}}]')
    else:
        (profile / "cordis.patch.yml").write_text('- include: custom.yml\n')
    before = _files(project)
    try:
        with pytest.raises((ValueError, OSError)):
            migration.apply(profile, preview["digest"])
    finally:
        if problem == "owned":
            owner.close()
    assert _files(project) == before


def test_partial_configuration_write_restores_backup(legacy):
    profile, project, _, _ = legacy
    preview = migration.inspect(profile)
    paths = [profile / "package.json", profile / "cordis.patch.yml"]
    before = [p.read_bytes() for p in paths]
    original = migration._replace
    count = 0
    def fail_once(path, data):
        """第二次写入故障，随后允许恢复。"""
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("injected")
        original(path, data)
    with patch.object(migration, "_replace", side_effect=fail_once), pytest.raises(OSError):
        migration.apply(profile, preview["digest"])
    assert [p.read_bytes() for p in paths] == before


def test_runtime_cache_is_content_addressed_and_rejects_corruption(tmp_path):
    source = tmp_path / "package"
    source.mkdir()
    (source / "backend.exe").write_bytes(b"fixture")
    (source / "manifest.json").write_text(json.dumps({"schema": 1, "executable": "backend.exe", "files": {"backend.exe": hashlib.sha256(b"fixture").hexdigest()}}))
    cache = tmp_path / "cache"
    target = stage_runtime(source, cache, tmp_path / "workspace")
    assert target == stage_runtime(source, cache, tmp_path / "workspace")
    target.write_bytes(b"corrupt")
    with pytest.raises(ValueError):
        stage_runtime(source, cache, tmp_path / "workspace")


def test_confirmed_completion_replays_once_after_migration_and_survives_rollback(legacy):
    """真实 dispatched 调用迁移后恢复，重复补交不增加成功历史或审计。"""
    profile, project, state, old = legacy
    token = (project / "runtime/dsh-token").read_bytes()
    plan = migration.inspect(profile)
    result = migration.apply(profile, plan["digest"])
    restored = DshServices(project, dsh_home=profile.parent.parent, profile="legacy", workspace=old.context.target.workspace_path, instance_id="old-id", semantic_mode="local")
    try:
        assert restored.recovery_required
        completion = json.loads((state / "completions.json").read_text())[0]
        assert restored.bridge_result(completion["call"], succeeded=True, dispatched=True)["duplicate"] is False
        after = restored.audit_store.query(limit=10000)
        assert restored.bridge_result(completion["call"], succeeded=True, dispatched=True)["duplicate"] is True
        assert restored.audit_store.query(limit=10000) == after
        assert restored.recovery_required is False
    finally:
        restored.close()
    history = _files(project)
    migration.rollback(profile, result["backup"])
    assert _files(project) == history
    assert (project / "runtime/dsh-token").read_bytes() == token


@pytest.mark.parametrize("problem", ["audit", "queue-identity", "rollback-edit", "dynamic"])
def test_corrupt_history_or_configuration_cannot_migrate_or_overwrite(legacy, problem):
    """损坏审计、跨实例队列、动态配置和迁移后二次编辑均明确拒绝。"""
    profile, project, state, _ = legacy
    if problem == "rollback-edit":
        result = migration.apply(profile, migration.inspect(profile)["digest"])
        path = profile / "cordis.patch.yml"
        path.write_text(path.read_text() + "\n# owner edit\n")
        with pytest.raises(ValueError, match="configuration_changed"):
            migration.rollback(profile, result["backup"])
        assert "owner edit" in path.read_text()
        return
    if problem == "audit":
        path = project / "output/audit/audit.jsonl"
        path.write_text(path.read_text(encoding="utf8").replace('"GENESIS"', '"tampered"', 1), encoding="utf8")
    elif problem == "queue-identity":
        path = state / "completions.json"
        path.write_text(path.read_text().replace('"old-id"', '"other-id"'))
    else:
        path = profile / "cordis.patch.yml"
        path.write_text(path.read_text().replace("config:", "config: !include custom.yml\n      ignored:", 1))
    with pytest.raises((ValueError, yaml.YAMLError)):
        migration.inspect(profile)


def test_unrelated_custom_yaml_tag_survives(legacy):
    """其他插件的自定义标签保持语义，迁移器不求值。"""
    profile, _, _, _ = legacy
    path = profile / "cordis.patch.yml"
    path.write_text(path.read_text() + "\n- id: unrelated\n  config: !custom {keep: original}\n")
    migration.apply(profile, migration.inspect(profile)["digest"])
    assert "!custom" in path.read_text() and "original" in path.read_text()


@pytest.mark.skipif(not os.environ.get("RVGUARDER_TEST_BACKEND"), reason="platform frozen executable required")
def test_frozen_maintenance_cli_needs_no_python(legacy, tmp_path):
    """从仓库外执行随包维护入口，预检、应用和回滚都使用冻结程序。"""
    profile, project, _, _ = legacy
    executable = os.environ["RVGUARDER_TEST_BACKEND"]
    def run(command, *args):
        """读取本机结构化结果，不向日志输出路径或凭据。"""
        result = subprocess.run([executable, "migrate", command, "--profile-dir", str(profile), *args], cwd=tmp_path, text=True, encoding="utf8", capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr + result.stdout
        return json.loads(result.stdout)
    history = _files(project)
    preview = run("inspect")
    applied = run("apply", "--digest", preview["digest"])
    assert run("apply", "--digest", run("inspect")["digest"])["migrated"] is False
    assert run("rollback", "--backup", applied["backup"])["rolled_back"]
    assert _files(project) == history
