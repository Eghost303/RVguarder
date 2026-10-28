# Host Agent Semantic Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DSH-first, host-agent semantic analysis mode that reuses the connected DSH model route through an isolated child agent, validates the response inside RVguarder, and exposes mode and status in the existing frontend.

**Architecture:** The Python core owns sanitization, schema validation, semantic merge, audit state, and PMKB/RV decisions. The DSH plugin owns calling the host's isolated, tool-free child-agent API and returns its response through an authenticated one-shot bridge. A small host semantic provider boundary keeps the contract reusable for a later OpenClaw adapter; this plan does not implement OpenClaw calls.

**Tech Stack:** Python 3.13+, FastAPI/Pydantic v2, TypeScript/Node DSH Plugin SDK, Preact, Vite, Zustand.

---

## File map

| File | Responsibility in this change |
| --- | --- |
| `clawRVguarder/engine/semantic_enhancer.py` | Build the bounded semantic request and parse host-produced semantic evidence using the existing v3 schema. |
| `clawRVguarder/hosts/dsh/semantic.py` | Keep DSH semantic mode, host-result lifecycle, local fallback, and bounded accounting together. |
| `clawRVguarder/hosts/dsh/http.py` | Add authenticated prepare/complete bridge routes and persist the selected semantic mode. |
| `clawRVguarder/hosts/dsh/services.py` | Bind prepared requests to a DSH call; inject validated semantic evidence into the existing decision pipeline; expose mode/provider state. |
| `clawRVguarder/hosts/dsh/observability.py` | Strictly validate and persist the host-agent capability projection without storing model input. |
| `clawRVguarder/engine/pipeline.py` | Thread one optional host response through the current Hook evaluation call without adding it to persisted event metadata. |
| `clawRVguarder/hosts/dsh/server.py` | Accept the new `host-agent` mode at startup. |
| `dshRVguarder/src/client.ts` | Call the authenticated prepare endpoint and return the one-shot semantic response with the original DSH call. |
| `dshRVguarder/src/protocol.ts` | Define bounded request/response and optional per-call semantic envelope types. |
| `dshRVguarder/src/index.ts` | Invoke the DSH native child agent in `tools/pre-execute`, enforce timeout/cancellation, and retain the resulting call envelope through dispatch/result. |
| `dshRVguarder/src/sdk.ts` | Resolve exact DSH package versions and host-agent runtime capability without trusting a declared version string. |
| `dshRVguarder/src/probe.ts` | Advertise observed subagent/preset/no-tool capabilities to the backend. |
| `dshRVguarder/package.json`, `dshRVguarder/package-lock.json` | Declare exact optional DSH subagent, preset registry, and in-process provider peer packages. |
| `dshRVguarder/tests/host-semantic.test.mjs` | Verify host adapter isolation, cancellation, timeout, size bounds, and no-call fallback using a fake SDK context. |
| `tests/test_dsh_host_semantic.py` | Verify preparation binding, schema rejection, fallback, no independent API use, and final PMKB/RV authority. |
| `frontend/src/components/HostPanel.jsx` | Add the host-agent option to the existing DSH semantic mode selector and show capability, route label, and last delegation result. |
| `frontend/src/api.js` | Add a semantic-mode function for changing DSH mode through the current fetch wrapper. |
| `docs/semantic/method.md`, `dshRVguarder/docs/deployment.md`, `dshRVguarder/README.md` | Document data sent to the host child, mode behavior, version requirements, and fallback. |

## Task 1: Verify the pinned DSH child-agent API

**Files:**
- Inspect: `dshRVguarder/package.json`
- Inspect: `dshRVguarder/src/sdk.ts`
- Inspect: the actual `@deepseek-ai/dsh-agent` and child-agent declarations bundled with DSH 0.2.1-rc.2 and rc.3
- Record: `docs/dev/dsh-progress-2026-10-26.md` only if the compatibility finding changes current handoff facts

- [x] **Step 1: Inspect both pinned SDK declarations without changing a live profile.**

Verified local SDK declarations for rc.3 and downloaded npm tarballs for rc.2. Both versions publish `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-agent-preset-registry`, and `@deepseek-ai/dsh-subagent-spawn-in-process`. `ctx.subagents.startActivation()` provides a caller-owned activation with final `result` and `dispose()`; the in-process spawn provider supports `agentPreset` and inherits the parent provider/model when no route override is supplied. This proves package API availability, not that a particular installed DSH profile loaded those services.

- [ ] **Step 2: Check that an empty preset is actually tool-free.**

Register `ctx.agentPresets.register({ id: 'rvguarder-semantic-only', plugins: [] })`, then start a child through provider `spawn` with `request.agentPreset` set to that ID. Verify with `ctx.agentPresets.readDocument(id)` that the registered composition contains no plugin rows, and use a controlled runtime smoke to inspect the resulting child's effective tool list. Enable host-agent capability only when the isolated composition produces no tools; prompt instructions alone do not count as a tool restriction.

- [ ] **Step 3: Select the smallest compatible adapter.**

Use the public in-process `ctx.subagents` seam and `spawn` provider. Register a namespaced provider from `@deepseek-ai/dsh-subagent-spawn-in-process` when that package and service are available; register one RVguarder-owned empty preset through `ctx.agentPresets`. Do not pass `agentOptions.provider` or `agentOptions.model`, so DSH inherits the active route. If the installed profile lacks a required service or provider, keep host-agent unavailable and show the reason in the frontend.

**Expected result:** A recorded version matrix for rc.2 and rc.3 covering start, wait, route inheritance, empty-preset tool policy, timeout, and cancellation. No host profile or daily settings are modified.

## Task 2: Define the shared semantic request and validated result boundary

**Files:**
- Modify: `clawRVguarder/engine/semantic_enhancer.py`
- Modify: `clawRVguarder/hosts/dsh/semantic.py`
- Create: `tests/test_dsh_host_semantic.py`

- [ ] **Step 1: Add unit coverage for sanitized preparation and response validation.**

Test that preparation returns a versioned request ID plus the existing sanitized v3 prompt; that the prompt excludes original secrets and full raw tool arguments; that a valid model response produces only allowlisted operation/fact suggestions; and that malformed JSON, oversized content, extra fields, and an expired/mismatched request are rejected.

- [ ] **Step 2: Run the focused tests and confirm the new API is not implemented yet.**

Run: `python -m pytest tests/test_dsh_host_semantic.py -q`  
Expected: failures for the new request builder/parser methods.

- [ ] **Step 3: Implement the request/result types and enhancer helpers.**

Add a host-neutral request structure with `protocol`, `request_id`, `prompt`, and expiry; use `_build_prompt` and `build_sanitized_llm_input` as the only prompt source. Add a result parser that invokes the existing `parse_semantic_match_response`, enforces a byte limit, marks all facts as `source=llm` and `trust=suggested`, and returns no decision field.

- [ ] **Step 4: Run focused tests.**

Run: `python -m pytest tests/test_dsh_host_semantic.py -q`  
Expected: all request and parser tests pass.

## Task 3: Add the DSH authenticated two-phase semantic bridge

**Files:**
- Modify: `clawRVguarder/hosts/dsh/http.py`
- Modify: `clawRVguarder/hosts/dsh/services.py`
- Modify: `clawRVguarder/hosts/dsh/semantic.py`
- Modify: `tests/test_dsh_host_semantic.py`

- [ ] **Step 1: Add service tests for one-shot call binding.**

Cover: only the matching instance/session/call/request ID can complete preparation; expired, replayed, or cross-call responses fall back locally; host response fields do not become trusted identity or authorization evidence; `host-agent` never enables the direct `SemanticEnhancer` HTTP client.

- [ ] **Step 2: Run focused tests to confirm failures.**

Run: `python -m pytest tests/test_dsh_host_semantic.py -q`  
Expected: failures for the new prepare/complete routes and binding checks.

- [ ] **Step 3: Implement authenticated prepare and completion handling.**

Add a DSH-only prepare route that authenticates with the existing plugin token, confirms the call belongs to this DSH instance, returns the selected mode, and for `host-agent` returns the sanitized one-shot prompt. Store a bounded, expiring request binding keyed by the host-signed call. Add the optional semantic envelope to the `Call` Pydantic model with strict length limits. The `before` operation consumes the matching request once and passes the response through `DshServices.handle_before_tool_call(..., host_semantic_response=...)` to `handle_before_tool_call_pipeline`, then `_annotate_event_context`. `DshSemanticEnhancer` validates it into a normalized result. Never attach the raw response to `BehaviorEvent.metadata`.

- [ ] **Step 4: Keep the current pipeline as final authority.**

Extend the DSH semantic enhancer so `host-agent` uses the supplied response for one call, validates it with existing v3 parsers, then runs local evaluation/merge. Preserve the existing PMKB, RV, approval, journal digest, dispatch revalidation, and failure behavior. Do not store the raw child answer in action metadata or audit; store only mode, fixed status/reason code, request ID hash, duration, and normalized semantic evidence.

- [ ] **Step 5: Run focused backend tests.**

Run: `python -m pytest tests/test_dsh_host_semantic.py -q`  
Expected: all bridge, replay, and final-authority cases pass.

## Task 4: Invoke the DSH child from the existing pre-execute hook

**Files:**
- Modify: `dshRVguarder/src/client.ts`
- Modify: `dshRVguarder/src/protocol.ts`
- Modify: `dshRVguarder/src/index.ts`
- Modify: `dshRVguarder/src/sdk.ts`
- Modify: `dshRVguarder/src/probe.ts`
- Modify: `dshRVguarder/package.json`
- Modify: `dshRVguarder/package-lock.json`
- Create: `dshRVguarder/tests/host-semantic.test.mjs`

- [ ] **Step 1: Add adapter tests against a fake pinned SDK context.**

Test prepare → child start → final text → before decision ordering; verify the child gets only the prepared prompt, no conversation transcript, and the registered empty preset has no tools; verify child route inherits the current host route without forcing an empty provider/model override; test timeout, abort, rejected spawn, missing child result, and response over the byte limit all continue to `/before` with no host result so the backend falls back locally.

- [ ] **Step 2: Run the DSH plugin tests to observe the missing behavior.**

Run: `npm run build; node --test --test-concurrency=1 --test-name-pattern="host semantic" tests/host-semantic.test.mjs` from `dshRVguarder/`  
Expected: the new cases fail before the adapter exists; unrelated test files are not changed.

- [ ] **Step 3: Add version-gated DSH client methods.**

In `GuardClient`, add `prepareSemantic(call, signal)` and make `before` accept the optional semantic envelope. Validate protocol, instance ID, request ID, expiry, and response byte length before the result leaves the plugin. Add optional peer dependencies for the DSH subagent service, preset registry, and spawn provider at `0.2.1-rc.2 || 0.2.1-rc.3`; dynamically detect these services so profiles without them keep RVguarder loaded and show host-agent as unavailable.

- [ ] **Step 4: Implement the child invocation using the API proven in Task 1.**

For `host-agent`, register an RVguarder-namespaced spawn provider and an RVguarder-owned empty agent preset. In `tools/pre-execute`, call `ctx.subagents.startActivation({ provider, delivery: 'caller', signal: exec.signal, request: { parent: exec.agent, prompt: [{ type: 'text', text: prepared.prompt }], agentPreset: EMPTY_PRESET_ID } })`; await `activation.result` and always call `dispose()` in `finally`. Require an empty effective `ctx.tools.schemas()` projection before advertising support. Never pass parent transcript, raw tool arguments outside the prepared prompt, or route overrides. Never call ordinary user-session chat APIs. On all child errors, send the original call to `before` without host semantic output and let Python perform local fallback.

- [ ] **Step 5: Preserve original call identity across dispatch and result.**

Keep the exact call envelope accepted by `/before` in the existing `pending` map so dispatch, completion, idempotency digest, and host-issued approval still bind to the same tool call. Do not let a later retry replace the child response for an already-decided call.

- [ ] **Step 6: Run focused DSH plugin tests and typecheck.**

Run: `npm run build; node --test --test-concurrency=1 --test-name-pattern="host semantic" tests/host-semantic.test.mjs; npm run check` from `dshRVguarder/`.  
Expected: the targeted tests pass and TypeScript reports no errors for rc.2/rc.3 peer types.

## Task 5: Expose mode, capability, and result in the existing frontend

**Files:**
- Modify: `clawRVguarder/hosts/dsh/http.py`
- Modify: `clawRVguarder/hosts/dsh/services.py`
- Modify: `clawRVguarder/hosts/dsh/observability.py`
- Modify: `clawRVguarder/hosts/dsh/server.py`
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/components/HostPanel.jsx`

- [ ] **Step 1: Add mode and status API coverage.**

Extend backend tests to confirm the mode endpoint accepts `host-agent`, rejects it when the authenticated DSH plugin has not advertised the loaded subagent service, spawn provider, preset registry, and verified empty-tool preset; persists the mode; and reports sanitized status fields: `configured_mode`, `host_agent_available`, `provider_status`, `last_delegate_status`, `last_delegate_reason`, and `fallback`.

- [ ] **Step 2: Extend accepted semantic modes and startup parsing.**

Accept `host-agent` in `POST /api/dsh/semantic` and CLI `--semantic-mode`. `local`, `auto`, and `llm` keep their current behavior. In `host-agent`, no key lookup or direct API transport is enabled. If DSH capability is absent, reject selection with a clear 409 response and leave the stored mode unchanged.

- [ ] **Step 3: Connect the existing HostPanel selector to the API helper.**

Add `setDshSemanticMode(mode)` in `frontend/src/api.js`; use it in `HostPanel.jsx` rather than constructing fetch calls inline. Add one `host-agent` option labelled as DSH 子代理, disable it when `host_agent_available !== true`, and show the backend reason when unsupported. After change, refresh the existing DSH status response so selector and details use backend-confirmed state only. Keep labels in `HostPanel.jsx`, which currently owns these DSH strings.

- [ ] **Step 4: Show delegation state without exposing prompt or raw response.**

In `HostPanel.jsx`, show whether the child API is available and whether the last request succeeded or fell back, using a fixed fallback reason. Label the mode as using the active DSH model route without displaying RVguarder's default DeepSeek model as the host-agent model. Keep existing local/auto/LLM labels and behavior.

- [ ] **Step 5: Build the frontend.**

Run: `npm run build` from `frontend/`.  
Expected: Vite completes with the DSH panel mode selector and status text included in the generated UI bundle.

## Task 6: Document DSH setup and maintain compatibility

**Files:**
- Modify: `docs/semantic/method.md`
- Modify: `dshRVguarder/README.md`
- Modify: `dshRVguarder/docs/deployment.md`
- Modify: `dshRVguarder/docs/windows-native-rc3.md`
- Modify: `docs/superpowers/specs/2026-10-28-host-agent-semantic-delegation-design.md` only if implementation evidence changes a stated assumption

- [ ] **Step 1: Document user configuration and data flow.**

Explain how to select DSH 子代理 mode in the existing HostPanel, which sanitized fields are sent, that no separate RVguarder API key is required, that the child has no tools, the configured host route is inherited, and failure falls back to local semantics while PMKB/RV remains authoritative.

- [ ] **Step 2: Record exact rc.2/rc.3 support.**

State supported versions only after the real pinned SDK check and manual runtime validation. If one version cannot satisfy inheritance/tool isolation, show it as unsupported in docs and frontend rather than using an unsafe fallback.

## Task 7: End-to-end DSH validation and finish

**Files:**
- No new runtime profile or live DSH configuration files
- Update: `docs/dev/dsh-progress-2026-10-26.md` with observed build/runtime evidence if the status changes

- [ ] **Step 1: Run backend and DSH plugin focused suites.**

Run: `python -m pytest tests/test_dsh_host_semantic.py -q` from the repo root; `npm run build; node --test --test-concurrency=1 --test-name-pattern="host semantic" tests/host-semantic.test.mjs; npm run check` from `dshRVguarder/`.  
Expected: focused checks pass for both host request and bridge layers.

- [ ] **Step 2: Build an isolated DSH plugin package without installing it into the daily profile.**

Run `npm run build; $packDir = Join-Path $env:TEMP 'rvguarder-dsh-host-agent-pack'; New-Item -ItemType Directory -Force -Path $packDir | Out-Null; npm pack --pack-destination $packDir` from `dshRVguarder/`. Verify package metadata and generated files; do not install into a live DSH profile as part of this repository change.

- [ ] **Step 3: Run a controlled runtime smoke on rc.2 and rc.3 when those runtimes are available.**

Use an isolated DSH profile and test one allowed, one ask, one deny, one child timeout, and one malformed result. Confirm the model route inherits from the live host session, the child has no executable tools, the UI shows the observed status, no independent RVguarder key is present, and authorization still comes from the native approval plus PMKB/RV. Do not change the user's daily profile or workspace configuration.

- [ ] **Step 4: Commit the implementation in reviewable units.**

Commit the shared semantic protocol/backend, DSH plugin, frontend wiring, and documentation in separate commits on `master`, preserving the project branch convention.

## Scope and handoff

- DSH runtime support and frontend operation are in scope and block completion.
- OpenClaw ordinary chat is never used. A future OpenClaw adapter must implement the shared contract through an eligible native isolated subagent API; it is outside this implementation phase as approved in the design spec.
- Do not weaken the DSH default fail-closed behavior, alter OpenClaw's fail-open behavior, or modify any daily DSH profile during build/validation.
