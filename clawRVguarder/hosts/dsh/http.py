"""DSH v1 本地桥接协议及 Dashboard 会话认证。"""
from __future__ import annotations

import hmac
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, ConfigDict, Field

from .adapter import PROTOCOL_VERSION
from .services import BridgeConflict, DshServices


class Call(BaseModel):
    """宿主插件签发的执行上下文；不接受客户端绕过认证字段。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    protocol: Literal["dsh-guard-v2"]
    instance_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=512)
    agent_id: str = Field(min_length=1, max_length=512)
    call_id: str = Field(min_length=1, max_length=512)
    parent_call_id: str | None = Field(default=None, max_length=512)
    parent_agent_id: str | None = Field(default=None, max_length=512)
    root_call_id: str = Field(min_length=1, max_length=512)
    tool_name: str = Field(min_length=1, max_length=256)
    cwd: str = Field(min_length=1, max_length=4096)
    arguments: dict[str, Any]
    proposal: dict[str, Any] | None = None
    host_semantic_request_id: str | None = Field(default=None, min_length=16, max_length=128)


class HostSemanticSubmission(BaseModel):
    """Transient, call-bound model output; the response is never journaled."""
    model_config = ConfigDict(extra="forbid", strict=True)
    request_id: str = Field(min_length=16, max_length=128)
    call: Call
    # Enforce the byte limit in the service layer so validation errors never
    # reflect a potentially sensitive model response in their detail text.
    response: str = Field(min_length=1)


class Completion(BaseModel):
    """最终工具结果不上传内容正文；只提交不可变成功/dispatch 状态。"""
    model_config = ConfigDict(extra="forbid", strict=True)
    call: Call
    succeeded: bool
    dispatched: bool
    evidence: dict[str, Any] | None = None


def configure_app(app, manager: DshServices) -> None:
    """只在 DSH 服务启用本地 token 与浏览器同源会话，不改变 OpenClaw API。"""
    router = APIRouter(prefix="/api/dsh", tags=["dsh"])
    cookie_name = "rvguarder_dsh_session"

    def valid(value: str) -> bool:
        return hmac.compare_digest(value.encode("utf-8"), manager.bridge_token.encode("utf-8"))

    @app.middleware("http")
    async def authentication(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        if path.startswith("/api/hook/"):
            return JSONResponse({"error": "openclaw_routes_disabled_for_dsh"}, status_code=404)
        # Host header 必须是本机：阻止 DNS rebinding；端口由实际请求解析。
        if request.url.hostname not in {"127.0.0.1", "localhost", "::1", "testserver"}:
            return JSONResponse({"error": "invalid_local_host"}, status_code=403)
        header = request.headers.get("x-rvguarder-token", "")
        plugin = valid(header)
        bridge_only = path in {"/api/dsh/hello", "/api/dsh/before", "/api/dsh/dispatch", "/api/dsh/result", "/api/dsh/session", "/api/dsh/degraded", "/api/dsh/probe", "/api/dsh/semantic/prepare", "/api/dsh/semantic/submit"}
        browser = valid(request.cookies.get(cookie_name, ""))
        if bridge_only and not plugin or not bridge_only and not (plugin or browser):
            return JSONResponse({"error": "dsh_unauthorized"}, status_code=401)
        if not plugin and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin", "")
            if not origin or urlsplit(origin).netloc != request.url.netloc or urlsplit(origin).scheme != request.url.scheme:
                return JSONResponse({"error": "same_origin_required"}, status_code=403)
        allowed_mutations = {"/api/dsh/hello", "/api/dsh/session", "/api/dsh/before", "/api/dsh/dispatch", "/api/dsh/result", "/api/dsh/degraded", "/api/dsh/probe", "/api/dsh/semantic", "/api/dsh/semantic/prepare", "/api/dsh/semantic/submit", "/api/baseline/run", "/api/audit/export", "/api/rv/toggle"}
        if request.method not in {"GET", "HEAD", "OPTIONS"} and path not in allowed_mutations:
            return JSONResponse({"error": "dsh_decisions_owned_by_native_host"}, status_code=403)
        if request.method in {"POST", "PUT", "PATCH"}:
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    return JSONResponse({"error": "payload_too_large"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        return await call_next(request)

    def checked(call: Call) -> dict[str, Any]:
        if call.instance_id != manager.instance_id:
            raise HTTPException(409, "instance_mismatch")
        return call.model_dump(exclude_none=True)

    def operation(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except BridgeConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post("/session")
    def session():
        response = JSONResponse({"ok": True, "host": "dsh"})
        response.set_cookie(cookie_name, manager.bridge_token, httponly=True, samesite="strict", max_age=3600)
        response.headers["Cache-Control"] = "no-store"
        return response

    @router.post("/hello")
    def hello(payload: dict):
        if payload.get("protocol") != PROTOCOL_VERSION or payload.get("instance_id") != manager.instance_id:
            raise HTTPException(409, "protocol_or_instance_mismatch")
        return operation(manager.touch, str(payload.get("sdk_version") or ""))

    @router.post("/before")
    def before(call: Call):
        return operation(manager.bridge_before, checked(call))

    @router.post("/semantic/prepare")
    def semantic_prepare(call: Call):
        return operation(manager.prepare_host_semantic, checked(call))

    @router.post("/semantic/submit")
    def semantic_submit(payload: HostSemanticSubmission):
        return operation(
            manager.submit_host_semantic,
            payload.request_id,
            checked(payload.call),
            payload.response,
        )

    @router.post("/dispatch")
    def dispatch(call: Call):
        return operation(manager.bridge_dispatch, checked(call))

    @router.post("/result")
    def result(completion: Completion):
        return operation(manager.bridge_result, checked(completion.call), succeeded=completion.succeeded, dispatched=completion.dispatched, evidence=completion.evidence)

    @router.post("/degraded")
    def degraded(payload: dict):
        return operation(manager.record_degraded, payload)

    @router.post("/probe")
    def probe(payload: dict):
        return operation(manager.record_probe, payload)

    @router.get("/capabilities")
    def capabilities():
        return manager.capabilities()

    @router.post("/semantic")
    def semantic(payload: dict):
        mode = payload.get("mode")
        if mode not in {"local", "auto", "llm", "host-agent"}:
            raise HTTPException(422, "invalid_semantic_mode")
        from .semantic import DshSemanticEnhancer
        with manager.bridge_lock:
            if mode == "host-agent" and not manager.host_agent_capability()["available"]:
                raise HTTPException(409, "host_agent_unavailable")
            enhancer = DshSemanticEnhancer(policy_version=manager.policy_engine.bundle.version,
                api_key="" if mode in {"local", "host-agent"} else None,
                config_path=manager.context.paths.runtime_dir / "guard-config.json")
            if mode == "llm" and not enhancer._llm_enabled:
                raise HTTPException(409, "llm_mode_requires_host_api_key")
            manager.semantic_enhancer = enhancer
            manager.semantic_mode = mode
            import json
            temp = manager.semantic_settings_path.with_suffix(".tmp")
            temp.write_text(json.dumps({"semantic_mode": mode}))
            temp.replace(manager.semantic_settings_path)
            manager.action_service.semantic_enhancer = enhancer
            manager.audit_store.append("dsh_semantic_mode", {"mode": mode})
            return manager.summary(compact=True)["semantic"]

    @router.get("/audit")
    def audit():
        return {"items": manager.audit_store.query(limit=20), "chain": manager.audit_store.verify_chain()}

    @router.get("/policy")
    def policy():
        bundle = manager.policy_engine.bundle
        return {"version": bundle.version, "rules": [rule.model_dump() for rule in bundle.rules],
                "operations": len(bundle.operations), "vectors": len(bundle.vectors)}

    @router.get("/reports/{format}")
    def report(format: Literal["json", "html", "pdf"]):
        path = manager.context.paths.report_dir / f"compliance-report.{format}"
        if not path.is_file():
            raise HTTPException(404, "report_not_generated")
        return FileResponse(path, filename=path.name, media_type={"json": "application/json", "html": "text/html", "pdf": "application/pdf"}[format])

    @router.get("/status")
    def status():
        return {"protocol": PROTOCOL_VERSION, "host": "dsh", "instance_id": manager.instance_id,
                "hook": manager.hook_status(), "semantic": manager.summary(compact=True)["semantic"]}

    app.include_router(router)
