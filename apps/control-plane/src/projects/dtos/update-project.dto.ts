/**
 * DTO for updating an existing project.
 *
 * All fields are optional — only provided fields are updated. The
 * `description` field supports explicit `null` to clear the value.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for project update payloads. */
const updateProjectSchema = z.object({
  /** Updated project name (1–255 characters). */
  name: z.string().min(1).max(255).optional(),
  /** Updated description. Pass `null` to clear. */
  description: z.string().nullable().optional(),
  /** Updated owner identifier (1–255 characters). */
  owner: z.string().min(1).max(255).optional(),
});

/**
 * Data transfer object for `PUT /projects/:id` requests.
 *
 * All properties are optional. Only provided fields are persisted;
 * omitted fields remain unchanged.
 */
export class UpdateProjectDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updateProjectSchema;

  /** Updated project name. */
  name?: string;
  /** Updated description (nullable to clear). */
  description?: string | null;
  /** Updated owner identifier. */
  owner?: string;
}
