/**
 * DTO for updating an existing policy set.
 *
 * All fields are optional — only provided fields are updated.
 * The policy JSON fields accept arbitrary objects that are stored
 * as JSON in the database.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for policy set update payloads. */
const updatePolicySetSchema = z.object({
  /** Updated human-readable name. */
  name: z.string().min(1).max(200).optional(),
  /** Updated version string (e.g. "1.0.0", "2"). */
  version: z.string().min(1).max(50).optional(),
  /** Updated scheduling policy JSON. */
  schedulingPolicyJson: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated review policy JSON. */
  reviewPolicyJson: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated merge policy JSON. */
  mergePolicyJson: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated security policy JSON. */
  securityPolicyJson: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated validation policy JSON. */
  validationPolicyJson: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated budget policy JSON. */
  budgetPolicyJson: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * Data transfer object for `PUT /policies/:id` requests.
 *
 * All fields are optional. Only provided fields are persisted;
 * omitted fields remain unchanged.
 */
export class UpdatePolicySetDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updatePolicySetSchema;

  name?: string;
  version?: string;
  schedulingPolicyJson?: Record<string, unknown> | null;
  reviewPolicyJson?: Record<string, unknown> | null;
  mergePolicyJson?: Record<string, unknown> | null;
  securityPolicyJson?: Record<string, unknown> | null;
  validationPolicyJson?: Record<string, unknown> | null;
  budgetPolicyJson?: Record<string, unknown> | null;
}
