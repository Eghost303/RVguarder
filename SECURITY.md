# Security policy

The current candidate is **v0.2.1-rc.1**. It is a pre-release; older development
snapshots do not receive separate security fixes. Windows x64 with DSH
0.2.1-rc.3 is the packaged target. See the
[release scope](https://github.com/HorizonExploration/RVguarder/blob/master/dshRVguarder/docs/release-current.md)
for validation limits.

RVguarder applies policy to host tool calls. It does not replace an operating
system sandbox or isolate arbitrary processes running with the same user's full
privileges. OpenClaw passes through backend failures; DSH defaults to fail-closed.

Report suspected vulnerabilities using **Security → Report a vulnerability** on
[the upstream repository](https://github.com/HorizonExploration/RVguarder/security).
If private reporting is unavailable, open an issue requesting a private contact
without including exploit details, credentials, personal data or raw runtime logs.
Include the package version, host version and a sanitized reproduction when a
private channel is available. The maintainers assess reports before promising a
fix or disclosure date.
