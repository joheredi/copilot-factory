import { z } from "zod";

/** Zod schema for pool list query parameters. */
const poolFilterQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Filter by pool type. */
  poolType: z.string().optional(),
  /** Filter by enabled status (true/false as string from query). */
  enabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

/**
 * Data transfer object for `GET /pools` query parameters.
 *
 * Supports pagination and optional filtering by poolType and enabled status.
 */
export class PoolFilterQueryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = poolFilterQuerySchema;

  page!: number;
  limit!: number;
  poolType?: string;
  enabled?: boolean;
}
