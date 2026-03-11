/**
 * DTO for creating a new task.
 *
 * Validated by the global {@link ZodValidationPipe} using the static
 * `schema` property. Tasks are always initialised in the BACKLOG state
 * by the service layer regardless of any status value in the payload.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Valid task types matching the domain enum. */
const taskTypeValues = [
  "feature",
  "bug_fix",
  "refactor",
  "chore",
  "documentation",
  "test",
  "spike",
] as const;

/** Valid task priorities matching the domain enum. */
const priorityValues = ["critical", "high", "medium", "low"] as const;

/** Valid task sources matching the domain enum. */
const sourceValues = ["manual", "automated", "follow_up", "decomposition"] as const;

/** Valid estimated sizes matching the domain enum. */
const estimatedSizeValues = ["xs", "s", "m", "l", "xl"] as const;

/** Valid risk levels matching the domain enum. */
const riskLevelValues = ["high", "medium", "low"] as const;

/** Zod schema for task creation payloads. */
const createTaskSchema = z.object({
  /** ID of the repository this task belongs to. */
  repositoryId: z.string().min(1, "repositoryId is required"),
  /** Human-readable title (1–500 characters). */
  title: z.string().min(1, "Title is required").max(500),
  /** Optional longer description. */
  description: z.string().optional(),
  /** Task classification. */
  taskType: z.enum(taskTypeValues),
  /** Priority level. */
  priority: z.enum(priorityValues),
  /** How the task was created. Defaults to "manual". */
  source: z.enum(sourceValues).default("manual"),
  /** Optional external reference (e.g. GitHub issue URL). */
  externalRef: z.string().optional(),
  /** Optional severity for bug tasks. */
  severity: z.string().optional(),
  /** Optional acceptance criteria (JSON array of strings). */
  acceptanceCriteria: z.array(z.string()).optional(),
  /** Optional definition of done (JSON array of strings). */
  definitionOfDone: z.array(z.string()).optional(),
  /** Optional estimated size. */
  estimatedSize: z.enum(estimatedSizeValues).optional(),
  /** Optional risk level. */
  riskLevel: z.enum(riskLevelValues).optional(),
  /** Optional required capabilities (JSON array of strings). */
  requiredCapabilities: z.array(z.string()).optional(),
  /** Optional suggested file scope (glob patterns). */
  suggestedFileScope: z.array(z.string()).optional(),
});

/**
 * Data transfer object for `POST /tasks` requests.
 *
 * Properties mirror the Zod schema. The service always sets the initial
 * status to BACKLOG, so no status field is accepted.
 */
export class CreateTaskDto {
  /** Zod schema used by the global validation pipe. */
  static schema = createTaskSchema;

  repositoryId!: string;
  title!: string;
  description?: string;
  taskType!: "feature" | "bug_fix" | "refactor" | "chore" | "documentation" | "test" | "spike";
  priority!: "critical" | "high" | "medium" | "low";
  source!: "manual" | "automated" | "follow_up" | "decomposition";
  externalRef?: string;
  severity?: string;
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
  estimatedSize?: "xs" | "s" | "m" | "l" | "xl";
  riskLevel?: "high" | "medium" | "low";
  requiredCapabilities?: string[];
  suggestedFileScope?: string[];
}
