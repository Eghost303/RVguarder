from pathlib import Path

import json
import tempfile

import pytest

from clawRVguarder.config import AppContext, GuardSettings, OpenClawTarget, default_paths
from clawRVguarder.integrations.hook_runtime import (
    _ensure_plugin_config,
    _is_transient_path,
    ensure_runtime_hook_plugin,
    register_runtime_hook_in_config,
)


def test_ensure_plugin_config_removes_stale_tmp_guard_paths_and_deduplicates(tmp_path):
    plugin_dir = tmp_path / "runtime" / "openclaw-guard-plugin"
    config = {
        "plugins": {
            "load": {
                "paths": [
                    str(plugin_dir),
                    "/tmp/stale-guard/runtime/openclaw-guard-plugin",
                    str(plugin_dir),
                    "/opt/other-openclaw-plugin",
                ]
            }
        }
    }

    changed = _ensure_plugin_config(
        config,
        plugin_dir=plugin_dir,
        guard_url="http://127.0.0.1:8780",
        auth_token="token",
    )

    assert changed is True
    assert config["plugins"]["load"]["paths"] == [
        str(plugin_dir),
        "/opt/other-openclaw-plugin",
    ]


@pytest.mark.parametrize("stale", [
    "/tmp/stale-guard/runtime/openclaw-guard-plugin",
    str(Path(tempfile.gettempdir()) / "stale-guard" / "runtime" / "openclaw-guard-plugin"),
    (Path(tempfile.gettempdir()) / "stale-guard" / "runtime" / "openclaw-guard-plugin").as_posix(),
])
def test_stale_guard_paths_are_removed_regardless_of_separator(tmp_path, stale):
    """POSIX 字面量、原生反斜杠与 as_posix() 三种形式都必须被清理。"""
    plugin_dir = tmp_path / "runtime" / "openclaw-guard-plugin"
    config = {"plugins": {"load": {"paths": [stale, str(plugin_dir), "/opt/other-openclaw-plugin"]}}}

    assert _ensure_plugin_config(
        config, plugin_dir=plugin_dir, guard_url="http://127.0.0.1:8780", auth_token="token",
    ) is True
    assert config["plugins"]["load"]["paths"] == [str(plugin_dir), "/opt/other-openclaw-plugin"]


def test_non_temporary_missing_guard_path_is_preserved(tmp_path):
    """不在临时目录内的 Guard 路径即使缺失也不能被删除。"""
    plugin_dir = tmp_path / "runtime" / "openclaw-guard-plugin"
    preserved = str(Path.cwd() / "projects" / "old" / "runtime" / "openclaw-guard-plugin")
    config = {"plugins": {"load": {"paths": [preserved, str(plugin_dir)]}}}

    _ensure_plugin_config(config, plugin_dir=plugin_dir, guard_url="http://127.0.0.1:8780", auth_token="token")

    assert config["plugins"]["load"]["paths"] == [preserved, str(plugin_dir)]


def test_posix_temp_roots_are_transient_on_every_platform():
    """Windows 会把 /tmp/x 解析成当前盘符路径，仍须识别为临时目录。"""
    assert _is_transient_path(Path("/tmp/stale"))
    assert _is_transient_path(Path("/var/tmp/stale"))
    assert not _is_transient_path(Path("/opt/other-openclaw-plugin"))


def test_transient_guard_project_does_not_mutate_ambient_openclaw_config(tmp_path):
    """Temporary test projects must not register their soon-to-be-deleted plugin globally."""
    project_dir = tmp_path / "temporary-guard"
    config_path = tmp_path / "ambient-openclaw" / "openclaw.json"
    config_path.parent.mkdir()
    original = {"plugins": {"load": {"paths": ["/opt/other-openclaw-plugin"]}}}
    config_path.write_text(json.dumps(original), encoding="utf-8")
    context = AppContext(
        paths=default_paths(project_dir),
        target=OpenClawTarget(config_path=config_path),
        settings=GuardSettings(host="127.0.0.1", port=8780),
    )

    result = ensure_runtime_hook_plugin(context)

    assert result["config_changed"] is False
    assert result["config_skipped"] is True
    assert json.loads(config_path.read_text(encoding="utf-8")) == original


def test_manual_hook_registration_also_skips_transient_external_config(tmp_path):
    """The explicit install endpoint must share the same isolation boundary."""
    plugin_dir = tmp_path / "temporary-guard" / "runtime" / "openclaw-guard-plugin"
    config_path = tmp_path / "ambient-openclaw" / "openclaw.json"
    config_path.parent.mkdir()
    original = {"plugins": {"load": {"paths": ["/opt/other-openclaw-plugin"]}}}
    config_path.write_text(json.dumps(original), encoding="utf-8")

    changed = register_runtime_hook_in_config(config_path, plugin_dir)

    assert changed is False
    assert json.loads(config_path.read_text(encoding="utf-8")) == original


def test_transient_guard_project_can_write_project_local_config(tmp_path):
    """Isolation must not disable an explicitly project-local OpenClaw config."""
    project_dir = tmp_path / "temporary-guard"
    config_path = project_dir / "openclaw.json"
    project_dir.mkdir()
    config_path.write_text("{}", encoding="utf-8")
    context = AppContext(
        paths=default_paths(project_dir),
        target=OpenClawTarget(config_path=config_path),
        settings=GuardSettings(host="127.0.0.1", port=8780),
    )

    result = ensure_runtime_hook_plugin(context)

    assert result["config_changed"] is True
    assert result["config_skipped"] is False
    data = json.loads(config_path.read_text(encoding="utf-8"))
    assert str(project_dir / "runtime" / "openclaw-guard-plugin") in data["plugins"]["load"]["paths"]
