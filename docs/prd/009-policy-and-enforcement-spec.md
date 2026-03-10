# Policy and Enforcement Specification

## 9.1 Purpose

This document defines the concrete policy model and enforcement behavior for V1. It covers command execution, file scope, validation, retries, escalations, leases, heartbeats, timeouts, and retention.

The control plane owns policy resolution. Workers receive the resolved effective policy snapshot for their run and must not reinterpret policy from first principles.

## 9.2 Effective Policy Snapshot

Every run must persist a resolved effective policy snapshot with this top-level structure:

```json
{
  "policy_snapshot_version": "1.0",
  "policy_set_id": "policy-default",
  "command_policy": {},
  "file_scope_policy": {},
  "validation_policy": {},
  "retry_policy": {},
  "escalation_policy": {},
  "lease_policy": {},
  "retention_policy": {},
  "review_policy": {}
}
```

This snapshot is immutable for the life of a run.

## 9.3 Command Policy

### 9.3.1 Purpose

Command policy defines what a worker is allowed to execute and how execution is mediated.

### 9.3.2 Canonical Shape

```json
{
  "mode": "allowlist",
  "allowed_commands": [
    {
      "command": "pnpm",
      "allowed_args_prefixes": ["install", "test", "lint", "build", "dev", "exec", "db:migrate", "seed"]
    },
    {
      "command": "git",
      "allowed_args_prefixes": ["status", "diff", "show", "checkout", "switch", "branch", "worktree", "add", "commit", "rebase", "merge"]
    }
  ],
  "denied_patterns": [
    "rm -rf /",
    "curl * | sh",
    "sudo *",
    "ssh *"
  ],
  "allow_shell_compound_commands": false,
  "allow_subshells": false,
  "allow_env_expansion": false,
  "forbidden_arg_patterns": [
    "git checkout -f",
    "git checkout -- *",
    "git push --force",
    "git reset --hard",
    "pnpm db:migrate --force"
  ]
}
```

### 9.3.3 Enforcement Rules

* All command execution must pass through a policy-aware wrapper owned by the runtime adapter.
* The wrapper must receive structured command arguments, not raw shell strings, unless an explicit shell mode is allowed.
* Default V1 behavior is deny-by-default with command allowlists.
* Shell compound commands, subshells, and dynamic command construction are denied unless the effective policy explicitly permits them.
* A denied command attempt produces a policy violation artifact and fails the run or escalates according to escalation policy.
* `forbidden_arg_patterns` are evaluated after allowlist matching. A command that passes the allowlist but matches a forbidden pattern is still denied.
* Patterns use simple glob matching where `*` matches any remaining arguments.

## 9.4 File Scope Policy

### 9.4.1 Canonical Shape

```json
{
  "read_roots": [
    "apps/control-plane/",
    "packages/domain/",
    "docs/"
  ],
  "write_roots": [
    "apps/control-plane/",
    "packages/domain/"
  ],
  "deny_roots": [
    ".github/workflows/",
    "secrets/",
    "infra/production/"
  ],
  "allow_read_outside_scope": true,
  "allow_write_outside_scope": false,
  "on_violation": "fail_run"
}
```

### 9.4.2 Enforcement Rules

* Read access outside `read_roots` is denied unless `allow_read_outside_scope` is true.
* Write access is only permitted within `write_roots`.
* Any write under `deny_roots` is always denied.
* V1 enforcement may combine preflight path checks with post-run diff validation. If both are available, both should be used.
* Default V1 behavior: read access may exceed task file scope when needed for context, but writes must remain within allowed roots unless a human/operator override is present.

**Precedence rules when roots overlap:**

1. `deny_roots` takes highest precedence — always denied for both read and write.
2. `write_roots` — write and read access permitted.
3. `read_roots` — read-only access permitted; writes denied even if `allow_write_outside_scope` were hypothetically true.
4. Paths not in any root — governed by `allow_read_outside_scope` (for reads) and `allow_write_outside_scope` (for writes).

## 9.5 Validation Policy

### 9.5.1 Canonical Shape

```json
{
  "profiles": {
    "default-dev": {
      "required_checks": ["test", "lint"],
      "optional_checks": ["build"],
      "commands": {
        "test": "pnpm test",
        "lint": "pnpm lint",
        "build": "pnpm build"
      },
      "fail_on_skipped_required_check": true
    },
    "merge-gate": {
      "required_checks": ["test", "build"],
      "optional_checks": ["lint"],
      "commands": {
        "test": "pnpm test",
        "build": "pnpm build",
        "lint": "pnpm lint"
      },
      "fail_on_skipped_required_check": true
    }
  }
}
```

### 9.5.2 Rules

* Validation profile selection is deterministic from task type, repository config, and workflow template.
* Required checks must pass before the orchestrator can move a task into the next gated phase.
* Validation results must be emitted as `validation_result_packet`.

### 9.5.3 Profile Selection Algorithm

Profile selection follows this precedence order:

1. **Task-level override**: if the TaskPacket specifies `validation_requirements.profile`, use it.
2. **Repository workflow template**: if the task's workflow template specifies a validation profile for the current stage, use it.
3. **Task type default**: if the repository config maps the task's `task_type` to a profile, use it.
4. **System default**: use `default-dev` for development stages and `merge-gate` for merge/post-merge stages.

**Error handling:**

* If the resolved profile name does not exist in the policy snapshot, the orchestrator must fail the transition and emit a `missing_validation_profile` audit event.
* Profiles are not inheritable in V1. Each profile must be self-contained with its own `required_checks`, `optional_checks`, and `commands`.

## 9.6 Retry Policy

### 9.6.1 Canonical Shape

```json
{
  "max_attempts": 2,
  "backoff_strategy": "exponential",
  "initial_backoff_seconds": 60,
  "max_backoff_seconds": 900,
  "reuse_same_pool": true,
  "allow_pool_change_after_failure": true,
  "require_failure_summary_packet": true
}
```

### 9.6.2 Rules

* `max_attempts` counts retries after the initial attempt.
* A run may be retried automatically only for retry-eligible failure classes such as transient infrastructure failure, timeout, or non-deterministic tool crash.
* Rework after `CHANGES_REQUESTED` is not counted as an automatic retry; it is a review-driven reassignment with rejection context.
* Once `max_attempts` is exceeded, the task must move to `ESCALATED` or `FAILED` according to escalation policy.

## 9.7 Escalation Policy

### 9.7.1 Canonical Shape

```json
{
  "triggers": {
    "max_retry_exceeded": "escalate",
    "max_review_rounds_exceeded": "escalate",
    "policy_violation": "escalate",
    "merge_failure_after_retries": "escalate",
    "heartbeat_timeout": "retry_or_escalate",
    "schema_validation_failure": "fail_and_escalate",
    "repeated_schema_failures": "disable_profile_and_escalate"
  },
  "route_to": "operator-queue",
  "require_summary": true
}
```

### 9.7.2 Required Trigger Cases

V1 must support escalation at minimum for:

* max automatic retries exceeded
* review round limit exceeded
* repeated merge failure
* security-sensitive policy violation
* unresolved ambiguity where safe autonomous action is not possible

Escalation routes to a human/operator queue by default.

## 9.8 Lease and Heartbeat Policy

### 9.8.1 Canonical Shape

```json
{
  "lease_ttl_seconds": 1800,
  "heartbeat_interval_seconds": 30,
  "missed_heartbeat_threshold": 2,
  "grace_period_seconds": 15,
  "reclaim_action": "mark_timed_out_and_requeue"
}
```

### 9.8.2 Protocol Rules

* Heartbeats are push-based from worker process to control plane or supervisor.
* Workers must send a heartbeat every `heartbeat_interval_seconds`.
* A worker is considered stale after `missed_heartbeat_threshold` missed intervals plus grace period.
* On stale detection, the lease manager marks the run timed out, records an audit event, and applies retry/escalation policy.
* Lease TTL is an upper bound even if heartbeats continue.

#### Graceful Completion Protocol

* Before emitting a result packet, the worker must send a terminal heartbeat with a `completing: true` flag.
* Upon receiving a terminal heartbeat, the lease manager extends the stale-detection window by `grace_period_seconds` to avoid race conditions.
* A result packet received within `grace_period_seconds` after a lease is marked stale must still be accepted if it is schema-valid and all IDs match the run context.

#### Network Partition Handling

* If a worker cannot reach the control plane to send heartbeats, it should continue working but must emit its result packet to the workspace filesystem as a fallback.
* On lease reclaim, the orchestrator checks the workspace for a filesystem-persisted result packet before marking the run as lost.
* V1 does not require heartbeat acknowledgment from the control plane. Future versions may add bidirectional heartbeats for partition detection.

### 9.8.3 Default Values

Recommended V1 defaults:

* development lease TTL: 30 minutes
* reviewer lease TTL: 10 minutes
* merge worker lease TTL: 15 minutes
* heartbeat interval: 30 seconds

## 9.9 Review Policy

### 9.9.1 Canonical Shape

```json
{
  "max_review_rounds": 3,
  "required_reviewer_types": ["general"],
  "optional_reviewer_types": ["security", "performance"],
  "lead_reviewer_required": true
}
```

### 9.9.2 Rules

* `max_review_rounds` defaults to `3`.
* Exceeding the review round limit triggers escalation.
* Review routing may add optional reviewers based on file/path/risk rules, but the lead reviewer is always required for final decision.

## 9.10 Retention and Cleanup Policy

### 9.10.1 Canonical Shape

```json
{
  "workspace_retention_hours": 24,
  "artifact_retention_days": 30,
  "retain_failed_workspaces": true,
  "retain_escalated_workspaces": true
}
```

### 9.10.2 Rules

* Terminal cleanup states for workspaces are `DONE`, `FAILED`, and `CANCELLED`.
* `ESCALATED` workspaces are retained by default until operator resolution.
* Failed workspaces are retained by default for debugging and replay.

## 9.11 Post-Merge Failure Policy

When `POST_MERGE_VALIDATION` fails, the orchestrator applies a severity-based decision tree:

### 9.11.1 Severity Classification

The validation result's overall status and the number/severity of failing checks determine failure severity:

* **critical**: any security check fails, or more than `post_merge_failure_policy.critical_check_threshold` required checks fail
* **high**: any required check fails but does not meet critical threshold
* **low**: only optional checks fail

### 9.11.2 Response by Severity

| Severity | Automatic Action | Merge Queue | Operator Notification |
|---|---|---|---|
| `critical` | Generate revert task immediately | Pause queue for affected repository | Immediate alert; queue stays paused until operator confirms resume |
| `high` | Invoke post-merge analysis agent (if enabled) | Continue processing queue | Alert operator; await agent recommendation or operator decision |
| `low` | Create diagnostic follow-up task | Continue processing queue | Informational notification |

### 9.11.3 Post-Merge Analysis Agent Integration

When the post-merge analysis agent is enabled and failure severity is `high`:

1. Orchestrator invokes the agent with failure evidence.
2. Agent emits a PostMergeAnalysisPacket with recommendation.
3. Orchestrator applies the recommendation per policy:
   * `revert` → generate revert task, optionally pause queue
   * `hotfix_task` → create follow-up task with priority boost
   * `escalate` → move to operator queue
   * `pre_existing` → create diagnostic task, do not revert

When the agent is unavailable or disabled, `high` severity failures default to generating a revert task and alerting the operator.

### 9.11.4 Default V1 Post-Merge Failure Policy

```json
{
  "critical_check_threshold": 3,
  "auto_revert_on_critical": true,
  "pause_queue_on_critical": true,
  "use_analysis_agent_on_high": true,
  "default_high_action": "revert",
  "require_operator_resume_after_pause": true
}
```

## 9.11.5 Merge Strategy Policy

### Canonical Shape

```json
{
  "default_strategy": "rebase-and-merge",
  "allowed_strategies": ["rebase-and-merge", "squash", "merge-commit"],
  "conflict_classification": {
    "max_conflict_files": 5,
    "protected_paths": [".github/", "package.json", "pnpm-lock.yaml"],
    "reworkable_default": true
  },
  "merge_assist": {
    "enabled": false,
    "max_assist_conflict_files": 3,
    "require_high_confidence": true
  }
}
```

### Rules

* The merge module uses the strategy specified by the effective policy. Task-level overrides may select from `allowed_strategies`.
* Merge conflict classification is deterministic based on `conflict_classification` thresholds. The merge assist agent is advisory only.
* If merge assist is enabled and confidence is below `high` when `require_high_confidence` is true, the recommendation is ignored and the conflict is classified by the deterministic rules.

## 9.12 Configuration Precedence

The canonical precedence order is:

1. system defaults
2. environment/profile defaults
3. organization/project defaults
4. repository workflow template
5. pool configuration
6. task-type overrides
7. task-level override
8. operator emergency override

Every effective policy snapshot must record the resolved value and the source layer that supplied it.
