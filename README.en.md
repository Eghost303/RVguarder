# RVguarder

English | [简体中文](README.md)

> **Agent security plugin**: pre-execution approval, PMKB authorization modeling, and runtime verification for OpenClaw and DSH (DeepSeek Harness).

[![License](https://img.shields.io/badge/License-Apache%202.0-2563EB.svg)](LICENSE)
![Python](https://img.shields.io/badge/Python-3.13%2B-3776AB?logo=python&logoColor=white)
![Hosts](https://img.shields.io/badge/Hosts-OpenClaw%20%2F%20DSH-111827)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2%20%2F%20rc.3-2563EB)
![PMKB](https://img.shields.io/badge/PMKB-1.2.0-2563EB)
![RV](https://img.shields.io/badge/RV-ChainRule%20DSL-7C3AED)
![Status](https://img.shields.io/badge/Status-v0.7.0--dev-0F766E)

RVguarder targets two hosts. On OpenClaw it hooks into the official Plugin SDK via
`before_tool_call`; on DSH it hooks into `tools/pre-execute` and `ctx.tools.guard()`.
Both share one Python decision core. Neither integration modifies host source code, and both
complete the following before an agent actually invokes a tool:

- **Authorization decisions** — normalize each tool call into an Authorization Trace and let PMKB produce an explainable authorization result
- **Pre-execution approval** — high-risk operations return `requireApproval`; the agent suspends and hands control to OpenClaw's native approval card
- **Behavior-sequence verification** — a ChainRule DSL monitor detects chained risks such as "read sensitive data → package → exfiltrate" inside a sliding window
- **End-to-end audit** — SQLite + JSONL dual writes, tamper-resistant hash chain, exportable

The goal is not to replace a sandbox or take over OpenClaw, but to give every agent tool call an
explicit authorization basis, an approval record, and replayable evidence.

---

## Why a plugin

An agent's capabilities come from tool calls, and so does its risk. Traditional approaches either
patch agent source code or rely on an external sandbox. Neither answers "why was this call allowed"
or "what risk does it form together with the previous steps".

RVguarder takes the plugin path:

| Principle | Meaning |
| --- | --- |
| **Non-intrusive** | No host source changes; the OpenClaw plugin is generated and injected by Guard, DSH loads a standalone npm package |
| **One core, two hosts** | OpenClaw and DSH share PMKB, RV, and the audit core; no duplicated policy stacks |
| **Single approval authority** | OpenClaw / DSH native approval is the only decision source; the Dashboard syncs read-only |
| **Evidence-driven** | Every decision carries `match_status`, `missing_features`, `requested_delta`, and related evidence |
| **Forensically auditable** | Approvals, executions, blocks, and audit results are persisted and exportable |
| **Configurable failure policy** | OpenClaw passes through when its backend is unreachable; DSH defaults to fail-closed with explicit opt-in fail-open |

---

## Core capabilities

| Capability | Description |
| --- | --- |
| **Native hook interception** | `api.on("before_tool_call")` official API suspends the agent before tool execution |
| **DSH native gate** | `tools/pre-execute` returns `allow` / `ask` / `deny`, with `ctx.tools.guard()` monotonic denial and fail-closed by default |
| **`requireApproval` suspension** | Returns `BeforeToolCallResult`; the agent thread actually waits for the approval result |
| **Approval result sync** | OpenClaw's native approval card is the only decision; the Guard Dashboard syncs read-only over SSE |
| **PMKB authorization modeling** | PMKB 1.2.0: 48 canonical operations, 79 native rules, 76 traces, 9 dangerous combinations, 123 regression vectors |
| **Least-privilege checks** | PermissionClosure + PermissionDiff compute the gap between requested and necessary permissions |
| **Runtime verification (RV)** | Sliding windows + ChainRule DSL monitors detect cross-step chained attacks |
| **Cross-session principal verification** | Session-local and principal-global state are separated, with TTL-bounded persistence |
| **Semantic understanding** | SemanticEnhancer: 7-dimension label system, supporting both LLM and local-rule modes |
| **Audit chain** | SQLite + JSONL dual writes with a SHA-256 hash chain |
| **Baseline security scanning** | Configuration, port, user, and dependency scans with JSON/HTML/PDF reports |
| **Web workbench** | Preact SPA: action status, trace timeline, risk evidence, RV state panel |

---

## How it works

```
OpenClaw prepares a tool call
  → api.on("before_tool_call") fires
  → plugin POST /api/hook/before-tool-call
  → SemanticEnhancer → Authorization Trace → PMKB rules/permission combos → RV verification
  → return allow | requireApproval | block
  → requireApproval: agent suspends, OpenClaw shows the native approval card
  → onResolution callback → Guard syncs read-only over SSE
  → tool continues or aborts → after_tool_call writes audit records
```

DSH uses the same core through native host seams:

```
DSH prepares a tool call
  → tools/pre-execute (TypeScript plugin)
  → authenticated loopback HTTP → Python shared core (PMKB + RV + audit)
  → allow | ask | deny
  → DSH native approval / execution
  → tools/execute and tools/result → completion write-back and audit
```

```
┌─────────────────────────────────────────────────────────┐
│                    Guard Dashboard (SPA)                 │
│   Overview · Action approval · Security rules · Baseline │
│   scanning · RV panel                                    │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP REST API / SSE
┌──────────────────────▼──────────────────────────────────┐
│                  Guard Bridge (Python)                   │
│   Semantic + Trace │ PMKB Policy │ RV Engine │ Audit     │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/hook/before-tool-call
┌──────────────────────▼──────────────────────────────────┐
│            OpenClaw Agent Plugin (JavaScript)            │
│   before_tool_call → requireApproval                    │
│   after_tool_call  → audit logging                      │
│   Circuit Breaker · Health Check · onResolution         │
└──────────────────────┬──────────────────────────────────┘
                       │ Plugin SDK
┌──────────────────────▼──────────────────────────────────┐
│                   OpenClaw Gateway                        │
│         Agent runtime · Tool calls · Native approval UI   │
└─────────────────────────────────────────────────────────┘
```

There is exactly one approval owner: OpenClaw's native approval card. Guard only supplies evidence
and read-only state; it never creates a second approval source.

---

## Quick start

### Requirements

- Python 3.13+
- Node.js 20+ (frontend build)
- A working OpenClaw installation

### Installation

```bash
git clone https://github.com/HorizonExploration/RVguarder.git
cd RVguarder

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .

# Build workbench static assets (output to runtime/ui/)
cd frontend
npm ci
npm run build
cd ..
```

The Python package is now `clawRVguarder`. After updating an existing development environment,
re-run `python -m pip install -e .`; launch the module with `python -m clawRVguarder.main run`,
while the CLI command remains `openclaw-guard`.

### Running

```bash
openclaw-guard run
```

Startup automatically discovers the OpenClaw configuration, prepares runtime directories, generates
and injects the hook plugin, and starts the local service. Open `http://localhost:8780` for the
workbench.

```bash
openclaw-guard run --no-browser   # do not open a browser automatically
openclaw-guard run --once         # one-shot self-check
openclaw-guard doctor             # inspect pipeline health
openclaw-guard baseline           # run a baseline scan
openclaw-guard export-audit --output ./audit.json
openclaw-guard install-hook       # manually inject the plugin
openclaw-guard uninstall-hook     # remove the plugin
```

Optional LLM semantic enhancement:

```bash
export DEEPSEEK_API_KEY=...
```

Without it, the local-rule mode is used: lower latency, same availability.

### DSH plugin

The source supports **DSH 0.2.1-rc.2 / rc.3**, Node 24, and Python 3.13+. The current local development candidate is
**0.2.0-rc.2** (not published; protocol `dsh-guard-v2`). The backend supports **native Windows Python and Linux/WSL Python**.
Windows support is independent of Python's distribution or installation channel, provided the version and dependencies are compatible; WSL is optional.
See the [native Windows guide](dshRVguarder/docs/windows-native-rc3.md) for desktop rc.3 setup. The published rc.1 does not include these changes.

**Basic startup, a new profile connection, and interception have passed user checks; host product integration is still incomplete.** RVguarder is not visible in DSH's plugin page, its workbench is a separate page, and deployment still requires multiple manual steps. Frequent `ask` decisions in local mode and blocked operations in full-permission mode were also reported; these observations await reproduction and diagnosis. This checkpoint records them without changing policy behavior. See the [progress and team handoff](docs/dev/dsh-progress-2026-10-26.md).

The current flow is: prepare dependencies → build the workbench and plugin → initialize an instance and install a new profile → **start Python separately** → start DSH → use the separate Guard workbench. The helper scripts do not provide a one-click installer or automatically manage the backend lifecycle.

**A GitHub Release is not required for source deployment or a PR.** Maintainers may distribute a matched tgz/wheel set to avoid source compilation. Any later Release should be a pre-release with installation notes, checksums, and known issues; publishing artifacts does not provide the missing UI integration or automatic service management.

Build the current candidate from source, then install it; historical packages remain available in [GitHub Releases](https://github.com/HorizonExploration/RVguarder/releases):

```bash
dsh plugin --profile <profile> add ./dsh-rvguarder-0.2.0-rc.2.tgz
```

Build from source:

```bash
cd dshRVguarder
npm ci --ignore-scripts --legacy-peer-deps
node scripts/link-sdk.mjs '<DSH install root>'
npm run check && npm test
npm pack
```

Use `python dshRVguarder/scripts/build-release.py --output <new-directory>` to build the matching plugin tgz, Python wheel,
installation guide, profile generator, and SHA-256 manifest. v2 requires the matching backend; drain
the 0.1.0 queue with the old version first and never mix `dsh-guard-v1` with v2.

See the [DSH deployment guide](dshRVguarder/docs/deployment.md) for the shared service, isolated
profiles, native Windows or Linux/WSL deployment, and working-directory constraints.

---

## PMKB: Permission Model Knowledge Base

PMKB participates in every `before_tool_call` decision; it is not offline documentation. The current
baseline lives in `policies/permissions/`, the single source of truth in the repository; `setup.py`
copies it into the installed package at build time.

| Data | Current baseline | Purpose |
| --- | --- | --- |
| operations | 48 | Normalize tools/actions into canonical operations |
| rules | 79 native | Single-step rules, risk levels, effects, and required traces |
| migrations | 47 | Provenance/replay mapping from legacy rules to native owners |
| traces | 76 | Minimal necessary permission scope for a principal in office scenarios |
| relations | 9 | Mutually exclusive, aggregate, and toxic permission combinations |
| vectors | 123 | Positive and negative cases for rules, traces, combinations, and migrations |

Decision order:

```text
raw tool call
  → SemanticEnhancer (entities / labels / classification / purpose / confidence)
  → TraceCompiler (action / resource / scope / data / context / principal / identity)
  → PolicyEvaluator (matched / partial / unknown / conflict)
  → PermissionClosure + PermissionDiff + RiskGraph
  → effect: auto_allow_audit | openclaw_approval | block
```

Unknown operations, missing principals, or missing critical trace features are never auto-allowed
based on fuzzy similarity. Results carry `match_status`, `missing_features`, `requested_delta`,
`excessive_permissions`, `combo_violations`, and `policy_version` for explanation and replay in the
Dashboard.

---

## RV: Runtime Verification

RV verifies behavior sequences on top of PMKB's single-step effects. At runtime it only uses the
ChainRule DSL:

```
s1: file_read    /tmp/data.xlsx          ← read an external attachment
s2: file_read    contains_secret         ← sensitive data is read
s3: file_write   merged into a new file  ← sensitive data is written out
s4: network_egress → external_target     ← data leaves the host

ChainRule DSL monitor fires:
  "untrusted source → read sensitive data → send to external target"
  → BLOCK (higher priority than the single-step ASK rule)
```

State scopes:

- **session-local**: sliding window within the current session
- **principal-global**: aggregate cross-session capabilities by `(principal_id, agent_id, capability_lineage)`

State is stored in `runtime/rv-state.json`, bounded by TTL and size limits.

---

## Project layout

```
clawRVguarder/        Python backend and CLI (FastAPI, PMKB, RV, audit, OpenClaw integration)
dshRVguarder/         DSH 0.2.1-rc.2 / rc.3 adapter plugin (local development candidate 0.2.0-rc.2, not published)
frontend/             Preact workbench (Vite build, output to runtime/ui/)
policies/permissions/ PMKB single source (schema, operations, rules, traces, relations, vectors)
tests/                Backend tests and documentation/release contracts
e2e/                  Playwright end-to-end tests
scripts/              Validation and release helper scripts
docs/                 VuePress documentation site
```

---

## Development and testing

```bash
python -m pytest tests/ -q

cd frontend
npm run dev          # local development, proxies /api to 127.0.0.1:8780
npm run build        # build output to runtime/ui/

cd docs
npm install
npm run docs:dev     # local docs preview
```

Tests cover permission decisions, trace compilation, the PMKB baseline, principal-level RV,
ChainRule DSL, auditing, CLI, and frontend contracts.

---

## Security boundaries

RVguarder is a policy and approval layer, not a system-level sandbox:

- It only covers tool calls made through public host seams (OpenClaw `before_tool_call` / DSH `tools/pre-execute`)
- On OpenClaw, when the backend is unreachable, returns 4xx/5xx, or returns unparsable responses, tool calls pass through; only an explicit Guard `block` stops execution
- On DSH, fail-closed is the default: execution is refused when the core service is unreachable, the protocol is invalid, or history is unconfirmed; only an explicit `failMode: open` passes through service failures
- The default PMKB targets personal office scenarios; other scenarios need extended policy packs
- Unknown tools and out-of-scope arguments remain `unknown` and are never auto-allowed
- Approval cost and policy precision must be calibrated for each deployment

See [Security capabilities and boundaries](docs/rvguarder-security-capabilities-and-boundaries.md)
for the fuller attack surface and known gaps.

---

## Documentation

| Document | Content |
| --- | --- |
| [Quick start](docs/deployment/local.md) | Local deployment |
| [Runtime hook](docs/features/runtime-hook.md) | Interception mechanism and approval sync |
| [Action approval chain](docs/features/action-gate.md) | Decision flow and PMKB policy |
| [Architecture overview](docs/architecture/overview.md) | Layered design and code mapping |
| [PMKB and RV runtime architecture](docs/architecture/permission-kb-runtime-architecture.md) | Authorization modeling, traces, and cross-session RV |
| [RV permission automata](docs/architecture/rv-permission-automata.md) | DSL contract, scopes, and migration |
| [HTTP API](docs/api/http.md) | Endpoint reference |
| [Semantic understanding](docs/semantic/method.md) | SemanticEnhancer and the label system |
| [DSH plugin deployment](dshRVguarder/docs/deployment.md) | DSH shared service, profiles, and native Windows / Linux/WSL deployment |
| [DSH validation record](dshRVguarder/docs/validation-2026-10-20.md) | Verified scope, performance baseline, and remaining gates |
| [DSH migration and development plan](docs/architecture/dsh-plugin-migration-feasibility-2026-10-19.md) | Extension-point mapping, capability matrix, and phased plan |
| [FAQ](docs/ops/faq.md) | Common questions |
| [Roadmap](docs/ops/roadmap.md) | Development plan |

---

## License

[Apache-2.0](LICENSE)
