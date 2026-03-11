# Progress Log

## T056: Implement ValidationResultPacket emission (2026-03-11)

**What was done:**

- Created `packages/application/src/ports/validation-packet-emitter.ports.ts` — port for artifact persistence (`ValidationPacketArtifactPort`) and emission params/result types.
- Created `packages/application/src/services/validation-packet-emitter.service.ts` — service that assembles a `ValidationResultPacket` from a `ValidationRunResult`, validates it against the Zod schema, and persists it via the artifact store port.
- Created `packages/application/src/services/validation-packet-emitter.service.test.ts` — 34 tests covering: packet assembly, run_scope mapping (all 5 values), check outcome mapping (check_type resolution, tool_name extraction, status mapping including error→failed), overall status mapping (passed→success, failed→failed), schema validation, artifact persistence, mixed check statuses, post-merge runs, and error propagation.
- Updated `packages/application/src/index.ts` — added exports for the new port types and service.

**Key patterns:**

- Separate emitter service (not extending the runner) follows single-responsibility principle matching existing patterns (e.g., PolicySnapshotService).
- Check name → check_type mapping: known names (test, lint, build, typecheck, security, schema, policy) map directly; unknown names default to "policy".
- Tool name extracted as first whitespace-delimited token of the command string.
- Runner status "error" collapsed to schema status "failed" since the packet schema only supports passed/failed/skipped.
- Runner overall status "passed" maps to packet status "success" per PRD 008 §8.2.3.
- Zod validation runs BEFORE persistence; only the Zod-parsed packet is persisted.
- `mapCheckOutcomeToResult` is exported for direct unit testing of the mapping logic.

**Next loop should know:**

- T057 (validation gate checking for state transitions) is now unblocked by T056.
- The emitter produces a `ValidationResultPacket` that T057 can inspect for gating decisions.

## T055: Implement test/lint/build command execution (2026-03-11)

**What was done:**

- Created `packages/infrastructure/src/validation/check-executor.ts` — concrete `CheckExecutorPort` implementation that executes validation commands (test, lint, build) via the policy-aware command wrapper from T047.
- Created `packages/infrastructure/src/validation/check-executor.test.ts` — 21 tests covering: passed (exit 0), failed (non-zero exit), killed by signal/timeout, policy violations, workspace path forwarding, config forwarding (timeout, maxOutputBytes, maxOutputChars), output truncation, unexpected errors, and combined stdout/stderr output.
- Created `packages/infrastructure/src/validation/index.ts` — barrel export.
- Updated `packages/infrastructure/src/index.ts` — added validation module exports.

**Key patterns:**

- Infrastructure must NOT depend on `@factory/application` (layered architecture). The `CheckExecutorPort` interface is defined structurally in infrastructure; TypeScript's structural typing ensures compatibility.
- Status mapping: exit 0 → "passed", non-zero exit → "failed", policy violation → "error", unexpected exception → "error". The "failed" vs "error" distinction matters for the validation runner's aggregation logic.
- Uses `setProcessRunner` / `restoreDefaultProcessRunner` from command-wrapper for test isolation (no real process spawning).

**Next loop should know:**

- T056 (ValidationResultPacket emission) is now unblocked and depends on this executor.
- The `createCheckExecutor()` factory requires a `CommandPolicy` and returns a `CheckExecutorPort`. The validation runner service (T054) consumes it.

## T053: Implement effective policy snapshot generation (2026-03-11)

**What was done:**

- Created `packages/application/src/ports/policy-snapshot.ports.ts` — defines `ConfigLayerLoaderPort` for loading ordered config layers, `PolicySnapshotArtifactPort` for persisting snapshots, and `PolicySnapshotContext` for identifying the task/pool/run.
- Created `packages/application/src/services/policy-snapshot.service.ts` — the `PolicySnapshotService` that loads config layers, resolves them via `@factory/config`'s hierarchical resolver, assembles a `PolicySnapshot` mapping domain types to schema types, validates against the Zod schema, and persists as an immutable run-level artifact.
- Created 26 tests covering: system-defaults-only generation, custom layer overrides, source tracking metadata, artifact persistence, error handling (loader failures, persistence failures), snapshot structure validation, deterministic output, and error class behavior.
- Added `@factory/config` as a dependency of `@factory/application` (package.json + tsconfig project reference).
- Updated `packages/application/src/index.ts` with all new exports.

**Key patterns:**

- The service bridges domain types (e.g., `AllowedCommand` with `arg_prefixes`) to schema types (e.g., `allowed_args_prefixes`) in the `assembleSnapshot` function.
- `derivePolicySetId` walks layers from highest to lowest precedence to find the most specific source identifier.
- Typed errors `PolicySnapshotValidationError` and `ConfigLayerLoadError` provide structured diagnostics.

**Next loop should know:**

- The `@factory/application` package now depends on `@factory/config` for the hierarchical resolver.
- The `assembleSnapshot` function handles the domain↔schema type mapping for command policy fields. If new fields are added to the domain or schema types, this function must be updated.

## T054: Implement validation runner abstraction (2026-03-11)

**What was done:**

- Created `packages/application/src/ports/validation-runner.ports.ts` — defines `CheckExecutorPort` for executing individual checks, `ValidationCheckOutcome` for per-check results, and `ValidationRunResult` for aggregated results.
- Created `packages/application/src/services/validation-runner.service.ts` — the `ValidationRunnerService` that loads profiles from `ValidationPolicy`, executes required checks then optional checks sequentially via the port, and aggregates results per PRD §9.5 rules.
- Created 27 tests covering: profile loading errors, execution order, required/optional failure semantics, skipped check handling (`fail_on_skipped_required_check`), result aggregation, multi-profile support, and edge cases.
- Updated `packages/application/src/index.ts` with all new exports.

**Patterns used:**

- Factory function pattern (`createValidationRunnerService(checkExecutor)`) consistent with all other application services.
- Port-based DI: `CheckExecutorPort` will be implemented in T055 with real command execution.
- No transactions needed (read-only orchestration with no DB writes).
- Fake executor in tests (pattern similar to `FakeCliProcess` in infrastructure).

**Next loop should know:**

- T055 (validation command execution) should implement `CheckExecutorPort` to run shell commands.
- T056 (validation packet emission) should use `ValidationRunResult` to build `ValidationResultPacket`.
- T057 (validation gates) should use the runner to check whether transitions are allowed.
- The runner is async (`Promise<ValidationRunResult>`) to support future parallel check execution.

## T046: Implement structured output capture and validation (2026-03-11)

**What was done:**

- Created `packages/application/src/ports/output-validator.ports.ts` with port interfaces: `ArtifactExistencePort`, `SchemaFailureTrackerPort`, `OutputValidationAuditPort`, and full result/context types
- Created `packages/application/src/services/output-validator.service.ts` with the full validation pipeline:
  - `extractPacket()` — file-based extraction (priority) with stdout delimiter fallback
  - `validateSchema()` — Zod-based validation using a packet schema registry
  - `attemptSchemaRepair()` — conservative repair for missing arrays→[] and nullables→null
  - `verifyIds()` — checks task_id, repository_id, and stage-specific IDs match orchestrator context
  - `verifyArtifacts()` — checks artifact_refs resolve to existing files via port
  - `createOutputValidatorService()` — factory with consecutive failure tracking per agent profile (threshold=3 disables profile) and schema_violation audit event recording
- Created 54 comprehensive tests covering all acceptance criteria
- Added `@factory/schemas` and `zod` as dependencies to `@factory/application`
- Updated tsconfig references to include `@factory/schemas`

**Patterns used:**

- Hexagonal architecture: ports for artifact checking, failure tracking, audit recording
- Pure functions for extraction, schema validation, ID verification (testable without infrastructure)
- Service factory pattern matching existing services (e.g., `createGracefulCompletionService`)
- Fake ports in tests (same pattern as `FakeCliProcess`, `FakeFileSystem` in infrastructure)

**What the next loop should know:**

- The output validator is a pure application-layer service — it does NOT do state transitions. The caller (e.g., worker completion flow) is responsible for using the result to drive transitions.
- Schema repair is intentionally conservative: only repairs missing arrays (→[]) and nullable fields (→null). It does NOT default required strings or numbers.
- The `PACKET_STAGE_ID_FIELDS` map in the service specifies which stage-specific IDs to verify per packet type.
- T045 (Copilot CLI adapter) was already done but the backlog index was stale — corrected in this commit.

## T080: Implement NestJS application bootstrap and module structure (2026-03-11)

**What was done:**

- Bootstrapped NestJS application in `apps/control-plane` with Fastify adapter
- Created `src/main.ts` with CORS (localhost origins), OpenAPI/Swagger at `/api/docs`, global exception filter, and Zod validation pipe
- Created `src/app.module.ts` root module importing 9 feature modules matching domain boundaries
- Created `src/health/` with `HealthController` (GET /health → 200 with status, service name, timestamp)
- Created `src/common/filters/global-exception.filter.ts` — structured JSON error responses for all exception types (HttpException → proper status, unknown → safe 500)
- Created `src/common/pipes/zod-validation.pipe.ts` — validates request data against Zod schemas attached as static `schema` property on DTO classes
- Created 8 feature module shells: Projects, Tasks, Workers, Review, Merge, Validation, Audit, Policy
- Added 16 new tests (health controller, exception filter, validation pipe, app module wiring)
- Added `dev` (tsx) and `start` (node) scripts to package.json

**Key decisions:**

- Used Fastify adapter (not Express) per PRD §7.1 recommendation
- Used Zod for validation (not class-validator) since codebase already uses Zod in @factory/schemas
- Overrode `verbatimModuleSyntax: false` and added `experimentalDecorators`/`emitDecoratorMetadata` in control-plane tsconfig only (NestJS decorators require these; doesn't affect other packages)
- Feature modules are empty shells — endpoint implementation is in T081–T085

**Dependencies added:** @nestjs/core, @nestjs/common, @nestjs/platform-fastify, @nestjs/swagger, reflect-metadata, fastify, @fastify/static, zod, @nestjs/testing

**What next loop should know:**

- The NestJS app coexists with existing infrastructure code (database, repositories, unit-of-work)
- Feature modules need controllers and services wired to existing repository adapters (via NestJS providers)
- The Zod validation pipe expects DTOs with a static `schema: ZodSchema` property
- CORS is configured for `localhost:*` origins (for web-ui dev server)

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

## T045: Implement Copilot CLI execution adapter — DONE (2026-03-11)

**Status:** Done

**What was done:**

- Implemented `CopilotCliAdapter` in `packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts`
- 47 tests added covering all lifecycle phases, prompt generation, schema validation
- Role-specific prompts for all 6 agent roles (developer, reviewer, lead-reviewer, planner, merge-assist, post-merge-analysis)
- File-based structured output with stdout delimiter fallback
- Dynamic Zod schema validation against PACKET_SCHEMA_REGISTRY
- Injected dependencies (FileSystem, CliProcessSpawner) for testability
- Added `zod` as a dependency of `@factory/infrastructure` (needed for schema validation in the CLI adapter)
- Updated `packages/infrastructure/src/index.ts` — worker-runtime module now exports `CopilotCliAdapter` and related types

**Patterns & notes for next loops:**

- Uses injectable process spawner abstraction (`CliProcessSpawner`) for testability without real OS processes
- Test fakes: `FakeCliProcess` and `FakeFileSystem` for testing adapters without real I/O
- The adapter does NOT validate the CLI command itself against policy — the command wrapper is for commands the worker executes, not for the adapter spawning the CLI
- The schema types for `PolicySnapshot.command_policy` (from `@factory/schemas`) differ from `CommandPolicy` (from `@factory/domain`) — a conversion layer may be needed in future tasks

**Next loop should know:**

- T045 unblocks T107 (end-to-end full lifecycle test)
- The adapter depends on T043 (worker runtime interface) and T047 (command wrapper) — both done
- `zod` is now available in `@factory/infrastructure` for any future schema validation needs
- The `CliProcessSpawner` / `FakeCliProcess` pattern can be reused for other CLI-based adapters

## T052: Implement hierarchical configuration resolution (2026-03-11)

**What was done:**

- Created `packages/config/src/types.ts` with core types: `ConfigLayer` (8-value enum), `ConfigContext`, `ConfigLayerEntry`, `PartialFactoryConfig`, `ResolvedPolicy<T>`, `ResolvedConfig` with field-level source tracking
- Created default policy modules with override types and merge functions for all 6 previously-missing policies:
  - `defaults/lease-policy.ts` — 30min TTL, 30s heartbeat, 2 missed threshold
  - `defaults/retention-policy.ts` — 24h workspace, 30d artifact retention
  - `defaults/review-policy.ts` — 3 rounds, general required, security/perf optional
  - `defaults/validation-policy.ts` — default-dev and merge-gate profiles
  - `defaults/retry-policy.ts` — 2 retries, exponential backoff 60s→900s
  - `defaults/escalation-policy.ts` — 7 trigger types, operator-queue routing
- Created `defaults/system-defaults.ts` — complete FactoryConfig baseline from all 8 sub-policy defaults
- Created `resolver.ts` — `resolveConfig(layers, systemDefaults?)` with:
  - 8-layer precedence enforcement (system→operator_override)
  - Layer ordering validation (must be non-decreasing)
  - Field-level source tracking (every field records which layer supplied it)
  - Last-writer-wins merge semantics (arrays replaced wholesale)
  - `extractValues()` and `extractSources()` utility functions
- Created 28 tests covering: system defaults, single/multi-layer overrides, all 8 layers, skipped layers, array replacement, ordering enforcement, extractValues/extractSources, realistic scenarios
- Added `@factory/schemas` dependency to `@factory/config`

**Patterns used:**

- Pure function resolver with no DB dependency — layer loading is the caller's responsibility (follows layered architecture)
- Generic merge function registry keyed by PolicyName — avoids switch/case and scales with new policies
- Existing merge pattern: `override.field ?? base.field` (last-writer-wins per field, arrays wholesale)
- FieldSourceMap<T> type for compile-time-safe source tracking per policy field

**Notes for next iteration:**

- T052 unblocks T053 (effective policy snapshot generation) which needs `resolveConfig()` + DB layer loading
- The `PartialFactoryConfig` type is the contract for what each layer can contribute — application services loading from DB should produce this shape
- The `ConfigContext` type is defined but not yet consumed by the resolver (it's for the future application service that will select which layers to load from DB based on context)
