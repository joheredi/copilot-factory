/**
 * Tests for the audit service.
 *
 * Verifies audit event search and entity timeline queries using an
 * in-memory SQLite database with Drizzle migrations applied. Tests
 * validate correct filtering, pagination, and ordering behavior.
 *
 * @module @factory/control-plane
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { AuditService } from "./audit.service.js";
import { createAuditEventRepository } from "../infrastructure/repositories/audit-event.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/** Create an in-memory test database with all migrations applied. */
function createTestConnection(): DatabaseConnection {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    healthCheck: () => ({ ok: true, walMode: true, foreignKeys: true }),
    writeTransaction: <T>(fn: (d: typeof db) => T): T => {
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}

/** Insert a test audit event with sensible defaults. */
function seedAuditEvent(db: ReturnType<typeof drizzle>, overrides: Record<string, unknown> = {}) {
  const repo = createAuditEventRepository(db);
  return repo.create({
    auditEventId: randomUUID(),
    entityType: "task",
    entityId: "task-1",
    eventType: "state_transition",
    actorType: "system",
    actorId: "scheduler",
    ...overrides,
  });
}

describe("AuditService", () => {
  let conn: DatabaseConnection;
  let service: AuditService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new AuditService(conn);
  });

  /**
   * Validates that search returns an empty paginated result when there
   * are no audit events. This is the baseline case — the system starts
   * with no events.
   */
  it("should return empty results when no events exist", () => {
    const result = service.search(1, 20);

    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  /**
   * Validates that search returns all events when no filters are applied.
   * This is the "show everything" query for operators.
   */
  it("should return all events without filters", () => {
    seedAuditEvent(conn.db, { entityId: "task-1" });
    seedAuditEvent(conn.db, { entityId: "task-2" });
    seedAuditEvent(conn.db, { entityId: "task-3" });

    const result = service.search(1, 20);

    expect(result.data).toHaveLength(3);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(1);
  });

  /**
   * Validates that search correctly filters by entityType.
   * Ensures unrelated entity types are excluded from results.
   */
  it("should filter by entityType", () => {
    seedAuditEvent(conn.db, { entityType: "task", entityId: "t1" });
    seedAuditEvent(conn.db, { entityType: "lease", entityId: "l1" });
    seedAuditEvent(conn.db, { entityType: "task", entityId: "t2" });

    const result = service.search(1, 20, { entityType: "task" });

    expect(result.data).toHaveLength(2);
    expect(result.data.every((e) => e.entityType === "task")).toBe(true);
  });

  /**
   * Validates that search correctly filters by entityId.
   * This is the "what happened to this specific entity" query.
   */
  it("should filter by entityId", () => {
    seedAuditEvent(conn.db, { entityId: "task-1" });
    seedAuditEvent(conn.db, { entityId: "task-2" });

    const result = service.search(1, 20, { entityId: "task-1" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.entityId).toBe("task-1");
  });

  /**
   * Validates that search correctly filters by eventType.
   * Useful for "show all state transitions" type queries.
   */
  it("should filter by eventType", () => {
    seedAuditEvent(conn.db, { eventType: "state_transition" });
    seedAuditEvent(conn.db, { eventType: "created" });
    seedAuditEvent(conn.db, { eventType: "state_transition" });

    const result = service.search(1, 20, { eventType: "state_transition" });

    expect(result.data).toHaveLength(2);
  });

  /**
   * Validates that search correctly filters by actorType.
   * Useful for "show all operator actions" type queries.
   */
  it("should filter by actorType", () => {
    seedAuditEvent(conn.db, { actorType: "system" });
    seedAuditEvent(conn.db, { actorType: "operator" });

    const result = service.search(1, 20, { actorType: "operator" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.actorType).toBe("operator");
  });

  /**
   * Validates that multiple filters combine with AND semantics.
   * Only events matching ALL criteria should be returned.
   */
  it("should combine multiple filters with AND semantics", () => {
    seedAuditEvent(conn.db, { entityType: "task", eventType: "state_transition" });
    seedAuditEvent(conn.db, { entityType: "task", eventType: "created" });
    seedAuditEvent(conn.db, { entityType: "lease", eventType: "state_transition" });

    const result = service.search(1, 20, {
      entityType: "task",
      eventType: "state_transition",
    });

    expect(result.data).toHaveLength(1);
  });

  /**
   * Validates that pagination correctly limits and offsets results.
   * Ensures page metadata is calculated correctly.
   */
  it("should paginate results correctly", () => {
    for (let i = 0; i < 5; i++) {
      seedAuditEvent(conn.db, { entityId: `task-${i}` });
    }

    const page1 = service.search(1, 2);
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(5);
    expect(page1.meta.totalPages).toBe(3);
    expect(page1.meta.page).toBe(1);

    const page2 = service.search(2, 2);
    expect(page2.data).toHaveLength(2);
    expect(page2.meta.page).toBe(2);

    const page3 = service.search(3, 2);
    expect(page3.data).toHaveLength(1);
  });

  /**
   * Validates that getEntityTimeline returns paginated events for a
   * specific entity. This is the "task history" view.
   */
  it("should return entity timeline with pagination", () => {
    seedAuditEvent(conn.db, { entityType: "task", entityId: "task-1" });
    seedAuditEvent(conn.db, { entityType: "task", entityId: "task-1" });
    seedAuditEvent(conn.db, { entityType: "task", entityId: "task-2" });

    const result = service.getEntityTimeline("task", "task-1", 1, 20);

    expect(result.data).toHaveLength(2);
    expect(result.data.every((e) => e.entityId === "task-1")).toBe(true);
    expect(result.meta.total).toBe(2);
  });

  /**
   * Validates that getEntityTimeline returns empty results when
   * no events exist for the specified entity.
   */
  it("should return empty timeline for non-existent entity", () => {
    const result = service.getEntityTimeline("task", "non-existent", 1, 20);

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });
});
