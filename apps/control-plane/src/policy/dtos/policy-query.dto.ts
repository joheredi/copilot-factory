/**
 * DTO for policy set list query parameters.
 *
 * Supports basic pagination for listing all policy sets.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for policy set list query parameters. */
const policyQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Data transfer object for `GET /policies` query parameters.
 *
 * Provides basic pagination for policy set listing.
 */
export class PolicyQueryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = policyQuerySchema;

  /** Page number (1-based). */
  page!: number;
  /** Items per page. */
  limit!: number;
}
