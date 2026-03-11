/**
 * DTO for updating an existing repository.
 *
 * All fields are optional — only provided fields are updated. The
 * `credentialProfileId` field supports explicit `null` to clear.
 *
 * @module @factory/control-plane
 */
import { z } from "zod";

/** Zod schema for repository update payloads. */
const updateRepositorySchema = z.object({
  /** Updated repository name (1–255 characters). */
  name: z.string().min(1).max(255).optional(),
  /** Updated Git remote URL. */
  remoteUrl: z.string().url().optional(),
  /** Updated default branch name. */
  defaultBranch: z.string().optional(),
  /** Updated local checkout strategy. */
  localCheckoutStrategy: z.enum(["worktree", "clone"]).optional(),
  /** Updated credential profile ID. Pass `null` to clear. */
  credentialProfileId: z.string().nullable().optional(),
  /** Updated operational status. */
  status: z.string().optional(),
});

/**
 * Data transfer object for `PUT /repositories/:id` requests.
 *
 * All properties are optional. Only provided fields are persisted;
 * omitted fields remain unchanged.
 */
export class UpdateRepositoryDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updateRepositorySchema;

  /** Updated repository name. */
  name?: string;
  /** Updated Git remote URL. */
  remoteUrl?: string;
  /** Updated default branch name. */
  defaultBranch?: string;
  /** Updated checkout strategy. */
  localCheckoutStrategy?: "worktree" | "clone";
  /** Updated credential profile ID (nullable to clear). */
  credentialProfileId?: string | null;
  /** Updated operational status. */
  status?: string;
}
