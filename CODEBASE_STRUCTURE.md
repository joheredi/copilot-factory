# Codebase Structure Summary for Test Harness Development

## Quick Reference

### Current State

- **@factory/testing**: Empty package (only basic utilities: createTestId, createSequentialId, sleep)
- **@factory/domain**: Complete (32 enums, 4 state machines, policies)
- **@factory/schemas**: Complete (Zod packet schemas)
- **@factory/application**: Complete (22 port interfaces, services using DI)
- **@factory/infrastructure**: Complete (WorkerRuntime adapters, workspace manager)

### What Needs Building (T106)

All in `packages/testing/src/`:

- `fakes/fake-runner.ts` - WorkerRuntime adapter for testing
- `fakes/fake-workspace-manager.ts` - Workspace provisioning mock
- `fakes/fake-clock.ts` - Time manipulation
- `fakes/fake-repositories.ts` - In-memory entity storage
- `fakes/fake-unit-of-work.ts` - Transaction mock
- `fakes/fake-event-emitter.ts` - Event tracking
- `factories/task.factory.ts`, etc. - Entity creation helpers
- `database/index.ts` - Test DB setup/teardown
- `helpers/state-transitions.ts` - runTaskToState helper

## Architecture Pattern: Port-Based Dependency Injection

```
Services (application layer)
  ↓ (depend on)
Ports (interfaces) - 22 total
  ↓ (implemented by)
┌──────────────────────────┬──────────────────────┐
Infrastructure Layer       Test Layer (to build)
├─ CopilotCliAdapter   ├─ FakeRunnerAdapter
├─ WorkspaceManager    ├─ FakeWorkspaceManager
├─ Real Repos          ├─ FakeRepos
└─ Real DB             └─ In-Memory Storage
```

## Domain Model Overview

### 4 State Machines (guard-based validation)

1. **TaskStateMachine**: 16 states (BACKLOG→DONE via IN_DEVELOPMENT→IN_REVIEW→APPROVED→QUEUED_FOR_MERGE→MERGING→POST_MERGE_VALIDATION→DONE)
2. **WorkerLeaseStateMachine**: 9 states (IDLE→LEASED→STARTING→RUNNING→HEARTBEATING→COMPLETING, with error paths to TIMED_OUT/CRASHED/RECLAIMED)
3. **ReviewCycleStateMachine**: 7 states (NOT_STARTED→ROUTED→IN_PROGRESS→CONSOLIDATING→APPROVED/REJECTED/ESCALATED)
4. **MergeQueueItemStateMachine**: 8 states (ENQUEUED→PREPARING→REBASING→VALIDATING→MERGING→MERGED, with FAILED/REQUEUED paths)

All state machines implement this interface:

```typescript
validateTransition(current, target, context) → {valid: bool, reason?: string}
getValidTargets(current) → State[]
isTerminalState(state) → bool
getAllValidTransitions() → [from, to][]
```

### 32 Domain Enums

TaskStatus, WorkerLeaseStatus, ReviewCycleStatus, MergeQueueItemStatus,
TaskType, TaskPriority, TaskSource, EstimatedSize, RiskLevel,
DependencyType, WorkerPoolType, JobType, JobStatus,
ValidationRunScope, ValidationRunStatus, ValidationCheckType, ValidationCheckStatus,
PacketType, PacketStatus, FileChangeType, IssueSeverity,
ReviewVerdict, LeadReviewDecision, MergeStrategy,
MergeAssistRecommendation, PostMergeAnalysisRecommendation,
Confidence, AgentRole, FileScopeEnforcementLevel, EscalationAction

## Critical Interfaces for Fakes

### WorkerRuntime (to implement as FakeRunnerAdapter)

```typescript
interface WorkerRuntime {
  readonly name: string;
  prepareRun(context: RunContext): Promise<PreparedRun>;
  startRun(runId: string): Promise<void>;
  streamRun(runId: string): AsyncIterable<RunOutputStream>; // yields heartbeat events
  cancelRun(runId: string): Promise<CancelResult>;
  collectArtifacts(runId: string): Promise<CollectedArtifacts>;
  finalizeRun(runId: string): Promise<FinalizeResult>;
}
```

### Repository Ports (to implement in-memory)

```typescript
// All throw VersionConflictError on version mismatch
interface TaskRepositoryPort {
  findById(id: string): Task | undefined;
  updateStatus(id, expectedVersion, newStatus): Task;
}

// Same pattern for:
interface TaskLeaseRepositoryPort { ... }
interface ReviewCycleRepositoryPort { ... }
interface MergeQueueItemRepositoryPort { ... }
interface JobQueueRepositoryPort { ... }
interface WorkerSupervisorRepositoryPort { ... }
interface AuditEventRepositoryPort { ... }
```

### UnitOfWork Port (to implement as pass-through for testing)

```typescript
interface UnitOfWork {
  runInTransaction<T>(fn: (repos: TransactionRepositories) => T): T;
}
```

## Packet Types (for factories)

**Inputs:**

- TaskPacket - Contains task metadata, repository info, workspace paths, policies, validation requirements

**Outputs:**

- DevResultPacket - Developer work results (files changed, issues found)
- ReviewPacket - Reviewer verdict and issues
- LeadReviewDecisionPacket - Lead review decision
- MergePacket - Merge task completion
- MergeAssistPacket - Merge conflict assistance
- ValidationResultPacket - Validation check results
- PostMergeAnalysisPacket - Post-merge analysis

All schemas are Zod-based, available from `@factory/schemas`.

## Key Entity Types

```typescript
// Core entities (need factories)
Task: {id, status, version, title, description, type, priority, ...}
Worker: {workerId, poolId, status, currentTaskId, currentRunId, ...}
WorkerLease: {id, status, taskId, workerId, expiresAt, ...}
ReviewCycle: {id, status, taskId, ...}
MergeQueueItem: {id, status, taskId, ...}
Job: {jobId, jobType, entityType, entityId, status, ...}

// Value objects (compose entities)
FileChangeSummary: {path, changeType, summary}
Issue: {severity, code, title, description, filePath?, line?, blocking}
ValidationCheckResult: {checkType, toolName, command, status, durationMs, summary}
```

## Port Interfaces (22 total)

For services: worker-supervisor, lease, job-queue, scheduler, heartbeat, validation-runner, validation-gate,
transition, repository, unit-of-work, event-emitter, policy-snapshot, merge-queue, merge-executor,
output-validator, dependency, readiness, graceful-completion, lead-review-consolidation,
reviewer-dispatch, review-router, reverse-dependency, validation-packet-emitter

Each service imports only the ports it needs (narrow interface principle).

## Testing Strategy

### 1. Setup

```typescript
const fakeRunner = new FakeRunnerAdapter({ result: "success" });
const fakeRepos = createFakeRepositories();
const fakeUoW = new FakeUnitOfWork(fakeRepos);
const fakeWorkspace = new FakeWorkspaceManager();
const fakeEvents = new FakeEventEmitter();
```

### 2. Create Test Data

```typescript
const task = createTestTask({ status: TaskStatus.READY });
const lease = createTestLease({ taskId: task.id });
const worker = createTestWorker({ poolId: "default" });
```

### 3. Execute

```typescript
const service = createWorkerSupervisorService({
  repo: fakeRepos.worker,
  workspace: fakeWorkspace,
  runtime: fakeRunner,
  eventEmitter: fakeEvents,
});

const result = await service.spawnWorker({
  workerId: worker.id,
  taskId: task.id,
  // ...
});
```

### 4. Verify

```typescript
expect(result.finalizeResult.status).toBe("success");
expect(fakeEvents.getEvents()).toContainEqual(expect.objectContaining({ type: "WorkerStarted" }));
```

## Dependency Order for Implementation

1. FakeClock (simplest)
2. FakeRunnerAdapter
3. In-memory Repositories
4. FakeUnitOfWork
5. Entity Factories
6. State Transition Helpers
7. FakeEventEmitter
8. FakeWorkspaceManager
9. Test Database setup
10. Integration with existing tests

## Files to Check for Examples

- `packages/application/src/services/worker-supervisor.service.test.ts` - Shows mock patterns
- `packages/domain/src/state-machines/*.ts` - Guard implementation patterns
- `packages/infrastructure/src/worker-runtime/runtime.interface.ts` - WorkerRuntime contract
- `packages/application/src/ports/worker-supervisor.ports.ts` - Port definitions

## Common Errors to Handle

```typescript
VersionConflictError - When optimistic concurrency fails
EntityNotFoundError - When entity doesn't exist
InvalidTransitionError - When state transition not allowed
ExclusivityViolationError - When lease already exists
RuntimeNotFoundError - When adapter not registered
```

Fakes must throw these appropriately for error path testing.

## Key Test Files Created

After T106:

- `packages/testing/src/index.ts` - Exports all fakes and factories
- `packages/testing/src/fakes/` - All fake implementations
- `packages/testing/src/factories/` - All entity factories
- `packages/testing/src/database/` - Test DB helpers
- `packages/testing/src/helpers/` - State transition helpers
- `packages/testing/src/index.test.ts` - Tests for testing layer

Then E2E tests (T107-T111) can:

```bash
pnpm test --filter @factory/testing      # Unit test the fakes
pnpm test --filter @factory/application  # Integration tests using fakes
```

---

See `/tmp/CODEBASE_ANALYSIS.md` for full detailed analysis.
