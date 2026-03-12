# Autonomous Software Factory — Completed Epics Archive

This file contains all completed epics and their tasks, moved from [index.md](index.md) to keep the active backlog focused.

---

## Completed Epic Overview

| ID                                             | Title                             | Dependencies                 | Tasks | Status  |
| ---------------------------------------------- | --------------------------------- | ---------------------------- | ----- | ------- |
| [E001](epics/E001-platform-foundation.md)      | Repository & Platform Foundation  | None                         | 6     | ✅ done |
| [E002](epics/E002-domain-model-persistence.md) | Domain Model & Persistence        | E001                         | 8     | ✅ done |
| [E003](epics/E003-state-machine-transition.md) | State Machine & Transition Engine | E002                         | 5     | ✅ done |
| [E004](epics/E004-packet-schemas.md)           | Packet Schemas & Validation       | E001                         | 5     | ✅ done |
| [E005](epics/E005-job-queue-scheduling.md)     | Job Queue & Scheduling            | E002, E003                   | 5     | ✅ done |
| [E006](epics/E006-lease-management.md)         | Lease Management & Heartbeats     | E002, E003, E005             | 5     | ✅ done |
| [E007](epics/E007-dependency-readiness.md)     | Dependency & Readiness Engine     | E002, E003                   | 4     | ✅ done |
| [E008](epics/E008-workspace-management.md)     | Workspace Management              | E001, E002                   | 4     | ✅ done |
| [E010](epics/E010-policy-configuration.md)     | Policy & Configuration            | E002, E004                   | 6     | ✅ done |
| [E011](epics/E011-validation-runner.md)        | Validation Runner                 | E004, E010                   | 4     | ✅ done |
| [E012](epics/E012-review-pipeline.md)          | Review Pipeline                   | E003, E004, E005, E009, E010 | 5     | ✅ done |
| [E013](epics/E013-merge-pipeline.md)           | Merge Pipeline                    | E003, E005, E008, E011       | 6     | ✅ done |
| [E014](epics/E014-artifact-service.md)         | Artifact Service                  | E002, E004                   | 4     | ✅ done |
| [E015](epics/E015-audit-events.md)             | Audit & Event System              | E002, E003                   | 3     | ✅ done |
| [E016](epics/E016-observability.md)            | Observability                     | E001, E015                   | 4     | ✅ done |
| [E017](epics/E017-rest-api.md)                 | REST API Layer                    | E002, E003, E014, E015       | 6     | ✅ done |
| [E018](epics/E018-realtime-events.md)          | Real-time Events                  | E017                         | 3     | ✅ done |
| [E019](epics/E019-web-ui-foundation.md)        | Web UI Foundation                 | E017, E018                   | 4     | ✅ done |
| [E020](epics/E020-web-ui-features.md)          | Web UI Feature Views              | E019                         | 8     | ✅ done |
| [E021](epics/E021-operator-actions.md)         | Operator Actions & Overrides      | E003, E017, E020             | 5     | ✅ done |
| [E022](epics/E022-integration-testing.md)      | Integration Testing & E2E         | E009, E012, E013, E021       | 6     | ✅ done |

**Total: 21 epics, 106 tasks — all done.**

---

## Delivery Phases (completed)

| ID                                  | Title                               | Epics                                            | Tasks | Status  |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------ | ----- | ------- |
| [P01](phases/P01-foundation.md)     | Foundation                          | E001, E002, E004                                 | 19    | ✅ done |
| [P02](phases/P02-core-domain.md)    | Core Domain Skeleton                | E003, E005, E006, E007, E010                     | 25    | ✅ done |
| [P03](phases/P03-vertical-slice.md) | First End-to-End Vertical Slice     | E008, E009\*, E011, E012, E013, E014, E015, E017 | 37    | partial |
| [P04](phases/P04-ui-operability.md) | UI and Operability                  | E018, E019, E020, E021                           | 20    | ✅ done |
| [P05](phases/P05-hardening.md)      | Hardening and Operational Readiness | E016, E022                                       | 10    | ✅ done |

\* E009 has 5 original tasks done but 8 new dispatch tasks added (tracked in [index.md](index.md)).

---

## Completed Task Summary

### E001: Repository & Platform Foundation (6/6 done)

| ID                                         | Title                                         | Priority | Type       | Status |
| ------------------------------------------ | --------------------------------------------- | -------- | ---------- | ------ |
| [T001](tasks/T001-init-monorepo.md)        | Initialize pnpm monorepo workspace            | P0       | foundation | done   |
| [T002](tasks/T002-typescript-config.md)    | Configure TypeScript for all packages         | P0       | foundation | done   |
| [T003](tasks/T003-eslint-prettier.md)      | Set up ESLint and Prettier                    | P0       | foundation | done   |
| [T004](tasks/T004-vitest-setup.md)         | Set up Vitest testing framework               | P0       | foundation | done   |
| [T005](tasks/T005-ci-pipeline.md)          | Create CI pipeline with GitHub Actions        | P0       | infra      | done   |
| [T006](tasks/T006-sqlite-drizzle-setup.md) | Set up SQLite with Drizzle ORM and migrations | P0       | foundation | done   |

### E002: Domain Model & Persistence (8/8 done)

| ID                                           | Title                                                                                 | Priority | Type       | Status |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | -------- | ---------- | ------ |
| [T007](tasks/T007-domain-enums-types.md)     | Define core domain enums and value objects                                            | P0       | foundation | done   |
| [T008](tasks/T008-migration-project-repo.md) | Create migrations for Project, Repository, WorkflowTemplate tables                    | P0       | foundation | done   |
| [T009](tasks/T009-migration-task.md)         | Create migrations for Task and TaskDependency tables                                  | P0       | foundation | done   |
| [T010](tasks/T010-migration-worker-pool.md)  | Create migrations for WorkerPool, Worker, AgentProfile, PromptTemplate tables         | P0       | foundation | done   |
| [T011](tasks/T011-migration-lease-review.md) | Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables | P0       | foundation | done   |
| [T012](tasks/T012-migration-merge-job.md)    | Create migrations for MergeQueueItem, ValidationRun, Job tables                       | P0       | foundation | done   |
| [T013](tasks/T013-migration-audit-policy.md) | Create migrations for AuditEvent and PolicySet tables                                 | P0       | foundation | done   |
| [T014](tasks/T014-entity-repositories.md)    | Implement data access repositories for all entities                                   | P0       | foundation | done   |

### E003: State Machine & Transition Engine (5/5 done)

| ID                                              | Title                                                   | Priority | Type       | Status |
| ----------------------------------------------- | ------------------------------------------------------- | -------- | ---------- | ------ |
| [T015](tasks/T015-task-state-machine.md)        | Implement Task state machine with transition validation | P0       | foundation | done   |
| [T016](tasks/T016-supporting-state-machines.md) | Implement supporting state machines                     | P0       | foundation | done   |
| [T017](tasks/T017-transition-service.md)        | Build centralized State Transition Service              | P0       | foundation | done   |
| [T018](tasks/T018-atomic-transition-audit.md)   | Implement atomic transition + audit persistence         | P0       | foundation | done   |
| [T019](tasks/T019-optimistic-concurrency.md)    | Implement optimistic concurrency control                | P0       | foundation | done   |

### E004: Packet Schemas & Validation (5/5 done)

| ID                                             | Title                                                    | Priority | Type       | Status |
| ---------------------------------------------- | -------------------------------------------------------- | -------- | ---------- | ------ |
| [T020](tasks/T020-shared-zod-types.md)         | Define shared Zod types for packets                      | P0       | foundation | done   |
| [T021](tasks/T021-schemas-task-dev.md)         | Define TaskPacket and DevResultPacket Zod schemas        | P0       | foundation | done   |
| [T022](tasks/T022-schemas-review.md)           | Define ReviewPacket and LeadReviewDecisionPacket schemas | P0       | foundation | done   |
| [T023](tasks/T023-schemas-merge-validation.md) | Define remaining packet schemas                          | P0       | foundation | done   |
| [T024](tasks/T024-schema-cross-validation.md)  | Implement cross-field validation and schema versioning   | P0       | foundation | done   |

### E005: Job Queue & Scheduling (5/5 done)

| ID                                         | Title                                           | Priority | Type       | Status |
| ------------------------------------------ | ----------------------------------------------- | -------- | ---------- | ------ |
| [T025](tasks/T025-job-queue-core.md)       | Implement DB-backed job queue                   | P0       | foundation | done   |
| [T026](tasks/T026-job-dependencies.md)     | Implement job dependency and group coordination | P0       | feature    | done   |
| [T027](tasks/T027-scheduler-service.md)    | Implement Scheduler service                     | P0       | feature    | done   |
| [T028](tasks/T028-scheduler-tick-loop.md)  | Implement scheduler tick loop                   | P1       | feature    | done   |
| [T029](tasks/T029-reconciliation-sweep.md) | Implement reconciliation sweep job              | P1       | feature    | done   |

### E006: Lease Management & Heartbeats (5/5 done)

| ID                                             | Title                                                  | Priority | Type    | Status |
| ---------------------------------------------- | ------------------------------------------------------ | -------- | ------- | ------ |
| [T030](tasks/T030-lease-acquisition.md)        | Implement lease acquisition with exclusivity           | P0       | feature | done   |
| [T031](tasks/T031-heartbeat-staleness.md)      | Implement heartbeat receive and staleness detection    | P0       | feature | done   |
| [T032](tasks/T032-graceful-completion.md)      | Implement graceful completion protocol                 | P0       | feature | done   |
| [T033](tasks/T033-lease-reclaim.md)            | Implement stale lease reclaim and retry/escalation     | P0       | feature | done   |
| [T034](tasks/T034-crash-recovery-artifacts.md) | Implement crash recovery with partial artifact capture | P1       | feature | done   |

### E007: Dependency & Readiness Engine (4/4 done)

| ID                                          | Title                                                       | Priority | Type    | Status |
| ------------------------------------------- | ----------------------------------------------------------- | -------- | ------- | ------ |
| [T035](tasks/T035-dag-validation.md)        | Implement DAG validation with circular dependency detection | P0       | feature | done   |
| [T036](tasks/T036-readiness-computation.md) | Implement readiness computation                             | P0       | feature | done   |
| [T037](tasks/T037-reverse-dep-recalc.md)    | Implement reverse-dependency recalculation                  | P0       | feature | done   |
| [T038](tasks/T038-dep-reconciliation.md)    | Implement dependency reconciliation loop                    | P1       | feature | done   |

### E008: Workspace Management (4/4 done)

| ID                                         | Title                                           | Priority | Type    | Status |
| ------------------------------------------ | ----------------------------------------------- | -------- | ------- | ------ |
| [T039](tasks/T039-worktree-creation.md)    | Implement git worktree creation per task        | P0       | feature | done   |
| [T040](tasks/T040-workspace-mounting.md)   | Implement workspace packet and config mounting  | P0       | feature | done   |
| [T041](tasks/T041-workspace-cleanup.md)    | Implement workspace cleanup for terminal states | P1       | feature | done   |
| [T042](tasks/T042-reconcile-workspaces.md) | Implement ReconcileWorkspacesCommand            | P1       | feature | done   |

### E010: Policy & Configuration (6/6 done)

| ID                                            | Title                                              | Priority | Type    | Status |
| --------------------------------------------- | -------------------------------------------------- | -------- | ------- | ------ |
| [T048](tasks/T048-command-policy.md)          | Implement command policy model and enforcement     | P0       | feature | done   |
| [T049](tasks/T049-file-scope-policy.md)       | Implement file scope policy model and enforcement  | P0       | feature | done   |
| [T050](tasks/T050-validation-policy.md)       | Implement validation policy with profile selection | P0       | feature | done   |
| [T051](tasks/T051-retry-escalation-policy.md) | Implement retry and escalation policy evaluation   | P0       | feature | done   |
| [T052](tasks/T052-hierarchical-config.md)     | Implement hierarchical configuration resolution    | P0       | feature | done   |
| [T053](tasks/T053-policy-snapshot.md)         | Implement effective policy snapshot generation     | P0       | feature | done   |

### E011: Validation Runner (4/4 done)

| ID                                                  | Title                                                    | Priority | Type    | Status |
| --------------------------------------------------- | -------------------------------------------------------- | -------- | ------- | ------ |
| [T054](tasks/T054-validation-runner-abstraction.md) | Implement validation runner abstraction                  | P0       | feature | done   |
| [T055](tasks/T055-validation-command-exec.md)       | Implement test/lint/build command execution              | P0       | feature | done   |
| [T056](tasks/T056-validation-packet-emission.md)    | Implement ValidationResultPacket emission                | P0       | feature | done   |
| [T057](tasks/T057-validation-gates.md)              | Implement validation gate checking for state transitions | P0       | feature | done   |

### E012: Review Pipeline (5/5 done)

| ID                                           | Title                                              | Priority | Type    | Status |
| -------------------------------------------- | -------------------------------------------------- | -------- | ------- | ------ |
| [T058](tasks/T058-review-router.md)          | Implement Review Router with deterministic rules   | P0       | feature | done   |
| [T059](tasks/T059-reviewer-dispatch.md)      | Implement specialist reviewer job dispatch         | P0       | feature | done   |
| [T060](tasks/T060-lead-reviewer-dispatch.md) | Implement lead reviewer dispatch with dependencies | P0       | feature | done   |
| [T061](tasks/T061-review-decision-apply.md)  | Implement review decision application              | P0       | feature | done   |
| [T062](tasks/T062-rework-loop.md)            | Implement rework loop with rejection context       | P1       | feature | done   |

### E013: Merge Pipeline (6/6 done)

| ID                                            | Title                                              | Priority | Type    | Status |
| --------------------------------------------- | -------------------------------------------------- | -------- | ------- | ------ |
| [T063](tasks/T063-merge-queue.md)             | Implement merge queue with ordering contract       | P0       | feature | done   |
| [T064](tasks/T064-rebase-merge-exec.md)       | Implement rebase-and-merge execution               | P0       | feature | done   |
| [T065](tasks/T065-merge-strategies.md)        | Implement squash and merge-commit strategies       | P1       | feature | done   |
| [T066](tasks/T066-conflict-classification.md) | Implement merge conflict classification            | P0       | feature | done   |
| [T067](tasks/T067-post-merge-failure.md)      | Implement post-merge validation and failure policy | P0       | feature | done   |
| [T068](tasks/T068-followup-task-gen.md)       | Implement follow-up task generation                | P1       | feature | done   |

### E014: Artifact Service (4/4 done)

| ID                                          | Title                                                 | Priority | Type    | Status |
| ------------------------------------------- | ----------------------------------------------------- | -------- | ------- | ------ |
| [T069](tasks/T069-artifact-storage.md)      | Implement filesystem artifact storage                 | P0       | feature | done   |
| [T070](tasks/T070-artifact-retrieval.md)    | Implement artifact reference resolution and retrieval | P0       | feature | done   |
| [T071](tasks/T071-retry-summarization.md)   | Implement summarization packet generation for retries | P1       | feature | done   |
| [T072](tasks/T072-partial-work-snapshot.md) | Implement partial work snapshot on lease reclaim      | P1       | feature | done   |

### E015: Audit & Event System (3/3 done)

| ID                                          | Title                                                | Priority | Type    | Status |
| ------------------------------------------- | ---------------------------------------------------- | -------- | ------- | ------ |
| [T073](tasks/T073-audit-event-recording.md) | Implement audit event recording on state transitions | P0       | feature | done   |
| [T074](tasks/T074-audit-query-service.md)   | Implement audit event query service                  | P1       | feature | done   |
| [T075](tasks/T075-structured-logging.md)    | Implement structured logging with correlation IDs    | P1       | feature | done   |

### E016: Observability (4/4 done)

| ID                                        | Title                                          | Priority | Type    | Status |
| ----------------------------------------- | ---------------------------------------------- | -------- | ------- | ------ |
| [T076](tasks/T076-otel-init.md)           | Initialize OpenTelemetry TracerProvider        | P1       | feature | done   |
| [T077](tasks/T077-otel-spans.md)          | Instrument core orchestration paths with spans | P1       | feature | done   |
| [T078](tasks/T078-prometheus-endpoint.md) | Implement Prometheus metrics endpoint          | P1       | feature | done   |
| [T079](tasks/T079-starter-metrics.md)     | Implement starter metrics inventory            | P1       | feature | done   |

### E017: REST API Layer (6/6 done)

| ID                                            | Title                                                       | Priority | Type       | Status |
| --------------------------------------------- | ----------------------------------------------------------- | -------- | ---------- | ------ |
| [T080](tasks/T080-nestjs-bootstrap.md)        | Implement NestJS application bootstrap and module structure | P0       | foundation | done   |
| [T081](tasks/T081-api-project-repo.md)        | Implement Project and Repository CRUD endpoints             | P0       | feature    | done   |
| [T082](tasks/T082-api-task-management.md)     | Implement Task management endpoints                         | P0       | feature    | done   |
| [T083](tasks/T083-api-worker-pool.md)         | Implement WorkerPool and AgentProfile endpoints             | P1       | feature    | done   |
| [T084](tasks/T084-api-artifacts-reviews.md)   | Implement Artifact and Review packet retrieval endpoints    | P1       | feature    | done   |
| [T085](tasks/T085-api-audit-policy-config.md) | Implement Audit, Policy, and Config endpoints               | P1       | feature    | done   |

### E018: Real-time Events (3/3 done)

| ID                                        | Title                                          | Priority | Type    | Status |
| ----------------------------------------- | ---------------------------------------------- | -------- | ------- | ------ |
| [T086](tasks/T086-websocket-gateway.md)   | Implement WebSocket gateway for live events    | P1       | feature | done   |
| [T087](tasks/T087-task-events.md)         | Implement task state change event broadcasting | P1       | feature | done   |
| [T088](tasks/T088-queue-worker-events.md) | Implement queue and worker status broadcasting | P2       | feature | done   |

### E019: Web UI Foundation (4/4 done)

| ID                                        | Title                                               | Priority | Type       | Status |
| ----------------------------------------- | --------------------------------------------------- | -------- | ---------- | ------ |
| [T089](tasks/T089-react-spa-init.md)      | Initialize React SPA with Vite, Tailwind, shadcn/ui | P1       | foundation | done   |
| [T090](tasks/T090-api-client-tanstack.md) | Implement API client layer with TanStack Query      | P1       | feature    | done   |
| [T091](tasks/T091-websocket-client.md)    | Implement WebSocket client for live updates         | P1       | feature    | done   |
| [T092](tasks/T092-app-shell.md)           | Build app shell with navigation layout              | P1       | feature    | done   |

### E020: Web UI Feature Views (8/8 done)

| ID                                      | Title                                                 | Priority | Type    | Status |
| --------------------------------------- | ----------------------------------------------------- | -------- | ------- | ------ |
| [T093](tasks/T093-ui-dashboard.md)      | Build dashboard view with system health summary       | P1       | feature | done   |
| [T094](tasks/T094-ui-task-board.md)     | Build task board with status filtering and pagination | P1       | feature | done   |
| [T095](tasks/T095-ui-task-detail.md)    | Build task detail timeline view                       | P1       | feature | done   |
| [T096](tasks/T096-ui-worker-pools.md)   | Build worker pool monitoring panel                    | P2       | feature | done   |
| [T097](tasks/T097-ui-review-center.md)  | Build review center view                              | P2       | feature | done   |
| [T098](tasks/T098-ui-merge-queue.md)    | Build merge queue view                                | P2       | feature | done   |
| [T099](tasks/T099-ui-config-editor.md)  | Build configuration editor view                       | P2       | feature | done   |
| [T100](tasks/T100-ui-audit-explorer.md) | Build audit explorer view                             | P2       | feature | done   |

### E021: Operator Actions & Overrides (5/5 done)

| ID                                           | Title                                                    | Priority | Type    | Status |
| -------------------------------------------- | -------------------------------------------------------- | -------- | ------- | ------ |
| [T101](tasks/T101-api-operator-actions.md)   | Implement operator action API endpoints                  | P1       | feature | done   |
| [T102](tasks/T102-operator-guards.md)        | Implement state transition guards for manual actions     | P1       | feature | done   |
| [T103](tasks/T103-escalation-resolution.md)  | Implement escalation resolution flow                     | P1       | feature | done   |
| [T104](tasks/T104-ui-operator-task.md)       | Integrate operator controls into task detail UI          | P2       | feature | done   |
| [T105](tasks/T105-ui-operator-pool-merge.md) | Integrate operator controls into pool and merge queue UI | P2       | feature | done   |

### E022: Integration Testing & E2E (6/6 done)

| ID                                       | Title                                                 | Priority | Type | Status |
| ---------------------------------------- | ----------------------------------------------------- | -------- | ---- | ------ |
| [T106](tasks/T106-test-harness.md)       | Create test harness with fake runner and workspace    | P0       | test | done   |
| [T107](tasks/T107-e2e-full-lifecycle.md) | Integration test: full task lifecycle BACKLOG to DONE | P0       | test | done   |
| [T108](tasks/T108-e2e-review-rework.md)  | Integration test: review rejection and rework loop    | P0       | test | done   |
| [T109](tasks/T109-e2e-merge-failures.md) | Integration test: merge conflict and failure paths    | P1       | test | done   |
| [T110](tasks/T110-e2e-lease-recovery.md) | Integration test: lease timeout and crash recovery    | P1       | test | done   |
| [T111](tasks/T111-e2e-escalation.md)     | Integration test: escalation triggers and resolution  | P1       | test | done   |

---

## Historical Dependency Graph

```
E001 (Platform Foundation)
  └─► E002 (Domain Model) ─► E003 (State Machines) ─► E005 (Job Queue)
  │                       └─► E007 (Dependencies)     └─► E006 (Leases) ─► E009 (Worker Runtime)*
  │                       └─► E010 (Policies) ─────────────────────────────►┘
  └─► E004 (Packet Schemas) ─► E009* ─► E012 (Review Pipeline) ─► E013 (Merge Pipeline)
  │                          └─► E011 (Validation Runner) ────────►┘
  └─► E008 (Workspaces) ─► E009*

E002 + E003 + E014 + E015 ─► E017 (REST API) ─► E018 (Events) ─► E019 (UI Foundation) ─► E020 (UI Features)
                                                                                         └─► E021 (Operator Actions)
E009* + E012 + E013 + E021 ─► E022 (Integration Tests)
```

\* E009 has additional pending tasks tracked in [index.md](index.md).

---

## Historical Critical Path

T001 → T002 → T006 → T009 → T014 → T015 → T017 → T027 → T030 → T044 → T045 → T107

All tasks on this path are complete.
