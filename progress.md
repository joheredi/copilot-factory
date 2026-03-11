# Progress Log

## T051: Implement retry and escalation policy evaluation — DONE (2026-03-11)

**Status:** Done

**What was done:**

- Created `packages/domain/src/policies/retry-policy.ts`:
  - `BackoffStrategy` enum (V1: exponential only)
  - `RetryPolicy` interface matching PRD §9.6.1 canonical shape
  - `RetryEvaluationContext` / `RetryEvaluation` result types
  - `calculateBackoff(attempt, policy)` — exponential formula: initial × 2^(attempt−1), capped at max
  - `shouldRetry(context, policy)` — checks retry_count < max_attempts and failure summary requirement
  - `DEFAULT_RETRY_POLICY` constant (max_attempts=2, exponential 60s-900s)
  - `createDefaultRetryPolicy()` factory

- Created `packages/domain/src/policies/escalation-policy.ts`:
  - `EscalationTrigger` enum with all 7 triggers from PRD §9.7.2
  - `EscalationTriggerAction` type extending `EscalationAction` with `retry_or_escalate` and `disable_profile_and_escalate`
  - `EscalationPolicy` interface matching PRD §9.7.1 canonical shape
  - `shouldEscalate(context, policy)` — threshold-based triggers validate context, unconditional triggers always fire
  - Fail-safe: missing context data or unknown triggers default to escalation
  - `getTriggerAction()`, `getConfiguredTriggers()` helpers
  - `DEFAULT_ESCALATION_POLICY` constant (routes to operator-queue, requires summary)
  - `createDefaultEscalationPolicy()` factory

- Created test files with 46 new tests:
  - `retry-policy.test.ts` (20 tests): backoff formula, cap, eligibility, summary requirement, zero-retry, priority of checks
  - `escalation-policy.test.ts` (26 tests): all 7 triggers, threshold-based + unconditional, fail-safe, custom policy routing, reason messages

- Updated `packages/domain/src/index.ts` barrel exports

**Patterns used:** Same as existing policies (command-policy, file-scope-policy, validation-policy):

- `as const` enums with derived union types
- Readonly interfaces
- Pure functions with full JSDoc
- Section dividers

**What the next loop should know:**

- T051 unblocks T033 (lease reclaim) and T053 (policy snapshot)
- The `EscalationAction` enum in `enums.ts` already existed — escalation-policy imports it
- `EscalationTriggerAction` extends `EscalationAction` with two additional string literals for composite actions
- Total test count: 2,191 (up from 2,145)

---

## T035: Implement DAG validation with circular dependency detection — DONE (2026-03-11)

**Status:** Done

**What was done:**

- Created `packages/application/src/ports/dependency.ports.ts` — port interfaces for DAG validation:
  - `DependencyEdge` / `NewDependencyEdge` — entity shapes
  - `DependencyTaskRepositoryPort` — task existence checks
  - `TaskDependencyRepositoryPort` — forward/reverse graph traversal + CRUD
  - `DependencyUnitOfWork` — transaction boundary for atomic cycle-check + insert
- Created `packages/application/src/services/dependency.service.ts` — DependencyService with:
  - `addDependency()` — validates input, runs DFS cycle detection, inserts atomically
  - `removeDependency()` — deletes edge by ID
  - `getDependencies()` — forward lookup (what does this task depend on?)
  - `getDependents()` — reverse lookup (what tasks depend on this?)
  - `detectCycle()` — DFS from dependsOnTaskId following forward edges to check reachability of taskId
- Added 3 new error classes in `errors.ts`:
  - `CyclicDependencyError` — includes the cycle path for diagnostics
  - `DuplicateDependencyError` — prevents duplicate edges
  - `SelfDependencyError` — prevents a task depending on itself
- Created 33 tests in `dependency.service.test.ts` covering:
  - Input validation (self-dep, missing tasks, duplicates)
  - Cycle detection: 2-node, 3-node, long chain, diamond, mixed types
  - Valid DAGs: linear chain, diamond, tree, disconnected, fan-out, fan-in
  - isHardBlock defaults per dependency type
  - Edge removal and re-addition
  - Complex graph scenarios with mixed accept/reject

**Key patterns:**

- Follows the same functional factory pattern as other application services
- Uses hexagonal architecture: service depends on ports, not concrete repos
- DFS cycle detection runs inside the same transaction as the insert (atomic)
- All dependency types (blocks, relates_to, parent_child) participate in cycle detection per PRD §2.3
- isHardBlock defaults: true for BLOCKS, false for RELATES_TO and PARENT_CHILD

**For next loops:**

- T036 (readiness computation) is now unblocked — can use DependencyService for dependency queries
- T037 (reverse-dependency recalculation) is now unblocked — getDependents() provides reverse lookups
- Infrastructure adapter for DependencyUnitOfWork will be needed when wiring into the control plane

## T027: Implement Scheduler Service (2026-03-11)

**What was done:**

- Created `packages/application/src/ports/scheduler.ports.ts` with `SchedulerTaskRepositoryPort` and `SchedulerPoolRepositoryPort` interfaces
- Created `packages/application/src/services/scheduler.service.ts` implementing the full `SchedulerService` with `scheduleNext()` method
- Created comprehensive test suite with 33 tests covering priority ordering, capability matching, concurrency limits, duplicate assignment prevention, and error propagation
- Exported all new types and functions from `packages/application/src/index.ts`

**Patterns used:**

- Factory function pattern (`createSchedulerService()`) consistent with existing services
- Service composition: Scheduler orchestrates `LeaseService` and `JobQueueService` rather than owning their transactions
- Pure helper functions exported for unit testing: `isPoolCompatible`, `hasPoolCapacity`, `selectBestPool`, `comparePriority`
- Discriminated union result type (`ScheduleResult = ScheduleSuccessResult | ScheduleNoAssignmentResult`) with skip reasons for observability

**Next loop should know:**

- T028 (scheduler tick loop) is now unblocked — it will need to call `scheduleNext()` on a periodic tick
- The scheduler ports (`SchedulerTaskRepositoryPort`, `SchedulerPoolRepositoryPort`) need infrastructure implementations in `packages/infrastructure/` when the repository adapters are built
- The `SchedulablePool.activeLeaseCount` field requires a COUNT query joining task_leases with active statuses — this is the most complex query the infra layer needs to implement
- Pool type assignment is hardcoded to DEVELOPER for now; future tasks may need REVIEWER/PLANNER pool matching

## T043: Define Worker Runtime Interface (2026-03-11)

**What was done:**

- Created `packages/infrastructure/src/worker-runtime/types.ts` with all runtime types: `RunContext`, `PreparedRun`, `FinalizeResult`, `RunOutputStream`, `RunLogEntry`, `CancelResult`, `CollectedArtifacts`, `WorkspacePaths`, `TimeoutSettings`, `OutputSchemaExpectation`, `RunStatus`
- Created `packages/infrastructure/src/worker-runtime/runtime.interface.ts` with the `WorkerRuntime` interface defining all 6 lifecycle methods: `prepareRun`, `startRun`, `streamRun`, `cancelRun`, `collectArtifacts`, `finalizeRun`
- Created `packages/infrastructure/src/worker-runtime/registry.ts` with `RuntimeRegistry` (singleton factory pattern), `RuntimeNotFoundError`, and `DuplicateRuntimeError`
- Created barrel exports via `worker-runtime/index.ts` and updated `packages/infrastructure/src/index.ts`
- Added `@factory/schemas` as workspace dependency and TypeScript project reference
- Created 22 tests across two test files covering interface satisfaction, full lifecycle, concurrent runs, registry CRUD, error handling

**Patterns used:**

- Lifecycle method signatures match PRD 010 §10.8.2: prepare → start → stream → cancel → collect → finalize
- `RunContext` imports `TaskPacket` and `PolicySnapshot` types from `@factory/schemas` for type-safe adapter contracts
- `streamRun` returns `AsyncIterable<RunOutputStream>` for live output streaming
- Registry uses factory pattern (`WorkerRuntimeFactory = () => WorkerRuntime`) for lazy, per-retrieval adapter instantiation
- All types use `readonly` fields for immutability
- Comprehensive JSDoc with PRD cross-references on every type and method

**Next loop should know:**

- T044 (Worker Supervisor) is now unblocked — it will orchestrate the `WorkerRuntime` lifecycle and manage heartbeat tracking
- T045 (Copilot CLI Adapter) is now unblocked — it must implement the `WorkerRuntime` interface with Copilot CLI process spawning
- The `RuntimeRegistry` is a singleton; bootstrap code should call `RuntimeRegistry.create()` and register adapters before dispatch
- `streamRun` uses `AsyncIterable` — adapters should implement it as an async generator function

---

## T039: Git Worktree Creation — Done

**What was implemented:**

- T039: Implemented git worktree creation per task
- Created `packages/infrastructure/src/workspace/` module with:
  - `WorkspaceManager` class for workspace provisioning
  - `GitOperations` interface + `createExecGitOperations()` production impl using `execFile`
  - `FileSystem` interface + `createNodeFileSystem()` production impl
  - Branch naming: `factory/{taskId}` and `factory/{taskId}/r{attempt}` for retries
  - Workspace reuse on retry when worktree is clean
  - Error types: `GitOperationError`, `WorkspaceBranchExistsError`, `WorkspaceDirtyError`
- 31 new tests (17 unit tests for WorkspaceManager with mocks, 14 integration tests with real git repos)

**Patterns used:**

- Constructor injection of `GitOperations` + `FileSystem` interfaces for testability

**Next loop should know:**

- T040 (workspace mounting), T041 (workspace cleanup), T044 (worker supervisor) are now unblocked

## T036: Implement readiness computation (2026-03-11)

### What was done

- Created `packages/application/src/ports/readiness.ports.ts` — port interfaces for readiness computation (ReadinessTaskRepositoryPort, ReadinessTaskDependencyRepositoryPort, ReadinessUnitOfWork)
- Created `packages/application/src/services/readiness.service.ts` — ReadinessService with `computeReadiness()` and `checkParentChildReadiness()`
- Created `packages/application/src/services/readiness.service.test.ts` — 57 tests covering all acceptance criteria
- Updated `packages/application/src/index.ts` — exported new service, types, and port interfaces

### Patterns used

- Hexagonal architecture: narrow port interfaces following the same pattern as dependency.ports.ts
- Pure query service: computeReadiness does NOT trigger transitions (caller's responsibility)
- ReadinessUnitOfWork for consistent reads within a transaction
- Discriminated union results (ReadinessResultReady | ReadinessResultBlocked)

### Key design decisions

- Only `blocks` edges with `isHardBlock=true` affect readiness; all other edge types are informational
- Only DONE satisfies a hard-block; FAILED, CANCELLED, ESCALATED do NOT
- parent_child semantics are separate: checkParentChildReadiness() handles DONE/CANCELLED child checks
- Service is a pure query — deterministic orchestration principle preserved

### What the next loop should know

- T036 unblocks T037 (reverse-dependency recalculation) which should wire up readiness recomputation on task status changes
- The ReadinessService ports (ReadinessTaskRepositoryPort, ReadinessTaskDependencyRepositoryPort) need infrastructure implementations in apps/control-plane — these can adapt the existing task.repository.ts and task-dependency.repository.ts
- The readiness service is intentionally decoupled from the transition service — the reconciliation loop or dependency module should call computeReadiness() and then call transitionService.transitionTask() with the appropriate TransitionContext

---

## T037 — Implement reverse-dependency recalculation

### Task

T037 - Implement reverse-dependency recalculation (Epic E007: Dependency & Readiness Engine)

### What was done

Created ReverseDependencyService in `packages/application` that automatically recalculates readiness for downstream tasks when a prerequisite completes. The service composes ReadinessService (query) and TransitionService (command). Only DONE triggers recalculation; FAILED/CANCELLED leave dependents BLOCKED. 35 tests covering: single/multiple dependents, multi-dependency chains, edge type filtering, error handling, idempotency, and complex graph topologies.

### Files created

- `packages/application/src/ports/reverse-dependency.ports.ts`
- `packages/application/src/services/reverse-dependency.service.ts`
- `packages/application/src/services/reverse-dependency.service.test.ts`

### Files modified

- `packages/application/src/index.ts` (exports)

### Patterns

- Service composition pattern (composes ReadinessService + TransitionService)
- Hexagonal ports for reverse-dependency repository queries
- Idempotent recalculation with graceful error handling for InvalidTransitionError and VersionConflictError

## 2026-03-11 — T048: Implement command policy model and enforcement

**Status:** Done

**What was done:**

- Created `packages/domain/src/policies/command-policy.ts` — full command policy type model and enforcement logic per PRD §9.3
  - `CommandPolicyMode` (allowlist/denylist), `CommandViolationAction`, `CommandViolationReason` const enums
  - `AllowedCommand`, `DeniedPattern`, `ForbiddenArgPattern`, `CommandPolicy` interfaces
  - `parseCommandString()` — splits raw command into base command + arg tokens
  - `evaluateCommandPolicy()` — evaluates a command against a policy with 5-step evaluation order: invalid → shell operators → denied patterns → allowlist/denylist → forbidden arg patterns
  - Glob-style pattern matching for denied patterns (`*` wildcards)
  - Regex matching for forbidden argument patterns
- Created `packages/config/src/defaults/command-policy.ts` — default V1 policy and merge utility
  - `DEFAULT_COMMAND_POLICY` — allowlist mode with curated development commands (pnpm, npm, npx, git, tsc, node, cat, ls, find, grep, head, tail, wc, mkdir, diff)
  - Default denied patterns: rm -rf /, curl|sh, wget|bash, sudo, ssh, scp, chmod 777, eval
  - Default forbidden arg patterns: deep path traversal (3+ levels), /etc/, /proc/, /sys/
  - `mergeCommandPolicies(base, override)` — last-writer-wins field merge for hierarchical config
- Added `@factory/domain` dependency to `@factory/config` package with TypeScript project reference
- 66 new tests (44 domain + 22 config), all passing. 1,963 total tests.

**Patterns established:**

- Policy types live in `packages/domain/src/policies/` (domain owns enforcement rules)
- Default policy values live in `packages/config/src/defaults/` (config owns concrete defaults)
- Policy interfaces use `readonly` throughout for immutability
- Evaluation functions return structured results with reason codes for audit logging
- `as const` + union type pattern for policy enums (consistent with existing domain enums)

**Next steps:**

- T049 (file scope policy), T050 (validation policy), T051 (retry/escalation policy) — same pattern in domain/config
- T052 (hierarchical config resolution) — the merge utility here is the foundation
- T053 (policy snapshot generation) — combines all resolved policies into snapshot

---

### T040: Implement workspace packet and config mounting — DONE

**What was done:**

- Extended `FileSystem` interface in `packages/infrastructure/src/workspace/types.ts` with `writeFile`, `readFile`, and `unlink` methods
- Updated `node-fs.ts` production implementation with the new methods (ENOENT-safe unlink)
- Created `WorkspacePacketMounter` class in `packages/infrastructure/src/workspace/workspace-packet-mounter.ts`:
  - `mountPackets(workspacePath, input)` — writes task-packet.json, run-config.json, and effective-policy-snapshot.json to workspace root
  - `unmountPackets(workspacePath)` — removes all three files (best-effort, idempotent)
  - Write-then-verify pattern: each file is read back and parsed as JSON after writing
  - Atomic cleanup guarantee: if any write/verification fails, all previously written files are removed
- Created `PacketMountError` error class with workspace path, failed filename, and cause
- Exported `MountPacketsInput`, `MountPacketsResult` types, all constants and classes from barrel exports
- Updated existing `createMockFs` in workspace-manager.test.ts to include new FileSystem methods
- 15 new tests covering: happy path, write order, verification, partial cleanup, cleanup resilience, unmount, error diagnostics
- 1,978 total tests passing

**Patterns established:**

- FileSystem interface is the central filesystem abstraction in infrastructure — extend it for new file operations
- Write-then-verify pattern for mounted files ensures workers never start with corrupt context
- Cleanup-on-failure uses `[...writtenPaths, currentFilePath]` to include both completed and in-progress files

**Next steps:**

- T044 (Worker Supervisor) is now unblocked — depends on T030 ✅, T039 ✅, T040 ✅, T043 ✅
- T041 (workspace cleanup for terminal states) and T042 (ReconcileWorkspacesCommand) can proceed

## T044: Implement Worker Supervisor — Done

**Date:** 2026-03-11
**What was done:**

- Created `packages/application/src/ports/worker-supervisor.ports.ts` with port interfaces for worker entity CRUD, workspace provisioning, packet mounting, runtime adapter, and heartbeat forwarding
- Created `packages/application/src/services/worker-supervisor.service.ts` with full implementation of `createWorkerSupervisorService` factory function
- Created `packages/application/src/services/worker-supervisor.service.test.ts` with 19 tests covering the full spawn lifecycle, cancellation, heartbeat forwarding, error handling, and domain events
- Added `WorkerStatusChangedEvent` to domain events in `packages/application/src/events/domain-events.ts`
- Exported all new types and services from `packages/application/src/index.ts`

**Patterns used:**

- Factory function pattern (consistent with LeaseService, HeartbeatService, etc.)
- Port-based decoupling — all infrastructure dependencies abstracted behind application-layer ports
- Unit of work for transactional Worker entity mutations
- Domain event emission after each status transition
- Injectable clock for deterministic testing
- Best-effort cleanup on failure (cancel → collect → finalize runtime before updating Worker to failed)

**Key design decisions:**

- Placed in application layer (not infrastructure) because it orchestrates domain operations and coordinates infrastructure adapters
- Worker entity status is tracked independently from lease status — they represent different lifecycle dimensions
- Runtime adapter types are re-declared in supervisor ports to avoid application→infrastructure dependency
- Terminal heartbeat is sent after stream ends to signal completion to the lease service

**What the next loop should know:**

- T044 unblocks T045 (Copilot CLI adapter), T046 (output capture/validation), and T106 (test harness)
- The `WorkerEntityStatus` type is defined in the supervisor ports, not in `@factory/domain` enums — a future task may want to move it there
- The supervisor does NOT own task or lease state transitions — those remain with TransitionService and LeaseService
- `RuntimeAdapterPort` mirrors `WorkerRuntime` from infrastructure — when implementing T045, the Copilot CLI adapter should satisfy both interfaces

## 2026-03-11 — T049: Implement file scope policy model and enforcement

**Status:** Done

**What was done:**

- Created `packages/domain/src/policies/file-scope-policy.ts` — core policy model and enforcement
  - `FileScopePolicy` interface matching §9.4.1 canonical shape (read_roots, write_roots, deny_roots, allow_read/write_outside_scope, on_violation)
  - `checkReadAccess(path, policy)` and `checkWriteAccess(path, policy)` — evaluate individual file access with full precedence chain
  - `validatePostRunDiff(modifiedFiles, policy)` — batch validate post-run git diff against write scope
  - `normalizePath()` — strip leading ./ and /, collapse repeated slashes
  - Precedence: deny_roots > write_roots > read_roots > outside (per §9.4.2)
  - Root matching uses directory-level prefix matching with trailing slash normalization to prevent false positives
  - Evaluation results include matchedRoot, matchedRootValue, normalizedPath for audit trail
- Created `packages/config/src/defaults/file-scope-policy.ts` — default V1 policy + merge
  - `DEFAULT_FILE_SCOPE_POLICY`: reads broadly allowed, writes to apps/ and packages/ only, deny .github/workflows/, secrets/, infra/production/, .git/
  - `mergeFileScopePolicies(base, override)` — last-writer-wins merge for hierarchical config resolution
- 45 domain tests + 22 config tests = 67 new tests, 2064 total tests passing
- Exported from `@factory/domain` and `@factory/config`

**Patterns:**

- Follows T048 (command policy) established patterns exactly: const objects for enum-like values, readonly interfaces, evaluation results with explanation
- FileScopePolicySchema already existed in `@factory/schemas/policy-snapshot.ts` — domain types are compatible
- Root matching normalizes both the path AND the root to ensure consistent prefix matching

**Next loop should know:**

- T049 unblocks T053 (effective policy snapshot generation), which also needs T050, T051, T052
- The `..` path traversal is NOT resolved by normalizePath — callers must resolve or reject before policy evaluation
- FileScopePolicy type in domain is separate from the Zod schema in schemas package — they are structurally compatible but not the same type

## 2026-03-11 — T050: Implement validation policy with profile selection

**Status:** Done

**What was done:**

- Created `packages/domain/src/policies/validation-policy.ts` with full implementation
- Implements §9.5 validation policy model and §9.5.3 profile selection algorithm
- Key types: `ValidationProfile`, `ValidationPolicy`, `ProfileSelectionContext`, `ProfileSelectionResult`
- 4-level precedence: task override > workflow template > task type > system default (dev/merge)
- `selectProfile()` resolves profile name through precedence chain, looks up in policy, throws `MissingValidationProfileError` on miss
- `ValidationStage` enum: DEVELOPMENT → `default-dev`, MERGE → `merge-gate`
- `ProfileSelectionSource` enum tracks which precedence layer supplied the profile name
- Default profiles match spec exactly: `default-dev` (required: test+lint, optional: build), `merge-gate` (required: test+build, optional: lint)
- Helper functions: `getAllChecks()`, `getMissingCommands()`, `createDefaultValidationPolicy()`, `getSystemDefaultProfileName()`
- 42 new tests covering all precedence paths, fallthrough, empty/undefined handling, missing profile errors, integration scenarios
- All exports added to `packages/domain/src/index.ts`
- Total tests: 2,106 (all passing)

**Patterns used:**

- Same `as const` + derived union type pattern as command-policy and file-scope-policy
- Readonly interfaces throughout
- Pure functions with no side effects
- JSDoc with @see references to PRD spec
- Co-located test file

**Next loop should know:**

- T050 now unblocks T053 (effective policy snapshot generation) and T054 (validation runner abstraction)
- T053 still needs T048, T049, T050, T051, T052 — so T051 and T052 must be done first
- T054 depends on T050 — now ready if other deps are met
- Empty string overrides are treated as absent in the selection algorithm (same as undefined)
- `MissingValidationProfileError` contains `profileName`, `source`, and `availableProfiles` for audit event emission

## T047: Implement policy-aware command wrapper — DONE (2026-03-11)

**Status:** Done

**What was done:**

- Created `packages/infrastructure/src/policy/command-wrapper.ts` — policy-aware command execution wrapper:
  - `executeCommand(rawCommand, policy, options)` — validates via domain `evaluateCommandPolicy()`, then executes via `child_process.execFile` with structured args (no shell)
  - `validateCommand(rawCommand, policy)` — validation-only path (no execution)
  - `createPolicyViolationArtifact(evaluation)` — creates structured artifacts for audit persistence
  - `PolicyViolationError` — thrown on denied commands, carries evaluation + artifact
  - `CommandExecutionError` — thrown on non-zero exit codes, carries stdout/stderr/exitCode
  - `setProcessRunner()` / `restoreDefaultProcessRunner()` — test seam for mocking process execution
- Created `packages/infrastructure/src/policy/index.ts` — module exports
- Updated `packages/infrastructure/src/index.ts` — added policy enforcement exports
- Added `@factory/domain` as dependency of `@factory/infrastructure` (for `evaluateCommandPolicy`)
- Added `../domain` to infrastructure's tsconfig references
- 39 comprehensive tests covering:
  - Allowlist enforcement (allowed commands, denied commands, arg prefix restrictions)
  - Denied pattern matching (sudo, rm -rf, etc.)
  - Shell operator blocking (&&, ||, |, ;, $(), backticks)
  - Forbidden argument patterns (path traversal, system directory access)
  - Policy violation artifact generation
  - Command execution with mock process runner
  - Execution options forwarding (cwd, env, timeout, maxOutput)
  - Non-zero exit code handling and killed process handling
  - Denylist mode, violation action modes (FAIL_RUN, DENY_COMMAND, AUDIT_ONLY)
  - Edge cases (whitespace, empty commands, complex arg lists)

**Patterns & notes for next loops:**

- Infrastructure delegates to domain for policy evaluation — follows the layered architecture
- `setProcessRunner()` enables test isolation without spawning real processes
- T047 unblocks T045 (Copilot CLI adapter) and T055 (validation command exec)
- `execFile` with `shell: false` prevents shell injection; arguments passed as arrays
