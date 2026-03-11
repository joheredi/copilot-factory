/**
 * Ports for the validation packet emitter service.
 *
 * Defines the contract for persisting {@link ValidationResultPacket} artifacts
 * and the parameters needed to assemble a packet from a validation run.
 *
 * @module @factory/application/ports/validation-packet-emitter
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10 ValidationResultPacket
 * @see {@link file://docs/backlog/tasks/T056-validation-packet-emission.md}
 */

import type { ValidationRunScope } from "@factory/domain";
import type { ValidationResultPacket } from "@factory/schemas";

import type { ValidationRunResult } from "./validation-runner.ports.js";

// ─── Artifact Persistence Port ──────────────────────────────────────────────

/**
 * Port for persisting a {@link ValidationResultPacket} as an immutable artifact.
 *
 * Implementations store the packet as a JSON file in the run-level artifact
 * directory and return the storage path for audit and retrieval.
 */
export interface ValidationPacketArtifactPort {
  /**
   * Persist a validation result packet as an artifact.
   *
   * @param validationRunId - Unique identifier for this validation run.
   * @param packet - The schema-valid packet to persist.
   * @returns The storage path where the artifact was written.
   */
  persist(validationRunId: string, packet: ValidationResultPacket): Promise<string>;
}

// ─── Emission Parameters ────────────────────────────────────────────────────

/**
 * Parameters required to assemble and emit a {@link ValidationResultPacket}.
 *
 * Combines the orchestrator-owned context (IDs, run scope) with the
 * validation run result produced by the runner service.
 */
export interface EmitValidationPacketParams {
  /** Identifier of the task being validated. */
  readonly taskId: string;

  /** Identifier of the repository being validated against. */
  readonly repositoryId: string;

  /** Unique identifier for this validation run instance. */
  readonly validationRunId: string;

  /**
   * When in the workflow this validation was triggered.
   * Determines the `run_scope` field in the emitted packet.
   */
  readonly runScope: ValidationRunScope;

  /**
   * The aggregated result from the validation runner service.
   * Contains per-check outcomes, overall status, and summary.
   */
  readonly validationRunResult: ValidationRunResult;
}

// ─── Emission Result ────────────────────────────────────────────────────────

/**
 * Result of emitting a {@link ValidationResultPacket}.
 *
 * Contains both the validated packet object and the artifact storage path.
 */
export interface EmitValidationPacketResult {
  /** The assembled and schema-validated packet. */
  readonly packet: ValidationResultPacket;

  /** Filesystem path where the packet artifact was persisted. */
  readonly artifactPath: string;
}
