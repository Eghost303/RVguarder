# DSH tests

Run `npm run check && npm test` with the SDK linked to fixed DSH 0.2.1-rc.2. Requires Node24 and the editable Python3.13+ backend.

25 Node tests include actual SDK allow/ask/deny/guard, nested opaque parent IDs, outbox/lease/degraded recovery; real Python+SDK local byte receipts, changed-source rejection, path boundaries and actual Node PTC scheduler with a real local sandbox. A missing real sandbox is reported as skipped, never accepted as verified. Online model credentials are not used.

Python DSH tests: `python -m pytest tests/test_dsh_adapter.py -q` (47 cases at the v2 repair checkpoint). Browser suites cover both Chromium and Firefox. See docs/repair-2026-10-21.md for actual results and release gaps.
