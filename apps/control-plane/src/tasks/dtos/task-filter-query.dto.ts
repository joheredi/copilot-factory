/**
 * DTO for task list filtering and pagination query parameters.
 *
 * Extends basic pagination with task-specific filters. All filter
 * fields are optional — when omitted, no filtering is applied for
 * that dimension.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for task filter query parameters. */
const taskFilterQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Filter by task status (e.g. "BACKLOG", "READY", "IN_DEVELOPMENT"). */
  status: z.string().optional(),
  /** Filter by repository ID. */
  repositoryId: z.string().optional(),
  /** Filter by priority (e.g. "critical", "high", "medium", "low"). */
  priority: z.string().optional(),
  /** Filter by task type (e.g. "feature", "bug_fix", "refactor"). */
  taskType: z.string().optional(),
});

/**
 * Data transfer object for `GET /tasks` query parameters.
 *
 * Combines pagination with optional task-specific filters. Zod coerces
 * raw string values from the query string into validated types.
 */
export class TaskFilterQueryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = taskFilterQuerySchema;

  /** Page number (1-based). */
  page!: number;
  /** Items per page. */
  limit!: number;
  /** Filter by task status. */
  status?: string;
  /** Filter by repository ID. */
  repositoryId?: string;
  /** Filter by priority. */
  priority?: string;
  /** Filter by task type. */
  taskType?: string;
}
