import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

const HISTORY_PATH = join(DATA_DIR, "evolution-history.json");
const MAX_HISTORY_ENTRIES = 100;

export interface EvolutionRecord {
  cycle: number;
  timestamp: string;
  version: string;
  status: "success" | "failed" | "skipped";
  summary: string;
  durationMs?: number;
}

export interface EvolutionStats {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  skippedCycles: number;
  currentStreak: number;
  longestStreak: number;
  lastSuccessAt?: string;
}

export function loadEvolutionHistory(): EvolutionRecord[] {
  try {
    if (existsSync(HISTORY_PATH)) {
      return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load evolution history", { error: (e as Error).message });
  }
  return [];
}

/**
 * Load only the most recent N evolution records.
 * More memory-efficient than loadEvolutionHistory() for large histories.
 */
export function loadRecentHistory(limit: number): EvolutionRecord[] {
  try {
    if (existsSync(HISTORY_PATH)) {
      const history: EvolutionRecord[] = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
      return history.slice(-limit);
    }
  } catch (e) {
    log.warn("Failed to load recent history", { error: (e as Error).message });
  }
  return [];
}

export function saveEvolutionHistory(history: EvolutionRecord[]): void {
  try {
    const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
    writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    log.warn("Failed to save evolution history", { error: (e as Error).message });
  }
}

export function recordEvolutionResult(
  cycle: number,
  version: string,
  status: EvolutionRecord["status"],
  summary: string,
  durationMs?: number
): void {
  const history = loadEvolutionHistory();

  const record: EvolutionRecord = {
    cycle,
    timestamp: new Date().toISOString(),
    version,
    status,
    summary: summary.slice(0, 500),
    durationMs,
  };

  history.push(record);

  saveEvolutionHistory(history);
  log.info(`Evolution #${cycle} recorded`, { status, version });
}

export function calculateEvolutionStats(): EvolutionStats {
  const history = loadEvolutionHistory();

  if (history.length === 0) {
    return {
      totalCycles: 0,
      successfulCycles: 0,
      failedCycles: 0,
      skippedCycles: 0,
      currentStreak: 0,
      longestStreak: 0,
    };
  }

  const successful = history.filter((h) => h.status === "success");
  const failed = history.filter((h) => h.status === "failed");
  const skipped = history.filter((h) => h.status === "skipped");

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  for (const record of history) {
    if (record.status === "success") {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === "success") {
      currentStreak++;
    } else {
      break;
    }
  }

  const lastSuccess = successful[successful.length - 1];

  return {
    totalCycles: history.length,
    successfulCycles: successful.length,
    failedCycles: failed.length,
    skippedCycles: skipped.length,
    currentStreak,
    longestStreak,
    lastSuccessAt: lastSuccess?.timestamp,
  };
}

export function formatEvolutionReport(limit = 10): string {
  const history = loadEvolutionHistory();
  const stats = calculateEvolutionStats();

  if (history.length === 0) {
    return "No evolution history recorded yet.";
  }

  const recent = history.slice(-limit);
  const lines: string[] = [
    "📊 Evolution Statistics:",
    `  Total: ${stats.totalCycles} | Success: ${stats.successfulCycles} | Failed: ${stats.failedCycles} | Skipped: ${stats.skippedCycles}`,
    `  Current Streak: ${stats.currentStreak} 🔥 | Longest: ${stats.longestStreak}`,
    "",
    `📜 Recent ${recent.length} Cycles:`,
  ];

  for (const record of recent.reverse()) {
    const emoji = record.status === "success" ? "✅" : record.status === "failed" ? "❌" : "⏭️";
    const date = new Date(record.timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(`  ${emoji} #${record.cycle} (${record.version}) - ${date}`);
    if (record.summary) {
      const shortSummary = record.summary.split("\n")[0].slice(0, 60);
      lines.push(`     ${shortSummary}${record.summary.length > 60 ? "..." : ""}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Query Interface - Selective history reading for AI context management
// ============================================================================

export interface HistoryQuery {
  /** Filter by status */
  status?: EvolutionRecord["status"] | EvolutionRecord["status"][];
  /** Filter by version (exact match or prefix) */
  version?: string;
  /** Only records after this timestamp */
  since?: string | Date;
  /** Only records before this timestamp */
  until?: string | Date;
  /** Maximum number of records to return (most recent first) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Search in summary text (case-insensitive) */
  summaryContains?: string;
  /** Minimum cycle number */
  minCycle?: number;
  /** Maximum cycle number */
  maxCycle?: number;
}

/**
 * Query evolution history with filters.
 * Memory-efficient: loads full history but returns only matching records.
 * For very large histories, consider using queryHistoryStream() instead.
 */
export function queryHistory(query: HistoryQuery = {}): EvolutionRecord[] {
  const history = loadEvolutionHistory();

  let results = history;

  // Filter by status
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    results = results.filter((r) => statuses.includes(r.status));
  }

  // Filter by version prefix
  if (query.version) {
    results = results.filter((r) => r.version.startsWith(query.version!));
  }

  // Filter by time range
  if (query.since) {
    const since = new Date(query.since).getTime();
    results = results.filter((r) => new Date(r.timestamp).getTime() >= since);
  }
  if (query.until) {
    const until = new Date(query.until).getTime();
    results = results.filter((r) => new Date(r.timestamp).getTime() <= until);
  }

  // Filter by cycle range
  if (query.minCycle !== undefined) {
    results = results.filter((r) => r.cycle >= query.minCycle!);
  }
  if (query.maxCycle !== undefined) {
    results.filter((r) => r.cycle <= query.maxCycle!);
  }

  // Search in summary
  if (query.summaryContains) {
    const term = query.summaryContains.toLowerCase();
    results = results.filter((r) => r.summary.toLowerCase().includes(term));
  }

  // Apply offset and limit (most recent first = end of array)
  const offset = query.offset ?? 0;
  const limit = query.limit ?? results.length;

  // Take from the end (most recent), then reverse to maintain chronological order
  const start = Math.max(0, results.length - offset - limit);
  const end = results.length - offset;
  results = results.slice(start, end);

  return results;
}

/**
 * Get history for a specific time window.
 * Convenience wrapper around queryHistory().
 */
export function getHistoryWindow(
  hoursBack: number,
  options: Omit<HistoryQuery, "since" | "until"> = {}
): EvolutionRecord[] {
  const now = Date.now();
  const since = new Date(now - hoursBack * 60 * 60 * 1000).toISOString();

  return queryHistory({
    since,
    ...options,
  });
}

/**
 * Get summary of recent activity without loading full records.
 * Returns minimal data for quick status checks.
 */
export function getRecentActivitySummary(hoursBack: number = 24): {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  avgDurationMs?: number;
} {
  const records = getHistoryWindow(hoursBack);

  if (records.length === 0) {
    return { total: 0, successful: 0, failed: 0, skipped: 0 };
  }

  const successful = records.filter((r) => r.status === "success");
  const failed = records.filter((r) => r.status === "failed");
  const skipped = records.filter((r) => r.status === "skipped");

  const durations = records.filter((r) => r.durationMs).map((r) => r.durationMs!);
  const avgDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : undefined;

  return {
    total: records.length,
    successful: successful.length,
    failed: failed.length,
    skipped: skipped.length,
    avgDurationMs,
  };
}

/**
 * Find cycles that match a pattern in their summary.
 * Useful for finding specific types of work (e.g., "refactor", "fix", "test").
 */
export function findCyclesByWorkType(
  pattern: string,
  options: Omit<HistoryQuery, "summaryContains"> = {}
): EvolutionRecord[] {
  return queryHistory({
    summaryContains: pattern,
    ...options,
  });
}

/**
 * Get cycles around a specific cycle number (context window).
 * Useful for understanding what happened before/after a specific event.
 */
export function getCycleContext(
  targetCycle: number,
  contextSize: number = 5
): {
  before: EvolutionRecord[];
  target: EvolutionRecord | null;
  after: EvolutionRecord[];
} {
  const history = loadEvolutionHistory();

  const targetIndex = history.findIndex((r) => r.cycle === targetCycle);

  if (targetIndex === -1) {
    return { before: [], target: null, after: [] };
  }

  const before = history.slice(Math.max(0, targetIndex - contextSize), targetIndex);
  const target = history[targetIndex];
  const after = history.slice(targetIndex + 1, targetIndex + 1 + contextSize);

  return { before, target, after };
}
