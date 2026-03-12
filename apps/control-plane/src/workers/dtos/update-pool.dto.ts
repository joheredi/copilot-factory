import { z } from "zod";

/** Valid pool types matching the domain enum from §2.3. */
const poolTypeValues = [
  "developer",
  "reviewer",
  "lead-reviewer",
  "merge-assist",
  "planner",
] as const;

/** Zod schema for worker pool update payloads. */
const updatePoolSchema = z.object({
  /** Updated pool name (1–200 characters). */
  name: z.string().min(1).max(200).optional(),
  /** Updated pool type. */
  poolType: z.enum(poolTypeValues).optional(),
  /** Updated AI provider. Pass `null` to clear. */
  provider: z.string().nullable().optional(),
  /** Updated runtime. Pass `null` to clear. */
  runtime: z.string().nullable().optional(),
  /** Updated model. Pass `null` to clear. */
  model: z.string().nullable().optional(),
  /** Updated max concurrency (1–100). */
  maxConcurrency: z.number().int().min(1).max(100).optional(),
  /** Updated default timeout. Pass `null` to clear. */
  defaultTimeoutSec: z.number().int().min(1).nullable().optional(),
  /** Updated default token budget. Pass `null` to clear. */
  defaultTokenBudget: z.number().int().min(1).nullable().optional(),
  /** Updated cost profile. Pass `null` to clear. */
  costProfile: z.string().nullable().optional(),
  /** Updated capabilities. Pass `null` to clear. */
  capabilities: z.array(z.string()).nullable().optional(),
  /** Updated repo scope rules. Pass `null` to clear. */
  repoScopeRules: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Enable or disable the pool. */
  enabled: z.boolean().optional(),
});

/**
 * Data transfer object for `PUT /pools/:id` requests.
 *
 * All fields are optional — only provided fields are updated.
 */
export class UpdatePoolDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updatePoolSchema;

  name?: string;
  poolType?: "developer" | "reviewer" | "lead-reviewer" | "merge-assist" | "planner";
  provider?: string | null;
  runtime?: string | null;
  model?: string | null;
  maxConcurrency?: number;
  defaultTimeoutSec?: number | null;
  defaultTokenBudget?: number | null;
  costProfile?: string | null;
  capabilities?: string[] | null;
  repoScopeRules?: Record<string, unknown> | null;
  enabled?: boolean;
}
