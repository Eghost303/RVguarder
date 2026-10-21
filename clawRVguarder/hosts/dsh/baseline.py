"""DSH 配置和运行环境扫描；无法验证的检查保持 warn/unknown，不伪造通过。"""
from __future__ import annotations

import json
import os
import stat
import time
from pathlib import Path
from typing import Any

import yaml

from clawRVguarder.baseline import BaselineScanner, _finding_from_check
from clawRVguarder.models import AssetRecord, BaselineCheck, ComplianceReport
from clawRVguarder.utils import utc_now_iso, write_json


class DshConfigLoader(yaml.SafeLoader):
    """只将官方 !!js 标量视为不透明表达式，不执行任何 JavaScript。"""


def _opaque_expression(loader, node):
    """读取语法而非求值，动态配置仍由运行时核验。"""
    loader.construct_scalar(node)
    return "[DSH expression: not evaluated]"


DshConfigLoader.add_constructor("tag:yaml.org,2002:js", _opaque_expression)


class DshBaselineScanner(BaselineScanner):
    """复用 JSON/HTML/PDF 报告输出，只替换宿主专用检查。"""

    def __init__(self, context, *, probe_provider=None) -> None:
        """注入只读宿主投影，缺失或过期时保留静态 unknown。"""
        super().__init__(context)
        self.probe_provider = probe_provider

    def run(self) -> ComplianceReport:
        """读取 profile 清单和 patch，仅导出检查证据而非配置或密钥正文。"""
        started = time.perf_counter()
        context = self.context
        profile = context.target.config_path.parent if context.target.config_path else None
        checks: list[BaselineCheck] = []
        assets: list[AssetRecord] = []

        def add(key: str, title: str, state: str, evidence: dict[str, Any], recommendation: str) -> None:
            checks.append(BaselineCheck(check_id=f"DSH-{key}", category="config", title=title,
                                       status="ok" if state == "verified" else "risk" if state == "risk" else "warn",
                                       severity="info" if state == "verified" else "high" if state == "risk" else "medium",
                                       description=f"DSH 检查状态：{state}", evidence={"verification": state, **evidence},
                                       recommendation=recommendation))

        manifest = profile / "package.json" if profile else None
        data: dict[str, Any] = {}
        profile_data: dict[str, Any] = {}
        try:
            parsed = json.loads(manifest.read_text(encoding="utf-8")) if manifest else None
            if not isinstance(parsed, dict):
                raise ValueError("profile manifest must be an object")
            data = parsed
            dsh = data.get("dsh")
            if not isinstance(dsh, dict) or not isinstance(dsh.get("profile"), dict):
                raise ValueError("dsh.profile must be an object")
            profile_data = dsh["profile"]
            bundles_value = profile_data.get("bundles", [])
            dependencies = data.get("dependencies", {})
            if not isinstance(bundles_value, list) or not all(isinstance(v, str) for v in bundles_value):
                raise ValueError("bundles must be a string array")
            if not isinstance(dependencies, dict) or not all(isinstance(v, str) for v in dependencies.values()):
                raise ValueError("dependencies must contain version strings")
            add("PROFILE", "DSH profile 清单", "verified", {"path": str(manifest)}, "保持清单结构有效。")
        except (OSError, ValueError):
            add("PROFILE", "DSH profile 清单", "risk", {"path": str(manifest)}, "检查清单可读性及 dsh/profile/bundles/dependencies 的类型。")
        bundles_value = profile_data.get("bundles", [])
        bundles = [v for v in bundles_value if isinstance(v, str)] if isinstance(bundles_value, list) else []
        dependencies = data.get("dependencies", {})
        packages = [k for k, v in dependencies.items() if isinstance(v, str)] if isinstance(dependencies, dict) else []
        add("PLUGINS", "插件清单与来源", "unknown", {"bundles": bundles, "packages": packages}, "核对插件来源、完整性与版本；清单存在不代表插件可信。")
        for name in packages:
            assets.append(AssetRecord(category="dependency", name=name, value=str(data["dependencies"][name]), source="dsh-profile"))
        patches = [profile / "cordis.patch.yml", profile / "cordis.yml"] if profile else []
        patches += [context.target.root / "cordis.patch.yml"] if context.target.root else []
        policy_names: set[str] = set()
        malformed: list[str] = []

        visited: set[int] = set()

        def collect(node: Any) -> None:
            if isinstance(node, (dict, list)):
                if id(node) in visited:
                    return
                visited.add(id(node))
            if isinstance(node, dict):
                name = node.get("name")
                if isinstance(name, str) and name.startswith("@deepseek-ai/"):
                    policy_names.add(name)
                for value in node.values():
                    collect(value)
            elif isinstance(node, list):
                for value in node:
                    collect(value)

        for path in patches:
            if path.is_file():
                try:
                    collect(yaml.load(path.read_text(encoding="utf-8"), Loader=DshConfigLoader))
                except (OSError, yaml.YAMLError):
                    malformed.append(str(path))
        add("CONFIG", "DSH YAML 配置可解析", "risk" if malformed else "verified" if any(p.is_file() for p in patches) else "unknown", {"invalid_files": malformed}, "修复 YAML；有效配置还需结合 bundle 和运行时投影核验。")
        for key, title, marker in (("SANDBOX", "沙箱配置与实际强制执行", "sandbox"), ("APPROVAL", "原生审批与应答者", "approval")):
            add(key, title, "unknown", {"declared_plugins": sorted(n for n in policy_names if marker in n)}, "静态声明不能证明有效配置；在锁定 DSH 版本运行能力探针。")
        target = context.target.workspace_path
        add("WORKSPACE", "工作区路径存在", "verified" if target and target.is_dir() else "risk", {"path": str(target)}, "指定宿主可信的工作区根路径。")
        if manifest and manifest.is_file():
            mounted_windows = os.name == "nt" or str(manifest).startswith("/mnt/")
            permissions = stat.S_IMODE(manifest.stat().st_mode)
            add("PERMISSIONS", "DSH 配置访问权限", "unsupported" if mounted_windows else "risk" if permissions & 0o022 else "verified", {"path": str(manifest), "posix_mode": oct(permissions) if not mounted_windows else None}, "Windows 需要 ACL 实测，不能用 WSL 的 POSIX 位判断。")
        elevated = os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0
        add("ACCOUNT", "宿主运行账户权限", "risk" if elevated else "unknown", {"backend_platform": os.name}, "核对实际 DSH 进程账户与 Windows 令牌；后端账户不等同宿主账户。")
        add("PORTS", "宿主监听与认证", "unknown", {}, "实际检查 DSH 监听地址、端口、认证和反向代理；不套用 OpenClaw 端口。")
        add("WINDOWS", "Windows 沙箱完整性", "unknown", {}, "记录 ACL 沙箱 full/partial 与真实越界测试结果。")
        if self.probe_provider:
            try:
                snapshot = self.probe_provider()
                if snapshot.get("probe_fresh"):
                    probe = snapshot["probe"]
                    facts = {f["key"]: f for f in probe["facts"]}
                    for check in checks:
                        key = check.check_id.removeprefix("DSH-")
                        fact = facts.get(key)
                        if fact is None:
                            continue
                        state = fact["state"]
                        # 插件完整性和沙箱边界不能靠服务存在证明。
                        check.status = "ok" if state == "verified" else "risk" if state == "risk" else "warn"
                        check.severity = "info" if state == "verified" else "high" if state == "risk" else "medium"
                        check.description = f"DSH 检查状态：{state}"
                        check.evidence = {"verification": state, "source": "authenticated_host_probe", "platform": probe["platform"],
                                          "observed_at": probe["observed_at"], "detail": fact["evidence"]}
            except (ValueError, OSError):
                pass
        report = ComplianceReport(generated_at=utc_now_iso(), target_root=str(context.target.root),
                                  config_path=str(context.target.config_path), checks=checks,
                                  findings=[_finding_from_check(c) for c in checks if c.status != "ok"],
                                  assets=assets, average_seconds=round(time.perf_counter() - started, 4))
        report.outputs = self.write_outputs(report)
        # 父类在设置 outputs 前写 JSON；在这里补齐最终导出路径。
        write_json(Path(report.outputs["json"]), report.to_dict())
        return report
