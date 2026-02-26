import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

const HISTORY_PATH = join(DATA_DIR, "evolution-history.json");
const EVOLOG_PATH = "EVOLOG.md";
const MAX_HISTORY_ENTRIES = 100;

// File system interface for dependency injection (testing)
export interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
}

// Real file system implementation
const realFileSystem: FileSystem = {
  readFile(path: string): string {
    return readFileSync(path, "utf-8");
  },
  writeFile(path: string, content: string): void {
    writeFileSync(path, content);
  },
  exists(path: string): boolean {
    return existsSync(path);
  },
};

// In-memory file system for testing
export function createMemoryFileSystem(initialFiles: Record<string, string> = {}): FileSystem {
  const files = { ...initialFiles };
  return {
    readFile(path: string): string {
      if (!(path in files)) {
        throw new Error(`File not found: ${path}`);
      }
      return files[path];
    },
    writeFile(path: string, content: string): void {
      files[path] = content;
    },
    exists(path: string): boolean {
      return path in files;
    },
  };
}

// Global file system instance (can be overridden for testing)
let _fileSystem: FileSystem = realFileSystem;

export function setFileSystem(fs: FileSystem): void {
  _fileSystem = fs;
}

export function resetFileSystem(): void {
  _fileSystem = realFileSystem;
}

export function getFileSystem(): FileSystem {
  return _fileSystem;
}

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

export function saveEvolutionHistory(history: EvolutionRecord[]): void {
  try {
    const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
    writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    log.warn("Failed to save evolution history", { error: (e as Error).message });
  }
}

function updateEvolog(record: EvolutionRecord): void {
  try {
    const fs = getFileSystem();
    let content = "";
    if (fs.exists(EVOLOG_PATH)) {
      content = fs.readFile(EVOLOG_PATH);
    }

    const date = new Date(record.timestamp).toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const entry = `### ${record.status === "success" ? "✅" : "❌"} Cycle #${record.cycle} — ${record.version}

- **Date:** ${date}
- **Status:** ${record.status}

> ${record.summary.slice(0, 200)}${record.summary.length > 200 ? "..." : ""}

`;

    const totalCyclesMatch = content.match(/\|\s*Total Cycles\s*\|\s*(\d+)\s*\|/);
    if (totalCyclesMatch) {
      const currentTotal = parseInt(totalCyclesMatch[1], 10);
      if (record.cycle > currentTotal) {
        content = content.replace(
          /\|\s*Total Cycles\s*\|\s*\d+\s*\|/,
          `| Total Cycles | ${record.cycle} |`
        );
      }
    }

    const successfulMatch = content.match(/\|\s*Successful\s*\|\s*(\d+)\s*\|/);
    const failedMatch = content.match(/\|\s*Failed\s*\|\s*(\d+)\s*\|/);
    const skippedMatch = content.match(/\|\s*Skipped\s*\|\s*(\d+)\s*\|/);

    if (successfulMatch && record.status === "success") {
      const current = parseInt(successfulMatch[1], 10);
      content = content.replace(
        /\|\s*Successful\s*\|\s*\d+\s*\|/,
        `| Successful | ${current + 1} |`
      );
    }
    if (failedMatch && record.status === "failed") {
      const current = parseInt(failedMatch[1], 10);
      content = content.replace(
        /\|\s*Failed\s*\|\s*\d+\s*\|/,
        `| Failed | ${current + 1} |`
      );
    }
    if (skippedMatch && record.status === "skipped") {
      const current = parseInt(skippedMatch[1], 10);
      content = content.replace(
        /\|\s*Skipped\s*\|\s*\d+\s*\|/,
        `| Skipped | ${current + 1} |`
      );
    }

    const historyMarker = "## 📜 Evolution History\n";
    const insertPos = content.indexOf(historyMarker);

    if (insertPos >= 0) {
      const before = content.slice(0, insertPos + historyMarker.length);
      const after = content.slice(insertPos + historyMarker.length);
      content = before + "\n" + entry + after;
    } else {
      content += "\n" + entry;
    }

    fs.writeFile(EVOLOG_PATH, content);
    log.info(`EVOLOG.md updated with cycle #${record.cycle}`);
  } catch (e) {
    log.warn("Failed to update EVOLOG.md", { error: (e as Error).message });
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
  updateEvolog(record);
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
