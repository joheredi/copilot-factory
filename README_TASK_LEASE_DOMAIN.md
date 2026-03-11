# Task Lease Domain Layer - Complete Exploration Summary

## 📊 What You'll Find Here

This folder contains comprehensive documentation of the **Task Lease Domain Layer** for the Autonomous Software Factory. Four detailed documents cover everything from high-level workflows to implementation examples.

---

## 📁 Documentation Files

| File                                      | Size  | Purpose                                            |
| ----------------------------------------- | ----- | -------------------------------------------------- |
| **TASK_LEASE_DOCUMENTATION_INDEX.md**     | 11KB  | Navigation guide and quick-lookup index            |
| **TASK_LEASE_QUICK_REFERENCE.md**         | 8.1KB | Fast lookup tables, diagrams, and status overviews |
| **TASK_LEASE_DOMAIN_LAYER.md**            | 27KB  | Complete type definitions, enums, state machines   |
| **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** | 18KB  | 10 code examples showing typical usage patterns    |

**Total**: 64KB of documentation, 1,909 lines

---

## 🎯 Start Here

### For a Quick Overview (5 minutes)

1. Read the **Status Enums** section in TASK_LEASE_QUICK_REFERENCE.md
2. Skim the **Lease Acquisition States** table
3. Look at the **Typical Workflows** diagrams

### For Complete Understanding (30 minutes)

1. Start with TASK_LEASE_DOCUMENTATION_INDEX.md for the map
2. Read TASK_LEASE_QUICK_REFERENCE.md completely
3. Study Examples 1, 3, 4 in TASK_LEASE_IMPLEMENTATION_EXAMPLES.md

### For Implementation (Per task)

1. Find your use case in TASK_LEASE_DOCUMENTATION_INDEX.md - Common Tasks section
2. Read the referenced examples and sections
3. Cross-reference with TASK_LEASE_DOMAIN_LAYER.md as needed

---

## 🔑 Key Findings

### WorkerLeaseStatus (9 states)

```
Happy Path: IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING ✓
Timeout:   (STARTING/RUNNING/HEARTBEATING) → TIMED_OUT → RECLAIMED ✓
Crash:     (STARTING/RUNNING/HEARTBEATING) → CRASHED → RECLAIMED ✓
```

**Terminal States**: `COMPLETING`, `RECLAIMED`

### TaskStatus (16 states)

```
Development: BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE
Review: IN_REVIEW → (APPROVED or CHANGES_REQUESTED)
Rework: CHANGES_REQUESTED → ASSIGNED (new lease)
Merge: QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION → DONE
Exception: * → ESCALATED → (ASSIGNED | CANCELLED | DONE)
Terminal: DONE, FAILED, CANCELLED
```

### Lease Acquisition (Critical Pattern)

**Three task transitions require lease acquisition** (`leaseAcquired: true`):

1. **READY → ASSIGNED** (Initial lease)
2. **CHANGES_REQUESTED → ASSIGNED** (Rework lease)
3. **ESCALATED → ASSIGNED** (Retry lease)

---

## 📋 Entity Type Definitions

### TaskLease (Database Entity)

**From**: `apps/control-plane/src/infrastructure/database/schema.ts` (lines 774-847)

**Key Fields**:

- `leaseId` (PK): UUID
- `taskId` (FK): Links to task
- `workerId`: Worker holding the lease
- `poolId` (FK): Worker pool reference
- `status`: WorkerLeaseStatus enum value
- `leasedAt`: Acquisition timestamp
- `expiresAt`: Expiration deadline
- `heartbeatAt`: Last heartbeat time (nullable)
- `reclaimReason`: Optional failure reason
- `partialResultArtifactRefs`: JSON array of artifact paths

**Indexes**: taskId, workerId, status (for fast lookups)

### Task (Database Entity - Lease Fields)

**From**: `apps/control-plane/src/infrastructure/database/schema.ts` (lines 219-377)

**Lease-Related Fields**:

- `taskId` (PK): UUID
- `status`: TaskStatus enum
- `currentLeaseId` (FK): Active lease reference
- `version`: Optimistic concurrency control
- `retryCount`: Number of retries

---

## 🏗️ Architecture Components

### 1. State Machines (Domain Layer)

- **Location**: `packages/domain/src/state-machines/`
- **Files**: `task-state-machine.ts`, `worker-lease-state-machine.ts`
- **Purpose**: Pure validation logic (no side effects)
- **Provides**: Guard functions, transition maps, terminal state checks

### 2. Transition Service (Application Layer)

- **Location**: `packages/application/src/services/transition.service.ts`
- **Purpose**: Atomic state transitions with audit trail
- **Pattern**: 1) Fetch, 2) Validate, 3) Update, 4) Audit, 5) Emit
- **Concurrency**: Version-based (tasks) or status-based (leases)

### 3. Repository Ports (Application Layer)

- **Location**: `packages/application/src/ports/`
- **Files**: `repository.ports.ts`, `unit-of-work.port.ts`
- **Purpose**: Define data access contracts
- **Scope**: Minimal interfaces (only what transitions need)

### 4. Infrastructure (Control Plane)

- **Location**: `apps/control-plane/src/infrastructure/`
- **Components**: Repositories, Unit of Work, Database schema
- **Purpose**: Concrete implementations of ports

---

## 🔄 Typical State Transition Flow

```typescript
// Step 1: Validate (domain layer)
const validation = validateTransition(
  TaskStatus.READY,
  TaskStatus.ASSIGNED,
  { leaseAcquired: true }
);
if (!validation.valid) {
  throw new InvalidTransitionError(...);
}

// Step 2: Transition (application layer)
const result = transitionService.transitionTask(
  taskId,
  TaskStatus.ASSIGNED,
  { leaseAcquired: true },
  actor,
  metadata
);

// Step 3: Inside transaction (automatically):
// - Fetch task from repository
// - Validate using state machine
// - Update status (with OCC check)
// - Create audit event
// - Commit transaction
// - Emit domain event

// Step 4: Use result
console.log("New version:", result.entity.version);
console.log("Audit event:", result.auditEvent);
```

---

## 💾 Database Schema

### task_leases Table

- **PK**: `lease_id`
- **FKs**: `task_id` (→ tasks), `pool_id` (→ worker_pools)
- **Indexes**: 3 (task_id, worker_id, status)

### tasks Table (Lease-Related Fields)

- **current_lease_id**: References task_leases
- **status**: Enum value stored as text
- **version**: Integer (incremented per transition)
- **retry_count**: Integer (for retry policy)

---

## 🎨 Design Patterns

### 1. Map-Based State Machine

- Transition table: `Map<"FromState→ToState", GuardFn>`
- Guards: Precondition functions
- Validated before any database update

### 2. Optimistic Concurrency Control

- **Tasks**: Version column (incremented each update)
- **Leases**: Status-based (current status verified)
- Conflicts throw `VersionConflictError`

### 3. Atomic Transactions

- Fetch → Validate → Update → Audit (all in one transaction)
- Rollback on any error
- No partial updates

### 4. Audit Trail

- Every transition recorded in audit table
- Includes actor, old state, new state, metadata
- Immutable (append-only)

### 5. Domain Events

- Emitted AFTER transaction commits
- Decouple transition logic from observers
- Enable eventual consistency

---

## ⚙️ Optimistic Concurrency Control

### For Tasks

```typescript
// Update only succeeds if version matches
repos.task.updateStatus(
  taskId,
  expectedVersion, // Must match database
  newStatus,
);
// If version mismatch: throws VersionConflictError
// On success: version incremented to expectedVersion + 1
```

### For Leases

```typescript
// Update only succeeds if status matches
repos.taskLease.updateStatus(
  leaseId,
  expectedStatus, // Must match database
  newStatus,
);
// If status mismatch: throws VersionConflictError
```

---

## 📚 Key Interfaces

### TransitionService

```typescript
transitionTask(taskId, targetStatus, context, actor, metadata);
transitionLease(leaseId, targetStatus, context, actor, metadata);
```

### Repository Ports

```typescript
TaskRepositoryPort {
  findById(id): entity | undefined
  updateStatus(id, version, newStatus): entity
}

TaskLeaseRepositoryPort {
  findById(id): entity | undefined
  updateStatus(id, expectedStatus, newStatus): entity
}
```

### Unit of Work

```typescript
runInTransaction<T>(fn: (repos) => T): T
```

---

## 🚦 Guard Functions

### Task State Machine Guards

Each transition has a guard that validates preconditions:

| Guard                             | Checks                                                              |
| --------------------------------- | ------------------------------------------------------------------- | --- | ------------------------------ |
| `guardReadyToAssigned`            | `leaseAcquired === true`                                            |
| `guardAssignedToInDevelopment`    | `hasHeartbeat === true`                                             |
| `guardInDevelopmentToDevComplete` | `hasDevResultPacket === true && requiredValidationsPassed === true` |
| `guardToEscalated`                | `isOperator === true                                                |     | hasEscalationTrigger === true` |
| And 20+ more...                   | Various preconditions                                               |

### Lease State Machine Guards

| Guard                        | Checks                            |
| ---------------------------- | --------------------------------- |
| `guardIdleToLeased`          | `leaseAcquired === true`          |
| `guardLeasedToStarting`      | `workerProcessSpawned === true`   |
| `guardStartingToRunning`     | `firstHeartbeatReceived === true` |
| `guardRunningToHeartbeating` | `heartbeatReceived === true`      |
| And more...                  | Various preconditions             |

---

## 🔍 Common Queries

### "How do I transition a task to ASSIGNED?"

**Answer**: Use `transitionService.transitionTask()` with `leaseAcquired: true` in context.
**Example**: TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 1

### "What are the lease states?"

**Answer**: 9 states with COMPLETING and RECLAIMED as terminal.
**Details**: TASK_LEASE_QUICK_REFERENCE.md - Status Enums section

### "What happens when a lease times out?"

**Answer**: RUNNING/HEARTBEATING → TIMED_OUT → RECLAIMED, then task → FAILED
**Example**: TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 5

### "How is concurrency controlled?"

**Answer**: Version-based for tasks, status-based for leases, checked in atomic transactions.
**Details**: TASK_LEASE_QUICK_REFERENCE.md - Repository Port Interfaces

### "Where is the lease state machine defined?"

**Answer**: `packages/domain/src/state-machines/worker-lease-state-machine.ts`
**Reference**: TASK_LEASE_DOMAIN_LAYER.md - Section 5

---

## 📖 Document Relationships

```
README_TASK_LEASE_DOMAIN.md (This file)
    ↓
TASK_LEASE_DOCUMENTATION_INDEX.md (Navigation guide)
    ├→ TASK_LEASE_QUICK_REFERENCE.md (Fast lookups)
    ├→ TASK_LEASE_DOMAIN_LAYER.md (Complete reference)
    └→ TASK_LEASE_IMPLEMENTATION_EXAMPLES.md (Code samples)
```

---

## �� Learning Path

1. **Beginner**: Read README_TASK_LEASE_DOMAIN.md (this file) - 10 min
2. **Intermediate**: Study TASK_LEASE_QUICK_REFERENCE.md - 15 min
3. **Advanced**: Reference TASK_LEASE_DOMAIN_LAYER.md sections as needed
4. **Practice**: Follow TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - 30 min
5. **Expert**: Deep dive into source files with line numbers from docs

---

## 🔗 Source Files

All line numbers referenced in documentation:

| Component           | File                                                                        | Lines            |
| ------------------- | --------------------------------------------------------------------------- | ---------------- |
| Enums               | packages/domain/src/enums.ts                                                | 26-46, 146-159   |
| Task State Machine  | packages/domain/src/state-machines/task-state-machine.ts                    | 1-703            |
| Lease State Machine | packages/domain/src/state-machines/worker-lease-state-machine.ts            | 1-389            |
| Transition Service  | packages/application/src/services/transition.service.ts                     | 1-451            |
| Repository Ports    | packages/application/src/ports/repository.ports.ts                          | 1-167            |
| Unit of Work        | packages/application/src/ports/unit-of-work.port.ts                         | 1-56             |
| Lease Repository    | apps/control-plane/src/infrastructure/repositories/task-lease.repository.ts | 1-102            |
| Database Schema     | apps/control-plane/src/infrastructure/database/schema.ts                    | 219-377, 774-847 |

---

## ✅ Next Steps

1. **Understand the basics**: Read TASK_LEASE_QUICK_REFERENCE.md (Status Enums section)
2. **See it in action**: Study Example 1 in TASK_LEASE_IMPLEMENTATION_EXAMPLES.md
3. **Get detailed info**: Reference TASK_LEASE_DOMAIN_LAYER.md as needed
4. **Implement features**: Use TASK_LEASE_DOCUMENTATION_INDEX.md to find relevant sections

---

## 📞 Quick Help

- **"What's the diagram of states?"** → TASK_LEASE_QUICK_REFERENCE.md - Status Enums
- **"Show me example code"** → TASK_LEASE_IMPLEMENTATION_EXAMPLES.md
- **"Where's the full type definition?"** → TASK_LEASE_DOMAIN_LAYER.md
- **"How do I find something?"** → TASK_LEASE_DOCUMENTATION_INDEX.md
- **"What's the database schema?"** → TASK_LEASE_QUICK_REFERENCE.md - Database Fields tables

---

_Last updated: March 11, 2025_
_Documentation for: Autonomous Software Factory - Task Lease Domain Layer_
