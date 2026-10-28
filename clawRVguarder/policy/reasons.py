"""审批与阻断的稳定原因码。

原因码描述"决策为什么落到这个结果"，与规则 ID 解耦：规则增删改版本时，
归因口径保持不变。一个调用可能同时命中多个条件，此时按 ``PRECEDENCE``
取唯一的支配原因码，保证同一调用可重复归因、统计不重叠。
"""
from __future__ import annotations

from typing import Iterable

# 审批类：为什么需要人来看。
POLICY_REQUIRES_APPROVAL = "policy_requires_approval"
"""规则本身要求审批（证据充分、覆盖完整）。"""

UNKNOWN_TOOL = "unknown_tool"
"""工具或操作没有映射到 canonical operation，无法评估效果。"""

MISSING_EVIDENCE = "missing_evidence"
"""覆盖不完整、事实冲突或证据可信度不足，无法给出确定结论。"""

SCOPE_UNKNOWN = "scope_unknown"
"""作用域无法判定（工作区内外、目的地边界等）。"""

PERMISSION_EXCESS = "permission_excess"
"""请求权限超出该操作的最小权限闭包。"""

GRANT_INVALID = "grant_invalid"
"""已有授权不适用于本次调用（主体/资源/目的地/时效不匹配）。"""

RV_ESCALATION = "rv_escalation"
"""跨步 RV 判定提高了风险等级。"""

HOST_APPROVAL = "host_approval"
"""由宿主原生审批机制发起的审批（非 Guard 规则触发）。"""

BACKEND_FAILURE = "backend_failure"
"""决策服务不可达或返回不可解析结果。"""

HARD_BLOCK = "hard_block"
"""明确的高风险禁止行为，直接阻断。"""

COMBO_RISK = "combo_risk"
"""跨操作组合关系命中（如持久化+外发），单步看均合法。"""

UNATTRIBUTED = "unattributed"
"""审批/阻断没有可归因的原因码。

这是**哨兵值而不是有效原因**：它不在 ``ALL_REASON_CODES`` 中，阶段一的验收
把它计为"未知原因"。出现它意味着某条分支漏了归因，必须补码，不能靠默认值
把统计凑成零。
"""

ALL_REASON_CODES = frozenset({
    POLICY_REQUIRES_APPROVAL, UNKNOWN_TOOL, MISSING_EVIDENCE, SCOPE_UNKNOWN,
    PERMISSION_EXCESS, GRANT_INVALID, RV_ESCALATION, HOST_APPROVAL,
    BACKEND_FAILURE, HARD_BLOCK, COMBO_RISK,
})

# 越靠前越具体、越可操作；多个条件同时成立时取最先出现的码。
# HARD_BLOCK 排在最前：一旦动作是阻断，就不能因同时存在的权限差分或缺证
# 证据把它归因成"只是需要审批"。
PRECEDENCE: tuple[str, ...] = (
    HARD_BLOCK,
    BACKEND_FAILURE,
    UNKNOWN_TOOL,
    SCOPE_UNKNOWN,
    PERMISSION_EXCESS,
    GRANT_INVALID,
    COMBO_RISK,
    MISSING_EVIDENCE,
    RV_ESCALATION,
    HOST_APPROVAL,
    POLICY_REQUIRES_APPROVAL,
)

_RANK = {code: index for index, code in enumerate(PRECEDENCE)}


def dominant(codes: Iterable[str]) -> str | None:
    """在多个候选原因码中选出唯一的支配码；未知码忽略。"""
    known = [code for code in codes if code in _RANK]
    if not known:
        return None
    return min(known, key=lambda code: _RANK[code])
