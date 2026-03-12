import { z } from "zod";

/** Zod schema for agent profile update payloads. */
const updateProfileSchema = z.object({
  /** Updated prompt template reference. Pass `null` to clear. */
  promptTemplateId: z.string().nullable().optional(),
  /** Updated tool policy reference. Pass `null` to clear. */
  toolPolicyId: z.string().nullable().optional(),
  /** Updated command policy reference. Pass `null` to clear. */
  commandPolicyId: z.string().nullable().optional(),
  /** Updated file scope policy reference. Pass `null` to clear. */
  fileScopePolicyId: z.string().nullable().optional(),
  /** Updated validation policy reference. Pass `null` to clear. */
  validationPolicyId: z.string().nullable().optional(),
  /** Updated review policy reference. Pass `null` to clear. */
  reviewPolicyId: z.string().nullable().optional(),
  /** Updated budget policy reference. Pass `null` to clear. */
  budgetPolicyId: z.string().nullable().optional(),
  /** Updated retry policy reference. Pass `null` to clear. */
  retryPolicyId: z.string().nullable().optional(),
});

/**
 * Data transfer object for `PUT /pools/:id/profiles/:profileId` requests.
 *
 * All fields are optional — only provided fields are updated.
 */
export class UpdateProfileDto {
  /** Zod schema used by the global validation pipe. */
  static schema = updateProfileSchema;

  promptTemplateId?: string | null;
  toolPolicyId?: string | null;
  commandPolicyId?: string | null;
  fileScopePolicyId?: string | null;
  validationPolicyId?: string | null;
  reviewPolicyId?: string | null;
  budgetPolicyId?: string | null;
  retryPolicyId?: string | null;
}
