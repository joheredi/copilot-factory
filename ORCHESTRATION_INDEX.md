# Complete Application Services Orchestration Guide

**Last Updated:** March 11, 2024  
**Total Documentation:** 3 comprehensive guides + this index

---

## 📚 Documentation Overview

This is your complete reference for understanding how the Copilot Factory application services orchestrate the full task lifecycle. Three comprehensive documents are provided:

### 1. **ORCHESTRATION_SERVICES.md** (792 lines, 23 KB)

**Read this first for understanding the architecture**

- Overview of 20 core orchestration services
- Detailed description of each service's purpose and responsibilities
- Service dependency relationships
- Transaction and concurrency model
- Event flow and audit trail patterns
- Complete service responsibility map
- Key architectural patterns

**Best for:** Understanding how services work together, service dependencies, transaction boundaries

### 2. **SERVICE_FILES_REFERENCE.md** (485 lines, 17 KB)

**Use this as a lookup guide**

- Complete file reference for all 25 services
- File location, line count, and key methods for each service
- Detailed parameter and return types
- Quick lookup by feature area
- Service import patterns
- Testing notes

**Best for:** Finding which file contains what, looking up specific service methods, understanding dependencies

### 3. **ORCHESTRATION_FLOW_DIAGRAM.md** (547 lines, 29 KB)

**Visual reference for understanding flows**

- Task lifecycle state machine diagram
- Complete orchestration pipeline (10 phases)
- Service dependency graph
- Transaction boundary patterns
- Concurrency control strategy
- Atomic operation specifications

**Best for:** Understanding the visual flow, seeing how services coordinate, grasping state transitions

---

## 🎯 Quick Navigation by Use Case

### "I want to understand the complete task lifecycle"

1. Start with **ORCHESTRATION_FLOW_DIAGRAM.md** - Task Lifecycle State Machine section
2. Read **ORCHESTRATION_SERVICES.md** - Core Orchestration Flow section
3. Reference specific services in **SERVICE_FILES_REFERENCE.md** as needed

### "I need to find a specific service"

1. Use **SERVICE_FILES_REFERENCE.md** - Quick lookup table at the top
2. Find the file location and key methods
3. Open the service file for implementation details

### "I want to understand a specific flow (e.g., task assignment)"

1. Go to **ORCHESTRATION_FLOW_DIAGRAM.md** - find the phase
2. Read the corresponding section in **ORCHESTRATION_SERVICES.md**
3. Look up individual services in **SERVICE_FILES_REFERENCE.md**

### "I'm implementing error handling or retries"

1. Read **ORCHESTRATION_SERVICES.md** - Lease Reclaim Service section
2. Check the state machine in **ORCHESTRATION_FLOW_DIAGRAM.md**
3. Look at specific implementation in the service file

### "I need to understand transaction patterns"

1. Read **ORCHESTRATION_SERVICES.md** - Transaction & Concurrency Model section
2. Look at **ORCHESTRATION_FLOW_DIAGRAM.md** - Transaction Boundaries section
3. Study the actual service implementations for examples

---

## 🔑 Key Concepts

### The 10-Phase Orchestration Pipeline

```
PHASE 1: Task Ready & Assignment         [Scheduler, Lease]
PHASE 2: Worker Execution                [Worker Supervisor, Heartbeat]
PHASE 3: Worker Completion & Validation  [Validation Gate, Validation Runner]
PHASE 4: Review Fan-Out                  [Reviewer Dispatch]
PHASE 5: Specialist Reviews              [Validation Runner]
PHASE 6: Lead Review Consolidation       [Lead Review Consolidation]
PHASE 7: Lead Review Decision            [Review Decision]
PHASE 8: Merge Queueing & Execution      [Merge Queue, Merge Executor]
PHASE 9: Post-Merge Validation           [Validation Gate, Validation Runner]
PHASE 10: Failure Recovery (at any phase)[Heartbeat, Lease Reclaim]
```

### Core Services (⭐ critical to understand)

1. **Scheduler Service** - Assigns ready tasks to worker pools
2. **Worker Supervisor Service** - Manages worker process lifecycle
3. **Lease Service** - Ensures one-active-lease-per-task
4. **Lease Reclaim Service** - Recovers from worker failures
5. **Transition Service** - Centralized state transition authority
6. **Reviewer Dispatch Service** - Fans out review work
7. **Review Decision Service** - Applies lead reviewer's decision
8. **Merge Queue Service** - Serializes merges with priority ordering
9. **Merge Executor Service** - Orchestrates rebase-and-merge
10. **Job Queue Service** - DB-backed job coordination

---

## 📋 Task Lifecycle States

```
READY
  ↓ [Scheduler acquires lease]
ASSIGNED
  ↓ [Worker starts execution]
IN_DEVELOPMENT
  ↓ [Worker completes, validation passes]
DEV_COMPLETE
  ↓ [Reviewer dispatch creates review jobs]
IN_REVIEW
  ├─→ APPROVED → QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION → DONE
  ├─→ CHANGES_REQUESTED → back to IN_DEVELOPMENT
  └─→ ESCALATED → [Manual intervention]

FAILED [Terminal]
ESCALATED [Terminal]
DONE [Terminal]
```

---

## 🔄 Atomic Transaction Pattern

All services follow the same transaction pattern:

```typescript
BEGIN TRANSACTION
  1. Read entity/entities
  2. Validate state machine transition
  3. Write status update (with optimistic concurrency)
  4. Create audit event (ATOMICALLY)
COMMIT

AFTER commit succeeds:
  Emit domain event(s)
```

**Key guarantees:**

- All database operations succeed or roll back entirely
- Events only emitted on successful commit
- Prevents inconsistency between state and events

---

## 🔐 Concurrency Control

### For Tasks (Version-Based)

- Each update increments version
- UPDATE checks old version matches
- VersionConflictError on mismatch
- Strong consistency

### For Other Entities (Status-Based)

- UPDATE checks current status matches expected
- VersionConflictError on mismatch
- Good for low-frequency updates

### Exclusive Operations

- Lease acquisition checks no active lease exists
- ExclusivityViolationError if violated
- Enforces one-active-lease-per-task invariant

---

## 📊 Service Dependency Map

```
Transition Service (central authority for state changes)
  ↑ (all services call through)
  │
├─ Scheduler Service
├─ Worker Supervisor Service
├─ Lease Service
├─ Heartbeat Service
├─ Lease Reclaim Service
├─ Reviewer Dispatch Service
├─ Lead Review Consolidation Service
├─ Review Decision Service
├─ Merge Queue Service
└─ Merge Executor Service

Support Services:
├─ Job Queue Service (creates work units)
├─ Validation Services (validate)
├─ Policy Snapshot Service (provides policies)
├─ Output Validator Service (validates packets)
└─ Dependency Services (track dependencies)
```

---

## 🚀 Implementation Checklist

When implementing a new service or modifying existing ones:

- [ ] Use injected `unitOfWork` for transactions
- [ ] Validate state machine transitions (from @factory/domain)
- [ ] Use optimistic concurrency control
- [ ] Record audit events atomically with state changes
- [ ] Emit domain events AFTER transaction commit
- [ ] Handle common errors (EntityNotFoundError, InvalidTransitionError)
- [ ] Provide dependency injection factory function
- [ ] Write tests with mock dependencies
- [ ] Document state machine transitions
- [ ] Add JSDoc comments

---

## 📖 Related Documentation

Other important documents in this repository:

- **TASK_LEASE_DOMAIN_LAYER.md** - Domain layer state machines
- **README_TASK_LEASE_DOMAIN.md** - Quick reference for domain concepts
- **READINESS_DEPENDENCY_ANALYSIS.md** - Task dependency analysis

---

## 🔍 File Locations

All service files are in:

```
packages/application/src/services/
```

Port definitions in:

```
packages/application/src/ports/
```

Domain layer in:

```
packages/domain/src/
```

---

## 💡 Tips for Reading the Code

### Start with ports

Read the port files first to understand the interface contracts:

```
packages/application/src/ports/scheduler.ports.ts
packages/application/src/ports/worker-supervisor.ports.ts
etc.
```

### Then read the service implementation

Look at the factory function to see dependencies:

```typescript
export function createSchedulerService(
  unitOfWork: SchedulerUnitOfWork,
  leaseService: LeaseService,
  jobQueueService: JobQueueService,
  idGenerator: () => string,
): SchedulerService {
  // Implementation
}
```

### Study the transaction pattern

Every service follows the same pattern for safety

### Trace the event emission

Events are emitted after commit - this is critical for consistency

---

## ❓ Common Questions

**Q: How is state consistency maintained?**
A: Through atomic transactions that bundle status changes with audit events, combined with domain state machine validation.

**Q: What happens if a worker crashes?**
A: Heartbeat timeout is detected, lease is reclaimed, retry/escalation policy is evaluated, and task is either retried or failed.

**Q: How is review workflow coordinated?**
A: Specialist jobs share a jobGroupId, lead review job depends on all specialists (via dependsOnJobIds), and job queue service ensures lead can't claim until all specialists are terminal.

**Q: Can multiple workers claim the same task?**
A: No - lease acquisition is exclusive (one-active-lease-per-task invariant) and checked atomically within a transaction.

**Q: How are merges serialized per repository?**
A: Through the merge queue service which maintains order per repository based on priority, enqueue time, and item ID.

**Q: What validation gates prevent?**
A: Blocking state transitions until required validation profiles pass (e.g., can't move to DEV_COMPLETE without default-dev passing).

---

## 📞 Support

If you need to understand a specific aspect:

1. Check the appropriate guide above
2. Look up the service in SERVICE_FILES_REFERENCE.md
3. Read the service implementation file
4. Check the port definition for interface contracts
5. Look at tests (\*.test.ts) for example usage

---

**Total Service Code:** ~33,000 lines  
**Number of Services:** 25 (12 critical, 13 supporting)  
**Documentation Coverage:** 3 comprehensive guides + index  
**Last Updated:** March 11, 2024
