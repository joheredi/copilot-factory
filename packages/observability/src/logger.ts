import pino from "pino";
import type { Logger as PinoLogger, LoggerOptions } from "pino";
import { getContext } from "./context.js";
import type { CorrelationContext } from "./context.js";

/**
 * Log levels supported by the structured logger.
 * Maps to standard pino/syslog severity levels.
 */
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/**
 * Configuration for per-module log level overrides.
 *
 * Keys are module names (e.g., "scheduler", "lease-manager").
 * Values are the minimum log level for that module.
 *
 * @example
 * ```ts
 * const levels: LogLevelConfig = {
 *   "default": "info",
 *   "scheduler": "debug",
 *   "lease-manager": "warn",
 * };
 * ```
 */
export interface LogLevelConfig {
  /** Default level applied when no module-specific override exists. */
  default: LogLevel;
  /** Module-specific log level overrides. */
  [module: string]: LogLevel;
}

/**
 * Options for creating a structured logger instance.
 */
export interface CreateLoggerOptions {
  /**
   * Per-module log level configuration.
   * If not provided, defaults to `{ default: "info" }`.
   */
  levels?: LogLevelConfig;
  /**
   * Enable synchronous (blocking) logging.
   * Default is `false` (async logging for better performance).
   * Set to `true` in tests for deterministic output.
   */
  sync?: boolean;
  /**
   * Custom writable stream destination for log output.
   * Defaults to `process.stdout`. Useful for testing.
   */
  destination?: pino.DestinationStream;
  /**
   * Enable pretty-printing for development.
   * Default is `false`. When `true`, uses pino-pretty transport if available.
   */
  pretty?: boolean;
}

/**
 * A structured logger bound to a specific module.
 *
 * Wraps pino with automatic correlation context injection from
 * AsyncLocalStorage. Every log call merges the current
 * {@link CorrelationContext} fields into the log entry.
 *
 * @see {@link createLogger} to create instances.
 * @see docs/prd/007-technical-architecture.md §7.14 for the field specification.
 */
export interface Logger {
  /** Log at fatal level — unrecoverable errors that require immediate attention. */
  fatal(msg: string, data?: Record<string, unknown>): void;
  /** Log at error level — errors that should be investigated. */
  error(msg: string, data?: Record<string, unknown>): void;
  /** Log at warn level — unexpected conditions that are not errors. */
  warn(msg: string, data?: Record<string, unknown>): void;
  /** Log at info level — normal operational messages. */
  info(msg: string, data?: Record<string, unknown>): void;
  /** Log at debug level — detailed diagnostic information. */
  debug(msg: string, data?: Record<string, unknown>): void;
  /** Log at trace level — extremely detailed tracing information. */
  trace(msg: string, data?: Record<string, unknown>): void;
  /**
   * Creates a child logger with additional bound fields.
   * Useful for adding request-scoped or operation-scoped context
   * that persists across multiple log calls.
   */
  child(bindings: Record<string, unknown>): Logger;
  /** Returns the effective log level for this logger. */
  level: LogLevel;
  /** Returns true if the given level is enabled for this logger. */
  isLevelEnabled(level: LogLevel): boolean;
}

/** The default log level configuration when none is provided. */
const DEFAULT_LEVELS: LogLevelConfig = { default: "info" };

/**
 * Resolves the effective log level for a given module.
 *
 * Looks up the module name in the level config map. Falls back to the
 * "default" key if no module-specific override exists.
 *
 * @param module - The module name to resolve the level for.
 * @param levels - The log level configuration map.
 * @returns The effective log level for the module.
 */
export function resolveLogLevel(module: string, levels: LogLevelConfig): LogLevel {
  return levels[module] ?? levels.default;
}

/**
 * Strips undefined values from a correlation context so they don't appear
 * as `"field": undefined` in JSON output.
 */
function cleanContext(ctx: CorrelationContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Wraps a pino logger instance to inject correlation context from
 * AsyncLocalStorage on every log call.
 */
function wrapPinoLogger(pinoLogger: PinoLogger): Logger {
  function logAtLevel(level: LogLevel) {
    return (msg: string, data?: Record<string, unknown>): void => {
      const ctx = cleanContext(getContext());
      const merged = data ? { ...ctx, ...data } : ctx;
      if (Object.keys(merged).length > 0) {
        pinoLogger[level](merged, msg);
      } else {
        pinoLogger[level](msg);
      }
    };
  }

  return {
    fatal: logAtLevel("fatal"),
    error: logAtLevel("error"),
    warn: logAtLevel("warn"),
    info: logAtLevel("info"),
    debug: logAtLevel("debug"),
    trace: logAtLevel("trace"),
    child(bindings: Record<string, unknown>): Logger {
      return wrapPinoLogger(pinoLogger.child(bindings));
    },
    get level(): LogLevel {
      return pinoLogger.level as LogLevel;
    },
    isLevelEnabled(level: LogLevel): boolean {
      return pinoLogger.isLevelEnabled(level);
    },
  };
}

/**
 * Creates a structured JSON logger for the given module.
 *
 * The returned logger:
 * - Outputs structured JSON to stdout (containerization-friendly)
 * - Includes §7.14 common fields: timestamp, level, module
 * - Automatically injects correlation context (taskId, runId, workerId, etc.)
 *   from the active {@link CorrelationContext} scope
 * - Respects per-module log level configuration
 *
 * @param module - The module name (e.g., "scheduler", "lease-manager", "worker-supervisor").
 *   Included as the `module` field in every log entry.
 * @param options - Optional configuration for log levels, sync mode, and destination.
 * @returns A {@link Logger} instance bound to the specified module.
 *
 * @example
 * ```ts
 * const logger = createLogger("scheduler", {
 *   levels: { default: "info", scheduler: "debug" },
 * });
 * logger.info("Tick complete", { tasksScheduled: 5 });
 * // {"level":"info","time":1710000000000,"module":"scheduler","tasksScheduled":5,"msg":"Tick complete"}
 * ```
 *
 * @see docs/prd/007-technical-architecture.md §7.14 for the observability architecture.
 */
export function createLogger(module: string, options: CreateLoggerOptions = {}): Logger {
  const { levels = DEFAULT_LEVELS, sync = false, destination, pretty = false } = options;
  const level = resolveLogLevel(module, levels);

  const pinoOptions: LoggerOptions = {
    level,
    // Bind the module name as a base field on every log entry.
    base: { module },
    // Use ISO timestamp for human-readable and sortable timestamps.
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    pinoOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true },
    };
  }

  let pinoLogger: PinoLogger;
  if (destination) {
    pinoLogger = pino(pinoOptions, destination);
  } else if (sync) {
    pinoLogger = pino(
      {
        ...pinoOptions,
        transport: undefined,
      },
      pino.destination({ sync: true }),
    );
  } else {
    pinoLogger = pino(pinoOptions);
  }

  return wrapPinoLogger(pinoLogger);
}
