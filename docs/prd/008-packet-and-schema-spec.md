# Packet and Schema Specification

## 8.1 Purpose

This document defines the canonical packet shapes used for artifact-based handoffs between the deterministic control plane and worker/validation stages.

The goals are:

* machine-validatable contracts
* stable versioned packets
* bounded context for each worker
* reproducible execution and review

All packet producers and consumers must treat the schemas in this document as the canonical V1 contract.

## 8.2 Common Rules

### 8.2.1 Versioning

Every packet must include:

* `packet_type`
* `schema_version`
* `created_at`

V1 uses `schema_version: "1.0"`.

Backward-incompatible changes require a new schema version. Additive optional fields may remain within the same minor version.

### 8.2.2 Identity and References

Every packet that belongs to a task must include:

* `task_id`
* `repository_id`

Packets that belong to a specific execution/review/merge stage must also include the relevant ID:

* `run_id`
* `review_cycle_id`
* `merge_queue_item_id`
* `validation_run_id`

### 8.2.3 Status Semantics

Packet-level execution status must use:

* `success`
* `failed`
* `partial`
* `blocked`

Task state remains owned by the orchestrator and must not be inferred directly from packet status.

### 8.2.4 Evidence and Artifacts

Packets may reference large outputs instead of embedding them inline.

Use:

* `artifact_refs`: list of relative artifact paths or content-addressed IDs
* `summary`: short human-readable synopsis
* `details`: structured machine-readable payload

## 8.3 Shared Types

### 8.3.1 FileChangeSummary

```json
{
  "path": "apps/control-plane/src/modules/tasks/service.ts",
  "change_type": "modified",
  "summary": "Added readiness recomputation after dependency resolution"
}
```

Fields:

* `path`: repository-relative path
* `change_type`: `added | modified | deleted | renamed`
* `summary`: short explanation

### 8.3.2 Issue

```json
{
  "severity": "high",
  "code": "missing-validation",
  "title": "Validation runner result not persisted",
  "description": "The implementation finishes the run but drops machine-readable validation output.",
  "file_path": "packages/application/src/validation/run.ts",
  "line": 84,
  "blocking": true
}
```

Fields:

* `severity`: `critical | high | medium | low`
* `code`: stable issue identifier
* `title`
* `description`
* `file_path` (optional)
* `line` (optional)
* `blocking`

### 8.3.3 ValidationCheckResult

```json
{
  "check_type": "test",
  "tool_name": "pnpm",
  "command": "pnpm test --filter control-plane",
  "status": "passed",
  "duration_ms": 12450,
  "summary": "42 tests passed"
}
```

Fields:

* `check_type`: `test | lint | build | typecheck | policy | schema | security`
* `tool_name`
* `command`
* `status`: `passed | failed | skipped`
* `duration_ms`
* `summary`
* `artifact_refs` (optional)

## 8.4 TaskPacket

### 8.4.1 Purpose

The TaskPacket is the canonical input to planner, developer, reviewer, merge-assist, and validation stages. It is assembled by the orchestrator and contains all stage-relevant context.

### 8.4.2 Canonical Shape

```json
{
  "packet_type": "task_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:00:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "task": {
    "title": "Implement lease expiry reconciliation",
    "description": "Recover stale task leases and reschedule timed-out work.",
    "task_type": "backend-feature",
    "priority": "high",
    "severity": "medium",
    "acceptance_criteria": [
      "Reclaim expired leases deterministically",
      "Emit audit events on reclaim"
    ],
    "definition_of_done": [
      "Implementation complete",
      "Required validations pass"
    ],
    "risk_level": "medium",
    "suggested_file_scope": [
      "apps/control-plane/src/modules/leases/**",
      "packages/domain/src/leases/**"
    ],
    "branch_name": "factory/task-123"
  },
  "repository": {
    "name": "software-factory",
    "default_branch": "main"
  },
  "role": "developer",
  "time_budget_seconds": 1800,
  "expires_at": "2026-03-10T00:30:00Z",
  "workspace": {
    "worktree_path": "/workspaces/repo-1/task-123/worktree",
    "artifact_root": "/artifacts/repositories/repo-1/tasks/task-123"
  },
  "context": {
    "related_tasks": [],
    "dependencies": [],
    "rejection_context": null,
    "code_map_refs": [],
    "prior_partial_work": null
  },
  "repo_policy": {
    "policy_set_id": "policy-default"
  },
  "tool_policy": {
    "command_policy_id": "cmd-default",
    "file_scope_policy_id": "scope-task-default"
  },
  "validation_requirements": {
    "profile": "default-dev"
  },
  "stop_conditions": [
    "Return a schema-valid output packet",
    "Do not broaden scope outside suggested file scope without declaring it"
  ],
  "expected_output": {
    "packet_type": "dev_result_packet",
    "schema_version": "1.0"
  }
}
```

### 8.4.3 Required Top-Level Fields

* `packet_type`
* `schema_version`
* `created_at`
* `task_id`
* `repository_id`
* `role` (enum: `planner | developer | reviewer | lead-reviewer | merge-assist | post-merge-analysis`)
* `time_budget_seconds`
* `expires_at`
* `task`
* `repository`
* `workspace`
* `repo_policy`
* `tool_policy`
* `validation_requirements`
* `stop_conditions`
* `expected_output`

## 8.5 DevResultPacket

### 8.5.1 Purpose

The DevResultPacket is the canonical output from a developer worker.

### 8.5.2 Canonical Shape

```json
{
  "packet_type": "dev_result_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:15:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "run_id": "run-456",
  "status": "success",
  "summary": "Implemented stale lease reconciliation and audit emission.",
  "result": {
    "branch_name": "factory/task-123",
    "commit_sha": "abc123",
    "files_changed": [
      {
        "path": "apps/control-plane/src/modules/leases/reconcile.ts",
        "change_type": "modified",
        "summary": "Added expiry sweep and reclaim logic"
      }
    ],
    "tests_added_or_updated": [
      "packages/testing/src/leases/reconcile.spec.ts"
    ],
    "validations_run": [
      {
        "check_type": "test",
        "tool_name": "pnpm",
        "command": "pnpm test --filter leases",
        "status": "passed",
        "duration_ms": 8200,
        "summary": "8 tests passed"
      }
    ],
    "assumptions": [
      "Lease expiry uses wall-clock time from persisted timestamps"
    ],
    "risks": [],
    "unresolved_issues": []
  },
  "artifact_refs": [
    "runs/run-456/logs/developer.log",
    "runs/run-456/outputs/diff.patch"
  ]
}
```

### 8.5.3 Required Fields

* `packet_type`
* `schema_version`
* `created_at`
* `task_id`
* `repository_id`
* `run_id`
* `status`
* `summary`
* `result.branch_name`
* `result.files_changed`
* `result.validations_run`

## 8.6 ReviewPacket

### 8.6.1 Purpose

The ReviewPacket is the output from a specialist reviewer.

### 8.6.2 Canonical Shape

```json
{
  "packet_type": "review_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:20:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "review_cycle_id": "review-1",
  "reviewer_pool_id": "security-reviewers",
  "reviewer_type": "security",
  "verdict": "changes_requested",
  "summary": "One blocking issue found.",
  "blocking_issues": [
    {
      "severity": "high",
      "code": "unsafe-shell",
      "title": "Command wrapper bypasses allowlist",
      "description": "The implementation executes a raw shell string without policy validation.",
      "file_path": "packages/infrastructure/src/runner/exec.ts",
      "line": 61,
      "blocking": true
    }
  ],
  "non_blocking_issues": [],
  "confidence": "high",
  "follow_up_task_refs": [],
  "risks": [],
  "open_questions": []
}
```

### 8.6.3 Rules

* `verdict` must be one of `approved | changes_requested | escalated`.
* `blocking_issues` must be empty when `verdict` is `approved`.
* Each issue must include `blocking: true` if placed in `blocking_issues`.

## 8.7 LeadReviewDecisionPacket

### 8.7.1 Purpose

This packet is the canonical output from the lead reviewer after consolidating specialist reviews.

### 8.7.2 Canonical Shape

```json
{
  "packet_type": "lead_review_decision_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:25:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "review_cycle_id": "review-1",
  "decision": "approved",
  "summary": "No remaining blockers after consolidating specialist reviews.",
  "blocking_issues": [],
  "non_blocking_suggestions": [],
  "deduplication_notes": [],
  "follow_up_task_refs": [],
  "risks": [],
  "open_questions": []
}
```

### 8.7.3 Rules

* `decision` must be one of `approved | approved_with_follow_up | changes_requested | escalated`.
* The lead reviewer may only emit `changes_requested` if at least one blocking issue remains after consolidation.

## 8.8 MergePacket

### 8.8.1 Purpose

The MergePacket captures the machine-readable result of merge preparation and integration.

### 8.8.2 Canonical Shape

```json
{
  "packet_type": "merge_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:30:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "merge_queue_item_id": "merge-7",
  "status": "success",
  "summary": "Rebased on main and merged cleanly.",
  "details": {
    "source_branch": "factory/task-123",
    "target_branch": "main",
    "approved_commit_sha": "abc123",
    "merged_commit_sha": "def456",
    "merge_strategy": "rebase-and-merge",
    "rebase_performed": true,
    "validation_results": []
  },
  "artifact_refs": [
    "merges/merge-7/merge.log"
  ]
}
```

## 8.9 MergeAssistPacket

### 8.9.1 Purpose

The MergeAssistPacket is the output from the optional Merge Assist Agent when AI-assisted conflict resolution is invoked.

### 8.9.2 Canonical Shape

```json
{
  "packet_type": "merge_assist_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:28:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "merge_queue_item_id": "merge-7",
  "recommendation": "auto_resolve",
  "confidence": "high",
  "summary": "Single conflict in imports resolved by combining both additions.",
  "resolution_strategy": "Combined import statements from both branches preserving all additions.",
  "files_affected": [
    {
      "path": "apps/control-plane/src/modules/leases/index.ts",
      "conflict_type": "both_modified",
      "resolution_summary": "Merged import lists from both branches"
    }
  ],
  "rationale": "Conflict is limited to additive import changes with no semantic overlap.",
  "risks": [],
  "open_questions": []
}
```

### 8.9.3 Rules

* `recommendation` must be one of `auto_resolve | reject_to_dev | escalate`.
* `confidence` must be one of `high | medium | low`.
* If `confidence` is `low`, `recommendation` must be `reject_to_dev` or `escalate`.
* The merge module validates that `files_affected` are within the original approved diff scope.

## 8.10 ValidationResultPacket

### 8.10.1 Purpose

The ValidationResultPacket is the canonical output from deterministic validation.

### 8.10.2 Canonical Shape

```json
{
  "packet_type": "validation_result_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:18:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "validation_run_id": "validation-55",
  "status": "success",
  "summary": "Required test and lint checks passed.",
  "details": {
    "run_scope": "pre-review",
    "checks": [
      {
        "check_type": "test",
        "tool_name": "pnpm",
        "command": "pnpm test --filter control-plane",
        "status": "passed",
        "duration_ms": 6400,
        "summary": "42 tests passed"
      },
      {
        "check_type": "lint",
        "tool_name": "pnpm",
        "command": "pnpm lint",
        "status": "passed",
        "duration_ms": 2200,
        "summary": "No lint errors"
      }
    ]
  }
}
```

## 8.11 PostMergeAnalysisPacket

### 8.11.1 Purpose

The PostMergeAnalysisPacket is the output from the Post-Merge Analysis Agent when post-merge validation fails and the agent is enabled.

### 8.11.2 Canonical Shape

```json
{
  "packet_type": "post_merge_analysis_packet",
  "schema_version": "1.0",
  "created_at": "2026-03-10T00:35:00Z",
  "task_id": "task-123",
  "repository_id": "repo-1",
  "merge_queue_item_id": "merge-7",
  "validation_run_id": "validation-56",
  "recommendation": "revert",
  "confidence": "high",
  "summary": "Merged change introduced a regression in lease reconciliation tests.",
  "failure_attribution": "The merged change modified reconcile.ts which directly caused 3 test failures in reconcile.spec.ts.",
  "rationale": "All failing tests exercise code paths modified by this merge. No other recent merges touch these files.",
  "suggested_revert_scope": {
    "commits": ["def456"],
    "files": ["apps/control-plane/src/modules/leases/reconcile.ts"]
  },
  "follow_up_task_description": null,
  "risks": [],
  "open_questions": []
}
```

### 8.11.3 Rules

* `recommendation` must be one of `revert | hotfix_task | escalate | pre_existing`.
* `confidence` must be one of `high | medium | low`.
* If `confidence` is `low`, `recommendation` must be `escalate`.
* If `recommendation` is `revert`, `suggested_revert_scope` must be non-null.
* If `recommendation` is `hotfix_task`, `follow_up_task_description` must be non-null.
* If `recommendation` is `pre_existing`, the orchestrator should not revert but may create a diagnostic task.

## 8.12 RejectionContext

When a task is reworked after `CHANGES_REQUESTED`, the next TaskPacket must include `context.rejection_context`.

**Conditional rules:**

* On initial task attempts, `context.rejection_context` must be `null`.
* On rework attempts (after `CHANGES_REQUESTED → ASSIGNED`), `context.rejection_context` must be a valid RejectionContext object.
* On retry attempts (after `FAILED` with retry eligible), `context.rejection_context` remains `null` but `context.prior_partial_work` may reference partial artifacts from the failed run.

Canonical shape:

```json
{
  "prior_review_cycle_id": "review-1",
  "blocking_issues": [
    {
      "severity": "high",
      "code": "unsafe-shell",
      "title": "Command wrapper bypasses allowlist",
      "description": "The implementation executes a raw shell string without policy validation.",
      "blocking": true
    }
  ],
  "lead_decision_summary": "Address blocking security review issue before re-review."
}
```

## 8.13 Minimal JSON Schema Requirements

Every concrete packet schema must enforce:

* exact `packet_type`
* required top-level fields
* enum validation for statuses and decisions
* rejection of unknown fields where stability matters
* string format validation for timestamps

V1 may define these schemas in JSON Schema, Zod, or TypeBox, but one machine-readable source of truth must be generated and shared across producers and consumers.

Additionally, schema validation must enforce these cross-field invariants:

* ReviewPacket: `blocking_issues` must be empty when `verdict` is `approved`
* LeadReviewDecisionPacket: `changes_requested` requires at least one entry in `blocking_issues`
* LeadReviewDecisionPacket: `approved_with_follow_up` requires non-empty `follow_up_task_refs`
* MergeAssistPacket: `confidence: "low"` requires `recommendation` to be `reject_to_dev` or `escalate`
* PostMergeAnalysisPacket: `confidence: "low"` requires `recommendation` to be `escalate`

V1 must use **Zod** as the schema validation library for TypeScript type inference and runtime validation. JSON Schema export may be generated from Zod schemas for cross-language consumers if needed later.

## 8.14 Implementation Rule

No worker result may be accepted into the orchestrator unless:

1. the packet parses successfully
2. the packet validates against the declared schema version
3. all required IDs match the orchestrator context for the run
4. referenced artifacts exist or are recorded as failed outputs

## 8.15 Schema Versioning and Compatibility

### Version Format

Schema versions use `major.minor` format (e.g., `"1.0"`, `"1.1"`, `"2.0"`).

* Minor version increments: additive optional fields only. Existing consumers must not break.
* Major version increments: breaking changes (removed fields, type changes, new required fields).

### Multi-Version Support

The orchestrator must support validating packets against any schema version within the current major version:

* A worker assigned under schema `1.0` may emit a `1.0` packet even if the system has upgraded to `1.1`.
* The orchestrator must accept any valid packet within the same major version family.
* Cross-major-version packets are rejected. Workers assigned under a previous major version that have not completed must be reclaimed and re-dispatched with updated schemas.

### In-Flight Work During Upgrades

* Minor version upgrades: no action needed. In-flight workers continue with their assigned schema version.
* Major version upgrades: all in-flight workers must complete or be reclaimed before the upgrade is committed. The orchestrator should drain active leases before applying a major schema change.

### Artifact Versioning

Stored packet artifacts retain their original `schema_version`. The Artifact Service must be able to deserialize packets at any previously supported schema version for audit and replay.
