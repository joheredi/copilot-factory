import { describe, it, expect, beforeEach } from "vitest";
import { Writable } from "node:stream";
import { createLogger, resolveLogLevel } from "./logger.js";
import { runWithContext } from "./context.js";
import type { LogLevelConfig, Logger } from "./logger.js";

/**
 * Captures log output into an array of parsed JSON objects.
 * Uses a writable stream that collects newline-delimited JSON lines
 * and parses each one. Used as the `destination` for test loggers.
 */
function createLogCapture(): {
  stream: Writable;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  let buffer = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) {
          lines.push(JSON.parse(part) as Record<string, unknown>);
        }
      }
      callback();
    },
  });
  return { stream, lines };
}

describe("createLogger", () => {
  /**
   * Tests the core logger factory and its output format.
   * The structured logger is the backbone of the observability system —
   * every other component (tracing, metrics, NestJS integration) depends
   * on it producing correct, parseable JSON with the right fields.
   */

  let capture: ReturnType<typeof createLogCapture>;
  let logger: Logger;

  beforeEach(() => {
    capture = createLogCapture();
    logger = createLogger("test-module", {
      sync: true,
      destination: capture.stream,
      levels: { default: "trace" },
    });
  });

  describe("structured JSON output", () => {
    /**
     * Validates that log output is valid JSON with the §7.14 common fields:
     * timestamp (as ISO string), level, module, and message.
     * This is the most fundamental requirement — all log consumers
     * (aggregators, dashboards, alerts) depend on this format.
     */
    it("should output JSON with timestamp, level, module, and message", () => {
      logger.info("hello world");

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry).toHaveProperty("time");
      expect(typeof entry.time).toBe("string");
      // Verify ISO format
      expect(() => new Date(entry.time as string)).not.toThrow();
      expect(entry.level).toBe(30); // pino info = 30
      expect(entry.module).toBe("test-module");
      expect(entry.msg).toBe("hello world");
    });

    /**
     * Validates that additional structured data is merged into the log entry
     * as top-level fields, not nested under a "data" key. This enables
     * efficient querying in log aggregation systems.
     */
    it("should include additional data fields in the log entry", () => {
      logger.info("task scheduled", { tasksScheduled: 5, queueDepth: 12 });

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry.tasksScheduled).toBe(5);
      expect(entry.queueDepth).toBe(12);
      expect(entry.msg).toBe("task scheduled");
    });
  });

  describe("log levels", () => {
    /**
     * Validates that all six log levels produce output when the logger
     * is configured at trace level (the most permissive). Each level
     * maps to a specific pino numeric value.
     */
    it("should support all six log levels", () => {
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");

      expect(capture.lines).toHaveLength(6);
      const levels = capture.lines.map((l) => l.level);
      // pino levels: trace=10, debug=20, info=30, warn=40, error=50, fatal=60
      expect(levels).toEqual([10, 20, 30, 40, 50, 60]);
    });

    /**
     * Validates that messages below the configured level are suppressed.
     * This is critical for production where debug/trace logs would be
     * too verbose and impact performance.
     */
    it("should suppress messages below the configured level", () => {
      const warnCapture = createLogCapture();
      const warnLogger = createLogger("warn-module", {
        sync: true,
        destination: warnCapture.stream,
        levels: { default: "warn" },
      });

      warnLogger.trace("t");
      warnLogger.debug("d");
      warnLogger.info("i");
      warnLogger.warn("w");
      warnLogger.error("e");

      expect(warnCapture.lines).toHaveLength(2);
      expect(warnCapture.lines[0]!.msg).toBe("w");
      expect(warnCapture.lines[1]!.msg).toBe("e");
    });
  });

  describe("correlation context injection", () => {
    /**
     * Validates that correlation context fields from AsyncLocalStorage
     * are automatically injected into log entries. This is the key
     * integration between the context module and the logger — it enables
     * request-scoped tracing across the entire call chain without
     * passing context explicitly through every function.
     */
    it("should inject correlation context into log entries", () => {
      runWithContext({ taskId: "task-1", runId: "run-42" }, () => {
        logger.info("processing");
      });

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry.taskId).toBe("task-1");
      expect(entry.runId).toBe("run-42");
      expect(entry.msg).toBe("processing");
    });

    /**
     * Validates that explicit data fields override correlation context fields.
     * This allows individual log calls to refine or correct context —
     * for example, when a log entry relates to a different run than the
     * ambient context.
     */
    it("should allow explicit data to override context fields", () => {
      runWithContext({ taskId: "task-1", runId: "run-1" }, () => {
        logger.info("override test", { runId: "run-override" });
      });

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry.taskId).toBe("task-1");
      expect(entry.runId).toBe("run-override");
    });

    /**
     * Validates that log entries outside a context scope don't include
     * spurious undefined/null context fields. Clean JSON output is
     * important for log storage efficiency and query correctness.
     */
    it("should not include undefined context fields when no context is active", () => {
      logger.info("no context");

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry).not.toHaveProperty("taskId");
      expect(entry).not.toHaveProperty("runId");
      expect(entry).not.toHaveProperty("workerId");
    });
  });

  describe("child loggers", () => {
    /**
     * Validates that child loggers inherit the parent's module binding
     * and add their own bindings. This supports patterns like creating
     * a per-request child logger with the correlationId bound for the
     * request lifetime.
     */
    it("should create child loggers with additional bound fields", () => {
      const child = logger.child({ requestId: "req-123" });
      child.info("child log");

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry.module).toBe("test-module");
      expect(entry.requestId).toBe("req-123");
      expect(entry.msg).toBe("child log");
    });

    /**
     * Validates that child loggers also receive correlation context injection.
     * This ensures the context propagation works regardless of how many
     * levels of child loggers are created.
     */
    it("should inject correlation context in child loggers", () => {
      const child = logger.child({ component: "db" });
      runWithContext({ taskId: "task-child" }, () => {
        child.info("query executed");
      });

      expect(capture.lines).toHaveLength(1);
      const entry = capture.lines[0]!;
      expect(entry.taskId).toBe("task-child");
      expect(entry.component).toBe("db");
    });
  });

  describe("isLevelEnabled", () => {
    /**
     * Validates that isLevelEnabled correctly reports which levels
     * are active. This enables performance optimization — expensive
     * data serialization can be skipped when the level is disabled.
     */
    it("should correctly report enabled levels", () => {
      const infoCapture = createLogCapture();
      const infoLogger = createLogger("info-module", {
        sync: true,
        destination: infoCapture.stream,
        levels: { default: "info" },
      });

      expect(infoLogger.isLevelEnabled("info")).toBe(true);
      expect(infoLogger.isLevelEnabled("warn")).toBe(true);
      expect(infoLogger.isLevelEnabled("error")).toBe(true);
      expect(infoLogger.isLevelEnabled("debug")).toBe(false);
      expect(infoLogger.isLevelEnabled("trace")).toBe(false);
    });
  });
});

describe("resolveLogLevel", () => {
  /**
   * Tests per-module log level resolution, which enables operators to
   * increase verbosity for specific modules without flooding all logs.
   * For example, setting "scheduler" to "debug" while keeping
   * everything else at "info".
   */

  const levels: LogLevelConfig = {
    default: "info",
    scheduler: "debug",
    "lease-manager": "warn",
  };

  /**
   * Validates that a module with a specific override gets that level.
   */
  it("should return module-specific level when configured", () => {
    expect(resolveLogLevel("scheduler", levels)).toBe("debug");
    expect(resolveLogLevel("lease-manager", levels)).toBe("warn");
  });

  /**
   * Validates that modules without a specific override fall back to default.
   */
  it("should fall back to default level for unconfigured modules", () => {
    expect(resolveLogLevel("unknown-module", levels)).toBe("info");
  });
});
