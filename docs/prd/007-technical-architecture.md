# Technical / Implementation Architecture

### 7.1 Implementation Goals

The implementation architecture must optimize for:

- high AI-agent buildability
- strict modularity and clear ownership boundaries
- local-first operation with future scale-out path
- deterministic orchestration around ephemeral workers
- low-friction developer experience
- strong observability, recovery, and auditability

### 7.2 Recommended Stack

#### Backend

- **Language:** TypeScript
- **Runtime:** Node.js
- **Framework:** NestJS preferred, Fastify acceptable
- **API style:** REST for control plane operations, websocket/SSE for live events
- **Schema validation:** Zod or TypeBox + Ajv
- **ORM/query:** Prisma if prioritizing productivity; Kysely or Drizzle if prioritizing SQL control
- **Job execution:** internal DB-backed queue initially
- **Git/process execution:** child process wrappers with policy guard layer
- **Instrumentation:** OpenTelemetry
- **Metrics exposure:** Prometheus-compatible metrics endpoint

#### Frontend

- **Framework:** React
- **App:** browser-based local SPA
- **Build:** Vite
- **State/query:** TanStack Query
- **UI:** Tailwind + component library (shadcn/ui recommended)
- **Live updates:** websocket or SSE

#### Persistence

- **V1 DB:** SQLite with WAL mode
- **Later DB:** Postgres
- **Artifacts:** local filesystem with structured directories
- **Search later:** optional SQLite FTS or dedicated search index

#### Execution Isolation

- **Workspace isolation:** Git worktrees preferred
- **Process isolation:** one OS process per worker run
- **Sandboxing:** policy wrapper around allowed commands and paths
- **Execution backends:** Copilot CLI adapter first, pluggable worker runtime abstraction

### 7.3 High-Level Runtime Topology

Recommended local-first topology:

1. **Control Plane Service**
   - main backend server
   - owns state transitions, scheduling, leases, policies, API, live events

2. **Worker Supervisor** (infrastructure layer)
   - spawns and monitors worker processes
   - tracks heartbeats and exit codes
   - mediates access to Workspace Module and runner adapters
   - calls the Worker Runtime Module (application layer) which defines run lifecycle, budgets, and output interpretation

3. **Workspace Manager** (implemented as the Workspace Module within the control plane in V1)
   - provisions repo worktrees
   - mounts task packets and config
   - manages cleanup and reuse rules
   - in V1, runs in-process as a module called by the Worker Supervisor; may be extracted to a separate service later

4. **Validation Runner** (implemented as the Validation Module within the control plane in V1)
   - executes tests/lint/build/policy checks
   - returns machine-readable results
   - in V1, runs in-process as a module; spawns child processes for actual test/lint/build execution

5. **Artifact Service**
   - stores packets, logs, outputs, summaries, diffs, traces

6. **Web UI**
   - operator dashboard and control surface

7. **Scheduler Loop / Reconciliation Loop / Merge Loop**
   - internal background jobs or services within backend process initially

### 7.4 Recommended Repository Structure

A monorepo is strongly recommended.

Suggested structure:

```text
software-factory/
  apps/
    control-plane/
    web-ui/
    worker-runner/
  packages/
    domain/
    application/
    infrastructure/
    schemas/
    config/
    observability/
    ui-components/
    testing/
  docs/
    architecture/
    adr/
    prompts/
  tools/
    scripts/
    dev/
```

Alternative with stricter layering:

```text
apps/control-plane/src/
  modules/
    projects/
    repositories/
    tasks/
    dependencies/
    scheduler/
    leases/
    workspaces/
    workers/
    reviews/
    merges/
    validation/
    policies/
    config/
    audit/
    metrics/
    events/
```

### 7.5 Backend Architectural Pattern

Use a layered modular monolith.

#### Suggested layers

- **Domain layer**
  - entities, value objects, enums, invariants, state machines

- **Application layer**
  - commands, queries, orchestrators, use cases

- **Infrastructure layer**
  - database repositories, git services, runner adapters, filesystem storage, event transport

- **Interface layer**
  - REST controllers, websocket gateways, UI DTOs, CLI/admin commands

#### Strong recommendation

Keep business rules out of controllers and adapters. Put orchestration in application services and state invariants in domain modules.

### 7.6 Key Internal Modules

#### Projects & Repositories Module

Responsibilities:

- register repositories
- store repo settings
- manage branch and credential profiles
- attach workflow templates and policies

#### Tasks Module

Responsibilities:

- create/update/import tasks
- store status and metadata
- attach acceptance criteria, file scope, risk, tags
- manage reopen/cancel/manual override flows

#### Dependency Module

Responsibilities:

- manage task graph
- compute blocked/ready states
- detect circular dependencies
- recalculate readiness after completion

#### Scheduler Module

Responsibilities:

- select next ready tasks
- match tasks to compatible pools
- apply priority and conflict heuristics
- request leases

#### Lease Module

Responsibilities:

- enforce one active developer owner per task
- manage TTL and heartbeat expiry
- reclaim orphaned work
- support idempotent acquisition and release

#### Worker Runtime Module

Responsibilities:

- define runner interfaces
- launch worker processes
- capture stdout/stderr
- manage run IDs, budgets, deadlines
- interpret structured outputs

#### Workspace Module

Responsibilities:

- create/reuse/cleanup worktrees
- mount packets/config
- enforce file/path policy
- isolate branches per task

#### Review Module

Responsibilities:

- route specialist reviewers
- collect review packets
- trigger lead reviewer
- drive changes requested vs approval transitions

#### Merge Module

Responsibilities:

- manage merge queue
- perform rebase/revalidate/merge flow
- capture integration artifacts
- create follow-up or escalation on failure

#### Validation Module

Responsibilities:

- run lint/test/build/policy checks
- normalize results
- expose reusable validation profiles

#### Policy & Config Module

Responsibilities:

- load layered configuration
- validate config versions
- resolve effective config for a task/run/repo
- enforce command, path, and approval policies

#### Artifact Module

Responsibilities:

- store packet JSON
- store logs and summaries
- reference diff artifacts and validation outputs
- provide retrieval for UI and replay
- generate summarization packets for retries (condense failed-run artifacts into bounded context for the next attempt)
- capture and store partial-work snapshots on lease reclaim for crash recovery
- store diff metadata for review and audit purposes

#### Audit, Metrics & Observability Module

Responsibilities:

- append audit events
- aggregate operational metrics
- provide timelines and system health views
- own OpenTelemetry instrumentation: initialize TracerProvider, configure span exporters, manage context propagation
- expose Prometheus-compatible metrics endpoint
- manage trace correlation across orchestration, worker supervision, validation, and merge flows
- define and maintain the canonical span and metric inventories (see `docs/010-integration-contracts.md` §10.13)

### 7.7 API Architecture

Use a pragmatic split:

#### REST API

For:

- repository/project CRUD
- task management
- manual overrides
- config management
- artifact lookup
- review decision exploration
- metrics queries

#### Websocket / SSE

For:

- live task state updates
- worker heartbeats
- queue updates
- merge progress
- log streaming

#### Internal command handlers

Examples:

- `AssignTaskCommand`
- `SubmitDevResultCommand`
- `StartReviewCycleCommand`
- `ApplyLeadReviewDecisionCommand`
- `EnqueueMergeCommand`
- `CompleteMergeCommand`
- `ReconcileStaleLeasesCommand`

### 7.8 Queue / Job Architecture

Do not start with an external broker unless necessary.

#### Recommended V1

Use DB-backed queues with explicit job tables.

Job categories:

- scheduler tick
- worker dispatch
- reviewer dispatch
- lead-review consolidation
- merge dispatch
- validation execution
- reconciliation sweep
- cleanup jobs

Suggested job table fields:

- `job_id`
- `job_type`
- `entity_type`
- `entity_id`
- `payload_json`
- `status`
- `attempt_count`
- `run_after`
- `lease_owner`
- `created_at`
- `updated_at`

Additional job coordination fields for V1:

- `parent_job_id` (nullable; references a parent job that spawned this job)
- `job_group_id` (nullable; groups related jobs, e.g., all specialist reviewer jobs in one review cycle)
- `depends_on_job_ids` (nullable JSON array; this job cannot start until all listed jobs reach terminal status)

**Review cycle coordination rule:** When the Review Module dispatches specialist reviewers, it creates one job per reviewer with the same `job_group_id`. The lead-review consolidation job is created with `depends_on_job_ids` listing all specialist reviewer job IDs. The scheduler only dispatches a job when all entries in `depends_on_job_ids` are in terminal status (`completed` or `failed`).

#### Why this is good for AI-built software

- easier to debug
- fewer moving parts
- state visible in one DB
- easier replay and recovery

### 7.9 Worker Runtime Abstraction

Define a stable interface so execution backends can be swapped.

The canonical V1 runtime, packet, and policy contracts are specified in:

- `docs/008-packet-and-schema-spec.md`
- `docs/009-policy-and-enforcement-spec.md`
- `docs/010-integration-contracts.md`

Example conceptual interface:

- `prepareRun(runContext)`
- `startRun(runContext)`
- `pollRun(runId)`
- `cancelRun(runId)`
- `collectArtifacts(runId)`
- `finalizeRun(runId)`

Execution adapters:

- Copilot CLI adapter
- future local LLM adapter
- future remote API adapter
- deterministic reviewer/validator adapter

### 7.10 Workspace Strategy

Prefer Git worktrees over full clones for V1.

Per-task workspace layout:

```text
/workspaces/
  repo-a/
    task-123/
      worktree/
      task-packet.json
      run-config.json
      logs/
      outputs/
```

Rules:

- one task → one worktree
- branch name assigned by orchestrator
- workspace cleanup after terminal state or retention period
- optional warm worktree cache later

**Cleanup rules:**

- Terminal states for workspace cleanup: `DONE`, `FAILED`, `CANCELLED`
- `ESCALATED` workspaces are retained until operator resolution
- Workspace retention after terminal state: governed by `retention_policy.workspace_retention_hours` (default: 24h)
- A scheduled `ReconcileWorkspacesCommand` runs hourly to remove expired workspaces and delete merged branches
- If a task retries from `FAILED`, the existing workspace is reused if still available; otherwise a new workspace is created

### 7.11 Artifact Storage Layout

Use filesystem first, but structure it as if object storage could replace it later.

Suggested layout:

```text
/artifacts/
  repositories/{repoId}/
    tasks/{taskId}/
      packets/
      runs/{runId}/
        logs/
        outputs/
        validation/
      reviews/{reviewCycleId}/
      merges/
      summaries/
```

Artifacts should be content-addressable or at least version-addressable where practical.

### 7.12 Configuration Architecture

Use hierarchical config resolution.

Suggested sources:

- static defaults in code
- `factory.config.json` or YAML
- repository-level config
- DB-stored overrides from UI
- run-level generated config snapshot

The canonical precedence order for effective configuration and policy snapshots is defined in `docs/009-policy-and-enforcement-spec.md`.

Important implementation rule:
Every worker run should persist the **resolved effective configuration snapshot** it used. This is critical for reproducibility.

### 7.13 State Transition Engine

Implement state transitions as a dedicated domain/application service, not ad hoc in handlers.

The canonical transition ownership mapping for V1 is defined in `docs/010-integration-contracts.md`.

Recommended pattern:

- validate current state
- validate triggering condition
- enforce invariants
- emit transition event
- persist state and audit atomically

Important:
All asynchronous handlers should call into the same transition engine.

### 7.14 Observability Architecture

#### Logs

Use structured logs with these common fields:

- `timestamp`
- `level`
- `module`
- `taskId`
- `runId`
- `workerId`
- `reviewCycleId`
- `mergeQueueItemId`
- `eventType`
- `message`

#### Instrumentation and tracing

Use OpenTelemetry as the canonical instrumentation layer for backend services and worker supervision.

Instrument at minimum:

- API request handling
- scheduler and reconciliation loops
- worker run lifecycle
- validation execution
- merge execution
- database operations where latency or contention matters

OpenTelemetry trace/span context should be propagated across control-plane actions, worker supervision, validation runs, and merge processing so operators can reconstruct end-to-end task execution.

#### Metrics

Expose metrics such as:

- queue depth by type
- active workers by pool
- task cycle durations
- task failure/rejection rates
- heartbeat timeout count
- merge success/failure rate
- validation duration

Prometheus should be the default backend metrics model for V1. The control plane should expose a Prometheus-compatible scrape endpoint, and metric names/labels should align with the core operational entities such as `taskId`, `poolId`, `workerId`, and queue type where cardinality remains safe.

#### Audit stream

Persist audit events in DB and surface them in UI timeline views.

### 7.15 Security / Policy Enforcement Architecture

Create a policy enforcement layer between orchestrator and worker execution.

Policy domains:

- command policy
- path/file policy
- network policy
- branch policy
- merge approval policy
- sensitive file policy
- secret injection policy

Implementation recommendation:
No worker should directly execute shell commands without going through a policy-aware command wrapper.

### 7.16 Frontend Architecture

Use a straightforward React SPA with feature-based organization.

Suggested frontend structure:

```text
src/
  app/
  features/
    dashboard/
    tasks/
    task-detail/
    pools/
    reviews/
    merge-queue/
    config/
    audit/
    metrics/
  components/
  hooks/
  lib/
  api/
  state/
```

Key screens:

- dashboard
- task board
- task detail timeline
- worker pool monitor
- review center
- merge queue
- configuration editor
- audit explorer

### 7.17 Testing Architecture

The system must be highly testable for AI-driven development.

#### Test layers

- unit tests for domain/state logic
- contract/schema tests for packets and config
- application service tests with fakes
- integration tests for DB + filesystem + git workflows
- end-to-end tests for core happy paths and failure recovery

#### Recommended test doubles

- fake runner adapter
- fake validation executor
- fake workspace manager for many tests
- fake clock
- fake event bus

### 7.18 Delivery / Build Architecture

Keep boot and build extremely simple.

Recommended commands:

- `pnpm install`
- `pnpm dev`
- `pnpm test`
- `pnpm lint`
- `pnpm db:migrate`
- `pnpm seed`

Recommended local boot behavior:

- start DB
- start control plane
- start UI
- create artifact/workspace directories
- run health checks

### 7.19 Migration Path for Scaling Later

Design now so later migration is incremental.

#### Easy future upgrades

- SQLite → Postgres
- filesystem artifacts → object storage
- in-process queues → external broker
- local workers → remote worker nodes
- single backend instance → horizontally scaled API + dedicated job runners

Because modules communicate through typed contracts and DB-backed workflows, these transitions should not require a full redesign.

### 7.20 Overall Implementation Recommendation

Build the first version as a **TypeScript modular monolith with a React local web UI, SQLite, filesystem artifacts, DB-backed jobs, Git worktrees, and a pluggable worker runtime centered initially on Copilot CLI**. Prioritize strict schemas, centralized state transitions, policy-wrapped execution, and deep observability so AI coding agents can build the system incrementally and safely.
