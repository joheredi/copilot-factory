# Task Lease Domain Layer - Documentation Index

This documentation comprehensively covers the task lease domain layer, including type definitions, state machines, repository interfaces, and implementation patterns.

## 📚 Documentation Files

### 1. **TASK_LEASE_DOMAIN_LAYER.md** (Complete Reference)

**Scope**: Full technical reference with all type definitions and code listings
**Contents**:

- TaskLease entity database schema with all fields
- WorkerLeaseStatus enum (9 states)
- Task entity fields (lease-related)
- TaskStatus enum (16 states)
- WorkerLease state machine (transitions, guards, context)
- Task state machine (transitions, guards, context)
- Transition Service implementation
- Repository port interfaces
- Unit of Work port definition
- TaskLease repository implementation

**When to use**: When you need the complete, authoritative definitions of types, enums, and state machines

---

### 2. **TASK_LEASE_QUICK_REFERENCE.md** (Quick Lookup)

**Scope**: Fast lookup guide with tables and diagrams
**Contents**:

- File location map with line numbers
- Status enum diagrams (visual state flows)
- Lease acquisition state table
- WorkerLeaseTransitionContext fields table
- TaskTransitionContext fields table
- Database schema field tables
- Repository port interface signatures
- Transition service pattern (5-step flow)
- Terminal state definitions
- Typical workflows (happy path, rework, failure scenarios)

**When to use**: When you need to quickly find a field name, understand a workflow, or check which context fields are required

---

### 3. **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** (Code Examples)

**Scope**: Practical code examples demonstrating domain usage
**Contents**:

- Example 1: Task transition validation (READY → ASSIGNED with lease)
- Example 2: Lease state transitions (complete lifecycle)
- Example 3: Full TransitionService usage
- Example 4: Lease through complete lifecycle
- Example 5: Lease failure handling (timeout → reclaim)
- Example 6: Rework cycle (changes requested → assigned)
- Example 7: Operator escalation with lease acquisition
- Example 8: Getting valid targets for UI
- Example 9: Repository usage within transaction
- Example 10: Checking all valid transitions

**When to use**: When implementing features, handling errors, or understanding typical workflows

---

## 🎯 Quick Navigation by Topic

### Understanding State Machines

1. Read **TASK_LEASE_QUICK_REFERENCE.md** - Status Enum Diagrams section
2. Reference **TASK_LEASE_DOMAIN_LAYER.md** - Section 5 (Lease) & 6 (Task)
3. Study **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Examples 2 & 4

### Implementing a State Transition

1. Check **TASK_LEASE_QUICK_REFERENCE.md** - Lease Acquisition States table
2. Reference **TASK_LEASE_DOMAIN_LAYER.md** - Section 7 (Transition Service)
3. Follow **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Example 3 (TransitionService)

### Adding a New Transition Type

1. Check **TASK_LEASE_DOMAIN_LAYER.md** - Section 5 (Guards) or 6 (Guards)
2. Reference **TASK_LEASE_QUICK_REFERENCE.md** - Transition Service Pattern
3. Study **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Example 1 or 2

### Understanding Lease Lifecycle

1. Diagram: **TASK_LEASE_QUICK_REFERENCE.md** - Status Enums section
2. Details: **TASK_LEASE_DOMAIN_LAYER.md** - Section 5 (Lease State Machine)
3. Example: **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Example 4

### Handling Failures/Errors

1. Quick ref: **TASK_LEASE_QUICK_REFERENCE.md** - Typical Workflows section
2. Details: **TASK_LEASE_DOMAIN_LAYER.md** - Section 5 (Crash/Timeout paths)
3. Example: **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Example 5

### Database Queries

1. Schema: **TASK_LEASE_QUICK_REFERENCE.md** - TaskLease Database Fields table
2. Details: **TASK_LEASE_DOMAIN_LAYER.md** - Section 1 (Schema) & Section 10 (Repository)
3. Usage: **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Example 9

### UI/Workflow Decisions

1. States: **TASK_LEASE_QUICK_REFERENCE.md** - Status Enums section
2. Transitions: **TASK_LEASE_DOMAIN_LAYER.md** - Valid Transitions Map
3. Code: **TASK_LEASE_IMPLEMENTATION_EXAMPLES.md** - Example 8 (Valid targets)

---

## 📋 Key Concepts at a Glance

### Lease Acquisition (When Tasks Move to ASSIGNED)

Task transitions that **require a lease to be acquired** (`leaseAcquired: true`):

| Transition                     | Context               | Reason                                |
| ------------------------------ | --------------------- | ------------------------------------- |
| `READY → ASSIGNED`             | `leaseAcquired: true` | Initial lease for task execution      |
| `CHANGES_REQUESTED → ASSIGNED` | `leaseAcquired: true` | Rework lease after review feedback    |
| `ESCALATED → ASSIGNED`         | `leaseAcquired: true` | Retry lease after operator escalation |

**See**: Examples 1, 6, 7 in TASK_LEASE_IMPLEMENTATION_EXAMPLES.md

### Worker Lease States (9 states)

```
IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING ✓ (terminal)
     ↓ (error)      ↓          ↓
  TIMED_OUT → RECLAIMED ✓ (terminal)
  CRASHED → RECLAIMED ✓ (terminal)
```

**See**: TASK_LEASE_QUICK_REFERENCE.md (Status Enums) and TASK_LEASE_DOMAIN_LAYER.md (Section 2)

### Task States (16 states)

- **Development Path**: BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE
- **Review Path**: IN_REVIEW → (APPROVED or CHANGES_REQUESTED)
- **Merge Path**: QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION → DONE
- **Terminal**: DONE, FAILED, CANCELLED
- **Exception**: ESCALATED (operator intervention)

**See**: TASK_LEASE_QUICK_REFERENCE.md (Status Enums) and TASK_LEASE_DOMAIN_LAYER.md (Section 4)

### Optimistic Concurrency Control

- **Tasks**: Version-based (version column incremented on each update)
- **Leases**: Status-based (current status verified before update)
- **All Transitions**: Validated atomically within a transaction

**See**: TASK_LEASE_QUICK_REFERENCE.md (Repository Port Interfaces)

### Audit Trail

Every transition creates an atomic audit event containing:

- Entity type and ID
- Transition type (FROM → TO)
- Actor info (who made the change)
- Before/after state (JSON)
- Optional metadata

**See**: TASK_LEASE_QUICK_REFERENCE.md (Audit Events) and TASK_LEASE_IMPLEMENTATION_EXAMPLES.md (Example 3)

---

## 🔗 Cross-References

### File Locations

- **Domain Enums**: `packages/domain/src/enums.ts` (lines 26-46, 146-159)
- **Task State Machine**: `packages/domain/src/state-machines/task-state-machine.ts` (lines 1-703)
- **Lease State Machine**: `packages/domain/src/state-machines/worker-lease-state-machine.ts` (lines 1-389)
- **Transition Service**: `packages/application/src/services/transition.service.ts` (lines 1-451)
- **Repository Ports**: `packages/application/src/ports/repository.ports.ts` (lines 1-167)
- **Unit of Work Port**: `packages/application/src/ports/unit-of-work.port.ts` (lines 1-56)
- **Lease Repository**: `apps/control-plane/src/infrastructure/repositories/task-lease.repository.ts` (lines 1-102)
- **Database Schema**: `apps/control-plane/src/infrastructure/database/schema.ts` (lines 219-377, 774-847)

### Related PRD Sections

- **PRD §2.1**: Task State Machine
- **PRD §2.2**: Worker Lease State Machine
- **PRD §2.3**: Entity fields (Task, TaskLease, dependencies)
- **PRD §2.4**: Key Invariants (optimistic concurrency, audit trails)
- **PRD §2.7**: Escalation Trigger Conditions
- **PRD §7.13**: State Transition Engine
- **PRD §10.2**: Module ownership map (state transition ownership)

---

## ✅ Checklist: Before Implementing State Transitions

- [ ] Read the relevant state machine section (Task or Lease)
- [ ] Understand which states require preconditions (guards)
- [ ] Identify if lease acquisition is involved
- [ ] Check optimistic concurrency approach (version vs status-based)
- [ ] Plan the transition context fields needed
- [ ] Consider error cases (EntityNotFoundError, InvalidTransitionError, VersionConflictError)
- [ ] Design audit event metadata
- [ ] Review Example 3 or 4 in TASK_LEASE_IMPLEMENTATION_EXAMPLES.md
- [ ] Check repository port signatures
- [ ] Test with unit tests following domain layer patterns

---

## 📖 Reading Order (For New Team Members)

1. **Start here**: TASK_LEASE_QUICK_REFERENCE.md - Status Enums section (understand state flows visually)
2. **Then read**: TASK_LEASE_QUICK_REFERENCE.md - Lease Acquisition States & Workflows (typical patterns)
3. **Deep dive**: TASK_LEASE_DOMAIN_LAYER.md - Sections 1, 2, 4, 5 (entity definitions and enums)
4. **Implementation**: TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Examples 1, 3, 8 (basic patterns)
5. **Advanced**: TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Examples 5, 6, 7 (error handling, cycles, escalation)
6. **Reference**: TASK_LEASE_DOMAIN_LAYER.md - Full reference sections as needed

---

## 🚀 Common Tasks

### I need to transition a task from READY → ASSIGNED

**Files to reference**:

- TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 1
- TASK_LEASE_QUICK_REFERENCE.md - Lease Acquisition States table
- TASK_LEASE_DOMAIN_LAYER.md - Section 7 (Transition Service)

**Key points**: Must include `leaseAcquired: true` in context

---

### I need to understand the full lease lifecycle

**Files to reference**:

- TASK_LEASE_QUICK_REFERENCE.md - Status Enums (WorkerLeaseStatus diagram)
- TASK_LEASE_DOMAIN_LAYER.md - Section 5 (complete state machine)
- TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 4

**Key points**: 9 states, 2 terminal states, heartbeat self-loop

---

### I need to handle a lease timeout

**Files to reference**:

- TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 5
- TASK_LEASE_DOMAIN_LAYER.md - Section 5 (Timeout paths)
- TASK_LEASE_QUICK_REFERENCE.md - Typical Workflows (Failure & Reclaim)

**Key points**: RUNNING/HEARTBEATING → TIMED_OUT → RECLAIMED → Task FAILED

---

### I need to add audit logging for transitions

**Files to reference**:

- TASK_LEASE_DOMAIN_LAYER.md - Section 7 (Transition Service, audit event creation)
- TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 3 (audit event metadata)
- TASK_LEASE_QUICK_REFERENCE.md - Audit Events section

**Key points**: Done automatically by TransitionService, includes oldState/newState as JSON

---

### I need to implement optimistic concurrency

**Files to reference**:

- TASK_LEASE_QUICK_REFERENCE.md - Repository Port Interfaces
- TASK_LEASE_DOMAIN_LAYER.md - Section 8 (Repository ports)
- TASK_LEASE_IMPLEMENTATION_EXAMPLES.md - Example 9

**Key points**: Tasks use version-based, Leases use status-based

---

## 📞 Questions?

If you have questions about:

- **State transitions**: Reference Examples 1-7 in TASK_LEASE_IMPLEMENTATION_EXAMPLES.md
- **Database fields**: Check TASK_LEASE_QUICK_REFERENCE.md database tables or TASK_LEASE_DOMAIN_LAYER.md Section 1
- **Guard functions**: See TASK_LEASE_DOMAIN_LAYER.md Sections 5-6 for detailed guards
- **Typical workflows**: TASK_LEASE_QUICK_REFERENCE.md Typical Workflows section
- **API signatures**: TASK_LEASE_DOMAIN_LAYER.md Sections 7-9
