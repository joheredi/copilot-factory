/**
 * Service layer for audit event queries with filtering and pagination.
 *
 * Bridges NestJS dependency injection with the functional audit event
 * repository from the infrastructure layer. Provides search and entity
 * timeline capabilities for the audit REST endpoints.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T085-api-audit-policy-config.md}
 */
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import {
  createAuditEventRepository,
  type AuditEvent,
  type AuditEventQueryFilters,
  type PaginatedAuditEvents,
} from "../infrastructure/repositories/audit-event.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Shape of a paginated audit event response. */
export interface PaginatedAuditResponse {
  /** Audit event items for the current page. */
  data: AuditEvent[];
  /** Pagination metadata. */
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Provides read-only access to the append-only audit event log.
 *
 * Supports flexible multi-criteria search with AND-combined filters
 * and entity-scoped timeline queries. Both return paginated results
 * ordered by time descending (most recent first).
 */
@Injectable()
export class AuditService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Search audit events with combinable filters and pagination.
   *
   * All filter fields are optional and combined with AND semantics.
   * When no filters are provided, returns all events paginated.
   *
   * @param page 1-based page number.
   * @param limit Items per page.
   * @param filters Optional filter criteria.
   * @returns Paginated audit event response.
   */
  search(
    page: number,
    limit: number,
    filters: AuditEventQueryFilters = {},
  ): PaginatedAuditResponse {
    const repo = createAuditEventRepository(this.conn.db);
    const offset = (page - 1) * limit;
    const result: PaginatedAuditEvents = repo.searchFiltered(filters, limit, offset);

    return {
      data: result.items,
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  /**
   * Get the audit timeline for a specific entity.
   *
   * Returns all audit events for the given entity type and ID,
   * ordered by time descending. This is the primary query pattern
   * for "what happened to this task/lease/review?"
   *
   * @param entityType Entity type (e.g. "task", "lease").
   * @param entityId Entity identifier.
   * @param page 1-based page number.
   * @param limit Items per page.
   * @returns Paginated audit event response for the entity.
   */
  getEntityTimeline(
    entityType: string,
    entityId: string,
    page: number,
    limit: number,
  ): PaginatedAuditResponse {
    const repo = createAuditEventRepository(this.conn.db);
    const offset = (page - 1) * limit;
    const result: PaginatedAuditEvents = repo.findByEntityPaginated(
      entityType,
      entityId,
      limit,
      offset,
    );

    return {
      data: result.items,
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }
}
