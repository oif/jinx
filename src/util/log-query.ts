/**
 * Log Query Utility
 * 
 * Provides programmatic querying capabilities for structured JSON logs.
 * Supports filtering by level, time range, and custom field predicates.
 * 
 * @module util/log-query
 */

import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { createModuleLogger } from "./log.js";

const log = createModuleLogger("log-query");

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Parsed log entry from JSON log file
 */
export interface LogEntry {
  level: string;
  time: string;
  msg: string;
  version?: string;
  env?: string;
  hostname?: string;
  service?: string;
  traceId?: string;
  spanId?: string;
  spanName?: string;
  spanOp?: string;
  durationMs?: number;
  errorName?: string;
  errorMessage?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Log level type
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Query options for filtering log entries
 */
export interface LogQueryOptions {
  /** Filter by log level */
  level?: LogLevel | LogLevel[];
  /** Minimum timestamp (inclusive) */
  startTime?: Date | string;
  /** Maximum timestamp (inclusive) */
  endTime?: Date | string;
  /** Filter by trace ID */
  traceId?: string;
  /** Filter by span ID */
  spanId?: string;
  /** Filter by span name */
  spanName?: string;
  /** Filter by message pattern (regex or substring) */
  messagePattern?: string | RegExp;
  /** Filter by error name */
  errorName?: string;
  /** Custom filter function */
  predicate?: (entry: LogEntry) => boolean;
  /** Maximum number of entries to return */
  limit?: number;
  /** Skip first N entries (for pagination) */
  offset?: number;
  /** Reverse order (newest first) */
  reverse?: boolean;
}

/**
 * Query result with metadata
 */
export interface LogQueryResult {
  entries: LogEntry[];
  totalCount: number;
  filteredCount: number;
  queryTimeMs: number;
  logFilePath: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "jinx.log");

// Level priority for comparison
const LEVEL_PRIORITY: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// ── Core Functions ─────────────────────────────────────────────────────

/**
 * Parse a single log line into a LogEntry
 * Returns null if the line is not valid JSON or not a log entry
 */
function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    // Validate it has required log fields
    if (typeof parsed.level === "string" && typeof parsed.time === "string") {
      return parsed as LogEntry;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read all log entries from the main log file
 */
export function readLogEntries(filePath: string = LOG_FILE): LogEntry[] {
  if (!existsSync(filePath)) {
    log.debug("Log file does not exist", { filePath });
    return [];
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const entry = parseLogLine(line);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  } catch (e) {
    log.error("Failed to read log file", { 
      filePath, 
      error: (e as Error).message 
    });
    return [];
  }
}

/**
 * Get log file stats
 */
export function getLogFileStats(filePath: string = LOG_FILE): {
  exists: boolean;
  size: number;
  modifiedTime: Date | null;
  path: string;
} {
  const exists = existsSync(filePath);
  if (!exists) {
    return { exists: false, size: 0, modifiedTime: null, path: filePath };
  }

  try {
    const stats = statSync(filePath);
    return {
      exists: true,
      size: stats.size,
      modifiedTime: stats.mtime,
      path: filePath,
    };
  } catch {
    return { exists: false, size: 0, modifiedTime: null, path: filePath };
  }
}

/**
 * Query log entries with filters
 */
export function queryLogs(options: LogQueryOptions = {}): LogQueryResult {
  const startTime = Date.now();
  const entries = readLogEntries();
  const totalCount = entries.length;

  // Apply filters
  let filtered = entries.filter((entry) => matchesFilter(entry, options));

  // Reverse if requested (before pagination for correct "recent" behavior)
  if (options.reverse) {
    filtered = filtered.reverse();
  }

  // Apply offset
  if (options.offset && options.offset > 0) {
    filtered = filtered.slice(options.offset);
  }

  // Apply limit
  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  const queryTimeMs = Date.now() - startTime;

  log.debug("Log query completed", {
    totalCount,
    filteredCount: filtered.length,
    queryTimeMs,
    options: sanitizeOptions(options),
  });

  return {
    entries: filtered,
    totalCount,
    filteredCount: filtered.length,
    queryTimeMs,
    logFilePath: LOG_FILE,
  };
}

/**
 * Check if entry matches level filter
 */
function matchesLevelFilter(entry: LogEntry, level: LogLevel | LogLevel[]): boolean {
  const levels = Array.isArray(level) ? level : [level];
  const entryPriority = LEVEL_PRIORITY[entry.level] ?? 0;
  return levels.some((l) => {
    const filterPriority = LEVEL_PRIORITY[l] ?? 0;
    return entryPriority >= filterPriority;
  });
}

/**
 * Check if entry matches time range filter
 */
function matchesTimeRange(entry: LogEntry, startTime?: Date | string, endTime?: Date | string): boolean {
  const entryTime = new Date(entry.time).getTime();
  if (startTime && entryTime < new Date(startTime).getTime()) return false;
  if (endTime && entryTime > new Date(endTime).getTime()) return false;
  return true;
}

/**
 * Check if entry matches message pattern
 */
function matchesMessagePattern(msg: string, pattern: string | RegExp): boolean {
  return pattern instanceof RegExp ? pattern.test(msg) : msg.includes(pattern);
}

/**
 * Check identity filters (traceId, spanId, spanName)
 */
function matchesIdentityFilters(
  entry: LogEntry,
  traceId?: string,
  spanId?: string,
  spanName?: string
): boolean {
  if (traceId && entry.traceId !== traceId) return false;
  if (spanId && entry.spanId !== spanId) return false;
  if (spanName && entry.spanName !== spanName) return false;
  return true;
}

/**
 * Check if a log entry matches the filter options
 */
function matchesFilter(entry: LogEntry, options: LogQueryOptions): boolean {
  // Level filter
  if (options.level && !matchesLevelFilter(entry, options.level)) return false;

  // Time range filter
  if (!matchesTimeRange(entry, options.startTime, options.endTime)) return false;

  // Identity filters (traceId, spanId, spanName)
  if (!matchesIdentityFilters(entry, options.traceId, options.spanId, options.spanName)) return false;

  // Message pattern filter
  if (options.messagePattern && !matchesMessagePattern(entry.msg, options.messagePattern)) return false;

  // Error name filter
  if (options.errorName && entry.errorName !== options.errorName) return false;

  // Custom predicate
  if (options.predicate && !options.predicate(entry)) return false;

  return true;
}

/**
 * Sanitize options for logging (remove functions, large objects)
 */
function sanitizeOptions(options: LogQueryOptions): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  if (options.level) sanitized.level = options.level;
  if (options.startTime) sanitized.startTime = options.startTime.toString();
  if (options.endTime) sanitized.endTime = options.endTime.toString();
  if (options.traceId) sanitized.traceId = options.traceId;
  if (options.spanId) sanitized.spanId = options.spanId;
  if (options.spanName) sanitized.spanName = options.spanName;
  if (options.messagePattern) sanitized.messagePattern = options.messagePattern.toString();
  if (options.errorName) sanitized.errorName = options.errorName;
  if (options.limit) sanitized.limit = options.limit;
  if (options.offset) sanitized.offset = options.offset;
  if (options.reverse) sanitized.reverse = options.reverse;
  
  return sanitized;
}

// ── Convenience Functions ─────────────────────────────────────────────

/**
 * Get recent log entries (last N entries)
 */
export function getRecentLogs(limit: number = 100, level?: LogLevel): LogEntry[] {
  const result = queryLogs({
    level,
    limit,
    reverse: true,
  });
  return result.entries;
}

/**
 * Get error logs
 */
export function getErrorLogs(limit: number = 50): LogEntry[] {
  const result = queryLogs({
    level: "error",
    limit,
    reverse: true,
  });
  return result.entries;
}

/**
 * Get logs by trace ID
 */
export function getLogsByTraceId(traceId: string): LogEntry[] {
  const result = queryLogs({ traceId });
  return result.entries;
}

/**
 * Get logs by span ID
 */
export function getLogsBySpanId(spanId: string): LogEntry[] {
  const result = queryLogs({ spanId });
  return result.entries;
}

/**
 * Get logs within a time range
 */
export function getLogsByTimeRange(
  startTime: Date | string,
  endTime: Date | string,
  options?: Omit<LogQueryOptions, "startTime" | "endTime">
): LogEntry[] {
  const result = queryLogs({
    ...options,
    startTime,
    endTime,
  });
  return result.entries;
}

/**
 * Get log statistics summary
 */
export function getLogStats(): {
  totalEntries: number;
  byLevel: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
  uniqueTraceIds: number;
  errors: number;
  warnings: number;
} {
  const entries = readLogEntries();
  const byLevel: Record<string, number> = {};
  const traceIds = new Set<string>();
  let oldestTime: string | null = null;
  let newestTime: string | null = null;
  let errors = 0;
  let warnings = 0;

  for (const entry of entries) {
    // Count by level
    byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;

    // Track trace IDs
    if (entry.traceId) {
      traceIds.add(entry.traceId);
    }

    // Track time range
    if (!oldestTime || entry.time < oldestTime) {
      oldestTime = entry.time;
    }
    if (!newestTime || entry.time > newestTime) {
      newestTime = entry.time;
    }

    // Count errors and warnings
    if (entry.level === "error" || entry.level === "fatal") {
      errors++;
    } else if (entry.level === "warn") {
      warnings++;
    }
  }

  return {
    totalEntries: entries.length,
    byLevel,
    oldestEntry: oldestTime,
    newestEntry: newestTime,
    uniqueTraceIds: traceIds.size,
    errors,
    warnings,
  };
}

/**
 * Search logs by keyword in message or any field
 */
export function searchLogs(
  keyword: string,
  options?: LogQueryOptions
): LogEntry[] {
  const lowerKeyword = keyword.toLowerCase();

  const result = queryLogs({
    ...options,
    predicate: (entry) => {
      // Check message
      if (entry.msg.toLowerCase().includes(lowerKeyword)) {
        return true;
      }
      // Check all string fields
      for (const value of Object.values(entry)) {
        if (typeof value === "string" && value.toLowerCase().includes(lowerKeyword)) {
          return true;
        }
      }
      return false;
    },
  });

  return result.entries;
}

/**
 * Format log entries for display
 */
export function formatLogEntries(
  entries: LogEntry[],
  format: "json" | "pretty" = "pretty"
): string {
  if (format === "json") {
    return JSON.stringify(entries, null, 2);
  }

  const lines: string[] = [];
  
  for (const entry of entries) {
    const time = new Date(entry.time).toLocaleString();
    const level = entry.level.toUpperCase().padEnd(5);
    const levelEmoji = getLevelEmoji(entry.level);
    
    let line = `${levelEmoji} [${time}] ${level} ${entry.msg}`;
    
    // Add trace ID if present
    if (entry.traceId) {
      line += ` (trace: ${entry.traceId.slice(0, 8)}...)`;
    }
    
    // Add span info if present
    if (entry.spanName) {
      line += ` [span: ${entry.spanName}]`;
    }
    
    // Add error info if present
    if (entry.errorMessage) {
      line += `\n    Error: ${entry.errorMessage}`;
    }
    
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * Get emoji for log level
 */
function getLevelEmoji(level: string): string {
  switch (level) {
    case "trace": return "🔍";
    case "debug": return "🐛";
    case "info": return "ℹ️";
    case "warn": return "⚠️";
    case "error": return "❌";
    case "fatal": return "💀";
    default: return "📝";
  }
}

// ── Exports ───────────────────────────────────────────────────────────

export const LOG_QUERY_VERSION = "1.0.0";