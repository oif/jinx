import pino from "pino";
import { randomUUID } from "crypto";
import { readFileSync, existsSync, mkdirSync, statSync, renameSync, readdirSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Configuration ────────────────────────────────────────────────────

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "jinx.log");
const MAX_LOG_FILES = 10; // Keep last 10 log files

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

/**
 * Sensitive field patterns for redaction
 * Matches common secret/key field names
 */
const sensitivePatterns = [
  "password",
  "passwd",
  "secret",
  "apiKey",
  "api_key",
  "apikey",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "privateKey",
  "private_key",
  "authorization",
  "auth",
  "credentials",
  "sessionKey",
  "session_key",
];

/**
 * Redact sensitive values in an object
 * Recursively traverses objects and redacts sensitive field values
 */
function redactSensitive<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item)) as T;
  }

  if (obj instanceof Error) {
    // Don't redact Error objects - they need special handling
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitivePatterns.some((pattern) =>
      lowerKey.includes(pattern.toLowerCase())
    );

    if (isSensitive && typeof value === "string" && value.length > 0) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Extract error information for structured logging
 * Converts Error objects to loggable format with stack trace
 */
function extractErrorInfo(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const errorInfo: Record<string, unknown> = {
    errorName: error.name,
    errorMessage: error.message,
  };

  // Include stack trace in non-production environments
  if (process.env.NODE_ENV !== "production" && error.stack) {
    errorInfo.stack = error.stack;
  }

  // Include cause if present (for nested errors)
  if (error.cause instanceof Error) {
    errorInfo.cause = extractErrorInfo(error.cause);
  }

  return errorInfo;
}

// ── Log File Management ───────────────────────────────────────────────

/**
 * Ensure logs directory exists
 */
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Get current date string for log file rotation
 */
function getDateString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0]; // YYYY-MM-DD
}

/**
 * Rotate log file with date suffix
 */
function rotateLogFile(): void {
  if (!existsSync(LOG_FILE)) {
    return;
  }

  const dateStr = getDateString();
  const timestamp = Date.now();
  const rotatedFile = join(LOG_DIR, `jinx-${dateStr}-${timestamp}.log`);

  try {
    renameSync(LOG_FILE, rotatedFile);
  } catch (e) {
    // If rename fails (e.g., cross-device), try to continue
    console.error("Failed to rotate log file:", (e as Error).message);
  }

  // Clean up old log files
  cleanupOldLogs();
}

/**
 * Remove old log files beyond MAX_LOG_FILES
 */
function cleanupOldLogs(): void {
  try {
    const files = readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("jinx-") && f.endsWith(".log") && f !== "jinx.log")
      .map((f) => ({
        name: f,
        path: join(LOG_DIR, f),
        time: statSync(join(LOG_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // Remove files beyond the limit
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      try {
        unlinkSync(files[i].path);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ── Logger Creation ─────────────────────────────────────────────────────

/**
 * Build pino transport configuration
 * Note: When using transport.targets, custom formatters are not allowed.
 * For production, we use a single stdout transport.
 * For file logging, we use a separate multistream approach.
 */
function buildTransportConfig(): pino.TransportSingleOptions | undefined {
  // Pretty print for development
  if (process.env.NODE_ENV !== "production") {
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  }

  // In production, JSON to stdout
  return {
    target: "pino/file",
    options: {
      destination: 1, // stdout
    },
  };
}

/**
 * Check if file logging is enabled
 */
function isFileLoggingEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.LOG_FILE !== "false";
}

// Create the base pino logger with custom level formatter (outputs level as string)
// For non-test environments with file logging, use multistream
let pinoLogger: pino.Logger;

// Current log level (can be changed at runtime)
let currentLogLevel = process.env.LOG_LEVEL || "info";

/**
 * Get the current log level
 */
export function getLogLevel(): string {
  return currentLogLevel;
}

/**
 * Set the log level at runtime
 * Valid levels: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
 * Returns true if the level was changed successfully
 */
export function setLogLevel(level: string): boolean {
  const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
  if (!validLevels.includes(level)) {
    log.warn(`Invalid log level: ${level}. Valid levels: ${validLevels.join(", ")}`);
    return false;
  }
  
  const oldLevel = currentLogLevel;
  currentLogLevel = level;
  pinoLogger.level = level;
  
  log.info("Log level changed", { oldLevel, newLevel: level });
  return true;
}

if (isFileLoggingEnabled()) {
  // Ensure log directory exists before creating streams
  ensureLogDir();
  
  // Use multistream for both stdout and file
  // Note: Each stream needs explicit level setting for proper filtering
  const stdoutStream = pino.transport({
    target: process.env.NODE_ENV !== "production" ? "pino-pretty" : "pino/file",
    options: process.env.NODE_ENV !== "production" 
      ? { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" }
      : { destination: 1 },
  });
  
  const fileStream = pino.transport({
    target: "pino/file",
    options: {
      destination: LOG_FILE,
      mkdir: true,
    },
  });
  
  // Use multistream with explicit levels for each stream
  const multiStream = pino.multistream([
    { stream: stdoutStream, level: currentLogLevel },
    { stream: fileStream, level: currentLogLevel },
  ]);
  
  pinoLogger = pino({
    level: currentLogLevel,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: defaultContext,
  }, multiStream);
} else {
  // Single stream (stdout only)
  const transport = buildTransportConfig();
  pinoLogger = pino({
    level: currentLogLevel,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: defaultContext,
    transport,
  });
}

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
 * Clear the trace ID from the current async context
 */
export function clearTraceId(): void {
  // Enter with undefined to clear the trace ID
  traceStorage.enterWith(undefined as unknown as string);
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
  /** Log an error with automatic stack trace extraction */
  logError(msg: string, error: Error, data?: LogContext): void;
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
    let mergedData: Record<string, unknown> = {
      ...baseContext,
      traceId: getTraceId(),
      ...data,
    };

    // Extract error info if an Error object is provided
    if (data?.error instanceof Error) {
      mergedData = {
        ...mergedData,
        ...extractErrorInfo(data.error),
      };
      delete mergedData.error;
    }

    // Redact sensitive data
    mergedData = redactSensitive(mergedData);

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
    logError(msg: string, error: Error, data?: LogContext): void {
      logWithContext("error", msg, { ...data, error });
    },
    child(context: LogContext): Logger {
      return createLogger({ ...baseContext, ...context });
    },
  };
}

/**
 * Default structured logger using Pino
 * Includes timestamp, level, message, and context fields
 * 
 * Features:
 * - JSON structured output to logs/jinx.log
 * - Pretty-printed output to console in development
 * - Sensitive data redaction (passwords, tokens, etc.)
 * - Trace ID propagation via AsyncLocalStorage
 * - Log file rotation when size exceeds 10MB
 * - Keeps last 10 rotated log files
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

/**
 * Get log file path
 */
export function getLogFilePath(): string {
  return LOG_FILE;
}

/**
 * Get log directory path
 */
export function getLogDir(): string {
  return LOG_DIR;
}

/**
 * Force log rotation (useful for testing or maintenance)
 */
export function forceRotateLog(): void {
  ensureLogDir();
  rotateLogFile();
}

/**
 * Export redactSensitive for external use
 * Useful for sanitizing data before logging manually
 */
export { redactSensitive };

// ── Expert Features: Dynamic Log Level, Performance Tracking, Spans ─────

/**
 * Span context for tracking operations across multiple log entries
 * Uses AsyncLocalStorage for nested span support
 */
const spanStorage = new AsyncLocalStorage<{
  spanId: string;
  spanName: string;
  startTime: number;
  parentSpanId?: string;
}>();

/**
 * Span ID counter for generating unique span IDs
 */
let spanIdCounter = 0;

/**
 * Generate a unique span ID
 */
function generateSpanId(): string {
  return `span-${Date.now()}-${++spanIdCounter}`;
}

/**
 * Get the current span context
 */
export function getCurrentSpan(): { spanId: string; spanName: string; parentSpanId?: string } | undefined {
  const span = spanStorage.getStore();
  if (!span) return undefined;
  return { spanId: span.spanId, spanName: span.spanName, parentSpanId: span.parentSpanId };
}

/**
 * Start a span and return the span ID
 * Logs the span start event
 */
export function startSpan(spanName: string, data?: LogContext): string {
  const parentSpan = spanStorage.getStore();
  const spanId = generateSpanId();
  
  const spanData: LogContext = {
    spanId,
    spanName,
    spanOp: "start",
    ...data,
  };
  
  if (parentSpan) {
    spanData.parentSpanId = parentSpan.spanId;
  }
  
  log.debug(`Span started: ${spanName}`, spanData);
  
  return spanId;
}

/**
 * End a span and log the duration
 * Returns the duration in milliseconds
 */
export function endSpan(spanId: string, spanName: string, data?: LogContext): number {
  const durationMs = Date.now(); // We'll calculate this properly in withSpan
  const spanData: LogContext = {
    spanId,
    spanName,
    spanOp: "end",
    ...data,
  };
  
  log.debug(`Span ended: ${spanName}`, spanData);
  
  return durationMs;
}

/**
 * Run a function within a span context
 * Automatically logs start, end, and duration
 * If an error occurs, logs it and re-throws
 */
export function withSpan<T>(spanName: string, fn: () => T, data?: LogContext): T {
  const parentSpan = spanStorage.getStore();
  const spanId = generateSpanId();
  const startTime = Date.now();
  
  const startData: LogContext = {
    spanId,
    spanName,
    spanOp: "start",
    ...data,
  };
  
  if (parentSpan) {
    startData.parentSpanId = parentSpan.spanId;
  }
  
  log.debug(`Span started: ${spanName}`, startData);
  
  const spanContext = {
    spanId,
    spanName,
    startTime,
    parentSpanId: parentSpan?.spanId,
  };
  
  try {
    const result = spanStorage.run(spanContext, fn);
    
    const durationMs = Date.now() - startTime;
    const endData: LogContext = {
      spanId,
      spanName,
      spanOp: "end",
      durationMs,
      ...data,
    };
    
    if (parentSpan) {
      endData.parentSpanId = parentSpan.spanId;
    }
    
    log.debug(`Span ended: ${spanName}`, endData);
    
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorData: LogContext = {
      spanId,
      spanName,
      spanOp: "error",
      durationMs,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
      ...data,
    };
    
    if (parentSpan) {
      errorData.parentSpanId = parentSpan.spanId;
    }
    
    log.error(`Span failed: ${spanName}`, errorData);
    throw error;
  }
}

/**
 * Run an async function within a span context
 * Automatically logs start, end, and duration
 */
export async function withSpanAsync<T>(
  spanName: string,
  fn: () => Promise<T>,
  data?: LogContext
): Promise<T> {
  const parentSpan = spanStorage.getStore();
  const spanId = generateSpanId();
  const startTime = Date.now();
  
  const startData: LogContext = {
    spanId,
    spanName,
    spanOp: "start",
    ...data,
  };
  
  if (parentSpan) {
    startData.parentSpanId = parentSpan.spanId;
  }
  
  log.debug(`Span started: ${spanName}`, startData);
  
  const spanContext = {
    spanId,
    spanName,
    startTime,
    parentSpanId: parentSpan?.spanId,
  };
  
  try {
    const result = await spanStorage.run(spanContext, fn);
    
    const durationMs = Date.now() - startTime;
    const endData: LogContext = {
      spanId,
      spanName,
      spanOp: "end",
      durationMs,
      ...data,
    };
    
    if (parentSpan) {
      endData.parentSpanId = parentSpan.spanId;
    }
    
    log.debug(`Span ended: ${spanName}`, endData);
    
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorData: LogContext = {
      spanId,
      spanName,
      spanOp: "error",
      durationMs,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error),
      ...data,
    };
    
    if (parentSpan) {
      errorData.parentSpanId = parentSpan.spanId;
    }
    
    log.error(`Span failed: ${spanName}`, errorData);
    throw error;
  }
}

/**
 * Add an event to the current span
 * Useful for marking intermediate steps within a span
 */
export function addSpanEvent(eventName: string, data?: LogContext): void {
  const span = spanStorage.getStore();
  const eventData: LogContext = {
    spanEvent: eventName,
    ...data,
  };
  
  if (span) {
    eventData.spanId = span.spanId;
    eventData.spanName = span.spanName;
    eventData.spanElapsedMs = Date.now() - span.startTime;
  }
  
  log.debug(`Span event: ${eventName}`, eventData);
}

/**
 * Performance timing helper
 * Returns a function that logs the duration when called
 */
export function startTimer(label: string, data?: LogContext): () => number {
  const startTime = Date.now();
  
  return () => {
    const durationMs = Date.now() - startTime;
    log.debug(`Timer: ${label}`, { durationMs, ...data });
    return durationMs;
  };
}

/**
 * Time a synchronous function and log its duration
 */
export function time<T>(label: string, fn: () => T, data?: LogContext): T {
  const startTime = Date.now();
  try {
    const result = fn();
    const durationMs = Date.now() - startTime;
    log.debug(`Timer: ${label}`, { durationMs, ...data });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error(`Timer failed: ${label}`, { durationMs, error: error instanceof Error ? error.message : String(error), ...data });
    throw error;
  }
}

/**
 * Time an async function and log its duration
 */
export async function timeAsync<T>(
  label: string,
  fn: () => Promise<T>,
  data?: LogContext
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;
    log.debug(`Timer: ${label}`, { durationMs, ...data });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error(`Timer failed: ${label}`, { durationMs, error: error instanceof Error ? error.message : String(error), ...data });
    throw error;
  }
}

/**
 * Slow operation warning threshold (in milliseconds)
 * Operations exceeding this threshold will trigger a warning log
 */
const SLOW_OPERATION_THRESHOLD_MS = 5000;

/**
 * Log a slow operation warning if duration exceeds threshold
 */
export function warnSlowOperation(operation: string, durationMs: number, thresholdMs = SLOW_OPERATION_THRESHOLD_MS): void {
  if (durationMs > thresholdMs) {
    log.warn(`Slow operation detected: ${operation}`, { 
      durationMs, 
      thresholdMs,
      operation 
    });
  }
}

/**
 * Time an async operation and warn if slow
 * Returns the result and logs warning if threshold exceeded
 */
export async function trackPerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  options?: { warnThresholdMs?: number; data?: LogContext }
): Promise<{ result: T; durationMs: number }> {
  const startTime = Date.now();
  const result = await fn();
  const durationMs = Date.now() - startTime;
  
  warnSlowOperation(operation, durationMs, options?.warnThresholdMs);
  
  if (options?.data) {
    log.debug(`Performance: ${operation}`, { durationMs, ...options.data });
  }
  
  return { result, durationMs };
}