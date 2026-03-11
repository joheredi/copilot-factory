# State Machine + Data Model

### 2.1 Task State Machine

#### Core States

- `BACKLOG`
- `READY`
- `BLOCKED`
- `ASSIGNED`
- `IN_DEVELOPMENT`
- `DEV_COMPLETE`
- `IN_REVIEW`
- `CHANGES_REQUESTED`
- `APPROVED`
- `QUEUED_FOR_MERGE`
- `MERGING`
- `POST_MERGE_VALIDATION`
- `DONE`
- `FAILED`
- `ESCALATED`
- `CANCELLED`

#### Transition Rules

- `BACKLOG -> READY` when dependencies are satisfied and task is eligible
- `BACKLOG -> BLOCKED` when dependencies or policy blockers exist
- `BLOCKED -> READY` when blockers are cleared
- `READY -> ASSIGNED` when scheduler grants lease to a worker
- `ASSIGNED -> IN_DEVELOPMENT` when worker heartbeat/session starts
- `IN_DEVELOPMENT -> DEV_COMPLETE` when implementation packet is submitted successfully
- `IN_DEVELOPMENT -> FAILED` on unrecoverable execution failure
- `DEV_COMPLETE -> IN_REVIEW` when review fan-out begins
- `IN_REVIEW -> CHANGES_REQUESTED` if lead reviewer rejects
- `IN_REVIEW -> APPROVED` if lead reviewer approves
- `CHANGES_REQUESTED -> ASSIGNED` when task is rescheduled for rework
- `APPROVED -> QUEUED_FOR_MERGE` when queued
- `QUEUED_FOR_MERGE -> MERGING` when merge worker begins
- `MERGING -> POST_MERGE_VALIDATION` when merge completes successfully
- `MERGING -> CHANGES_REQUESTED` if merge-time problems can be fixed by dev rework
- `MERGING -> FAILED` if integration irrecoverably fails
- `POST_MERGE_VALIDATION -> DONE` on success
- `POST_MERGE_VALIDATION -> FAILED` on regression/failure
- `* -> ESCALATED` when human/operator intervention is required
- `* -> CANCELLED` by operator or policy
- `ESCALATED -> ASSIGNED` when operator resolves by retrying
- `ESCALATED -> CANCELLED` when operator resolves by abandoning
- `ESCALATED -> DONE` when operator marks as externally resolved

#### Transition Preconditions and Triggers

| Current State           | Target State            | Trigger Actor                             | Event / Condition                                                                |
| ----------------------- | ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `BACKLOG`               | `READY`                 | Dependency Module (reconciliation)        | All hard-block dependencies resolved AND no policy blockers remain               |
| `BACKLOG`               | `BLOCKED`               | Dependency Module                         | Hard-block dependency added or policy blocker detected                           |
| `BLOCKED`               | `READY`                 | Dependency Module (reconciliation)        | Last hard-block dependency resolved AND no policy blockers remain                |
| `READY`                 | `ASSIGNED`              | Scheduler + Lease Module                  | Scheduler selects task AND lease acquired successfully                           |
| `ASSIGNED`              | `IN_DEVELOPMENT`        | Worker Runtime (proposed)                 | Worker sends first heartbeat confirming session start                            |
| `IN_DEVELOPMENT`        | `DEV_COMPLETE`          | Worker Runtime (proposed)                 | Worker emits schema-valid DevResultPacket                                        |
| `IN_DEVELOPMENT`        | `FAILED`                | Worker Runtime (proposed) OR Lease Module | Unrecoverable execution failure OR lease timeout with no retry remaining         |
| `DEV_COMPLETE`          | `IN_REVIEW`             | Review Module (automatic)                 | Review Router emits routing decision; ReviewCycle created                        |
| `IN_REVIEW`             | `CHANGES_REQUESTED`     | Review Module                             | Lead reviewer emits `changes_requested` or `escalated` decision mapped to rework |
| `IN_REVIEW`             | `APPROVED`              | Review Module                             | Lead reviewer emits `approved` or `approved_with_follow_up` decision             |
| `CHANGES_REQUESTED`     | `ASSIGNED`              | Scheduler + Lease Module                  | Scheduler re-selects task for rework; new lease acquired                         |
| `APPROVED`              | `QUEUED_FOR_MERGE`      | Merge Module (automatic)                  | Orchestrator enqueues task; follow-up tasks created if `approved_with_follow_up` |
| `QUEUED_FOR_MERGE`      | `MERGING`               | Merge Module                              | Merge worker dequeues item and begins integration                                |
| `MERGING`               | `POST_MERGE_VALIDATION` | Merge Module                              | Merge completes successfully; post-merge validation triggered                    |
| `MERGING`               | `CHANGES_REQUESTED`     | Merge Module                              | Merge conflict or rebase failure classified as reworkable by merge policy        |
| `MERGING`               | `FAILED`                | Merge Module                              | Integration irrecoverably fails (policy classifies as non-reworkable)            |
| `POST_MERGE_VALIDATION` | `DONE`                  | Validation Module                         | All required post-merge checks pass                                              |
| `POST_MERGE_VALIDATION` | `FAILED`                | Validation Module                         | Required post-merge check fails; post-merge failure policy applied               |
| `*`                     | `ESCALATED`             | Operator OR Escalation Policy             | Operator manual escalation OR automatic trigger (see §2.7)                       |
| `*`                     | `CANCELLED`             | Operator OR Policy                        | Operator cancels task OR policy-driven cancellation                              |
| `ESCALATED`             | `ASSIGNED`              | Operator                                  | Operator resolves escalation by retrying the task; new lease acquired            |
| `ESCALATED`             | `CANCELLED`             | Operator                                  | Operator resolves escalation by abandoning the task                              |
| `ESCALATED`             | `DONE`                  | Operator                                  | Operator resolves escalation by marking task as externally completed             |

#### Global Invariants

- only one active development lease per task
- approved tasks cannot re-enter review without invalidation event
- only merge worker may transition to `MERGING`
- only orchestrator commits transitions; workers only propose them
- a task in `DONE` is immutable except via reopen operation
- every state transition must include an optimistic version check against `Task.version`; conflicting transitions are rejected and the caller must re-read
- merge conflict classification (reworkable vs irrecoverable) is determined by `merge_policy.conflict_classification` in the effective policy, not by the merge worker
- an "invalidation event" for the approved-tasks-cannot-re-enter-review invariant is: post-merge rebase failure, operator-initiated reopen, or dependency invalidation after approval

### 2.2 Supporting State Machines

#### Worker Lease State

- `IDLE`
- `LEASED`
- `STARTING`
- `RUNNING`
- `HEARTBEATING`
- `COMPLETING`
- `TIMED_OUT`
- `CRASHED`
- `RECLAIMED`

#### Review Cycle State

- `NOT_STARTED`
- `ROUTED`
- `IN_PROGRESS`
- `AWAITING_REQUIRED_REVIEWS`
- `CONSOLIDATING`
- `APPROVED`
- `REJECTED`
- `ESCALATED`

#### Merge Queue Item State

- `ENQUEUED`
- `PREPARING`
- `REBASING`
- `VALIDATING`
- `MERGING`
- `MERGED`
- `REQUEUED`
- `FAILED`

### 2.3 Core Data Model

#### Entity: Project

- `project_id`
- `name`
- `description`
- `owner`
- `default_workflow_template_id`
- `default_policy_set_id`
- `created_at`
- `updated_at`

#### Entity: Repository

- `repository_id`
- `project_id`
- `name`
- `remote_url`
- `default_branch`
- `local_checkout_strategy`
- `credential_profile_id`
- `status`
- `created_at`
- `updated_at`

#### Entity: WorkflowTemplate

- `workflow_template_id`
- `name`
- `description`
- `task_selection_policy`
- `review_routing_policy`
- `merge_policy`
- `validation_policy_id`
- `retry_policy_id`
- `escalation_policy_id`
- `created_at`
- `updated_at`

#### Entity: Task

- `task_id`
- `repository_id`
- `external_ref`
- `title`
- `description`
- `task_type`
- `priority`
- `severity`
- `status`
- `source`
- `acceptance_criteria`
- `definition_of_done`
- `estimated_size`
- `risk_level`
- `required_capabilities`
- `suggested_file_scope`
- `branch_name`
- `current_lease_id`
- `current_review_cycle_id`
- `merge_queue_item_id`
- `retry_count`
- `review_round_count`
- `created_at`
- `updated_at`
- `version` (optimistic concurrency token; incremented on every state transition)
- `completed_at`

**Field clarifications:**

- `suggested_file_scope` is an array of glob patterns (e.g., `["apps/control-plane/src/modules/leases/**"]`). Enforcement level is determined by `file_scope_policy.enforcement_level` in the effective policy: `strict` (violations fail the run), `audit` (violations logged but allowed), or `advisory` (informational only).

#### Entity: TaskDependency

- `task_dependency_id`
- `task_id`
- `depends_on_task_id`
- `dependency_type`
- `is_hard_block`
- `created_at`

**Dependency type values:**

- `blocks`: target task cannot enter `READY` until this dependency's task reaches `DONE` (when `is_hard_block` is true) or is merely informed (when `is_hard_block` is false)
- `relates_to`: informational link; does not affect readiness computation
- `parent_child`: hierarchical grouping; child tasks may be independently scheduled but parent task cannot reach `DONE` until all children are `DONE` or `CANCELLED`

**Dependency rules:**

- Circular dependencies are rejected at creation time. The Dependency Module validates the graph is a DAG on every insert.
- When a dependency task transitions to `DONE`, the Dependency Module recalculates readiness for all reverse-dependent tasks.
- When a dependency task transitions to `FAILED` or `CANCELLED`, hard-blocked dependents remain in `BLOCKED`. Soft-blocked dependents are unaffected.
- The Dependency Module runs as part of the reconciliation loop, not only on individual transitions, to catch any missed recalculations.

#### Entity: TaskLease

- `lease_id`
- `task_id`
- `worker_id`
- `pool_id`
- `leased_at`
- `expires_at`
- `heartbeat_at`
- `status`
- `reclaim_reason`
- `partial_result_artifact_refs` (artifact paths captured on lease reclaim for crash recovery)

#### Entity: WorkerPool

- `pool_id`
- `name`
- `pool_type` (developer/reviewer/lead-reviewer/merge-assist/planner)
- `provider`
- `runtime`
- `model`
- `max_concurrency`
- `default_timeout_sec`
- `default_token_budget`
- `cost_profile`
- `capabilities`
- `repo_scope_rules`
- `enabled`
- `created_at`
- `updated_at`

#### Entity: Worker

- `worker_id`
- `pool_id`
- `name`
- `status`
- `host`
- `runtime_version`
- `last_heartbeat_at`
- `current_task_id`
- `current_run_id`
- `health_metadata`

#### Entity: AgentProfile

- `agent_profile_id`
- `pool_id`
- `prompt_template_id`
- `tool_policy_id`
- `command_policy_id`
- `file_scope_policy_id`
- `validation_policy_id`
- `review_policy_id`
- `budget_policy_id`
- `retry_policy_id`

#### Entity: PromptTemplate

- `prompt_template_id`
- `name`
- `version`
- `role`
- `template_text`
- `input_schema`
- `output_schema`
- `stop_conditions`
- `created_at`

#### Entity: TaskPacket

- `task_packet_id`
- `task_id`
- `version`
- `packet_json`
- `created_at`

#### Entity: DevResultPacket

- `dev_result_packet_id`
- `task_id`
- `run_id`
- `branch_name`
- `commit_sha`
- `packet_json`
- `created_at`

#### Entity: ReviewPacket

- `review_packet_id`
- `task_id`
- `review_cycle_id`
- `reviewer_pool_id`
- `reviewer_type`
- `verdict`
- `severity_summary`
- `packet_json`
- `created_at`

#### Entity: LeadReviewDecision

- `lead_review_decision_id`
- `task_id`
- `review_cycle_id`
- `decision`
- `blocking_issue_count`
- `non_blocking_issue_count`
- `follow_up_task_refs`
- `packet_json`
- `created_at`

#### Entity: ReviewCycle

- `review_cycle_id`
- `task_id`
- `status`
- `required_reviewers`
- `optional_reviewers`
- `started_at`
- `completed_at`

**Lifecycle rules:**

- Each rework cycle (CHANGES_REQUESTED → ASSIGNED → … → IN_REVIEW) creates a new ReviewCycle.
- A task may have many ReviewCycle records over time but only one active (non-terminal status) at a time.
- When the lead reviewer emits `changes_requested`, the current ReviewCycle closes with status `REJECTED`.
- `Task.review_round_count` increments each time a ReviewCycle completes with `REJECTED` status.
- `Task.current_review_cycle_id` points to the latest ReviewCycle. Completed cycles remain for audit.

### 2.6 Counter Semantics

- `Task.retry_count` increments each time a task re-enters `ASSIGNED` from `FAILED` (automatic retry). It does NOT increment for rework after `CHANGES_REQUESTED` (that is review-driven reassignment, not a retry).
- `Task.review_round_count` increments each time a ReviewCycle completes with `REJECTED` status triggering rework. It resets to `0` only if the task is reopened from `DONE`.
- Both counters have independent policy thresholds defined in the escalation policy (see `docs/009-policy-and-enforcement-spec.md`).
- When either counter exceeds its threshold, the escalation policy determines whether the task moves to `ESCALATED` or `FAILED`.

### 2.7 Escalation Trigger Conditions

A task transitions to `ESCALATED` when any of the following occur:

- `retry_count` exceeds `escalation_policy.max_retries` threshold
- `review_round_count` exceeds `escalation_policy.max_review_rounds` threshold
- total cost for the task exceeds `budget_policy.max_task_cost`
- elapsed wall-clock time since first `ASSIGNED` exceeds `escalation_policy.max_task_elapsed_seconds`
- a security-sensitive policy violation is detected during execution
- the lead reviewer explicitly chooses `escalated` as their decision
- validation failures exceed `escalation_policy.max_validation_failures` in a single run
- the post-merge analysis agent recommends escalation
- an operator manually escalates via the UI/API

The escalation policy may specify `escalate` (move to ESCALATED immediately) or `fail_then_escalate` (move to FAILED first, escalate if retry is not eligible) for each trigger.

### 2.8 Worker Lease Protocol

#### Heartbeat Protocol

- Workers must send a heartbeat every `lease_policy.heartbeat_interval_seconds` (default: 30s).
- A worker is stale after missing `lease_policy.missed_heartbeat_threshold` consecutive intervals plus `lease_policy.grace_period_seconds`.
- Stale detection triggers lease reclaim: workspace snapshot captured as `partial_result_artifact_refs`, lease status → `TIMED_OUT`.

#### Lease Renewal

- Workers cannot extend `lease_policy.lease_ttl_seconds`. The TTL is an absolute upper bound.
- If work cannot complete within TTL, the worker should emit a partial result and signal `status: "partial"` before expiry.

#### Graceful Completion

- When a worker finishes, it must send a terminal heartbeat with `completing: true` before emitting the result packet.
- The lease manager extends the grace period by `grace_period_seconds` upon receiving a terminal heartbeat to avoid race conditions.
- A result packet received within `grace_period_seconds` after a lease is marked stale must still be accepted if it is schema-valid and IDs match.

#### Crash Recovery

- On lease reclaim (TIMED_OUT or CRASHED), the orchestrator snapshots the workspace state as partial artifacts.
- The next retry receives `context.prior_partial_work` in its TaskPacket, referencing the partial artifacts.
- If no retry is eligible, the task transitions to `FAILED` or `ESCALATED` per escalation policy.

#### Lease State → Task State Mapping

| Lease Terminal State   | Task Transition              | Condition                  |
| ---------------------- | ---------------------------- | -------------------------- |
| `COMPLETING` (success) | Per result packet            | Normal flow                |
| `TIMED_OUT`            | `FAILED` or re-enter `READY` | Based on retry eligibility |
| `CRASHED`              | `FAILED` or re-enter `READY` | Based on retry eligibility |
| `RECLAIMED` (operator) | `ESCALATED` or `CANCELLED`   | Based on operator action   |

#### Distinction Between Lease States

- `TIMED_OUT`: worker missed heartbeats or exceeded TTL; may have been working but became unresponsive.
- `CRASHED`: worker process exited with non-zero status or was killed by the OS; detected via exit code monitoring.
- `RECLAIMED`: operator or policy explicitly revoked the lease (e.g., pool shutdown, emergency intervention).

### 2.9 Workspace Lifecycle Rules

- Terminal states for workspace cleanup are `DONE`, `FAILED`, and `CANCELLED`.
- Workspaces for `ESCALATED` tasks are retained until operator resolution.
- Workspace retention period after reaching a terminal state is governed by `retention_policy.workspace_retention_hours` (default: 24h).
- If a task transitions from `FAILED` back to `READY` for retry, the existing workspace is reused if still available; otherwise a new workspace is created.
- A scheduled `ReconcileWorkspacesCommand` runs periodically (recommended: hourly) to remove expired workspaces and delete merged branches.
- Branch cleanup follows workspace cleanup: merged branches are deleted after workspace removal; unmerged branches for terminal tasks are deleted after the retention period.

#### Entity: MergeQueueItem

- `merge_queue_item_id`
- `task_id`
- `repository_id`
- `status`
- `position`
- `approved_commit_sha`
- `enqueued_at`
- `started_at`
- `completed_at`

#### Entity: ValidationRun

- `validation_run_id`
- `task_id`
- `run_scope`
- `status`
- `tool_name`
- `summary`
- `artifact_refs`
- `started_at`
- `completed_at`

**run_scope values:** `pre-dev`, `during-dev`, `pre-review`, `pre-merge`, `post-merge`

**Validation gate rules:**

- `IN_DEVELOPMENT → DEV_COMPLETE` requires all `required_checks` in the `default-dev` validation profile to pass. Optional checks may be deferred.
- `APPROVED → QUEUED_FOR_MERGE` does not re-validate; it uses the existing validation results from the review phase.
- `MERGING → POST_MERGE_VALIDATION` runs the `merge-gate` validation profile (see `docs/009-policy-and-enforcement-spec.md`).
- `POST_MERGE_VALIDATION → DONE` requires all `required_checks` in the `merge-gate` profile to pass.
- Failed required validations at any gate block the transition and emit a `validation_result_packet` with `status: "failed"`.

#### Entity: AuditEvent

- `audit_event_id`
- `entity_type`
- `entity_id`
- `event_type`
- `actor_type`
- `actor_id`
- `old_state`
- `new_state`
- `metadata_json`
- `created_at`

#### Entity: PolicySet

- `policy_set_id`
- `name`
- `version`
- `scheduling_policy_json`
- `review_policy_json`
- `merge_policy_json`
- `security_policy_json`
- `validation_policy_json`
- `budget_policy_json`
- `created_at`

#### Entity: Job

- `job_id`
- `job_type` (scheduler_tick/worker_dispatch/reviewer_dispatch/lead_review_consolidation/merge_dispatch/validation_execution/reconciliation_sweep/cleanup)
- `entity_type`
- `entity_id`
- `payload_json`
- `status` (pending/claimed/running/completed/failed/cancelled)
- `attempt_count`
- `run_after`
- `lease_owner`
- `parent_job_id` (nullable; references a parent job that spawned this job)
- `job_group_id` (nullable; groups related jobs, e.g., all specialist reviewer jobs in one review cycle)
- `depends_on_job_ids` (nullable JSON array; this job cannot start until all listed jobs reach terminal status)
- `created_at`
- `updated_at`

**Job coordination rules:**

- A job with non-null `depends_on_job_ids` cannot be dispatched until all referenced jobs are in terminal status (`completed` or `failed`).
- Review cycle coordination: the Review Module creates one reviewer_dispatch job per specialist reviewer sharing the same `job_group_id`. The lead_review_consolidation job is created with `depends_on_job_ids` referencing all specialist jobs.

### 2.4 Important Relationships

- Project has many Repositories
- Repository has many Tasks
- Task has many Dependencies
- Task has many Packets and Runs
- Task has zero or one active Lease
- Task has many ReviewCycles
- ReviewCycle has many ReviewPackets and one LeadReviewDecision
- Task may have one MergeQueueItem
- Worker belongs to WorkerPool
- WorkerPool uses one or more AgentProfiles
- Policies and Templates are referenced by pools, projects, or repositories

### 2.5 Suggested Storage Model

- relational DB for operational state
- object/filesystem store for large artifacts and logs
- event log table for replay/audit
- optional search index for prompt/results/log exploration

---
