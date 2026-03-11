# Application Services - File Reference Guide

This document maps each orchestration service to its source file with brief descriptions.

## Core Orchestration Services (20 services)

### 1. **Scheduler Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/scheduler.service.ts` (379 lines)
- **Purpose:** Central task-to-pool assignment engine
- **Key Method:** `scheduleNext(candidateLimit?: number): ScheduleResult`
- **Responsibilities:**
  - Query ready tasks by priority
  - Match to compatible enabled developer pools
  - Check concurrency limits
  - Atomically acquire leases
  - Create WORKER_DISPATCH jobs
  - Prevent duplicate assignment
- **Key Helper Functions:**
  - `isPoolCompatible()` - Capability matching
  - `selectBestPool()` - Pool selection with capacity awareness
  - `comparePriority()` - Task priority ordering

---

### 2. **Worker Supervisor Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/worker-supervisor.service.ts` (473 lines)
- **Purpose:** Manage complete worker process lifecycle
- **Key Methods:**
  - `spawnWorker(params: SpawnWorkerParams): Promise<SpawnWorkerResult>`
  - `cancelWorker(params: CancelWorkerParams): Promise<CancelWorkerResult>`
- **Responsibilities:**
  - Create worker entity
  - Provision workspace (worktree creation)
  - Mount context packets
  - Start runtime adapter
  - Stream and forward heartbeats
  - Collect artifacts
  - Finalize and track worker status
- **Worker Status Flow:** starting → running → completing → completed/failed/cancelled
- **Key Collaborators:** WorkspaceProvider, PacketMounter, RuntimeAdapter, HeartbeatForwarder

---

### 3. **Lease Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/lease.service.ts` (247 lines)
- **Purpose:** Enforce one-active-lease-per-task invariant
- **Key Method:** `acquireLease(params: AcquireLeaseParams): LeaseAcquisitionResult`
- **Responsibilities:**
  - Validate lease-eligible state (READY, CHANGES_REQUESTED, ESCALATED)
  - Check exclusivity (no active lease exists)
  - Validate state machine
  - Create lease with LEASED status
  - Transition task to ASSIGNED
  - Record audit event atomically
  - Emit domain events post-commit
- **Errors:** ExclusivityViolationError, TaskNotReadyForLeaseError
- **Concurrency:** Optimistic within single transaction

---

### 4. **Heartbeat Service**

- **File:** `packages/application/src/services/heartbeat.service.ts` (413 lines)
- **Purpose:** Manage heartbeat protocol and staleness detection
- **Key Methods:**
  - `receiveHeartbeat(params: ReceiveHeartbeatParams): ReceiveHeartbeatResult`
  - `detectStaleLeases(policy: StalenessPolicy): DetectStaleLeasesResult`
- **Heartbeat-Receivable States:** STARTING, RUNNING, HEARTBEATING
- **Lease State Transitions:**
  - STARTING → RUNNING (first heartbeat)
  - RUNNING → HEARTBEATING (subsequent)
  - HEARTBEATING → HEARTBEATING (self-loop)
  - Any → COMPLETING (terminal heartbeat)
- **Staleness Window:** interval × missed_threshold + grace_period
- **Returns:** StaleLeaseInfo[] with classified reasons (missed_heartbeats or ttl_expired)

---

### 5. **Lease Reclaim Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/lease-reclaim.service.ts` (537 lines)
- **Purpose:** Crash recovery via retry/escalation policy evaluation
- **Key Method:** `reclaimLease(params: ReclaimLeaseParams): ReclaimLeaseResult`
- **Reclaim Reasons:**
  - `missed_heartbeats` → lease TIMED_OUT
  - `ttl_expired` → lease TIMED_OUT
  - `worker_crashed` → lease CRASHED
- **Task Outcome Logic:**
  1. Evaluate retry policy (from @factory/domain)
  2. If eligible: task → READY, retry_count++
  3. If exhausted: evaluate escalation policy
  4. Apply outcome: RETRIED, FAILED, or ESCALATED
- **Key Helper Functions:**
  - `evaluateTaskOutcome()` - Retry/escalation decision
  - `determineLeaseTargetState()` - Lease state mapping
  - `buildTaskTransitionContext()` - State machine context
- **Errors:** LeaseNotReclaimableError

---

### 6. **Transition Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/transition.service.ts` (451 lines)
- **Purpose:** Centralized state transition authority (all entity types)
- **Key Methods:**
  - `transitionTask(taskId, to, context, actor, metadata?): TransitionResult`
  - `transitionLease(leaseId, to, context, actor, metadata?): TransitionResult`
  - `transitionReviewCycle(cycleId, to, context, actor, metadata?): TransitionResult`
  - `transitionMergeQueueItem(itemId, to, context, actor, metadata?): TransitionResult`
- **Atomic Transaction Pattern (all methods):**
  1. Fetch entity
  2. Validate via domain state machine
  3. Update with optimistic concurrency
  4. Create audit event (atomically)
  5. Emit domain event (post-commit)
- **Concurrency Control:**
  - Tasks: Version-based (incremented on update)
  - Others: Status-based (verify current before write)

---

### 7. **Reviewer Dispatch Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/reviewer-dispatch.service.ts` (446 lines)
- **Purpose:** Fan out review work after DEV_COMPLETE
- **Key Method:** `dispatchReviewers(params: DispatchReviewersParams): DispatchReviewersResult`
- **Workflow:**
  1. Call Review Router to determine reviewers (pure)
  2. Create ReviewCycle (NOT_STARTED → ROUTED)
  3. Create REVIEWER_DISPATCH job per specialist
  4. Create LEAD_REVIEW_CONSOLIDATION job depending on all specialists
  5. Task: DEV_COMPLETE → IN_REVIEW
  6. Set currentReviewCycleId
  7. Record audit events
  8. Emit domain events
- **Job Group Coordination:** All specialists share jobGroupId; lead depends on all
- **Atomic:** All mutations in single transaction

---

### 8. **Lead Review Consolidation Service**

- **File:** `packages/application/src/services/lead-review-consolidation.service.ts` (200+ lines)
- **Purpose:** Assemble lead reviewer context after specialist reviews
- **Key Method:** `assembleLeadReviewContext(params): AssembleLeadReviewContextResult`
- **Workflow:**
  1. Verify review cycle consolidation-eligible state
  2. Verify all specialist jobs terminal
  3. Gather all specialist ReviewPackets from current cycle
  4. Fetch review history from prior cycles
  5. ReviewCycle → CONSOLIDATING
  6. Return assembled context
- **Terminal Job Statuses:** COMPLETED, FAILED, CANCELLED
- **Returned Context:**
  - reviewCycle
  - specialistPackets[]
  - reviewHistory[] (from prior cycles)
  - specialistJobs[]
  - auditEvents[]

---

### 9. **Review Decision Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/review-decision.service.ts` (722 lines)
- **Purpose:** Process lead reviewer's decision
- **Key Method:** `applyDecision(params: ApplyReviewDecisionParams): ApplyReviewDecisionResult`
- **Decision Workflow:**
  1. Validate LeadReviewDecisionPacket (Zod schema)
  2. Atomic transaction:
     - Fetch and validate task (IN_REVIEW)
     - Fetch and validate cycle (CONSOLIDATING)
     - Cross-reference packet IDs
     - For CHANGES_REQUESTED: evaluate escalation policy (max review rounds)
     - Determine target statuses
     - Persist LeadReviewDecision record
     - Transition cycle and task
     - If CHANGES_REQUESTED: increment reviewRoundCount
     - If APPROVED_WITH_FOLLOW_UP: create follow-up tasks
     - Record audit events
  3. Emit domain events
- **Outcomes:** approved, approved_with_follow_up, changes_requested, escalated, escalated_from_review_limit
- **Key Helpers:**
  - `getReviewCycleTargetStatus()`
  - `getTaskTargetStatus()`
  - `getTaskTransitionContext()`

---

### 10. **Merge Queue Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/merge-queue.service.ts` (481 lines)
- **Purpose:** Serialize merges per repository with priority ordering
- **Key Methods:**
  - `enqueueForMerge(params): EnqueueForMergeResult`
  - `dequeueNext(params): DequeueNextResult | undefined`
  - `recalculatePositions(repositoryId): void`
- **Ordering Contract (priority DESC → enqueuedAt ASC → itemId ASC):**
  - Priority weights: critical=4, high=3, medium=2, low=1
  - FIFO within priority
  - Deterministic ID tie-break
- **Positions:** 1-indexed, contiguous, recalculated on each operation
- **Atomic:** All mutations in single transaction
- **Error Types:** DuplicateEnqueueError, TaskNotApprovedError

---

### 11. **Merge Executor Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/merge-executor.service.ts` (200+ lines)
- **Purpose:** Orchestrate rebase-and-merge strategy
- **Key Method:** `executeMerge(params: ExecuteMergeParams): MergeResult`
- **Merge Pipeline:**
  1. Item: PREPARING → REBASING, Task: QUEUED_FOR_MERGE → MERGING
  2. Git rebase onto target branch
  3. On rebase failure: classify conflict, transition to FAILED/CHANGES_REQUESTED
  4. On success: run merge-gate validation
  5. On validation failure: item/task → FAILED
  6. On pass: push to remote, item → MERGED
  7. Task → POST_MERGE_VALIDATION
  8. Emit MergePacket artifact
- **Outcomes:** merged, rebase_conflict, validation_failed, push_failed
- **Collaborators:** MergeGitOperationsPort, MergeValidationPort, ConflictClassifierPort

---

### 12. **Post-Merge Validation Service**

- **File:** `packages/application/src/services/post-merge-validation.service.ts` (200+ lines)
- **Purpose:** Run validation after successful merge
- **Workflow:**
  1. Check merge-gate validation gate
  2. Run validation checks
  3. Emit validation result packet
  4. If passed: Task → DONE
  5. If failed: Task → CHANGES_REQUESTED
- **Not gated:** APPROVED → QUEUED_FOR_MERGE (uses prior review results)
- **Gated:** POST_MERGE_VALIDATION → DONE (requires merge-gate pass)

---

### 13. **Validation Gate Service**

- **File:** `packages/application/src/services/validation-gate.service.ts` (274 lines)
- **Purpose:** Enforce validation quality gates on transitions
- **Key Method:** `checkGate(params: CheckGateParams): ValidationGateResult`
- **Gated Transitions:**
  - IN_DEVELOPMENT → DEV_COMPLETE (requires: default-dev)
  - POST_MERGE_VALIDATION → DONE (requires: merge-gate)
- **Result Type:** GateNotApplicableResult | GatePassedResult | GateFailedResult
- **Convenience:** `enforceValidationGate()` - throws ValidationGateError on failure
- **Constants:** GATED_TRANSITIONS[] - single source of truth

---

### 14. **Validation Runner Service**

- **File:** `packages/application/src/services/validation-runner.service.ts` (318 lines)
- **Purpose:** Orchestrate profile-based validation check execution
- **Key Method:** `runValidation(params: RunValidationParams): Promise<ValidationRunResult>`
- **Execution Flow:**
  1. Load profile by name from validation policy
  2. Resolve required and optional checks
  3. Execute checks sequentially (all run regardless of failures)
  4. Aggregate results (counts, durations)
  5. Determine overall status per rules
  6. Build summary
- **Overall Status Rules:**
  - Any required failed/errored → "failed"
  - fail_on_skipped_required_check=true AND required skipped → "failed"
  - Else → "passed"
- **Key Helpers:**
  - `resolveChecks()` - Map check names to commands
  - `computeOverallStatus()` - Aggregate check outcomes
  - `buildSummary()` - Human-readable summary

---

### 15. **Validation Packet Emitter Service**

- **File:** `packages/application/src/services/validation-packet-emitter.service.ts` (295 lines)
- **Purpose:** Assemble, validate, and persist ValidationResultPacket artifacts
- **Key Method:** `emitPacket(params: EmitValidationPacketParams): Promise<EmitValidationPacketResult>`
- **Emission Flow:**
  1. Map check outcomes to schema format
  2. Determine packet status
  3. Assemble packet
  4. Validate against Zod schema
  5. Persist as artifact
- **Transformations:**
  - checkName → check_type (match known types or default to "policy")
  - command → tool_name (first token)
  - status "error" → "failed"
- **Error:** ValidationPacketSchemaError

---

### 16. **Job Queue Service** ⭐ CRITICAL

- **File:** `packages/application/src/services/job-queue.service.ts` (350+ lines)
- **Purpose:** DB-backed job queue with coordination
- **Key Methods:**
  - `createJob(data): CreateJobResult`
  - `claimJob(jobType, leaseOwner): ClaimJobResult | null`
  - `startJob(jobId): StartJobResult`
  - `completeJob(jobId): CompleteJobResult`
  - `failJob(jobId, error?): FailJobResult`
  - `areJobDependenciesMet(jobId): AreJobDependenciesMetResult`
  - `findJobsByGroup(groupId): FindJobsByGroupResult`
- **Job Status Lifecycle:** PENDING → CLAIMED → RUNNING → COMPLETED/FAILED
- **Dependencies:** Jobs can depend on other jobs (dependsOnJobIds)
- **Groups:** Jobs can share jobGroupId for coordination
- **Atomic Claim:** UPDATE...WHERE prevents double-claim
- **Constants:** TERMINAL_STATUSES = {COMPLETED, FAILED}

---

### 17. **Policy Snapshot Service**

- **File:** `packages/application/src/services/policy-snapshot.service.ts`
- **Purpose:** Compute and manage effective policies
- **Responsibilities:**
  - Query policy snapshots
  - Resolve task-specific overrides
  - Compute effective retry/escalation/review/validation policies
- **Caching:** Cache snapshots for consistency

---

### 18. **Output Validator Service**

- **File:** `packages/application/src/services/output-validator.service.ts`
- **Purpose:** Validate worker output against schema
- **Responsibilities:**
  - Validate result packets (Zod)
  - Check required fields
  - Extract structured data

---

### 19. **Dependency Service**

- **File:** `packages/application/src/services/dependency.service.ts`
- **Purpose:** Query task dependencies
- **Responsibilities:**
  - Find task dependencies
  - Determine blocking tasks
  - Support cascade operations

---

### 20. **Reverse Dependency Service**

- **File:** `packages/application/src/services/reverse-dependency.service.ts`
- **Purpose:** Query reverse task dependencies
- **Responsibilities:**
  - Find tasks depending on target task
  - Impact analysis

---

## Supporting Services (5 services)

### 21. **Conflict Classifier Service**

- **File:** `packages/application/src/services/conflict-classifier.service.ts`
- **Purpose:** Classify Git merge conflicts

---

### 22. **Graceful Completion Service**

- **File:** `packages/application/src/services/graceful-completion.service.ts`
- **Purpose:** Manage graceful worker completion

---

### 23. **Optimistic Retry Service**

- **File:** `packages/application/src/services/optimistic-retry.service.ts`
- **Purpose:** Support optimistic retry strategies

---

### 24. **Review Router Service**

- **File:** `packages/application/src/services/review-router.service.ts`
- **Purpose:** Route tasks to appropriate reviewers (pure function)

---

### 25. **Readiness Service**

- **File:** `packages/application/src/services/readiness.service.ts`
- **Purpose:** Determine task readiness for execution

---

## File Statistics

```
Total service files: 25
Total lines of code: ~33,000+

By category:
- Core orchestration (critical path): 12 services
- Support/utility: 13 services

Largest services (by lines):
1. merge-executor.service.ts
2. review-decision.service.ts (~722)
3. scheduler.service.ts (379)
4. worker-supervisor.service.ts (473)
5. heartbeat.service.ts (413)
6. lease-reclaim.service.ts (537)
7. transition.service.ts (451)
8. reviewer-dispatch.service.ts (446)
9. validation-gate.service.ts (274)
10. job-queue.service.ts (350+)
```

---

## Quick Reference: Service Lookup by Feature

### Task Assignment

- Scheduler Service ⭐
- Readiness Service

### Worker Execution

- Worker Supervisor Service ⭐
- Heartbeat Service
- Output Validator Service

### Crash Recovery

- Lease Reclaim Service ⭐
- Heartbeat Service

### Review Process

- Reviewer Dispatch Service ⭐
- Lead Review Consolidation Service
- Review Decision Service ⭐
- Review Router Service

### Merge Process

- Merge Queue Service ⭐
- Merge Executor Service ⭐
- Conflict Classifier Service

### Validation

- Validation Gate Service
- Validation Runner Service
- Validation Packet Emitter Service

### Infrastructure

- Lease Service ⭐
- Transition Service ⭐
- Job Queue Service ⭐
- Policy Snapshot Service

### Dependencies

- Dependency Service
- Reverse Dependency Service

### Configuration

- Policy Snapshot Service

---

## Import Pattern

Most services follow this pattern:

```typescript
import type { ActorInfo } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { SomeUnitOfWork } from "../ports/some-service.ports.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

export interface SomeService {
  someMethod(params: SomeParams): SomeResult;
}

export function createSomeService(
  unitOfWork: SomeUnitOfWork,
  eventEmitter: DomainEventEmitter,
  idGenerator?: () => string,
  clock?: () => Date,
): SomeService {
  return {
    someMethod(params) {
      // Implementation
    },
  };
}
```

---

## Testing Notes

All services are testable via dependency injection:

- Replace unitOfWork with mock
- Replace eventEmitter with spy
- Inject deterministic clock and idGenerator

See `*.service.test.ts` files for examples.
