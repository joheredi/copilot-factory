
# V1 Implementation Plan

### 3.1 V1 Objective

Build a local-first working product that demonstrates the complete autonomous flow with strong foundations, even if some advanced configurability is simplified initially.

V1 should prove:

* end-to-end orchestration
* isolated single-task execution
* deterministic task locking
* developer pool execution
* at least one general reviewer and one lead reviewer mode
* merge queue serialization
* local web UI visibility
* artifact persistence and audit trail

### 3.2 Recommended V1 Scope

#### Included

* local orchestrator service
* local web UI
* SQLite initially
* filesystem artifact store
* one repository or small multi-repo support
* one planner agent
* configurable developer pool
* one general reviewer pool
* optional security reviewer toggle
* lead reviewer role
* merge queue
* validation runner hooks
* manual operator overrides
* config files + DB-backed overrides

#### Deferred

* distributed execution across many hosts
* enterprise auth/RBAC
* rich plugin marketplace
* advanced batching merges
* automated cost optimization across model vendors
* multi-tenant SaaS architecture

### 3.3 Suggested Tech Stack

#### Backend

* TypeScript with Node.js
* framework: NestJS, Fastify, or Express + typed modules
* job orchestration: internal queue abstraction first
* DB: SQLite for V1, abstracted for Postgres later
* ORM: Prisma, Drizzle, or Kysely
* websocket or SSE for live UI updates

#### Frontend

* React
* local browser app
* Tailwind + component library
* state/query with TanStack Query
* live updates via websocket/SSE

#### Execution

* workspace management via git worktrees or isolated folders
* worker runner abstraction
* Copilot CLI adapter as first execution backend
* shell command policy wrapper

### 3.4 V1 Workstreams

#### Workstream 1: Domain Model and Persistence

Deliverables:

* DB schema
* repositories/services for tasks, leases, review cycles, merge queue, workers, policies, audit
* migration system

#### Workstream 2: Orchestrator Core

Deliverables:

* task readiness computation
* scheduler
* lease manager
* transition engine
* retry manager
* escalation manager

#### Workstream 3: Workspace and Runner Abstraction

Deliverables:

* local checkout/worktree manager
* runner interface
* Copilot CLI runner
* process lifecycle management
* heartbeat support
* result capture and summarization

#### Workstream 4: Packets and Artifact Contracts

Deliverables:

* schemas for task packets, dev result packets, review packets, lead review packets, merge packets
* Zod schema validation (canonical V1 validation library; JSON Schema export available for cross-language consumers)
* artifact storage layer

Normative reference:

* `docs/008-packet-and-schema-spec.md`

#### Workstream 5: Review Pipeline

Deliverables:

* reviewer router
* general reviewer worker
* lead reviewer worker
* review decision logic
* rework loop handling

Normative references:

* `docs/009-policy-and-enforcement-spec.md`
* `docs/010-integration-contracts.md`

#### Workstream 6: Merge Pipeline

Deliverables:

* merge queue
* serialized integration worker
* rebase/validate/merge flow
* merge failure handling

#### Workstream 7: Local Web UI

Deliverables:

* dashboard
* task board
* task detail timeline
* worker pool panel
* review and merge panels
* config inspector/editor
* logs and audit explorer

#### Workstream 8: Validation and Policies

Deliverables:

* validation runner abstraction
* policy engine
* allowed commands/files
* operator-configurable thresholds

#### Workstream 9: Observability

Deliverables:

* OpenTelemetry instrumentation for control-plane services and worker supervision
* Prometheus-compatible backend metrics endpoint
* task/run/queue health metrics
* trace correlation across orchestration, worker execution, validation, and merge flow

#### Workstream 10: Operator Actions and Overrides

Deliverables:

* operator action API layer (REST endpoints for all actions listed in `docs/006-additional-refinements.md` §6.2)
* state transition guards for manual actions (validate that operator overrides respect invariants)
* audit trail for all operator actions with actor attribution
* UI controls for operator actions integrated into task detail, pool, and merge queue views
* authorization policy for sensitive actions (force unblock, override merge ordering, reopen completed task)

Normative reference:

* `docs/006-additional-refinements.md` §6.2

### 3.5 Delivery Phases

#### Phase 1: Skeleton Flow

* create DB schema
* register repo
* ingest tasks manually
* assign one task to one developer worker
* collect result packet
* manual review decision

#### Phase 2: Full Basic Automation

* add general reviewer
* add lead reviewer
* add review loop
* add merge queue
* add post-merge validation

#### Phase 3: UI and Operability

* dashboard and live task views
* worker pool monitoring
* audit timeline
* manual intervene/retry/reassign controls

#### Phase 4: Configurability Layer

* editable pool configuration
* prompt templates in UI
* routing rules
* review/merge policy settings

#### Phase 5: Hardening

* heartbeats
* stale lease recovery
* dead-letter handling
* branch cleanup
* metrics and alerts
* OpenTelemetry traces and Prometheus scraping wired for core runtime paths

### 3.6 V1 Milestones

1. **Repository + task lifecycle works end-to-end**
   * Acceptance: a task can be created, moved through BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE via API calls and a stub worker. State transitions are persisted and auditable.
   * Requires: Phase 1, Workstreams 1–2.
   * Verification: integration test exercising the full state machine with a fake runner.

2. **Developer worker runs in isolated workspace and submits artifacts**
   * Acceptance: a real Copilot CLI worker executes in a Git worktree, produces a schema-valid DevResultPacket, and artifacts are stored.
   * Requires: Phase 1, Workstreams 3–4.
   * Verification: end-to-end test with Copilot CLI adapter on a sample repository.

3. **Review loop operational**
   * Acceptance: after DEV_COMPLETE, the Review Router dispatches specialist reviewers, they produce ReviewPackets, the lead reviewer consolidates and emits a decision, and the orchestrator applies the decision (APPROVED or CHANGES_REQUESTED with rework loop).
   * Requires: Phase 2, Workstream 5.
   * Verification: end-to-end test exercising approve and reject-then-rework paths.

4. **Merge queue operational**
   * Acceptance: approved tasks enter the merge queue, the merge worker rebases/validates/merges, post-merge validation runs, and task reaches DONE. Merge failures trigger CHANGES_REQUESTED or FAILED per policy.
   * Requires: Phase 2, Workstreams 6, 8.
   * Verification: end-to-end test covering clean merge, conflict-to-rework, and post-merge validation failure paths.

5. **Local web UI operational**
   * Acceptance: the dashboard shows live task states, worker pools, review decisions, merge queue, and audit timeline. Operator can inspect any task and view all associated packets and logs.
   * Requires: Phase 3, Workstream 7.
   * Verification: manual walkthrough of all primary UI views with real data from milestone 4.

6. **Configurable pools and prompts operational**
   * Acceptance: operators can create/edit pools, change prompt templates, modify routing rules, and adjust policies via UI. Changes take effect for subsequent runs without restart.
   * Requires: Phase 4, Workstreams 8, 10.
   * Verification: configure a new pool via UI, run a task through it, verify custom prompt and policy applied.

7. **Recovery paths and audit trail operational**
   * Acceptance: heartbeat timeout correctly reclaims leases and retries or escalates. Dead-letter handling catches repeated failures. Every state transition has an audit event. Operators can reconstruct what happened for any task.
   * Requires: Phase 5, Workstreams 2, 3, 10.
   * Verification: fault-injection tests (kill worker mid-run, exceed retry limit, trigger escalation) plus audit trail completeness check.

8. **Core observability operational with traces and backend metrics**
   * Acceptance: OpenTelemetry traces cover task assignment through merge. Prometheus metrics endpoint exposes queue depth, run durations, failure rates. Operators can trace a single task across all orchestration steps.
   * Requires: Phase 5, Workstream 9.
   * Verification: run a task end-to-end, verify trace spans match the span tree in `docs/010-integration-contracts.md` §10.13.5, verify metrics scrape returns expected counters.

### 3.7 V1 Success Metrics

* no duplicate assignment incidents
* > 90% accurate task state consistency
* every run produces auditable artifacts
* operators can inspect any task and reconstruct what happened
* median end-to-end task cycle visibly lower than manual baseline for suitable tasks
* review rejection reasons are actionable and traceable

---
