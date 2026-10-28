"""平台能力探测：受限环境无法执行的用例显式跳过，而不是伪装成通过。"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


def symlinks_supported() -> bool:
    """探测当前进程能否创建符号链接（Windows 需开发者模式或特权）。"""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        try:
            (root / "target").write_text("x", encoding="utf-8")
            (root / "link").symlink_to(root / "target")
        except (OSError, NotImplementedError):
            return False
    return True


requires_symlinks = pytest.mark.skipif(
    not symlinks_supported(),
    reason="平台不允许创建符号链接（Windows 需要开发者模式或 SeCreateSymbolicLinkPrivilege）",
)
