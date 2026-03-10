# Integration Contracts and Runtime Rules

## 10.1 Purpose

This document defines the implementation-facing contracts needed to make the architecture executable without divergent interpretations. It covers state transition ownership, worker lifecycle, review routing, adapter interfaces, transaction boundaries, and naming/runtime rules.

## 10.2 Canonical State Transition Ownership

The task state machine in `docs/002-data-model.md` is canonical.

The control plane is the only authority allowed to commit task state transitions.

### 10.2.1 Module Ownership Map

* **Dependency Module**
  * `BACKLOG -> READY` — all hard-block dependencies resolved; no policy blockers
  * `BACKLOG -> BLOCKED` — hard-block dependency added or policy blocker detected
  * `BLOCKED -> READY` — last hard-block dependency resolved; no policy blockers

* **Scheduler + Lease Module**
  * `READY -> ASSIGNED` — scheduler selects task; lease acquired with version check

* **Worker Runtime + Lease Module** (proposals only; orchestrator commits)
  * `ASSIGNED -> IN_DEVELOPMENT` — first heartbeat received from worker
  * `IN_DEVELOPMENT -> DEV_COMPLETE` — schema-valid DevResultPacket received; required validations pass
  * `IN_DEVELOPMENT -> FAILED` — unrecoverable execution failure or lease timeout with no retry remaining

* **Review Module**
  * `DEV_COMPLETE -> IN_REVIEW` — Review Router emits routing decision; ReviewCycle created
  * `IN_REVIEW -> CHANGES_REQUESTED` — lead reviewer decision is `changes_requested`
  * `IN_REVIEW -> APPROVED` — lead reviewer decision is `approved` or `approved_with_follow_up`

* **Scheduler + Lease Module**
  * `CHANGES_REQUESTED -> ASSIGNED` — scheduler re-selects task for rework; new lease acquired

* **Merge Module**
  * `APPROVED -> QUEUED_FOR_MERGE` — orchestrator enqueues; follow-up tasks created if `approved_with_follow_up`
  * `QUEUED_FOR_MERGE -> MERGING` — merge worker dequeues item
  * `MERGING -> POST_MERGE_VALIDATION` — merge completes; post-merge validation triggered
  * `MERGING -> CHANGES_REQUESTED` — merge conflict classified as reworkable by `merge_policy.conflict_classification`
  * `MERGING -> FAILED` — integration failure classified as non-reworkable by `merge_policy.conflict_classification`

* **Validation Module**
  * `POST_MERGE_VALIDATION -> DONE` — all `merge-gate` profile required checks pass
  * `POST_MERGE_VALIDATION -> FAILED` — required post-merge check fails; post-merge failure policy applied

* **Operator or Escalation Flow**
  * `* -> ESCALATED` — operator manual escalation or automatic trigger per escalation policy (see `docs/002-data-model.md` §2.7)
  * `* -> CANCELLED` — operator cancels or policy-driven cancellation

### 10.2.2 Rule

Workers never mutate task state directly. They emit schema-valid packets. The orchestrator validates the packet and performs the transition in one state-transition service.

### 10.2.3 Concurrency Control

All task state transitions must use optimistic concurrency control:

1. The caller reads `Task.version` before proposing a transition.
2. The transition service validates `Task.version` matches the expected value.
3. If versions conflict, the transition is rejected and the caller must re-read and retry.
4. `Task.version` is incremented atomically with every committed state change.

Conflict resolution priority when multiple actors race:

* Operator actions (`ESCALATED`, `CANCELLED`) take precedence over all automated transitions.
* Lease expiry (`TIMED_OUT`) takes precedence over worker result submissions arriving after expiry.
* A result packet received within `grace_period_seconds` after lease timeout must still be accepted if schema-valid and IDs match (see `docs/002-data-model.md` §2.8).

## 10.3 Transaction Boundaries

For any state transition:

1. validate current state and triggering conditions
2. persist the new state
3. persist the audit event
4. persist references to newly created packets/artifacts

These steps must occur in a single database transaction.

Git operations, filesystem writes, or process execution are not transactional. When those steps fail after a DB transition candidate is prepared, the orchestrator must roll back the DB transaction or apply a compensating transition such as `FAILED` with explicit failure metadata.

SQLite V1 recommendation:

* WAL mode enabled
* `BEGIN IMMEDIATE` for transition writes

## 10.4 Worker and WorkerPool Lifecycle

### 10.4.1 Semantics

* `WorkerPool` is a logical execution pool with runtime, model, concurrency, and policy defaults.
* `Worker` is an ephemeral worker process instance or logical execution slot created when a run starts.

### 10.4.2 Cardinality

V1 uses one-to-many:

* one `WorkerPool`
* many ephemeral `Worker` records

### 10.4.3 Lifecycle

Worker lifecycle:

* created in `IDLE`
* moves to `LEASED`
* moves to `STARTING`
* moves to `RUNNING`
* sends heartbeats in `HEARTBEATING`
* moves to `COMPLETING`
* terminates into `IDLE`, `TIMED_OUT`, `CRASHED`, or `RECLAIMED`

Workers are created on demand and may be garbage-collected after completion while retaining audit history.

## 10.5 WorkerPool and AgentProfile Relationship

V1 uses one-to-many:

* one pool may reference multiple agent profiles
* each profile belongs to exactly one pool

`AgentProfile.pool_id` remains valid in this model. The implementation rule is that profile selection happens per run within the chosen pool.

## 10.6 Review Routing Contract

### 10.6.1 Inputs

The Review Router consumes:

* changed file paths
* task tags/domains
* risk level
* repository settings
* workflow template review policy

### 10.6.2 Rule Model

Routing rules are evaluated in deterministic order:

1. explicit repository-required reviewers
2. path-based rules
3. task tag/domain rules
4. risk-based rules
5. optional AI recommendation

The AI recommendation may only add optional reviewer suggestions. It must not remove deterministic requirements.

### 10.6.3 Canonical Rule Shape

```json
{
  "rules": [
    {
      "name": "auth-paths-require-security",
      "when": {
        "changed_path_matches": ["src/auth/**", "packages/security/**"]
      },
      "require_reviewers": ["security"]
    },
    {
      "name": "high-risk-require-architecture",
      "when": {
        "risk_level_in": ["high", "critical"]
      },
      "require_reviewers": ["architecture"]
    }
  ]
}
```

### 10.6.4 Output

The router emits:

* `required_reviewers`
* `optional_reviewers`
* `routing_rationale`

## 10.7 Lead Reviewer Consolidation Rules

The lead reviewer must consolidate by these heuristics:

1. group issues by `file_path + line + issue code` when present
2. otherwise group by semantic similarity of title and description
3. preserve the highest severity among grouped issues
4. preserve blocking status if any grouped issue is blocking

If reviewers disagree on severity:

* highest severity wins for grouped issues
* the lead reviewer may downgrade only with explicit rationale in `deduplication_notes`

## 10.8 Copilot CLI Adapter Contract

### 10.8.1 Purpose

The Copilot CLI adapter is the primary V1 execution backend for AI worker runs.

### 10.8.2 Interface

The adapter must implement:

* `prepareRun(runContext)`
* `startRun(runContext)`
* `streamRun(runId)`
* `cancelRun(runId)`
* `collectArtifacts(runId)`
* `finalizeRun(runId)`

### 10.8.3 Run Context

The adapter receives:

* TaskPacket
* effective policy snapshot
* workspace paths
* output schema expectation
* timeout/heartbeat settings

### 10.8.4 Required Behavior

* mount the task packet and effective policy snapshot into the workspace
* inject the correct role prompt for the assigned profile
* restrict command/file access through the policy-aware wrapper
* capture stdout, stderr, and structured packet output separately
* reject completion if the final packet is missing or schema-invalid

### 10.8.5 Structured Output Rule

Every Copilot CLI worker prompt must instruct the worker to finish by emitting exactly one machine-readable result packet matching the expected schema. The adapter may use explicit delimiters or a dedicated output file path, but the result must be machine-validated before the run is accepted.

## 10.9 Branch Naming Contract

V1 branch naming format:

* `factory/{task_id}`

If a retry requires a new branch after irreversible divergence:

* `factory/{task_id}/r{attempt}`

Examples:

* `factory/task-123`
* `factory/task-123/r2`

## 10.10 Merge Queue Ordering Contract

V1 queue ordering is:

1. higher repository-configured merge priority
2. earlier enqueue time
3. stable tie-break by `merge_queue_item_id`

`position` is a derived display field, not the canonical ordering mechanism. It may be recalculated after enqueue, dequeue, or reordering.

## 10.10.1 Merge Strategy

V1 supported merge strategies:

* `rebase-and-merge` (default)
* `squash`
* `merge-commit`

Strategy selection precedence:

1. task-level override (if set in TaskPacket)
2. repository workflow template `merge_policy.strategy`
3. system default: `rebase-and-merge`

The selected strategy is recorded in MergePacket.details.merge_strategy.

## 10.10.2 Merge Conflict Classification

When a merge or rebase fails due to conflicts, the merge module classifies the failure:

* **reworkable**: fewer than `merge_policy.max_conflict_files` files in conflict AND no conflicts in `merge_policy.protected_paths` → transition to `CHANGES_REQUESTED`
* **non-reworkable**: conflicts exceed thresholds OR conflicts in protected paths OR rebase produces irrecoverable state → transition to `FAILED`

Default V1 classification policy:

* `max_conflict_files`: 5
* `protected_paths`: `[".github/", "package.json", "pnpm-lock.yaml"]`

If merge assist is enabled by policy, the merge module may invoke the Merge Assist Agent before classifying. The agent's recommendation is advisory; the merge module applies the classification rules.

## 10.11 External Task Source Contract

V1 should support manual task creation first.

If external sources are enabled, the canonical task source model is:

* `source`: `manual | github_issue | jira | api_import`
* `external_ref`: source-specific stable identifier

Synchronization rules:

* V1 default is one-way import into the factory
* bidirectional sync is out of scope unless explicitly implemented later

## 10.12 Implementation Readiness Rule

The architecture is ready for implementation only when:

* packet schemas are machine-readable
* effective policy snapshots are resolvable deterministically
* state transition ownership is implemented in one transition service
* at least one runtime adapter satisfies the full worker contract
* review routing and validation profiles can be tested deterministically

## 10.13 Observability Starter Contract

V1 should start with a small, stable observability surface rather than a large ungoverned set of spans and metrics.

### 10.13.1 Trace Propagation Rules

OpenTelemetry trace context should propagate across:

* inbound API request or scheduler tick
* task assignment
* worker run start and completion
* validation execution
* review cycle execution
* merge execution

When a workflow step starts from a queue or background job, the new span should link back to the originating task or run context using the prior trace context when available.

### 10.13.2 Recommended Starter Spans

Create spans at minimum for:

* `task.assign`
* `task.transition`
* `worker.prepare`
* `worker.run`
* `worker.heartbeat`
* `validation.run`
* `review.route`
* `review.lead_decision`
* `merge.prepare`
* `merge.execute`

Recommended attributes:

* `task.id`
* `repository.id`
* `pool.id`
* `worker.id`
* `run.id`
* `review_cycle.id`
* `merge_queue_item.id`
* `task.state.from`
* `task.state.to`
* `validation.profile`
* `result.status`

### 10.13.3 Recommended Starter Metrics

Expose a minimal Prometheus-compatible set:

* `factory_task_transitions_total`
* `factory_task_terminal_total`
* `factory_worker_runs_total`
* `factory_worker_run_duration_seconds`
* `factory_worker_heartbeat_timeouts_total`
* `factory_review_cycles_total`
* `factory_review_rounds_total`
* `factory_merge_attempts_total`
* `factory_merge_failures_total`
* `factory_validation_runs_total`
* `factory_validation_duration_seconds`
* `factory_queue_depth`

Recommended metric types:

* counters for totals and failures
* histograms for durations
* gauges for queue depth and active workers

### 10.13.4 Label Rules

Use low-cardinality labels by default:

* `repository_id`
* `pool_id`
* `job_type`
* `task_state`
* `result`
* `validation_profile`

Do not use `task_id`, `run_id`, or `branch_name` as Prometheus labels by default because they create unsafe cardinality. Those values belong in traces and logs instead.

### 10.13.5 Example Span Tree

Example trace for one task moving from assignment through merge:

```text
task.assign
  task.transition (READY -> ASSIGNED)
  worker.prepare
  worker.run
    worker.heartbeat
    validation.run (pre-review)
  task.transition (IN_DEVELOPMENT -> DEV_COMPLETE)
  review.route
  review.lead_decision
  task.transition (IN_REVIEW -> APPROVED)
  merge.prepare
  merge.execute
    validation.run (post-merge)
  task.transition (POST_MERGE_VALIDATION -> DONE)
```

This example is illustrative, but the parent/child relationships should remain stable enough that operators can trace one task across orchestration, worker execution, validation, and merge.

### 10.13.6 Example `/metrics` Excerpt

Illustrative Prometheus-compatible output:

```text
# HELP factory_task_transitions_total Total number of task state transitions.
# TYPE factory_task_transitions_total counter
factory_task_transitions_total{repository_id="repo-1",task_state="APPROVED",result="success"} 42

# HELP factory_worker_run_duration_seconds Duration of worker runs.
# TYPE factory_worker_run_duration_seconds histogram
factory_worker_run_duration_seconds_bucket{repository_id="repo-1",pool_id="developer",le="5"} 3
factory_worker_run_duration_seconds_bucket{repository_id="repo-1",pool_id="developer",le="30"} 11
factory_worker_run_duration_seconds_bucket{repository_id="repo-1",pool_id="developer",le="60"} 18
factory_worker_run_duration_seconds_bucket{repository_id="repo-1",pool_id="developer",le="+Inf"} 20
factory_worker_run_duration_seconds_sum{repository_id="repo-1",pool_id="developer"} 512.4
factory_worker_run_duration_seconds_count{repository_id="repo-1",pool_id="developer"} 20

# HELP factory_queue_depth Current queue depth by job type.
# TYPE factory_queue_depth gauge
factory_queue_depth{repository_id="repo-1",job_type="merge"} 2
factory_queue_depth{repository_id="repo-1",job_type="review"} 5

# HELP factory_validation_runs_total Total validation runs by result.
# TYPE factory_validation_runs_total counter
factory_validation_runs_total{repository_id="repo-1",validation_profile="default-dev",result="passed"} 18
factory_validation_runs_total{repository_id="repo-1",validation_profile="default-dev",result="failed"} 2
```

Exact bucket boundaries and metric inventory may evolve, but metric names should remain stable once published because dashboards and alerts will depend on them.
