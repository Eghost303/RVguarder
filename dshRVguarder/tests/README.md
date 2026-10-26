# DSH tests

Run `npm run check && npm test` with the SDK linked to a supported DSH version (0.2.1-rc.2 or 0.2.1-rc.3). Requires Node24 and the editable Python3.13+ backend on native Windows or Linux/WSL. Windows support does not depend on how Python was installed; select the interpreter with `RVGUARDER_PYTHON` when needed. See [native Windows setup](../docs/windows-native-rc3.md) for dependency and virtual-environment examples.

25 Node tests include actual SDK allow/ask/deny/guard, nested opaque parent IDs, outbox/lease/degraded recovery; real Python+SDK local byte receipts, changed-source rejection, path boundaries and actual Node PTC scheduler with a real local sandbox. A missing real sandbox is reported as skipped, never accepted as verified. Online model credentials are not used.

Python DSH tests: `python -m pytest tests/test_dsh_adapter.py -q` (47 cases at the v2 repair checkpoint). Browser suites cover both Chromium and Firefox. See docs/repair-2026-10-21.md for actual results and release gaps.
