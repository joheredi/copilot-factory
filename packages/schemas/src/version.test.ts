/**
 * Tests for schema version parsing, validation, and compatibility checking.
 *
 * The versioning contract (PRD 008 §8.15) is critical for safe schema
 * evolution. If version validation is broken, the orchestrator could either:
 * - Accept packets from an incompatible major version (data corruption)
 * - Reject packets from a compatible minor version (false rejections)
 *
 * These tests cover:
 * - Format validation (SchemaVersionSchema)
 * - Parsing (parseSchemaVersion)
 * - Compatibility checking (isVersionCompatible)
 * - Packet-level validation (validatePacketVersion)
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.15
 */

import { describe, it, expect } from "vitest";

import {
  SchemaVersionSchema,
  parseSchemaVersion,
  isVersionCompatible,
  validatePacketVersion,
} from "./version.js";
import type { ParsedSchemaVersion, VersionValidationResult } from "./version.js";

// ─── SchemaVersionSchema ────────────────────────────────────────────────────

describe("SchemaVersionSchema", () => {
  /**
   * Valid version strings must be accepted because minor-version evolution
   * within the same major family is the expected upgrade path.
   */
  describe("should accept valid major.minor versions", () => {
    const validVersions = ["0.0", "0.1", "1.0", "1.1", "1.99", "2.0", "10.3", "99.99"];

    for (const version of validVersions) {
      it(`accepts "${version}"`, () => {
        expect(SchemaVersionSchema.safeParse(version).success).toBe(true);
      });
    }
  });

  /**
   * Invalid formats must be rejected to prevent version strings that
   * cannot be reliably parsed into major/minor components.
   */
  describe("should reject invalid version formats", () => {
    const invalidVersions = [
      { input: "", reason: "empty string" },
      { input: "1", reason: "missing minor component" },
      { input: "1.0.0", reason: "semver with patch" },
      { input: "v1.0", reason: "v-prefix" },
      { input: "1.0a", reason: "trailing alpha" },
      { input: "a.0", reason: "non-numeric major" },
      { input: "1.a", reason: "non-numeric minor" },
      { input: "01.0", reason: "leading zero in major" },
      { input: "1.00", reason: "leading zero in minor" },
      { input: " 1.0", reason: "leading space" },
      { input: "1.0 ", reason: "trailing space" },
      { input: "-1.0", reason: "negative major" },
      { input: "1.-1", reason: "negative minor" },
      { input: "1.0.0.0", reason: "four components" },
      { input: "latest", reason: "non-numeric string" },
    ];

    for (const { input, reason } of invalidVersions) {
      it(`rejects "${input}" (${reason})`, () => {
        const result = SchemaVersionSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    }
  });

  /**
   * Non-string types must be rejected because schema_version is always
   * a string field in the packet contract.
   */
  it("should reject non-string types", () => {
    expect(SchemaVersionSchema.safeParse(1.0).success).toBe(false);
    expect(SchemaVersionSchema.safeParse(null).success).toBe(false);
    expect(SchemaVersionSchema.safeParse(undefined).success).toBe(false);
    expect(SchemaVersionSchema.safeParse({ major: 1, minor: 0 }).success).toBe(false);
  });
});

// ─── parseSchemaVersion ─────────────────────────────────────────────────────

describe("parseSchemaVersion", () => {
  /**
   * Core parsing correctness — ensures the function extracts the right
   * major and minor numbers from well-formed version strings.
   */
  it("should parse valid version strings into major and minor components", () => {
    expect(parseSchemaVersion("1.0")).toEqual({ major: 1, minor: 0 });
    expect(parseSchemaVersion("2.3")).toEqual({ major: 2, minor: 3 });
    expect(parseSchemaVersion("0.1")).toEqual({ major: 0, minor: 1 });
    expect(parseSchemaVersion("10.99")).toEqual({ major: 10, minor: 99 });
  });

  /**
   * The return type must satisfy ParsedSchemaVersion to ensure
   * downstream code gets the correct shape.
   */
  it("should return a ParsedSchemaVersion-shaped object", () => {
    const result: ParsedSchemaVersion = parseSchemaVersion("1.0");
    expect(result).toHaveProperty("major");
    expect(result).toHaveProperty("minor");
    expect(typeof result.major).toBe("number");
    expect(typeof result.minor).toBe("number");
  });

  /**
   * Invalid formats must throw so callers don't silently get garbage data.
   * This is especially important when processing untrusted packet data.
   */
  describe("should throw on invalid version strings", () => {
    const invalidInputs = ["", "1", "1.0.0", "v1.0", "abc", "01.0"];

    for (const input of invalidInputs) {
      it(`throws for "${input}"`, () => {
        expect(() => parseSchemaVersion(input)).toThrow(/Invalid schema version/);
      });
    }
  });
});

// ─── isVersionCompatible ────────────────────────────────────────────────────

describe("isVersionCompatible", () => {
  /**
   * Same-major versions must be compatible because minor increments only
   * add optional fields (§8.15). This is the core multi-version contract.
   */
  it("should return true for same-major versions", () => {
    expect(isVersionCompatible("1.0", 1)).toBe(true);
    expect(isVersionCompatible("1.1", 1)).toBe(true);
    expect(isVersionCompatible("1.99", 1)).toBe(true);
    expect(isVersionCompatible("2.0", 2)).toBe(true);
    expect(isVersionCompatible("0.5", 0)).toBe(true);
  });

  /**
   * Cross-major versions must be incompatible because major increments
   * introduce breaking changes (§8.15). Accepting a v2 packet with a v1
   * schema could cause data corruption or missing required fields.
   */
  it("should return false for different-major versions", () => {
    expect(isVersionCompatible("2.0", 1)).toBe(false);
    expect(isVersionCompatible("1.0", 2)).toBe(false);
    expect(isVersionCompatible("3.0", 1)).toBe(false);
    expect(isVersionCompatible("0.0", 1)).toBe(false);
  });

  /**
   * Invalid version strings must throw, not silently return false.
   * A malformed version indicates a corrupted packet, not just an
   * incompatible version.
   */
  it("should throw for invalid version strings", () => {
    expect(() => isVersionCompatible("bad", 1)).toThrow(/Invalid schema version/);
  });
});

// ─── validatePacketVersion ──────────────────────────────────────────────────

describe("validatePacketVersion", () => {
  /**
   * Compatible packets must return { compatible: true } with no reason
   * string. This is the happy path the orchestrator relies on.
   */
  it("should return compatible=true for same-major packets", () => {
    const result: VersionValidationResult = validatePacketVersion({ schema_version: "1.0" }, 1);
    expect(result.compatible).toBe(true);
    expect(result.parsed).toEqual({ major: 1, minor: 0 });
    expect(result.reason).toBeUndefined();
  });

  /**
   * Minor version differences within the same major must be compatible.
   * This is the primary multi-version support scenario (§8.15).
   */
  it("should accept minor version differences within same major", () => {
    const result = validatePacketVersion({ schema_version: "1.5" }, 1);
    expect(result.compatible).toBe(true);
    expect(result.parsed).toEqual({ major: 1, minor: 5 });
  });

  /**
   * Cross-major packets must return { compatible: false } with a
   * descriptive reason. The orchestrator uses this reason in error
   * messages and audit logs.
   */
  it("should return compatible=false for different-major packets", () => {
    const result = validatePacketVersion({ schema_version: "2.0" }, 1);
    expect(result.compatible).toBe(false);
    expect(result.parsed).toEqual({ major: 2, minor: 0 });
    expect(result.reason).toContain("Expected major version 1");
    expect(result.reason).toContain("got 2");
  });

  /**
   * Malformed version strings must return compatible=false with an
   * error reason rather than throwing. The orchestrator needs to
   * handle this gracefully as a validation failure, not a crash.
   */
  it("should return compatible=false for malformed version strings", () => {
    const result = validatePacketVersion({ schema_version: "bad" }, 1);
    expect(result.compatible).toBe(false);
    expect(result.parsed).toEqual({ major: -1, minor: -1 });
    expect(result.reason).toContain("Invalid schema_version format");
  });

  /**
   * Empty version strings are a specific edge case that should be
   * handled the same as any other malformed input.
   */
  it("should return compatible=false for empty version string", () => {
    const result = validatePacketVersion({ schema_version: "" }, 1);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Invalid schema_version format");
  });

  /**
   * Version "0.x" packets should be compatible with expectedMajor=0.
   * Major version 0 is valid and used for pre-release/unstable schemas.
   */
  it("should handle major version 0 correctly", () => {
    const compatible = validatePacketVersion({ schema_version: "0.1" }, 0);
    expect(compatible.compatible).toBe(true);

    const incompatible = validatePacketVersion({ schema_version: "0.1" }, 1);
    expect(incompatible.compatible).toBe(false);
  });
});
