# DSH tests · v0.2.1-rc.1

Use Node 24 and a native Python 3.13+ backend. Link the SDK to the exact supported DSH rc.2/rc.3 runtime. For host-agent tests the snapshot also needs the same-version `dsh-agent-preset-registry` and `dsh-subagent-spawn-in-process`; the desktop SDK extractor includes these when available without changing the desktop installation.

```powershell
npm --prefix dshRVguarder run check
$env:RVGUARDER_PYTHON = '<native Python executable>'
$env:RVGUARDER_TEST_PACKAGE = '<unpacked complete package>'
$env:RVGUARDER_TEST_BACKEND = '<unpacked complete package>/backend/rvguarder-backend.exe'
npm --prefix dshRVguarder test
```

The suite contains 68 tests covering SDK allow/ask/deny, controlled byte receipts, exact HTTPS grants, ten simultaneous calls, task identity, host semantic isolation, owner Remote validation, theme handling and managed lifecycle. Missing package inputs or a real PTC sandbox produce explicit skips, never acceptance. The ten-call test keeps its concurrency and original timeout.

Run Python tests from the repository root: `python -m pytest tests/test_dsh_adapter.py tests/test_dsh_migration.py -q -rs`. Test fixtures are disposable data, not persistent desktop profiles. Real DSH integration uses only `~/.dsh/profiles/rvguarder-dev`. If a test runner restricts access to system temporary directories, select a fresh writable workspace temporary directory; do not relax ACL validation.

Browser tests and current results are documented in the [release record](../../docs/dev/release-v0.2.1-rc.1.md). Browser verification does not substitute for desktop acceptance or online model tests.
