# Task Lease Domain Layer - Quick Reference

## Key Files Location Map

| Component                 | File Path                                                                     | Lines                           |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| **Enums**                 | `packages/domain/src/enums.ts`                                                | 26-46 (Task), 146-159 (Lease)   |
| **Task State Machine**    | `packages/domain/src/state-machines/task-state-machine.ts`                    | 1-703                           |
| **Lease State Machine**   | `packages/domain/src/state-machines/worker-lease-state-machine.ts`            | 1-389                           |
| **Transition Service**    | `packages/application/src/services/transition.service.ts`                     | 1-451                           |
| **Repository Ports**      | `packages/application/src/ports/repository.ports.ts`                          | 1-167                           |
| **Unit of Work Port**     | `packages/application/src/ports/unit-of-work.port.ts`                         | 1-56                            |
| **Task Lease Repository** | `apps/control-plane/src/infrastructure/repositories/task-lease.repository.ts` | 1-102                           |
| **Database Schema**       | `apps/control-plane/src/infrastructure/database/schema.ts`                    | 219-377 (Task), 774-847 (Lease) |

---

## Status Enums

### WorkerLeaseStatus (9 states)

```
IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING (terminal)
       ↓
    TIMED_OUT → RECLAIMED (terminal)
    CRASHED → RECLAIMED (terminal)
```

**Terminal States**: `COMPLETING`, `RECLAIMED`

### TaskStatus (16 states)

```
BACKLOG ← → READY ← → BLOCKED
           ↓
        ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE → IN_REVIEW
                        ↓                ↓              ↓
                      FAILED      CHANGES_REQUESTED → ASSIGNED (re-cycle)
                                      ↓
                                   APPROVED → QUEUED_FOR_MERGE → MERGING
                                                       ↓              ↓
                                                                POST_MERGE_VALIDATION
                                                                      ↓
                                                                    DONE
* → ESCALATED → (ASSIGNED | CANCELLED | DONE) (operator)
* → CANCELLED (terminal, operator)
```

**Terminal States**: `DONE`, `FAILED`, `CANCELLED`

---

## Lease Acquisition States

Task transitions that **require `leaseAcquired: true`**:

| From                | To         | Reason                                |
| ------------------- | ---------- | ------------------------------------- |
| `READY`             | `ASSIGNED` | Initial lease for task execution      |
| `CHANGES_REQUESTED` | `ASSIGNED` | Rework lease after review feedback    |
| `ESCALATED`         | `ASSIGNED` | Retry lease after operator escalation |

---

## WorkerLeaseTransitionContext Fields

| Field                      | Required For                                            | Type    |
| -------------------------- | ------------------------------------------------------- | ------- |
| `leaseAcquired`            | `IDLE → LEASED`                                         | boolean |
| `workerProcessSpawned`     | `LEASED → STARTING`                                     | boolean |
| `firstHeartbeatReceived`   | `STARTING → RUNNING`                                    | boolean |
| `heartbeatReceived`        | `RUNNING → HEARTBEATING`, `HEARTBEATING → HEARTBEATING` | boolean |
| `completionSignalReceived` | `RUNNING/HEARTBEATING → COMPLETING`                     | boolean |
| `heartbeatTimedOut`        | `STARTING/RUNNING/HEARTBEATING → TIMED_OUT`             | boolean |
| `workerCrashed`            | `STARTING/RUNNING/HEARTBEATING → CRASHED`               | boolean |
| `reclaimRequested`         | `TIMED_OUT/CRASHED → RECLAIMED`                         | boolean |

---

## TaskTransitionContext Fields (Lease-Related)

| Field           | Required For                                                         | Type    |
| --------------- | -------------------------------------------------------------------- | ------- |
| `leaseAcquired` | `READY→ASSIGNED`, `CHANGES_REQUESTED→ASSIGNED`, `ESCALATED→ASSIGNED` | boolean |
| `hasHeartbeat`  | `ASSIGNED → IN_DEVELOPMENT`                                          | boolean |

---

## TaskLease Database Fields

| Column                         | Type       | Nullable | Notes                                  |
| ------------------------------ | ---------- | -------- | -------------------------------------- |
| `lease_id`                     | text       | NO       | PK (UUID)                              |
| `task_id`                      | text       | NO       | FK → tasks                             |
| `worker_id`                    | text       | NO       | No FK constraint (ephemeral workers)   |
| `pool_id`                      | text       | NO       | FK → worker_pools                      |
| `leased_at`                    | timestamp  | NO       | Acquisition time (auto)                |
| `expires_at`                   | timestamp  | NO       | Expiration based on pool timeout       |
| `heartbeat_at`                 | timestamp  | YES      | Last heartbeat (nullable before first) |
| `status`                       | text       | NO       | WorkerLeaseStatus enum                 |
| `reclaim_reason`               | text       | YES      | Reason for reclaim/timeout             |
| `partial_result_artifact_refs` | JSON array | YES      | Artifact paths from crash recovery     |

**Indexes**:

- `idx_task_lease_task_id` (taskId) — "what leases exist for this task?"
- `idx_task_lease_worker_id` (workerId) — "what is this worker working on?"
- `idx_task_lease_status` (status) — "all active leases"

---

## Task Database Fields (Lease-Related)

| Column             | Type    | Nullable | Notes                               |
| ------------------ | ------- | -------- | ----------------------------------- |
| `task_id`          | text    | NO       | PK (UUID)                           |
| `current_lease_id` | text    | YES      | FK → task_leases (active lease)     |
| `status`           | text    | NO       | TaskStatus enum                     |
| `version`          | integer | NO       | Optimistic concurrency (increments) |
| `retry_count`      | integer | NO       | Default 0                           |

---

## Repository Port Interfaces

### TaskLeaseRepositoryPort

```typescript
interface TaskLeaseRepositoryPort {
  findById(id: string): TransitionableTaskLease | undefined;
  updateStatus(
    id: string,
    expectedStatus: WorkerLeaseStatus, // Status-based OCC
    newStatus: WorkerLeaseStatus,
  ): TransitionableTaskLease;
}
```

### TaskRepositoryPort

```typescript
interface TaskRepositoryPort {
  findById(id: string): TransitionableTask | undefined;
  updateStatus(
    id: string,
    expectedVersion: number, // Version-based OCC (increments)
    newStatus: TaskStatus,
  ): TransitionableTask;
}
```

---

## Transition Service Pattern

All transitions follow this 5-step atomic pattern:

```typescript
1. Fetch entity via repository
2. Validate with domain state machine
3. Update status with optimistic concurrency
4. Create audit event (atomic in same transaction)
5. Emit domain event (after commit)
```

**Optimistic Concurrency**:

- **Tasks**: Version-based (`version` column incremented)
- **Leases**: Status-based (current status verified before update)

---

## State Machine Validation

### validateTransition(current, target, context)

Returns `{ valid: boolean, reason?: string }`

**Guards check**:

1. Is transition in explicit transition map?
2. Do guard function preconditions pass?
3. Wildcard transitions (_ → ESCALATED, _ → CANCELLED)?

### validateWorkerLeaseTransition(current, target, context)

Returns `{ valid: boolean, reason?: string }`

**Guards check**:

1. Is transition in transition map?
2. Do guard function preconditions pass?
3. Only `HEARTBEATING → HEARTBEATING` self-loop allowed

---

## Typical Workflows

### Happy Path: New Lease Acquisition

```
Task: READY
  ↓ (leaseAcquired: true)
Task: ASSIGNED
Lease: IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING
Task: IN_DEVELOPMENT
  ↓ (hasHeartbeat: true)
Task: IN_DEVELOPMENT
  ↓ (hasDevResultPacket: true, requiredValidationsPassed: true)
Task: DEV_COMPLETE
  ↓ (hasReviewRoutingDecision: true)
Task: IN_REVIEW
```

### Rework Cycle

```
Task: IN_REVIEW → CHANGES_REQUESTED
  ↓ (leaseAcquired: true, new lease)
Task: ASSIGNED
Lease: IDLE → LEASED → ... (new lease lifecycle)
```

### Failure & Reclaim

```
Lease: RUNNING → TIMED_OUT (heartbeatTimedOut: true)
  ↓ (reclaimRequested: true)
Lease: RECLAIMED
Task: IN_DEVELOPMENT → FAILED (leaseTimedOutNoRetry: true)
```

---

## Audit Events

Every transition creates an audit event with:

- `entityType`: "task" | "task-lease"
- `entityId`: ID of the entity
- `eventType`: Format: `entity.transition.FROM.to.TO`
- `actorType` & `actorId`: Who made the transition
- `oldState`: JSON of previous status (and version for tasks)
- `newState`: JSON of new status (and version for tasks)
- `metadata`: Optional context-specific data
- `createdAt`: Auto-generated timestamp

---

## Exports from @factory/domain

```typescript
export {
  TaskStatus,
  WorkerLeaseStatus, // ... other enums
} from "@factory/domain";

export {
  validateTransition,
  getValidTargets,
  isTerminalState,
  getAllValidTransitions,
} from "@factory/domain";

export {
  validateWorkerLeaseTransition,
  getValidWorkerLeaseTargets,
  isTerminalWorkerLeaseState,
  getAllValidWorkerLeaseTransitions,
} from "@factory/domain";

export type { TransitionContext, TransitionResult } from "@factory/domain";
export type { WorkerLeaseTransitionContext, WorkerLeaseTransitionResult } from "@factory/domain";
```
