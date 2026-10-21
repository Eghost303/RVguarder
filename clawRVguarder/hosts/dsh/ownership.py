"""DSH 实例目录的进程独占锁；不删除其他进程的数据。"""
from __future__ import annotations

import os
from pathlib import Path


class DirectoryLease:
    """通过内核文件锁防止多个后端同时修改同一实例。"""

    def __init__(self, directory: Path) -> None:
        path = directory / "dsh-owner.lock"
        if path.is_symlink():
            raise ValueError("owner_lock_must_not_be_symlink")
        self.stream = path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                self.stream.seek(0)
                self.stream.write(b"0")
                self.stream.flush()
                self.stream.seek(0)
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.stream.close()
            raise ValueError("dsh_data_directory_already_owned") from exc

    def close(self) -> None:
        """关闭句柄以释放内核锁，进程崩溃也由内核释放。"""
        self.stream.close()

    def __del__(self) -> None:
        stream = getattr(self, "stream", None)
        if stream is not None:
            stream.close()
