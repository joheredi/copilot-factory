/**
 * Audit event repository — data access for the audit_event table.
 *
 * This repository is **insert-only** by design: audit events are never
 * updated or deleted. It provides creation and query methods for the
 * append-only audit log that records all significant system events.
 *
 * @module
 * @see {@link file://docs/prd/002-data-model.md} §2.3 AuditEvent
 */

import { eq, and, gte, lte, desc, count } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import { auditEvents } from "../database/schema.js";

/** An audit event row as read from the database. */
export type AuditEvent = InferSelectModel<typeof auditEvents>;

/** Data required to insert a new audit event row. */
export type NewAuditEvent = InferInsertModel<typeof auditEvents>;

/**
 * Combinable filter criteria for audit event queries.
 * All fields are optional; when provided they are combined with AND semantics.
 */
export interface AuditEventQueryFilters {
  entityType?: string;
  entityId?: string;
  eventType?: string;
  actorType?: string;
  actorId?: string;
  startTime?: Date;
  endTime?: Date;
}

/**
 * Paginated query result including items and total count.
 */
export interface PaginatedAuditEvents {
  items: AuditEvent[];
  total: number;
}

/**
 * Build an array of SQL conditions from the given filter criteria.
 * Only non-undefined filters produce conditions.
 */
function buildFilterConditions(filters: AuditEventQueryFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.entityType !== undefined) {
    conditions.push(eq(auditEvents.entityType, filters.entityType));
  }
  if (filters.entityId !== undefined) {
    conditions.push(eq(auditEvents.entityId, filters.entityId));
  }
  if (filters.eventType !== undefined) {
    conditions.push(eq(auditEvents.eventType, filters.eventType));
  }
  if (filters.actorType !== undefined) {
    conditions.push(eq(auditEvents.actorType, filters.actorType));
  }
  if (filters.actorId !== undefined) {
    conditions.push(eq(auditEvents.actorId, filters.actorId));
  }
  if (filters.startTime !== undefined) {
    conditions.push(gte(auditEvents.createdAt, filters.startTime));
  }
  if (filters.endTime !== undefined) {
    conditions.push(lte(auditEvents.createdAt, filters.endTime));
  }
  return conditions;
}

/**
 * Create an audit event repository bound to the given Drizzle database
 * instance. This repository is insert-only — no update or delete methods
 * are provided.
 */
export function createAuditEventRepository(db: BetterSQLite3Database) {
  return {
    /** Find an audit event by its primary key. */
    findById(auditEventId: string): AuditEvent | undefined {
      return db.select().from(auditEvents).where(eq(auditEvents.auditEventId, auditEventId)).get();
    },

    /** Return all audit events, optionally with limit/offset pagination. */
    findAll(opts?: { limit?: number; offset?: number }): AuditEvent[] {
      let query = db.select().from(auditEvents).$dynamic();
      if (opts?.limit !== undefined) {
        query = query.limit(opts.limit);
      }
      if (opts?.offset !== undefined) {
        query = query.offset(opts.offset);
      }
      return query.all();
    },

    /**
     * Find all audit events for a given entity, identified by type and ID.
     * This is the primary query pattern: "what happened to this task?"
     */
    findByEntity(entityType: string, entityId: string): AuditEvent[] {
      return db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
        .all();
    },

    /**
     * Find all audit events within a time range (inclusive).
     * Useful for operational monitoring and historical audit review.
     *
     * @param from - Start of the time range (inclusive).
     * @param to - End of the time range (inclusive).
     */
    findByTimeRange(from: Date, to: Date): AuditEvent[] {
      return db
        .select()
        .from(auditEvents)
        .where(and(gte(auditEvents.createdAt, from), lte(auditEvents.createdAt, to)))
        .all();
    },

    /**
     * Insert a new audit event row. Returns the inserted row with defaults.
     * This is the only write operation — audit events are append-only.
     */
    create(data: NewAuditEvent): AuditEvent {
      return db.insert(auditEvents).values(data).returning().get();
    },

    /**
     * Query audit events for a specific entity with pagination,
     * ordered by created_at descending (most recent first).
     *
     * Uses the composite index on (entity_type, entity_id) for performance.
     *
     * @param entityType - The entity type to filter by.
     * @param entityId - The entity identifier to filter by.
     * @param limit - Maximum number of results per page.
     * @param offset - Number of results to skip (for pagination).
     */
    findByEntityPaginated(
      entityType: string,
      entityId: string,
      limit: number,
      offset: number,
    ): PaginatedAuditEvents {
      const whereClause = and(
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
      )!;

      const [countResult] = db
        .select({ value: count() })
        .from(auditEvents)
        .where(whereClause)
        .all();
      const total = countResult?.value ?? 0;

      const items = db
        .select()
        .from(auditEvents)
        .where(whereClause)
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit)
        .offset(offset)
        .all();

      return { items, total };
    },

    /**
     * Search audit events with combinable filters and pagination,
     * ordered by created_at descending (most recent first).
     *
     * All filter fields are optional and combined with AND semantics.
     * When no filters are provided, returns all events paginated.
     *
     * @param filters - Combinable filter criteria.
     * @param limit - Maximum number of results per page.
     * @param offset - Number of results to skip (for pagination).
     */
    searchFiltered(
      filters: AuditEventQueryFilters,
      limit: number,
      offset: number,
    ): PaginatedAuditEvents {
      const conditions = buildFilterConditions(filters);
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const countQuery = db.select({ value: count() }).from(auditEvents).$dynamic();
      if (whereClause) {
        countQuery.where(whereClause);
      }
      const [countResult] = countQuery.all();
      const total = countResult?.value ?? 0;

      let itemsQuery = db.select().from(auditEvents).$dynamic();
      if (whereClause) {
        itemsQuery = itemsQuery.where(whereClause);
      }
      const items = itemsQuery
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit)
        .offset(offset)
        .all();

      return { items, total };
    },
  };
}
