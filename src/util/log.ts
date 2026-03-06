import pino from "pino";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
let version = "0.0.0";
try {
  const pkgPath = join(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  version = pkg.version || "0.0.0";
} catch {
  // Ignore if package.json not found
}

// Default context fields
const defaultContext = {
  version,
  env: process.env.NODE_ENV || "development",
  hostname: process.env.HOSTNAME || "localhost",
  service: "jinx",
};

// Create the base pino logger
const pinoLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: defaultContext,
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

/**
 * Trace ID storage for request tracking
 * Uses AsyncLocalStorage for async context propagation
 */
import { AsyncLocalStorage } from "async_hooks";

const traceStorage = new AsyncLocalStorage<string>();

/**
 * Generate a new trace ID
 */
export function generateTraceId(): string {
  return randomUUID();
}

/**
 * Set the trace ID for the current async context
 */
export function setTraceId(traceId: string): void {
  traceStorage.enterWith(traceId);
}

/**
 * Get the current trace ID from async context
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore();
}

/**
 * Run a function with a trace ID context
 */
export function withTraceId<T>(fn: () => T, traceId?: string): T {
  const id = traceId || generateTraceId();
  return traceStorage.run(id, fn);
}

/**
 * Log context interface
 */
export interface LogContext {
  traceId?: string;
  [key: string]: unknown;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(msg: string, data?: LogContext): void;
  info(msg: string, data?: LogContext): void;
  warn(msg: string, data?: LogContext): void;
  error(msg: string, data?: LogContext): void;
  child(context: LogContext): Logger;
}

/**
 * Create a logger with persistent context
 */
function createLogger(baseContext: LogContext = {}): Logger {
  const logWithContext = (
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    data?: LogContext
  ): void => {
    // Merge base context, trace ID, and additional data
    const mergedData: Record<string, unknown> = {
      ...baseContext,
      traceId: getTraceId(),
      ...data,
    };

    // Remove undefined traceId
    if (!mergedData.traceId) {
      delete mergedData.traceId;
    }

    if (Object.keys(mergedData).length > 0) {
      pinoLogger[level](mergedData, msg);
    } else {
      pinoLogger[level](msg);
    }
  };

  return {
    debug(msg: string, data?: LogContext): void {
      logWithContext("debug", msg, data);
    },
    info(msg: string, data?: LogContext): void {
      logWithContext("info", msg, data);
    },
    warn(msg: string, data?: LogContext): void {
      logWithContext("warn", msg, data);
    },
    error(msg: string, data?: LogContext): void {
      logWithContext("error", msg, data);
    },
    child(context: LogContext): Logger {
      return createLogger({ ...baseContext, ...context });
    },
  };
}

/**
 * Default structured logger using Pino
 * Includes timestamp, level, message, and context fields
 */
export const log = createLogger();

/**
 * Create a child logger with persistent context
 * Useful for modules that want to include their name in all logs
 */
export function createLoggerWithContext(context: LogContext): Logger {
  return log.child(context);
}

/**
 * Module-level logger factory
 * Creates a logger with module name in context
 */
export function createModuleLogger(moduleName: string, additionalContext?: LogContext): Logger {
  return log.child({ module: moduleName, ...additionalContext });
}
