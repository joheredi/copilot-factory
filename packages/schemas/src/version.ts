/**
 * Schema version parsing, validation, and compatibility checking.
 *
 * Implements the versioning contract from PRD 008 §8.15:
 * - Version format: `major.minor` (e.g., "1.0", "1.1", "2.0")
 * - Minor increments: additive optional fields only (backward compatible)
 * - Major increments: breaking changes (not backward compatible)
 * - Multi-version support: orchestrator accepts any valid packet within
 *   the same major version family
 *
 * @module @factory/schemas/version
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.15 Schema Versioning
 */

import { z } from "zod";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Parsed representation of a schema version string.
 *
 * @example
 * ```ts
 * const v = parseSchemaVersion("1.2");
 * // => { major: 1, minor: 2 }
 * ```
 */
export interface ParsedSchemaVersion {
  readonly major: number;
  readonly minor: number;
}

/**
 * Result of a packet version validation check.
 *
 * When `compatible` is false, `reason` describes why the version
 * is incompatible (e.g., major version mismatch).
 */
export interface VersionValidationResult {
  readonly compatible: boolean;
  readonly parsed: ParsedSchemaVersion;
  readonly reason?: string;
}

// ─── Version Format ─────────────────────────────────────────────────────────

/**
 * Regex for the `major.minor` version format.
 * Both major and minor must be non-negative integers with no leading zeros
 * (except "0" itself).
 */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// ─── Zod Schema ─────────────────────────────────────────────────────────────

/**
 * Zod schema that validates a `major.minor` version string.
 *
 * Accepts strings like "1.0", "1.1", "2.0", "10.3".
 * Rejects strings like "1", "1.0.0", "v1.0", "1.0a", "01.0".
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.15
 */
export const SchemaVersionSchema = z
  .string()
  .regex(VERSION_PATTERN, 'schema_version must be in "major.minor" format (e.g., "1.0")');

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parses a schema version string into its major and minor components.
 *
 * @param version - A version string in `major.minor` format.
 * @returns The parsed major and minor version numbers.
 * @throws {Error} If the version string is not in valid `major.minor` format.
 *
 * @example
 * ```ts
 * parseSchemaVersion("1.0")  // => { major: 1, minor: 0 }
 * parseSchemaVersion("2.3")  // => { major: 2, minor: 3 }
 * parseSchemaVersion("bad")  // throws Error
 * ```
 */
export function parseSchemaVersion(version: string): ParsedSchemaVersion {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(
      `Invalid schema version "${version}": must be in "major.minor" format (e.g., "1.0")`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

// ─── Compatibility ──────────────────────────────────────────────────────────

/**
 * Checks whether a schema version string is compatible with an expected
 * major version.
 *
 * Two versions are compatible when they share the same major version number.
 * Minor version differences are always compatible per the versioning contract
 * (§8.15: minor increments add optional fields only).
 *
 * @param version - The schema version string to check.
 * @param expectedMajor - The major version number the orchestrator expects.
 * @returns `true` if the version is within the expected major family.
 * @throws {Error} If the version string is not in valid format.
 *
 * @example
 * ```ts
 * isVersionCompatible("1.0", 1)  // => true
 * isVersionCompatible("1.5", 1)  // => true
 * isVersionCompatible("2.0", 1)  // => false
 * ```
 */
export function isVersionCompatible(version: string, expectedMajor: number): boolean {
  const parsed = parseSchemaVersion(version);
  return parsed.major === expectedMajor;
}

/**
 * Validates a packet's `schema_version` field against an expected major version.
 *
 * This is the primary entry point for the orchestrator to check that an
 * incoming packet's version is within the acceptable major version family.
 * Returns a detailed result including the parsed version and a reason
 * string when incompatible.
 *
 * @param packet - Any object with a `schema_version` string field.
 * @param expectedMajor - The major version number the orchestrator expects.
 * @returns A {@link VersionValidationResult} indicating compatibility.
 *
 * @example
 * ```ts
 * const result = validatePacketVersion({ schema_version: "1.0" }, 1);
 * // => { compatible: true, parsed: { major: 1, minor: 0 } }
 *
 * const result2 = validatePacketVersion({ schema_version: "2.0" }, 1);
 * // => { compatible: false, parsed: { major: 2, minor: 0 },
 * //      reason: "Expected major version 1 but got 2" }
 * ```
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.15
 */
export function validatePacketVersion(
  packet: { readonly schema_version: string },
  expectedMajor: number,
): VersionValidationResult {
  let parsed: ParsedSchemaVersion;
  try {
    parsed = parseSchemaVersion(packet.schema_version);
  } catch {
    return {
      compatible: false,
      parsed: { major: -1, minor: -1 },
      reason: `Invalid schema_version format "${packet.schema_version}": must be "major.minor"`,
    };
  }

  if (parsed.major !== expectedMajor) {
    return {
      compatible: false,
      parsed,
      reason: `Expected major version ${String(expectedMajor)} but got ${String(parsed.major)}`,
    };
  }

  return { compatible: true, parsed };
}
