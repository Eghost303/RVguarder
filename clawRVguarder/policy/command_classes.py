"""测试/构建命令的确定性识别。

复用必须绑定**命令类别**，不能因为"上次批准过一条命令"就放行任意执行。
这里只识别已知运行器的固定子命令，并且拒绝任何包含 shell 组合符、重定向、
管道或命令替换的命令——那些命令的效果无法用类别表达。
"""
from __future__ import annotations

import re
import shlex

# 出现这些字符就说明命令可能改变控制流或拼接其它命令，无法按类别复用。
_SHELL_META = re.compile(r"[;&|<>$`\n\r]")

_SIMPLE = {"pytest": "pytest", "tox": "tox", "nox": "nox"}
_MODULE = {
    ("python", "-m", "pytest"): "pytest",
    ("python3", "-m", "pytest"): "pytest",
    ("python", "-m", "unittest"): "unittest",
    ("python3", "-m", "unittest"): "unittest",
}
_PACKAGE_MANAGERS = {"npm", "pnpm", "yarn"}
_PACKAGE_TEST_VERBS = {"test", "build"}
_SUBCOMMAND_TOOLS = {
    "cargo": {"test", "check", "build", "clippy"},
    "go": {"test", "build", "vet"},
    "dotnet": {"test", "build"},
    "mvn": {"test", "package", "verify"},
    "gradle": {"test", "build", "check"},
}


def classify_command(command: str | None) -> str | None:
    """返回可复用的命令类别；无法确定时返回 None（保持逐次审批）。"""
    raw = str(command or "").strip()
    if not raw or len(raw) > 4096 or _SHELL_META.search(raw):
        return None
    try:
        tokens = shlex.split(raw, posix=True)
    except ValueError:
        return None
    if not tokens:
        return None
    head = tokens[0]
    if head in _SIMPLE:
        return _SIMPLE[head]
    if head == "tsc":
        return "tsc"
    key = tuple(tokens[:3])
    if key in _MODULE:
        return _MODULE[key]
    if head in _PACKAGE_MANAGERS and len(tokens) >= 2:
        verb = tokens[1]
        if verb in _PACKAGE_TEST_VERBS:
            return f"{head}-{verb}"
        if verb == "run" and len(tokens) >= 3 and tokens[2] in _PACKAGE_TEST_VERBS:
            return f"{head}-run-{tokens[2]}"
        return None
    allowed = _SUBCOMMAND_TOOLS.get(head)
    if allowed and len(tokens) >= 2 and tokens[1] in allowed:
        return f"{head}-{tokens[1]}"
    return None
