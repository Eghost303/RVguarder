"""将公开Vite构建产物与单一源策略包加入wheel；不复制整个runtime目录。"""
from pathlib import Path
import runpy
import shutil

from setuptools import setup
from setuptools.command.build_py import build_py

stage_ui_assets = runpy.run_path(str(Path(__file__).parent / "clawRVguarder" / "ui_assets.py"))["stage_ui_assets"]


def stage_policy_packs(source: Path, destination: Path) -> None:
    """把仓库根 policies/permissions 复制进构建产物，避免维护重复副本。"""
    if not (source / "schema" / "permissions.schema.json").is_file():
        raise FileNotFoundError(f"Missing PMKB source bundle: {source}")
    if destination.exists():
        for stale in destination.rglob("*.json"):
            stale.unlink()
    shutil.copytree(source, destination, dirs_exist_ok=True)


class BuildWithAssets(build_py):
    """后端发布构建要求完整前端与策略包，避免安装后缺资源。"""

    def run(self):
        build_lib = Path(self.build_lib)
        # setuptools 会复用 build/lib；移除改名前的生成物，避免 wheel 混装两套包。
        legacy_package = build_lib / "openclaw_guard"
        if legacy_package.exists():
            shutil.rmtree(legacy_package)
        super().run()
        stage_ui_assets(Path(__file__).parent / "runtime" / "ui",
                        build_lib / "clawRVguarder" / "static_ui")
        stage_policy_packs(Path(__file__).parent / "policies" / "permissions",
                           build_lib / "clawRVguarder" / "policy" / "data" / "permissions")


setup(cmdclass={"build_py": BuildWithAssets})
