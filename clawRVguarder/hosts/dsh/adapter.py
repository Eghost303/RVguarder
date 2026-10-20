"""DSH 可信桥接载荷到共享 ToolCallIR/PMKB 的明确映射，不解析模型自报身份。"""
from __future__ import annotations

import json
import os
from pathlib import Path, PureWindowsPath
from typing import Any

from clawRVguarder.config import AppContext
from clawRVguarder.core.baseline_service import BaselineService
from clawRVguarder.integrations.tool_hook_bridge import build_hook_event
from clawRVguarder.utils import sha256_text

PROTOCOL_VERSION = "dsh-guard-v1"
# 仅对已核对的内置工具做别名；未知 MCP/自定义工具保持 unknown。
TOOL_ALIASES = {"read": "read", "write": "write", "edit": "edit", "bash": "exec",
                "pwsh": "exec", "read_image": "read", "web_fetch": "web_fetch",
                "web_search": "web_search", "run_code": "code_execution"}


def local_path(value: str) -> str:
    """同机 WSL 后端将绝对 Windows 路径映射至挂载盘；Windows 后端保持原路径。"""
    path = PureWindowsPath(value)
    if path.drive.startswith("\\\\") or value.startswith("\\\\") or (path.drive and not path.is_absolute()) or (path.root and not path.drive and "\\" in value):
        raise ValueError("unsupported_unc_or_drive_relative_path")
    if os.name != "nt" and path.is_absolute() and len(path.drive) == 2 and path.drive[1] == ":":
        return str(Path("/mnt") / path.drive[0].lower() / Path(*path.parts[1:]))
    return value


class DshAdapter:
    """每个服务进程绑定一个可信 DSH 实例与工作区。"""

    def __init__(self, instance_id: str, binding: str, workspace: Path, token_path: Path) -> None:
        self.instance_id, self.binding = instance_id, binding
        self.workspace, self.token_path = workspace, token_path

    def runtime_hook(self, context: AppContext) -> dict[str, Any]:
        """返回桥接状态，不生成 OpenClaw 插件或修改宿主配置。"""
        return {"installed": False, "active": False, "state": "runtime_unreachable", "host": "dsh",
                "auth_token_path": str(self.token_path), "instance_id": self.instance_id}

    def baseline_service(self, context: AppContext, latest_path: Path) -> BaselineService:
        """使用 DSH 专用扫描器与共享报告缓存。"""
        from .baseline import DshBaselineScanner
        return BaselineService(context, latest_path, scanner_factory=DshBaselineScanner)

    def payload(self, request: dict[str, Any]) -> dict[str, Any]:
        """认证后构造内部 Hook 合约；身份、绑定及实例字段均由服务端赋值。"""
        args = dict(request["arguments"])
        name = request["tool_name"]
        if name in {"read", "write", "edit", "read_image"} and isinstance(args.get("file_path"), str):
            args["path"] = local_path(args["file_path"])
            del args["file_path"]
        if name == "run_code":
            args["command"] = str(args.get("code") or "")
        # cwd 只从宿主执行上下文取值，不接受工具参数覆盖。
        args["cwd"] = local_path(request["cwd"])
        namespace = sha256_text(json.dumps([self.instance_id, request["session_id"]]))[:24]
        return {"toolName": TOOL_ALIASES.get(name, "dsh-unmapped:" + name), "params": args,
                "runId": namespace, "toolCallId": request["call_id"],
                "agentId": request["agent_id"], "sessionId": namespace, "sessionKey": namespace,
                "_hook_auth_verified": True, "_hook_auth_binding": self.binding,
                "_dsh": {"instance_id": self.instance_id, "session_id": request["session_id"],
                         "agent_id": request["agent_id"], "tool_name": name,
                         "root_call_id": request["root_call_id"], "cwd": request["cwd"]}}

    def build_event(self, payload: dict[str, Any], context: AppContext):
        """共享归一化后写入宿主签发的身份与作用域，不提升未知工具的权限。"""
        event = build_hook_event(payload, managed_project_root=self.workspace)
        event.process_name = event.user = "dsh"
        event.source = "dsh-before-tool-call"
        event.metadata.update({"host": "dsh", "instance_id": self.instance_id,
                               "host_workspace": str(self.workspace), "dsh": payload["_dsh"]})
        event.metadata["tool_origin"] = "dsh_native" if payload["_dsh"]["tool_name"] in TOOL_ALIASES else "unknown"
        event.metadata["trusted_identity"] = {
            "principal_id": f"dsh:{self.binding}", "principal_type": "agent",
            # DSH agent.id 是 session ID；同一个受控 profile 的主体能力跨会话聚合。
            "agent_id": f"dsh-instance:{self.instance_id}",
            "capability_lineage": [f"dsh-instance:{self.instance_id}"],
            "trust": "verified", "binding": "dsh_instance_token"}
        return event

    def source_message(self, event) -> str:
        """生成宿主准确的语义输入。"""
        return f"DSH 请求调用工具 {event.metadata['dsh']['tool_name']}，目标：{', '.join(event.target_paths or event.network_targets) or '未指定'}"
