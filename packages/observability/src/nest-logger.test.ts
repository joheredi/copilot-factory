import { describe, it, expect, beforeEach, vi } from "vitest";
import { NestLoggerAdapter } from "./nest-logger.js";
import type { Logger } from "./logger.js";

/**
 * Creates a mock Logger for testing the NestJS adapter.
 * Each log method is a vitest spy so we can verify call arguments.
 */
function createMockLogger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
} {
  return {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: "info" as const,
    isLevelEnabled: vi.fn(() => true),
  };
}

describe("NestLoggerAdapter", () => {
  /**
   * Tests the NestJS LoggerService adapter. This adapter bridges the
   * NestJS framework logger interface to our structured logger, ensuring
   * that framework-level logs (bootstrap, route registration, errors)
   * flow through the same structured JSON pipeline as application logs.
   * Without this adapter, NestJS would use its default console logger,
   * producing unstructured output that breaks log aggregation.
   */

  let mockLogger: ReturnType<typeof createMockLogger>;
  let adapter: NestLoggerAdapter;

  beforeEach(() => {
    mockLogger = createMockLogger();
    adapter = new NestLoggerAdapter(mockLogger);
  });

  describe("log (info level)", () => {
    /**
     * Validates that NestJS `log` calls map to structured `info` level.
     */
    it("should call info with message only when no context", () => {
      adapter.log("Application started");

      expect(mockLogger.info).toHaveBeenCalledWith("Application started", undefined);
    });

    /**
     * Validates that the NestJS context string (typically the class name)
     * is passed as a structured field, not appended to the message.
     */
    it("should include nestContext when context is provided", () => {
      adapter.log("Mapped route", "RoutesResolver");

      expect(mockLogger.info).toHaveBeenCalledWith("Mapped route", {
        nestContext: "RoutesResolver",
      });
    });
  });

  describe("error", () => {
    /**
     * Validates that NestJS error calls include both the stack trace
     * and context as structured fields. This is important for error
     * aggregation — tools like Sentry can parse the trace field.
     */
    it("should include trace and context as structured fields", () => {
      adapter.error("Something failed", "Error: stack trace\n  at ...", "AppModule");

      expect(mockLogger.error).toHaveBeenCalledWith("Something failed", {
        trace: "Error: stack trace\n  at ...",
        nestContext: "AppModule",
      });
    });

    /**
     * Validates that error works with just a message (no trace or context).
     */
    it("should work with message only", () => {
      adapter.error("bare error");

      expect(mockLogger.error).toHaveBeenCalledWith("bare error", undefined);
    });

    /**
     * Validates that error works with trace but no context.
     */
    it("should include only trace when context is not provided", () => {
      adapter.error("error with trace", "Error: trace\n  at ...");

      expect(mockLogger.error).toHaveBeenCalledWith("error with trace", {
        trace: "Error: trace\n  at ...",
      });
    });
  });

  describe("warn", () => {
    /**
     * Validates NestJS warn mapping to structured warn level.
     */
    it("should call warn with context", () => {
      adapter.warn("Deprecation notice", "DeprecationWarning");

      expect(mockLogger.warn).toHaveBeenCalledWith("Deprecation notice", {
        nestContext: "DeprecationWarning",
      });
    });
  });

  describe("debug", () => {
    /**
     * Validates NestJS debug mapping to structured debug level.
     */
    it("should call debug with context", () => {
      adapter.debug("Route resolved", "RouterExplorer");

      expect(mockLogger.debug).toHaveBeenCalledWith("Route resolved", {
        nestContext: "RouterExplorer",
      });
    });
  });

  describe("verbose", () => {
    /**
     * Validates that NestJS verbose maps to pino trace level.
     * NestJS has 5 levels (log, error, warn, debug, verbose) while
     * pino has 6 (fatal, error, warn, info, debug, trace). Verbose
     * maps to trace as both represent the most detailed logging level.
     */
    it("should map verbose to trace level", () => {
      adapter.verbose("Detailed info", "InstanceLoader");

      expect(mockLogger.trace).toHaveBeenCalledWith("Detailed info", {
        nestContext: "InstanceLoader",
      });
    });
  });
});
