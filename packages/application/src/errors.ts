/**
 * Application-layer error types for the transition service.
 *
 * These errors represent domain-meaningful failures that occur during
 * state transitions. They are thrown by the transition service and its
 * port implementations to communicate specific failure modes to callers.
 *
 * @module @factory/application/errors
 */

/**
 * Thrown when an entity required for a transition cannot be found.
 *
 * This typically indicates a stale reference — the caller has an ID
 * for an entity that no longer exists (or never existed).
 */
export class EntityNotFoundError extends Error {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super(`${entityType} not found: ${entityId}`);
    this.name = "EntityNotFoundError";
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

/**
 * Thrown when a requested state transition violates the domain state machine.
 *
 * The transition was rejected by the domain-layer validation function.
 * The `reason` field contains the human-readable explanation from the
 * state machine guard that rejected the transition.
 */
export class InvalidTransitionError extends Error {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly fromStatus: string;
  public readonly toStatus: string;
  public readonly reason: string | undefined;

  constructor(
    entityType: string,
    entityId: string,
    fromStatus: string,
    toStatus: string,
    reason?: string,
  ) {
    const base = `Invalid transition for ${entityType} ${entityId}: ${fromStatus} → ${toStatus}`;
    super(reason ? `${base} — ${reason}` : base);
    this.name = "InvalidTransitionError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.reason = reason;
  }
}

/**
 * Thrown when an optimistic concurrency check fails during a state transition.
 *
 * This means another process modified the entity between when it was read
 * and when the transition service attempted to update it. The caller should
 * retry the operation with fresh data.
 */
export class VersionConflictError extends Error {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly expectedVersion: number | string;

  constructor(entityType: string, entityId: string, expectedVersion: number | string) {
    super(
      `Version conflict for ${entityType} ${entityId}: expected version ${String(expectedVersion)} is stale`,
    );
    this.name = "VersionConflictError";
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
  }
}
