# Task Lease Domain Layer - Implementation Examples

## Example 1: Validating a Task Transition to ASSIGNED (Lease Acquisition Required)

```typescript
import { validateTransition, TaskStatus } from "@factory/domain";

// Scenario: Task moves from READY → ASSIGNED when scheduler acquires a lease
const result = validateTransition(
  TaskStatus.READY,
  TaskStatus.ASSIGNED,
  { leaseAcquired: true }, // Scheduler successfully acquired the lease
);

if (result.valid) {
  console.log("Task can transition to ASSIGNED");
  // Proceed with state change in TransitionService
} else {
  console.error("Transition rejected:", result.reason);
  // Output: "Cannot transition READY → ASSIGNED: lease not acquired"
}

// Example of invalid transition (lease not acquired)
const invalidResult = validateTransition(
  TaskStatus.READY,
  TaskStatus.ASSIGNED,
  { leaseAcquired: false }, // Lease acquisition failed
);
// invalidResult.valid === false
// invalidResult.reason === "Cannot transition READY → ASSIGNED: lease not acquired"
```

---

## Example 2: Validating a Lease State Transition

```typescript
import { validateWorkerLeaseTransition, WorkerLeaseStatus } from "@factory/domain";

// Scenario 1: Lease acquired
const result1 = validateWorkerLeaseTransition(WorkerLeaseStatus.IDLE, WorkerLeaseStatus.LEASED, {
  leaseAcquired: true,
});
// result1.valid === true

// Scenario 2: Worker process spawned
const result2 = validateWorkerLeaseTransition(
  WorkerLeaseStatus.LEASED,
  WorkerLeaseStatus.STARTING,
  { workerProcessSpawned: true },
);
// result2.valid === true

// Scenario 3: First heartbeat received
const result3 = validateWorkerLeaseTransition(
  WorkerLeaseStatus.STARTING,
  WorkerLeaseStatus.RUNNING,
  { firstHeartbeatReceived: true },
);
// result3.valid === true

// Scenario 4: Subsequent heartbeats (self-loop)
const result4 = validateWorkerLeaseTransition(
  WorkerLeaseStatus.HEARTBEATING,
  WorkerLeaseStatus.HEARTBEATING, // Self-loop allowed only for HEARTBEATING
  { heartbeatReceived: true },
);
// result4.valid === true

// Scenario 5: Timeout occurred
const result5 = validateWorkerLeaseTransition(
  WorkerLeaseStatus.RUNNING,
  WorkerLeaseStatus.TIMED_OUT,
  { heartbeatTimedOut: true },
);
// result5.valid === true

// Scenario 6: Reclaim after timeout
const result6 = validateWorkerLeaseTransition(
  WorkerLeaseStatus.TIMED_OUT,
  WorkerLeaseStatus.RECLAIMED,
  { reclaimRequested: true },
);
// result6.valid === true
```

---

## Example 3: Using TransitionService (Full Transaction)

```typescript
import { createTransitionService } from "@factory/application";
import { TaskStatus } from "@factory/domain";

// Assuming unitOfWork and eventEmitter are available
const transitionService = createTransitionService(unitOfWork, eventEmitter);

// Transition a task from READY → ASSIGNED
try {
  const result = transitionService.transitionTask(
    (taskId = "task-12345"),
    (targetStatus = TaskStatus.ASSIGNED),
    (context = {
      leaseAcquired: true, // Scheduler confirmed lease acquisition
    }),
    (actor = {
      type: "system",
      id: "scheduler-worker-1",
    }),
    (metadata = {
      leaseId: "lease-67890",
      poolId: "pool-dev",
      workerId: "worker-abc123",
    }),
  );

  // On success, atomic transaction has committed:
  // 1. Task.status updated to ASSIGNED
  // 2. Task.version incremented (OCC)
  // 3. Audit event created with transition details
  // 4. Domain event emitted to subscribers

  console.log("Task transitioned successfully");
  console.log("New version:", result.entity.version);
  console.log("Audit ID:", result.auditEvent.id);
  console.log("Audit event type:", result.auditEvent.eventType);
  // Output: "task.transition.READY.to.ASSIGNED"
} catch (error) {
  if (error instanceof EntityNotFoundError) {
    console.error("Task does not exist:", taskId);
  } else if (error instanceof InvalidTransitionError) {
    console.error("Invalid transition:", error.reason);
  } else if (error instanceof VersionConflictError) {
    console.error("Task was modified concurrently");
  }
}
```

---

## Example 4: Transitioning a Lease Through Its Lifecycle

```typescript
import { createTransitionService } from "@factory/application";
import { WorkerLeaseStatus } from "@factory/domain";

const transitionService = createTransitionService(unitOfWork, eventEmitter);

// Step 1: IDLE → LEASED (Scheduler acquires lease)
const step1 = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.LEASED),
  (context = { leaseAcquired: true }),
  (actor = { type: "system", id: "scheduler" }),
);
console.log("Lease acquired, status:", WorkerLeaseStatus.LEASED);

// Step 2: LEASED → STARTING (Worker process spawned)
const step2 = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.STARTING),
  (context = { workerProcessSpawned: true }),
  (actor = { type: "system", id: "orchestrator" }),
);
console.log("Worker starting, status:", WorkerLeaseStatus.STARTING);

// Step 3: STARTING → RUNNING (First heartbeat from worker)
const step3 = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.RUNNING),
  (context = { firstHeartbeatReceived: true }),
  (actor = { type: "worker", id: "worker-abc123" }),
  (metadata = { heartbeatTimestamp: new Date().toISOString() }),
);
console.log("Worker running, status:", WorkerLeaseStatus.RUNNING);

// Step 4a: RUNNING → HEARTBEATING (Subsequent heartbeat - many times)
const step4 = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.HEARTBEATING),
  (context = { heartbeatReceived: true }),
  (actor = { type: "worker", id: "worker-abc123" }),
  (metadata = { heartbeatCount: 5 }),
);
console.log("Worker heartbeating, status:", WorkerLeaseStatus.HEARTBEATING);

// Step 4b: HEARTBEATING → HEARTBEATING (Self-loop for continuous heartbeats)
const step4b = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.HEARTBEATING),
  (context = { heartbeatReceived: true }),
  (actor = { type: "worker", id: "worker-abc123" }),
  (metadata = { heartbeatCount: 6 }),
);
console.log("Worker still heartbeating, status:", WorkerLeaseStatus.HEARTBEATING);

// Step 5: HEARTBEATING → COMPLETING (Worker submits result)
const step5 = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.COMPLETING),
  (context = { completionSignalReceived: true }),
  (actor = { type: "worker", id: "worker-abc123" }),
  (metadata = { resultPacketId: "packet-xyz", duration: 45000 }),
);
console.log("Worker completed, status (terminal):", WorkerLeaseStatus.COMPLETING);
```

---

## Example 5: Handling Lease Failure (Timeout → Reclaim)

```typescript
import { createTransitionService } from "@factory/application";
import { WorkerLeaseStatus, TaskStatus } from "@factory/domain";

const transitionService = createTransitionService(unitOfWork, eventEmitter);

// Scenario: Heartbeat timeout occurred while lease in RUNNING state
const timeoutTransition = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.TIMED_OUT),
  (context = { heartbeatTimedOut: true }),
  (actor = { type: "system", id: "scheduler-monitor" }),
  (metadata = {
    lastHeartbeatAt: "2024-01-15T10:00:00Z",
    timeoutAt: "2024-01-15T10:05:00Z",
    timeoutExceeded: 300000, // 5 minutes in ms
  }),
);
console.log("Lease timed out, status:", WorkerLeaseStatus.TIMED_OUT);

// Orchestrator reclaims the lease
const reclaimTransition = transitionService.transitionLease(
  (leaseId = "lease-67890"),
  (targetStatus = WorkerLeaseStatus.RECLAIMED),
  (context = { reclaimRequested: true }),
  (actor = { type: "system", id: "orchestrator" }),
  (metadata = {
    reclaimReason: "heartbeat_timeout",
    partialArtifacts: ["artifact-1", "artifact-2"],
  }),
);
console.log("Lease reclaimed (terminal), status:", WorkerLeaseStatus.RECLAIMED);

// Update task to FAILED due to lease timeout with no retry remaining
const taskFailure = transitionService.transitionTask(
  (taskId = "task-12345"),
  (targetStatus = TaskStatus.FAILED),
  (context = { leaseTimedOutNoRetry: true }), // No retries left
  (actor = { type: "system", id: "escalation-policy" }),
  (metadata = {
    leaseId: "lease-67890",
    reason: "lease_timeout_no_retry",
    retryCountExhausted: 3,
  }),
);
console.log("Task failed due to lease timeout, status:", TaskStatus.FAILED);
```

---

## Example 6: Rework Cycle - CHANGES_REQUESTED Back to ASSIGNED

```typescript
import { createTransitionService } from "@factory/application";
import { TaskStatus } from "@factory/domain";

const transitionService = createTransitionService(unitOfWork, eventEmitter);

// Step 1: Code review rejects changes, task transitions to CHANGES_REQUESTED
const reviewReject = transitionService.transitionTask(
  (taskId = "task-12345"),
  (targetStatus = TaskStatus.CHANGES_REQUESTED),
  (context = { leadReviewDecision: "changes_requested" }),
  (actor = { type: "lead-reviewer", id: "reviewer-alice" }),
  (metadata = {
    reviewCycleId: "cycle-001",
    feedback: "Please address the edge cases in the error handling",
  }),
);
console.log("Task needs rework, status:", TaskStatus.CHANGES_REQUESTED);

// Step 2: Task scheduled for rework - new lease acquired
const reworkAssignment = transitionService.transitionTask(
  (taskId = "task-12345"),
  (targetStatus = TaskStatus.ASSIGNED),
  (context = { leaseAcquired: true }), // NEW lease acquired for rework
  (actor = { type: "system", id: "scheduler" }),
  (metadata = {
    newLeaseId: "lease-67891", // Different lease ID than before!
    reworkRound: 2,
    newPoolId: "pool-dev",
  }),
);
console.log("Task re-assigned for rework, status:", TaskStatus.ASSIGNED);

// Step 3: New worker starts working on the rework
const devRestart = transitionService.transitionTask(
  (taskId = "task-12345"),
  (targetStatus = TaskStatus.IN_DEVELOPMENT),
  (context = { hasHeartbeat: true }),
  (actor = { type: "worker", id: "worker-bob" }),
  (metadata = {
    leaseId: "lease-67891",
    workStartedAt: "2024-01-15T11:00:00Z",
  }),
);
console.log("Rework started, status:", TaskStatus.IN_DEVELOPMENT);

// New lease for this rework follows the normal lifecycle:
// Lease: IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING
// Meanwhile, task continues through: IN_DEVELOPMENT → DEV_COMPLETE → IN_REVIEW → ...
```

---

## Example 7: Operator Escalation with Lease Acquisition

```typescript
import { createTransitionService } from "@factory/application";
import { TaskStatus } from "@factory/domain";

const transitionService = createTransitionService(unitOfWork, eventEmitter);

// Scenario: Task escalated to operator due to repeated failures
const escalationTransition = transitionService.transitionTask(
  (taskId = "task-12345"),
  (targetStatus = TaskStatus.ESCALATED),
  (context = {
    isOperator: false, // Not operator-initiated
    hasEscalationTrigger: true, // Automatic escalation triggered (e.g., retry limit exceeded)
  }),
  (actor = { type: "system", id: "escalation-policy" }),
  (metadata = {
    reason: "max_retries_exceeded",
    retryCount: 3,
    reason_details: "Task failed 3 times; human intervention required",
  }),
);
console.log("Task escalated for operator review, status:", TaskStatus.ESCALATED);

// Operator decides to retry the task with a fresh lease
const operatorRetry = transitionService.transitionTask(
  (taskId = "task-12345"),
  (targetStatus = TaskStatus.ASSIGNED),
  (context = {
    isOperator: true, // Operator action
    leaseAcquired: true, // New lease acquired for operator's retry attempt
  }),
  (actor = { type: "operator", id: "operator-charlie" }),
  (metadata = {
    operatorDecision: "retry",
    newLeaseId: "lease-67892",
    operatorNotes: "Reviewed task complexity; appears to be infrastructure issue, not task logic",
  }),
);
console.log("Operator retried task, status:", TaskStatus.ASSIGNED);

// Alternatively, operator could cancel the task
const operatorCancel = transitionService.transitionTask(
  (taskId = "task-54321"), // Different task
  (targetStatus = TaskStatus.CANCELLED),
  (context = { isOperator: true }),
  (actor = { type: "operator", id: "operator-diana" }),
  (metadata = {
    operatorDecision: "cancel",
    reason: "Stakeholder decided to deprioritize this feature",
  }),
);
console.log("Task cancelled by operator, status:", TaskStatus.CANCELLED);
```

---

## Example 8: Getting Valid Targets for UI Display

```typescript
import {
  getValidTargets,
  TaskStatus,
  getValidWorkerLeaseTargets,
  WorkerLeaseStatus,
} from "@factory/domain";

// For task status READY, show possible transitions
const readyTargets = getValidTargets(TaskStatus.READY);
// Returns: [TaskStatus.ASSIGNED, TaskStatus.ESCALATED, TaskStatus.CANCELLED]
// UI can disable buttons for unavailable transitions

// For IN_DEVELOPMENT, show possible transitions
const devTargets = getValidTargets(TaskStatus.IN_DEVELOPMENT);
// Returns: [TaskStatus.DEV_COMPLETE, TaskStatus.FAILED, TaskStatus.ESCALATED, TaskStatus.CANCELLED]

// For lease status RUNNING, show possible transitions
const runningTargets = getValidWorkerLeaseTargets(WorkerLeaseStatus.RUNNING);
// Returns: [
//   WorkerLeaseStatus.HEARTBEATING,
//   WorkerLeaseStatus.COMPLETING,
//   WorkerLeaseStatus.TIMED_OUT,
//   WorkerLeaseStatus.CRASHED
// ]

// Check if a state is terminal
import { isTerminalState, isTerminalWorkerLeaseState } from "@factory/domain";

const isDone = isTerminalState(TaskStatus.DONE); // true
const isFailed = isTerminalState(TaskStatus.FAILED); // true
const isCancelled = isTerminalState(TaskStatus.CANCELLED); // true
const isReady = isTerminalState(TaskStatus.READY); // false

const isLeaseCompleted = isTerminalWorkerLeaseState(WorkerLeaseStatus.COMPLETING); // true
const isLeaseReclaimed = isTerminalWorkerLeaseState(WorkerLeaseStatus.RECLAIMED); // true
const isLeaseRunning = isTerminalWorkerLeaseState(WorkerLeaseStatus.RUNNING); // false
```

---

## Example 9: Repository Port Usage in Transaction

```typescript
import type { UnitOfWork } from "@factory/application";
import { TaskStatus, WorkerLeaseStatus } from "@factory/domain";

// This is typically used internally by TransitionService, but here's
// how the ports work within a transaction:

function myTransitionLogic(unitOfWork: UnitOfWork) {
  return unitOfWork.runInTransaction((repos) => {
    // 1. Fetch task using TaskRepositoryPort
    const task = repos.task.findById("task-12345");
    if (!task) {
      throw new Error("Task not found");
    }

    // 2. Fetch current lease using TaskLeaseRepositoryPort
    if (task.currentLeaseId) {
      const currentLease = repos.taskLease.findById(task.currentLeaseId);
      if (currentLease) {
        console.log("Current lease status:", currentLease.status);
      }
    }

    // 3. Update task status with version-based OCC
    const updatedTask = repos.task.updateStatus(
      "task-12345",
      task.version, // Expected version (OCC check)
      TaskStatus.IN_DEVELOPMENT,
    );
    // If version doesn't match, throws VersionConflictError

    // 4. Create audit event atomically
    const auditEvent = repos.auditEvent.create({
      entityType: "task",
      entityId: "task-12345",
      eventType: `task.transition.${task.status}.to.${TaskStatus.IN_DEVELOPMENT}`,
      actorType: "worker",
      actorId: "worker-abc",
      oldState: JSON.stringify({ status: task.status, version: task.version }),
      newState: JSON.stringify({ status: TaskStatus.IN_DEVELOPMENT, version: task.version + 1 }),
      metadata: JSON.stringify({ reason: "worker_heartbeat" }),
    });

    // 5. Return results; transaction auto-commits on success
    return { task: updatedTask, audit: auditEvent };
  });
  // If any repository operation throws, entire transaction rolls back
}
```

---

## Example 10: Checking All Valid Transitions

```typescript
import { getAllValidTransitions, getAllValidWorkerLeaseTransitions } from "@factory/domain";

// Get ALL task transitions for documentation/testing
const taskTransitions = getAllValidTransitions();
console.log("Total task transitions:", taskTransitions.length);
// Output: 19 (including wildcard transitions)

// Example transitions:
// ["BACKLOG", "READY"]
// ["READY", "ASSIGNED"]
// ["ASSIGNED", "IN_DEVELOPMENT"]
// ... and so on

// Filter for transitions that require lease acquisition
const leaseRequiredTransitions = taskTransitions.filter(
  ([from, to]) =>
    (from === "READY" && to === "ASSIGNED") ||
    (from === "CHANGES_REQUESTED" && to === "ASSIGNED") ||
    (from === "ESCALATED" && to === "ASSIGNED"),
);
console.log("Lease-requiring transitions:", leaseRequiredTransitions);

// Get ALL lease transitions for documentation/testing
const leaseTransitions = getAllValidWorkerLeaseTransitions();
console.log("Total lease transitions:", leaseTransitions.length);
// Output: 13

// Example lease transitions:
// ["IDLE", "LEASED"]
// ["LEASED", "STARTING"]
// ["RUNNING", "HEARTBEATING"]
// ["HEARTBEATING", "HEARTBEATING"]  // Self-loop
// ["RUNNING", "TIMED_OUT"]
// ... and so on
```

---

## Key Takeaways

1. **Always use TransitionService** for state changes — never mutate status directly
2. **Lease acquisition** is only required for task transitions INTO `ASSIGNED` state
3. **Optimistic concurrency** is automatic:
   - Tasks use version-based OCC
   - Leases use status-based OCC
4. **Audit events** are created atomically alongside every transition
5. **Domain events** are emitted AFTER commit (eventual consistency)
6. **Terminal states** cannot transition further (except via operator escalation for tasks)
7. **Heartbeat self-loop** is the ONLY valid self-transition in the system
8. **Reclaim** is the ultimate terminal state for failed leases
