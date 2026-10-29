"""Release-level contracts for the v0.2.1-rc.1 engineering baseline."""

from __future__ import annotations

from pathlib import Path
import json
from unittest.mock import MagicMock, patch

from clawRVguarder import __version__
from clawRVguarder.main import _select_launch_web, build_parser
from clawRVguarder.policy.catalog import PolicyBundle


ROOT = Path(__file__).parents[1]


def test_product_and_package_versions_share_the_release_version():
    assert __version__ == "0.2.1-rc.1"
    assert 'version = "0.2.1rc.1"' in (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    package = json.loads((ROOT / "dshRVguarder/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "dshRVguarder/package-lock.json").read_text(encoding="utf-8"))
    assert package["version"] == lock["version"] == lock["packages"][""]["version"] == __version__


def test_pmkb_bundle_components_are_all_on_120():
    bundle = PolicyBundle.load(ROOT / "policies" / "permissions")
    assert bundle.version == "1.2.0"


def test_fastapi_is_the_only_cli_web_selector():
    args = build_parser().parse_args(["run"])
    launcher = _select_launch_web(args)
    assert launcher.__module__ == "clawRVguarder.web.app"


def test_cli_does_not_override_process_environment_from_dotenv(tmp_path):
    manager = MagicMock()
    manager.summary.return_value = {}
    with patch("clawRVguarder.main.load_dotenv") as load_dotenv, patch(
        "clawRVguarder.main.build_manager", return_value=manager
    ):
        from clawRVguarder.main import main

        assert main(["run", "--project-dir", str(tmp_path), "--once", "--no-browser"]) == 0

    load_dotenv.assert_called_once_with(override=False)
