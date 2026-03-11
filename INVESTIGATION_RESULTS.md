# Investigation Results: Codebase Analysis for Test Harness Development

## Investigation Date

Generated for T106 Test Harness Implementation

## Files Analyzed

### Packages Overview

- ✅ `packages/testing/` - Minimal, needs build
- ✅ `packages/domain/` - Complete domain layer
- ✅ `packages/infrastructure/` - Complete infrastructure layer
- ✅ `packages/application/` - Complete application layer
- ✅ `packages/schemas/` - Complete schemas layer

### Domain Files (Complete)

- ✅ `packages/domain/src/index.ts` - Main exports
- ✅ `packages/domain/src/enums.ts` - 32 enums (20.5 KB)
- ✅ `packages/domain/src/state-machines/task-state-machine.ts` - Task state validation (26.6 KB)
- ✅ `packages/domain/src/state-machines/worker-lease-state-machine.ts` - Worker lease lifecycle
- ✅ `packages/domain/src/state-machines/merge-queue-item-state-machine.ts` - Merge queue states
- ✅ `packages/domain/src/state-machines/review-cycle-state-machine.ts` - Review states
- ✅ `packages/domain/src/policies/` (6 policy files) - Policies (command, file-scope, validation, retry, escalation)
- ✅ `packages/domain/src/conflict-priority.ts` - Merge conflict classification
- ✅ `packages/domain/src/*.test.ts` - Domain tests showing patterns

### Schemas Files (Complete)

- ✅ `packages/schemas/src/index.ts` - Main exports
- ✅ `packages/schemas/src/task-packet.ts` - TaskPacket schema
- ✅ `packages/schemas/src/shared.ts` - Shared Zod schemas
- ✅ `packages/schemas/src/dev-result-packet.ts` - Developer result schema
- ✅ `packages/schemas/src/review-packet.ts` - Review result schema
- ✅ `packages/schemas/src/merge-packet.ts` - Merge result schema
- ✅ `packages/schemas/src/validation-result-packet.ts` - Validation result schema
- ✅ `packages/schemas/src/lead-review-decision-packet.ts` - Lead review decision
- ✅ `packages/schemas/src/merge-assist-packet.ts` - Merge assist schema
- ✅ `packages/schemas/src/post-merge-analysis-packet.ts` - Post-merge analysis
- ✅ `packages/schemas/src/policy-snapshot.ts` - Policy snapshot schema
- ✅ `packages/schemas/src/version.ts` - Schema versioning

### Infrastructure Files (Analyzed)

- ✅ `packages/infrastructure/src/worker-runtime/runtime.interface.ts` - WorkerRuntime contract
- ✅ `packages/infrastructure/src/worker-runtime/types.ts` - Runtime types (RunContext, PreparedRun, etc.)
- ✅ `packages/infrastructure/src/worker-runtime/registry.ts` - RuntimeRegistry singleton
- ✅ `packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts` - Real CopilotCliAdapter implementation
- ✅ `packages/infrastructure/src/workspace/` - Workspace management (4 files)
- ✅ `packages/infrastructure/src/artifacts/` - Artifact storage (2 files)
- ✅ `packages/infrastructure/src/validation/` - Validation execution (2 files)
- ✅ `packages/infrastructure/src/policy/` - Policy enforcement (command-wrapper)

### Application Files (Analyzed)

- ✅ `packages/application/src/ports/` - 22 port files
  - worker-supervisor.ports.ts ✅ (SupervisedWorker, RuntimeAdapterPort, WorkspaceProviderPort, PacketMounterPort)
  - lease.ports.ts ✅ (LeaseAcquisitionTask, LeaseRepositoryPort, LeaseUnitOfWork)
  - job-queue.ports.ts ✅ (QueuedJob, JobQueueRepositoryPort, JobQueueUnitOfWork)
  - repository.ports.ts ✅ (TransitionableTask, TaskRepositoryPort, TransitionableTaskLease, etc.)
  - unit-of-work.port.ts ✅ (UnitOfWork interface, TransactionRepositories)
  - Plus 17 other service ports (all analyzed for patterns)

- ✅ `packages/application/src/services/` (40+ service files)
  - worker-supervisor.service.ts (lifecycle management)
  - worker-supervisor.service.test.ts (shows test patterns)
  - lease.service.ts (lease acquisition)
  - All other services follow port-based DI pattern

### Testing Files (Analyzed)

- ✅ `packages/testing/src/index.ts` - Basic utilities only
- ✅ `packages/testing/src/index.test.ts` - Test for test utilities
- ✅ `packages/testing/package.json` - Package structure

### Documentation (Analyzed)

- ✅ `docs/backlog/tasks/T106-test-harness.md` - Task specification
- ✅ Task requirements and acceptance criteria
- ✅ Expected test doubles and fixtures

### Package.json Files

- ✅ `packages/testing/package.json`
- ✅ `packages/domain/package.json`
- ✅ `packages/infrastructure/package.json`
- ✅ `packages/application/package.json`
- ✅ `packages/schemas/package.json`

## Key Findings

### 1. Architecture Pattern

- **Port-Based Dependency Injection**: All services depend on narrow interfaces (ports)
- **Layered Architecture**: domain → schemas → application (ports) ← infrastructure
- **Clear Separation**: Testing layer can provide fake implementations of ports without touching production code

### 2. State Machines (4 total)

All use guard-based validation pattern with:

- Transition map (from→to, GuardFn pairs)
- Guard functions validating preconditions
- Terminal state tracking
- Valid target enumeration

### 3. Domain Enums (32 total)

All defined as `as const` objects with derived union types for full TypeScript safety and runtime iteration.

### 4. Existing Test Patterns

From `worker-supervisor.service.test.ts`:

- Mock factories (createMockWorkerRepo)
- In-memory storage pattern
- Test constants (SYSTEM_ACTOR, FIXED_TIME)
- Service invocation with mock dependencies

### 5. Critical Interfaces

**For Fakes Implementation:**

- WorkerRuntime (6 methods, async generator for streaming)
- Repository ports (8 types, all throw on version conflict)
- UnitOfWork (simple transaction boundary)
- WorkspaceProviderPort & PacketMounterPort (workspace management)

### 6. Packet System

- TaskPacket (input to workers)
- 7 output packet types (DevResult, Review, Merge, etc.)
- All Zod-based with validation
- PolicySnapshot for policy configuration

## Recommendations for T106 Implementation

### Priority 1: Core Fakes (blocks everything else)

1. **FakeClock** - Simplest, no dependencies
2. **FakeRunnerAdapter** - Core for all tests
3. **In-Memory Repositories** - Data layer

### Priority 2: Test Utilities

4. **FakeUnitOfWork** - Wraps repositories
5. **Entity Factories** - Uses repositories for defaults
6. **FakeEventEmitter** - Event tracking

### Priority 3: Integration

7. **FakeWorkspaceManager** - Workspace provisioning
8. **State Transition Helpers** - runTaskToState
9. **Test Database Setup** - In-memory SQLite with migrations
10. **Integration Tests** - Validate fakes work

## Files to Create

```
packages/testing/src/
├── fakes/
│   ├── index.ts
│   ├── fake-runner.ts
│   ├── fake-workspace-manager.ts
│   ├── fake-clock.ts
│   ├── fake-repositories.ts
│   ├── fake-unit-of-work.ts
│   └── fake-event-emitter.ts
├── factories/
│   ├── index.ts
│   ├── task.factory.ts
│   ├── worker.factory.ts
│   ├── lease.factory.ts
│   ├── packet.factory.ts
│   └── policy.factory.ts
├── database/
│   ├── index.ts
│   └── migrations.ts
├── helpers/
│   ├── index.ts
│   └── state-transitions.ts
└── index.ts (update to export all)
```

## Key Interfaces to Implement

### WorkerRuntime

```typescript
interface WorkerRuntime {
  readonly name: string;
  prepareRun(context: RunContext): Promise<PreparedRun>;
  startRun(runId: string): Promise<void>;
  streamRun(runId: string): AsyncIterable<RunOutputStream>;
  cancelRun(runId: string): Promise<CancelResult>;
  collectArtifacts(runId: string): Promise<CollectedArtifacts>;
  finalizeRun(runId: string): Promise<FinalizeResult>;
}
```

### Repository Pattern

```typescript
// All repositories follow this pattern:
- findById(id): Entity | undefined
- create(data): Entity
- update(id, data): Entity
- All throw VersionConflictError on version mismatch
```

## Unblocking E2E Tests (T107-T111)

After T106, E2E tests can:

- Use FakeRunnerAdapter to control worker outcomes
- Use factory helpers to create valid test entities
- Use FakeClock to advance time
- Use state transition helper to drive tasks through states
- Verify system behavior without real infrastructure

## Related Documentation

- PR D 002: Data Model & State Machines
- PRD 007: Technical Architecture & Worker Runtime
- PRD 008: Packet and Schema Spec
- PRD 009: Policy and Enforcement Spec
- PRD 010: Integration Contracts

## Investigation Summary

The codebase is well-structured with clear port boundaries. The test harness can be built as pure fakes implementing port interfaces, without touching production code. All state machines, entities, and packets are well-documented and follow consistent patterns. The main challenge is implementing all the fakes correctly to ensure deterministic testing, which this analysis provides clear guidance for.

---

**Files referenced in this analysis:** 50+
**Files analyzed in detail:** 30+
**Patterns identified:** 12+
**Recommended implementation order:** 10 phases
