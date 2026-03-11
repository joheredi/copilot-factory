/**
 * Port interfaces for audit event querying.
 *
 * Defines the read-side contract for audit event queries, separated from
 * the write-side {@link AuditEventRepositoryPort} (CQRS-lite). Query
 * operations do not require transaction boundaries and support flexible
 * filtering with offset-based pagination.
 *
 * @see docs/prd/002-data-model.md §2.3 — AuditEvent entity
 * @module @factory/application/ports/audit-query.ports
 */

import type { AuditEventRecord } from "./repository.ports.js";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Offset-based pagination parameters.
 * Matches the existing PaginationQueryDto convention (1-based pages, 1–100 limit).
 */
export interface AuditPaginationParams {
  /** Page number (1-based). */
  readonly page: number;
  /** Items per page (1–100). */
  readonly limit: number;
}

/**
 * Paginated result set with metadata for building pagination controls.
 */
export interface PaginatedAuditResult {
  /** The audit events for the requested page. */
  readonly items: readonly AuditEventRecord[];
  /** Total number of matching events across all pages. */
  readonly total: number;
  /** Current page number (mirrors the request). */
  readonly page: number;
  /** Items per page (mirrors the request). */
  readonly limit: number;
  /** Total number of pages (⌈total / limit⌉). */
  readonly totalPages: number;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Combinable filter criteria for audit event search.
 *
 * All fields are optional. When multiple fields are provided they are
 * combined with AND semantics — every condition must match. Omitted
 * fields are not filtered.
 */
export interface AuditEventFilters {
  /** Filter by entity type (e.g. "task", "lease", "review_cycle"). */
  readonly entityType?: string;
  /** Filter by entity identifier. */
  readonly entityId?: string;
  /** Filter by event classification (e.g. "state_transition", "created"). */
  readonly eventType?: string;
  /** Filter by actor type (e.g. "system", "worker", "operator"). */
  readonly actorType?: string;
  /** Filter by actor identifier (e.g. worker_id, user ID, component name). */
  readonly actorId?: string;
  /** Include events created at or after this timestamp (inclusive). */
  readonly startTime?: Date;
  /** Include events created at or before this timestamp (inclusive). */
  readonly endTime?: Date;
}

// ---------------------------------------------------------------------------
// Query port
// ---------------------------------------------------------------------------

/**
 * Read-only port for querying the audit event log.
 *
 * Infrastructure implementations translate these calls into efficient SQL
 * queries using the existing composite indexes on (entity_type, entity_id)
 * and (created_at).
 */
export interface AuditEventQueryPort {
  /**
   * Retrieve the full event timeline for a specific entity, ordered by
   * creation time descending (most recent first).
   *
   * This is the primary audit query pattern: "what happened to this task?"
   * Uses the composite index on (entity_type, entity_id) for performance.
   *
   * @param entityType - The type of entity (e.g. "task", "lease").
   * @param entityId - The entity's identifier.
   * @param pagination - Page and limit parameters.
   * @returns Paginated audit events with total count.
   */
  getEntityTimeline(
    entityType: string,
    entityId: string,
    pagination: AuditPaginationParams,
  ): PaginatedAuditResult;

  /**
   * Search audit events with flexible, combinable filters.
   *
   * All filter fields are optional and combined with AND semantics.
   * Results are ordered by creation time descending (most recent first).
   *
   * @param filters - Zero or more filter criteria to apply.
   * @param pagination - Page and limit parameters.
   * @returns Paginated audit events with total count.
   */
  searchAuditEvents(
    filters: AuditEventFilters,
    pagination: AuditPaginationParams,
  ): PaginatedAuditResult;
}
