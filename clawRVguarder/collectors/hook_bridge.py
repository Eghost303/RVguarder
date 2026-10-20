from __future__ import annotations

from clawRVguarder.models import CapabilityStatus


class HookBridge:
    def capability(self) -> CapabilityStatus:
        return CapabilityStatus(name="hook-bridge", available=True, mode="local-api", detail="Local non-intrusive hook bridge is available.")

