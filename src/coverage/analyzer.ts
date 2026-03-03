/**
 * Test Coverage Analyzer
 * 
 * Reads and analyzes vitest coverage reports to:
 * - Track coverage trends over time
 * - Identify untested files
 * - Generate coverage summaries
 * - Display coverage on site
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

const DATA_DIR = join(process.cwd(), "data");
const COVERAGE_HISTORY_PATH = join(DATA_DIR, "coverage-history.json");
const COVERAGE_REPORT_PATH = join(process.cwd(), "coverage", "coverage-summary.json");

// ── Types ──────────────────────────────────────────────────────────

export interface CoverageMetrics {
  lines: { total: number; covered: number; pct: number };
  statements: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
}

export interface FileCoverage {
  path: string;
  metrics: CoverageMetrics;
  uncoveredLines?: number[];
}

export interface CoverageSummary {
  timestamp: string;
  overall: CoverageMetrics;
  files: FileCoverage[];
  untestedFiles: string[];
  lowCoverageFiles: FileCoverage[];
}

export interface CoverageHistory {
  entries: Array<{
    date: string;
    overall: CoverageMetrics;
    commit?: string;
  }>;
}

// ── Read Coverage Report ───────────────────────────────────────────

/**
 * Read vitest coverage summary report
 */
function parseFileEntry(path: string, fileData: unknown): FileCoverage {
  return {
    path: path.replace(process.cwd(), "").replace(/^\//, ""),
    metrics: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines: (fileData as any).lines || { total: 0, covered: 0, pct: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      statements: (fileData as any).statements || { total: 0, covered: 0, pct: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      functions: (fileData as any).functions || { total: 0, covered: 0, pct: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      branches: (fileData as any).branches || { total: 0, covered: 0, pct: 0 },
    },
  };
}

export function readCoverageReport(): CoverageSummary | null {
  try {
    if (!existsSync(COVERAGE_REPORT_PATH)) {
      log.warn("Coverage report not found", { path: COVERAGE_REPORT_PATH });
      return null;
    }

    const data = JSON.parse(readFileSync(COVERAGE_REPORT_PATH, "utf-8"));
    
    // Extract overall metrics
    const total = data.total || {};
    const overall: CoverageMetrics = {
      lines: total.lines || { total: 0, covered: 0, pct: 0 },
      statements: total.statements || { total: 0, covered: 0, pct: 0 },
      functions: total.functions || { total: 0, covered: 0, pct: 0 },
      branches: total.branches || { total: 0, covered: 0, pct: 0 },
    };

    // Extract file-level coverage
    const files: FileCoverage[] = [];
    const untestedFiles: string[] = [];
    const lowCoverageFiles: FileCoverage[] = [];

    for (const [path, fileData] of Object.entries(data)) {
      if (path === "total") continue;
      const fileCoverage = parseFileEntry(path, fileData);
      files.push(fileCoverage);
      if (fileCoverage.metrics.lines.pct === 0) {
        untestedFiles.push(fileCoverage.path);
      } else if (fileCoverage.metrics.lines.pct < 50) {
        lowCoverageFiles.push(fileCoverage);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      overall,
      files,
      untestedFiles,
      lowCoverageFiles,
    };
  } catch (e) {
    log.error("Failed to read coverage report", { error: (e as Error).message });
    return null;
  }
}

// ── Coverage History ───────────────────────────────────────────────

/**
 * Load coverage history from data file
 */
export function loadCoverageHistory(): CoverageHistory {
  try {
    if (existsSync(COVERAGE_HISTORY_PATH)) {
      return JSON.parse(readFileSync(COVERAGE_HISTORY_PATH, "utf-8"));
    }
  } catch (e) {
    log.error("Failed to load coverage history", { error: (e as Error).message });
  }
  return { entries: [] };
}

/**
 * Save coverage history
 */
export function saveCoverageHistory(history: CoverageHistory): void {
  try {
    writeFileSync(COVERAGE_HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch (e) {
    log.error("Failed to save coverage history", { error: (e as Error).message });
  }
}

/**
 * Record current coverage to history
 */
export function recordCoverage(summary: CoverageSummary): void {
  const history = loadCoverageHistory();
  
  const entry = {
    date: new Date().toISOString(),
    overall: summary.overall,
  };

  history.entries.push(entry);
  
  // Keep only last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  history.entries = history.entries.filter(
    e => new Date(e.date) > cutoff
  );

  saveCoverageHistory(history);
  log.info("Coverage recorded to history", { 
    lines: summary.overall.lines.pct,
    files: summary.files.length,
  });
}

// ── Coverage Analysis ──────────────────────────────────────────────

/**
 * Get coverage trend over time
 */
export function getCoverageTrend(days: number = 30): Array<{ date: string; lineCoverage: number }> {
  const history = loadCoverageHistory();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  return history.entries
    .filter(e => new Date(e.date) > cutoff)
    .map(e => ({
      date: e.date.split("T")[0],
      lineCoverage: e.overall.lines.pct,
    }));
}

/**
 * Calculate coverage change since last run
 */
export function getCoverageChange(): { lines: number; statements: number; functions: number; branches: number } {
  const history = loadCoverageHistory();
  
  if (history.entries.length < 2) {
    return { lines: 0, statements: 0, functions: 0, branches: 0 };
  }

  const current = history.entries[history.entries.length - 1].overall;
  const previous = history.entries[history.entries.length - 2].overall;

  return {
    lines: current.lines.pct - previous.lines.pct,
    statements: current.statements.pct - previous.statements.pct,
    functions: current.functions.pct - previous.functions.pct,
    branches: current.branches.pct - previous.branches.pct,
  };
}

// ── Formatting ─────────────────────────────────────────────────────

/**
 * Format coverage as percentage with color indicator
 */
function formatCoverage(pct: number): string {
  if (pct >= 80) return `🟢 ${pct.toFixed(1)}%`;
  if (pct >= 50) return `🟡 ${pct.toFixed(1)}%`;
  return `🔴 ${pct.toFixed(1)}%`;
}

/**
 * Format coverage report for display
 */
export function formatCoverageReport(summary: CoverageSummary): string {
  const lines: string[] = [
    "📊 Test Coverage Report",
    "",
    `📅 Generated: ${new Date(summary.timestamp).toLocaleString()}`,
    "",
    "Overall Coverage:",
    `  Lines:       ${formatCoverage(summary.overall.lines.pct)} (${summary.overall.lines.covered}/${summary.overall.lines.total})`,
    `  Statements:  ${formatCoverage(summary.overall.statements.pct)} (${summary.overall.statements.covered}/${summary.overall.statements.total})`,
    `  Functions:   ${formatCoverage(summary.overall.functions.pct)} (${summary.overall.functions.covered}/${summary.overall.functions.total})`,
    `  Branches:    ${formatCoverage(summary.overall.branches.pct)} (${summary.overall.branches.covered}/${summary.overall.branches.total})`,
    "",
    `📁 Files analyzed: ${summary.files.length}`,
    `⚠️  Untested files: ${summary.untestedFiles.length}`,
    `📉 Low coverage (<50%): ${summary.lowCoverageFiles.length}`,
  ];

  if (summary.untestedFiles.length > 0) {
    lines.push("", "Untested Files:");
    summary.untestedFiles.slice(0, 10).forEach(f => lines.push(`  • ${f}`));
    if (summary.untestedFiles.length > 10) {
      lines.push(`  ... and ${summary.untestedFiles.length - 10} more`);
    }
  }

  if (summary.lowCoverageFiles.length > 0) {
    lines.push("", "Low Coverage Files:");
    summary.lowCoverageFiles
      .sort((a, b) => a.metrics.lines.pct - b.metrics.lines.pct)
      .slice(0, 10)
      .forEach(f => lines.push(`  • ${f.path}: ${f.metrics.lines.pct.toFixed(1)}%`));
  }

  const change = getCoverageChange();
  lines.push(
    "",
    "📈 Change from last run:",
    `  Lines: ${change.lines >= 0 ? "+" : ""}${change.lines.toFixed(1)}%`,
  );

  return lines.join("\n");
}

/**
 * Format coverage summary (short version for notifications)
 */
export function formatCoverageSummary(summary: CoverageSummary): string {
  const change = getCoverageChange();
  const changeEmoji = change.lines > 0 ? "📈" : change.lines < 0 ? "📉" : "➡️";
  
  return [
    `📊 Coverage: ${summary.overall.lines.pct.toFixed(1)}% lines`,
    `${changeEmoji} Change: ${change.lines >= 0 ? "+" : ""}${change.lines.toFixed(1)}%`,
    `📁 ${summary.files.length} files, ${summary.untestedFiles.length} untested`,
  ].join(" | ");
}

// ── CLI ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  switch (command) {
    case "report": {
      const summary = readCoverageReport();
      if (summary) {
        console.log(formatCoverageReport(summary));
        recordCoverage(summary);
      } else {
        console.log("No coverage report found. Run 'npm run test:coverage' first.");
        process.exit(1);
      }
      break;
    }
    case "summary": {
      const summary = readCoverageReport();
      if (summary) {
        console.log(formatCoverageSummary(summary));
        recordCoverage(summary);
      } else {
        console.log("No coverage data");
        process.exit(1);
      }
      break;
    }
    case "trend": {
      const trend = getCoverageTrend(30);
      console.log("📈 Coverage Trend (30 days):");
      trend.forEach(t => console.log(`  ${t.date}: ${t.lineCoverage.toFixed(1)}%`));
      break;
    }
    default:
      console.log("Usage: npx tsx src/coverage/analyzer.ts [report|summary|trend]");
  }
}
