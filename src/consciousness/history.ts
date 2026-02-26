import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

const HISTORY_PATH = join(DATA_DIR, "evolution-history.json");
const MAX_HISTORY_ENTRIES = 100; // Keep last 100 cycles

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

/**
 * Load evolution history from disk.
 */
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
 * Save evolution history to disk.
 */
export function saveEvolutionHistory(history: EvolutionRecord[]): void {
  try {
    // Keep only the last MAX_HISTORY_ENTRIES
    const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
    writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    log.warn("Failed to save evolution history", { error: (e as Error).message });
  }
}

/**
 * Record a new evolution cycle result.
 */
export function recordEvolutionResult(
  cycle: number,
  version: string,
  status: EvolutionRecord["status"],
  summary: string,
  durationMs?: number
): void {
  const history = loadEvolutionHistory();

  history.push({
    cycle,
    timestamp: new Date().toISOString(),
    version,
    status,
    summary: summary.slice(0, 500), // Limit summary length
    durationMs,
  });

  saveEvolutionHistory(history);
  log.info(`Evolution #${cycle} recorded`, { status, version });
}

/**
 * Calculate evolution statistics from history.
 */
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

  // Calculate streaks
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

  // Current streak is from the end
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

/**
 * Format evolution history for display.
 */
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
