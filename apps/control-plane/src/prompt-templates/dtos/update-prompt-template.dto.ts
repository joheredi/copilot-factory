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

/** Zod schema for prompt template update payloads. */
const updatePromptTemplateSchema = z.object({
  /** Updated template name (1–200 characters). */
  name: z.string().min(1).max(200).optional(),
  /** Updated semantic version string. */
  version: z.string().min(1).optional(),
  /** Updated agent role. */
  role: z.enum(roleValues).optional(),
  /** Updated prompt text. */
  templateText: z.string().min(1).optional(),
  /** Updated input schema. Pass `null` to clear. */
  inputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated output schema. Pass `null` to clear. */
  outputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Updated stop conditions. Pass `null` to clear. */
  stopConditions: z.array(z.unknown()).nullable().optional(),
});

/**
 * Data transfer object for `PUT /prompt-templates/:id` requests.
 *
 * All fields are optional — only provided fields are updated.
 */
export class UpdatePromptTemplateDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updatePromptTemplateSchema;

  name?: string;
  version?: string;
  role?:
    | "planner"
    | "developer"
    | "reviewer"
    | "lead-reviewer"
    | "merge-assist"
    | "post-merge-analysis";
  templateText?: string;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  stopConditions?: unknown[] | null;
}
