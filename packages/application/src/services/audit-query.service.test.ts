/**
 * Unit tests for the audit event query service.
 *
 * These tests verify the application-layer query orchestration:
 * input validation, pagination normalization, and correct delegation
 * to the underlying query port. The query port is faked in-memory
 * to isolate the service logic from infrastructure concerns.
 *
 * @module @factory/application/services/audit-query.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createAuditQueryService } from "./audit-query.service.js";
import type { AuditQueryService } from "./audit-query.service.js";
import type {
  AuditEventQueryPort,
  AuditPaginationParams,
  AuditEventFilters,
  PaginatedAuditResult,
} from "../ports/audit-query.ports.js";
import type { AuditEventRecord } from "../ports/repository.ports.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Counter for generating unique IDs in tests. */
let idCounter = 0;

/**
 * Create a test audit event record with sensible defaults.
 * All fields can be overridden.
 */
function makeAuditEvent(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  idCounter += 1;
  return {
    id: `audit-${String(idCounter)}`,
    entityType: "task",
    entityId: "task-001",
    eventType: "state_transition",
    actorType: "system",
    actorId: "orchestrator",
    oldState: null,
    newState: null,
    metadata: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Compute the expected total pages for a given total and limit.
 */
function computeTotalPages(total: number, limit: number): number {
  return Math.ceil(total / limit);
}

/**
 * Build a paginated result from an array of items, applying pagination.
 */
function paginateItems(
  items: readonly AuditEventRecord[],
  pagination: AuditPaginationParams,
): PaginatedAuditResult {
  const total = items.length;
  const offset = (pagination.page - 1) * pagination.limit;
  const pageItems = items.slice(offset, offset + pagination.limit);
  return {
    items: pageItems,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: computeTotalPages(total, pagination.limit),
  };
}

// ---------------------------------------------------------------------------
// In-memory fake query port
// ---------------------------------------------------------------------------

/**
 * Create a fake audit event query port backed by an in-memory array.
 *
 * This fake applies the same filtering and pagination logic that the
 * real infrastructure adapter would, allowing us to verify the service
 * delegates correctly without touching a database.
 */
function createFakeQueryPort(events: AuditEventRecord[]): AuditEventQueryPort {
  return {
    getEntityTimeline(
      entityType: string,
      entityId: string,
      pagination: AuditPaginationParams,
    ): PaginatedAuditResult {
      const filtered = events
        .filter((e) => e.entityType === entityType && e.entityId === entityId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return paginateItems(filtered, pagination);
    },

    searchAuditEvents(
      filters: AuditEventFilters,
      pagination: AuditPaginationParams,
    ): PaginatedAuditResult {
      let filtered = [...events];

      if (filters.entityType !== undefined) {
        filtered = filtered.filter((e) => e.entityType === filters.entityType);
      }
      if (filters.entityId !== undefined) {
        filtered = filtered.filter((e) => e.entityId === filters.entityId);
      }
      if (filters.eventType !== undefined) {
        filtered = filtered.filter((e) => e.eventType === filters.eventType);
      }
      if (filters.actorType !== undefined) {
        filtered = filtered.filter((e) => e.actorType === filters.actorType);
      }
      if (filters.actorId !== undefined) {
        filtered = filtered.filter((e) => e.actorId === filters.actorId);
      }
      if (filters.startTime !== undefined) {
        filtered = filtered.filter((e) => e.createdAt >= filters.startTime!);
      }
      if (filters.endTime !== undefined) {
        filtered = filtered.filter((e) => e.createdAt <= filters.endTime!);
      }

      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return paginateItems(filtered, pagination);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditQueryService", () => {
  let service: AuditQueryService;
  let testEvents: AuditEventRecord[];

  beforeEach(() => {
    idCounter = 0;

    // Build a diverse set of audit events for testing.
    testEvents = [
      makeAuditEvent({
        entityType: "task",
        entityId: "task-A",
        eventType: "state_transition",
        actorType: "system",
        actorId: "scheduler",
        createdAt: new Date("2025-01-01T10:00:00Z"),
      }),
      makeAuditEvent({
        entityType: "task",
        entityId: "task-A",
        eventType: "state_transition",
        actorType: "worker",
        actorId: "worker-1",
        createdAt: new Date("2025-01-01T11:00:00Z"),
      }),
      makeAuditEvent({
        entityType: "task",
        entityId: "task-A",
        eventType: "operator_override",
        actorType: "operator",
        actorId: "admin",
        createdAt: new Date("2025-01-01T12:00:00Z"),
      }),
      makeAuditEvent({
        entityType: "lease",
        entityId: "lease-1",
        eventType: "state_transition",
        actorType: "system",
        actorId: "scheduler",
        createdAt: new Date("2025-01-01T10:30:00Z"),
      }),
      makeAuditEvent({
        entityType: "task",
        entityId: "task-B",
        eventType: "created",
        actorType: "operator",
        actorId: "admin",
        createdAt: new Date("2025-01-01T09:00:00Z"),
      }),
    ];

    service = createAuditQueryService({
      queryPort: createFakeQueryPort(testEvents),
    });
  });

  // -------------------------------------------------------------------------
  // getEntityTimeline
  // -------------------------------------------------------------------------

  describe("getEntityTimeline", () => {
    /**
     * @why The primary use case: reconstruct what happened to a specific
     * entity. Must return only events for that entity and respect pagination.
     */
    it("returns paginated events for a specific entity", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: 1, limit: 10 });

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
      // All events should be for task-A
      for (const event of result.items) {
        expect(event.entityType).toBe("task");
        expect(event.entityId).toBe("task-A");
      }
    });

    /**
     * @why Events must be ordered most-recent-first so operators see the
     * latest activity at the top of the timeline.
     */
    it("returns events ordered by creation time descending", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: 1, limit: 10 });

      expect(result.items[0]!.createdAt).toEqual(new Date("2025-01-01T12:00:00Z"));
      expect(result.items[1]!.createdAt).toEqual(new Date("2025-01-01T11:00:00Z"));
      expect(result.items[2]!.createdAt).toEqual(new Date("2025-01-01T10:00:00Z"));
    });

    /**
     * @why Pagination must work correctly to handle entities with many events.
     * Page 2 should return remaining items and correct metadata.
     */
    it("paginates correctly across multiple pages", () => {
      const page1 = service.getEntityTimeline("task", "task-A", { page: 1, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(3);
      expect(page1.totalPages).toBe(2);

      const page2 = service.getEntityTimeline("task", "task-A", { page: 2, limit: 2 });
      expect(page2.items).toHaveLength(1);
      expect(page2.total).toBe(3);
      expect(page2.page).toBe(2);
    });

    /**
     * @why An entity with no events should return an empty result set with
     * correct pagination metadata, not an error.
     */
    it("returns empty result for entity with no events", () => {
      const result = service.getEntityTimeline("task", "nonexistent", { page: 1, limit: 10 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    /**
     * @why Uses default pagination (page 1, limit 20) when not specified.
     * Callers should not be forced to provide pagination for simple queries.
     */
    it("uses default pagination when not specified", () => {
      const result = service.getEntityTimeline("task", "task-A");

      expect(result.items).toHaveLength(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    /**
     * @why Empty entityType is invalid — the caller must specify which
     * entity type to query. Validates that input validation catches this.
     */
    it("throws when entityType is empty", () => {
      expect(() => service.getEntityTimeline("", "task-A")).toThrow("entityType must not be empty");
    });

    /**
     * @why Empty entityId is invalid — the caller must specify which
     * entity to query. Validates that input validation catches this.
     */
    it("throws when entityId is empty", () => {
      expect(() => service.getEntityTimeline("task", "")).toThrow("entityId must not be empty");
    });

    /**
     * @why Whitespace-only strings should be treated as empty — they
     * would match nothing meaningful and indicate a caller bug.
     */
    it("throws when entityType is whitespace-only", () => {
      expect(() => service.getEntityTimeline("  ", "task-A")).toThrow(
        "entityType must not be empty",
      );
    });
  });

  // -------------------------------------------------------------------------
  // searchAuditEvents
  // -------------------------------------------------------------------------

  describe("searchAuditEvents", () => {
    /**
     * @why When no filters are specified, all events should be returned.
     * This is useful for browsing the full audit log.
     */
    it("returns all events when no filters are specified", () => {
      const result = service.searchAuditEvents({}, { page: 1, limit: 100 });

      expect(result.items).toHaveLength(5);
      expect(result.total).toBe(5);
    });

    /**
     * @why entityType filter narrows results to a specific entity class.
     * Useful for "show all task events" or "show all lease events."
     */
    it("filters by entityType", () => {
      const result = service.searchAuditEvents({ entityType: "lease" }, { page: 1, limit: 100 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.entityType).toBe("lease");
    });

    /**
     * @why entityId filter narrows to a specific entity instance.
     * Combined with entityType, gives the same result as getEntityTimeline.
     */
    it("filters by entityId", () => {
      const result = service.searchAuditEvents({ entityId: "task-B" }, { page: 1, limit: 100 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.entityId).toBe("task-B");
    });

    /**
     * @why eventType filter supports queries like "show all operator overrides"
     * or "show all state transitions" across the entire system.
     */
    it("filters by eventType", () => {
      const result = service.searchAuditEvents(
        { eventType: "operator_override" },
        { page: 1, limit: 100 },
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.eventType).toBe("operator_override");
    });

    /**
     * @why actorType filter supports queries like "what did operators do?"
     * or "show all system-initiated events."
     */
    it("filters by actorType", () => {
      const result = service.searchAuditEvents({ actorType: "operator" }, { page: 1, limit: 100 });

      expect(result.items).toHaveLength(2);
      for (const event of result.items) {
        expect(event.actorType).toBe("operator");
      }
    });

    /**
     * @why actorId filter narrows to a specific actor. Useful for
     * "what did worker-1 do?" or "show admin's actions."
     */
    it("filters by actorId", () => {
      const result = service.searchAuditEvents({ actorId: "worker-1" }, { page: 1, limit: 100 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.actorId).toBe("worker-1");
    });

    /**
     * @why Time range filtering supports operational monitoring ("what
     * happened in the last hour?") and historical audit ("events on Jan 1").
     */
    it("filters by time range", () => {
      const result = service.searchAuditEvents(
        {
          startTime: new Date("2025-01-01T10:00:00Z"),
          endTime: new Date("2025-01-01T11:00:00Z"),
        },
        { page: 1, limit: 100 },
      );

      // Should include events at 10:00, 10:30, and 11:00
      expect(result.items).toHaveLength(3);
    });

    /**
     * @why Multiple filters must combine with AND semantics — each
     * condition narrows the result set further. This is the core
     * flexible search capability.
     */
    it("combines multiple filters with AND semantics", () => {
      const result = service.searchAuditEvents(
        {
          entityType: "task",
          actorType: "system",
        },
        { page: 1, limit: 100 },
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.entityType).toBe("task");
      expect(result.items[0]!.actorType).toBe("system");
    });

    /**
     * @why Combining entity + time range + actor is a common forensic
     * query: "what did operators do to tasks in the last hour?"
     */
    it("combines entity, time, and actor filters", () => {
      const result = service.searchAuditEvents(
        {
          entityType: "task",
          actorType: "operator",
          startTime: new Date("2025-01-01T00:00:00Z"),
          endTime: new Date("2025-01-01T23:59:59Z"),
        },
        { page: 1, limit: 100 },
      );

      // task-A operator_override and task-B created by operator
      expect(result.items).toHaveLength(2);
      for (const event of result.items) {
        expect(event.entityType).toBe("task");
        expect(event.actorType).toBe("operator");
      }
    });

    /**
     * @why Filters that match nothing should return an empty result set
     * with correct pagination metadata, not throw an error.
     */
    it("returns empty result when filters match nothing", () => {
      const result = service.searchAuditEvents(
        { entityType: "nonexistent" },
        { page: 1, limit: 100 },
      );

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    /**
     * @why Invalid time range (start after end) indicates a caller bug.
     * Failing fast with a clear error is better than returning empty results.
     */
    it("throws when startTime is after endTime", () => {
      expect(() =>
        service.searchAuditEvents({
          startTime: new Date("2025-01-02T00:00:00Z"),
          endTime: new Date("2025-01-01T00:00:00Z"),
        }),
      ).toThrow("startTime");
    });

    /**
     * @why Search should use default pagination when not specified.
     */
    it("uses default pagination when not specified", () => {
      const result = service.searchAuditEvents({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    /**
     * @why Pagination must work correctly with filters applied.
     */
    it("paginates filtered results correctly", () => {
      const result = service.searchAuditEvents({ entityType: "task" }, { page: 1, limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(4); // 4 task events total
      expect(result.totalPages).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Pagination normalization
  // -------------------------------------------------------------------------

  describe("pagination normalization", () => {
    /**
     * @why Page numbers below 1 should be clamped to 1 to prevent
     * negative offsets and undefined behavior.
     */
    it("clamps page below 1 to 1", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: 0, limit: 10 });
      expect(result.page).toBe(1);
    });

    /**
     * @why Limit values below 1 should be clamped to 1 to prevent
     * zero-item pages.
     */
    it("clamps limit below 1 to 1", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: 1, limit: 0 });
      expect(result.limit).toBe(1);
    });

    /**
     * @why Limit values above 100 should be clamped to 100 to prevent
     * excessively large result sets that could impact performance.
     */
    it("clamps limit above 100 to 100", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: 1, limit: 500 });
      expect(result.limit).toBe(100);
    });

    /**
     * @why Fractional page/limit values should be floored to integers
     * to prevent SQL injection of non-integer values.
     */
    it("floors fractional page and limit", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: 1.7, limit: 10.9 });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    /**
     * @why Negative page values should be clamped to 1 (same as below-1).
     */
    it("clamps negative page to 1", () => {
      const result = service.getEntityTimeline("task", "task-A", { page: -5, limit: 10 });
      expect(result.page).toBe(1);
    });
  });
});
