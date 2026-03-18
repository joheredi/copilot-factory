/**
 * Tests for the Copilot CLI execution adapter.
 *
 * These tests validate that the {@link CopilotCliAdapter} correctly implements
 * the {@link WorkerRuntime} interface lifecycle: prepareRun → startRun →
 * streamRun → collectArtifacts → finalizeRun (with cancelRun as an
 * alternative path).
 *
 * **Why these tests matter:**
 * The Copilot CLI adapter is the V1 execution backend. Correctness of prompt
 * injection, output capture, schema validation, and lifecycle state management
 * directly impacts whether workers produce usable, auditable results.
 *
 * All tests use fake filesystem and process spawner implementations to avoid
 * real I/O, enabling fast, deterministic, and parallel-safe execution.
 *
 * @see docs/prd/010-integration-contracts.md §10.8
 * @see docs/prd/004-agent-contracts.md §4.4–§4.9
 */

import { describe, it, expect } from "vitest";

import type { TaskPacket, PolicySnapshot } from "@factory/schemas";

import type { FileSystem } from "../workspace/types.js";
import type { RunContext, RunOutputStream, CollectedArtifacts } from "./types.js";
import type { CliProcess, CliProcessSpawner } from "./copilot-cli-adapter.js";
import {
  CopilotCliAdapter,
  generatePrompt,
  extractPacketFromStdout,
  validatePacketSchema,
  hasSessionCompletionMarkers,
  OUTPUT_PACKET_FILENAME,
  PROMPT_FILENAME,
  RESULT_PACKET_START_DELIMITER,
  RESULT_PACKET_END_DELIMITER,
  HEARTBEAT_MARKER,
} from "./copilot-cli-adapter.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a minimal valid TaskPacket for testing.
 *
 * All fields are populated with reasonable defaults that pass schema
 * validation, so tests only need to override what's relevant to them.
 */
function createTestTaskPacket(overrides?: Partial<TaskPacket>): TaskPacket {
  return {
    packet_type: "task_packet",
    schema_version: "1.0",
    created_at: "2025-01-01T00:00:00.000Z",
    task_id: "test-task-001",
    repository_id: "test-repo-001",
    role: "developer",
    time_budget_seconds: 300,
    expires_at: "2025-01-01T00:05:00.000Z",
    task: {
      title: "Implement test feature",
      description: "Add a test feature to the project",
      task_type: "feature",
      priority: "P0",
      severity: "medium",
      acceptance_criteria: ["Feature works correctly", "Tests pass"],
      definition_of_done: ["Code reviewed", "Tests pass"],
      risk_level: "medium",
      suggested_file_scope: ["src/"],
      branch_name: "factory/test-task-001",
    },
    repository: {
      name: "test-repo",
      default_branch: "main",
    },
    workspace: {
      worktree_path: "/workspace/worktree",
      artifact_root: "/workspace/outputs",
    },
    context: {
      related_tasks: [],
      dependencies: [],
      rejection_context: null,
      code_map_refs: [],
      prior_partial_work: null,
    },
    repo_policy: {
      policy_set_id: "default",
    },
    tool_policy: {
      command_policy_id: "default-cmd",
      file_scope_policy_id: "default-fs",
    },
    validation_requirements: {
      profile: "standard",
    },
    stop_conditions: ["All acceptance criteria met", "Time budget exceeded"],
    expected_output: {
      packet_type: "dev_result_packet",
      schema_version: "1.0",
    },
    ...overrides,
  } as TaskPacket;
}

/** Creates a minimal PolicySnapshot for testing. */
function createTestPolicySnapshot(): PolicySnapshot {
  return {
    policy_snapshot_version: "1.0",
    policy_set_id: "test-policy",
  } as PolicySnapshot;
}

/** Creates a valid RunContext for testing. */
function createTestRunContext(overrides?: Partial<RunContext>): RunContext {
  return {
    taskPacket: createTestTaskPacket(),
    effectivePolicySnapshot: createTestPolicySnapshot(),
    workspacePaths: {
      worktreePath: "/workspace/worktree",
      artifactRoot: "/workspace/outputs",
      packetInputPath: "/workspace/inputs/task-packet.json",
      policySnapshotPath: "/workspace/inputs/policy-snapshot.json",
    },
    outputSchemaExpectation: {
      packetType: "dev_result_packet",
      schemaVersion: "1.0",
    },
    timeoutSettings: {
      timeBudgetSeconds: 300,
      expiresAt: "2025-01-01T00:05:00.000Z",
      heartbeatIntervalSeconds: 30,
      missedHeartbeatThreshold: 3,
      gracePeriodSeconds: 10,
    },
    ...overrides,
  };
}

/** Creates a minimal valid DevResultPacket for testing. */
function createTestDevResultPacket(): Record<string, unknown> {
  return {
    packet_type: "dev_result_packet",
    schema_version: "1.0",
    created_at: "2025-01-01T00:04:00.000Z",
    task_id: "test-task-001",
    repository_id: "test-repo-001",
    run_id: "test-run-id",
    status: "success",
    summary: "Implementation complete",
    result: {
      branch_name: "factory/test-task-001",
      commit_sha: "abc123def456",
      files_changed: [{ path: "src/feature.ts", change_type: "added", summary: "New feature" }],
      tests_added_or_updated: ["src/feature.test.ts"],
      validations_run: [
        {
          check_type: "lint",
          tool_name: "eslint",
          command: "pnpm lint",
          status: "passed",
          duration_ms: 1000,
          summary: "No issues found",
        },
      ],
      assumptions: [],
      risks: [],
      unresolved_issues: [],
    },
    artifact_refs: [],
  };
}

/**
 * In-memory fake filesystem for testing.
 *
 * Tracks all file operations so tests can assert on what was written
 * without touching the real filesystem.
 */
class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    this.dirs.add(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
    }
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const prefix = path.endsWith("/") ? path : path + "/";
    const entries = new Map<string, boolean>();

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const slashIndex = rest.indexOf("/");
        if (slashIndex === -1) {
          entries.set(rest, false);
        } else {
          entries.set(rest.slice(0, slashIndex), true);
        }
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix)) {
        const rest = dirPath.slice(prefix.length);
        const slashIndex = rest.indexOf("/");
        if (slashIndex === -1 && rest.length > 0) {
          entries.set(rest, true);
        } else if (slashIndex > 0) {
          entries.set(rest.slice(0, slashIndex), true);
        }
      }
    }

    return Array.from(entries.entries())
      .map(([name, isDirectory]) => ({ name, isDirectory }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Fake CLI process for testing.
 *
 * Allows tests to programmatically emit stdout/stderr data and control
 * when the process exits, simulating various worker behaviors.
 */
class FakeCliProcess implements CliProcess {
  readonly pid = 12345;
  private stdoutListeners: Array<(data: string) => void> = [];
  private stderrListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];
  private killed = false;

  onStdout(listener: (data: string) => void): void {
    this.stdoutListeners.push(listener);
  }

  onStderr(listener: (data: string) => void): void {
    this.stderrListeners.push(listener);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  onError(listener: (err: Error) => void): void {
    this.errorListeners.push(listener);
  }

  kill(_signal?: NodeJS.Signals): boolean {
    if (this.killed) return false;
    this.killed = true;
    return true;
  }

  /** Simulate writing to stdout. */
  emitStdout(data: string): void {
    for (const listener of this.stdoutListeners) {
      listener(data);
    }
  }

  /** Simulate writing to stderr. */
  emitStderr(data: string): void {
    for (const listener of this.stderrListeners) {
      listener(data);
    }
  }

  /** Simulate process exit with given code. */
  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) {
      listener(code);
    }
  }

  /** Simulate a spawn error (e.g. ENOENT). */
  emitError(err: Error): void {
    for (const listener of this.errorListeners) {
      listener(err);
    }
  }
}

/**
 * Creates a process spawner that returns a controllable fake process.
 *
 * Returns both the spawner (for injection into the adapter) and the
 * fake process handle (for test control).
 */
function createFakeProcessSpawner(): {
  spawner: CliProcessSpawner;
  getProcess: () => FakeCliProcess;
  getLastCall: () => {
    command: string;
    args: readonly string[];
    options: { readonly cwd?: string };
  } | null;
} {
  let lastProcess: FakeCliProcess | null = null;
  let lastCall: {
    command: string;
    args: readonly string[];
    options: { readonly cwd?: string };
  } | null = null;

  return {
    spawner: (command, args, options) => {
      const process = new FakeCliProcess();
      lastProcess = process;
      lastCall = { command, args, options };
      return process;
    },
    getProcess: () => {
      if (!lastProcess) throw new Error("No process has been spawned yet");
      return lastProcess;
    },
    getLastCall: () => lastCall,
  };
}

/** Helper to create an adapter with test dependencies. */
function createTestAdapter(config?: { binaryPath?: string; baseArgs?: string[] }): {
  adapter: CopilotCliAdapter;
  fs: FakeFileSystem;
  processSpawner: ReturnType<typeof createFakeProcessSpawner>;
} {
  const fs = new FakeFileSystem();
  const processSpawner = createFakeProcessSpawner();

  const adapter = new CopilotCliAdapter(
    { binaryPath: config?.binaryPath ?? "gh", baseArgs: config?.baseArgs ?? ["copilot", "--"] },
    { fs, processSpawner: processSpawner.spawner },
  );

  return { adapter, fs, processSpawner };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CopilotCliAdapter", () => {
  describe("name", () => {
    /**
     * Validates the adapter identifies itself as "copilot-cli".
     * The name is used for runtime registration, logging, and metrics.
     */
    it("returns 'copilot-cli' as the adapter name", () => {
      const { adapter } = createTestAdapter();
      expect(adapter.name).toBe("copilot-cli");
    });
  });

  describe("prepareRun", () => {
    /**
     * Validates that prepareRun generates a unique run ID, writes workspace
     * files (task packet, policy snapshot, prompt), and returns a PreparedRun
     * with correct metadata.
     *
     * This is critical because the workspace setup determines what context
     * the worker receives — incorrect mounting means wrong behavior.
     */
    it("writes task packet, policy snapshot, and prompt to workspace", async () => {
      const { adapter, fs } = createTestAdapter();
      const context = createTestRunContext();

      const prepared = await adapter.prepareRun(context);

      // Verify run ID was generated
      expect(prepared.runId).toBeTruthy();
      expect(prepared.runId.length).toBeGreaterThan(0);

      // Verify task packet was written
      expect(fs.files.has(context.workspacePaths.packetInputPath)).toBe(true);
      const writtenPacket = JSON.parse(fs.files.get(context.workspacePaths.packetInputPath)!);
      expect(writtenPacket.task_id).toBe("test-task-001");

      // Verify policy snapshot was written
      expect(fs.files.has(context.workspacePaths.policySnapshotPath)).toBe(true);
      const writtenPolicy = JSON.parse(fs.files.get(context.workspacePaths.policySnapshotPath)!);
      expect(writtenPolicy.policy_set_id).toBe("test-policy");

      // Verify prompt was written to artifact root
      const promptPath = `/workspace/outputs/${PROMPT_FILENAME}`;
      expect(fs.files.has(promptPath)).toBe(true);

      // Verify PreparedRun metadata
      expect(prepared.context).toBe(context);
      expect(prepared.preparedAt).toBeTruthy();
    });

    /**
     * Validates that each prepareRun call generates a unique run ID,
     * enabling multiple concurrent runs on the same adapter instance.
     */
    it("generates unique run IDs for multiple runs", async () => {
      const { adapter } = createTestAdapter();

      const run1 = await adapter.prepareRun(createTestRunContext());
      const run2 = await adapter.prepareRun(createTestRunContext());

      expect(run1.runId).not.toBe(run2.runId);
    });
  });

  describe("startRun", () => {
    /**
     * Validates that startRun spawns a CLI process with the correct binary,
     * arguments (including -p with prompt content), and working directory.
     *
     * This ensures the worker receives the right prompt and executes in
     * the correct workspace context.
     */
    it("spawns the CLI process with correct arguments and cwd", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const context = createTestRunContext();
      const prepared = await adapter.prepareRun(context);

      await adapter.startRun(prepared.runId);

      const call = processSpawner.getLastCall();
      expect(call).not.toBeNull();
      expect(call!.command).toBe("gh");
      expect(call!.args).toContain("copilot");
      expect(call!.args).toContain("--");
      expect(call!.args).toContain("-p");
      expect(call!.args).toContain("--allow-all-tools");
      expect(call!.options.cwd).toBe(context.workspacePaths.worktreePath);
    });

    /**
     * Validates that custom binary path and base args are used when
     * configured, supporting non-standard CLI installations.
     */
    it("uses custom binary path and base args from config", async () => {
      const { adapter, processSpawner } = createTestAdapter({
        binaryPath: "/usr/local/bin/copilot",
        baseArgs: ["run", "--mode", "worker"],
      });
      const prepared = await adapter.prepareRun(createTestRunContext());

      await adapter.startRun(prepared.runId);

      const call = processSpawner.getLastCall();
      expect(call!.command).toBe("/usr/local/bin/copilot");
      expect(call!.args[0]).toBe("run");
      expect(call!.args[1]).toBe("--mode");
      expect(call!.args[2]).toBe("worker");
    });

    /**
     * Validates that starting an already-started run throws an error.
     * Each run must be started exactly once per the WorkerRuntime contract.
     */
    it("throws if the run is already started", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());

      await adapter.startRun(prepared.runId);

      // Complete the process so it's not stuck
      processSpawner.getProcess().emitExit(0);

      await expect(adapter.startRun(prepared.runId)).rejects.toThrow(
        /Cannot start run.*expected phase "prepared"/,
      );
    });

    /**
     * Validates that starting an unknown run ID throws.
     * Prevents callers from using stale or fabricated run IDs.
     */
    it("throws for unknown run ID", async () => {
      const { adapter } = createTestAdapter();

      await expect(adapter.startRun("nonexistent")).rejects.toThrow(/Unknown run ID/);
    });

    /**
     * Validates that a spawn error (e.g. ENOENT when binary is missing) is
     * handled gracefully instead of crashing the process. The error should
     * be captured as stderr output and the run should complete with failure.
     */
    it("handles spawn ENOENT error without crashing", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());

      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();

      // Simulate ENOENT error (binary not found)
      const enoentError = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      process.emitError(enoentError);

      // Stream should complete (not hang)
      const events: RunOutputStream[] = [];
      for await (const event of adapter.streamRun(prepared.runId)) {
        events.push(event);
      }

      // Error captured as stderr event
      expect(events.some((e) => e.type === "stderr" && e.content.includes("ENOENT"))).toBe(true);

      // Finalize produces a failed result
      const artifacts = await adapter.collectArtifacts(prepared.runId);
      expect(artifacts.packetValid).toBe(false);

      const result = await adapter.finalizeRun(prepared.runId);
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(-1);
      expect(result.logs.some((l) => l.content.includes("spawn gh ENOENT"))).toBe(true);
    });
  });

  describe("streamRun", () => {
    /**
     * Validates that stdout and stderr from the worker process are emitted
     * as typed RunOutputStream events through the async iterable.
     *
     * This is critical for live monitoring and heartbeat tracking.
     */
    it("yields stdout and stderr events from the process", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();

      // Emit some output then exit
      process.emitStdout("Hello from worker\n");
      process.emitStderr("Warning: something\n");
      process.emitExit(0);

      // Collect all events
      const events: RunOutputStream[] = [];
      for await (const event of adapter.streamRun(prepared.runId)) {
        events.push(event);
      }

      // Should have stdout + stderr events
      const stdoutEvents = events.filter((e) => e.type === "stdout");
      const stderrEvents = events.filter((e) => e.type === "stderr");

      expect(stdoutEvents.length).toBeGreaterThanOrEqual(1);
      expect(stdoutEvents[0]!.content).toContain("Hello from worker");
      expect(stderrEvents.length).toBeGreaterThanOrEqual(1);
      expect(stderrEvents[0]!.content).toContain("Warning: something");
    });

    /**
     * Validates that heartbeat markers in stdout are detected and emitted
     * as heartbeat-type events for lease renewal tracking.
     */
    it("detects heartbeat markers and emits heartbeat events", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();

      process.emitStdout(`Working...\n${HEARTBEAT_MARKER}\nStill working...\n`);
      process.emitExit(0);

      const events: RunOutputStream[] = [];
      for await (const event of adapter.streamRun(prepared.runId)) {
        events.push(event);
      }

      const heartbeats = events.filter((e) => e.type === "heartbeat");
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Validates that streamRun throws on a run that was never started.
     */
    it("throws if the run has not been started", async () => {
      const { adapter } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());

      await expect(async () => {
        for await (const _event of adapter.streamRun(prepared.runId)) {
          // should throw
        }
      }).rejects.toThrow(/run has not been started/);
    });
  });

  describe("cancelRun", () => {
    /**
     * Validates that cancelling a running process sends a kill signal
     * and returns { cancelled: true }.
     */
    it("kills the process and returns cancelled: true", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();

      // Simulate the process exiting after being killed
      setTimeout(() => process.emitExit(null), 10);

      const result = await adapter.cancelRun(prepared.runId);

      expect(result.cancelled).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    /**
     * Validates that cancelling a non-running run (completed, prepared)
     * returns { cancelled: false } with a reason.
     */
    it("returns cancelled: false for a non-running run", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      // Complete the run first
      processSpawner.getProcess().emitExit(0);
      // Wait for exit to process
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.cancelRun(prepared.runId);

      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain("not running");
    });

    /**
     * Validates that cancelling a prepared (not yet started) run
     * returns cancelled: false.
     */
    it("returns cancelled: false for a prepared run", async () => {
      const { adapter } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());

      const result = await adapter.cancelRun(prepared.runId);

      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain("not running");
    });
  });

  describe("collectArtifacts", () => {
    /**
     * Validates that when the worker writes a valid output packet file,
     * collectArtifacts reads it, validates against the expected schema,
     * and returns packetValid: true.
     *
     * This is the primary success path — file-based structured output.
     */
    it("reads and validates the output packet from file", async () => {
      const { adapter, fs, processSpawner } = createTestAdapter();
      const context = createTestRunContext();
      const prepared = await adapter.prepareRun(context);
      await adapter.startRun(prepared.runId);

      // Write the output packet file
      const outputPath = `/workspace/outputs/${OUTPUT_PACKET_FILENAME}`;
      const packetData = createTestDevResultPacket();
      fs.files.set(outputPath, JSON.stringify(packetData));

      // Complete the process
      processSpawner.getProcess().emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const artifacts = await adapter.collectArtifacts(prepared.runId);

      expect(artifacts.packetValid).toBe(true);
      expect(artifacts.packetOutput).not.toBeNull();
      expect((artifacts.packetOutput as Record<string, unknown>).packet_type).toBe(
        "dev_result_packet",
      );
      expect(artifacts.validationErrors).toHaveLength(0);
      expect(artifacts.artifactPaths).toContain(outputPath);
    });

    /**
     * Validates the delimiter-based fallback: when no output file exists,
     * the adapter extracts the JSON packet from stdout using delimiters.
     *
     * This is important because some CLI modes may not write files directly
     * but emit structured output inline.
     */
    it("falls back to stdout delimiter extraction when no file exists", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const context = createTestRunContext();
      const prepared = await adapter.prepareRun(context);
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();
      const packetData = createTestDevResultPacket();
      const packetJson = JSON.stringify(packetData);

      // Emit the packet via stdout delimiters
      process.emitStdout(
        `Working...\n${RESULT_PACKET_START_DELIMITER}\n${packetJson}\n${RESULT_PACKET_END_DELIMITER}\nDone.\n`,
      );
      process.emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const artifacts = await adapter.collectArtifacts(prepared.runId);

      expect(artifacts.packetValid).toBe(true);
      expect(artifacts.packetOutput).not.toBeNull();
      expect((artifacts.packetOutput as Record<string, unknown>).packet_type).toBe(
        "dev_result_packet",
      );
    });

    /**
     * Validates that when no output packet is found (neither file nor
     * stdout delimiters), the adapter returns packetValid: false with
     * an appropriate error.
     */
    it("returns packetValid: false when no packet is found", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      processSpawner.getProcess().emitStdout("No structured output here\n");
      processSpawner.getProcess().emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const artifacts = await adapter.collectArtifacts(prepared.runId);

      expect(artifacts.packetValid).toBe(false);
      expect(artifacts.packetOutput).toBeNull();
      expect(artifacts.validationErrors.length).toBeGreaterThan(0);
      expect(artifacts.validationErrors[0]).toContain("No structured output packet found");
    });

    /**
     * Validates that an invalid packet (present but schema-invalid) is
     * detected and reported with specific validation errors.
     *
     * PRD 010 §10.8.5 requires rejection of schema-invalid packets.
     */
    it("returns packetValid: false for schema-invalid packets", async () => {
      const { adapter, fs, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      // Write an invalid packet (missing required fields)
      const outputPath = `/workspace/outputs/${OUTPUT_PACKET_FILENAME}`;
      fs.files.set(outputPath, JSON.stringify({ packet_type: "dev_result_packet" }));

      processSpawner.getProcess().emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const artifacts = await adapter.collectArtifacts(prepared.runId);

      expect(artifacts.packetValid).toBe(false);
      expect(artifacts.validationErrors.length).toBeGreaterThan(0);
    });

    /**
     * Validates that collectArtifacts throws when the run is still running.
     * Artifacts can only be collected after the process exits.
     */
    it("throws if the worker is still running", async () => {
      const { adapter } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      // Don't emit exit — process is still running
      await expect(adapter.collectArtifacts(prepared.runId)).rejects.toThrow(
        /worker is still running/,
      );
    });

    /**
     * Validates that collectArtifacts throws for a run that was never started.
     */
    it("throws if the run was never started", async () => {
      const { adapter } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());

      await expect(adapter.collectArtifacts(prepared.runId)).rejects.toThrow(
        /run was never started/,
      );
    });
  });

  describe("finalizeRun", () => {
    /**
     * Validates the full success path: process exits 0, valid packet
     * → status "success", logs captured, duration computed.
     *
     * This is the happy path that produces a usable worker result.
     */
    it("produces status 'success' for exit code 0 with valid packet", async () => {
      const { adapter, fs, processSpawner } = createTestAdapter();
      const context = createTestRunContext();
      const prepared = await adapter.prepareRun(context);
      await adapter.startRun(prepared.runId);

      // Write valid output
      const outputPath = `/workspace/outputs/${OUTPUT_PACKET_FILENAME}`;
      fs.files.set(outputPath, JSON.stringify(createTestDevResultPacket()));

      const process = processSpawner.getProcess();
      process.emitStdout("Implementation complete\n");
      process.emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.runId).toBe(prepared.runId);
      expect(result.status).toBe("success");
      expect(result.packetOutput).not.toBeNull();
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.finalizedAt).toBeTruthy();
      expect(result.logs.length).toBeGreaterThan(0);
    });

    /**
     * Validates that exit code 0 with an invalid/missing packet produces
     * status "partial" — the worker ran but didn't produce valid output.
     */
    it("produces status 'partial' for exit code 0 with missing packet", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      processSpawner.getProcess().emitStdout("Worked but no packet\n");
      processSpawner.getProcess().emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("partial");
      expect(result.packetOutput).toBeNull();
    });

    /**
     * Validates that a non-zero exit code produces status "failed".
     */
    it("produces status 'failed' for non-zero exit code", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      processSpawner.getProcess().emitStderr("Error: something went wrong\n");
      processSpawner.getProcess().emitExit(1);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(1);
    });

    /**
     * Validates that a cancelled run produces status "cancelled".
     */
    it("produces status 'cancelled' for cancelled runs", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      // Cancel and simulate exit
      setTimeout(() => processSpawner.getProcess().emitExit(null), 10);
      await adapter.cancelRun(prepared.runId);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("cancelled");
      expect(result.exitCode).toBeNull();
    });

    /**
     * Validates that a killed process (exit code null) produces "failed".
     */
    it("produces status 'failed' for killed process (null exit code)", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      processSpawner.getProcess().emitExit(null);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBeNull();
    });

    /**
     * Validates that a non-zero exit code with a valid result packet still
     * produces status "success". The Copilot CLI may exit with non-zero
     * codes even after completing work successfully.
     */
    it("produces status 'success' for non-zero exit code with valid packet", async () => {
      const { adapter, fs, processSpawner } = createTestAdapter();
      const context = createTestRunContext();
      const prepared = await adapter.prepareRun(context);
      await adapter.startRun(prepared.runId);

      // Write valid output packet
      const outputPath = `/workspace/outputs/${OUTPUT_PACKET_FILENAME}`;
      fs.files.set(outputPath, JSON.stringify(createTestDevResultPacket()));

      // Simulate Copilot CLI session summary followed by non-zero exit
      const process = processSpawner.getProcess();
      process.emitStdout("Implementation complete\n");
      process.emitStdout("Total session time: 8m 13s\n");
      process.emitStdout("Total code changes: +349 -0\n");
      process.emitExit(1);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("success");
      expect(result.packetOutput).not.toBeNull();
      expect(result.exitCode).toBe(1);
    });

    /**
     * Validates that a non-zero exit code with no valid packet but with
     * session completion markers produces "partial" instead of "failed".
     * This covers the case where the Copilot CLI completed its work but
     * didn't produce a structured result packet.
     */
    it("produces status 'partial' for non-zero exit code with session completion markers", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      // Simulate Copilot CLI session summary (no packet file written)
      const process = processSpawner.getProcess();
      process.emitStdout("Working on implementation...\n");
      process.emitStdout("Total usage est: 6 Premium requests\n");
      process.emitStdout("Total session time: 8m 13s\n");
      process.emitStdout("Total code changes: +349 -0\n");
      process.emitExit(1);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("partial");
      expect(result.packetOutput).toBeNull();
      expect(result.exitCode).toBe(1);
    });

    /**
     * Validates that a non-zero exit code with no valid packet and no
     * session completion markers still produces "failed" (regression guard).
     */
    it("produces status 'failed' for non-zero exit code without completion markers", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();
      process.emitStderr("Fatal error: connection refused\n");
      process.emitExit(1);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(1);
    });

    /**
     * Validates that finalization cleans up run state so that
     * subsequent calls with the same run ID throw.
     */
    it("cleans up run state after finalization", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      processSpawner.getProcess().emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      await adapter.finalizeRun(prepared.runId);

      // Run state should be gone
      await expect(adapter.finalizeRun(prepared.runId)).rejects.toThrow(/Unknown run ID/);
    });

    /**
     * Validates that logs from both stdout and stderr are included
     * in the finalize result.
     */
    it("includes logs from stdout and stderr", async () => {
      const { adapter, processSpawner } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();
      process.emitStdout("stdout message\n");
      process.emitStderr("stderr message\n");
      process.emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      const result = await adapter.finalizeRun(prepared.runId);

      const stdoutLogs = result.logs.filter((l) => l.stream === "stdout");
      const stderrLogs = result.logs.filter((l) => l.stream === "stderr");

      expect(stdoutLogs.length).toBeGreaterThanOrEqual(1);
      expect(stderrLogs.length).toBeGreaterThanOrEqual(1);
      expect(stdoutLogs[0]!.content).toContain("stdout message");
      expect(stderrLogs[0]!.content).toContain("stderr message");
    });

    /**
     * Validates that finalizing a still-running process throws.
     */
    it("throws if the worker is still running", async () => {
      const { adapter } = createTestAdapter();
      const prepared = await adapter.prepareRun(createTestRunContext());
      await adapter.startRun(prepared.runId);

      await expect(adapter.finalizeRun(prepared.runId)).rejects.toThrow(/worker is still running/);
    });
  });

  describe("full lifecycle", () => {
    /**
     * Validates the complete happy-path lifecycle end-to-end:
     * prepare → start → stream → collect → finalize.
     *
     * This integration test ensures all lifecycle phases work together
     * correctly and that data flows through the pipeline intact.
     */
    it("completes a full run lifecycle successfully", async () => {
      const { adapter, fs, processSpawner } = createTestAdapter();
      const context = createTestRunContext();

      // Phase 1: Prepare
      const prepared = await adapter.prepareRun(context);
      expect(prepared.runId).toBeTruthy();

      // Phase 2: Start
      await adapter.startRun(prepared.runId);

      const process = processSpawner.getProcess();
      const packetData = createTestDevResultPacket();

      // Simulate worker output
      process.emitStdout("Starting implementation...\n");
      process.emitStdout(`${HEARTBEAT_MARKER}\n`);
      process.emitStdout("Implementation complete.\n");

      // Write output file
      const outputPath = `/workspace/outputs/${OUTPUT_PACKET_FILENAME}`;
      fs.files.set(outputPath, JSON.stringify(packetData));

      // Process exits successfully
      process.emitExit(0);
      await new Promise((r) => setTimeout(r, 20));

      // Phase 3: Stream (after completion — replays events)
      const events: RunOutputStream[] = [];
      for await (const event of adapter.streamRun(prepared.runId)) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThan(0);

      // Phase 4: Collect
      const artifacts: CollectedArtifacts = await adapter.collectArtifacts(prepared.runId);
      expect(artifacts.packetValid).toBe(true);

      // Phase 5: Finalize
      const result = await adapter.finalizeRun(prepared.runId);
      expect(result.status).toBe("success");
      expect(result.exitCode).toBe(0);
      expect(result.logs.length).toBeGreaterThan(0);
    });
  });
});

// ─── Unit tests for exported utility functions ───────────────────────────────

describe("generatePrompt", () => {
  /**
   * Validates that the prompt includes role-specific instructions
   * based on the task packet's role field.
   *
   * Each agent role has different behavioral expectations (PRD 004).
   */
  it("includes role-specific instructions for developer role", () => {
    const context = createTestRunContext();
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("Developer agent");
    expect(prompt).toContain("implement the task");
  });

  it("includes role-specific instructions for reviewer role", () => {
    const context = createTestRunContext({
      taskPacket: createTestTaskPacket({ role: "reviewer" }),
    });
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("Specialist Reviewer");
    expect(prompt).toContain("review the developer");
  });

  it("includes role-specific instructions for lead-reviewer role", () => {
    const context = createTestRunContext({
      taskPacket: createTestTaskPacket({ role: "lead-reviewer" }),
    });
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("Lead Reviewer");
    expect(prompt).toContain("consolidate");
  });

  it("includes role-specific instructions for merge-assist role", () => {
    const context = createTestRunContext({
      taskPacket: createTestTaskPacket({ role: "merge-assist" }),
    });
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("Merge Assist");
    expect(prompt).toContain("conflict");
  });

  it("includes role-specific instructions for post-merge-analysis role", () => {
    const context = createTestRunContext({
      taskPacket: createTestTaskPacket({ role: "post-merge-analysis" }),
    });
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("Post-Merge Analysis");
    expect(prompt).toContain("post-merge validation failures");
  });

  it("includes role-specific instructions for planner role", () => {
    const context = createTestRunContext({
      taskPacket: createTestTaskPacket({ role: "planner" }),
    });
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("Task Planner");
    expect(prompt).toContain("backlog");
  });

  /**
   * Validates that the prompt includes the task details, workspace paths,
   * output expectations, time constraints, and stop conditions.
   */
  it("includes task context, output path, and constraints", () => {
    const context = createTestRunContext();
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain("test-task-001");
    expect(prompt).toContain("Implement test feature");
    expect(prompt).toContain("/workspace/worktree");
    expect(prompt).toContain("/output/result-packet.json");
    expect(prompt).toContain("dev_result_packet");
    expect(prompt).toContain("300 seconds");
    expect(prompt).toContain("All acceptance criteria met");
  });

  /**
   * Validates that the prompt includes output delimiters so the worker
   * knows how to emit inline structured output.
   */
  it("includes result packet delimiters", () => {
    const context = createTestRunContext();
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain(RESULT_PACKET_START_DELIMITER);
    expect(prompt).toContain(RESULT_PACKET_END_DELIMITER);
  });

  /**
   * Validates that the prompt includes the heartbeat marker instruction.
   */
  it("includes heartbeat marker instruction", () => {
    const context = createTestRunContext();
    const prompt = generatePrompt(context, "/output/result-packet.json");

    expect(prompt).toContain(HEARTBEAT_MARKER);
  });
});

describe("extractPacketFromStdout", () => {
  /**
   * Validates successful extraction of a JSON packet from delimited stdout.
   */
  it("extracts JSON between delimiters", () => {
    const packet = { packet_type: "test", data: "value" };
    const stdout = [
      "Some output",
      RESULT_PACKET_START_DELIMITER,
      JSON.stringify(packet),
      RESULT_PACKET_END_DELIMITER,
      "More output",
    ].join("\n");

    const result = extractPacketFromStdout(stdout);

    expect(result).toEqual(packet);
  });

  /**
   * Validates that missing delimiters return null.
   */
  it("returns null when no delimiters are present", () => {
    expect(extractPacketFromStdout("No delimiters here")).toBeNull();
  });

  /**
   * Validates that a start delimiter without matching end returns null.
   */
  it("returns null when end delimiter is missing", () => {
    const stdout = `${RESULT_PACKET_START_DELIMITER}\n{"data": "value"}`;
    expect(extractPacketFromStdout(stdout)).toBeNull();
  });

  /**
   * Validates that invalid JSON between delimiters returns null.
   */
  it("returns null for invalid JSON between delimiters", () => {
    const stdout = `${RESULT_PACKET_START_DELIMITER}\nnot valid json\n${RESULT_PACKET_END_DELIMITER}`;
    expect(extractPacketFromStdout(stdout)).toBeNull();
  });

  /**
   * Validates that empty content between delimiters returns null.
   */
  it("returns null for empty content between delimiters", () => {
    const stdout = `${RESULT_PACKET_START_DELIMITER}\n${RESULT_PACKET_END_DELIMITER}`;
    expect(extractPacketFromStdout(stdout)).toBeNull();
  });
});

describe("validatePacketSchema", () => {
  /**
   * Validates that a correct dev_result_packet passes schema validation.
   */
  it("validates a correct dev_result_packet", () => {
    const result = validatePacketSchema(createTestDevResultPacket(), "dev_result_packet");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  /**
   * Validates that an incomplete packet fails schema validation with errors.
   */
  it("rejects an incomplete packet with validation errors", () => {
    const result = validatePacketSchema({ packet_type: "dev_result_packet" }, "dev_result_packet");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * Validates that an unknown packet type returns an error.
   */
  it("returns error for unknown packet type", () => {
    const result = validatePacketSchema({}, "unknown_packet_type");

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("No schema registered");
  });

  /**
   * Validates that review_packet schema validation works.
   * Ensures the schema registry covers multiple packet types.
   */
  it("validates review_packet schema", () => {
    const reviewPacket = {
      packet_type: "review_packet",
      schema_version: "1.0",
      created_at: "2025-01-01T00:00:00.000Z",
      task_id: "task-1",
      repository_id: "repo-1",
      review_cycle_id: "rc-1",
      reviewer_pool_id: "pool-1",
      reviewer_type: "security",
      verdict: "approved",
      summary: "Looks good",
      blocking_issues: [],
      non_blocking_issues: [],
      confidence: "high",
      follow_up_task_refs: [],
      risks: [],
      open_questions: [],
    };

    const result = validatePacketSchema(reviewPacket, "review_packet");
    expect(result.valid).toBe(true);
  });

  /**
   * Validates schema registry coverage — all expected packet types
   * should have a registered schema.
   */
  it("has schemas registered for all output packet types", () => {
    const expectedTypes = [
      "dev_result_packet",
      "review_packet",
      "lead_review_decision_packet",
      "merge_packet",
      "merge_assist_packet",
      "validation_result_packet",
      "post_merge_analysis_packet",
    ];

    for (const type of expectedTypes) {
      const result = validatePacketSchema({}, type);
      // Should fail validation (empty object) but NOT with "No schema registered"
      expect(result.valid).toBe(false);
      expect(result.errors[0]).not.toContain("No schema registered");
    }
  });
});

// ─── Unit tests for hasSessionCompletionMarkers ──────────────────────────────

describe("hasSessionCompletionMarkers", () => {
  /**
   * Validates detection of "Total session time:" marker.
   */
  it("returns true when stdout contains 'Total session time:'", () => {
    const stdout =
      "Working on task...\nTotal usage est: 6 Premium requests\nTotal session time: 8m 13s\n";
    expect(hasSessionCompletionMarkers(stdout)).toBe(true);
  });

  /**
   * Validates detection of "Total code changes:" marker.
   */
  it("returns true when stdout contains 'Total code changes:'", () => {
    const stdout = "Implementation complete\nTotal code changes: +349 -0\n";
    expect(hasSessionCompletionMarkers(stdout)).toBe(true);
  });

  /**
   * Validates that both markers together are detected.
   */
  it("returns true when stdout contains both markers", () => {
    const stdout = "Total session time: 8m 13s\nTotal code changes: +349 -0\n";
    expect(hasSessionCompletionMarkers(stdout)).toBe(true);
  });

  /**
   * Validates that stdout without markers returns false.
   */
  it("returns false when stdout has no completion markers", () => {
    const stdout = "Error: something went wrong\nFatal: connection refused\n";
    expect(hasSessionCompletionMarkers(stdout)).toBe(false);
  });

  /**
   * Validates that an empty string returns false.
   */
  it("returns false for empty stdout", () => {
    expect(hasSessionCompletionMarkers("")).toBe(false);
  });
});
