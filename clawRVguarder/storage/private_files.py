"""宿主私有文件的跨平台权限入口；Windows 使用真实 ACL，POSIX 保留严格权限检查。"""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import stat
from typing import Iterator


def ensure_private_directory(path: Path) -> None:
    """创建并核验当前用户独占的目录，拒绝链接。"""
    if os.name == "nt":
        from .windows_files import ensure_private_directory as ensure
        ensure(path)
        return
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError("private directory must not contain symlinks")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError("private directory must be host-owned and private")


@contextmanager
def private_file(path: Path, flags: int) -> Iterator[int]:
    """固定父目录并打开私有普通文件，拒绝链接、多硬链接和权限变更。"""
    ensure_private_directory(path.parent)
    if os.name == "nt":
        from .windows_files import open_handle, open_directory_chain
        with open_directory_chain(path.parent, private=True):
            with open_handle(path, flags=flags, private=True) as fd:
                yield fd
        return
    fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077 or info.st_nlink != 1:
            raise ValueError("file must be a host-private regular file")
        yield fd
    finally:
        os.close(fd)
