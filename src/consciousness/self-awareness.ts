/**
 * Self-Awareness Module
 * 
 * Inspired by Gödel Agent (ACL 2025) and TT-SI papers, this module provides
 * Jinx with the ability to understand its own code structure, capabilities,
 * and state.
 * 
 * Key functions:
 * - getSelfAwarenessReport(): Generate a comprehensive self-awareness report
 * - assessConfidence(task): Evaluate confidence level for a given task
 * - identifyWeaknesses(): Analyze historical failures to identify weak areas
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { readState, readVersion } from "../util/state.js";
import { loadEvolutionHistory, calculateEvolutionStats, getAverageQualityScore } from "./history.js";
import { getCapabilitySummaryObject } from "./capabilities.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface SelfAwarenessReport {
  version: string;
  cycle: number;
  branch: string;
  sha: string;
  uptime: number;
  codebase: CodebaseStats;
  capabilities: CapabilitySummary;
  evolutionStats: ReportEvolutionStats;
  weaknesses: Weakness[];
  confidence: number;
}

export interface CodebaseStats {
  totalFiles: number;
  totalLines: number;
  modules: ModuleInfo[];
}

export interface ModuleInfo {
  name: string;
  path: string;
  files: number;
  lines: number;
  description: string;
}

export interface CapabilitySummary {
  expert: string[];
  advanced: string[];
  novice: string[];
  gaps: string[];
}

export interface ReportEvolutionStats {
  totalCycles: number;
  successRate: number;
  timeoutRate: number;
  avgDurationMs: number;
  avgQualityScore: number | null;
}

export interface Weakness {
  category: string;
  description: string;
  evidence: string;
  severity: "low" | "medium" | "high";
}

// ── Module Descriptions ─────────────────────────────────────────────────

const MODULE_DESCRIPTIONS: Record<string, string> = {
  consciousness: "Evolution loop, goal discovery, strategy management",
  supervisor: "Process lifecycle, git operations, restart handling",
  telegram: "Telegram bot integration, commands, notifications",
  agent: "Pi agent session management, tool registration",
  memory: "Knowledge graph, reflection, principle distillation",
  evolution: "Archive, capsule store, strategy selection",
  health: "System health monitoring and diagnostics",
  quality: "Code quality checks, evolution scoring",
  observability: "Tracing, metrics, performance monitoring",
  costs: "API cost tracking and reporting",
  search: "Web search integration (Brave, Exa, Serper)",
  swarm: "Multi-agent parallel analysis",
  github: "GitHub API tools and integration",
  util: "Shared utilities, logging, state management",
  config: "Configuration and prompts",
  skills: "Skill library system",
  diagnosis: "Self-diagnosis and repair",
  coverage: "Test coverage analysis",
};

// ── Core Functions ─────────────────────────────────────────────────────

/**
 * Generate a comprehensive self-awareness report.
 */
export function getSelfAwarenessReport(): SelfAwarenessReport {
  const state = readState();
  const version = readVersion();
  const historyStats = calculateEvolutionStats();
  const capabilities = getCapabilitySummaryObject();
  const codebase = analyzeCodebase();
  const weaknesses = identifyWeaknesses();
  
  // Compute additional stats from history
  const history = loadEvolutionHistory();
  const successRate = historyStats.totalCycles > 0 
    ? historyStats.successfulCycles / historyStats.totalCycles 
    : 0;
  const timeoutRate = historyStats.totalCycles > 0 
    ? historyStats.timeoutCycles / historyStats.totalCycles 
    : 0;
  const avgDurationMs = history.length > 0
    ? history.filter(h => h.durationMs).reduce((sum, h) => sum + (h.durationMs || 0), 0) / history.filter(h => h.durationMs).length || 0
    : 0;
  const avgQualityScore = getAverageQualityScore(5);

  // Build stats object for confidence calculation
  const evolutionStatsForConfidence: ReportEvolutionStats = {
    totalCycles: historyStats.totalCycles,
    successRate,
    timeoutRate,
    avgDurationMs,
    avgQualityScore,
  };

  const confidence = calculateOverallConfidence(evolutionStatsForConfidence, weaknesses);

  // Get git info
  let branch = "unknown";
  let sha = "unknown";
  try {
    const { getCurrentBranch, getCurrentSha } = require("../supervisor/git-ops.js");
    branch = getCurrentBranch();
    sha = getCurrentSha().slice(0, 8);
  } catch (e) {
    // Git ops not available
  }

  return {
    version,
    cycle: state.cycle,
    branch,
    sha,
    uptime: process.uptime(),
    codebase,
    capabilities: {
      expert: capabilities?.expert || [],
      advanced: capabilities?.advanced || [],
      novice: capabilities?.novice || [],
      gaps: capabilities?.gaps || [],
    },
    evolutionStats: {
      totalCycles: historyStats.totalCycles,
      successRate,
      timeoutRate,
      avgDurationMs,
      avgQualityScore,
    },
    weaknesses,
    confidence,
  };
}

/**
 * Analyze the codebase structure.
 */
function analyzeCodebase(): CodebaseStats {
  const srcDir = join(process.cwd(), "src");
  const modules: ModuleInfo[] = [];
  let totalFiles = 0;
  let totalLines = 0;

  if (!existsSync(srcDir)) {
    return { totalFiles: 0, totalLines: 0, modules: [] };
  }

  const entries = readdirSync(srcDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modulePath = join(srcDir, entry.name);
    const info = analyzeModule(entry.name, modulePath);
    modules.push(info);
    totalFiles += info.files;
    totalLines += info.lines;
  }

  // Sort by lines (largest first)
  modules.sort((a, b) => b.lines - a.lines);

  return { totalFiles, totalLines, modules };
}

/**
 * Analyze a single module directory.
 */
function analyzeModule(name: string, modulePath: string): ModuleInfo {
  let files = 0;
  let lines = 0;

  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        files++;
        try {
          const content = readFileSync(fullPath, "utf-8");
          lines += content.split("\n").length;
        } catch (e) {
          // Ignore read errors
        }
      }
    }
  }

  walk(modulePath);

  return {
    name,
    path: relative(process.cwd(), modulePath),
    files,
    lines,
    description: MODULE_DESCRIPTIONS[name] || "Unknown module",
  };
}

/**
 * Identify weaknesses based on historical failures.
 */
export function identifyWeaknesses(): Weakness[] {
  const weaknesses: Weakness[] = [];
  const history = loadEvolutionHistory();

  // Analyze timeout failures
  const timeouts = history.filter(h => h.status === "timeout" || 
    (h.status === "failed" && h.summary?.toLowerCase().includes("timeout")));
  if (timeouts.length >= 3) {
    weaknesses.push({
      category: "evolution-stability",
      description: "High timeout failure rate in evolution cycles",
      evidence: `${timeouts.length} timeout failures out of ${history.length} cycles (${Math.round(timeouts.length / history.length * 100)}%)`,
      severity: timeouts.length >= 5 ? "high" : "medium",
    });
  }

  // Analyze recent failures
  const recentFailures = history.slice(-10).filter(h => h.status === "failed");
  if (recentFailures.length >= 3) {
    weaknesses.push({
      category: "recent-stability",
      description: "Multiple recent evolution failures",
      evidence: `${recentFailures.length} failures in last 10 cycles`,
      severity: recentFailures.length >= 5 ? "high" : "medium",
    });
  }

  // Check capability gaps
  const capabilities = getCapabilitySummaryObject();
  if (capabilities.gaps && capabilities.gaps.length > 0) {
    weaknesses.push({
      category: "capability-gaps",
      description: "Missing desired capabilities",
      evidence: `${capabilities.gaps.length} capability gaps: ${capabilities.gaps.slice(0, 3).join(", ")}`,
      severity: "low",
    });
  }

  // Check novice capabilities
  if (capabilities.novice && capabilities.novice.length > 5) {
    weaknesses.push({
      category: "capability-maturity",
      description: "Many capabilities at novice level",
      evidence: `${capabilities.novice.length} novice capabilities need maturation`,
      severity: "low",
    });
  }

  return weaknesses;
}

/**
 * Calculate overall confidence score (0-1).
 */
function calculateOverallConfidence(
  stats: ReportEvolutionStats, 
  weaknesses: Weakness[]
): number {
  // Base confidence from success rate
  let confidence = stats.successRate;

  // Penalize for weaknesses
  const severityPenalty: Record<string, number> = {
    high: 0.2,
    medium: 0.1,
    low: 0.05,
  };

  for (const w of weaknesses) {
    confidence -= severityPenalty[w.severity] || 0.1;
  }

  // Penalize for timeout rate
  confidence -= stats.timeoutRate * 0.3;

  // Ensure range
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Assess confidence for a specific task type.
 */
export function assessConfidence(taskTitle: string): number {
  const history = loadEvolutionHistory();
  const weaknesses = identifyWeaknesses();

  // Base confidence
  let confidence = 0.7;

  // Check for keywords that indicate complexity
  const complexKeywords = ["research", "implement complete", "refactor", "integrate", "architecture"];
  const simpleKeywords = ["fix", "update", "add", "improve", "enhance"];

  const taskLower = taskTitle.toLowerCase();
  
  for (const kw of complexKeywords) {
    if (taskLower.includes(kw)) {
      confidence -= 0.15;
    }
  }

  for (const kw of simpleKeywords) {
    if (taskLower.includes(kw)) {
      confidence += 0.05;
    }
  }

  // Check historical performance on similar tasks
  // (simplified - could be enhanced with embedding-based similarity)
  const similarTasks = history.filter(h => 
    h.summary?.toLowerCase().includes(taskLower.split(" ")[0]) ||
    taskLower.includes(h.summary?.toLowerCase().split(" ")[0] || "")
  );

  if (similarTasks.length > 0) {
    const successCount = similarTasks.filter(t => t.status === "success").length;
    const historicalRate = successCount / similarTasks.length;
    confidence = confidence * 0.5 + historicalRate * 0.5; // Blend with historical
  }

  // Penalize for weaknesses
  for (const w of weaknesses) {
    if (w.severity === "high") confidence -= 0.1;
    if (w.severity === "medium") confidence -= 0.05;
  }

  return Math.max(0, Math.min(1, confidence));
}

// ── Formatting Functions ───────────────────────────────────────────────

/**
 * Format the self-awareness report for display.
 */
export function formatSelfAwarenessReport(report: SelfAwarenessReport): string {
  const lines: string[] = [
    "🧠 **Jinx Self-Awareness Report**",
    "",
    "## 📊 Core Identity",
    `Version: ${report.version} | Cycle: ${report.cycle}`,
    `Branch: ${report.branch} (${report.sha})`,
    `Uptime: ${formatUptime(report.uptime)}`,
    `Overall Confidence: **${(report.confidence * 100).toFixed(0)}%**`,
    "",
    "## 📁 Codebase Structure",
    `Total: ${report.codebase.totalFiles} files, ${report.codebase.totalLines.toLocaleString()} lines`,
    "",
    "**Top Modules:**",
  ];

  for (const mod of report.codebase.modules.slice(0, 5)) {
    lines.push(`  ${mod.name}/ — ${mod.lines.toLocaleString()} lines (${mod.files} files)`);
    lines.push(`    ${mod.description}`);
  }

  lines.push("");
  lines.push("## 🎯 Capabilities");
  
  if (report.capabilities.expert.length > 0) {
    lines.push(`**Expert:** ${report.capabilities.expert.join(", ")}`);
  }
  if (report.capabilities.advanced.length > 0) {
    lines.push(`**Advanced:** ${report.capabilities.advanced.join(", ")}`);
  }
  if (report.capabilities.novice.length > 0) {
    lines.push(`**Novice:** ${report.capabilities.novice.slice(0, 5).join(", ")}${report.capabilities.novice.length > 5 ? "..." : ""}`);
  }
  if (report.capabilities.gaps.length > 0) {
    lines.push(`**Gaps:** ${report.capabilities.gaps.slice(0, 3).join(", ")}`);
  }

  lines.push("");
  lines.push("## 📈 Evolution Statistics");
  lines.push(`Total Cycles: ${report.evolutionStats.totalCycles}`);
  lines.push(`Success Rate: ${(report.evolutionStats.successRate * 100).toFixed(0)}%`);
  lines.push(`Timeout Rate: ${(report.evolutionStats.timeoutRate * 100).toFixed(0)}%`);
  
  if (report.evolutionStats.avgQualityScore !== null) {
    lines.push(`Avg Quality: ${report.evolutionStats.avgQualityScore.toFixed(1)}/10`);
  }

  if (report.weaknesses.length > 0) {
    lines.push("");
    lines.push("## ⚠️ Identified Weaknesses");
    for (const w of report.weaknesses) {
      const emoji = w.severity === "high" ? "🔴" : w.severity === "medium" ? "🟡" : "🟢";
      lines.push(`${emoji} **${w.category}**: ${w.description}`);
      lines.push(`   ${w.evidence}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format uptime in human-readable form.
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

