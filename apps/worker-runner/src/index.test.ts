/**
 * Tests for @factory/worker-runner public API surface.
 *
 * These tests verify that the worker-runner package correctly re-exports
 * dispatch and supervisor types from @factory/application. This is important
 * because worker-runner is the intended public entry point for worker lifecycle
 * management, and consumers should be able to import everything they need
 * from this single package rather than reaching into @factory/application directly.
 *
 * @see docs/backlog/tasks/T139-worker-runner-exports.md
 */
import { describe, it, expect } from "vitest";

import {
  // Dispatch — value exports
  createWorkerDispatchService,
  DEFAULT_DISPATCH_LEASE_OWNER,
  // Supervisor — value exports
  createWorkerSupervisorService,
} from "./index.js";

describe("@factory/worker-runner exports", () => {
  /**
   * Validates that the dispatch service factory is a callable function,
   * confirming the re-export chain from @factory/application is intact.
   */
  it("exports createWorkerDispatchService as a function", () => {
    expect(typeof createWorkerDispatchService).toBe("function");
  });

  /**
   * Validates that the default lease owner constant is re-exported,
   * ensuring dispatch configuration defaults are accessible.
   */
  it("exports DEFAULT_DISPATCH_LEASE_OWNER as a string", () => {
    expect(typeof DEFAULT_DISPATCH_LEASE_OWNER).toBe("string");
    expect(DEFAULT_DISPATCH_LEASE_OWNER.length).toBeGreaterThan(0);
  });

  /**
   * Validates that the supervisor service factory is a callable function,
   * confirming the re-export chain from @factory/application is intact.
   */
  it("exports createWorkerSupervisorService as a function", () => {
    expect(typeof createWorkerSupervisorService).toBe("function");
  });
});
