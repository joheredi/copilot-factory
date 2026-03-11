/**
 * Zod schema for ValidationResultPacket — the canonical output from
 * deterministic validation.
 *
 * The ValidationResultPacket is produced by the validation runner after
 * executing the configured validation checks (tests, lint, build, etc.)
 * at a specific point in the workflow. It captures the overall status
 * and individual check results.
 *
 * @module @factory/schemas/validation-result-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10 ValidationResultPacket
 */

import { z } from "zod";

import {
  PacketStatusSchema,
  ValidationRunScopeSchema,
  ValidationCheckResultSchema,
} from "./shared.js";

// ─── Nested Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for the `details` section of a ValidationResultPacket.
 *
 * Contains the validation run scope and individual check results.
 *
 * Fields:
 * - `run_scope` — when the validation was triggered (pre-dev, during-dev, pre-review, pre-merge, post-merge)
 * - `checks` — array of individual validation check results
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10.2 details
 */
export const ValidationResultPacketDetailsSchema = z.object({
  run_scope: ValidationRunScopeSchema,
  checks: z.array(ValidationCheckResultSchema),
});

/** Inferred TypeScript type for {@link ValidationResultPacketDetailsSchema}. */
export type ValidationResultPacketDetails = z.infer<typeof ValidationResultPacketDetailsSchema>;

// ─── ValidationResultPacket Top-Level Schema ────────────────────────────────

/**
 * Zod schema for ValidationResultPacket — the canonical validation output
 * contract.
 *
 * Produced by the deterministic validation runner and validated by the
 * orchestrator before gating state transitions.
 *
 * Required fields (§8.10.2):
 * - `packet_type` — literal `"validation_result_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task this validation belongs to
 * - `repository_id` — the target repository
 * - `validation_run_id` — unique identifier for this validation run
 * - `status` — outcome: success, failed, partial, or blocked
 * - `summary` — human-readable summary of validation results
 * - `details` — run scope and individual check results
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10 ValidationResultPacket
 */
export const ValidationResultPacketSchema = z.object({
  packet_type: z.literal("validation_result_packet"),
  schema_version: z.literal("1.0"),
  created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
  task_id: z.string().min(1, "task_id must not be empty"),
  repository_id: z.string().min(1, "repository_id must not be empty"),
  validation_run_id: z.string().min(1, "validation_run_id must not be empty"),
  status: PacketStatusSchema,
  summary: z.string().min(1, "summary must not be empty"),
  details: ValidationResultPacketDetailsSchema,
});

/** Inferred TypeScript type for {@link ValidationResultPacketSchema}. */
export type ValidationResultPacket = z.infer<typeof ValidationResultPacketSchema>;
