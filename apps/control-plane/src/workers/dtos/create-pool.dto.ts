import { z } from "zod";

/** Valid pool types matching the domain enum from §2.3. */
const poolTypeValues = [
  "developer",
  "reviewer",
  "lead-reviewer",
  "merge-assist",
  "planner",
] as const;

/** Zod schema for worker pool creation payloads. */
const createPoolSchema = z.object({
  /** Human-readable pool name (1–200 characters). */
  name: z.string().min(1, "name is required").max(200),
  /** Functional role this pool serves. */
  poolType: z.enum(poolTypeValues),
  /** AI provider identifier (e.g. "copilot", "openai"). */
  provider: z.string().optional(),
  /** Runtime environment identifier (e.g. "copilot-cli", "docker"). */
  runtime: z.string().optional(),
  /** AI model identifier (e.g. "gpt-4", "claude-3-opus"). */
  model: z.string().optional(),
  /** Maximum concurrent workers (1–100). Defaults to 1. */
  maxConcurrency: z.number().int().min(1).max(100).default(1),
  /** Default timeout in seconds for worker runs. */
  defaultTimeoutSec: z.number().int().min(1).optional(),
  /** Default token budget per worker run. */
  defaultTokenBudget: z.number().int().min(1).optional(),
  /** Cost profile identifier. */
  costProfile: z.string().optional(),
  /** Capability strings for task-to-pool matching. */
  capabilities: z.array(z.string()).optional(),
  /** Repository scope rules restricting which repos this pool operates on. */
  repoScopeRules: z.record(z.string(), z.unknown()).optional(),
  /** Whether the pool is active. Defaults to true. */
  enabled: z.boolean().default(true),
});

/**
 * Data transfer object for `POST /pools` requests.
 *
 * Validated by the global Zod validation pipe. The service generates
 * the pool ID and timestamps automatically.
 */
export class CreatePoolDto {
  /** Zod schema used by the global validation pipe. */
  static schema = createPoolSchema;

  name!: string;
  poolType!: (typeof poolTypeValues)[number];
  provider?: string;
  runtime?: string;
  model?: string;
  maxConcurrency!: number;
  defaultTimeoutSec?: number;
  defaultTokenBudget?: number;
  costProfile?: string;
  capabilities?: string[];
  repoScopeRules?: Record<string, unknown>;
  enabled!: boolean;
}
