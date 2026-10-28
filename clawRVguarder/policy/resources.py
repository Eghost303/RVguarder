"""规范资源类型词表。

规则 trace 用 ``file``/``directory``/``table``/``document`` 描述意图，
``TraceCompiler`` 只能观测到 ``path``/``command``/``url``/``recipient``/
``control_plane``。最小权限差分若按字面比较，合法请求会被判成超范围。

这里提供单向别名归一：只把"意图词"映射到编译器的可观测词，不反向扩张，
因此不会把真实的范围扩大掩盖掉。
"""
from __future__ import annotations

CANONICAL_RESOURCE_TYPES = frozenset({
    "path",
    "command",
    "url",
    "recipient",
    "control_plane",
    "unknown",
})

# 意图词 -> 可观测词。细分类型在规则匹配阶段仍然有效，这里只服务于差分比较。
RESOURCE_TYPE_ALIASES: dict[str, str] = {
    "file": "path",
    "directory": "path",
    "table": "path",
    "document": "path",
    "config": "control_plane",
    "event": "recipient",
    "meeting": "recipient",
    "calendar": "recipient",
}


def canonical_resource_type(value: str | None) -> str:
    """把规则意图词归一为编译器可观测词；未知值原样返回。"""
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return RESOURCE_TYPE_ALIASES.get(text, text)
