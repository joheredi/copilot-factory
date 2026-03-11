/**
 * Domain event emitter port.
 *
 * After a state transition is committed to the database, the transition
 * service emits a domain event for async subscribers. This interface
 * decouples the transition service from any specific event transport
 * (in-process EventEmitter, message queue, etc.).
 *
 * IMPORTANT: Events are emitted AFTER the database transaction commits.
 * If the event emission fails, the state change is already persisted —
 * subscribers must be idempotent and tolerate missed events.
 *
 * @see docs/prd/007-technical-architecture.md §7.13 — State Transition Engine
 * @module @factory/application/ports/event-emitter.port
 */

import type { DomainEvent } from "../events/domain-events.js";

/**
 * Port for publishing domain events after successful state transitions.
 */
export interface DomainEventEmitter {
  /**
   * Emit a domain event to all registered subscribers.
   *
   * This method should not throw — if event delivery fails, it should
   * log the failure rather than propagating an exception back to the
   * transition caller (the state change is already committed).
   */
  emit(event: DomainEvent): void;
}
