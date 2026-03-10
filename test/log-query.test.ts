/**
 * Tests for log-query utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readLogEntries,
  queryLogs,
  getRecentLogs,
  getErrorLogs,
  getLogsByTraceId,
  getLogsBySpanId,
  getLogsByTimeRange,
  getLogStats,
  searchLogs,
  formatLogEntries,
  getLogFileStats,
  parseLogLine,
  type LogEntry,
  type LogQueryOptions,
} from "../src/util/log-query.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Test log directory and file
const TEST_LOG_DIR = join(process.cwd(), "logs");
const TEST_LOG_FILE = join(TEST_LOG_DIR, "jinx.log");

// Sample log entries for testing
const sampleLogs: LogEntry[] = [
  {
    level: "info",
    time: "2024-01-01T10:00:00.000Z",
    msg: "Server started",
    version: "1.0.0",
    traceId: "trace-001",
  },
  {
    level: "debug",
    time: "2024-01-01T10:01:00.000Z",
    msg: "Processing request",
    traceId: "trace-001",
    spanId: "span-001",
    spanName: "http-request",
  },
  {
    level: "warn",
    time: "2024-01-01T10:02:00.000Z",
    msg: "Slow query detected",
    durationMs: 5000,
  },
  {
    level: "error",
    time: "2024-01-01T10:03:00.000Z",
    msg: "Database connection failed",
    errorName: "ConnectionError",
    errorMessage: "ECONNREFUSED",
  },
  {
    level: "info",
    time: "2024-01-01T10:04:00.000Z",
    msg: "Request completed",
    traceId: "trace-001",
    spanId: "span-001",
    spanName: "http-request",
    spanOp: "end",
    durationMs: 150,
  },
  {
    level: "fatal",
    time: "2024-01-01T10:05:00.000Z",
    msg: "Critical system failure",
    errorName: "SystemError",
    errorMessage: "Out of memory",
  },
];

describe("util/log-query", () => {
  // Setup: create test log file with sample data
  beforeEach(() => {
    // Ensure clean state
    if (existsSync(TEST_LOG_DIR)) {
      rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_LOG_DIR, { recursive: true });

    // Write sample logs
    const logContent = sampleLogs.map((entry) => JSON.stringify(entry)).join("\n");
    writeFileSync(TEST_LOG_FILE, logContent, "utf-8");
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_LOG_DIR)) {
      rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    }
  });

  describe("parseLogLine", () => {
    it("should parse valid JSON log line via readLogEntries", () => {
      // parseLogLine is internal, so we test through readLogEntries
      const entries = readLogEntries(TEST_LOG_FILE);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].level).toBe("info");
    });
  });

  describe("readLogEntries", () => {
    it("should read all log entries from file", () => {
      const entries = readLogEntries(TEST_LOG_FILE);
      expect(entries.length).toBe(sampleLogs.length);
    });

    it("should return empty array for non-existent file", () => {
      const entries = readLogEntries("/nonexistent/path.log");
      expect(entries).toEqual([]);
    });

    it("should preserve log entry fields", () => {
      const entries = readLogEntries(TEST_LOG_FILE);
      const firstEntry = entries[0];
      expect(firstEntry.level).toBe("info");
      expect(firstEntry.msg).toBe("Server started");
      expect(firstEntry.traceId).toBe("trace-001");
    });
  });

  describe("getLogFileStats", () => {
    it("should return file stats for existing file", () => {
      const stats = getLogFileStats(TEST_LOG_FILE);
      expect(stats.exists).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.modifiedTime).toBeInstanceOf(Date);
    });

    it("should return not exists for non-existent file", () => {
      const stats = getLogFileStats("/nonexistent/path.log");
      expect(stats.exists).toBe(false);
      expect(stats.size).toBe(0);
      expect(stats.modifiedTime).toBeNull();
    });
  });

  describe("queryLogs", () => {
    it("should return all entries without filters", () => {
      const result = queryLogs({});
      expect(result.totalCount).toBe(sampleLogs.length);
      expect(result.filteredCount).toBe(sampleLogs.length);
    });

    it("should filter by single level", () => {
      const result = queryLogs({ level: "error" });
      expect(result.filteredCount).toBe(2); // error + fatal (>= error priority)
    });

    it("should filter by multiple levels", () => {
      const result = queryLogs({ level: ["warn", "error"] });
      expect(result.filteredCount).toBe(3); // warn, error, fatal
    });

    it("should filter by trace ID", () => {
      const result = queryLogs({ traceId: "trace-001" });
      expect(result.filteredCount).toBe(3); // 3 entries with trace-001
    });

    it("should filter by span ID", () => {
      const result = queryLogs({ spanId: "span-001" });
      expect(result.filteredCount).toBe(2);
    });

    it("should filter by span name", () => {
      const result = queryLogs({ spanName: "http-request" });
      expect(result.filteredCount).toBe(2);
    });

    it("should filter by message pattern (string)", () => {
      const result = queryLogs({ messagePattern: "failed" });
      expect(result.filteredCount).toBe(1);
      expect(result.entries[0].msg).toContain("failed");
    });

    it("should filter by message pattern (regex)", () => {
      const result = queryLogs({ messagePattern: /request/i });
      expect(result.filteredCount).toBe(2);
    });

    it("should filter by error name", () => {
      const result = queryLogs({ errorName: "ConnectionError" });
      expect(result.filteredCount).toBe(1);
    });

    it("should filter by time range", () => {
      const result = queryLogs({
        startTime: "2024-01-01T10:02:00.000Z",
        endTime: "2024-01-01T10:04:00.000Z",
      });
      expect(result.filteredCount).toBe(3);
    });

    it("should apply limit", () => {
      const result = queryLogs({ limit: 2 });
      expect(result.entries.length).toBe(2);
    });

    it("should apply offset", () => {
      const result = queryLogs({ offset: 3 });
      expect(result.entries.length).toBe(sampleLogs.length - 3);
    });

    it("should apply reverse", () => {
      const result = queryLogs({ reverse: true });
      expect(result.entries[0].msg).toBe("Critical system failure"); // Last entry first
    });

    it("should use custom predicate", () => {
      const result = queryLogs({
        predicate: (entry) => entry.durationMs !== undefined && entry.durationMs > 1000,
      });
      expect(result.filteredCount).toBe(1); // Only the slow query
    });

    it("should combine multiple filters", () => {
      // level: "debug" means >= debug priority (debug, info, warn, error, fatal)
      const result = queryLogs({
        level: "debug",
        traceId: "trace-001",
      });
      // Entries with trace-001 and level >= debug: info (x2), debug (x1)
      expect(result.filteredCount).toBe(3);
    });

    it("should include query metadata", () => {
      const result = queryLogs({ level: "info" });
      expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.logFilePath).toBe(TEST_LOG_FILE);
    });
  });

  describe("getRecentLogs", () => {
    it("should return most recent logs", () => {
      const entries = getRecentLogs(3);
      expect(entries.length).toBe(3);
      // Most recent should be first (reversed)
      expect(entries[0].msg).toBe("Critical system failure");
    });

    it("should filter by level", () => {
      const entries = getRecentLogs(10, "error");
      // Should include error and fatal
      expect(entries.every((e) => e.level === "error" || e.level === "fatal")).toBe(true);
    });
  });

  describe("getErrorLogs", () => {
    it("should return error and fatal logs", () => {
      const entries = getErrorLogs();
      expect(entries.every((e) => e.level === "error" || e.level === "fatal")).toBe(true);
    });

    it("should respect limit", () => {
      const entries = getErrorLogs(1);
      expect(entries.length).toBe(1);
    });
  });

  describe("getLogsByTraceId", () => {
    it("should return logs matching trace ID", () => {
      const entries = getLogsByTraceId("trace-001");
      expect(entries.length).toBe(3);
      expect(entries.every((e) => e.traceId === "trace-001")).toBe(true);
    });

    it("should return empty array for non-existent trace ID", () => {
      const entries = getLogsByTraceId("nonexistent");
      expect(entries).toEqual([]);
    });
  });

  describe("getLogsBySpanId", () => {
    it("should return logs matching span ID", () => {
      const entries = getLogsBySpanId("span-001");
      expect(entries.length).toBe(2);
    });
  });

  describe("getLogsByTimeRange", () => {
    it("should return logs in time range", () => {
      const entries = getLogsByTimeRange(
        "2024-01-01T10:01:00.000Z",
        "2024-01-01T10:03:00.000Z"
      );
      expect(entries.length).toBe(3);
    });
  });

  describe("getLogStats", () => {
    it("should return log statistics", () => {
      const stats = getLogStats();
      expect(stats.totalEntries).toBe(sampleLogs.length);
      expect(stats.byLevel.info).toBe(2);
      expect(stats.byLevel.debug).toBe(1);
      expect(stats.byLevel.warn).toBe(1);
      expect(stats.byLevel.error).toBe(1);
      expect(stats.byLevel.fatal).toBe(1);
      expect(stats.uniqueTraceIds).toBe(1);
      expect(stats.errors).toBe(2); // error + fatal
      expect(stats.warnings).toBe(1);
    });

    it("should track oldest and newest entries", () => {
      const stats = getLogStats();
      expect(stats.oldestEntry).toBe("2024-01-01T10:00:00.000Z");
      expect(stats.newestEntry).toBe("2024-01-01T10:05:00.000Z");
    });
  });

  describe("searchLogs", () => {
    it("should search in message", () => {
      const entries = searchLogs("request");
      expect(entries.length).toBe(2);
    });

    it("should be case-insensitive", () => {
      const entries = searchLogs("REQUEST");
      expect(entries.length).toBe(2);
    });

    it("should search in other fields", () => {
      const entries = searchLogs("ConnectionError");
      expect(entries.length).toBe(1);
    });

    it("should combine with other filters", () => {
      // level: "debug" means >= debug priority (debug, info, warn, error, fatal)
      // So "request" with level >= debug matches both "Processing request" (debug) and "Request completed" (info)
      const entries = searchLogs("request", { level: "debug" });
      expect(entries.length).toBe(2);
    });
  });

  describe("formatLogEntries", () => {
    it("should format as JSON", () => {
      const entries = sampleLogs.slice(0, 2);
      const formatted = formatLogEntries(entries, "json");
      const parsed = JSON.parse(formatted);
      expect(parsed.length).toBe(2);
    });

    it("should format as pretty", () => {
      const entries = sampleLogs.slice(0, 2);
      const formatted = formatLogEntries(entries, "pretty");
      expect(formatted).toContain("Server started");
      expect(formatted).toContain("ℹ️"); // info emoji
    });

    it("should include trace ID in output", () => {
      const entries = [sampleLogs[0]];
      const formatted = formatLogEntries(entries, "pretty");
      expect(formatted).toContain("trace");
    });

    it("should include span name in output", () => {
      const entries = [sampleLogs[1]];
      const formatted = formatLogEntries(entries, "pretty");
      expect(formatted).toContain("span");
      expect(formatted).toContain("http-request");
    });

    it("should include error message in output", () => {
      const entries = [sampleLogs[3]];
      const formatted = formatLogEntries(entries, "pretty");
      expect(formatted).toContain("Error:");
      expect(formatted).toContain("ECONNREFUSED");
    });

    it("should use correct emojis for levels", () => {
      const infoFormatted = formatLogEntries([sampleLogs[0]], "pretty");
      expect(infoFormatted).toContain("ℹ️"); // info

      const warnFormatted = formatLogEntries([sampleLogs[2]], "pretty");
      expect(warnFormatted).toContain("⚠️"); // warn

      const errorFormatted = formatLogEntries([sampleLogs[3]], "pretty");
      expect(errorFormatted).toContain("❌"); // error

      const fatalFormatted = formatLogEntries([sampleLogs[5]], "pretty");
      expect(fatalFormatted).toContain("💀"); // fatal

      const debugFormatted = formatLogEntries([sampleLogs[1]], "pretty");
      expect(debugFormatted).toContain("🐛"); // debug
    });
  });

  describe("edge cases", () => {
    it("should handle empty log file", () => {
      writeFileSync(TEST_LOG_FILE, "", "utf-8");
      const entries = readLogEntries(TEST_LOG_FILE);
      expect(entries).toEqual([]);
    });

    it("should handle log file with invalid lines", () => {
      const content = sampleLogs
        .map((e) => JSON.stringify(e))
        .join("\ninvalid line\nanother bad line\n");
      writeFileSync(TEST_LOG_FILE, content, "utf-8");
      const entries = readLogEntries(TEST_LOG_FILE);
      // Should still parse valid lines
      expect(entries.length).toBe(sampleLogs.length);
    });

    it("should handle query with no matches", () => {
      const result = queryLogs({ traceId: "nonexistent-trace" });
      expect(result.filteredCount).toBe(0);
      expect(result.entries).toEqual([]);
    });
  });
});