"""测试进程的环境隔离护栏。

``clawRVguarder.main.main()`` 会执行 ``load_dotenv(override=False)``，把本地
``.env`` 中的配置写入 ``os.environ``。任何在测试中真实调用该入口的用例都会污染
同进程的后续测试。这里在每个测试结束后还原环境变量，保证测试保持封闭、可重复。
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _restore_process_environment():
    snapshot = dict(os.environ)
    try:
        yield
    finally:
        for key in list(os.environ):
            if key not in snapshot:
                del os.environ[key]
        for key, value in snapshot.items():
            if os.environ.get(key) != value:
                os.environ[key] = value


@pytest.fixture(autouse=True)
def _short_circuit_gateway_probe(monkeypatch):
    """跳过真实回环端口探测，避免每个用例白等套接字超时。

    ``build_services`` 会调用 ``discover_openclaw``，后者对 ``COMMON_PORTS``
    在 ``127.0.0.1`` 与 ``localhost`` 上逐个同步探测。没有服务监听时每次探测
    都要等满超时，使每个构造服务的用例固定多花约 9 秒。需要真实探测行为的
    用例应自行重新 patch ``_port_probe``。
    """
    from clawRVguarder.integrations import discovery

    monkeypatch.setattr(discovery, "_port_probe", lambda host, port: "unreachable")
