/**
 * @module workspace-cleanup-policy.test
 * Unit tests for workspace cleanup eligibility rules.
 *
 * These tests validate the business rules from PRD §2.9 that determine
 * when a task workspace can be safely cleaned up. Each test documents
 * why the rule exists and what failure would mean for the system.
 */

import { describe, it, expect } from "vitest";

import { TaskStatus } from "./enums.js";
import {
  isWorkspaceCleanupEligible,
  type WorkspaceRetentionPolicy,
  type WorkspaceCleanupInput,
} from "./workspace-cleanup-policy.js";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

const DEFAULT_POLICY: WorkspaceRetentionPolicy = {
  workspace_retention_hours: 24,
  retain_failed_workspaces: true,
  retain_escalated_workspaces: true,
};

/**
 * Create a cleanup input with sensible defaults for testing.
 * Override specific fields per test scenario.
 */
function makeInput(overrides: Partial<WorkspaceCleanupInput> = {}): WorkspaceCleanupInput {
  return {
    taskStatus: TaskStatus.DONE,
    retentionPolicy: DEFAULT_POLICY,
    terminalStateAt: new Date("2024-01-01T00:00:00Z"),
    now: new Date("2024-01-02T01:00:00Z"), // 25 hours later
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("isWorkspaceCleanupEligible", () => {
  // ─── Terminal State Eligibility ──────────────────────────────────────────

  describe("terminal state tasks", () => {
    /**
     * @why DONE tasks past the retention period are the primary cleanup target.
     * These workspaces consume disk space and are no longer needed for development.
     */
    it("should be eligible for DONE tasks after retention period", () => {
      const result = isWorkspaceCleanupEligible(makeInput({ taskStatus: TaskStatus.DONE }));

      expect(result.eligible).toBe(true);
      expect(result.reason).toContain("eligible");
    });

    /**
     * @why CANCELLED tasks past the retention period should be cleaned up.
     * The work was abandoned and the workspace is no longer needed.
     */
    it("should be eligible for CANCELLED tasks after retention period", () => {
      const result = isWorkspaceCleanupEligible(makeInput({ taskStatus: TaskStatus.CANCELLED }));

      expect(result.eligible).toBe(true);
      expect(result.reason).toContain("eligible");
    });

    /**
     * @why FAILED tasks with retain_failed_workspaces=false and past the retention
     * period should be cleaned up to reclaim disk space.
     */
    it("should be eligible for FAILED tasks when retain_failed_workspaces is false", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.FAILED,
          retentionPolicy: { ...DEFAULT_POLICY, retain_failed_workspaces: false },
        }),
      );

      expect(result.eligible).toBe(true);
    });
  });

  // ─── FAILED Task Retention ──────────────────────────────────────────────

  describe("FAILED task retention", () => {
    /**
     * @why FAILED workspaces are retained by default so developers can inspect
     * the workspace to debug what went wrong. Cleaning them up prematurely
     * would lose debugging context.
     */
    it("should NOT be eligible for FAILED tasks when retain_failed_workspaces is true", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.FAILED,
          retentionPolicy: { ...DEFAULT_POLICY, retain_failed_workspaces: true },
        }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Failed workspaces are retained");
    });
  });

  // ─── ESCALATED Task Retention ───────────────────────────────────────────

  describe("ESCALATED task retention", () => {
    /**
     * @why ESCALATED tasks require operator attention. Their workspaces must
     * be preserved so operators can inspect the state, make decisions, and
     * potentially resume work. Cleaning up would lose critical context.
     */
    it("should NOT be eligible for ESCALATED tasks", () => {
      const result = isWorkspaceCleanupEligible(makeInput({ taskStatus: TaskStatus.ESCALATED }));

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Escalated");
      expect(result.reason).toContain("operator resolution");
    });
  });

  // ─── Non-Terminal State Rejection ───────────────────────────────────────

  describe("non-terminal states", () => {
    const nonTerminalStates: TaskStatus[] = [
      TaskStatus.BACKLOG,
      TaskStatus.READY,
      TaskStatus.BLOCKED,
      TaskStatus.ASSIGNED,
      TaskStatus.IN_DEVELOPMENT,
      TaskStatus.DEV_COMPLETE,
      TaskStatus.IN_REVIEW,
      TaskStatus.CHANGES_REQUESTED,
      TaskStatus.APPROVED,
      TaskStatus.QUEUED_FOR_MERGE,
      TaskStatus.MERGING,
      TaskStatus.POST_MERGE_VALIDATION,
    ];

    /**
     * @why Workspaces for tasks still in progress must NEVER be cleaned up.
     * The workspace is actively being used by a worker or is needed for
     * the next pipeline stage (review, merge, validation).
     */
    it.each(nonTerminalStates)("should NOT be eligible for %s tasks", (status) => {
      const result = isWorkspaceCleanupEligible(makeInput({ taskStatus: status }));

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("non-terminal state");
    });
  });

  // ─── Retention Period ───────────────────────────────────────────────────

  describe("retention period", () => {
    /**
     * @why The retention period gives operators a window to inspect completed
     * work before it disappears. Cleaning up before the period elapses
     * would violate the operator's expected access window.
     */
    it("should NOT be eligible when retention period has not elapsed", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.DONE,
          terminalStateAt: new Date("2024-01-01T00:00:00Z"),
          now: new Date("2024-01-01T12:00:00Z"), // Only 12 hours
        }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Retention period not elapsed");
      expect(result.reason).toContain("12h remaining");
    });

    /**
     * @why A task that just entered terminal state should show the full
     * retention period remaining (minus any partial hours, rounded up).
     */
    it("should report correct remaining hours", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.DONE,
          retentionPolicy: { ...DEFAULT_POLICY, workspace_retention_hours: 48 },
          terminalStateAt: new Date("2024-01-01T00:00:00Z"),
          now: new Date("2024-01-01T00:30:00Z"), // 30 minutes
        }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("48h remaining");
    });

    /**
     * @why When retention_hours is 0, the workspace should be eligible
     * for cleanup immediately after reaching terminal state.
     */
    it("should be eligible immediately when retention_hours is 0", () => {
      const now = new Date("2024-01-01T00:00:00Z");
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.DONE,
          retentionPolicy: { ...DEFAULT_POLICY, workspace_retention_hours: 0 },
          terminalStateAt: now,
          now,
        }),
      );

      expect(result.eligible).toBe(true);
    });

    /**
     * @why The boundary case: exactly at the retention deadline should
     * be eligible (>= comparison, not >).
     */
    it("should be eligible exactly at the retention deadline", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.DONE,
          terminalStateAt: new Date("2024-01-01T00:00:00Z"),
          now: new Date("2024-01-02T00:00:00Z"), // Exactly 24 hours
        }),
      );

      expect(result.eligible).toBe(true);
    });
  });

  // ─── Policy Combinations ────────────────────────────────────────────────

  describe("policy combinations", () => {
    /**
     * @why Even with retain_failed_workspaces=false, the retention period
     * must still be respected. These are independent checks.
     */
    it("should respect retention period even when retain_failed_workspaces is false", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.FAILED,
          retentionPolicy: {
            ...DEFAULT_POLICY,
            retain_failed_workspaces: false,
            workspace_retention_hours: 48,
          },
          terminalStateAt: new Date("2024-01-01T00:00:00Z"),
          now: new Date("2024-01-01T12:00:00Z"), // Only 12 hours of 48
        }),
      );

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Retention period not elapsed");
    });

    /**
     * @why A short retention period with a DONE task should be the simplest
     * path to eligible cleanup — verify the happy path works end-to-end.
     */
    it("should handle short retention with terminal state correctly", () => {
      const result = isWorkspaceCleanupEligible(
        makeInput({
          taskStatus: TaskStatus.DONE,
          retentionPolicy: { ...DEFAULT_POLICY, workspace_retention_hours: 1 },
          terminalStateAt: new Date("2024-01-01T00:00:00Z"),
          now: new Date("2024-01-01T01:01:00Z"), // 61 minutes
        }),
      );

      expect(result.eligible).toBe(true);
    });
  });
});
