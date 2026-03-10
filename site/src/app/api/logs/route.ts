import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * Log entry structure (subset of fields we care about)
 */
interface LogEntry {
  level: string;
  time: string;
  msg: string;
  traceId?: string;
  spanId?: string;
  spanName?: string;
  errorName?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

/**
 * Log statistics response
 */
export interface LogStatsResponse {
  /** Total number of log entries */
  totalEntries: number;
  /** Count by log level */
  byLevel: Record<string, number>;
  /** Number of unique trace IDs */
  uniqueTraceIds: number;
  /** Number of errors (error + fatal) */
  errors: number;
  /** Number of warnings */
  warnings: number;
  /** Time of oldest entry */
  oldestEntry: string | null;
  /** Time of newest entry */
  newestEntry: string | null;
  /** Recent error logs (up to 10) */
  recentErrors: Array<{
    time: string;
    msg: string;
    errorName?: string;
    errorMessage?: string;
    traceId?: string;
  }>;
  /** Log file size in bytes */
  fileSize: number;
  /** Query timestamp */
  timestamp: string;
}

// Level priority for comparison
const LEVEL_PRIORITY: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Parse a single log line into a LogEntry
 */
function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.level === "string" && typeof parsed.time === "string") {
      return parsed as LogEntry;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read and parse log entries from file
 */
function readLogEntries(logPath: string): LogEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n");
    const entries: LogEntry[] = [];

    for (const line of lines) {
      const entry = parseLogLine(line);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * GET /api/logs - Get log statistics
 */
export async function GET() {
  try {
    // Path to log file (relative to project root)
    // In production, this would be the actual log path
    const logDir = join(process.cwd(), "logs");
    const logPath = join(logDir, "jinx.log");
    
    const entries = readLogEntries(logPath);
    
    // Calculate statistics
    const byLevel: Record<string, number> = {};
    const traceIds = new Set<string>();
    let oldestTime: string | null = null;
    let newestTime: string | null = null;
    let errors = 0;
    let warnings = 0;
    
    // Collect recent errors
    const errorEntries: LogEntry[] = [];
    
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
        errorEntries.push(entry);
      } else if (entry.level === "warn") {
        warnings++;
      }
    }
    
    // Sort errors by time (newest first) and take up to 10
    const recentErrors = errorEntries
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 10)
      .map((entry) => ({
        time: entry.time,
        msg: entry.msg,
        errorName: entry.errorName,
        errorMessage: entry.errorMessage,
        traceId: entry.traceId,
      }));
    
    // Get file size
    let fileSize = 0;
    if (existsSync(logPath)) {
      try {
        const stats = require("fs").statSync(logPath);
        fileSize = stats.size;
      } catch {
        // Ignore stat errors
      }
    }
    
    const response: LogStatsResponse = {
      totalEntries: entries.length,
      byLevel,
      uniqueTraceIds: traceIds.size,
      errors,
      warnings,
      oldestEntry: oldestTime,
      newestEntry: newestTime,
      recentErrors,
      fileSize,
      timestamp: new Date().toISOString(),
    };
    
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get log statistics", message: (error as Error).message },
      { status: 500 }
    );
  }
}