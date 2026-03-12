/**
 * Infrastructure adapter implementing {@link ResultPacketValidatorPort} for crash recovery.
 *
 * Validates filesystem-persisted result packets by parsing them as JSON and
 * running the content through the {@link DevResultPacketSchema} Zod validator.
 * This catches both malformed JSON and structurally invalid packets.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 * @module @factory/infrastructure/crash-recovery/result-packet-validator
 */

import type { ResultPacketValidatorPort, ResultPacketValidation } from "@factory/application";
import { DevResultPacketSchema } from "@factory/schemas";

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a {@link ResultPacketValidatorPort} that validates content against
 * the {@link DevResultPacketSchema}.
 *
 * The validator checks:
 * 1. Whether the raw content is valid JSON
 * 2. Whether the parsed object matches the DevResultPacket Zod schema
 *
 * Returns `{ valid: true, data }` on success, or `{ valid: false, reason }`
 * with a descriptive error message on failure.
 *
 * @returns A ResultPacketValidatorPort implementation.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.5 — DevResultPacket
 */
export function createResultPacketValidator(): ResultPacketValidatorPort {
  return {
    validate(content: string): ResultPacketValidation {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { valid: false, reason: "Content is not valid JSON" };
      }

      const result = DevResultPacketSchema.safeParse(parsed);
      if (result.success) {
        return { valid: true, data: result.data };
      }

      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      return { valid: false, reason: `Schema validation failed: ${issues}` };
    },
  };
}
