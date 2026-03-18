/**
 * Infrastructure adapter bridges for the Worker Supervisor.
 *
 * Wraps the concrete implementations from `@factory/infrastructure`
 * ({@link WorkspaceManager}, {@link WorkspacePacketMounter},
 * {@link CopilotCliAdapter}) into the application-layer port interfaces
 * ({@link WorkspaceProviderPort}, {@link PacketMounterPort},
 * {@link RuntimeAdapterPort}) that the {@link WorkerSupervisorService}
 * depends on.
 *
 * This follows the same factory-function pattern used by
 * `application-adapters.ts` and `heartbeat-forwarder-adapter.ts` in this
 * module.
 *
 * @module @factory/control-plane/automation/infrastructure-adapters
 */

import type {
  WorkspaceProviderPort,
  PacketMounterPort,
  RuntimeAdapterPort,
  SupervisorRunContext,
} from "@factory/application";
import type {
  GitOperations,
  FileSystem,
  CliProcessSpawner,
  CopilotCliConfig,
  RunContext,
} from "@factory/infrastructure";
import {
  WorkspaceManager,
  WorkspacePacketMounter,
  CopilotCliAdapter,
  createNodeFileSystem,
  createExecGitOperations,
  createDefaultProcessSpawner,
} from "@factory/infrastructure";

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for infrastructure adapter instantiation.
 *
 * All paths are resolved relative to the control-plane process working
 * directory unless absolute paths are supplied.
 */
export interface InfrastructureAdapterConfig {
  /**
   * Root directory for all task worktrees.
   * Each task gets a subdirectory under this path.
   * Defaults to `./data/workspaces`.
   */
  readonly workspacesRoot: string;

  /**
   * Root directory for task artifacts (packets, logs, snapshots).
   * Each task gets a subdirectory under this path.
   * Defaults to `./data/artifacts`.
   */
  readonly artifactsRoot: string;

  /**
   * Optional Copilot CLI configuration overrides.
   * If omitted, defaults to the standard `gh copilot` binary.
   */
  readonly copilotCli?: CopilotCliConfig;
}

/**
 * The set of infrastructure adapters that satisfy the Worker Supervisor's
 * port dependencies.
 */
export interface InfrastructureAdapters {
  readonly workspaceProvider: WorkspaceProviderPort;
  readonly packetMounter: PacketMounterPort;
  readonly runtimeAdapter: RuntimeAdapterPort;
}

/**
 * Optional injectable dependencies for infrastructure adapters.
 *
 * Production code uses the defaults (real filesystem, real git, real
 * process spawner). Tests can override any or all of these to avoid
 * real I/O.
 */
export interface InfrastructureAdapterDependencies {
  readonly fs?: FileSystem;
  readonly git?: GitOperations;
  readonly processSpawner?: CliProcessSpawner;
}

// ─── Workspace Provider Adapter ──────────────────────────────────────────────

/**
 * Create a {@link WorkspaceProviderPort} backed by a
 * {@link WorkspaceManager}.
 *
 * Maps the port's positional `(taskId, repoPath, attempt?)` parameters to
 * the infrastructure's `CreateWorkspaceOptions` object, and the port's
 * `(taskId, repoPath, options?)` cleanup parameters to
 * `CleanupWorkspaceOptions`. Return types are structurally identical.
 *
 * @param manager - The workspace manager to delegate to.
 * @returns A port implementation suitable for the Worker Supervisor.
 */
export function createWorkspaceProviderAdapter(manager: WorkspaceManager): WorkspaceProviderPort {
  return {
    async createWorkspace(taskId, repoPath, attempt?) {
      const result = await manager.createWorkspace({
        taskId,
        repoPath,
        attempt,
      });
      return result;
    },

    async cleanupWorkspace(taskId, repoPath, options?) {
      const result = await manager.cleanupWorkspace({
        taskId,
        repoPath,
        deleteBranch: options?.deleteBranch,
        forceBranchDelete: options?.forceBranchDelete,
      });
      return result;
    },
  };
}

// ─── Packet Mounter Adapter ──────────────────────────────────────────────────

/**
 * Create a {@link PacketMounterPort} backed by a
 * {@link WorkspacePacketMounter}.
 *
 * The infrastructure implementation returns a `MountPacketsResult` with
 * paths to the mounted files. The port contract returns `void` — this
 * adapter discards the result since the caller already knows the paths
 * from the workspace layout.
 *
 * @param mounter - The packet mounter to delegate to.
 * @returns A port implementation suitable for the Worker Supervisor.
 */
export function createPacketMounterAdapter(mounter: WorkspacePacketMounter): PacketMounterPort {
  return {
    async mountPackets(workspacePath, input) {
      await mounter.mountPackets(workspacePath, input);
    },
  };
}

// ─── Runtime Adapter Bridge ──────────────────────────────────────────────────

/**
 * Create a {@link RuntimeAdapterPort} backed by a {@link CopilotCliAdapter}.
 *
 * The infrastructure's {@link WorkerRuntime} interface and the application's
 * {@link RuntimeAdapterPort} are structurally identical — same method names,
 * same shapes. The only nominal difference is that `RunContext.taskPacket`
 * is typed as `TaskPacket` (from `@factory/schemas`) while
 * `SupervisorRunContext.taskPacket` is typed as `Record<string, unknown>`.
 * At runtime the values are the same objects; this adapter bridges the type
 * boundary with a safe cast.
 *
 * @param adapter - The Copilot CLI adapter (or any WorkerRuntime) to bridge.
 * @returns A port implementation suitable for the Worker Supervisor.
 */
export function createRuntimeAdapterBridge(adapter: CopilotCliAdapter): RuntimeAdapterPort {
  return {
    get name() {
      return adapter.name;
    },

    async prepareRun(context: SupervisorRunContext) {
      // SupervisorRunContext.taskPacket is now properly typed as TaskPacket,
      // matching RunContext.taskPacket. The remaining structural difference
      // (effectivePolicySnapshot as Record vs PolicySnapshot) is safe at
      // runtime since both are plain JSON objects.
      const infraContext = context as unknown as RunContext;
      const result = await adapter.prepareRun(infraContext);
      return result;
    },

    async startRun(runId: string) {
      await adapter.startRun(runId);
    },

    streamRun(runId: string) {
      return adapter.streamRun(runId);
    },

    async cancelRun(runId: string) {
      return adapter.cancelRun(runId);
    },

    async collectArtifacts(runId: string) {
      return adapter.collectArtifacts(runId);
    },

    async finalizeRun(runId: string) {
      return adapter.finalizeRun(runId);
    },
  };
}

// ─── Combined Factory ────────────────────────────────────────────────────────

/**
 * Resolve the infrastructure adapter configuration from environment
 * variables with sensible defaults.
 *
 * @returns Resolved configuration.
 */
export function resolveInfrastructureConfig(): InfrastructureAdapterConfig {
  const workspacesRoot = process.env["WORKSPACES_ROOT"] ?? "./data/workspaces";
  const artifactsRoot = process.env["ARTIFACTS_ROOT"] ?? "./data/artifacts";

  // Allow overriding the Copilot CLI binary path via environment variable.
  // Useful when the `copilot` binary is installed via NVM or a non-standard path.
  const cliBinary = process.env["COPILOT_CLI_BINARY"];
  const copilotCli: InfrastructureAdapterConfig["copilotCli"] = cliBinary
    ? { binaryPath: cliBinary, baseArgs: [] }
    : undefined;

  return { workspacesRoot, artifactsRoot, copilotCli };
}

/**
 * Create the full set of infrastructure adapters needed by the Worker
 * Supervisor.
 *
 * Instantiates the real filesystem, git operations, and process spawner
 * implementations, then wraps each infrastructure class in its port
 * adapter. All adapters share the same filesystem instance for
 * consistency.
 *
 * @param config - Infrastructure paths and CLI overrides.
 * @param deps - Optional dependency overrides for testing.
 * @returns The three port-conformant adapters.
 */
export function createInfrastructureAdapters(
  config: InfrastructureAdapterConfig,
  deps?: InfrastructureAdapterDependencies,
): InfrastructureAdapters {
  const fs = deps?.fs ?? createNodeFileSystem();
  const git = deps?.git ?? createExecGitOperations();
  const processSpawner = deps?.processSpawner ?? createDefaultProcessSpawner();

  const workspaceManager = new WorkspaceManager(git, fs, config.workspacesRoot);
  const packetMounter = new WorkspacePacketMounter(fs);
  const cliAdapter = new CopilotCliAdapter(config.copilotCli ?? {}, { fs, processSpawner });

  return {
    workspaceProvider: createWorkspaceProviderAdapter(workspaceManager),
    packetMounter: createPacketMounterAdapter(packetMounter),
    runtimeAdapter: createRuntimeAdapterBridge(cliAdapter),
  };
}
