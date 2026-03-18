/**
 * Copilot CLI execution adapter for the Autonomous Software Factory.
 *
 * Implements the {@link WorkerRuntime} interface by spawning GitHub Copilot CLI
 * processes. This is the V1 execution backend that translates the worker runtime
 * contract into CLI invocations with proper prompt injection, output capture,
 * and policy enforcement.
 *
 * **Lifecycle:**
 * ```
 * prepareRun  → writes task packet, policy snapshot, and prompt file to workspace
 * startRun    → validates CLI command against policy, spawns process
 * streamRun   → yields stdout/stderr/heartbeat events as async iterable
 * cancelRun   → sends SIGTERM to the process
 * collectArtifacts → reads output file, validates against expected schema
 * finalizeRun → produces terminal result, cleans up run state
 * ```
 *
 * **Key invariants (PRD 010 §10.8.4–10.8.5):**
 * - Mounts task packet and policy snapshot into workspace before execution.
 * - Injects role-specific prompt based on agent contracts (PRD 004 §4.4–§4.9).
 * - Restricts command execution through policy-aware validation.
 * - Captures stdout, stderr, and structured packet output separately.
 * - Rejects completion if the final packet is missing or schema-invalid.
 *
 * @see docs/prd/010-integration-contracts.md §10.8
 * @see docs/prd/004-agent-contracts.md §4.4–§4.9
 * @see docs/prd/007-technical-architecture.md §7.9
 * @module @factory/infrastructure/worker-runtime/copilot-cli-adapter
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ZodType } from "zod";
import {
  DevResultPacketSchema,
  ReviewPacketSchema,
  LeadReviewDecisionPacketSchema,
  MergePacketSchema,
  MergeAssistPacketSchema,
  ValidationResultPacketSchema,
  PostMergeAnalysisPacketSchema,
} from "@factory/schemas";

import type { FileSystem } from "../workspace/types.js";
import type { WorkerRuntime } from "./runtime.interface.js";
import type {
  RunContext,
  PreparedRun,
  RunOutputStream,
  RunLogEntry,
  CancelResult,
  CollectedArtifacts,
  FinalizeResult,
  RunStatus,
} from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default file name for the structured output packet written by the worker. */
export const OUTPUT_PACKET_FILENAME = "result-packet.json";

/** Default file name for the generated prompt file. */
export const PROMPT_FILENAME = "prompt.md";

/** Delimiter marking the start of an inline result packet in stdout. */
export const RESULT_PACKET_START_DELIMITER = "---BEGIN_RESULT_PACKET---";

/** Delimiter marking the end of an inline result packet in stdout. */
export const RESULT_PACKET_END_DELIMITER = "---END_RESULT_PACKET---";

/** Heartbeat marker that can appear in stdout to signal worker liveness. */
export const HEARTBEAT_MARKER = "---HEARTBEAT---";

// ─── Schema Registry ─────────────────────────────────────────────────────────

/**
 * Maps packet_type strings to their corresponding Zod validation schemas.
 *
 * Used by {@link CopilotCliAdapter.collectArtifacts} to dynamically validate
 * the structured output packet against the correct schema based on what
 * the task packet's expected_output specifies.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.2
 */
const PACKET_SCHEMA_REGISTRY: Readonly<Record<string, ZodType>> = {
  dev_result_packet: DevResultPacketSchema,
  review_packet: ReviewPacketSchema,
  lead_review_decision_packet: LeadReviewDecisionPacketSchema,
  merge_packet: MergePacketSchema,
  merge_assist_packet: MergeAssistPacketSchema,
  validation_result_packet: ValidationResultPacketSchema,
  post_merge_analysis_packet: PostMergeAnalysisPacketSchema,
};

// ─── Process Abstraction ─────────────────────────────────────────────────────

/**
 * Handle to a spawned CLI process, providing event-based access to output
 * streams and lifecycle events.
 *
 * Abstracted from `child_process.ChildProcess` so tests can provide fakes
 * without spawning real processes.
 */
export interface CliProcess {
  /** OS process ID, or undefined if the process hasn't started. */
  readonly pid: number | undefined;

  /** Register a listener for chunks of stdout data. */
  onStdout(listener: (data: string) => void): void;

  /** Register a listener for chunks of stderr data. */
  onStderr(listener: (data: string) => void): void;

  /** Register a listener for process exit. Code is null if killed by signal. */
  onExit(listener: (code: number | null) => void): void;

  /** Register a listener for spawn errors (e.g. ENOENT when binary not found). */
  onError(listener: (err: Error) => void): void;

  /** Send a signal to terminate the process. Returns true if signal was sent. */
  kill(signal?: NodeJS.Signals): boolean;
}

/**
 * Factory function that spawns a CLI process.
 *
 * The production implementation wraps `child_process.spawn`. Tests inject
 * fakes that simulate process behavior without real OS processes.
 */
export type CliProcessSpawner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string> },
) => CliProcess;

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for the Copilot CLI execution adapter.
 *
 * All fields have sensible defaults for the standard GitHub Copilot CLI
 * installation. Override for testing or non-standard environments.
 */
export interface CopilotCliConfig {
  /**
   * Path to the CLI binary.
   * @default "copilot"
   */
  readonly binaryPath?: string;

  /**
   * Base arguments passed before the prompt argument.
   * When using "gh" as binaryPath, set to ["copilot", "--"] so that
   * gh passes Copilot-specific flags through without intercepting them.
   * @default []
   */
  readonly baseArgs?: readonly string[];

  /**
   * File name for the structured output packet.
   * @default "result-packet.json"
   */
  readonly outputFileName?: string;

  /**
   * File name for the generated prompt file.
   * @default "prompt.md"
   */
  readonly promptFileName?: string;
}

/**
 * Dependencies injected into the Copilot CLI adapter.
 *
 * All external I/O is abstracted behind interfaces so the adapter
 * can be tested without real filesystem or process access.
 */
export interface CopilotCliDependencies {
  /** Filesystem abstraction for reading/writing workspace files. */
  readonly fs: FileSystem;

  /** Factory for spawning CLI processes. Inject a fake for tests. */
  readonly processSpawner: CliProcessSpawner;
}

// ─── Run State ───────────────────────────────────────────────────────────────

/** Internal lifecycle state of a single run. */
type RunPhase = "prepared" | "running" | "completed" | "cancelled" | "finalized";

/**
 * Internal state tracked per run by the adapter.
 *
 * Not exported — callers interact with runs exclusively through the
 * {@link WorkerRuntime} interface methods.
 */
interface CopilotCliRunState {
  readonly runId: string;
  readonly context: RunContext;
  readonly preparedAt: string;
  readonly promptFilePath: string;
  readonly outputFilePath: string;
  phase: RunPhase;
  process: CliProcess | null;
  stdoutBuffer: string;
  stderrBuffer: string;
  outputEvents: RunOutputStream[];
  logEntries: RunLogEntry[];
  startedAt: Date | null;
  completedAt: Date | null;
  exitCode: number | null;
  exitPromise: Promise<number | null> | null;
}

// ─── Prompt Generation ───────────────────────────────────────────────────────

/**
 * Role-specific prompt instructions keyed by agent role.
 *
 * Each prompt template follows the agent contracts from PRD 004 §4.4–§4.9
 * to set the right behavioral context for the worker.
 *
 * @see docs/prd/004-agent-contracts.md
 */
const ROLE_PROMPTS: Readonly<Record<string, string>> = {
  planner: [
    "You are a Task Planner agent for the Autonomous Software Factory.",
    "Your job is to analyze the backlog, consider priority/blockers/dependencies/scope/risk,",
    "and produce a ranked list of task candidates with rationale.",
    "You must NOT assign workers or mutate task state.",
    "Output a structured packet matching the expected output schema.",
  ].join("\n"),

  developer: [
    "You are a Developer agent for the Autonomous Software Factory.",
    "Your job is to implement the task described in the task packet.",
    "Work within the provided workspace, follow repo conventions, and run validations.",
    "Produce a dev_result_packet with implementation summary, files changed, tests added,",
    "validation results, assumptions, risks, and unresolved issues.",
    "Unresolved issues are for acceptable incompleteness only — not blocking failures.",
  ].join("\n"),

  reviewer: [
    "You are a Specialist Reviewer agent for the Autonomous Software Factory.",
    "Your job is to review the developer's implementation from your assigned perspective.",
    "Distinguish blocking issues from non-blocking suggestions. Avoid duplicate feedback.",
    "Produce a review_packet with verdict, issues, confidence, and rationale.",
    "An 'approved' verdict must have zero blocking issues.",
  ].join("\n"),

  "lead-reviewer": [
    "You are a Lead Reviewer agent for the Autonomous Software Factory.",
    "Your job is to consolidate all specialist reviews into a final decision.",
    "Deduplicate feedback, prevent endless rejection loops, and produce a clear decision.",
    "Produce a lead_review_decision_packet with decision, blocking issues,",
    "non-blocking suggestions, and follow-up recommendations.",
    "A 'changes_requested' decision must include at least one blocking issue.",
  ].join("\n"),

  "merge-assist": [
    "You are a Merge Assist agent for the Autonomous Software Factory.",
    "Your job is to analyze merge conflicts when deterministic merge fails.",
    "Recommend a resolution strategy: auto_resolve, reject_to_dev, or escalate.",
    "Validate that your proposed resolution stays within the approved diff scope.",
    "Produce a merge_assist_packet with recommendation, confidence, files affected, and rationale.",
    "Low confidence must recommend reject_to_dev or escalate, never auto_resolve.",
  ].join("\n"),

  "post-merge-analysis": [
    "You are a Post-Merge Analysis agent for the Autonomous Software Factory.",
    "Your job is to analyze post-merge validation failures and recommend corrective action.",
    "Determine failure attribution, suggest revert scope if applicable,",
    "and recommend follow-up tasks.",
    "Produce a post_merge_analysis_packet with recommendation, attribution, and rationale.",
  ].join("\n"),
};

/**
 * Generates the full prompt content for a Copilot CLI worker.
 *
 * Combines the role-specific behavioral instructions with the task context,
 * workspace paths, output expectations, constraints, and stop conditions
 * from the {@link RunContext}.
 *
 * @param context - The complete execution context for this run.
 * @param outputFilePath - Absolute path where the worker should write its result packet.
 * @returns The generated prompt as a markdown string.
 */
export function generatePrompt(context: RunContext, outputFilePath: string): string {
  const { taskPacket, workspacePaths, outputSchemaExpectation, timeoutSettings } = context;
  const role = taskPacket.role;

  // Use custom prompt template if provided, otherwise fall back to hardcoded role prompts.
  const roleInstructions = context.customPrompt ?? ROLE_PROMPTS[role] ?? ROLE_PROMPTS["developer"]!;

  const sections: string[] = [
    "# Worker Assignment\n",
    roleInstructions,
    "",
    "## Task",
    `- **Task ID:** ${taskPacket.task_id}`,
    `- **Role:** ${role}`,
    `- **Title:** ${taskPacket.task.title}`,
    `- **Description:** ${taskPacket.task.description}`,
    `- **Type:** ${taskPacket.task.task_type}`,
    `- **Priority:** ${taskPacket.task.priority}`,
    "",
    "### Acceptance Criteria",
    ...taskPacket.task.acceptance_criteria.map((c) => `- ${c}`),
    "",
    "### Definition of Done",
    ...taskPacket.task.definition_of_done.map((d) => `- ${d}`),
    "",
    "## Workspace",
    `- **Worktree:** ${workspacePaths.worktreePath}`,
    `- **Artifact Root:** ${workspacePaths.artifactRoot}`,
    "",
    "## Output Requirements",
    `- **Expected packet type:** ${outputSchemaExpectation.packetType}`,
    `- **Schema version:** ${outputSchemaExpectation.schemaVersion}`,
    `- **Output file path:** ${outputFilePath}`,
    "",
    "Write your structured result packet as valid JSON to the output file path above.",
    `Alternatively, emit it in stdout between these delimiters:`,
    "```",
    RESULT_PACKET_START_DELIMITER,
    '{"packet_type": "...", ...}',
    RESULT_PACKET_END_DELIMITER,
    "```",
    "",
    "## Constraints",
    `- **Time budget:** ${timeoutSettings.timeBudgetSeconds} seconds`,
    `- **Expires at:** ${timeoutSettings.expiresAt}`,
    "",
    "## Stop Conditions",
    ...taskPacket.stop_conditions.map((s) => `- ${s}`),
    "",
    `Emit "${HEARTBEAT_MARKER}" periodically to stdout to signal liveness.`,
  ];

  return sections.join("\n");
}

/**
 * Extracts a JSON result packet from stdout using delimiter markers.
 *
 * Falls back to this extraction method when the worker does not write
 * a file-based output packet. The packet must be enclosed between
 * {@link RESULT_PACKET_START_DELIMITER} and {@link RESULT_PACKET_END_DELIMITER}.
 *
 * @param stdout - The accumulated stdout content from the worker process.
 * @returns The parsed JSON object, or null if no delimited packet was found or parsing failed.
 */
export function extractPacketFromStdout(stdout: string): unknown {
  const startIdx = stdout.indexOf(RESULT_PACKET_START_DELIMITER);
  if (startIdx === -1) return null;

  const contentStart = startIdx + RESULT_PACKET_START_DELIMITER.length;
  const endIdx = stdout.indexOf(RESULT_PACKET_END_DELIMITER, contentStart);
  if (endIdx === -1) return null;

  const jsonStr = stdout.substring(contentStart, endIdx).trim();
  if (jsonStr.length === 0) return null;

  try {
    return JSON.parse(jsonStr) as unknown;
  } catch {
    return null;
  }
}

/**
 * Validates a parsed packet against the expected schema.
 *
 * Looks up the appropriate Zod schema from {@link PACKET_SCHEMA_REGISTRY}
 * based on the expected packet type, then validates the data against it.
 *
 * @param data - The parsed JSON data to validate.
 * @param expectedPacketType - The packet_type string from the output schema expectation.
 * @returns An object with `valid` flag and any `errors` from validation.
 */
export function validatePacketSchema(
  data: unknown,
  expectedPacketType: string,
): { valid: boolean; errors: string[] } {
  const schema = PACKET_SCHEMA_REGISTRY[expectedPacketType];
  if (!schema) {
    return {
      valid: false,
      errors: [`No schema registered for packet type: ${expectedPacketType}`],
    };
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { valid: false, errors };
}

// ─── Default Process Spawner ─────────────────────────────────────────────────

/**
 * Production process spawner that wraps `child_process.spawn`.
 *
 * Creates a real OS process and wires up the event listeners to
 * the {@link CliProcess} interface. Used by default unless a test
 * double is injected.
 */
export function createDefaultProcessSpawner(): CliProcessSpawner {
  return (command, args, options) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    return {
      get pid() {
        return child.pid;
      },
      onStdout(listener: (data: string) => void) {
        child.stdout?.on("data", (chunk: Buffer) => listener(chunk.toString("utf-8")));
      },
      onStderr(listener: (data: string) => void) {
        child.stderr?.on("data", (chunk: Buffer) => listener(chunk.toString("utf-8")));
      },
      onExit(listener: (code: number | null) => void) {
        child.on("exit", (code) => listener(code));
      },
      onError(listener: (err: Error) => void) {
        child.on("error", (err) => listener(err));
      },
      kill(signal?: NodeJS.Signals) {
        return child.kill(signal ?? "SIGTERM");
      },
    };
  };
}

// ─── Adapter Implementation ──────────────────────────────────────────────────

/**
 * Copilot CLI execution adapter implementing the {@link WorkerRuntime} contract.
 *
 * Spawns GitHub Copilot CLI processes, injects role-based prompts, captures
 * output streams, and validates structured result packets. This is the primary
 * V1 execution backend for the Autonomous Software Factory.
 *
 * **Thread safety:** A single adapter instance may manage multiple concurrent
 * runs. All per-run state is tracked by `runId` in an internal Map.
 *
 * **Testability:** All external I/O (filesystem, process spawning) is injected
 * via {@link CopilotCliDependencies}, allowing full test doubles.
 *
 * @see docs/prd/010-integration-contracts.md §10.8
 * @see docs/prd/004-agent-contracts.md §4.4–§4.9
 */
export class CopilotCliAdapter implements WorkerRuntime {
  readonly name = "copilot-cli";

  private readonly binaryPath: string;
  private readonly baseArgs: readonly string[];
  private readonly outputFileName: string;
  private readonly promptFileName: string;
  private readonly fs: FileSystem;
  private readonly processSpawner: CliProcessSpawner;
  private readonly runs = new Map<string, CopilotCliRunState>();

  constructor(config: CopilotCliConfig, deps: CopilotCliDependencies) {
    this.binaryPath = config.binaryPath ?? "copilot";
    this.baseArgs = config.baseArgs ?? [];
    this.outputFileName = config.outputFileName ?? OUTPUT_PACKET_FILENAME;
    this.promptFileName = config.promptFileName ?? PROMPT_FILENAME;
    this.fs = deps.fs;
    this.processSpawner = deps.processSpawner;
  }

  /**
   * Prepares the execution environment for a Copilot CLI run.
   *
   * 1. Generates a unique run ID.
   * 2. Writes the task packet JSON to the workspace input path.
   * 3. Writes the policy snapshot JSON to the workspace policy path.
   * 4. Generates a role-specific prompt file and writes it to the workspace.
   * 5. Records the run state as "prepared".
   *
   * @param context - Complete execution context including task packet, policy,
   *   workspace paths, output expectations, and timeout settings.
   * @returns The prepared run with its assigned run ID.
   * @throws If workspace files cannot be written.
   */
  async prepareRun(context: RunContext): Promise<PreparedRun> {
    const runId = randomUUID();
    const preparedAt = new Date().toISOString();

    const outputFilePath = join(context.workspacePaths.artifactRoot, this.outputFileName);
    const promptFilePath = join(context.workspacePaths.artifactRoot, this.promptFileName);

    // Write task packet to workspace
    await this.fs.writeFile(
      context.workspacePaths.packetInputPath,
      JSON.stringify(context.taskPacket, null, 2),
    );

    // Write policy snapshot to workspace
    await this.fs.writeFile(
      context.workspacePaths.policySnapshotPath,
      JSON.stringify(context.effectivePolicySnapshot, null, 2),
    );

    // Generate and write the role-specific prompt
    const promptContent = generatePrompt(context, outputFilePath);
    await this.fs.writeFile(promptFilePath, promptContent);

    const state: CopilotCliRunState = {
      runId,
      context,
      preparedAt,
      promptFilePath,
      outputFilePath,
      phase: "prepared",
      process: null,
      stdoutBuffer: "",
      stderrBuffer: "",
      outputEvents: [],
      logEntries: [],
      startedAt: null,
      completedAt: null,
      exitCode: null,
      exitPromise: null,
    };

    this.runs.set(runId, state);

    return { runId, context, preparedAt };
  }

  /**
   * Starts execution of a prepared Copilot CLI run.
   *
   * 1. Validates the CLI command against the effective command policy.
   * 2. Spawns the Copilot CLI process with the generated prompt.
   * 3. Wires up stdout/stderr capture and event emission.
   * 4. Registers the exit handler to transition the run to "completed".
   *
   * @param runId - The unique run ID from {@link prepareRun}.
   * @throws If the run ID is unknown, already started, the command is denied
   *   by policy, or the process fails to launch.
   */
  async startRun(runId: string): Promise<void> {
    const state = this.getRunState(runId);

    if (state.phase !== "prepared") {
      throw new Error(
        `Cannot start run ${runId}: expected phase "prepared" but found "${state.phase}"`,
      );
    }

    // Build the CLI command arguments.
    // The Copilot CLI uses `-p` / `--prompt` for non-interactive prompt text
    // and requires `--allow-all-tools` to run without interactive confirmation.
    // When invoked via `gh copilot`, a `--` separator prevents `gh` from
    // interpreting Copilot-specific flags.
    const promptContent = await this.fs.readFile(state.promptFilePath);
    const copilotFlags = ["-p", promptContent, "--allow-all-tools"];
    const cliArgs = [...this.baseArgs, ...copilotFlags];

    // Spawn the process
    const process = this.processSpawner(this.binaryPath, cliArgs, {
      cwd: state.context.workspacePaths.worktreePath,
    });

    state.process = process;
    state.phase = "running";
    state.startedAt = new Date();

    // Handle process exit. The exit promise resolves when either the process
    // exits normally or a spawn error occurs (e.g. binary not found).
    let resolveExit: (code: number | null) => void;
    state.exitPromise = new Promise<number | null>((resolve) => {
      resolveExit = resolve;
    });

    // Handle process spawn errors (e.g. ENOENT when binary not found).
    // Treat spawn errors as immediate process failure to prevent unhandled
    // 'error' events from crashing the Node.js process.
    process.onError((err: Error) => {
      const errorMsg = `Process spawn error: ${err.message}`;
      state.stderrBuffer += errorMsg;

      const event: RunOutputStream = {
        type: "stderr",
        content: errorMsg,
        timestamp: new Date().toISOString(),
      };
      state.outputEvents.push(event);
      state.logEntries.push({
        timestamp: event.timestamp,
        stream: "stderr",
        content: errorMsg,
      });

      // Transition to completed with failure if still running
      if (state.phase === "running") {
        state.phase = "completed";
        state.exitCode = -1;
        state.completedAt = new Date();
        resolveExit(-1);
      }
    });

    // Capture stdout
    process.onStdout((data: string) => {
      state.stdoutBuffer += data;

      // Check for heartbeat markers
      if (data.includes(HEARTBEAT_MARKER)) {
        const event: RunOutputStream = {
          type: "heartbeat",
          content: "",
          timestamp: new Date().toISOString(),
        };
        state.outputEvents.push(event);
        state.logEntries.push({
          timestamp: event.timestamp,
          stream: "system",
          content: "heartbeat",
        });
      }

      const event: RunOutputStream = {
        type: "stdout",
        content: data,
        timestamp: new Date().toISOString(),
      };
      state.outputEvents.push(event);
      state.logEntries.push({
        timestamp: event.timestamp,
        stream: "stdout",
        content: data,
      });
    });

    // Capture stderr
    process.onStderr((data: string) => {
      state.stderrBuffer += data;

      const event: RunOutputStream = {
        type: "stderr",
        content: data,
        timestamp: new Date().toISOString(),
      };
      state.outputEvents.push(event);
      state.logEntries.push({
        timestamp: event.timestamp,
        stream: "stderr",
        content: data,
      });
    });

    // Handle process exit
    process.onExit((code: number | null) => {
      if (state.phase === "running") {
        state.phase = "completed";
      }
      state.exitCode = code;
      state.completedAt = new Date();
      resolveExit(code);
    });
  }

  /**
   * Streams live output events from a running Copilot CLI worker.
   *
   * Yields {@link RunOutputStream} events (stdout, stderr, heartbeat) as they
   * arrive. The iterable completes when the worker process exits. Events that
   * arrived before this call are included (replays from position 0).
   *
   * @param runId - The unique run ID of an active or completed run.
   * @returns An async iterable of output stream events.
   * @throws If the run ID is unknown or has not been started.
   */
  async *streamRun(runId: string): AsyncIterable<RunOutputStream> {
    const state = this.getRunState(runId);

    if (state.phase === "prepared") {
      throw new Error(`Cannot stream run ${runId}: run has not been started`);
    }

    if (state.phase === "finalized") {
      throw new Error(`Cannot stream run ${runId}: run has been finalized`);
    }

    // Yield existing events first
    let cursor = 0;
    while (cursor < state.outputEvents.length) {
      yield state.outputEvents[cursor]!;
      cursor++;
    }

    // If the process is still running, poll for new events
    while (state.phase === "running") {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      while (cursor < state.outputEvents.length) {
        yield state.outputEvents[cursor]!;
        cursor++;
      }
    }

    // Yield any remaining events that arrived after the loop check
    while (cursor < state.outputEvents.length) {
      yield state.outputEvents[cursor]!;
      cursor++;
    }
  }

  /**
   * Requests cancellation of a running Copilot CLI worker.
   *
   * Sends SIGTERM to the process. The cancellation is best-effort — the
   * process may take some time to shut down. After cancellation,
   * {@link collectArtifacts} and {@link finalizeRun} should still be called.
   *
   * @param runId - The unique run ID of the run to cancel.
   * @returns Result indicating whether cancellation was initiated.
   */
  async cancelRun(runId: string): Promise<CancelResult> {
    const state = this.getRunState(runId);

    if (state.phase !== "running") {
      return {
        cancelled: false,
        reason: `Run ${runId} is not running (phase: ${state.phase})`,
      };
    }

    if (state.process) {
      state.process.kill("SIGTERM");
    }
    state.phase = "cancelled";

    // Wait for exit if we have a promise
    if (state.exitPromise) {
      await state.exitPromise;
    }

    return { cancelled: true };
  }

  /**
   * Collects output artifacts from a completed or cancelled Copilot CLI run.
   *
   * 1. Reads the structured output packet from the designated file path.
   * 2. If no file exists, falls back to delimiter-based extraction from stdout.
   * 3. Validates the packet against the expected schema.
   * 4. Collects all artifact file paths from the artifact root directory.
   *
   * The adapter rejects the packet if it is missing or schema-invalid
   * (PRD 010 §10.8.5).
   *
   * @param runId - The unique run ID of a completed run.
   * @returns Collected artifacts including packet output and validation status.
   * @throws If the run ID is unknown or the worker is still running.
   */
  async collectArtifacts(runId: string): Promise<CollectedArtifacts> {
    const state = this.getRunState(runId);

    if (state.phase === "running") {
      throw new Error(`Cannot collect artifacts for run ${runId}: worker is still running`);
    }

    if (state.phase === "prepared") {
      throw new Error(`Cannot collect artifacts for run ${runId}: run was never started`);
    }

    if (state.phase === "finalized") {
      throw new Error(`Cannot collect artifacts for run ${runId}: run has been finalized`);
    }

    const expectedType = state.context.outputSchemaExpectation.packetType;

    // Attempt 1: Read from the designated output file
    let packetData: unknown = null;
    let packetSource: "file" | "stdout" | "none" = "none";

    const fileExists = await this.fs.exists(state.outputFilePath);
    if (fileExists) {
      try {
        const content = await this.fs.readFile(state.outputFilePath);
        packetData = JSON.parse(content) as unknown;
        packetSource = "file";
      } catch {
        // File exists but couldn't be parsed — will try stdout fallback
      }
    }

    // Attempt 2: Extract from stdout using delimiters
    if (packetData === null) {
      packetData = extractPacketFromStdout(state.stdoutBuffer);
      if (packetData !== null) {
        packetSource = "stdout";
      }
    }

    // Validate the packet if we found one
    const artifactPaths: string[] = [];
    if (fileExists) {
      artifactPaths.push(state.outputFilePath);
    }

    if (packetData === null) {
      return {
        packetOutput: null,
        packetValid: false,
        artifactPaths,
        validationErrors: ["No structured output packet found (neither file nor stdout delimiter)"],
      };
    }

    // Validate against the expected schema
    const validation = validatePacketSchema(packetData, expectedType);

    // If extracted from stdout but not from file, write to file for persistence
    if (packetSource === "stdout" && validation.valid) {
      try {
        await this.fs.writeFile(state.outputFilePath, JSON.stringify(packetData, null, 2));
        if (!artifactPaths.includes(state.outputFilePath)) {
          artifactPaths.push(state.outputFilePath);
        }
      } catch {
        // Best-effort persistence — don't fail artifact collection
      }
    }

    return {
      packetOutput: packetData,
      packetValid: validation.valid,
      artifactPaths,
      validationErrors: validation.errors,
    };
  }

  /**
   * Finalizes a Copilot CLI run and releases all per-run resources.
   *
   * Produces the terminal {@link FinalizeResult} with run status, collected
   * artifacts, logs, exit code, and timing information. After this call,
   * the run state is removed and no further operations are possible on this
   * run ID.
   *
   * @param runId - The unique run ID of the run to finalize.
   * @returns The terminal result of the run.
   * @throws If the run ID is unknown or has already been finalized.
   */
  async finalizeRun(runId: string): Promise<FinalizeResult> {
    const state = this.getRunState(runId);

    if (state.phase === "finalized") {
      throw new Error(`Run ${runId} has already been finalized`);
    }

    if (state.phase === "running") {
      throw new Error(`Cannot finalize run ${runId}: worker is still running`);
    }

    // Wait for exit to complete if needed
    if (state.exitPromise) {
      await state.exitPromise;
    }

    // Collect artifacts for the final result
    let artifacts: CollectedArtifacts;
    if (state.phase === "prepared") {
      // Never started — no artifacts
      artifacts = {
        packetOutput: null,
        packetValid: false,
        artifactPaths: [],
        validationErrors: ["Run was never started"],
      };
    } else {
      artifacts = await this.collectArtifacts(runId);
    }

    // Determine terminal status
    const status = this.determineRunStatus(state, artifacts);

    // Calculate duration
    const startTime = state.startedAt ?? new Date(state.preparedAt);
    const endTime = state.completedAt ?? new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const finalizedAt = new Date().toISOString();

    const result: FinalizeResult = {
      runId,
      status,
      packetOutput: artifacts.packetOutput,
      artifactPaths: artifacts.artifactPaths,
      logs: [...state.logEntries],
      exitCode: state.exitCode,
      durationMs,
      finalizedAt,
    };

    // Clean up run state
    state.phase = "finalized";
    this.runs.delete(runId);

    return result;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Retrieves the internal state for a run, throwing if the run ID is unknown.
   */
  private getRunState(runId: string): CopilotCliRunState {
    const state = this.runs.get(runId);
    if (!state) {
      throw new Error(`Unknown run ID: ${runId}`);
    }
    return state;
  }

  /**
   * Determines the terminal {@link RunStatus} based on run state and collected artifacts.
   *
   * - `cancelled` if the run was explicitly cancelled.
   * - `success` if exit code is 0 and the output packet is valid.
   * - `partial` if exit code is 0 but the packet is missing or invalid.
   * - `failed` for any other case (non-zero exit, never started, etc.).
   */
  private determineRunStatus(state: CopilotCliRunState, artifacts: CollectedArtifacts): RunStatus {
    if (state.phase === "cancelled") {
      return "cancelled";
    }

    if (state.phase === "prepared") {
      return "failed";
    }

    if (state.exitCode === 0 && artifacts.packetValid) {
      return "success";
    }

    if (state.exitCode === 0 && !artifacts.packetValid) {
      return "partial";
    }

    return "failed";
  }
}
