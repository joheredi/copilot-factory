/**
 * Tests for the audit controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link AuditService}.
 * Each test validates delegation to the service with correct parameter
 * mapping from query DTOs to service method arguments.
 *
 * @module @factory/control-plane
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AuditController } from "./audit.controller.js";
import type { AuditService, PaginatedAuditResponse } from "./audit.service.js";

/** Factory for a fake paginated audit response. */
function fakePaginatedAudit(
  overrides: Partial<PaginatedAuditResponse> = {},
): PaginatedAuditResponse {
  return {
    data: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    ...overrides,
  };
}

describe("AuditController", () => {
  let controller: AuditController;
  let service: { search: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { search: vi.fn() };
    controller = new AuditController(service as unknown as AuditService);
  });

  /**
   * Validates that the search endpoint delegates to the service with
   * all filter parameters correctly mapped from the query DTO.
   */
  it("should delegate search to the service with all filters", () => {
    const startDate = new Date("2025-01-01T00:00:00Z");
    const endDate = new Date("2025-12-31T23:59:59Z");
    const expected = fakePaginatedAudit({ meta: { page: 1, limit: 20, total: 5, totalPages: 1 } });
    service.search.mockReturnValue(expected);

    const result = controller.search({
      page: 1,
      limit: 20,
      entityType: "task",
      entityId: "task-1",
      eventType: "state_transition",
      actorType: "system",
      actorId: "scheduler",
      start: startDate,
      end: endDate,
    });

    expect(service.search).toHaveBeenCalledWith(1, 20, {
      entityType: "task",
      entityId: "task-1",
      eventType: "state_transition",
      actorType: "system",
      actorId: "scheduler",
      startTime: startDate,
      endTime: endDate,
    });
    expect(result).toEqual(expected);
  });

  /**
   * Validates that the search endpoint passes undefined for omitted filters.
   * The service should receive no filter criteria when none are provided.
   */
  it("should pass undefined for omitted filters", () => {
    const expected = fakePaginatedAudit();
    service.search.mockReturnValue(expected);

    controller.search({ page: 1, limit: 20 });

    expect(service.search).toHaveBeenCalledWith(1, 20, {
      entityType: undefined,
      entityId: undefined,
      eventType: undefined,
      actorType: undefined,
      actorId: undefined,
      startTime: undefined,
      endTime: undefined,
    });
  });
});
