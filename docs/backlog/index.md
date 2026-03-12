# Autonomous Software Factory — Project Backlog

## Purpose

This backlog translates the product and architecture documentation in `docs/prd/` into an execution-ready development plan. It is designed to be consumed by both humans (for planning and oversight) and AI coding agents (for autonomous task execution).

## How to Use This Backlog

1. **Start with this index** for navigation, sequencing, and readiness.
2. **Read phase docs** to understand implementation groupings.
3. **Read epic docs** for context on a workstream.
4. **Read task docs** for detailed implementation instructions.
5. **Read [agent execution guidance](agents/execution-rules.md)** for rules on autonomous execution.

## File Organization

```
docs/backlog/
  index.md              ← You are here
  epics/                — 22 epic documents
  tasks/                — 111 task documents
  phases/               — 5 phase documents
  agents/               — AI agent execution guidance
  backlog.json          — Machine-readable backlog
```

---

## Executive Summary

### System Overview

The Autonomous Software Factory is a local-first orchestration platform for software delivery using bounded AI workers inside a deterministic control plane. It supports backlog analysis, dependency-aware scheduling, isolated developer execution, multi-perspective review workflows, serialized merges, post-merge validation, and operator visibility through a local web UI.

### Major Workstreams

1. **Platform Foundation** (E001) — Monorepo, toolchain, database
2. **Domain Model** (E002) — Entities, migrations, repositories
3. **Control Plane Core** (E003, E005, E006, E007, E010) — State machines, scheduling, leases, dependencies, policies
4. **Packet Schemas** (E004) — Zod schemas for all artifact contracts
5. **Worker Runtime** (E008, E009) — Workspaces, execution adapters
6. **Quality Pipeline** (E011, E012) — Validation runner, review pipeline
7. **Integration Pipeline** (E013, E014) — Merge queue, artifact storage
8. **Audit & Observability** (E015, E016) — Audit trail, tracing, metrics
9. **API & Events** (E017, E018) — REST API, WebSocket real-time
10. **Web UI** (E019, E020) — SPA foundation, feature views
11. **Operator Actions** (E021) — Manual overrides and escalation handling
12. **Testing** (E022) — Integration and end-to-end tests

### Recommended Implementation Order

**Phase 1 (Foundation):** E001 → E002 → E004 (monorepo, schema, data model)
**Phase 2 (Core Domain):** E003 → E005, E006, E007, E010 (state machines, scheduling, leases, deps, policies)
**Phase 3 (Vertical Slice):** E008, E009, E011, E012, E013, E014, E015, E017 (workspace → worker → validation → review → merge → artifacts → audit → API)
**Phase 4 (UI & Operability):** E018, E019, E020, E021 (events, UI foundation, features, operator actions)
**Phase 5 (Hardening):** E016, E022 (observability, integration tests)

### Key Risks

- **Copilot CLI integration** — Adapter details may require experimentation (spike if needed)
- **State machine complexity** — 16 states, many transitions, complex preconditions
- **Merge pipeline** — Git operations are inherently complex with many failure modes
- **Policy resolution** — 8-layer hierarchical config with many edge cases
- **Concurrency** — SQLite provides limited concurrency; acceptable for V1 but must be tested

### Assumptions and Gaps

- **Stack assumed:** TypeScript, NestJS, Drizzle ORM, SQLite, React, Vite, Tailwind, shadcn/ui, Zod, Vitest
- **No authentication in V1** — Local-only mode, no RBAC
- **Single-node deployment** — No distributed coordination needed
- **Copilot CLI availability** — Assumes Copilot CLI is installed and accessible
- **Gap: Prompt template content** — PRD provides skeletons but not production prompts
- **Gap: External task source integration** — V1 supports manual creation only

---

## Epic Overview

| ID                                             | Title                             | Dependencies                 | Tasks |
| ---------------------------------------------- | --------------------------------- | ---------------------------- | ----- |
| [E001](epics/E001-platform-foundation.md)      | Repository & Platform Foundation  | None                         | 6     |
| [E002](epics/E002-domain-model-persistence.md) | Domain Model & Persistence        | E001                         | 8     |
| [E003](epics/E003-state-machine-transition.md) | State Machine & Transition Engine | E002                         | 5     |
| [E004](epics/E004-packet-schemas.md)           | Packet Schemas & Validation       | E001                         | 5     |
| [E005](epics/E005-job-queue-scheduling.md)     | Job Queue & Scheduling            | E002, E003                   | 5     |
| [E006](epics/E006-lease-management.md)         | Lease Management & Heartbeats     | E002, E003, E005             | 5     |
| [E007](epics/E007-dependency-readiness.md)     | Dependency & Readiness Engine     | E002, E003                   | 4     |
| [E008](epics/E008-workspace-management.md)     | Workspace Management              | E001, E002                   | 4     |
| [E009](epics/E009-worker-runtime.md)           | Worker Runtime & Execution        | E004, E005, E006, E008, E010 | 5     |
| [E010](epics/E010-policy-configuration.md)     | Policy & Configuration            | E002, E004                   | 6     |
| [E011](epics/E011-validation-runner.md)        | Validation Runner                 | E004, E010                   | 4     |
| [E012](epics/E012-review-pipeline.md)          | Review Pipeline                   | E003, E004, E005, E009, E010 | 5     |
| [E013](epics/E013-merge-pipeline.md)           | Merge Pipeline                    | E003, E005, E008, E011       | 6     |
| [E014](epics/E014-artifact-service.md)         | Artifact Service                  | E002, E004                   | 4     |
| [E015](epics/E015-audit-events.md)             | Audit & Event System              | E002, E003                   | 3     |
| [E016](epics/E016-observability.md)            | Observability                     | E001, E015                   | 4     |
| [E017](epics/E017-rest-api.md)                 | REST API Layer                    | E002, E003, E014, E015       | 6     |
| [E018](epics/E018-realtime-events.md)          | Real-time Events                  | E017                         | 3     |
| [E019](epics/E019-web-ui-foundation.md)        | Web UI Foundation                 | E017, E018                   | 4     |
| [E020](epics/E020-web-ui-features.md)          | Web UI Feature Views              | E019                         | 8     |
| [E021](epics/E021-operator-actions.md)         | Operator Actions & Overrides      | E003, E017, E020             | 5     |
| [E022](epics/E022-integration-testing.md)      | Integration Testing & E2E         | E009, E012, E013, E021       | 6     |

---

## Recommended Delivery Phases

| ID                                  | Title                               | Epics                                          | Tasks |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------- | ----- |
| [P01](phases/P01-foundation.md)     | Foundation                          | E001, E002, E004                               | 19    |
| [P02](phases/P02-core-domain.md)    | Core Domain Skeleton                | E003, E005, E006, E007, E010                   | 25    |
| [P03](phases/P03-vertical-slice.md) | First End-to-End Vertical Slice     | E008, E009, E011, E012, E013, E014, E015, E017 | 37    |
| [P04](phases/P04-ui-operability.md) | UI and Operability                  | E018, E019, E020, E021                         | 20    |
| [P05](phases/P05-hardening.md)      | Hardening and Operational Readiness | E016, E022                                     | 10    |

See [phase documents](phases/) for details.

---

## Task Summary

| ID                                                  | Title                                                                                 | Epic | Priority | Type       | Status  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | ---- | -------- | ---------- | ------- |
| [T001](tasks/T001-init-monorepo.md)                 | Initialize pnpm monorepo workspace                                                    | E001 | P0       | foundation | done    |
| [T002](tasks/T002-typescript-config.md)             | Configure TypeScript for all packages                                                 | E001 | P0       | foundation | done    |
| [T003](tasks/T003-eslint-prettier.md)               | Set up ESLint and Prettier                                                            | E001 | P0       | foundation | done    |
| [T004](tasks/T004-vitest-setup.md)                  | Set up Vitest testing framework                                                       | E001 | P0       | foundation | done    |
| [T005](tasks/T005-ci-pipeline.md)                   | Create CI pipeline with GitHub Actions                                                | E001 | P0       | infra      | done    |
| [T006](tasks/T006-sqlite-drizzle-setup.md)          | Set up SQLite with Drizzle ORM and migrations                                         | E001 | P0       | foundation | done    |
| [T007](tasks/T007-domain-enums-types.md)            | Define core domain enums and value objects                                            | E002 | P0       | foundation | done    |
| [T008](tasks/T008-migration-project-repo.md)        | Create migrations for Project, Repository, WorkflowTemplate tables                    | E002 | P0       | foundation | done    |
| [T009](tasks/T009-migration-task.md)                | Create migrations for Task and TaskDependency tables                                  | E002 | P0       | foundation | done    |
| [T010](tasks/T010-migration-worker-pool.md)         | Create migrations for WorkerPool, Worker, AgentProfile, PromptTemplate tables         | E002 | P0       | foundation | done    |
| [T011](tasks/T011-migration-lease-review.md)        | Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables | E002 | P0       | foundation | done    |
| [T012](tasks/T012-migration-merge-job.md)           | Create migrations for MergeQueueItem, ValidationRun, Job tables                       | E002 | P0       | foundation | done    |
| [T013](tasks/T013-migration-audit-policy.md)        | Create migrations for AuditEvent and PolicySet tables                                 | E002 | P0       | foundation | done    |
| [T014](tasks/T014-entity-repositories.md)           | Implement data access repositories for all entities                                   | E002 | P0       | foundation | done    |
| [T015](tasks/T015-task-state-machine.md)            | Implement Task state machine with transition validation                               | E003 | P0       | foundation | done    |
| [T016](tasks/T016-supporting-state-machines.md)     | Implement supporting state machines                                                   | E003 | P0       | foundation | done    |
| [T017](tasks/T017-transition-service.md)            | Build centralized State Transition Service                                            | E003 | P0       | foundation | done    |
| [T018](tasks/T018-atomic-transition-audit.md)       | Implement atomic transition + audit persistence                                       | E003 | P0       | foundation | done    |
| [T019](tasks/T019-optimistic-concurrency.md)        | Implement optimistic concurrency control                                              | E003 | P0       | foundation | done    |
| [T020](tasks/T020-shared-zod-types.md)              | Define shared Zod types for packets                                                   | E004 | P0       | foundation | done    |
| [T021](tasks/T021-schemas-task-dev.md)              | Define TaskPacket and DevResultPacket Zod schemas                                     | E004 | P0       | foundation | done    |
| [T022](tasks/T022-schemas-review.md)                | Define ReviewPacket and LeadReviewDecisionPacket schemas                              | E004 | P0       | foundation | done    |
| [T023](tasks/T023-schemas-merge-validation.md)      | Define remaining packet schemas                                                       | E004 | P0       | foundation | done    |
| [T024](tasks/T024-schema-cross-validation.md)       | Implement cross-field validation and schema versioning                                | E004 | P0       | foundation | done    |
| [T025](tasks/T025-job-queue-core.md)                | Implement DB-backed job queue                                                         | E005 | P0       | foundation | done    |
| [T026](tasks/T026-job-dependencies.md)              | Implement job dependency and group coordination                                       | E005 | P0       | feature    | done    |
| [T027](tasks/T027-scheduler-service.md)             | Implement Scheduler service                                                           | E005 | P0       | feature    | done    |
| [T028](tasks/T028-scheduler-tick-loop.md)           | Implement scheduler tick loop                                                         | E005 | P1       | feature    | done    |
| [T029](tasks/T029-reconciliation-sweep.md)          | Implement reconciliation sweep job                                                    | E005 | P1       | feature    | done    |
| [T030](tasks/T030-lease-acquisition.md)             | Implement lease acquisition with exclusivity                                          | E006 | P0       | feature    | done    |
| [T031](tasks/T031-heartbeat-staleness.md)           | Implement heartbeat receive and staleness detection                                   | E006 | P0       | feature    | done    |
| [T032](tasks/T032-graceful-completion.md)           | Implement graceful completion protocol                                                | E006 | P0       | feature    | done    |
| [T033](tasks/T033-lease-reclaim.md)                 | Implement stale lease reclaim and retry/escalation                                    | E006 | P0       | feature    | done    |
| [T034](tasks/T034-crash-recovery-artifacts.md)      | Implement crash recovery with partial artifact capture                                | E006 | P1       | feature    | done    |
| [T035](tasks/T035-dag-validation.md)                | Implement DAG validation with circular dependency detection                           | E007 | P0       | feature    | done    |
| [T036](tasks/T036-readiness-computation.md)         | Implement readiness computation                                                       | E007 | P0       | feature    | done    |
| [T037](tasks/T037-reverse-dep-recalc.md)            | Implement reverse-dependency recalculation                                            | E007 | P0       | feature    | done    |
| [T038](tasks/T038-dep-reconciliation.md)            | Implement dependency reconciliation loop                                              | E007 | P1       | feature    | done    |
| [T039](tasks/T039-worktree-creation.md)             | Implement git worktree creation per task                                              | E008 | P0       | feature    | done    |
| [T040](tasks/T040-workspace-mounting.md)            | Implement workspace packet and config mounting                                        | E008 | P0       | feature    | done    |
| [T041](tasks/T041-workspace-cleanup.md)             | Implement workspace cleanup for terminal states                                       | E008 | P1       | feature    | done    |
| [T042](tasks/T042-reconcile-workspaces.md)          | Implement ReconcileWorkspacesCommand                                                  | E008 | P1       | feature    | done    |
| [T043](tasks/T043-worker-runtime-interface.md)      | Define worker runtime interface                                                       | E009 | P0       | foundation | done    |
| [T044](tasks/T044-worker-supervisor.md)             | Implement Worker Supervisor                                                           | E009 | P0       | feature    | done    |
| [T045](tasks/T045-copilot-cli-adapter.md)           | Implement Copilot CLI execution adapter                                               | E009 | P0       | feature    | done    |
| [T046](tasks/T046-output-capture-validation.md)     | Implement structured output capture and validation                                    | E009 | P0       | feature    | done    |
| [T047](tasks/T047-command-wrapper.md)               | Implement policy-aware command wrapper                                                | E009 | P0       | security   | done    |
| [T048](tasks/T048-command-policy.md)                | Implement command policy model and enforcement                                        | E010 | P0       | feature    | done    |
| [T049](tasks/T049-file-scope-policy.md)             | Implement file scope policy model and enforcement                                     | E010 | P0       | feature    | done    |
| [T050](tasks/T050-validation-policy.md)             | Implement validation policy with profile selection                                    | E010 | P0       | feature    | done    |
| [T051](tasks/T051-retry-escalation-policy.md)       | Implement retry and escalation policy evaluation                                      | E010 | P0       | feature    | done    |
| [T052](tasks/T052-hierarchical-config.md)           | Implement hierarchical configuration resolution                                       | E010 | P0       | feature    | done    |
| [T053](tasks/T053-policy-snapshot.md)               | Implement effective policy snapshot generation                                        | E010 | P0       | feature    | done    |
| [T054](tasks/T054-validation-runner-abstraction.md) | Implement validation runner abstraction                                               | E011 | P0       | feature    | done    |
| [T055](tasks/T055-validation-command-exec.md)       | Implement test/lint/build command execution                                           | E011 | P0       | feature    | done    |
| [T056](tasks/T056-validation-packet-emission.md)    | Implement ValidationResultPacket emission                                             | E011 | P0       | feature    | done    |
| [T057](tasks/T057-validation-gates.md)              | Implement validation gate checking for state transitions                              | E011 | P0       | feature    | done    |
| [T058](tasks/T058-review-router.md)                 | Implement Review Router with deterministic rules                                      | E012 | P0       | feature    | done    |
| [T059](tasks/T059-reviewer-dispatch.md)             | Implement specialist reviewer job dispatch                                            | E012 | P0       | feature    | done    |
| [T060](tasks/T060-lead-reviewer-dispatch.md)        | Implement lead reviewer dispatch with dependencies                                    | E012 | P0       | feature    | done    |
| [T061](tasks/T061-review-decision-apply.md)         | Implement review decision application                                                 | E012 | P0       | feature    | done    |
| [T062](tasks/T062-rework-loop.md)                   | Implement rework loop with rejection context                                          | E012 | P1       | feature    | done    |
| [T063](tasks/T063-merge-queue.md)                   | Implement merge queue with ordering contract                                          | E013 | P0       | feature    | done    |
| [T064](tasks/T064-rebase-merge-exec.md)             | Implement rebase-and-merge execution                                                  | E013 | P0       | feature    | done    |
| [T065](tasks/T065-merge-strategies.md)              | Implement squash and merge-commit strategies                                          | E013 | P1       | feature    | done    |
| [T066](tasks/T066-conflict-classification.md)       | Implement merge conflict classification                                               | E013 | P0       | feature    | done    |
| [T067](tasks/T067-post-merge-failure.md)            | Implement post-merge validation and failure policy                                    | E013 | P0       | feature    | done    |
| [T068](tasks/T068-followup-task-gen.md)             | Implement follow-up task generation                                                   | E013 | P1       | feature    | done    |
| [T069](tasks/T069-artifact-storage.md)              | Implement filesystem artifact storage                                                 | E014 | P0       | feature    | done    |
| [T070](tasks/T070-artifact-retrieval.md)            | Implement artifact reference resolution and retrieval                                 | E014 | P0       | feature    | done    |
| [T071](tasks/T071-retry-summarization.md)           | Implement summarization packet generation for retries                                 | E014 | P1       | feature    | done    |
| [T072](tasks/T072-partial-work-snapshot.md)         | Implement partial work snapshot on lease reclaim                                      | E014 | P1       | feature    | done    |
| [T073](tasks/T073-audit-event-recording.md)         | Implement audit event recording on state transitions                                  | E015 | P0       | feature    | done    |
| [T074](tasks/T074-audit-query-service.md)           | Implement audit event query service                                                   | E015 | P1       | feature    | done    |
| [T075](tasks/T075-structured-logging.md)            | Implement structured logging with correlation IDs                                     | E015 | P1       | feature    | done    |
| [T076](tasks/T076-otel-init.md)                     | Initialize OpenTelemetry TracerProvider                                               | E016 | P1       | feature    | done    |
| [T077](tasks/T077-otel-spans.md)                    | Instrument core orchestration paths with spans                                        | E016 | P1       | feature    | done    |
| [T078](tasks/T078-prometheus-endpoint.md)           | Implement Prometheus metrics endpoint                                                 | E016 | P1       | feature    | done    |
| [T079](tasks/T079-starter-metrics.md)               | Implement starter metrics inventory                                                   | E016 | P1       | feature    | done    |
| [T080](tasks/T080-nestjs-bootstrap.md)              | Implement NestJS application bootstrap and module structure                           | E017 | P0       | foundation | done    |
| [T081](tasks/T081-api-project-repo.md)              | Implement Project and Repository CRUD endpoints                                       | E017 | P0       | feature    | done    |
| [T082](tasks/T082-api-task-management.md)           | Implement Task management endpoints                                                   | E017 | P0       | feature    | done    |
| [T083](tasks/T083-api-worker-pool.md)               | Implement WorkerPool and AgentProfile endpoints                                       | E017 | P1       | feature    | done    |
| [T084](tasks/T084-api-artifacts-reviews.md)         | Implement Artifact and Review packet retrieval endpoints                              | E017 | P1       | feature    | done    |
| [T085](tasks/T085-api-audit-policy-config.md)       | Implement Audit, Policy, and Config endpoints                                         | E017 | P1       | feature    | done    |
| [T086](tasks/T086-websocket-gateway.md)             | Implement WebSocket gateway for live events                                           | E018 | P1       | feature    | done    |
| [T087](tasks/T087-task-events.md)                   | Implement task state change event broadcasting                                        | E018 | P1       | feature    | done    |
| [T088](tasks/T088-queue-worker-events.md)           | Implement queue and worker status broadcasting                                        | E018 | P2       | feature    | done    |
| [T089](tasks/T089-react-spa-init.md)                | Initialize React SPA with Vite, Tailwind, shadcn/ui                                   | E019 | P1       | foundation | done    |
| [T090](tasks/T090-api-client-tanstack.md)           | Implement API client layer with TanStack Query                                        | E019 | P1       | feature    | done    |
| [T091](tasks/T091-websocket-client.md)              | Implement WebSocket client for live updates                                           | E019 | P1       | feature    | done    |
| [T092](tasks/T092-app-shell.md)                     | Build app shell with navigation layout                                                | E019 | P1       | feature    | done    |
| [T093](tasks/T093-ui-dashboard.md)                  | Build dashboard view with system health summary                                       | E020 | P1       | feature    | done    |
| [T094](tasks/T094-ui-task-board.md)                 | Build task board with status filtering and pagination                                 | E020 | P1       | feature    | done    |
| [T095](tasks/T095-ui-task-detail.md)                | Build task detail timeline view                                                       | E020 | P1       | feature    | done    |
| [T096](tasks/T096-ui-worker-pools.md)               | Build worker pool monitoring panel                                                    | E020 | P2       | feature    | pending |
| [T097](tasks/T097-ui-review-center.md)              | Build review center view                                                              | E020 | P2       | feature    | pending |
| [T098](tasks/T098-ui-merge-queue.md)                | Build merge queue view                                                                | E020 | P2       | feature    | done    |
| [T099](tasks/T099-ui-config-editor.md)              | Build configuration editor view                                                       | E020 | P2       | feature    | pending |
| [T100](tasks/T100-ui-audit-explorer.md)             | Build audit explorer view                                                             | E020 | P2       | feature    | pending |
| [T101](tasks/T101-api-operator-actions.md)          | Implement operator action API endpoints                                               | E021 | P1       | feature    | done    |
| [T102](tasks/T102-operator-guards.md)               | Implement state transition guards for manual actions                                  | E021 | P1       | feature    | done    |
| [T103](tasks/T103-escalation-resolution.md)         | Implement escalation resolution flow                                                  | E021 | P1       | feature    | done    |
| [T104](tasks/T104-ui-operator-task.md)              | Integrate operator controls into task detail UI                                       | E021 | P2       | feature    | pending |
| [T105](tasks/T105-ui-operator-pool-merge.md)        | Integrate operator controls into pool and merge queue UI                              | E021 | P2       | feature    | pending |
| [T106](tasks/T106-test-harness.md)                  | Create test harness with fake runner and workspace                                    | E022 | P0       | test       | done    |
| [T107](tasks/T107-e2e-full-lifecycle.md)            | Integration test: full task lifecycle BACKLOG to DONE                                 | E022 | P0       | test       | done    |
| [T108](tasks/T108-e2e-review-rework.md)             | Integration test: review rejection and rework loop                                    | E022 | P0       | test       | done    |
| [T109](tasks/T109-e2e-merge-failures.md)            | Integration test: merge conflict and failure paths                                    | E022 | P1       | test       | done    |
| [T110](tasks/T110-e2e-lease-recovery.md)            | Integration test: lease timeout and crash recovery                                    | E022 | P1       | test       | done    |
| [T111](tasks/T111-e2e-escalation.md)                | Integration test: escalation triggers and resolution                                  | E022 | P1       | test       | done    |

---

## Dependency Highlights

### Epic Dependencies

```
E001 (Platform Foundation)
  └─► E002 (Domain Model) ─► E003 (State Machines) ─► E005 (Job Queue)
  │                       └─► E007 (Dependencies)     └─► E006 (Leases) ─► E009 (Worker Runtime)
  │                       └─► E010 (Policies) ─────────────────────────────►┘
  └─► E004 (Packet Schemas) ─► E009 ─► E012 (Review Pipeline) ─► E013 (Merge Pipeline)
  │                          └─► E011 (Validation Runner) ────────►┘
  └─► E008 (Workspaces) ─► E009

E002 + E003 + E014 + E015 ─► E017 (REST API) ─► E018 (Events) ─► E019 (UI Foundation) ─► E020 (UI Features)
                                                                                         └─► E021 (Operator Actions)
E009 + E012 + E013 + E021 ─► E022 (Integration Tests)
```

### Critical Path

T001 → T002 → T006 → T009 → T014 → T015 → T017 → T027 → T030 → T044 → T045 → T107

---

## Ready-Now Tasks

Tasks with no dependencies that can start immediately:

- [T001](tasks/T001-init-monorepo.md): Initialize pnpm monorepo workspace

## High-Priority (P0) Tasks

- [T001](tasks/T001-init-monorepo.md): Initialize pnpm monorepo workspace
- [T002](tasks/T002-typescript-config.md): Configure TypeScript for all packages
- [T003](tasks/T003-eslint-prettier.md): Set up ESLint and Prettier
- [T004](tasks/T004-vitest-setup.md): Set up Vitest testing framework
- [T005](tasks/T005-ci-pipeline.md): Create CI pipeline with GitHub Actions
- [T006](tasks/T006-sqlite-drizzle-setup.md): Set up SQLite with Drizzle ORM and migrations
- [T007](tasks/T007-domain-enums-types.md): Define core domain enums and value objects
- [T008](tasks/T008-migration-project-repo.md): Create migrations for Project, Repository, WorkflowTemplate tables
- [T009](tasks/T009-migration-task.md): Create migrations for Task and TaskDependency tables
- [T010](tasks/T010-migration-worker-pool.md): Create migrations for WorkerPool, Worker, AgentProfile, PromptTemplate tables
- [T011](tasks/T011-migration-lease-review.md): Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables
- [T012](tasks/T012-migration-merge-job.md): Create migrations for MergeQueueItem, ValidationRun, Job tables
- [T013](tasks/T013-migration-audit-policy.md): Create migrations for AuditEvent and PolicySet tables
- [T014](tasks/T014-entity-repositories.md): Implement data access repositories for all entities
- [T015](tasks/T015-task-state-machine.md): Implement Task state machine with transition validation
- [T016](tasks/T016-supporting-state-machines.md): Implement supporting state machines
- [T017](tasks/T017-transition-service.md): Build centralized State Transition Service
- [T018](tasks/T018-atomic-transition-audit.md): Implement atomic transition + audit persistence
- [T019](tasks/T019-optimistic-concurrency.md): Implement optimistic concurrency control
- [T020](tasks/T020-shared-zod-types.md): Define shared Zod types for packets
- [T021](tasks/T021-schemas-task-dev.md): Define TaskPacket and DevResultPacket Zod schemas
- [T022](tasks/T022-schemas-review.md): Define ReviewPacket and LeadReviewDecisionPacket schemas
- [T023](tasks/T023-schemas-merge-validation.md): Define remaining packet schemas
- [T024](tasks/T024-schema-cross-validation.md): Implement cross-field validation and schema versioning
- [T025](tasks/T025-job-queue-core.md): Implement DB-backed job queue
- [T026](tasks/T026-job-dependencies.md): Implement job dependency and group coordination
- [T027](tasks/T027-scheduler-service.md): Implement Scheduler service
- [T030](tasks/T030-lease-acquisition.md): Implement lease acquisition with exclusivity
- [T031](tasks/T031-heartbeat-staleness.md): Implement heartbeat receive and staleness detection
- [T032](tasks/T032-graceful-completion.md): Implement graceful completion protocol
- [T033](tasks/T033-lease-reclaim.md): Implement stale lease reclaim and retry/escalation
- [T035](tasks/T035-dag-validation.md): Implement DAG validation with circular dependency detection
- [T036](tasks/T036-readiness-computation.md): Implement readiness computation
- [T037](tasks/T037-reverse-dep-recalc.md): Implement reverse-dependency recalculation
- [T039](tasks/T039-worktree-creation.md): Implement git worktree creation per task
- [T040](tasks/T040-workspace-mounting.md): Implement workspace packet and config mounting
- [T043](tasks/T043-worker-runtime-interface.md): Define worker runtime interface
- [T044](tasks/T044-worker-supervisor.md): Implement Worker Supervisor
- [T045](tasks/T045-copilot-cli-adapter.md): Implement Copilot CLI execution adapter
- [T046](tasks/T046-output-capture-validation.md): Implement structured output capture and validation
- [T047](tasks/T047-command-wrapper.md): Implement policy-aware command wrapper
- [T048](tasks/T048-command-policy.md): Implement command policy model and enforcement
- [T049](tasks/T049-file-scope-policy.md): Implement file scope policy model and enforcement
- [T050](tasks/T050-validation-policy.md): Implement validation policy with profile selection
- [T051](tasks/T051-retry-escalation-policy.md): Implement retry and escalation policy evaluation
- [T052](tasks/T052-hierarchical-config.md): Implement hierarchical configuration resolution
- [T053](tasks/T053-policy-snapshot.md): Implement effective policy snapshot generation
- [T054](tasks/T054-validation-runner-abstraction.md): Implement validation runner abstraction
- [T055](tasks/T055-validation-command-exec.md): Implement test/lint/build command execution
- [T056](tasks/T056-validation-packet-emission.md): Implement ValidationResultPacket emission
- [T057](tasks/T057-validation-gates.md): Implement validation gate checking for state transitions
- [T058](tasks/T058-review-router.md): Implement Review Router with deterministic rules
- [T059](tasks/T059-reviewer-dispatch.md): Implement specialist reviewer job dispatch
- [T060](tasks/T060-lead-reviewer-dispatch.md): Implement lead reviewer dispatch with dependencies
- [T061](tasks/T061-review-decision-apply.md): Implement review decision application
- [T063](tasks/T063-merge-queue.md): Implement merge queue with ordering contract
- [T064](tasks/T064-rebase-merge-exec.md): Implement rebase-and-merge execution
- [T066](tasks/T066-conflict-classification.md): Implement merge conflict classification
- [T067](tasks/T067-post-merge-failure.md): Implement post-merge validation and failure policy
- [T069](tasks/T069-artifact-storage.md): Implement filesystem artifact storage
- [T070](tasks/T070-artifact-retrieval.md): Implement artifact reference resolution and retrieval
- [T073](tasks/T073-audit-event-recording.md): Implement audit event recording on state transitions
- [T080](tasks/T080-nestjs-bootstrap.md): Implement NestJS application bootstrap and module structure
- [T081](tasks/T081-api-project-repo.md): Implement Project and Repository CRUD endpoints
- [T082](tasks/T082-api-task-management.md): Implement Task management endpoints
- [T106](tasks/T106-test-harness.md): Create test harness with fake runner and workspace
- [T107](tasks/T107-e2e-full-lifecycle.md): Integration test: full task lifecycle BACKLOG to DONE
- [T108](tasks/T108-e2e-review-rework.md): Integration test: review rejection and rework loop

## Most-Blocked Tasks

Tasks with the most dependencies (work toward unblocking these):

- [T014](tasks/T014-entity-repositories.md): Implement data access repositories for all entities (blocked by: T008, T009, T010, T011, T012, T013)
- [T053](tasks/T053-policy-snapshot.md): Implement effective policy snapshot generation (blocked by: T048, T049, T050, T051, T052)
- [T107](tasks/T107-e2e-full-lifecycle.md): Integration test: full task lifecycle BACKLOG to DONE (blocked by: T106, T046, T057, T061, T064)
- [T044](tasks/T044-worker-supervisor.md): Implement Worker Supervisor (blocked by: T030, T039, T040, T043)
- [T009](tasks/T009-migration-task.md): Create migrations for Task and TaskDependency tables (blocked by: T006, T007, T008)
- [T011](tasks/T011-migration-lease-review.md): Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables (blocked by: T006, T007, T009)
- [T012](tasks/T012-migration-merge-job.md): Create migrations for MergeQueueItem, ValidationRun, Job tables (blocked by: T006, T007, T009)
- [T017](tasks/T017-transition-service.md): Build centralized State Transition Service (blocked by: T015, T016, T014)
- [T024](tasks/T024-schema-cross-validation.md): Implement cross-field validation and schema versioning (blocked by: T021, T022, T023)
- [T027](tasks/T027-scheduler-service.md): Implement Scheduler service (blocked by: T014, T017, T025)

---

## Links

- [Agent Execution Guidance](agents/execution-rules.md)
- [Machine-Readable Backlog](backlog.json)
- **Phase Docs:** [P01](phases/P01-foundation.md), [P02](phases/P02-core-domain.md), [P03](phases/P03-vertical-slice.md), [P04](phases/P04-ui-operability.md), [P05](phases/P05-hardening.md)
- **Source PRDs:** `docs/prd/001-architecture.md` through `docs/prd/010-integration-contracts.md`
