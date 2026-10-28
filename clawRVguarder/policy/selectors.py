"""声明式操作族选择：子操作由参数决定，未登记即 unknown。

工具名只说明"调用的是哪个工具"，不说明"这次调用做了什么"。
``str_replace_editor`` 的 ``view`` 与 ``create`` 是完全不同的效果；
``terminal_send`` 会把文本写进终端并可能提交执行。
两者都必须由参数解析，且未登记的子操作不能被工具默认族兜底。
"""
from __future__ import annotations

from typing import Any, Mapping

SUBACTION_GAP = "subaction_unmapped"

# 工具 -> (子操作参数, {取值: 规范操作族})
COMMAND_SELECTORS: dict[str, tuple[str, dict[str, str]]] = {
    "str_replace_editor": ("command", {
        "view": "file.read",
        "create": "file.write",
        "str_replace": "file.write",
        "insert": "file.write",
    }),
}

# 工具 -> 固定操作族（该工具只可能产生一种可观测效果）
FIXED_FAMILIES: dict[str, str] = {
    # 写入终端文本并可提交执行；保守按执行建模。
    "terminal_send": "process.execute",
}


def is_selector_tool(tool_id: str) -> bool:
    """该工具是否由选择器解析（而不是按名字查表）。"""
    return tool_id in COMMAND_SELECTORS or tool_id in FIXED_FAMILIES


def select_family(tool_id: str, params: Mapping[str, Any] | None) -> str | None:
    """返回解析出的操作族；无法解析时返回 None，调用方必须落回 unknown。"""
    fixed = FIXED_FAMILIES.get(tool_id)
    if fixed:
        return fixed
    spec = COMMAND_SELECTORS.get(tool_id)
    if not spec:
        return None
    key, mapping = spec
    value = (params or {}).get(key)
    if not isinstance(value, str):
        return None
    return mapping.get(value)
