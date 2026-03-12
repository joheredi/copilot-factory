// @vitest-environment jsdom
/**
 * Tests for the query key factory.
 *
 * Validates that:
 * - Key hierarchies are correct (all → lists → detail)
 * - Parameterized keys include the params object
 * - Keys are referentially stable for the same input
 *
 * This is important because query key correctness determines whether
 * cache invalidation works properly. Incorrect keys cause stale data
 * or unnecessary refetches across the entire UI.
 */
import { describe, it, expect } from "vitest";
import { queryKeys } from "./query-keys";

describe("queryKeys", () => {
  describe("projects", () => {
    /**
     * Validates the hierarchy: all > lists > detail.
     * This ensures invalidating `all` cascades to lists and details.
     */
    it("all is the prefix for lists and details", () => {
      const all = queryKeys.projects.all;
      const lists = queryKeys.projects.lists();
      const detail = queryKeys.projects.detail("p1");

      expect(lists[0]).toBe(all[0]);
      expect(detail[0]).toBe(all[0]);
      expect(lists[1]).toBe("list");
      expect(detail[1]).toBe("detail");
    });

    it("lists includes params when provided", () => {
      const key = queryKeys.projects.lists({ page: 2, limit: 10 });
      expect(key).toEqual(["projects", "list", { page: 2, limit: 10 }]);
    });

    it("detail includes the entity id", () => {
      const key = queryKeys.projects.detail("abc");
      expect(key).toEqual(["projects", "detail", "abc"]);
    });
  });

  describe("tasks", () => {
    it("lists includes filter params", () => {
      const key = queryKeys.tasks.lists({ status: "READY", page: 1 });
      expect(key).toEqual(["tasks", "list", { status: "READY", page: 1 }]);
    });

    it("timeline includes task id and params", () => {
      const key = queryKeys.tasks.timeline("t1", { page: 1, limit: 50 });
      expect(key).toEqual(["tasks", "timeline", "t1", { page: 1, limit: 50 }]);
    });
  });

  describe("pools", () => {
    it("workers key scoped under pool id", () => {
      const key = queryKeys.pools.workers("pool1");
      expect(key).toEqual(["pools", "workers", "pool1"]);
    });
  });

  describe("profiles", () => {
    it("lists scoped under pool id", () => {
      const key = queryKeys.profiles.lists("pool1");
      expect(key).toEqual(["profiles", "list", "pool1"]);
    });

    it("detail scoped under pool and profile ids", () => {
      const key = queryKeys.profiles.detail("pool1", "prof1");
      expect(key).toEqual(["profiles", "detail", "pool1", "prof1"]);
    });
  });

  describe("reviews", () => {
    it("cyclePackets includes task and cycle ids", () => {
      const key = queryKeys.reviews.cyclePackets("t1", "c1");
      expect(key).toEqual(["reviews", "packets", "t1", "c1"]);
    });
  });

  describe("audit", () => {
    it("lists includes filter params", () => {
      const key = queryKeys.audit.lists({ entityType: "task", page: 1 });
      expect(key).toEqual(["audit", "list", { entityType: "task", page: 1 }]);
    });
  });

  describe("policies", () => {
    it("effective key is stable", () => {
      const a = queryKeys.policies.effective();
      const b = queryKeys.policies.effective();
      expect(a).toEqual(b);
      expect(a).toEqual(["policies", "effective"]);
    });
  });

  describe("repositories", () => {
    it("lists scoped under project id", () => {
      const key = queryKeys.repositories.lists("proj1", { page: 1 });
      expect(key).toEqual(["repositories", "list", "proj1", { page: 1 }]);
    });
  });

  describe("health", () => {
    it("returns stable key", () => {
      expect(queryKeys.health.all).toEqual(["health"]);
    });
  });
});
