import { z } from "zod";

/** Valid agent roles matching the domain enum from §4. */
const roleValues = [
  "planner",
  "developer",
  "reviewer",
  "lead-reviewer",
  "merge-assist",
  "post-merge-analysis",
] as const;

/** Zod schema for prompt template creation payloads. */
const createPromptTemplateSchema = z.object({
  /** Human-readable template name (1–200 characters). */
  name: z.string().min(1, "name is required").max(200),
  /** Semantic version string (e.g. "1.0.0"). */
  version: z.string().min(1, "version is required"),
  /** Agent role this template targets. */
  role: z.enum(roleValues),
  /** The actual prompt text. */
  templateText: z.string().min(1, "templateText is required"),
  /** Optional JSON schema describing expected input variables. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Optional JSON schema describing expected output structure. */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Optional stop conditions for the agent. */
  stopConditions: z.array(z.unknown()).optional(),
});

/**
 * Data transfer object for `POST /prompt-templates` requests.
 *
 * Validated by the global Zod validation pipe. The service generates
 * the template ID and timestamps automatically.
 */
export class CreatePromptTemplateDto {
  /** Zod schema used by the global validation pipe. */
  static schema = createPromptTemplateSchema;

  name!: string;
  version!: string;
  role!: (typeof roleValues)[number];
  templateText!: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  stopConditions?: unknown[];
}
