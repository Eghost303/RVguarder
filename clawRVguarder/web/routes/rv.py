"""RV 运行时验证 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from clawRVguarder import api
from clawRVguarder.web.dependencies import body_payload, get_manager

router = APIRouter(tags=["rv"])


@router.get("/api/rv/status")
def rv_status(manager=Depends(get_manager)):
    payload, status = api.rv_status(manager)
    return JSONResponse(content=payload, status_code=int(status))


@router.post("/api/rv/toggle")
def rv_toggle(payload: dict = Depends(body_payload), manager=Depends(get_manager)):
    payload, status = api.rv_toggle(manager, payload)
    return JSONResponse(content=payload, status_code=int(status))
