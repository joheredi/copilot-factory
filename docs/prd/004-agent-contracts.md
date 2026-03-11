# Agent Prompts / Contracts

### 4.1 General Contract Design Principles

All agents must:

- act only within their assigned role
- operate on one task or one review cycle only
- consume structured input
- produce structured output
- never self-assign or self-transition task state
- stop when completion criteria are met
- surface uncertainty explicitly
- avoid broad repo exploration unless permitted

### 4.2 Common Input Contract

Every agent invocation receives:

- `role`
- `task_packet` or equivalent stage packet
- `repo_policy`
- `tool_policy`
- `workspace_context`
- `stop_conditions`
- `time_budget_seconds`
- `expires_at`
- `output_schema`

### 4.3 Common Output Contract

Every agent must return:

- `status`
- `summary`
- `decision` or `result`
- `artifacts_created`
- `risks`
- `open_questions`
- `structured_payload`

Agents must always populate `risks` and `open_questions` even if empty (`[]`). These fields are included in all packet schemas. The orchestrator may use `risks` with severity `critical` as an automatic escalation trigger per escalation policy.

### 4.4 Task Picker / Planner Agent Contract

#### Responsibilities

- analyze backlog candidates
- consider priority, blockers, dependencies, scope, and risk
- recommend top task candidates and rationale
- recommend decomposition when tasks are too large

#### Must Not

- assign workers
- mutate task state directly
- ignore dependency graph

#### Input Fields

- backlog snapshot
- dependency graph summary
- repository/project goals
- scoring policy
- recent completions/failures

#### Output Fields

- ranked candidates
- rationale per candidate
- risks
- suggested reviewers/capabilities
- decomposition recommendations if applicable

#### Prompt Skeleton

"You are the backlog planning agent for an autonomous software factory. Your job is to rank ready or near-ready tasks for execution. You must optimize for business value, dependency unlock potential, bounded scope, mergeability, and likelihood of successful autonomous completion. Do not assign work directly. Return a structured ranked recommendation. Prefer tasks that are clear, isolated, and unlikely to create cross-cutting integration risk. Flag tasks that are too large or ambiguous and propose decomposition."

### 4.5 Developer Agent Contract

#### Responsibilities

- implement a single task in an isolated workspace
- follow repo and task policies
- keep changes within relevant scope
- run all required validations from the assigned validation profile before emitting the result packet
- emit a complete dev result packet

#### Must Not

- take another task
- modify orchestration metadata
- self-approve
- merge changes
- broaden scope without declaring it

#### Input Fields

- task packet
- rejection packet if rework
- code map or relevant file references
- workspace path
- repo conventions
- validation requirements

#### Output Fields

- implementation summary
- files changed
- tests added/updated
- validations run and results
- assumptions
- risks
- commit SHA / patch refs
- unresolved issues

**Unresolved issues rules:**

- `unresolved_issues` is for acceptable incompleteness only (e.g., "needs follow-up performance optimization"), not for blocking failures.
- Blocking failures must be reported via `status: "failed"`, not listed as unresolved issues.
- The orchestrator includes `dev_result.unresolved_issues` in reviewer input context so reviewers can evaluate whether the incompleteness is acceptable.
- The lead reviewer must explicitly address unresolved issues in their decision: accept them, require follow-up tasks, or reject.

#### Prompt Skeleton

"You are a developer worker in an autonomous software factory. You own exactly one task. Implement only the assigned task according to the task packet, acceptance criteria, repository policies, and workspace constraints. Keep scope tight. Do not work on unrelated cleanup. If the task was previously rejected, address all blocking issues explicitly. Before finishing, summarize what changed, what validations were run, what assumptions remain, and any residual risks. Return only the required structured result."

### 4.6 Specialist Reviewer Contract

#### Responsibilities

- review from one specific perspective
- identify issues, severity, and rationale
- distinguish blocking from non-blocking issues
- avoid duplicate or speculative feedback

#### Must Not

- implement fixes
- broaden into unrelated domains
- reject for minor stylistic preferences unless policy says so

#### Input Fields

- task packet
- dev result packet
- diff summary or diff access
- reviewer domain policy
- review rubric

#### Output Fields

- verdict
- blocking issues
- non-blocking issues
- rationale
- confidence
- suggested follow-up tasks if applicable

#### Prompt Skeleton

"You are a specialist reviewer. Review this change only from the assigned perspective: {review_domain}. Do not comment on unrelated areas. Identify concrete issues and classify them by severity. Only mark issues as blocking when they threaten correctness, safety, contract compliance, maintainability at a meaningful level, or explicit policy requirements. Avoid low-value feedback. Return a structured review packet."

### 4.7 Lead Reviewer Contract

#### Responsibilities

- consolidate specialist reviews
- deduplicate and normalize issues
- make practical approval decision
- prevent endless rejection loops

#### Must Not

- introduce new unrelated objections without strong evidence
- require perfection over shipping quality
- ignore severe reviewer findings

#### Input Fields

- task packet
- dev result packet
- all specialist review packets
- lead review policy
- review history for this task

#### Output Fields

- final decision
- blocking issues only
- non-blocking suggestions
- follow-up task recommendations
- rationale for approval/rejection

#### Prompt Skeleton

"You are the lead reviewer for an autonomous software factory. Your responsibility is to make a practical final decision based on specialist reviews and the task requirements. Consolidate feedback, remove duplicates, and distinguish must-fix blockers from non-blocking suggestions. Do not reject endlessly for minor improvements. Prefer approval with follow-up tasks when the change is safe and materially satisfies the task. Reject only when the work fails important acceptance, correctness, safety, or policy thresholds."

### 4.8 Merge Assist Agent Contract (optional)

#### Responsibilities

- analyze merge/rebase conflicts when deterministic merge fails and policy allows AI assistance
- recommend conflict resolution strategy while preserving approved intent and mainline correctness
- produce a structured MergeAssistPacket (see `docs/008-packet-and-schema-spec.md`)

#### Must Not

- merge directly without orchestration instruction
- change task scope during conflict resolution
- modify files outside the conflict regions
- introduce unrelated changes

#### Input Fields

- task packet
- dev result packet (approved implementation)
- merge conflict details (conflicting files, conflict markers, base/ours/theirs)
- effective merge policy
- mainline context (recent commits to target branch)

#### Output Fields

- recommendation: `auto_resolve | reject_to_dev | escalate`
- resolution_strategy: description of how conflicts would be resolved
- files_affected: list of files with proposed resolution
- confidence: `high | medium | low`
- rationale

#### Stop Conditions

- emit exactly one MergeAssistPacket
- if confidence is `low` or resolution is unclear, recommend `reject_to_dev` or `escalate`
- do not attempt resolution if more than `merge_policy.max_assist_conflict_files` files are in conflict

#### Post-Resolution Validation

The merge module must validate that merge assist output stays within the approved diff scope. Any file changes outside original diff scope cause the recommendation to be rejected and the merge classified as reworkable.

#### Prompt Skeleton

"You are assisting an integration step for an already approved task. Your job is limited to resolving integration conflicts while preserving approved intent and current mainline correctness. Do not introduce unrelated changes. If safe resolution is unclear, say so explicitly and recommend escalation or rework."

### 4.9 Post-Merge Analysis Agent Contract (optional but safety-critical)

#### Responsibilities

- analyze regressions or failed post-merge validations
- determine whether the failure is caused by the merged change or a pre-existing issue
- recommend recovery action: revert, targeted fix task, or escalation

#### Must Not

- execute reverts directly
- modify repository state
- ignore evidence from validation results
- recommend "no action" when validation has failed

#### Input Fields

- task packet (the task that was merged)
- merge packet (merge execution details)
- validation result packet (post-merge validation output)
- failure evidence (test output, error logs, regression details)
- recent merge history (other recent merges that may have contributed)

#### Output Fields

- recommendation: `revert | hotfix_task | escalate | pre_existing`
- confidence: `high | medium | low`
- rationale: explanation of analysis
- failure_attribution: which change likely caused the failure
- suggested_revert_scope: files/commits to revert (if recommendation is `revert`)
- follow_up_task_description: description of fix task (if recommendation is `hotfix_task`)

#### Stop Conditions

- emit exactly one PostMergeAnalysisPacket
- if confidence is `low`, recommend `escalate`
- must complete within `lease_policy.lease_ttl_seconds`

#### Orchestrator Behavior

When post-merge validation fails:

1. If post-merge analysis agent is enabled: invoke agent, then apply recommendation per policy.
2. If agent is disabled or unavailable: apply `post_merge_failure_policy` default action (see `docs/009-policy-and-enforcement-spec.md`).
3. Regardless of agent availability, the orchestrator records a failure artifact and audit event.

The orchestrator decides whether to auto-revert based on policy, not on agent authority. The agent recommends; the orchestrator acts.

#### Prompt Skeleton

"You are analyzing a post-merge failure for an autonomous software factory. A merged change has failed post-merge validation. Determine whether the failure was caused by this merge or is pre-existing. Recommend the best recovery action: revert the merge, create a targeted hotfix task, or escalate to an operator. Base your reasoning on validation evidence, failure logs, and recent merge history. If you cannot determine the cause with high confidence, recommend escalation."

### 4.10 Deterministic Packet Schemas

All prompts should be backed by JSON schemas so outputs are machine-validated.

**Schema validation failure handling:**

- If a worker emits output that fails JSON parsing, this is a fatal error. The run is marked `FAILED` and counted against `retry_policy.max_attempts`.
- If a worker emits parseable JSON that fails schema validation (wrong types, missing required fields, invalid enums), the orchestrator rejects the result and may attempt one schema repair pass (extracting valid fields, applying defaults for missing optional fields). If repair fails, the run is marked `FAILED`.
- Schema validation failures are NOT treated as transient/retry-eligible failures. They indicate an agent implementation or prompt error.
- If the same agent profile produces schema validation failures on 3 consecutive runs across any tasks, the orchestrator should disable the profile and escalate to the operator.
- All schema validation failures produce a `schema_violation` audit event with the validation error details.

---
