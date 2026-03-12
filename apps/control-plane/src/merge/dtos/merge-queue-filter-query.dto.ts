/**
 * DTO for merge queue list query parameters.
 *
 * Validates and coerces pagination and filter parameters for the
 * `GET /merge-queue` endpoint. Uses Zod for runtime validation
 * with sensible defaults for page (1) and limit (20).
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T098-build-merge-queue-view.md}
 */
import { z } from "zod";

/** Zod schema for merge queue filter query parameters. */
const mergeQueueFilterQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Filter by merge queue item status (e.g. "ENQUEUED", "MERGING"). */
  status: z.string().optional(),
  /** Filter by repository ID. */
  repositoryId: z.string().optional(),
});

/**
 * Query parameter DTO for the merge queue list endpoint.
 *
 * The Zod schema attached to the class is used by the global
 * validation pipe to parse and validate incoming query strings.
 */
export class MergeQueueFilterQueryDto {
  static schema = mergeQueueFilterQuerySchema;

  page!: number;
  limit!: number;
  status?: string;
  repositoryId?: string;
}
