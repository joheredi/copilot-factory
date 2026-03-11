# Conflict Resolution Priority for Optimistic Concurrency

## Decision

Implement conflict resolution priority as a **domain-layer classification**
combined with an **application-layer retry wrapper**, rather than embedding
retry logic directly in the transition service.

## Context

PRD §10.2.3 specifies priority rules when multiple actors race to transition
the same task:

1. Operator actions (ESCALATED, CANCELLED) win over all automated transitions.
2. Lease expiry wins over worker result submissions arriving after expiry.
3. Worker results within `grace_period_seconds` after lease timeout are still accepted.

The basic optimistic concurrency mechanism (version check + increment) was
already implemented in T017/T018. T019 adds the priority resolution layer.

## Approaches Considered

### Approach A: Priority-aware retry in transition service (rejected)

Embed retry loops directly into `transitionTask()`. On VersionConflictError,
re-read the entity and retry if the actor has higher priority.

**Rejected because:**

- Violates single responsibility: the transition service's job is to execute
  a single atomic transition, not manage retries.
- Makes the transition service harder to test in isolation.
- Callers lose control over retry behavior.

### Approach B: Domain classification + application retry wrapper (chosen)

Separate concerns into two layers:

- **Domain** (`conflict-priority.ts`): Pure functions that classify actor
  priority and check grace periods. No side effects.
- **Application** (`optimistic-retry.service.ts`): Wraps the transition
  service with retry logic using domain priority functions.

**Chosen because:**

- Follows the layered architecture (domain rules → application orchestration).
- Priority classification is testable as pure functions.
- Callers can choose between raw `transitionTask` (single attempt) or
  `transitionTaskWithPriority` (retry-aware).
- The transition service remains simple and focused.

## Implementation

- `packages/domain/src/conflict-priority.ts` — ConflictPriority enum,
  getConflictPriority(), shouldRetryOnConflict(), isWithinGracePeriod()
- `packages/application/src/services/optimistic-retry.service.ts` —
  OptimisticRetryService with transitionTaskWithPriority()

## References

- PRD §10.2.3: docs/prd/010-integration-contracts.md
- Task: docs/backlog/tasks/T019-optimistic-concurrency.md
