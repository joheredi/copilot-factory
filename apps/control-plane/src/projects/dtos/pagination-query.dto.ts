/**
 * DTO for pagination query parameters.
 *
 * Used on list endpoints to control page-based pagination. Zod coerces
 * string query parameters to numbers and applies defaults.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for pagination query parameters. */
const paginationQuerySchema = z.object({
  /** Page number (1-based). Defaults to 1. */
  page: z.coerce.number().int().min(1).default(1),
  /** Items per page (1–100). Defaults to 20. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Data transfer object for pagination query parameters.
 *
 * Applied to `@Query()` parameters on list endpoints. Zod coerces the
 * raw string values from the query string into validated numbers.
 */
export class PaginationQueryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = paginationQuerySchema;

  /** Page number (1-based). */
  page!: number;
  /** Items per page. */
  limit!: number;
}
