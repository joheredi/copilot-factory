/**
 * DTO for updating an existing task's metadata.
 *
 * All fields are optional — only provided fields are updated. Status
 * transitions are not allowed through this endpoint (they go through
 * the transition service).
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for task update payloads. */
const updateTaskSchema = z.object({
  /** Updated title (1–500 characters). */
  title: z.string().min(1).max(500).optional(),
  /** Updated description. Pass `null` to clear. */
  description: z.string().nullable().optional(),
  /** Updated priority. */
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  /** Updated external reference. Pass `null` to clear. */
  externalRef: z.string().nullable().optional(),
  /** Updated severity. Pass `null` to clear. */
  severity: z.string().nullable().optional(),
  /** Updated acceptance criteria. */
  acceptanceCriteria: z.array(z.string()).nullable().optional(),
  /** Updated definition of done. */
  definitionOfDone: z.array(z.string()).nullable().optional(),
  /** Updated estimated size. */
  estimatedSize: z.enum(["xs", "s", "m", "l", "xl"]).nullable().optional(),
  /** Updated risk level. */
  riskLevel: z.enum(["high", "medium", "low"]).nullable().optional(),
  /** Updated required capabilities. */
  requiredCapabilities: z.array(z.string()).nullable().optional(),
  /** Updated suggested file scope. */
  suggestedFileScope: z.array(z.string()).nullable().optional(),
  /** Current version for optimistic concurrency control. */
  version: z.number().int().min(1, "version is required for optimistic concurrency"),
});

/**
 * Data transfer object for `PUT /tasks/:id` requests.
 *
 * All metadata fields are optional. The `version` field is required to
 * enable optimistic concurrency control — the update is rejected with
 * 409 Conflict if the stored version does not match.
 */
export class UpdateTaskDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updateTaskSchema;

  title?: string;
  description?: string | null;
  priority?: "critical" | "high" | "medium" | "low";
  externalRef?: string | null;
  severity?: string | null;
  acceptanceCriteria?: string[] | null;
  definitionOfDone?: string[] | null;
  estimatedSize?: "xs" | "s" | "m" | "l" | "xl" | null;
  riskLevel?: "high" | "medium" | "low" | null;
  requiredCapabilities?: string[] | null;
  suggestedFileScope?: string[] | null;
  version!: number;
}
