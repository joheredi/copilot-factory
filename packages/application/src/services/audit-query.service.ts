/**
 * Audit event query service — read-side queries for the audit log.
 *
 * Provides two primary query patterns:
 *
 * 1. **Entity timeline** — retrieve all events for a specific entity,
 *    ordered by time. This is the most common query: "what happened to
 *    this task?" or "show the audit trail for this review cycle."
 *
 * 2. **Flexible search** — filter audit events by any combination of
 *    entity type/ID, event type, actor type/ID, and time range. Supports
 *    operational monitoring ("what did workers do in the last hour?") and
 *    forensic investigation ("which operator overrides occurred today?").
 *
 * This service is intentionally thin — it validates inputs, delegates to
 * the query port, and returns paginated results. All heavy lifting
 * (SQL construction, index usage) happens in the infrastructure adapter.
 *
 * @see docs/prd/002-data-model.md §2.3 — AuditEvent entity
 * @module @factory/application/services/audit-query.service
 */

import type {
  AuditPaginationParams,
  AuditEventFilters,
  AuditEventQueryPort,
  PaginatedAuditResult,
} from "../ports/audit-query.ports.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default page number when not specified. */
const DEFAULT_PAGE = 1;

/** Default items per page when not specified. */
const DEFAULT_LIMIT = 20;

/** Maximum items per page to prevent excessive result sets. */
const MAX_LIMIT = 100;

/** Minimum page number. */
const MIN_PAGE = 1;

/** Minimum items per page. */
const MIN_LIMIT = 1;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Service for querying the audit event log.
 *
 * Supports entity-scoped timelines and flexible multi-criteria search
 * with offset-based pagination.
 */
export interface AuditQueryService {
  /**
   * Retrieve the event timeline for a specific entity.
   *
   * Returns all audit events for the given entity type and ID, ordered
   * by creation time descending (most recent first). Supports pagination
   * for entities with many events.
   *
   * @param entityType - The type of entity (e.g. "task", "lease").
   * @param entityId - The entity's identifier.
   * @param pagination - Optional page and limit parameters.
   * @returns Paginated audit events with total count.
   * @throws {Error} If entityType or entityId is empty.
   */
  getEntityTimeline(
    entityType: string,
    entityId: string,
    pagination?: Partial<AuditPaginationParams>,
  ): PaginatedAuditResult;

  /**
   * Search audit events with flexible, combinable filters.
   *
   * All filter fields are optional and combined with AND semantics.
   * When no filters are provided, returns all events (paginated).
   *
   * @param filters - Zero or more filter criteria.
   * @param pagination - Optional page and limit parameters.
   * @returns Paginated audit events with total count.
   * @throws {Error} If startTime is after endTime.
   */
  searchAuditEvents(
    filters: AuditEventFilters,
    pagination?: Partial<AuditPaginationParams>,
  ): PaginatedAuditResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies for the audit query service.
 */
export interface AuditQueryDependencies {
  /** Read-only port for audit event queries. */
  readonly queryPort: AuditEventQueryPort;
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

/**
 * Normalize and clamp pagination parameters to valid ranges.
 *
 * @param partial - Optional partial pagination params from caller.
 * @returns Normalized pagination with valid page and limit values.
 */
function normalizePagination(partial?: Partial<AuditPaginationParams>): AuditPaginationParams {
  const page = Math.max(MIN_PAGE, Math.floor(partial?.page ?? DEFAULT_PAGE));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(MIN_LIMIT, Math.floor(partial?.limit ?? DEFAULT_LIMIT)),
  );
  return { page, limit };
}

/**
 * Validate that a required string parameter is non-empty.
 *
 * @param value - The string to validate.
 * @param name - Parameter name for the error message.
 * @throws {Error} If the value is empty or whitespace-only.
 */
function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

/**
 * Validate that startTime is not after endTime when both are provided.
 *
 * @param filters - The filter criteria to validate.
 * @throws {Error} If startTime > endTime.
 */
function validateTimeRange(filters: AuditEventFilters): void {
  if (filters.startTime && filters.endTime && filters.startTime > filters.endTime) {
    throw new Error(
      `startTime (${filters.startTime.toISOString()}) must not be after endTime (${filters.endTime.toISOString()})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an audit query service backed by the given query port.
 *
 * @param deps - Dependencies including the audit event query port.
 * @returns A fully functional audit query service.
 */
export function createAuditQueryService(deps: AuditQueryDependencies): AuditQueryService {
  const { queryPort } = deps;

  return {
    getEntityTimeline(
      entityType: string,
      entityId: string,
      pagination?: Partial<AuditPaginationParams>,
    ): PaginatedAuditResult {
      requireNonEmpty(entityType, "entityType");
      requireNonEmpty(entityId, "entityId");

      const normalized = normalizePagination(pagination);
      return queryPort.getEntityTimeline(entityType, entityId, normalized);
    },

    searchAuditEvents(
      filters: AuditEventFilters,
      pagination?: Partial<AuditPaginationParams>,
    ): PaginatedAuditResult {
      validateTimeRange(filters);

      const normalized = normalizePagination(pagination);
      return queryPort.searchAuditEvents(filters, normalized);
    },
  };
}
