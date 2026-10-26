"""真实 Windows ACL、目录句柄和恢复边界；不使用 chmod 或伪造 Win32 返回值。"""
from __future__ import annotations

import os
import subprocess

import pytest

from clawRVguarder.storage.private_files import ensure_private_directory, private_file

pytestmark = pytest.mark.skipif(os.name != "nt", reason="requires actual Windows file security")


def test_private_file_permissions_are_rechecked(tmp_path):
    """给文件增加 Everyone 权限后立即拒绝访问，不能只检查父目录。"""
    directory = tmp_path / "private"
    ensure_private_directory(directory)
    target = directory / "key"
    with private_file(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL) as fd:
        os.write(fd, b"test-only")
    subprocess.run(["icacls.exe", str(target), "/grant", "*S-1-1-0:(R)"], check=True, capture_output=True)
    with pytest.raises(ValueError, match="another principal"):
        with private_file(target, os.O_RDONLY):
            pytest.fail("insecure key was opened")


def test_private_handle_pins_file_and_parent_directory(tmp_path):
    """访问期间不能用删除/重命名替换已固定的文件或父目录。"""
    directory = tmp_path / "private"
    ensure_private_directory(directory)
    target = directory / "database"
    with private_file(target, os.O_RDWR | os.O_CREAT):
        with pytest.raises(OSError):
            target.rename(directory / "replacement")
        with pytest.raises(OSError):
            directory.rename(tmp_path / "replacement")


def test_plain_directory_is_not_silently_treated_as_private(tmp_path):
    """已有宽权限目录不会被静默接受或改写 ACL。"""
    plain = tmp_path / "plain"
    plain.mkdir()
    subprocess.run(["icacls.exe", str(plain), "/grant", "*S-1-1-0:(RX)"], check=True, capture_output=True)
    with pytest.raises(ValueError, match="another principal"):
        ensure_private_directory(plain)
