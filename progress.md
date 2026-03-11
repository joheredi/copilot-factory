# Progress Log

## 2026-03-11 — T070: Implement artifact reference resolution and retrieval

**Status:** Done

**What was done:**

- Extended `FileSystem` interface with `readdir` method for directory listing
- Updated `createNodeFileSystem` production implementation with `readdir` (using `withFileTypes`)
- Added to `ArtifactStore`: `getArtifact()`, `getJSONArtifact()`, `listArtifacts()`, `listRunArtifacts()`
- Added `PathTraversalError` — blocks directory traversal attacks (paths escaping artifact root)
- Added `ArtifactEntry` type for directory listing results
- Added `ArtifactRetrievalPort` in `@factory/application` for hexagonal architecture compliance
- Graceful null returns for missing artifacts (no throwing for not-found cases)
- JSON deserialization preserves `schema_version` for version-aware consumers
- Recursive directory walking via `walkDirectory` private method
- 26 new tests covering retrieval, listing, traversal security, error handling
- All 2821 tests passing, build clean

**Patterns used:**

- Same FakeFileSystem pattern for tests, extended with `readdir` that introspects the in-memory file/dir maps
- Path traversal protection via `normalize()` + `resolve()` boundary check
- Graceful degradation: return null/empty array instead of throwing for missing resources

**Next loop should know:**

- `FakeFileSystem` in both `artifact-store.test.ts` and `copilot-cli-adapter.test.ts` now has `readdir`
- `ArtifactRetrievalPort` in application layer is ready for service implementations
- T084 (API artifacts/reviews) is unblocked by T070 completion

## 2026-03-11 — T082: Implement Task management endpoints

**Status:** Done

**What was done:**

- Created `apps/control-plane/src/tasks/tasks.controller.ts` — REST controller with CRUD + batch endpoints
- Created `apps/control-plane/src/tasks/tasks.service.ts` — service with filtering, OCC updates, detail enrichment
- Created DTOs: `create-task.dto.ts`, `update-task.dto.ts`, `task-filter-query.dto.ts` (Zod-validated)
- Updated `tasks.module.ts` to register controller and service
- Endpoints: POST /tasks, POST /tasks/batch, GET /tasks (with filters), GET /tasks/:id (detail), PUT /tasks/:id
- Filtering supports: status, repositoryId, priority, taskType with AND semantics
- Detail endpoint enriches task with current lease, review cycle, dependencies, and dependents
- Update requires `version` field for optimistic concurrency control (409 on conflict)
- New tasks always initialize in BACKLOG state
- 7 controller tests (mocked service) + 23 service tests (in-memory SQLite)
- All 2795 tests passing, build clean

**Patterns used:**

- Followed T081 (projects) patterns exactly: Zod DTOs with static schema, service with writeTransaction, controller with Swagger annotations
- OCC via VersionConflictError → ConflictException mapping
- Dynamic Drizzle queries with conditional WHERE for filtering

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

## T057: Validation Gate Checking for State Transitions — Done

**What was implemented:**

- Created `packages/application/src/ports/validation-gate.ports.ts`:
  - `ValidationResultQueryPort` interface for querying latest validation results
  - `LatestValidationResult` type with validationRunId, profileName, overallStatus, completedAt
- Created `packages/application/src/services/validation-gate.service.ts`:
  - `ValidationGateService` with `checkGate()` method returning discriminated union
  - `GATED_TRANSITIONS` constant mapping gated transitions to required profiles
  - `enforceValidationGate()` convenience function for exception-based control flow
  - Two gated transitions: IN_DEVELOPMENT→DEV_COMPLETE (default-dev), POST_MERGE_VALIDATION→DONE (merge-gate)
  - APPROVED→QUEUED_FOR_MERGE explicitly NOT gated per spec
- Added `ValidationGateError` to `packages/application/src/errors.ts`
- 20 new tests covering: gate configuration, non-gated transitions, both gated transitions (pass/fail/missing), task isolation, enforceValidationGate convenience function
- All types/functions exported from `@factory/application`

**Design decision:**

- Created a standalone ValidationGateService rather than modifying TransitionService directly
- TransitionService is synchronous/transactional; adding I/O queries would violate its design
- Domain state machine already has guards (requiredValidationsPassed, postMergeValidationPassed)
- Callers use ValidationGateService to check gates, then populate TransitionContext accordingly
- Follows existing composition pattern where services are independent and composed by callers

**Patterns:**

- Fake query port pattern for testing (map of "taskId:profileName" → result)
- Discriminated union result types (GateNotApplicableResult | GatePassedResult | GateFailedResult)
- Uses domain constants DEFAULT_DEV_PROFILE_NAME and MERGE_GATE_PROFILE_NAME from @factory/domain

## T058: Review Router with Deterministic Rules — Done

**What was implemented:**

- Created `packages/application/src/services/review-router.service.ts`:
  - Pure deterministic service (no ports/UnitOfWork needed) — receives all inputs, produces routing decision
  - Rule evaluation in §10.6.2 order: 1) repo-required, 2) path-based, 3) tag/domain, 4) risk-based
  - Path matching via `picomatch` (glob patterns against changed file paths)
  - Compound AND logic across condition fields, OR within each field
  - Deduplication: reviewers promoted from optional→required when later rules require them
  - General reviewer always required (V1 invariant from §9.9)
  - Full routing rationale with rule names and tier labels for auditability
- 45 new tests covering: condition evaluation, rule categorization, all 4 evaluation tiers, deduplication/promotion, complex multi-rule scenarios, rationale completeness
- Added `picomatch` dependency to `@factory/application`
- Exported all types and factory function from barrel `index.ts`

**Patterns:**

- Pure deterministic service pattern (no side effects, no DB) for configuration-driven logic
- Builder-style test data factories with `createInput()` / `createRule()` overrides
- Categorized rule evaluation maintaining spec-mandated ordering
- Set-based deduplication for reviewer types across tiers

## T060 — Implement lead reviewer dispatch with dependencies

### Task

T060 - Implement lead reviewer dispatch with dependencies (Epic E012: Review Pipeline)

### What was done

Created LeadReviewConsolidationService in `packages/application` that assembles the lead reviewer's complete context when the `lead_review_consolidation` job becomes claimable. T059 already creates the lead job with `dependsOnJobIds`, and T026 prevents claiming until all dependencies are terminal. T060 adds the context assembly: gathering all specialist ReviewPackets from the current cycle, fetching review history from prior cycles, transitioning the ReviewCycle to CONSOLIDATING, recording audit events, and emitting domain events. 25 tests covering: single/multiple specialist packets, failed specialist jobs, review history ordering, state machine validation (IN_PROGRESS and AWAITING_REQUIRED_REVIEWS sources), terminal state rejection, job completion verification, concurrent modification detection, audit recording, and event emission.

### Files created

- `packages/application/src/ports/lead-review-consolidation.ports.ts`
- `packages/application/src/services/lead-review-consolidation.service.ts`
- `packages/application/src/services/lead-review-consolidation.service.test.ts`

### Files modified

- `packages/application/src/index.ts` — added exports for new service and port types

### Patterns used

- Service factory pattern with dependency injection (matching reviewer-dispatch.service.ts)
- Narrow port interfaces per service (hexagonal architecture)
- Unit of work for atomic transactions
- Post-commit domain event emission
- Defense-in-depth specialist job terminal check (even though T026 handles this at claim time)
- Review history assembly with chronological ordering for multi-rework scenarios

## T073 — Implement audit event recording on state transitions

### Task

T073 - Implement audit event recording on state transitions (Epic E015: Audit & Event System)

### What was done

Verified that T073 was already fully implemented by T018 (atomic transition + audit persistence). The TransitionService in `packages/application/src/services/transition.service.ts` already creates an AuditEvent record atomically within the same BEGIN IMMEDIATE transaction for every state transition across all 4 entity types (Task, TaskLease, ReviewCycle, MergeQueueItem). All acceptance criteria are met:

- Every state transition creates an audit event (structural guarantee — no conditional logic)
- Audit events capture entity_type, entity_id, event_type, actor_type, actor_id, old_state, new_state, metadata
- Atomicity enforced via BEGIN IMMEDIATE transactions (audit + state change in same tx)
- Tests verify: rollback on audit failure, no partial state, correct fields for all entity types

### Notes for next loop

- T074 (Audit query service) is now unblocked
- T100 (UI audit explorer) is also unblocked
- Actor types are string-based (`ActorInfo.type: string`). If stronger typing is needed, consider adding an `ActorType` union type in the domain layer.

## T081 — Implement Project and Repository CRUD endpoints

### Task

T081 - Implement Project and Repository CRUD endpoints (Epic E017: REST API Layer)

### What was done

Implemented full CRUD endpoints for Projects and Repositories in the NestJS control-plane app:

- **DatabaseModule**: Global NestJS module providing `DatabaseConnection` via `DATABASE_CONNECTION` injection token
- **ProjectsController**: POST/GET/PUT/DELETE `/projects` with pagination, 201/204/404/409 status codes
- **RepositoriesController**: POST/GET nested under `/projects/:projectId/repositories`, plus GET/PUT/DELETE at `/repositories/:id`
- **ProjectsService & RepositoriesService**: Use existing repository factory functions with write transactions
- **DTOs**: 5 Zod-validated DTOs (CreateProject, UpdateProject, CreateRepository, UpdateRepository, PaginationQuery)
- **Tests**: 4 test files — controller tests (mocked services via NestJS testing module), service integration tests (in-memory SQLite with migrations)

### Key fixes from code review

- SQL-level LIMIT/OFFSET for repository pagination (instead of in-memory slicing)
- FOREIGN KEY constraint error handling in RepositoriesService.create (throws BadRequestException)
- Additional pagination edge case tests (page 2, out-of-range page)

### Files created

- `apps/control-plane/src/infrastructure/database/database.module.ts`
- `apps/control-plane/src/projects/dtos/` (5 DTOs + barrel index)
- `apps/control-plane/src/projects/projects.service.ts`
- `apps/control-plane/src/projects/repositories.service.ts`
- `apps/control-plane/src/projects/projects.controller.ts`
- `apps/control-plane/src/projects/repositories.controller.ts`
- `apps/control-plane/src/projects/projects.service.test.ts`
- `apps/control-plane/src/projects/repositories.service.test.ts`
- `apps/control-plane/src/projects/projects.controller.test.ts`
- `apps/control-plane/src/projects/repositories.controller.test.ts`

### Files modified

- `apps/control-plane/src/projects/projects.module.ts` (wired controllers + services)
- `apps/control-plane/src/app.module.ts` (imported DatabaseModule)

### Patterns

- Global NestJS module with custom provider for database connection injection
- Zod DTOs with static `schema` property for automatic validation via global pipe
- Service layer delegates to repository factory functions; writes wrapped in `writeTransaction`
- `PaginatedResponse<T>` with `{ data, meta: { page, limit, total, totalPages } }` shape
- SQLite UNIQUE/FK constraint errors mapped to appropriate HTTP exceptions

### Notes for next loop

- T089 (React SPA init) is now unblocked by T081
- The DatabaseModule is Global so all future feature modules get DB access automatically
- PaginationQueryDto and PaginatedResponse can be reused by T082-T085

## T066: Implement merge conflict classification (done)

**Date:** 2026-03-11

Implemented the conflict classifier service that determines whether merge conflicts are reworkable or non-reworkable per PRD §10.10.2.

### What was done

- Created `packages/application/src/services/conflict-classifier.service.ts`
- Created `packages/application/src/services/conflict-classifier.service.test.ts` (32 tests)
- Exported new types and functions from `packages/application/src/index.ts`

### Key design decisions

- Implemented as an application service with a factory function (`createConflictClassifierService`) that takes a `MergeConflictPolicy` config object
- Uses `picomatch` for protected path glob matching (consistent with review-router pattern)
- Directory prefix patterns (ending with `/`) are normalized to `<prefix>**` for picomatch compatibility
- Provides both `ConflictClassifierPort` implementation and a detailed classifier that returns reasons
- File count threshold is checked BEFORE protected paths (short-circuit on cheaper check)

### Patterns used

- Factory function + dependency injection (consistent with all other application services)
- Port implementation pattern (implements existing `ConflictClassifierPort` from merge-executor.ports.ts)
- `picomatch` with `{ dot: true }` for glob matching (consistent with review-router.service.ts)

### What the next loop should know

- T067 (post-merge validation and failure policy) is now unblocked
- The `ConflictClassifierPort` was already consumed by `merge-executor.service.ts` — this task provides the production implementation
- The JSDoc in merge-executor.service.ts references `createPolicyConflictClassifier(policySnapshot)` — the actual function is `createConflictClassifierService(policy)` which is close but the merge executor JSDoc may need updating in a future task
- `MergeConflictPolicy` is not yet part of the hierarchical `FactoryConfig` — merge policy lives as opaque JSON in the DB schema. A future task should formalize the merge policy type in packages/config
