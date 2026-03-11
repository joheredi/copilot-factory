# Application Services Orchestration Architecture

## Overview

The Copilot Factory application layer contains a comprehensive set of services that orchestrate the full task lifecycle from creation through completion. These services coordinate task assignment, execution, review, merge, and validation through a sophisticated state machine model with atomic transactions, domain events, and audit logging.

## Core Orchestration Flow

```
Task Lifecycle:
  READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE → IN_REVIEW → APPROVED → QUEUED_FOR_MERGE
    → MERGING → POST_MERGE_VALIDATION → DONE

Side paths:
  CHANGES_REQUESTED → (back to IN_DEVELOPMENT)
  ESCALATED → (manual review)
  FAILED → (terminal)
```

---

## 1. SCHEDULER SERVICE

**Location:** `packages/application/src/services/scheduler.service.ts`

### Purpose

The central assignment engine that continuously schedules ready tasks to compatible worker pools.

### Key Responsibilities

- Query ready tasks ordered by priority (CRITICAL → HIGH → MEDIUM → LOW)
- Match tasks to enabled DEVELOPER worker pools based on capabilities
- Check pool capacity constraints (activeLeaseCount < maxConcurrency)
- Atomically acquire a lease via LeaseService
- Create a WORKER_DISPATCH job for the worker supervisor
- Prevent duplicate assignment through exclusivity checks

### Core Algorithm

1. **Step 1:** Query up to N ready tasks by priority (default N=50)
2. **Step 2:** Fetch all enabled developer pools
3. **Step 3:** For each candidate task:
   - Filter pools by capability compatibility
   - Select best pool (most available capacity)
   - Attempt atomic lease acquisition
   - On success: create dispatch job, return assignment
   - On ExclusivityViolationError/TaskNotReadyForLeaseError: try next task
4. **Step 4:** Return reason if no assignment possible

### Key Functions

- `isPoolCompatible()` - Check if pool provides all required capabilities
- `hasPoolCapacity()` - Verify pool has available slots
- `selectBestPool()` - Pick pool with most available capacity
- `comparePriority()` - Task priority ordering

### Input/Output

```typescript
scheduleNext(candidateLimit?: number): ScheduleResult
// Returns: {assigned: true, assignment: {...}} | {assigned: false, reason: ScheduleSkipReason}
```

---

## 2. WORKER SUPERVISOR SERVICE

**Location:** `packages/application/src/services/worker-supervisor.service.ts`

### Purpose

Manages the complete lifecycle of worker processes from spawn to cleanup, coordinating with the runtime adapter.

### Spawn Lifecycle

```
createWorker → createWorkspace → mountPackets → prepareRun → startRun
  → streamRun (heartbeat forwarding) → collectArtifacts → finalizeRun → updateWorkerStatus
```

### Key Responsibilities

- Create Worker entity in "starting" state
- Provision workspace (worktree + directories)
- Mount context packets into workspace
- Prepare runtime adapter
- Start the worker process
- Stream output events (forwarding heartbeats to lease service)
- On completion: collect artifacts, finalize run, update status

### Worker Status Transitions

- idle → starting → running → completing → completed/failed/cancelled

### Error Handling

- On failure: attempt runtime finalization, mark worker as failed
- Best-effort cleanup even if finalization fails

### Input/Output

```typescript
spawnWorker(params: SpawnWorkerParams): Promise<SpawnWorkerResult>
cancelWorker(params: CancelWorkerParams): Promise<CancelWorkerResult>
```

---

## 3. LEASE SERVICE

**Location:** `packages/application/src/services/lease.service.ts`

### Purpose

Enforces the one-active-lease-per-task invariant through atomic lease acquisition.

### Key Responsibilities

1. Validate task is in lease-eligible state (READY, CHANGES_REQUESTED, ESCALATED)
2. Enforce exclusivity (no active lease may exist)
3. Validate transition via domain state machine
4. Create new lease with LEASED status
5. Transition task to ASSIGNED
6. Record audit event
7. Emit domain event

### Atomic Transaction Pattern

```
BEGIN TRANSACTION
  1. Fetch task
  2. Verify lease-eligible state
  3. Check no active lease (exclusivity)
  4. Validate state machine
  5. Create lease
  6. Update task status → ASSIGNED
  7. Create audit event
COMMIT
EMIT EVENTS
```

### Input/Output

```typescript
acquireLease(params: AcquireLeaseParams): LeaseAcquisitionResult
// Contains: lease, task, auditEvent
```

---

## 4. HEARTBEAT SERVICE

**Location:** `packages/application/src/services/heartbeat.service.ts`

### Purpose

Manages the heartbeat protocol for detecting worker staleness and failures.

### Core Operations

#### receiveHeartbeat()

- Process incoming heartbeat from worker
- Validate lease is in heartbeat-receivable state (STARTING, RUNNING, HEARTBEATING)
- Transition lease state appropriately:
  - STARTING → RUNNING (first heartbeat)
  - RUNNING → HEARTBEATING (subsequent)
  - HEARTBEATING → HEARTBEATING (self-loop)
  - Any → COMPLETING (terminal heartbeat)
- Extend TTL for graceful completion
- Record audit event

#### detectStaleLeases()

- Query active leases that missed heartbeat threshold
- Threshold: (interval × missed_threshold + grace_period)
- OR leases that exceeded absolute TTL
- Return classified stale leases for reclaim processing

### Staleness Policy

```typescript
interface StalenessPolicy {
  heartbeatIntervalSeconds: number; // e.g., 30s
  missedHeartbeatThreshold: number; // e.g., 2
  gracePeriodSeconds: number; // e.g., 15s
}
```

---

## 5. LEASE RECLAIM SERVICE

**Location:** `packages/application/src/services/lease-reclaim.service.ts`

### Purpose

Recovers from worker failures by reclaiming stale/crashed leases and applying retry/escalation policy.

### Crash Recovery Protocol

1. Validate lease is in active state (STARTING, RUNNING, HEARTBEATING)
2. Transition lease to TIMED_OUT or CRASHED based on reclaim reason
3. Evaluate retry policy (from @factory/domain)
4. If retry-eligible: transition task back to READY (with retry_count++)
5. If retries exhausted: evaluate escalation policy
6. Apply escalation decision (FAILED or ESCALATED)
7. Record comprehensive audit event
8. Emit domain events

### Reclaim Reasons

- `missed_heartbeats` → TIMED_OUT
- `ttl_expired` → TIMED_OUT
- `worker_crashed` → CRASHED

### Task Outcome Determination

```
IF retry_eligible:
  outcome = "retried", task → READY, retry_count++
ELSE:
  IF should_escalate(EscalationTrigger.HEARTBEAT_TIMEOUT):
    outcome = "escalated", task → ESCALATED
  ELSE:
    outcome = "failed", task → FAILED
```

---

## 6. TRANSITION SERVICE

**Location:** `packages/application/src/services/transition.service.ts`

### Purpose

Centralized authority for all state transitions across entity types (Task, TaskLease, ReviewCycle, MergeQueueItem).

### Design Pattern (per transition method)

```
1. Fetch entity
2. Validate transition via domain state machine
3. Update entity with optimistic concurrency
4. Create audit event (atomically)
5. Emit domain event (post-commit)
```

### Concurrency Control

- **Tasks:** Explicit version column (incremented on each update)
- **Other entities:** Status-based checks (verify current status before writing)

### Transition Methods

- `transitionTask()` - Tasks via version-based OCC
- `transitionLease()` - Worker leases via status-based OCC
- `transitionReviewCycle()` - Review cycles
- `transitionMergeQueueItem()` - Merge queue items

### Pattern

```typescript
runInTransaction((repos) => {
  const entity = repos.findById(id);
  const validation = validateTransition(from, to, context);
  const updated = repos.updateStatus(id, entity.version, to);
  const auditEvent = repos.auditEvent.create({...});
  return {entity: updated, auditEvent};
});
eventEmitter.emit(domainEvent);
```

---

## 7. REVIEWER DISPATCH SERVICE

**Location:** `packages/application/src/services/reviewer-dispatch.service.ts`

### Purpose

Fans out review work by creating specialist reviewer jobs after task reaches DEV_COMPLETE.

### Review Fan-Out Workflow

1. Task reaches DEV_COMPLETE status
2. Call Review Router (pure function) to determine required/optional reviewers
3. Create ReviewCycle (NOT_STARTED → ROUTED)
4. Create one REVIEWER_DISPATCH job per specialist
5. Create LEAD_REVIEW_CONSOLIDATION job depending on all specialists
6. Transition task DEV_COMPLETE → IN_REVIEW
7. Link task's currentReviewCycleId to new cycle
8. Record audit events
9. Emit domain events

### Job Coordination

- Specialist jobs share jobGroupId (for coordination)
- Lead review job has dependsOnJobIds = [all specialist job IDs]
- Lead job waits for all specialists to complete

### Atomic Transaction

All mutations (cycle creation, job creation, task transition, audit events) happen in single transaction

---

## 8. LEAD REVIEW CONSOLIDATION SERVICE

**Location:** `packages/application/src/services/lead-review-consolidation.service.ts`

### Purpose

Assembles lead reviewer context after all specialist reviews complete.

### Consolidation Flow

1. Verify review cycle is in consolidation-eligible state (IN_PROGRESS, AWAITING_REQUIRED_REVIEWS)
2. Verify all specialist jobs in group are terminal (COMPLETED or FAILED)
3. Gather all specialist ReviewPackets from current cycle
4. Fetch review history from prior cycles (if any)
5. Transition ReviewCycle to CONSOLIDATING
6. Record audit event
7. Return assembled context for lead reviewer

### Lead Reviewer Context

```typescript
{
  reviewCycle: {...},
  specialistPackets: [...],
  reviewHistory: [{...from prior cycles}],
  specialistJobs: [...],
  auditEvents: [...]
}
```

---

## 9. REVIEW DECISION SERVICE

**Location:** `packages/application/src/services/review-decision.service.ts`

### Purpose

Processes the lead reviewer's decision and applies it to task and review cycle state.

### Decision Application Flow

1. Validate LeadReviewDecisionPacket against Zod schema
2. Within atomic transaction:
   a. Fetch and validate task (must be IN_REVIEW)
   b. Fetch and validate review cycle (must be CONSOLIDATING)
   c. Cross-reference packet IDs
   d. For changes_requested: evaluate escalation policy (max review rounds)
   e. Determine target statuses for task and cycle
   f. Persist LeadReviewDecision record
   g. Transition review cycle (→ APPROVED, REJECTED, or ESCALATED)
   h. Transition task (→ APPROVED, CHANGES_REQUESTED, or ESCALATED)
   i. If changes_requested: increment reviewRoundCount
   j. If approved_with_follow_up: create skeleton follow-up tasks
   k. Record audit events for all transitions
3. Emit domain events

### Decision Outcomes

- `approved` - Task ready for merge
- `approved_with_follow_up` - Approved but with follow-up tasks
- `changes_requested` - Send back for revisions (unless escalated)
- `escalated` - Manual review needed
- `escalated_from_review_limit` - Max review rounds exceeded

---

## 10. MERGE QUEUE SERVICE

**Location:** `packages/application/src/services/merge-queue.service.ts`

### Purpose

Serializes merge operations per repository using priority-based ordering.

### Queue Operations

#### enqueueForMerge()

1. Validate task is in APPROVED state
2. Check no existing merge queue item
3. Validate transition APPROVED → QUEUED_FOR_MERGE
4. Create MergeQueueItem in ENQUEUED status
5. Transition task to QUEUED_FOR_MERGE
6. Recalculate queue positions
7. Record audit events

#### dequeueNext()

1. Find next ENQUEUED item (ordering contract)
2. Atomically claim item (ENQUEUED → PREPARING)
3. Recalculate positions
4. Record audit event

### Merge Queue Ordering Contract

```
Priority DESC (critical=4, high=3, medium=2, low=1)
→ enqueuedAt ASC (FIFO within priority)
→ itemId ASC (deterministic tie-break)
```

Positions are 1-indexed and contiguous, recalculated on every enqueue/dequeue.

---

## 11. MERGE EXECUTOR SERVICE

**Location:** `packages/application/src/services/merge-executor.service.ts`

### Purpose

Orchestrates the rebase-and-merge strategy for dequeued items.

### Merge Pipeline

1. Transition item PREPARING → REBASING, task QUEUED_FOR_MERGE → MERGING
2. Fetch latest refs and rebase onto target branch
3. On rebase failure:
   - Classify conflict
   - Transition item to FAILED
   - Transition task based on conflict class (CHANGES_REQUESTED or FAILED)
4. On rebase success: run merge-gate validation
5. On validation failure:
   - Transition item to FAILED
   - Transition task to FAILED
6. On validation pass:
   - Push to remote
   - Transition item REBASING → MERGED
7. Transition task MERGING → POST_MERGE_VALIDATION
8. Emit MergePacket artifact

### Merge Outcomes

- `merged` - Successful merge to POST_MERGE_VALIDATION
- `rebase_conflict` - Conflict detected and classified
- `validation_failed` - Merge-gate validation failed
- `push_failed` - Remote push failed

---

## 12. POST-MERGE VALIDATION SERVICE

**Location:** `packages/application/src/services/post-merge-validation.service.ts`

### Purpose

Runs validation checks after successful merge to ensure merged code is correct.

### Validation Flow

1. Use validation-gate service to check merge-gate profile
2. Run validation checks via validation-runner
3. Emit validation result packet
4. If validation passed: transition task POST_MERGE_VALIDATION → DONE
5. If validation failed: transition task back to CHANGES_REQUESTED

### Gates

- APPROVED → QUEUED_FOR_MERGE: Uses existing review-phase results
- POST_MERGE_VALIDATION → DONE: Requires merge-gate profile to pass

---

## 13. VALIDATION GATE SERVICE

**Location:** `packages/application/src/services/validation-gate.service.ts`

### Purpose

Enforces validation quality gates on state transitions.

### Gated Transitions

| From                  | To           | Required Profile |
| --------------------- | ------------ | ---------------- |
| IN_DEVELOPMENT        | DEV_COMPLETE | default-dev      |
| POST_MERGE_VALIDATION | DONE         | merge-gate       |

### Gate Check Logic

1. Determine if transition is gated
2. Query latest validation result for required profile
3. Check overall status is "passed"
4. Return pass/fail with details

### Result Type

```typescript
type ValidationGateResult =
  | {gated: false}                              // Not gated
  | {gated: true, passed: true, ...}            // Passed
  | {gated: true, passed: false, reason, ...}   // Failed
```

---

## 14. VALIDATION RUNNER SERVICE

**Location:** `packages/application/src/services/validation-runner.service.ts`

### Purpose

Orchestrates profile-based validation check execution.

### Validation Flow

1. Load validation profile by name
2. Resolve required and optional checks
3. Execute checks sequentially (all run regardless of failures)
4. Aggregate results:
   - Count passed/failed/skipped
   - Determine overall status
5. Build summary
6. Return comprehensive result

### Overall Status Rules

```
IF any required check failed or errored:
  status = "failed"
ELSE IF fail_on_skipped_required_check AND any required check skipped:
  status = "failed"
ELSE:
  status = "passed"
```

Optional check failures never affect overall status.

---

## 15. VALIDATION PACKET EMITTER SERVICE

**Location:** `packages/application/src/services/validation-packet-emitter.service.ts`

### Purpose

Assembles, validates, and persists ValidationResultPacket artifacts.

### Emission Flow

1. Map check outcomes to schema format
2. Determine packet status (success/failed)
3. Assemble ValidationResultPacket
4. Validate against Zod schema
5. Persist as artifact
6. Return validated packet and artifact path

### Key Transformations

- `checkName` → `check_type` (matched against known types or default to "policy")
- `command` → `tool_name` (first whitespace-delimited token)
- Check status "error" → "failed" (packet only supports passed/failed/skipped)

---

## 16. JOB QUEUE SERVICE

**Location:** `packages/application/src/services/job-queue.service.ts`

### Purpose

DB-backed job queue with atomic claim, dependency checking, and group coordination.

### Job Status Lifecycle

```
PENDING → CLAIMED → RUNNING → COMPLETED
                            ↘ FAILED
```

### Key Operations

#### createJob()

- Enqueue job in PENDING status
- Optional runAfter for delayed execution
- Optional dependsOnJobIds for dependency declaration
- Optional jobGroupId for coordination

#### claimJob()

- Atomically claim oldest eligible job (UPDATE...WHERE)
- Skip jobs with runAfter in future
- Skip jobs with unmet dependencies
- Increment attempt count
- Returns null if no eligible job

#### completeJob() / failJob()

- Transition from CLAIMED or RUNNING
- Terminal status

#### areJobDependenciesMet()

- Check all dependency jobs in terminal status
- Return pending and missing dependency IDs

#### findJobsByGroup()

- Query all jobs in group (regardless of status)

### Atomic Claim Pattern

```sql
UPDATE job
SET status = 'CLAIMED', attemptCount = attemptCount + 1, ...
WHERE jobType = ?
  AND status = 'PENDING'
  AND runAfter IS NULL OR runAfter <= now
  AND (dependsOnJobIds IS NULL OR all dependencies terminal)
ORDER BY priority DESC, createdAt ASC
LIMIT 1
```

---

## 17. POLICY SNAPSHOT SERVICE

**Location:** `packages/application/src/services/policy-snapshot.service.ts`

### Purpose

Manages effective policy evaluation and snapshots for tasks.

### Responsibilities

- Query policy snapshot from effective policy provider
- Resolve task-specific overrides
- Compute effective retry/escalation/review/validation policies
- Cache snapshots for consistency across execution

---

## 18. OUTPUT VALIDATOR SERVICE

**Location:** `packages/application/src/services/output-validator.service.ts`

### Purpose

Validates worker output against schema requirements.

### Validation

- Validate result packets against Zod schemas
- Check for required fields
- Validate packet integrity
- Extract structured data for downstream processing

---

## 19. DEPENDENCY & REVERSE DEPENDENCY SERVICES

**Location:** `packages/application/src/services/dependency.service.ts` and `reverse-dependency.service.ts`

### Purpose

Manage task dependency tracking for coordinated execution.

### Responsibilities

- Query task dependencies
- Determine reverse dependencies
- Identify blocking tasks
- Support cascade operations

---

## 20. READINESS SERVICE

**Location:** `packages/application/src/services/readiness.service.ts`

### Purpose

Determines task readiness for execution.

### Readiness Checks

- All dependencies satisfied
- No blocking tasks in progress
- Retry backoff window has passed
- Task meets scheduling criteria

---

## Transaction & Concurrency Model

### Atomic Transaction Pattern

All orchestration services follow this pattern:

```typescript
// 1. Execute in transaction
const result = unitOfWork.runInTransaction((repos) => {
  // Read phase
  const entity = repos.find...();

  // Validation phase
  validate(entity);

  // Write phase (all together)
  const updated = repos.update(...);
  const audit = repos.auditEvent.create(...);

  return {updated, audit, ...otherData};
});

// 2. Emit events AFTER commit
eventEmitter.emit(domainEvent);
```

### Optimistic Concurrency Control

- **Tasks:** Version-based (incremented per update)
- **Leases:** Status-based (verify current status before write)
- **Review Cycles:** Status-based
- **Merge Queue Items:** Status-based

---

## Event Flow

### Domain Events

All state transitions emit domain events:

```typescript
{
  type: "task.transitioned" | "task-lease.transitioned" | ...,
  entityType: "task" | "task-lease" | "review-cycle" | ...,
  entityId: string,
  fromStatus: Status,
  toStatus: Status,
  actor: {type: "system"|"operator", id: string},
  timestamp: Date,
  newVersion?: number  // For versioned entities
}
```

Events are emitted **after** transaction commit to guarantee consistency.

### Audit Trail

All state changes create audit events:

```typescript
{
  entityType: string,
  entityId: string,
  eventType: string,
  actorType: "system" | "operator",
  actorId: string,
  oldState: JSON,
  newState: JSON,
  metadata?: JSON
}
```

Audit events are persisted **atomically** with state changes.

---

## Key Architectural Patterns

### 1. Unit of Work

All services use injected `unitOfWork` port for transaction management:

```typescript
unitOfWork.runInTransaction((repos) => {
  // All database operations here
  // All succeed or all fail
});
```

### 2. Dependency Injection

Services receive all dependencies via factory functions:

```typescript
createService({
  unitOfWork,
  eventEmitter,
  idGenerator,
  clock,
});
```

### 3. State Machine Validation

All transitions validated against domain state machines:

```typescript
const validation = validateTransition(fromStatus, toStatus, context);
if (!validation.valid) {
  throw new InvalidTransitionError(...);
}
```

### 4. Separation of Concerns

- **Services:** Orchestration logic only
- **Domain:** State machine rules
- **Ports:** Infrastructure abstraction
- **Adapters:** Actual implementations

### 5. Exclusivity & Idempotency

- Lease acquisition is exclusive (one per task)
- Job claims are atomic
- Concurrent operations fail safely (ExclusivityViolationError)

---

## Task Lifecycle Example

### Complete Flow

```
1. Task created in READY state
2. Scheduler picks it, acquires lease, creates WORKER_DISPATCH job
3. Worker supervisor claims job, spawns worker, streams heartbeats
4. Worker completes, emits result packet
5. Worker status → COMPLETED
6. Task transitions IN_DEVELOPMENT → DEV_COMPLETE (via validation-gate)
7. Reviewer dispatch creates review jobs, tasks → IN_REVIEW
8. Lead review consolidation gathers specialist reviews
9. Review decision service applies decision → APPROVED
10. Merge queue service enqueues for merge → QUEUED_FOR_MERGE
11. Merge executor rebases, validates, pushes → POST_MERGE_VALIDATION
12. Post-merge validation runs checks → DONE (or back to CHANGES_REQUESTED)
13. Task complete
```

### Failure Recovery

```
At any step, if timeout/crash detected:
  Lease reclaim service activates
  → Evaluates retry policy
  → Returns task to READY (if retries available)
  → Increments retry_count
  OR
  → Evaluates escalation policy
  → Transitions to FAILED or ESCALATED
```

---

## Summary: Service Responsibilities Map

| Service                   | Responsibility                            |
| ------------------------- | ----------------------------------------- |
| Scheduler                 | Task-to-pool assignment                   |
| Worker Supervisor         | Worker lifecycle management               |
| Lease                     | Exclusive lease acquisition               |
| Heartbeat                 | Heartbeat reception & staleness detection |
| Lease Reclaim             | Crash recovery & retry/escalation         |
| Transition                | Centralized state transitions             |
| Reviewer Dispatch         | Review fan-out orchestration              |
| Lead Review Consolidation | Lead reviewer context assembly            |
| Review Decision           | Lead decision application                 |
| Merge Queue               | Merge serialization & ordering            |
| Merge Executor            | Rebase-and-merge orchestration            |
| Post-Merge Validation     | Post-merge quality gates                  |
| Validation Gate           | Validation quality gates                  |
| Validation Runner         | Validation check execution                |
| Validation Packet Emitter | Result packet assembly                    |
| Job Queue                 | DB-backed job coordination                |
| Policy Snapshot           | Effective policy computation              |
| Output Validator          | Output schema validation                  |
| Dependency                | Task dependency queries                   |
| Readiness                 | Task readiness determination              |
