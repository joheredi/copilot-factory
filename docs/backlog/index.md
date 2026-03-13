# Autonomous Software Factory — Project Backlog

## Purpose

This backlog translates the product and architecture documentation in `docs/prd/` into an execution-ready development plan. It is designed to be consumed by both humans (for planning and oversight) and AI coding agents (for autonomous task execution).

## How to Use This Backlog

1. **Start with this index** for navigation, sequencing, and readiness.
2. **Read phase docs** to understand implementation groupings.
3. **Read epic docs** for context on a workstream.
4. **Read task docs** for detailed implementation instructions.
5. **Read [agent execution guidance](agents/execution-rules.md)** for rules on autonomous execution.
6. **Read [index-archive.md](index-archive.md)** for completed epics and their tasks.

## File Organization

```
docs/backlog/
  index.md              ← You are here (active work only)
  index-archive.md      ← Completed epics and their tasks
  epics/                — 27 epic documents
  tasks/                — 151 task documents
  phases/               — 5 phase documents
  agents/               — AI agent execution guidance
  backlog.json          — Machine-readable backlog
```

---

## Executive Summary

### System Overview

The Autonomous Software Factory is a local-first orchestration platform for software delivery using bounded AI workers inside a deterministic control plane. It supports backlog analysis, dependency-aware scheduling, isolated developer execution, multi-perspective review workflows, serialized merges, post-merge validation, and operator visibility through a local web UI.

### Progress

21 of 27 epics are complete (E001–E008, E010–E022). See [index-archive.md](index-archive.md) for details.

### Active Workstreams

1. **Worker Runtime** (E009) — Worker dispatch service, infrastructure adapters, integration wiring (5/13 tasks done)
2. **Task Import Pipeline** (E023) — Import schemas, parsers, API, UI dialog (0/8 tasks done)
3. **CLI Package** (E024) — Scaffold workspace, entry point (0/4 tasks done)
4. **Web UI Forms** (E025) — Creation/editing dialogs for all entities (0/8 tasks done)
5. **CLI Init & Onboarding** (E026) — Global data dir, project auto-detection, interactive init (0/5 tasks done)
6. **Factory Lifecycle & Recovery** (E027) — Start command, static serving, two-phase shutdown, recovery logging (0/7 tasks done)

### Key Risks

- **Worker dispatch gap** — Tasks currently get stuck in ASSIGNED state; E009 dispatch tasks are critical path
- **Import pipeline** — New feature with no existing infrastructure; needs careful schema design
- **CLI packaging** — Bundling the web UI into the control-plane server requires build pipeline changes
- **Shutdown robustness** — Two-phase shutdown must not corrupt database state or leave orphaned processes

---

## Active Epic Overview

| ID                                      | Title                                | Dependencies                 | Total Tasks | Done | Pending |
| --------------------------------------- | ------------------------------------ | ---------------------------- | ----------- | ---- | ------- |
| [E009](epics/E009-worker-runtime.md)    | Worker Runtime & Execution           | E004, E005, E006, E008, E010 | 13          | 7    | 6       |
| [E023](epics/E023-task-import.md)       | Task Import Pipeline                 | E001, E002, E017, E019, E020 | 8           | 0    | 8       |
| [E024](epics/E024-cli-package.md)       | CLI Package & Single-Command Startup | E001, E017, E019             | 4           | 0    | 4       |
| [E025](epics/E025-web-ui-forms.md)      | Web UI Creation & Editing Forms      | E019, E020, E021             | 8           | 0    | 8       |
| [E026](epics/E026-cli-init.md)          | CLI Init & Project Onboarding        | E001, E002, E023             | 5           | 0    | 5       |
| [E027](epics/E027-factory-lifecycle.md) | Factory Lifecycle & Recovery         | E024, E026                   | 7           | 0    | 7       |

### Completed Epics (archived)

See [index-archive.md](index-archive.md) for the 21 completed epics: E001–E008, E010–E022.

---

## Task Summary — Active Epics

### E009: Worker Runtime & Execution

| ID                                                  | Title                                                       | Priority | Type           | Status  |
| --------------------------------------------------- | ----------------------------------------------------------- | -------- | -------------- | ------- |
| [T043](tasks/T043-worker-runtime-interface.md)      | Define worker runtime interface                             | P0       | foundation     | done    |
| [T044](tasks/T044-worker-supervisor.md)             | Implement Worker Supervisor                                 | P0       | feature        | done    |
| [T045](tasks/T045-copilot-cli-adapter.md)           | Implement Copilot CLI execution adapter                     | P0       | feature        | done    |
| [T046](tasks/T046-output-capture-validation.md)     | Implement structured output capture and validation          | P0       | feature        | done    |
| [T047](tasks/T047-command-wrapper.md)               | Implement policy-aware command wrapper                      | P0       | security       | done    |
| [T132](tasks/T132-worker-dispatch-service.md)       | Implement WorkerDispatchService in application layer        | P0       | feature        | done    |
| [T133](tasks/T133-worker-dispatch-tests.md)         | Unit tests for WorkerDispatchService                        | P0       | feature        | done    |
| [T134](tasks/T134-worker-dispatch-adapter.md)       | Wire WorkerDispatch unit-of-work adapter in control-plane   | P0       | infrastructure | done    |
| [T135](tasks/T135-heartbeat-forwarder-adapter.md)   | Implement HeartbeatForwarderPort adapter                    | P0       | infrastructure | done    |
| [T136](tasks/T136-infrastructure-adapter-wiring.md) | Wire workspace, runtime, and packet infrastructure adapters | P0       | infrastructure | pending |
| [T137](tasks/T137-wire-dispatch-automation.md)      | Integrate WorkerDispatchService into AutomationService      | P0       | feature        | pending |
| [T138](tasks/T138-dispatch-integration-test.md)     | End-to-end dispatch integration test                        | P0       | feature        | done    |
| [T139](tasks/T139-worker-runner-exports.md)         | Update worker-runner package to re-export dispatch types    | P1       | refactor       | pending |

### E023: Task Import Pipeline

| ID                                              | Title                                     | Priority | Type          | Status  |
| ----------------------------------------------- | ----------------------------------------- | -------- | ------------- | ------- |
| [T112](tasks/T112-define-import-schema.md)      | Define task import Zod schemas            | P0       | foundation    | pending |
| [T113](tasks/T113-build-markdown-parser.md)     | Build deterministic markdown task parser  | P0       | feature       | pending |
| [T114](tasks/T114-build-json-parser.md)         | Build JSON/backlog.json task parser       | P1       | feature       | pending |
| [T115](tasks/T115-import-discovery-endpoint.md) | Create POST /import/discover endpoint     | P0       | feature       | done    |
| [T116](tasks/T116-import-execute-endpoint.md)   | Create POST /import/execute endpoint      | P0       | feature       | done    |
| [T117](tasks/T117-import-api-hooks.md)          | Create TanStack Query import hooks        | P1       | feature       | pending |
| [T118](tasks/T118-import-dialog-component.md)   | Build Import Tasks multi-step dialog      | P1       | feature       | pending |
| [T123](tasks/T123-import-format-docs.md)        | Write task format reference documentation | P2       | documentation | pending |

### E024: CLI Package & Single-Command Startup

| ID                                           | Title                                        | Priority | Type          | Status  |
| -------------------------------------------- | -------------------------------------------- | -------- | ------------- | ------- |
| [T119](tasks/T119-scaffold-cli-workspace.md) | Scaffold apps/cli workspace                  | P0       | foundation    | done    |
| [T120](tasks/T120-bundle-web-ui.md)          | Serve web-ui static files from control-plane | P0       | feature       | done    |
| [T121](tasks/T121-cli-entry-point.md)        | Build CLI entry point command                | P0       | feature       | done    |
| [T122](tasks/T122-cli-readme.md)             | Write CLI and import documentation           | P2       | documentation | pending |

### E025: Web UI Creation & Editing Forms

| ID                                             | Title                                            | Priority | Type    | Status  |
| ---------------------------------------------- | ------------------------------------------------ | -------- | ------- | ------- |
| [T124](tasks/T124-create-task-dialog.md)       | Add Create Task dialog to Tasks page             | P1       | feature | pending |
| [T125](tasks/T125-create-project-dialog.md)    | Add Create Project dialog                        | P1       | feature | pending |
| [T126](tasks/T126-create-repository-dialog.md) | Add Create Repository dialog to Project detail   | P1       | feature | pending |
| [T127](tasks/T127-create-pool-dialog.md)       | Add Create Worker Pool dialog to Pools page      | P1       | feature | pending |
| [T128](tasks/T128-create-profile-dialog.md)    | Add Create Agent Profile dialog to Pool detail   | P2       | feature | pending |
| [T129](tasks/T129-edit-task-form.md)           | Add Edit Task form to Task detail page           | P2       | feature | pending |
| [T130](tasks/T130-batch-task-import-ui.md)     | Add Batch Task Import UI to Tasks page           | P2       | feature | pending |
| [T131](tasks/T131-reassign-pool-action.md)     | Add Reassign Pool operator action to Task detail | P2       | feature | pending |

### E026: CLI Init & Project Onboarding

| ID                                            | Title                                        | Priority | Type       | Status  |
| --------------------------------------------- | -------------------------------------------- | -------- | ---------- | ------- |
| [T140](tasks/T140-global-data-dir.md)         | Establish ~/.copilot-factory/ convention     | P0       | foundation | pending |
| [T141](tasks/T141-programmatic-migrations.md) | Run Drizzle migrations from code             | P0       | foundation | pending |
| [T142](tasks/T142-init-project-detection.md)  | Auto-detect project metadata in init command | P0       | feature    | pending |
| [T143](tasks/T143-init-interactive-flow.md)   | Build init interactive flow and registration | P0       | feature    | pending |
| [T144](tasks/T144-init-idempotent.md)         | Make init safe to re-run                     | P1       | feature    | pending |

### E027: Factory Lifecycle & Recovery

| ID                                               | Title                                      | Priority | Type          | Status  |
| ------------------------------------------------ | ------------------------------------------ | -------- | ------------- | ------- |
| [T145](tasks/T145-start-command.md)              | Build factory start command                | P0       | feature       | done    |
| [T146](tasks/T146-start-static-serving.md)       | Serve web-ui static files from same server | P0       | feature       | done    |
| [T147](tasks/T147-two-phase-shutdown.md)         | Implement two-phase Ctrl+C shutdown        | P0       | feature       | done    |
| [T148](tasks/T148-startup-recovery-log.md)       | Log recovery status on startup             | P1       | feature       | pending |
| [T149](tasks/T149-workspace-cleanup.md)          | Clean orphaned worktrees on start          | P2       | feature       | pending |
| [T150](tasks/T150-dashboard-project-selector.md) | Add multi-project filter to dashboard      | P1       | feature       | pending |
| [T151](tasks/T151-cli-hero-docs.md)              | Document the CLI hero experience           | P2       | documentation | pending |

---

## Dependency Highlights

### Active Epic Dependencies

```
E009 (Worker Runtime) — dispatch tasks depend on completed E004, E005, E006, E008, E010
  └─► T132 (dispatch service) → T133 (tests), T134 (adapter), T139 (exports)
  └─► T135 (heartbeat adapter), T136 (infra wiring) → T137 (automation wiring) → T138 (integration test)

E023 (Task Import) — depends on completed E001, E002, E017, E019, E020
  └─► T112 (schemas) → T113 (markdown parser), T114 (json parser)
  └─► T115 (discover API), T116 (execute API) → T117 (hooks) → T118 (UI dialog)
  └─► T123 (docs) — no blockers

E024 (CLI Package) — depends on completed E001, E017, E019
  └─► T119 (scaffold) → T120 (bundle UI) → T121 (entry point) → T122 (docs)

E025 (Web UI Forms) — depends on completed E019, E020, E021
  └─► All tasks are independent of each other (can be parallelized)

E026 (CLI Init) — depends on T119 (scaffold from E024)
  └─► T140 (data dir) → T141 (migrations) → T142 (detection) → T143 (interactive flow) → T144 (idempotent)

E027 (Factory Lifecycle) — depends on T140/T141 (from E026)
  └─► T146 (static serving, independent) → T145 (start command) → T147 (shutdown) → T148 (recovery log) → T149 (cleanup)
  └─► T150 (dashboard project selector) — independent, can parallelize
  └─► T151 (docs) — after T144 and T149
```

### Ready-Now Tasks

Pending tasks whose dependencies are all satisfied (can start immediately):

- [T142](tasks/T142-init-project-detection.md): Auto-detect project metadata (E026)
- [T145](tasks/T145-start-command.md): Build factory start command (E027)
- [T124](tasks/T124-create-task-dialog.md): Add Create Task dialog to Tasks page (E025)
- [T125](tasks/T125-create-project-dialog.md): Add Create Project dialog (E025)
- [T126](tasks/T126-create-repository-dialog.md): Add Create Repository dialog to Project detail (E025)
- [T127](tasks/T127-create-pool-dialog.md): Add Create Worker Pool dialog to Pools page (E025)
- [T128](tasks/T128-create-profile-dialog.md): Add Create Agent Profile dialog to Pool detail (E025)
- [T129](tasks/T129-edit-task-form.md): Add Edit Task form to Task detail page (E025)
- [T130](tasks/T130-batch-task-import-ui.md): Add Batch Task Import UI to Tasks page (E025)
- [T131](tasks/T131-reassign-pool-action.md): Add Reassign Pool operator action to Task detail (E025)
- [T150](tasks/T150-dashboard-project-selector.md): Add multi-project filter to dashboard (E027)
- [T123](tasks/T123-import-format-docs.md): Write task format reference documentation (E023)
- [T117](tasks/T117-import-api-hooks.md): Create TanStack Query import hooks (E023)

### High-Priority (P0) Pending Tasks

- [T142](tasks/T142-init-project-detection.md): Auto-detect project metadata (E026)
- [T143](tasks/T143-init-interactive-flow.md): Build init interactive flow (E026)
- [T145](tasks/T145-start-command.md): Build factory start command (E027)
- [T147](tasks/T147-two-phase-shutdown.md): Implement two-phase shutdown (E027)
- [T148](tasks/T148-startup-recovery-log.md): Log recovery status on startup (E027)
- [T150](tasks/T150-dashboard-project-selector.md): Multi-project dashboard filter (E027)

---

## Links

- [Completed Epics Archive](index-archive.md)
- [Agent Execution Guidance](agents/execution-rules.md)
- [Machine-Readable Backlog](backlog.json)
- **Phase Docs:** [P01](phases/P01-foundation.md), [P02](phases/P02-core-domain.md), [P03](phases/P03-vertical-slice.md), [P04](phases/P04-ui-operability.md), [P05](phases/P05-hardening.md)
- **Source PRDs:** `docs/prd/001-architecture.md` through `docs/prd/010-integration-contracts.md`
