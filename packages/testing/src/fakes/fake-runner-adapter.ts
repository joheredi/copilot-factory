/**
 * Fake implementation of {@link RuntimeAdapterPort} for integration testing.
 *
 * Provides a fully configurable test double that simulates the worker runtime
 * lifecycle (prepare → start → stream → collect → finalize) with deterministic,
 * controllable outcomes. Supports success, failure, partial, timeout, and
 * cancellation scenarios via {@link FakeRunnerConfig}.
 *
 * Tracks all method calls for assertion and verification in tests.
 *
 * @module @factory/testing/fakes/fake-runner-adapter
 */

import type {
  RuntimeAdapterPort,
  SupervisorRunContext,
  SupervisorPreparedRun,
  SupervisorRunOutputStream,
  SupervisorCancelResult,
  SupervisorCollectedArtifacts,
  SupervisorFinalizeResult,
  SupervisorRunStatus,
} from "@factory/application";

/**
 * Outcome configuration for a single run. Controls what the fake adapter
 * returns at each lifecycle stage.
 */
export interface FakeRunOutcome {
  /** Terminal status for {@link FakeRunnerAdapter.finalizeRun}. Default: "success" */
  readonly status?: SupervisorRunStatus;
  /** Exit code for the simulated process. Default: 0 for success, 1 for failure */
  readonly exitCode?: number | null;
  /** Whether the result packet should be valid. Default: true */
  readonly packetValid?: boolean;
  /** Packet output data. Default: a minimal valid packet object */
  readonly packetOutput?: unknown;
  /** Simulated artifact paths. Default: [] */
  readonly artifactPaths?: readonly string[];
  /** Validation errors for collected artifacts. Default: [] */
  readonly validationErrors?: readonly string[];
  /** Simulated output stream events. Default: basic stdout + heartbeat */
  readonly streamEvents?: readonly SupervisorRunOutputStream[];
  /** If set, prepareRun will throw this error. */
  readonly prepareError?: Error;
  /** If set, startRun will throw this error. */
  readonly startError?: Error;
  /** If set, collectArtifacts will throw this error. */
  readonly collectError?: Error;
  /** If set, finalizeRun will throw this error. */
  readonly finalizeError?: Error;
  /** Simulated run duration in milliseconds. Default: 1000 */
  readonly durationMs?: number;
}

/**
 * Configuration for {@link FakeRunnerAdapter}.
 */
export interface FakeRunnerConfig {
  /** Human-readable adapter name. Default: "fake-runner" */
  readonly name?: string;
  /** Default outcome applied to all runs unless overridden. */
  readonly defaultOutcome?: FakeRunOutcome;
  /** Per-run outcome overrides keyed by run index (0-based). */
  readonly outcomesByRun?: ReadonlyMap<number, FakeRunOutcome>;
}

/** Record of a method call on the fake adapter, for test assertions. */
export interface FakeRunnerCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly timestamp: number;
}

/**
 * Create default stream events for a simulated run.
 *
 * @param timestamp - ISO timestamp for events.
 * @returns Array of stdout and heartbeat events.
 */
function createDefaultStreamEvents(timestamp: string): SupervisorRunOutputStream[] {
  return [
    { type: "stdout", content: "Starting execution...", timestamp },
    { type: "heartbeat", content: "", timestamp },
    { type: "stdout", content: "Execution complete.", timestamp },
  ];
}

/**
 * Fake runtime adapter for deterministic integration testing.
 *
 * Simulates the full worker lifecycle with configurable outcomes per run.
 * Each run goes through prepare → start → stream → collect → finalize,
 * with all method calls tracked in {@link calls} for assertion.
 *
 * @example
 * ```ts
 * // Success scenario (default)
 * const adapter = new FakeRunnerAdapter();
 *
 * // Failure scenario
 * const failAdapter = new FakeRunnerAdapter({
 *   defaultOutcome: { status: "failed", exitCode: 1 },
 * });
 *
 * // Mixed scenario — first run succeeds, second fails
 * const mixedAdapter = new FakeRunnerAdapter({
 *   outcomesByRun: new Map([
 *     [1, { status: "failed", exitCode: 1 }],
 *   ]),
 * });
 * ```
 */
export class FakeRunnerAdapter implements RuntimeAdapterPort {
  readonly name: string;

  /** All method calls recorded for test assertions. */
  readonly calls: FakeRunnerCall[] = [];

  /** Map of runId → run context for active runs. */
  private readonly activeRuns = new Map<string, SupervisorRunContext>();

  /** Map of runId → started flag. */
  private readonly startedRuns = new Set<string>();

  /** Map of runId → cancelled flag. */
  private readonly cancelledRuns = new Set<string>();

  /** Map of runId → finalized flag. */
  private readonly finalizedRuns = new Set<string>();

  /** Counter for generating sequential run IDs. */
  private runCounter = 0;

  private readonly defaultOutcome: FakeRunOutcome;
  private readonly outcomesByRun: ReadonlyMap<number, FakeRunOutcome>;

  constructor(config: FakeRunnerConfig = {}) {
    this.name = config.name ?? "fake-runner";
    this.defaultOutcome = config.defaultOutcome ?? {};
    this.outcomesByRun = config.outcomesByRun ?? new Map();
  }

  /**
   * Get the outcome configuration for the current run index.
   * Per-run overrides take priority over the default outcome.
   */
  private getOutcome(runIndex: number): FakeRunOutcome {
    return this.outcomesByRun.get(runIndex) ?? this.defaultOutcome;
  }

  /** Record a method call for later assertion. */
  private recordCall(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args, timestamp: Date.now() });
  }

  /**
   * Prepare a run with a deterministic run ID derived from the internal counter.
   *
   * @param context - Execution context for the run.
   * @returns Prepared run with a sequential run ID.
   * @throws Configured prepareError if set for this run index.
   */
  async prepareRun(context: SupervisorRunContext): Promise<SupervisorPreparedRun> {
    this.runCounter++;
    const runIndex = this.runCounter;
    this.recordCall("prepareRun", context);

    const outcome = this.getOutcome(runIndex);
    if (outcome.prepareError) {
      throw outcome.prepareError;
    }

    const runId = `fake-run-${String(runIndex)}`;
    this.activeRuns.set(runId, context);

    return {
      runId,
      context,
      preparedAt: new Date().toISOString(),
    };
  }

  /**
   * Mark a run as started.
   *
   * @param runId - The run ID from prepareRun.
   * @throws If the run ID is unknown, already started, or startError is configured.
   */
  async startRun(runId: string): Promise<void> {
    this.recordCall("startRun", runId);

    if (!this.activeRuns.has(runId)) {
      throw new Error(`Unknown run ID: ${runId}`);
    }
    if (this.startedRuns.has(runId)) {
      throw new Error(`Run already started: ${runId}`);
    }

    const runIndex = this.extractRunIndex(runId);
    const outcome = this.getOutcome(runIndex);
    if (outcome.startError) {
      throw outcome.startError;
    }

    this.startedRuns.add(runId);
  }

  /**
   * Yield configured stream events for the run.
   *
   * @param runId - The run ID of an active run.
   * @returns Async iterable of output events.
   * @throws If the run ID is unknown or not started.
   */
  async *streamRun(runId: string): AsyncIterable<SupervisorRunOutputStream> {
    this.recordCall("streamRun", runId);

    if (!this.activeRuns.has(runId)) {
      throw new Error(`Unknown run ID: ${runId}`);
    }
    if (!this.startedRuns.has(runId)) {
      throw new Error(`Run not started: ${runId}`);
    }

    const runIndex = this.extractRunIndex(runId);
    const outcome = this.getOutcome(runIndex);
    const events = outcome.streamEvents ?? createDefaultStreamEvents(new Date().toISOString());

    for (const event of events) {
      yield event;
    }
  }

  /**
   * Simulate cancellation of a running worker.
   *
   * @param runId - The run ID to cancel.
   * @returns Cancel result indicating whether cancellation was initiated.
   */
  async cancelRun(runId: string): Promise<SupervisorCancelResult> {
    this.recordCall("cancelRun", runId);

    if (!this.activeRuns.has(runId)) {
      return { cancelled: false, reason: "Unknown run ID" };
    }
    if (this.finalizedRuns.has(runId)) {
      return { cancelled: false, reason: "Run already finalized" };
    }
    if (this.cancelledRuns.has(runId)) {
      return { cancelled: false, reason: "Run already cancelled" };
    }

    this.cancelledRuns.add(runId);
    return { cancelled: true };
  }

  /**
   * Return configured artifact collection results.
   *
   * @param runId - The run ID of a completed run.
   * @returns Collected artifacts with configurable validity and content.
   * @throws If collectError is configured or run ID is unknown.
   */
  async collectArtifacts(runId: string): Promise<SupervisorCollectedArtifacts> {
    this.recordCall("collectArtifacts", runId);

    if (!this.activeRuns.has(runId)) {
      throw new Error(`Unknown run ID: ${runId}`);
    }

    const runIndex = this.extractRunIndex(runId);
    const outcome = this.getOutcome(runIndex);
    if (outcome.collectError) {
      throw outcome.collectError;
    }

    return {
      packetOutput: outcome.packetOutput ?? {
        packet_type: "dev_result_packet",
        schema_version: "1.0",
      },
      packetValid: outcome.packetValid ?? true,
      artifactPaths: outcome.artifactPaths ?? [],
      validationErrors: outcome.validationErrors ?? [],
    };
  }

  /**
   * Finalize the run and return terminal results.
   *
   * @param runId - The run ID to finalize.
   * @returns Final result with status, artifacts, logs, and timing.
   * @throws If finalizeError is configured, run ID is unknown, or already finalized.
   */
  async finalizeRun(runId: string): Promise<SupervisorFinalizeResult> {
    this.recordCall("finalizeRun", runId);

    if (!this.activeRuns.has(runId)) {
      throw new Error(`Unknown run ID: ${runId}`);
    }
    if (this.finalizedRuns.has(runId)) {
      throw new Error(`Run already finalized: ${runId}`);
    }

    const runIndex = this.extractRunIndex(runId);
    const outcome = this.getOutcome(runIndex);
    if (outcome.finalizeError) {
      throw outcome.finalizeError;
    }

    const status: SupervisorRunStatus = this.cancelledRuns.has(runId)
      ? "cancelled"
      : (outcome.status ?? "success");

    const exitCode =
      outcome.exitCode !== undefined
        ? outcome.exitCode
        : status === "success"
          ? 0
          : status === "cancelled"
            ? null
            : 1;

    this.finalizedRuns.add(runId);
    this.activeRuns.delete(runId);

    return {
      runId,
      status,
      packetOutput: outcome.packetOutput ?? {
        packet_type: "dev_result_packet",
        schema_version: "1.0",
      },
      artifactPaths: [...(outcome.artifactPaths ?? [])],
      logs: [
        {
          timestamp: new Date().toISOString(),
          stream: "stdout",
          content: `Fake run ${runId} completed with status: ${status}`,
        },
      ],
      exitCode,
      durationMs: outcome.durationMs ?? 1000,
      finalizedAt: new Date().toISOString(),
    };
  }

  /**
   * Reset all internal state. Useful between test cases.
   */
  reset(): void {
    this.calls.length = 0;
    this.activeRuns.clear();
    this.startedRuns.clear();
    this.cancelledRuns.clear();
    this.finalizedRuns.clear();
    this.runCounter = 0;
  }

  /**
   * Get the number of runs that have been prepared.
   */
  get totalRunsPrepared(): number {
    return this.runCounter;
  }

  /**
   * Extract the 1-based run index from a run ID like "fake-run-3".
   */
  private extractRunIndex(runId: string): number {
    const parts = runId.split("-");
    return parseInt(parts[parts.length - 1]!, 10);
  }
}
