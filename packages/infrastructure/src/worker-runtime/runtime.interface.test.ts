/**
 * Tests for worker runtime types and interface contract.
 *
 * These tests verify that the WorkerRuntime interface, RunContext, RunResult,
 * and all supporting types are structurally sound and can be satisfied by
 * concrete implementations. Since these are TypeScript interfaces, the primary
 * validation is that mock implementations compile and behave correctly.
 *
 * @why These tests are critical because the WorkerRuntime interface is the
 * foundational adapter contract for all execution backends. Any structural
 * issue here would cascade into every adapter implementation (Copilot CLI,
 * local LLM, deterministic validator, etc.).
 */

import { describe, it, expect } from "vitest";
import type {
  RunStatus,
  WorkspacePaths,
  TimeoutSettings,
  RunContext,
  PreparedRun,
  RunOutputStream,
  CancelResult,
  CollectedArtifacts,
  FinalizeResult,
  WorkerRuntime,
} from "./index.js";

/**
 * Creates a minimal valid RunContext for testing.
 *
 * Uses structurally valid objects that satisfy the TaskPacket and
 * PolicySnapshot types from @factory/schemas. The task packet includes
 * all required fields per PRD 008 §8.4.
 */
function createTestRunContext(): RunContext {
  return {
    taskPacket: {
      packet_type: "task_packet",
      schema_version: "1.0",
      created_at: "2025-01-01T00:00:00Z",
      task_id: "task-001",
      repository_id: "repo-001",
      role: "developer",
      time_budget_seconds: 3600,
      expires_at: "2025-01-01T01:00:00Z",
      task: {
        title: "Implement feature X",
        description: "Full description of the task",
        task_type: "feature",
        priority: "medium",
        risk_level: "low",
        acceptance_criteria: ["Criterion 1"],
        definition_of_done: ["Tests pass"],
        branch_name: "feature/x",
      },
      repository: {
        name: "test-repo",
        default_branch: "main",
      },
      workspace: {
        worktree_path: "/tmp/worktrees/task-001",
        artifact_root: "/tmp/artifacts/task-001",
      },
      context: {},
      repo_policy: {
        policy_set_id: "default",
      },
      tool_policy: {
        command_policy_id: "standard",
        file_scope_policy_id: "standard",
      },
      validation_requirements: {
        profile: "standard",
      },
      stop_conditions: ["All tests pass"],
      expected_output: {
        packet_type: "dev_result_packet",
        schema_version: "1.0",
      },
    },
    effectivePolicySnapshot: {
      policy_snapshot_version: "1.0",
      policy_set_id: "default",
    },
    workspacePaths: {
      worktreePath: "/tmp/worktrees/task-001",
      artifactRoot: "/tmp/artifacts/task-001",
      packetInputPath: "/tmp/worktrees/task-001/.factory/task-packet.json",
      policySnapshotPath: "/tmp/worktrees/task-001/.factory/policy-snapshot.json",
    },
    outputSchemaExpectation: {
      packetType: "dev_result_packet",
      schemaVersion: "1.0",
    },
    timeoutSettings: {
      timeBudgetSeconds: 3600,
      expiresAt: "2025-01-01T01:00:00Z",
      heartbeatIntervalSeconds: 30,
      missedHeartbeatThreshold: 2,
      gracePeriodSeconds: 15,
    },
  };
}

/**
 * Creates a mock WorkerRuntime implementation for testing.
 *
 * This mock tracks method calls and returns predictable results so that
 * tests can verify the interface contract is satisfiable and that the
 * full lifecycle (prepare → start → stream → collect → finalize) works.
 */
function createMockRuntime(): WorkerRuntime & { calls: string[] } {
  const calls: string[] = [];
  let runCounter = 0;

  return {
    name: "mock-runtime",
    calls,

    async prepareRun(context: RunContext): Promise<PreparedRun> {
      calls.push("prepareRun");
      runCounter++;
      return {
        runId: `run-${String(runCounter)}`,
        context,
        preparedAt: new Date().toISOString(),
      };
    },

    async startRun(runId: string): Promise<void> {
      calls.push(`startRun:${runId}`);
    },

    async *streamRun(runId: string): AsyncIterable<RunOutputStream> {
      calls.push(`streamRun:${runId}`);
      yield {
        type: "stdout",
        content: "Starting execution...",
        timestamp: new Date().toISOString(),
      };
      yield {
        type: "heartbeat",
        content: "",
        timestamp: new Date().toISOString(),
      };
      yield {
        type: "stdout",
        content: "Execution complete.",
        timestamp: new Date().toISOString(),
      };
    },

    async cancelRun(runId: string): Promise<CancelResult> {
      calls.push(`cancelRun:${runId}`);
      return { cancelled: true };
    },

    async collectArtifacts(runId: string): Promise<CollectedArtifacts> {
      calls.push(`collectArtifacts:${runId}`);
      return {
        packetOutput: { packet_type: "dev_result_packet", schema_version: "1.0" },
        packetValid: true,
        artifactPaths: ["/tmp/artifacts/task-001/output.json"],
        validationErrors: [],
      };
    },

    async finalizeRun(runId: string): Promise<FinalizeResult> {
      calls.push(`finalizeRun:${runId}`);
      return {
        runId,
        status: "success",
        packetOutput: { packet_type: "dev_result_packet", schema_version: "1.0" },
        artifactPaths: ["/tmp/artifacts/task-001/output.json"],
        logs: [
          {
            timestamp: new Date().toISOString(),
            stream: "stdout",
            content: "Execution complete.",
          },
        ],
        exitCode: 0,
        durationMs: 1500,
        finalizedAt: new Date().toISOString(),
      };
    },
  };
}

describe("WorkerRuntime interface", () => {
  /**
   * @why Verifies the mock satisfies the interface contract structurally.
   * If this test breaks, it means the interface changed in a way that
   * existing adapter patterns can no longer satisfy.
   */
  it("should be satisfiable by a concrete implementation", () => {
    const runtime = createMockRuntime();
    // If this compiles, the interface is satisfiable
    const _rt: WorkerRuntime = runtime;
    expect(_rt.name).toBe("mock-runtime");
  });

  /**
   * @why Verifies the full lifecycle (prepare → start → stream → collect → finalize)
   * can be executed in sequence. This is the primary usage pattern for all adapters.
   */
  it("should support the full run lifecycle", async () => {
    const runtime = createMockRuntime();
    const context = createTestRunContext();

    // Phase 1: Prepare
    const prepared = await runtime.prepareRun(context);
    expect(prepared.runId).toBe("run-1");
    expect(prepared.context).toBe(context);
    expect(prepared.preparedAt).toBeTruthy();

    // Phase 2: Start
    await runtime.startRun(prepared.runId);

    // Phase 3: Stream output
    const events: RunOutputStream[] = [];
    for await (const event of runtime.streamRun(prepared.runId)) {
      events.push(event);
    }
    expect(events.length).toBe(3);
    expect(events[0]!.type).toBe("stdout");
    expect(events[1]!.type).toBe("heartbeat");
    expect(events[2]!.type).toBe("stdout");

    // Phase 4: Collect artifacts
    const artifacts = await runtime.collectArtifacts(prepared.runId);
    expect(artifacts.packetValid).toBe(true);
    expect(artifacts.artifactPaths.length).toBeGreaterThan(0);
    expect(artifacts.validationErrors).toHaveLength(0);

    // Phase 5: Finalize
    const result = await runtime.finalizeRun(prepared.runId);
    expect(result.runId).toBe(prepared.runId);
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.logs.length).toBeGreaterThan(0);

    // Verify lifecycle order
    expect(runtime.calls).toEqual([
      "prepareRun",
      "startRun:run-1",
      "streamRun:run-1",
      "collectArtifacts:run-1",
      "finalizeRun:run-1",
    ]);
  });

  /**
   * @why Verifies that multiple independent runs can be prepared from
   * the same runtime instance, each getting a unique run ID. This is
   * important because a single adapter instance manages concurrent runs.
   */
  it("should support multiple concurrent runs with unique IDs", async () => {
    const runtime = createMockRuntime();
    const context = createTestRunContext();

    const run1 = await runtime.prepareRun(context);
    const run2 = await runtime.prepareRun(context);

    expect(run1.runId).not.toBe(run2.runId);
    expect(run1.runId).toBe("run-1");
    expect(run2.runId).toBe("run-2");
  });

  /**
   * @why Verifies that cancellation returns a structured result. Adapters
   * must handle cancellation gracefully — both successful and no-op cases.
   */
  it("should return structured cancel results", async () => {
    const runtime = createMockRuntime();
    const context = createTestRunContext();

    const prepared = await runtime.prepareRun(context);
    const result = await runtime.cancelRun(prepared.runId);

    expect(result.cancelled).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe("RunContext", () => {
  /**
   * @why Validates that a RunContext with all required fields can be created.
   * This is the input contract for all adapter operations.
   */
  it("should contain all required fields", () => {
    const ctx = createTestRunContext();

    expect(ctx.taskPacket).toBeDefined();
    expect(ctx.taskPacket.packet_type).toBe("task_packet");
    expect(ctx.effectivePolicySnapshot).toBeDefined();
    expect(ctx.effectivePolicySnapshot.policy_snapshot_version).toBe("1.0");
    expect(ctx.workspacePaths).toBeDefined();
    expect(ctx.workspacePaths.worktreePath).toBeTruthy();
    expect(ctx.workspacePaths.artifactRoot).toBeTruthy();
    expect(ctx.workspacePaths.packetInputPath).toBeTruthy();
    expect(ctx.workspacePaths.policySnapshotPath).toBeTruthy();
    expect(ctx.outputSchemaExpectation).toBeDefined();
    expect(ctx.outputSchemaExpectation.packetType).toBeTruthy();
    expect(ctx.timeoutSettings).toBeDefined();
    expect(ctx.timeoutSettings.timeBudgetSeconds).toBeGreaterThan(0);
  });
});

describe("RunStatus", () => {
  /**
   * @why Validates the four terminal statuses are correctly typed.
   * These values drive branching logic in the orchestrator.
   */
  it("should accept all valid status values", () => {
    const statuses: RunStatus[] = ["success", "failed", "partial", "cancelled"];
    expect(statuses).toHaveLength(4);
  });
});

describe("WorkspacePaths", () => {
  /**
   * @why Validates workspace paths structure. These paths are used by
   * adapters to locate inputs and outputs in the filesystem.
   */
  it("should have all required path fields", () => {
    const paths: WorkspacePaths = {
      worktreePath: "/tmp/wt",
      artifactRoot: "/tmp/art",
      packetInputPath: "/tmp/wt/.factory/packet.json",
      policySnapshotPath: "/tmp/wt/.factory/policy.json",
    };

    expect(paths.worktreePath).toBeTruthy();
    expect(paths.artifactRoot).toBeTruthy();
    expect(paths.packetInputPath).toBeTruthy();
    expect(paths.policySnapshotPath).toBeTruthy();
  });
});

describe("TimeoutSettings", () => {
  /**
   * @why Validates timeout settings structure with realistic values.
   * These control worker liveness detection and TTL enforcement.
   */
  it("should have all required timeout fields", () => {
    const settings: TimeoutSettings = {
      timeBudgetSeconds: 3600,
      expiresAt: "2025-01-01T01:00:00Z",
      heartbeatIntervalSeconds: 30,
      missedHeartbeatThreshold: 2,
      gracePeriodSeconds: 15,
    };

    expect(settings.timeBudgetSeconds).toBe(3600);
    expect(settings.heartbeatIntervalSeconds).toBe(30);
    expect(settings.missedHeartbeatThreshold).toBe(2);
    expect(settings.gracePeriodSeconds).toBe(15);
  });
});

describe("FinalizeResult", () => {
  /**
   * @why Validates the terminal result structure contains all fields
   * needed by the orchestrator for status recording and audit.
   */
  it("should contain all required fields for a successful run", () => {
    const result: FinalizeResult = {
      runId: "run-1",
      status: "success",
      packetOutput: { packet_type: "dev_result_packet" },
      artifactPaths: ["/tmp/output.json"],
      logs: [{ timestamp: "2025-01-01T00:00:00Z", stream: "stdout", content: "done" }],
      exitCode: 0,
      durationMs: 1500,
      finalizedAt: "2025-01-01T00:00:01Z",
    };

    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.artifactPaths).toHaveLength(1);
    expect(result.logs).toHaveLength(1);
  });

  /**
   * @why Validates that failed runs can have null exit code and null packet.
   * This is important for runs that are killed before producing output.
   */
  it("should support failed runs with null exit code", () => {
    const result: FinalizeResult = {
      runId: "run-2",
      status: "failed",
      packetOutput: null,
      artifactPaths: [],
      logs: [],
      exitCode: null,
      durationMs: 0,
      finalizedAt: "2025-01-01T00:00:01Z",
    };

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.packetOutput).toBeNull();
  });
});
