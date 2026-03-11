/**
 * @module worker-runtime/runtime.interface
 *
 * Defines the pluggable worker runtime adapter contract.
 *
 * Every execution backend (Copilot CLI, local LLM, remote API, deterministic
 * validator) implements this interface. The orchestration layer interacts with
 * workers exclusively through this contract, enabling backends to be swapped
 * without changing orchestration code.
 *
 * **Lifecycle:**
 * ```
 * prepareRun → startRun → streamRun ──→ collectArtifacts → finalizeRun
 *                            ↓
 *                        cancelRun (optional, at any point after start)
 * ```
 *
 * **Key invariants (PRD 010 §10.8.4–10.8.5):**
 * - The adapter must mount the task packet and policy snapshot into the workspace.
 * - The adapter must inject the correct role prompt for the assigned profile.
 * - The adapter must restrict command/file access through the policy-aware wrapper.
 * - The adapter must capture stdout, stderr, and structured packet output separately.
 * - The adapter must reject completion if the final packet is missing or schema-invalid.
 *
 * @see docs/prd/010-integration-contracts.md §10.8.2
 * @see docs/prd/007-technical-architecture.md §7.9
 */

import type {
  RunContext,
  PreparedRun,
  RunOutputStream,
  CancelResult,
  CollectedArtifacts,
  FinalizeResult,
} from "./types.js";

/**
 * Pluggable worker runtime adapter interface.
 *
 * Implementations must be stateless across different runs — all per-run state
 * is tracked via the `runId` returned by {@link prepareRun}. A single adapter
 * instance may manage multiple concurrent runs.
 *
 * @see docs/prd/010-integration-contracts.md §10.8.2
 * @see docs/prd/007-technical-architecture.md §7.9
 */
export interface WorkerRuntime {
  /**
   * Human-readable name identifying this runtime adapter (e.g., "copilot-cli", "local-llm").
   *
   * Used for logging, metrics, and runtime selection.
   */
  readonly name: string;

  /**
   * Prepare the execution environment for a worker run.
   *
   * Sets up the workspace, mounts the task packet and policy snapshot,
   * validates that the execution environment is ready, and generates a
   * unique run ID. This step must be idempotent — calling it multiple times
   * with the same context should produce independent runs.
   *
   * @param context - Complete execution context for the run.
   * @returns A prepared run containing the assigned run ID and metadata.
   * @throws If the workspace cannot be prepared or the context is invalid.
   */
  prepareRun(context: RunContext): Promise<PreparedRun>;

  /**
   * Start execution of a previously prepared run.
   *
   * Launches the worker process with the configured role prompt, policy
   * restrictions, and timeout constraints. After this call returns, the
   * worker is actively executing and producing output.
   *
   * Must be called exactly once per prepared run. Calling on an already-started
   * or finalized run must throw an error.
   *
   * @param runId - The unique run ID returned by {@link prepareRun}.
   * @throws If the run ID is unknown, already started, or the process fails to launch.
   */
  startRun(runId: string): Promise<void>;

  /**
   * Stream live output events from a running worker.
   *
   * Returns an async iterable that yields output events (stdout, stderr,
   * system messages, heartbeats) as they are produced. The iterable
   * completes when the worker process exits or is cancelled.
   *
   * Consumers should use heartbeat events to track worker liveness. If
   * heartbeats stop arriving within the configured threshold + grace period,
   * the run should be considered stale.
   *
   * May be called multiple times — each call returns an independent stream
   * from the current point in time (not from the beginning).
   *
   * @param runId - The unique run ID of an active run.
   * @returns An async iterable of output stream events.
   * @throws If the run ID is unknown or has not been started.
   */
  streamRun(runId: string): AsyncIterable<RunOutputStream>;

  /**
   * Request cancellation of a running worker.
   *
   * Sends a cancellation signal to the worker process. The cancellation is
   * best-effort — the worker may take some time to shut down gracefully.
   * After cancellation, {@link collectArtifacts} and {@link finalizeRun}
   * should still be called to clean up.
   *
   * Calling cancel on an already-completed or already-cancelled run is a
   * no-op and returns `{ cancelled: false }` with a reason.
   *
   * @param runId - The unique run ID of the run to cancel.
   * @returns Result indicating whether cancellation was initiated.
   */
  cancelRun(runId: string): Promise<CancelResult>;

  /**
   * Collect output artifacts from a completed or cancelled run.
   *
   * Gathers all output files, the structured result packet, and validates
   * the packet against the expected output schema. Must be called after the
   * worker process has exited (either normally, via cancellation, or timeout).
   *
   * The adapter must reject the packet if it is missing or schema-invalid
   * (PRD 010 §10.8.5). In that case, `packetValid` will be `false` and
   * `validationErrors` will contain the reasons.
   *
   * @param runId - The unique run ID of a completed run.
   * @returns The collected artifacts including packet output and validation status.
   * @throws If the run ID is unknown or the worker is still running.
   */
  collectArtifacts(runId: string): Promise<CollectedArtifacts>;

  /**
   * Finalize the run and perform cleanup.
   *
   * Produces the terminal {@link FinalizeResult} with the run status,
   * collected artifacts, logs, exit code, and timing information. After
   * this call, all per-run resources (temp files, process handles, etc.)
   * should be released.
   *
   * Must be called exactly once per run as the final lifecycle step.
   * After finalization, no other methods may be called with this run ID.
   *
   * @param runId - The unique run ID of the run to finalize.
   * @returns The terminal result of the run.
   * @throws If the run ID is unknown or has already been finalized.
   */
  finalizeRun(runId: string): Promise<FinalizeResult>;
}
