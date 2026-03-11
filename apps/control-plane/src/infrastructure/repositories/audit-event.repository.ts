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

import { eq, and, gte, lte } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { auditEvents } from "../database/schema.js";

/** An audit event row as read from the database. */
export type AuditEvent = InferSelectModel<typeof auditEvents>;

/** Data required to insert a new audit event row. */
export type NewAuditEvent = InferInsertModel<typeof auditEvents>;

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
  };
}
