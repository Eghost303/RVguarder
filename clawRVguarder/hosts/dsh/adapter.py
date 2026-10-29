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

PROTOCOL_VERSION = "dsh-guard-v2"
SUPPORTED_SDK_VERSIONS = ("0.2.1-rc.2", "0.2.1-rc.3")
# 仅对已核对的内置工具做别名；未知 MCP/自定义工具保持 unknown。
TOOL_ALIASES = {"read": "read", "write": "write", "edit": "edit", "bash": "exec",
                "pwsh": "exec", "read_image": "read", "web_fetch": "web_fetch",
                "web_search": "web_search", "run_code": "code_execution", "rvguard_read": "read", "rvguard_copy": "write",
                "rvguard_transform": "write", "rvguard_send": "web_fetch",
                # 这两个工具的子操作由 policy/selectors.py 按参数解析，
                # 这里只保留原名，避免被前缀成 dsh-unmapped 而失去契约。
                "str_replace_editor": "str_replace_editor", "terminal_send": "terminal_send"}


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

    ALLOWED_CANONICAL = frozenset({"read", "write", "edit", "exec", "web_fetch", "web_search"})
    ALLOWED_CANONICAL_ARGS = frozenset({"path", "command", "url", "query", "content"})
    # 这些名字会被 trace 注入或被宿主拥有，不能由映射声明为来源。
    RESERVED_SOURCES = frozenset({"cwd", "workingDirectory", "working_directory",
                                  "action_type", "command_safety", "argv"})

    def __init__(self, instance_id: str, binding: str, workspace: Path, token_path: Path,
                 mappings: dict | None = None, mapping_schema: int = 1) -> None:
        self.instance_id, self.binding = instance_id, binding
        self.workspace, self.token_path = workspace, token_path
        self.mappings = mappings or {}
        self.mapping_schema = mapping_schema
        if not isinstance(self.mappings, dict):
            raise ValueError("tool_mappings_must_be_object")
        if mapping_schema not in {1, 2}:
            raise ValueError("unsupported_tool_mapping_schema")
        for tool, entry in self.mappings.items():
            self._validate_mapping_entry(tool, entry)
        self.tool_aliases = {**TOOL_ALIASES, **{name: entry["canonical"] for name, entry in self.mappings.items()}}

    def _validate_mapping_entry(self, tool: Any, entry: Any) -> None:
        """v1/v2 映射条目校验；失败即启动拒绝，不做静默降级。"""
        if (not isinstance(tool, str) or not tool or len(tool) > 256
                or tool in TOOL_ALIASES or tool.startswith("rvguard_")
                or not isinstance(entry, dict)):
            raise ValueError("invalid_or_overridden_tool_mapping")
        canonical = entry.get("canonical")
        if not isinstance(canonical, str) or canonical not in self.ALLOWED_CANONICAL:
            raise ValueError("unsupported_tool_mapping")
        if self.mapping_schema == 1:
            if set(entry) != {"canonical", "arguments"}:
                raise ValueError("unsupported_tool_mapping")
            self._validate_arguments(entry.get("arguments"), v2=False)
            return
        if not {"canonical", "arguments"} <= set(entry) <= {"canonical", "arguments", "server_id", "schema_sha256"}:
            raise ValueError("unsupported_tool_mapping")
        for key in ("server_id", "schema_sha256"):
            value = entry.get(key)
            if value is not None and (not isinstance(value, str) or not value or len(value) > 256):
                raise ValueError("invalid_tool_mapping_identity")
        self._validate_arguments(entry.get("arguments"), v2=True)

    def _validate_arguments(self, arguments: Any, *, v2: bool) -> None:
        if not isinstance(arguments, dict):
            raise ValueError("invalid_tool_argument_mapping")
        seen: set[str] = set()
        for canonical, spec in arguments.items():
            if canonical not in self.ALLOWED_CANONICAL_ARGS:
                raise ValueError("invalid_tool_argument_mapping")
            if v2:
                if (not isinstance(spec, dict) or set(spec) - {"source", "role", "required", "type"}):
                    raise ValueError("invalid_tool_argument_mapping")
                source = spec.get("source")
                role = spec.get("role", "target")
                if role not in {"target", "destination", "source", "context", "unknown"}:
                    raise ValueError("invalid_tool_argument_role")
                if not isinstance(spec.get("required", False), bool):
                    raise ValueError("invalid_tool_argument_mapping")
                if spec.get("type", "string") not in {"string", "string_list"}:
                    raise ValueError("invalid_tool_argument_type")
            else:
                source = spec
            if (not isinstance(source, str) or not source.strip() or len(source) > 256
                    or source in self.RESERVED_SOURCES or source in seen):
                raise ValueError("invalid_tool_argument_mapping")
            seen.add(source)

    def runtime_hook(self, context: AppContext) -> dict[str, Any]:
        """返回桥接状态，不生成 OpenClaw 插件或修改宿主配置。"""
        return {"installed": False, "active": False, "state": "runtime_unreachable", "host": "dsh",
                "auth_token_path": str(self.token_path), "instance_id": self.instance_id}

    def baseline_service(self, context: AppContext, latest_path: Path) -> BaselineService:
        """使用 DSH 专用扫描器与共享报告缓存。"""
        from .baseline import DshBaselineScanner
        return BaselineService(context, latest_path, scanner_factory=lambda ctx: DshBaselineScanner(ctx, probe_provider=getattr(self, "probe_provider", None)))

    def _apply_mapping(self, name: str, args: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[str]]:
        """按映射投影参数；返回 (params, 缺失的声明来源, 未建模的入参)。"""
        entry = self.mappings[name]["arguments"]
        if self.mapping_schema == 1:
            pairs = [(canonical, source) for canonical, source in entry.items()]
        else:
            pairs = [(canonical, spec["source"]) for canonical, spec in entry.items()]
        params: dict[str, Any] = {}
        missing: list[str] = []
        declared: set[str] = set()
        for canonical, source in pairs:
            declared.add(source)
            if source in args:
                params[canonical] = args[source]
            else:
                missing.append(canonical)
        # 未声明的入参不能静默消失：它们会作为覆盖缺口进入 trace。
        unmodeled = sorted(key for key in args if key not in declared)
        return params, missing, unmodeled

    def payload(self, request: dict[str, Any]) -> dict[str, Any]:
        """认证后构造内部 Hook 合约；身份、绑定及实例字段均由服务端赋值。"""
        args = dict(request["arguments"])
        name = request["tool_name"]
        unmodeled: list[str] = []
        missing_sources: list[str] = []
        if name in self.mappings:
            # 仅宿主私有配置可以声明具体 MCP/自定义工具的有限能力。
            args, missing_sources, unmodeled = self._apply_mapping(name, args)
            if isinstance(args.get("path"), str):
                args["path"] = local_path(args["path"])
        elif name in {"read", "write", "edit", "read_image"} and isinstance(args.get("file_path"), str):
            args["path"] = local_path(args["file_path"])
            del args["file_path"]
        elif name.startswith("rvguard_"):
            if name in {"rvguard_copy", "rvguard_transform"}:
                args["path"] = local_path(str(args.get("destination") or ""))
            else:
                args["path"] = local_path(str(args.get("file_path") or ""))
        if name == "run_code":
            args["command"] = str(args.get("code") or "")
        # cwd 只从宿主执行上下文取值，不接受工具参数覆盖。
        args["cwd"] = local_path(request["cwd"])
        namespace = sha256_text(json.dumps([self.instance_id, request["session_id"]]))[:24]
        return {"toolName": self.tool_aliases.get(name, "dsh-unmapped:" + name), "params": args,
                "runId": namespace, "toolCallId": request["call_id"],
                "agentId": request["agent_id"], "sessionId": namespace, "sessionKey": namespace,
                "_hook_auth_verified": True, "_hook_auth_binding": self.binding,
                "mcpUnmodeled": unmodeled, "mcpMissingSources": missing_sources,
                "_dsh": {"instance_id": self.instance_id, "session_id": request["session_id"],
                         "agent_id": request["agent_id"], "tool_name": name,
                         "root_call_id": request["root_call_id"], "cwd": request["cwd"],
                         "parent_call_id": request.get("parent_call_id"), "parent_agent_id": request.get("parent_agent_id")}}

    def build_event(self, payload: dict[str, Any], context: AppContext):
        """共享归一化后写入宿主签发的身份与作用域，不提升未知工具的权限。"""
        # 每次工具调用的工作区来自已认证宿主上下文；后台固定资源根不是会话 cwd。
        working_directory = Path(local_path(payload["_dsh"]["cwd"]))
        event = build_hook_event(payload, managed_project_root=working_directory)
        event.process_name = event.user = "dsh"
        event.source = "dsh-before-tool-call"
        event.metadata.update({"host": "dsh", "instance_id": self.instance_id,
                               "host_workspace": str(working_directory), "resource_workspace": str(self.workspace),
                               "dsh": payload["_dsh"]})
        event.metadata["tool_origin"] = "dsh_native" if payload["_dsh"]["tool_name"] in TOOL_ALIASES else "host_mapped" if payload["_dsh"]["tool_name"] in self.mappings else "unknown"
        raw_tool = payload["_dsh"]["tool_name"]
        unmodeled = payload.get("mcpUnmodeled") or []
        missing_sources = payload.get("mcpMissingSources") or []
        if unmodeled:
            event.metadata["mcp_unmodeled_arguments"] = list(unmodeled)
        if missing_sources:
            event.metadata["mcp_missing_sources"] = list(missing_sources)
        if raw_tool in {"pwsh", "powershell"}:
            event.metadata["shell_dialect"] = "pwsh"
        elif raw_tool in {"bash", "exec", "shell"}:
            event.metadata["shell_dialect"] = "bash"
        elif self.tool_aliases.get(raw_tool) == "exec":
            # 映射到 exec 的 MCP 执行器方言未知，不能当作已完整建模的 shell。
            event.metadata["shell_dialect"] = "mapped_unknown"
        dsh_ctx = payload["_dsh"]
        parent_agent = dsh_ctx.get("parent_agent_id")
        agent_identity = (f"dsh-agent:{dsh_ctx['agent_id']}" if parent_agent
                          else f"dsh-instance:{self.instance_id}")
        # 有序委派链：父在前、自己在后；单跳记录会把链路说短。
        lineage = ([f"dsh-agent:{parent_agent}", agent_identity] if parent_agent
                   else [f"dsh-instance:{self.instance_id}"])
        delegation = {
            "state": "declared" if dsh_ctx.get("parent_call_id") else "unrecorded",
            "parent_call_id": dsh_ctx.get("parent_call_id"),
            "parent_agent_id": parent_agent,
            # 宿主没有提供可验证的委派范围时保持未知，不据此授予任何权限。
            "scope": None,
        }
        event.metadata["trusted_identity"] = {
            "principal_id": f"dsh:{self.binding}", "principal_type": "agent",
            # DSH agent.id 是 session ID；同一个受控 profile 的主体能力跨会话聚合。
            "agent_id": agent_identity,
            "capability_lineage": lineage,
            "delegation": delegation,
            "trust": "verified", "binding": "dsh_instance_token"}
        return event

    def source_message(self, event) -> str:
        """生成宿主准确的语义输入。"""
        return f"DSH 请求调用工具 {event.metadata['dsh']['tool_name']}，目标：{', '.join(event.target_paths or event.network_targets) or '未指定'}"
