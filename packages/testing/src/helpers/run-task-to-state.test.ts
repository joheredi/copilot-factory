import { describe, it, expect } from "vitest";

import { TaskStatus } from "@factory/domain";

import { runTaskToState, findTransitionPath } from "./run-task-to-state.js";

/**
 * Tests for runTaskToState — lifecycle helper for integration tests.
 *
 * This helper is the primary mechanism for setting up tasks in specific
 * states. Integration tests call runTaskToState(TaskStatus.IN_REVIEW) to
 * get a task that has been through the full BACKLOG → ... → IN_REVIEW flow
 * without manually executing each transition.
 */
describe("findTransitionPath", () => {
  /**
   * Validates identity path (from === to).
   */
  it("returns single-element path when from equals to", () => {
    const path = findTransitionPath(TaskStatus.BACKLOG, TaskStatus.BACKLOG);
    expect(path).toEqual([TaskStatus.BACKLOG]);
  });

  /**
   * Validates the happy path from BACKLOG to DONE.
   */
  it("finds happy path from BACKLOG to DONE", () => {
    const path = findTransitionPath(TaskStatus.BACKLOG, TaskStatus.DONE);
    expect(path).toEqual([
      TaskStatus.BACKLOG,
      TaskStatus.READY,
      TaskStatus.ASSIGNED,
      TaskStatus.IN_DEVELOPMENT,
      TaskStatus.DEV_COMPLETE,
      TaskStatus.IN_REVIEW,
      TaskStatus.APPROVED,
      TaskStatus.QUEUED_FOR_MERGE,
      TaskStatus.MERGING,
      TaskStatus.POST_MERGE_VALIDATION,
      TaskStatus.DONE,
    ]);
  });

  /**
   * Validates partial happy path.
   */
  it("finds path from BACKLOG to IN_REVIEW", () => {
    const path = findTransitionPath(TaskStatus.BACKLOG, TaskStatus.IN_REVIEW);
    expect(path).toEqual([
      TaskStatus.BACKLOG,
      TaskStatus.READY,
      TaskStatus.ASSIGNED,
      TaskStatus.IN_DEVELOPMENT,
      TaskStatus.DEV_COMPLETE,
      TaskStatus.IN_REVIEW,
    ]);
  });

  /**
   * Validates BFS-based path finding for off-happy-path targets.
   */
  it("finds path to FAILED via BFS", () => {
    const path = findTransitionPath(TaskStatus.BACKLOG, TaskStatus.FAILED);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(TaskStatus.FAILED);
  });

  /**
   * Validates path finding to ESCALATED (wildcard target).
   */
  it("finds path to ESCALATED", () => {
    const path = findTransitionPath(TaskStatus.BACKLOG, TaskStatus.ESCALATED);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(TaskStatus.ESCALATED);
  });

  /**
   * Validates path finding to CANCELLED (wildcard target).
   */
  it("finds path to CANCELLED", () => {
    const path = findTransitionPath(TaskStatus.BACKLOG, TaskStatus.CANCELLED);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(TaskStatus.CANCELLED);
  });

  /**
   * Validates that terminal states have no outgoing transitions
   * (except via BFS from non-terminal).
   */
  it("returns null for impossible transitions", () => {
    const path = findTransitionPath(TaskStatus.DONE, TaskStatus.BACKLOG);
    expect(path).toBeNull();
  });
});

describe("runTaskToState", () => {
  /**
   * Validates driving a task from BACKLOG to DONE through the full lifecycle.
   * This is the most important integration test setup scenario.
   */
  it("drives task from BACKLOG to DONE", async () => {
    const result = await runTaskToState(TaskStatus.DONE);
    expect(result.reached).toBe(true);
    expect(result.status).toBe(TaskStatus.DONE);
    expect(result.path.length).toBeGreaterThan(1);
    expect(result.path[0]).toBe(TaskStatus.BACKLOG);
    expect(result.path[result.path.length - 1]).toBe(TaskStatus.DONE);
  });

  /**
   * Validates driving to an intermediate state.
   */
  it("drives task from BACKLOG to IN_REVIEW", async () => {
    const result = await runTaskToState(TaskStatus.IN_REVIEW);
    expect(result.reached).toBe(true);
    expect(result.status).toBe(TaskStatus.IN_REVIEW);
  });

  /**
   * Validates driving from a custom starting state.
   */
  it("supports custom starting state", async () => {
    const result = await runTaskToState(TaskStatus.IN_DEVELOPMENT, {
      fromState: TaskStatus.ASSIGNED,
    });
    expect(result.reached).toBe(true);
    expect(result.status).toBe(TaskStatus.IN_DEVELOPMENT);
    expect(result.path).toEqual([TaskStatus.ASSIGNED, TaskStatus.IN_DEVELOPMENT]);
  });

  /**
   * Validates the transition callback is invoked at each step.
   */
  it("invokes onTransition callback at each step", async () => {
    const transitions: Array<{ from: TaskStatus; to: TaskStatus }> = [];

    await runTaskToState(TaskStatus.ASSIGNED, {
      onTransition: (from, to) => {
        transitions.push({ from, to });
      },
    });

    expect(transitions).toEqual([
      { from: TaskStatus.BACKLOG, to: TaskStatus.READY },
      { from: TaskStatus.READY, to: TaskStatus.ASSIGNED },
    ]);
  });

  /**
   * Validates that identity transitions (from === to) work correctly.
   */
  it("handles identity transition", async () => {
    const result = await runTaskToState(TaskStatus.BACKLOG);
    expect(result.reached).toBe(true);
    expect(result.path).toEqual([TaskStatus.BACKLOG]);
    expect(result.contexts).toHaveLength(0);
  });

  /**
   * Validates that impossible transitions throw.
   */
  it("throws for impossible transitions", async () => {
    await expect(
      runTaskToState(TaskStatus.BACKLOG, { fromState: TaskStatus.DONE }),
    ).rejects.toThrow("No valid transition path");
  });

  /**
   * Validates that contexts array contains one entry per transition step.
   */
  it("records transition contexts", async () => {
    const result = await runTaskToState(TaskStatus.READY);
    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0]).toHaveProperty("allDependenciesResolved", true);
  });

  /**
   * Validates driving to FAILED state (off happy path).
   */
  it("drives task to FAILED", async () => {
    const result = await runTaskToState(TaskStatus.FAILED);
    expect(result.reached).toBe(true);
    expect(result.status).toBe(TaskStatus.FAILED);
  });

  /**
   * Validates driving to ESCALATED state (wildcard transition).
   */
  it("drives task to ESCALATED", async () => {
    const result = await runTaskToState(TaskStatus.ESCALATED);
    expect(result.reached).toBe(true);
    expect(result.status).toBe(TaskStatus.ESCALATED);
  });
});
