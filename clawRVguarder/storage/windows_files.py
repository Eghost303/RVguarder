"""Windows 文件句柄和私有 ACL；不使用 chmod 模拟 POSIX 权限。

目录句柄禁止删除共享，逐段拒绝重解析点；私有文件只允许当前用户和
SYSTEM。此边界不隔离使用同一完整用户令牌的其他进程。
"""
from __future__ import annotations

from contextlib import contextmanager, ExitStack
import ctypes
from ctypes import wintypes as w
from functools import lru_cache
import os
from pathlib import Path
from typing import Iterator


@lru_cache(maxsize=1)
def _api():
    """延迟装载 Win32 API，使 POSIX 导入保持可用。"""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    pointer = ctypes.c_void_p
    kernel.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, pointer, w.DWORD, w.DWORD, w.HANDLE]
    kernel.CreateFileW.restype = w.HANDLE
    kernel.CreateDirectoryW.argtypes = [w.LPCWSTR, pointer]
    kernel.CreateDirectoryW.restype = w.BOOL
    kernel.CloseHandle.argtypes = [w.HANDLE]
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.LocalFree.argtypes = [pointer]
    kernel.LocalFree.restype = pointer
    adv.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)]
    adv.GetTokenInformation.argtypes = [w.HANDLE, ctypes.c_int, pointer, w.DWORD, ctypes.POINTER(w.DWORD)]
    adv.ConvertSidToStringSidW.argtypes = [pointer, ctypes.POINTER(w.LPWSTR)]
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, ctypes.POINTER(pointer), pointer]
    adv.GetSecurityInfo.argtypes = [w.HANDLE, ctypes.c_int, w.DWORD, ctypes.POINTER(pointer), pointer, ctypes.POINTER(pointer), pointer, ctypes.POINTER(pointer)]
    adv.GetSecurityInfo.restype = w.DWORD
    adv.GetAce.argtypes = [pointer, w.DWORD, ctypes.POINTER(pointer)]
    return kernel, adv


def _sid_text(sid) -> str:
    kernel, adv = _api()
    result = w.LPWSTR()
    if not adv.ConvertSidToStringSidW(sid, ctypes.byref(result)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return result.value
    finally:
        kernel.LocalFree(ctypes.cast(result, ctypes.c_void_p))


def current_user_sid() -> str:
    """取得当前进程实际用户 SID，不依赖用户名或本地化命令输出。"""
    kernel, adv = _api()
    token = w.HANDLE()
    if not adv.OpenProcessToken(kernel.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        size = w.DWORD()
        adv.GetTokenInformation(token, 1, None, 0, ctypes.byref(size))
        data = ctypes.create_string_buffer(size.value)
        if not adv.GetTokenInformation(token, 1, data, size, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        return _sid_text(ctypes.c_void_p.from_buffer(data).value)
    finally:
        kernel.CloseHandle(token)


@contextmanager
def _private_attributes() -> Iterator[object]:
    kernel, adv = _api()

    class Attributes(ctypes.Structure):
        """把受保护的安全描述符传给 Windows 创建 API。"""
        _fields_ = [("length", w.DWORD), ("descriptor", ctypes.c_void_p), ("inherit", w.BOOL)]

    sid = current_user_sid()
    descriptor = ctypes.c_void_p()
    sddl = f"O:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)"
    if not adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None):
        raise ctypes.WinError(ctypes.get_last_error())
    attributes = Attributes(ctypes.sizeof(Attributes), descriptor, False)
    try:
        yield ctypes.byref(attributes)
    finally:
        kernel.LocalFree(descriptor)


def _validate_acl(handle) -> None:
    kernel, adv = _api()
    owner, acl, descriptor = (ctypes.c_void_p() for _ in range(3))
    error = adv.GetSecurityInfo(handle, 1, 0x00000005, ctypes.byref(owner), None,
                                ctypes.byref(acl), None, ctypes.byref(descriptor))
    if error:
        raise ctypes.WinError(error)
    try:
        sid = current_user_sid()
        if not owner.value or _sid_text(owner) != sid or not acl.value:
            raise ValueError("private Windows object must be owned by the current user with a non-null DACL")
        count = ctypes.c_ushort.from_address(acl.value + 4).value
        granted = False
        for index in range(count):
            ace = ctypes.c_void_p()
            if not adv.GetAce(acl, index, ctypes.byref(ace)):
                raise ctypes.WinError(ctypes.get_last_error())
            kind = ctypes.c_ubyte.from_address(ace.value).value
            if kind == 1:  # deny ACE 不增加任何访问权限。
                continue
            if kind != 0:
                raise ValueError("unsupported ACE in private Windows DACL")
            mask = ctypes.c_ulong.from_address(ace.value + 4).value
            trustee = _sid_text(ace.value + 8)
            if mask and trustee not in {sid, "S-1-5-18"}:
                raise ValueError("private Windows DACL grants access to another principal")
            granted |= trustee == sid and bool(mask)
        if not granted:
            raise ValueError("private Windows DACL does not grant the owner access")
    finally:
        kernel.LocalFree(descriptor)


def reject_reparse_ancestors(path: Path) -> None:
    """拒绝符号链接、junction 和其他重解析目录，不解析后再信任原路径。"""
    for part in reversed((path, *path.parents)):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Windows reparse points are not allowed")


@contextmanager
def open_handle(path: Path, *, directory: bool = False, flags: int = os.O_RDONLY,
                private: bool = False) -> Iterator[int]:
    """用不跟随重解析点且禁止删除共享的句柄打开资源；调用方负责固定父目录。"""
    import msvcrt

    kernel, _ = _api()
    access = 0x00020000 | (0x80 if directory else 0x80000000)
    if flags & (os.O_WRONLY | os.O_RDWR):
        access |= 0x40000000
    creation = 1 if flags & os.O_EXCL else 4 if flags & os.O_CREAT else 3
    options = 0x00200000 | (0x02000000 if directory else 0)
    with _private_attributes() if private and flags & os.O_CREAT else _no_attributes() as attributes:
        handle = kernel.CreateFileW(str(path), access, 3, attributes, creation, options, None)
    if handle == ctypes.c_void_p(-1).value:
        error = ctypes.get_last_error()
        if error in {80, 183}:
            raise FileExistsError(error, "Windows file already exists", str(path))
        raise ctypes.WinError(error)
    fd = None
    try:
        # GetFileInformationByHandle 的属性首字段包含 FILE_ATTRIBUTE_REPARSE_POINT。
        information = ctypes.create_string_buffer(52)
        kernel.GetFileInformationByHandle.argtypes = [w.HANDLE, ctypes.c_void_p]
        if not kernel.GetFileInformationByHandle(handle, information):
            raise ctypes.WinError(ctypes.get_last_error())
        attributes = w.DWORD.from_buffer(information).value
        if attributes & 0x400 or bool(attributes & 0x10) != directory:
            raise ValueError("Windows object type or reparse point is not permitted")
        if not directory and w.DWORD.from_buffer(information, 40).value != 1:
            raise ValueError("Windows hard-linked files are not permitted")
        if private:
            _validate_acl(handle)
        fd = msvcrt.open_osfhandle(handle, (flags & (os.O_RDONLY | os.O_WRONLY | os.O_RDWR)) | os.O_BINARY)
        yield fd
    finally:
        if fd is None:
            kernel.CloseHandle(handle)
        else:
            os.close(fd)


@contextmanager
def _no_attributes():
    yield None


@contextmanager
def open_directory_chain(path: Path, *, private: bool = False) -> Iterator[int]:
    """逐段固定绝对目录及其祖先，拒绝 junction，防止观察期间替换父路径。"""
    with ExitStack() as stack:
        for part in reversed((path, *path.parents)):
            fd = stack.enter_context(open_handle(part, directory=True, private=private and part == path))
        yield fd


def ensure_private_directory(path: Path) -> None:
    """原子创建带受保护 DACL 的目录；已有目录仅核验，不自动放宽或修复。"""
    reject_reparse_ancestors(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        kernel, _ = _api()
        with _private_attributes() as attributes:
            if not kernel.CreateDirectoryW(str(path), attributes) and ctypes.get_last_error() != 183:
                raise ctypes.WinError(ctypes.get_last_error())
    with open_handle(path, directory=True, private=True):
        pass
