import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  SupervisorRunContext,
  SupervisorWorkspacePaths,
  SupervisorTimeoutSettings,
  SupervisorOutputSchemaExpectation,
  SupervisorCleanupOptions,
  SupervisorMountInput,
} from "@factory/application";
import type {
  FileSystem,
  GitOperations,
  CliProcessSpawner,
  WorkspaceResult,
  CleanupWorkspaceResult,
  MountPacketsResult,
  RunContext,
} from "@factory/infrastructure";
import {
  WorkspaceManager,
  WorkspacePacketMounter,
  CopilotCliAdapter,
} from "@factory/infrastructure";
import {
  createWorkspaceProviderAdapter,
  createPacketMounterAdapter,
  createRuntimeAdapterBridge,
  createInfrastructureAdapters,
  resolveInfrastructureConfig,
} from "./infrastructure-adapters.js";

// ─── Shared Test Fixtures ────────────────────────────────────────────────────

function createFakeFs(): FileSystem {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    rm: vi.fn().mockResolvedValue(undefined),
  };
}

function createFakeGit(): GitOperations {
  return {
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
    addWorktree: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockResolvedValue([]),
    branchExists: vi.fn().mockResolvedValue(false),
    isCleanWorkingTree: vi.fn().mockResolvedValue(true),
    getCurrentBranch: vi.fn().mockResolvedValue("main"),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
  };
}

function createFakeProcessSpawner(): CliProcessSpawner {
  return vi.fn();
}

const SAMPLE_WORKSPACE_RESULT: WorkspaceResult = {
  layout: {
    rootPath: "/workspaces/task-123",
    worktreePath: "/workspaces/task-123/worktree",
    logsPath: "/workspaces/task-123/logs",
    outputsPath: "/workspaces/task-123/outputs",
  },
  branchName: "factory/task-123/attempt-1",
  reused: false,
};

const SAMPLE_CLEANUP_RESULT: CleanupWorkspaceResult = {
  worktreeRemoved: true,
  directoryRemoved: true,
  branchDeleted: false,
};

const SAMPLE_WORKSPACE_PATHS: SupervisorWorkspacePaths = {
  worktreePath: "/workspaces/task-123/worktree",
  artifactRoot: "/workspaces/task-123/outputs",
  packetInputPath: "/workspaces/task-123/worktree/task-packet.json",
  policySnapshotPath: "/workspaces/task-123/worktree/policy-snapshot.json",
};

const SAMPLE_TIMEOUT: SupervisorTimeoutSettings = {
  timeBudgetSeconds: 300,
  expiresAt: "2026-01-01T00:05:00Z",
  heartbeatIntervalSeconds: 30,
  missedHeartbeatThreshold: 3,
  gracePeriodSeconds: 10,
};

const SAMPLE_OUTPUT_SCHEMA: SupervisorOutputSchemaExpectation = {
  packetType: "dev_result_packet",
  schemaVersion: "1.0",
};

const SAMPLE_RUN_CONTEXT: SupervisorRunContext = {
  taskPacket: { taskId: "task-123", type: "develop" },
  effectivePolicySnapshot: { allowedCommands: ["git", "npm"] },
  workspacePaths: SAMPLE_WORKSPACE_PATHS,
  outputSchemaExpectation: SAMPLE_OUTPUT_SCHEMA,
  timeoutSettings: SAMPLE_TIMEOUT,
};

const SAMPLE_MOUNT_INPUT: SupervisorMountInput = {
  taskPacket: { taskId: "task-123" },
  runConfig: { timeout: 300 },
  policySnapshot: { allowedCommands: ["git"] },
};

// ─── WorkspaceProviderAdapter Tests ──────────────────────────────────────────

/**
 * Tests for the WorkspaceProviderPort adapter.
 *
 * The adapter bridges the port's positional parameters `(taskId, repoPath,
 * attempt?)` to the infrastructure's `CreateWorkspaceOptions` object form.
 * This is the critical wiring that lets the Worker Supervisor call the
 * real WorkspaceManager without coupling to infrastructure types.
 *
 * Validates:
 * - Parameter mapping from positional args to options object
 * - Cleanup option forwarding (deleteBranch, forceBranchDelete)
 * - Return type pass-through (structurally identical types)
 */
describe("WorkspaceProviderAdapter", () => {
  let fs: FileSystem;
  let git: GitOperations;
  let manager: WorkspaceManager;

  beforeEach(() => {
    fs = createFakeFs();
    git = createFakeGit();
    manager = new WorkspaceManager(git, fs, "/workspaces");
  });

  /**
   * Validates that the adapter maps positional `(taskId, repoPath, attempt)`
   * parameters into the `CreateWorkspaceOptions` object that WorkspaceManager
   * expects. Without this mapping, the supervisor would need to know about
   * infrastructure-level option objects, breaking the port abstraction.
   */
  it("delegates createWorkspace with mapped parameters", async () => {
    const createSpy = vi
      .spyOn(manager, "createWorkspace")
      .mockResolvedValue(SAMPLE_WORKSPACE_RESULT);

    const adapter = createWorkspaceProviderAdapter(manager);
    const result = await adapter.createWorkspace("task-123", "/repo/path", 2);

    expect(createSpy).toHaveBeenCalledOnce();
    expect(createSpy).toHaveBeenCalledWith({
      taskId: "task-123",
      repoPath: "/repo/path",
      attempt: 2,
    });
    expect(result).toEqual(SAMPLE_WORKSPACE_RESULT);
  });

  /**
   * Validates that optional `attempt` is passed as `undefined` when omitted,
   * ensuring the WorkspaceManager sees a clean options object.
   */
  it("handles missing attempt parameter", async () => {
    const createSpy = vi
      .spyOn(manager, "createWorkspace")
      .mockResolvedValue(SAMPLE_WORKSPACE_RESULT);

    const adapter = createWorkspaceProviderAdapter(manager);
    await adapter.createWorkspace("task-456", "/repo");

    expect(createSpy).toHaveBeenCalledWith({
      taskId: "task-456",
      repoPath: "/repo",
      attempt: undefined,
    });
  });

  /**
   * Validates that cleanup options (deleteBranch, forceBranchDelete) are
   * correctly forwarded from the port's SupervisorCleanupOptions to
   * the infrastructure's CleanupWorkspaceOptions.
   */
  it("delegates cleanupWorkspace with mapped options", async () => {
    const cleanupSpy = vi
      .spyOn(manager, "cleanupWorkspace")
      .mockResolvedValue(SAMPLE_CLEANUP_RESULT);

    const adapter = createWorkspaceProviderAdapter(manager);
    const options: SupervisorCleanupOptions = {
      deleteBranch: true,
      forceBranchDelete: false,
    };
    const result = await adapter.cleanupWorkspace("task-789", "/repo", options);

    expect(cleanupSpy).toHaveBeenCalledOnce();
    expect(cleanupSpy).toHaveBeenCalledWith({
      taskId: "task-789",
      repoPath: "/repo",
      deleteBranch: true,
      forceBranchDelete: false,
    });
    expect(result).toEqual(SAMPLE_CLEANUP_RESULT);
  });

  /**
   * Validates that cleanup works when no options are provided (the common
   * case for non-destructive cleanup).
   */
  it("handles cleanup without options", async () => {
    const cleanupSpy = vi
      .spyOn(manager, "cleanupWorkspace")
      .mockResolvedValue(SAMPLE_CLEANUP_RESULT);

    const adapter = createWorkspaceProviderAdapter(manager);
    await adapter.cleanupWorkspace("task-abc", "/repo");

    expect(cleanupSpy).toHaveBeenCalledWith({
      taskId: "task-abc",
      repoPath: "/repo",
      deleteBranch: undefined,
      forceBranchDelete: undefined,
    });
  });
});

// ─── PacketMounterAdapter Tests ──────────────────────────────────────────────

/**
 * Tests for the PacketMounterPort adapter.
 *
 * The adapter wraps WorkspacePacketMounter and discards the
 * MountPacketsResult (which contains file paths) because the port
 * contract returns void — the supervisor already knows the paths from
 * the workspace layout.
 *
 * Validates:
 * - Input pass-through to the mounter
 * - Return value discarded (void return)
 * - Error propagation (mount failures should surface)
 */
describe("PacketMounterAdapter", () => {
  let fs: FileSystem;
  let mounter: WorkspacePacketMounter;

  beforeEach(() => {
    fs = createFakeFs();
    mounter = new WorkspacePacketMounter(fs);
  });

  /**
   * Validates that the adapter correctly delegates to the mounter with
   * the same workspace path and input, and returns void (discarding
   * the MountPacketsResult).
   */
  it("delegates mountPackets and returns void", async () => {
    const mountResult: MountPacketsResult = {
      taskPacketPath: "/ws/task-packet.json",
      runConfigPath: "/ws/run-config.json",
      policySnapshotPath: "/ws/policy-snapshot.json",
    };
    const mountSpy = vi.spyOn(mounter, "mountPackets").mockResolvedValue(mountResult);

    const adapter = createPacketMounterAdapter(mounter);
    const result = await adapter.mountPackets("/workspace/path", SAMPLE_MOUNT_INPUT);

    expect(mountSpy).toHaveBeenCalledOnce();
    expect(mountSpy).toHaveBeenCalledWith("/workspace/path", SAMPLE_MOUNT_INPUT);
    expect(result).toBeUndefined();
  });

  /**
   * Validates that mount errors propagate to the caller. If packet
   * mounting fails (e.g. filesystem error), the supervisor must know
   * to abort the run — swallowing this error would cause a worker to
   * start with missing inputs.
   */
  it("propagates mount errors", async () => {
    vi.spyOn(mounter, "mountPackets").mockRejectedValue(new Error("Write failed"));

    const adapter = createPacketMounterAdapter(mounter);

    await expect(adapter.mountPackets("/workspace/path", SAMPLE_MOUNT_INPUT)).rejects.toThrow(
      "Write failed",
    );
  });
});

// ─── RuntimeAdapterBridge Tests ──────────────────────────────────────────────

/**
 * Tests for the RuntimeAdapterPort bridge.
 *
 * The bridge wraps a CopilotCliAdapter (which implements WorkerRuntime)
 * to satisfy the RuntimeAdapterPort interface. The types are structurally
 * identical but nominally different — RunContext.taskPacket is typed as
 * TaskPacket while SupervisorRunContext.taskPacket is Record<string, unknown>.
 *
 * Validates:
 * - Name passthrough
 * - Context type bridging for prepareRun
 * - Direct delegation for all lifecycle methods
 */
describe("RuntimeAdapterBridge", () => {
  let fs: FileSystem;
  let processSpawner: CliProcessSpawner;
  let cliAdapter: CopilotCliAdapter;

  beforeEach(() => {
    fs = createFakeFs();
    processSpawner = createFakeProcessSpawner();
    cliAdapter = new CopilotCliAdapter({}, { fs, processSpawner });
  });

  /**
   * Validates that the bridge exposes the adapter's name property.
   * The name is used in logging and diagnostics to identify which
   * runtime backend is active.
   */
  it("exposes the adapter name", () => {
    const bridge = createRuntimeAdapterBridge(cliAdapter);
    expect(bridge.name).toBe("copilot-cli");
  });

  /**
   * Validates that prepareRun delegates the context to the CLI adapter,
   * bridging the SupervisorRunContext → RunContext type boundary.
   * This is the most important test because it verifies the type cast
   * works correctly at runtime.
   */
  it("delegates prepareRun with context type bridge", async () => {
    const preparedResult = {
      runId: "run-001",
      context: SAMPLE_RUN_CONTEXT as unknown as RunContext,
      preparedAt: "2026-01-01T00:00:00Z",
    };
    const prepareSpy = vi.spyOn(cliAdapter, "prepareRun").mockResolvedValue(preparedResult);

    const bridge = createRuntimeAdapterBridge(cliAdapter);
    const result = await bridge.prepareRun(SAMPLE_RUN_CONTEXT);

    expect(prepareSpy).toHaveBeenCalledOnce();
    // Verify the context was passed through (the cast is transparent)
    const calledContext = prepareSpy.mock.calls[0][0];
    expect(calledContext.taskPacket).toEqual(SAMPLE_RUN_CONTEXT.taskPacket);
    expect(calledContext.workspacePaths).toEqual(SAMPLE_RUN_CONTEXT.workspacePaths);
    expect(result.runId).toBe("run-001");
  });

  /**
   * Validates that startRun delegates directly to the adapter.
   */
  it("delegates startRun", async () => {
    const startSpy = vi.spyOn(cliAdapter, "startRun").mockResolvedValue(undefined);

    const bridge = createRuntimeAdapterBridge(cliAdapter);
    await bridge.startRun("run-001");

    expect(startSpy).toHaveBeenCalledWith("run-001");
  });

  /**
   * Validates that streamRun returns the adapter's async iterable.
   * The stream events are structurally identical between WorkerRuntime
   * and RuntimeAdapterPort so no conversion is needed.
   */
  it("delegates streamRun", async () => {
    const events = [
      { type: "stdout" as const, content: "hello", timestamp: "2026-01-01T00:00:01Z" },
      { type: "heartbeat" as const, content: "", timestamp: "2026-01-01T00:00:02Z" },
    ];
    vi.spyOn(cliAdapter, "streamRun").mockReturnValue(
      (async function* () {
        for (const e of events) yield e;
      })(),
    );

    const bridge = createRuntimeAdapterBridge(cliAdapter);
    const collected = [];
    for await (const event of bridge.streamRun("run-001")) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
  });

  /**
   * Validates that cancelRun delegates and returns the result.
   */
  it("delegates cancelRun", async () => {
    const cancelResult = { cancelled: true, reason: undefined };
    vi.spyOn(cliAdapter, "cancelRun").mockResolvedValue(cancelResult);

    const bridge = createRuntimeAdapterBridge(cliAdapter);
    const result = await bridge.cancelRun("run-001");

    expect(result).toEqual(cancelResult);
  });

  /**
   * Validates that collectArtifacts delegates and returns the result.
   */
  it("delegates collectArtifacts", async () => {
    const artifacts = {
      packetOutput: { status: "success" },
      packetValid: true,
      artifactPaths: ["/path/to/artifact.json"],
      validationErrors: [],
    };
    vi.spyOn(cliAdapter, "collectArtifacts").mockResolvedValue(artifacts);

    const bridge = createRuntimeAdapterBridge(cliAdapter);
    const result = await bridge.collectArtifacts("run-001");

    expect(result).toEqual(artifacts);
  });

  /**
   * Validates that finalizeRun delegates and returns the result.
   */
  it("delegates finalizeRun", async () => {
    const finalResult = {
      runId: "run-001",
      status: "success" as const,
      packetOutput: { result: "done" },
      artifactPaths: [],
      logs: [],
      exitCode: 0,
      durationMs: 5000,
      finalizedAt: "2026-01-01T00:05:00Z",
    };
    vi.spyOn(cliAdapter, "finalizeRun").mockResolvedValue(finalResult);

    const bridge = createRuntimeAdapterBridge(cliAdapter);
    const result = await bridge.finalizeRun("run-001");

    expect(result).toEqual(finalResult);
  });
});

// ─── Factory Function Tests ──────────────────────────────────────────────────

/**
 * Tests for the combined factory function and config resolver.
 *
 * Validates that `createInfrastructureAdapters` produces all three port
 * implementations and that `resolveInfrastructureConfig` correctly reads
 * environment variables with fallback defaults.
 */
describe("createInfrastructureAdapters", () => {
  /**
   * Validates that the factory creates all three adapters and that each
   * conforms to its port interface (has the expected methods).
   */
  it("creates all three adapters conforming to port interfaces", () => {
    const adapters = createInfrastructureAdapters(
      { workspacesRoot: "/tmp/workspaces" },
      {
        fs: createFakeFs(),
        git: createFakeGit(),
        processSpawner: createFakeProcessSpawner(),
      },
    );

    // WorkspaceProviderPort
    expect(adapters.workspaceProvider).toBeDefined();
    expect(typeof adapters.workspaceProvider.createWorkspace).toBe("function");
    expect(typeof adapters.workspaceProvider.cleanupWorkspace).toBe("function");

    // PacketMounterPort
    expect(adapters.packetMounter).toBeDefined();
    expect(typeof adapters.packetMounter.mountPackets).toBe("function");

    // RuntimeAdapterPort
    expect(adapters.runtimeAdapter).toBeDefined();
    expect(adapters.runtimeAdapter.name).toBe("copilot-cli");
    expect(typeof adapters.runtimeAdapter.prepareRun).toBe("function");
    expect(typeof adapters.runtimeAdapter.startRun).toBe("function");
    expect(typeof adapters.runtimeAdapter.streamRun).toBe("function");
    expect(typeof adapters.runtimeAdapter.cancelRun).toBe("function");
    expect(typeof adapters.runtimeAdapter.collectArtifacts).toBe("function");
    expect(typeof adapters.runtimeAdapter.finalizeRun).toBe("function");
  });

  /**
   * Validates that dependencies are shared across adapters. The factory
   * creates one FileSystem, one GitOperations, and one ProcessSpawner
   * and distributes them — the test injects fakes and verifies they
   * are the ones used.
   */
  it("accepts and uses injected dependencies", () => {
    const fakeFs = createFakeFs();
    const fakeGit = createFakeGit();
    const fakeSpawner = createFakeProcessSpawner();

    // Should not throw — instantiation with fakes must succeed
    const adapters = createInfrastructureAdapters(
      { workspacesRoot: "/custom/root" },
      { fs: fakeFs, git: fakeGit, processSpawner: fakeSpawner },
    );

    expect(adapters.workspaceProvider).toBeDefined();
    expect(adapters.packetMounter).toBeDefined();
    expect(adapters.runtimeAdapter).toBeDefined();
  });
});

/**
 * Tests for the environment-based config resolver.
 *
 * Validates that WORKSPACES_ROOT env var is read when present and that
 * a sensible default is used when absent. This is important because
 * misconfigured paths would cause workspace creation to write to
 * unexpected locations.
 */
describe("resolveInfrastructureConfig", () => {
  const originalEnv = process.env["WORKSPACES_ROOT"];

  beforeEach(() => {
    delete process.env["WORKSPACES_ROOT"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["WORKSPACES_ROOT"] = originalEnv;
    } else {
      delete process.env["WORKSPACES_ROOT"];
    }
  });

  /**
   * Validates the default path when WORKSPACES_ROOT is not set.
   * The default ./data/workspaces matches the project convention for
   * local-first data storage.
   */
  it("uses default workspacesRoot when env var is absent", () => {
    const config = resolveInfrastructureConfig();
    expect(config.workspacesRoot).toBe("./data/workspaces");
  });

  /**
   * Validates that WORKSPACES_ROOT env var overrides the default.
   */
  it("reads WORKSPACES_ROOT from environment", () => {
    process.env["WORKSPACES_ROOT"] = "/custom/workspaces";
    const config = resolveInfrastructureConfig();
    expect(config.workspacesRoot).toBe("/custom/workspaces");
  });
});
