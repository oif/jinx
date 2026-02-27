/**
 * Self-Diagnosis and Repair Engine for Jinx
 * Analyzes health history and performance metrics to identify failure patterns
 * and generate actionable repair recommendations.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";
import { log } from "../util/log.js";
import type { HealthHistoryEntry } from "../health/history.js";
import type { PerformanceMetrics, AgentPromptMetric, ToolCallMetric, EvolutionCycleMetric } from "../observability/metrics.js";

const HISTORY_PATH = join(DATA_DIR, "health-history.json");
const METRICS_PATH = join(DATA_DIR, "performance-metrics.json");

// ── Types ──────────────────────────────────────────────────────────

export interface FailurePattern {
  id: string;
  type: "health" | "performance" | "evolution" | "tool";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  affectedComponents: string[];
  evidence: Record<string, unknown>;
}

export interface RepairRecommendation {
  patternId: string;
  priority: "low" | "medium" | "high" | "urgent";
  action: string;
  description: string;
  automated: boolean;
  command?: string;
}

export interface DiagnosisReport {
  timestamp: string;
  overallHealth: "healthy" | "degraded" | "critical";
  patternsFound: number;
  patterns: FailurePattern[];
  recommendations: RepairRecommendation[];
  summary: string;
}

// ── Data Loading ───────────────────────────────────────────────────

function loadHealthHistory(): HealthHistoryEntry[] {
  try {
    if (existsSync(HISTORY_PATH)) {
      return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load health history for diagnosis", { error: (e as Error).message });
  }
  return [];
}

function loadPerformanceMetrics(): PerformanceMetrics {
  try {
    if (existsSync(METRICS_PATH)) {
      return JSON.parse(readFileSync(METRICS_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load performance metrics for diagnosis", { error: (e as Error).message });
  }
  return {
    agentPrompts: [],
    toolCalls: [],
    evolutionCycles: [],
    sessionStartTime: new Date().toISOString(),
  };
}

// ── Pattern Detection ──────────────────────────────────────────────

function detectHealthPatterns(history: HealthHistoryEntry[]): FailurePattern[] {
  const patterns: FailurePattern[] = [];

  if (history.length === 0) {
    return patterns;
  }

  // Pattern 1: Recurring warning/critical status
  const recentHistory = history.slice(-24); // Last 24 entries (2 hours)
  const warningCount = recentHistory.filter(h => h.status === "warning").length;
  const criticalCount = recentHistory.filter(h => h.status === "critical").length;

  if (criticalCount > 0) {
    patterns.push({
      id: "HEALTH-001",
      type: "health",
      severity: "critical",
      title: "Critical Health Status Detected",
      description: `System has been in critical state ${criticalCount} times in the last 2 hours.`,
      affectedComponents: ["system"],
      evidence: { criticalCount, recentEntries: recentHistory.length },
    });
  } else if (warningCount >= 3) {
    patterns.push({
      id: "HEALTH-002",
      type: "health",
      severity: "warning",
      title: "Frequent Warning States",
      description: `System has shown warning signs ${warningCount} times in the last 2 hours.`,
      affectedComponents: ["system"],
      evidence: { warningCount, recentEntries: recentHistory.length },
    });
  }

  // Pattern 2: Memory pressure trend
  const memoryReadings = recentHistory.map(h => h.memoryPercent);
  const avgMemory = memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length;
  const maxMemory = Math.max(...memoryReadings);

  if (maxMemory > 90) {
    patterns.push({
      id: "HEALTH-003",
      type: "health",
      severity: "critical",
      title: "Memory Pressure Critical",
      description: `Memory usage peaked at ${maxMemory.toFixed(1)}% in the last 2 hours.`,
      affectedComponents: ["memory"],
      evidence: { maxMemory, avgMemory, readings: memoryReadings.length },
    });
  } else if (avgMemory > 80) {
    patterns.push({
      id: "HEALTH-004",
      type: "health",
      severity: "warning",
      title: "Sustained High Memory Usage",
      description: `Average memory usage of ${avgMemory.toFixed(1)}% over the last 2 hours.`,
      affectedComponents: ["memory"],
      evidence: { avgMemory, maxMemory },
    });
  }

  // Pattern 3: Disk space concerns
  const diskReadings = recentHistory.map(h => h.diskPercent);
  const maxDisk = Math.max(...diskReadings);

  if (maxDisk > 85) {
    patterns.push({
      id: "HEALTH-005",
      type: "health",
      severity: "warning",
      title: "Disk Space Running Low",
      description: `Disk usage reached ${maxDisk.toFixed(1)}%. Consider cleanup.`,
      affectedComponents: ["disk"],
      evidence: { maxDisk },
    });
  }

  // Pattern 4: CPU spikes
  const cpuReadings = recentHistory.map(h => h.cpuPercent);
  const maxCpu = Math.max(...cpuReadings);
  const avgCpu = cpuReadings.reduce((a, b) => a + b, 0) / cpuReadings.length;

  if (maxCpu > 80) {
    patterns.push({
      id: "HEALTH-006",
      type: "health",
      severity: "info",
      title: "High CPU Peaks Detected",
      description: `CPU usage spiked to ${maxCpu.toFixed(1)}%.`,
      affectedComponents: ["cpu"],
      evidence: { maxCpu, avgCpu },
    });
  }

  return patterns;
}

function detectPerformancePatterns(metrics: PerformanceMetrics): FailurePattern[] {
  const patterns: FailurePattern[] = [];

  // Pattern 1: High failure rate in agent prompts
  const recentPrompts = metrics.agentPrompts.slice(-20);
  if (recentPrompts.length > 0) {
    const failedPrompts = recentPrompts.filter(p => !p.success);
    const failureRate = failedPrompts.length / recentPrompts.length;

    if (failureRate > 0.3) {
      patterns.push({
        id: "PERF-001",
        type: "performance",
        severity: "critical",
        title: "High Agent Prompt Failure Rate",
        description: `${(failureRate * 100).toFixed(0)}% of recent prompts failed (${failedPrompts.length}/${recentPrompts.length}).`,
        affectedComponents: ["agent", "llm"],
        evidence: { failureRate, failedCount: failedPrompts.length, total: recentPrompts.length },
      });
    } else if (failureRate > 0.1) {
      patterns.push({
        id: "PERF-002",
        type: "performance",
        severity: "warning",
        title: "Elevated Prompt Failure Rate",
        description: `${(failureRate * 100).toFixed(0)}% of recent prompts failed.`,
        affectedComponents: ["agent", "llm"],
        evidence: { failureRate },
      });
    }
  }

  // Pattern 2: Slow response times
  const recentDurations = recentPrompts.map(p => p.durationMs);
  if (recentDurations.length > 0) {
    const avgDuration = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
    const maxDuration = Math.max(...recentDurations);

    if (avgDuration > 60000) { // > 60 seconds
      patterns.push({
        id: "PERF-003",
        type: "performance",
        severity: "warning",
        title: "Slow Average Response Time",
        description: `Average response time is ${(avgDuration / 1000).toFixed(1)}s.`,
        affectedComponents: ["agent", "llm"],
        evidence: { avgDuration, maxDuration },
      });
    } else if (maxDuration > 300000) { // > 5 minutes
      patterns.push({
        id: "PERF-004",
        type: "performance",
        severity: "info",
        title: "Occasional Very Slow Responses",
        description: `Some responses took over ${(maxDuration / 60000).toFixed(1)} minutes.`,
        affectedComponents: ["agent"],
        evidence: { maxDuration },
      });
    }
  }

  // Pattern 3: Tool call failures
  const recentToolCalls = metrics.toolCalls.slice(-20);
  if (recentToolCalls.length > 0) {
    const failedCalls = recentToolCalls.filter(t => !t.success);
    const toolFailureRate = failedCalls.length / recentToolCalls.length;

    if (toolFailureRate > 0.2) {
      patterns.push({
        id: "PERF-005",
        type: "tool",
        severity: "warning",
        title: "High Tool Call Failure Rate",
        description: `${(toolFailureRate * 100).toFixed(0)}% of tool calls failed.`,
        affectedComponents: ["tools"],
        evidence: { toolFailureRate, failedTools: failedCalls.map(t => t.toolName) },
      });
    }
  }

  // Pattern 4: Evolution cycle failures
  const recentEvolutions = metrics.evolutionCycles.slice(-10);
  if (recentEvolutions.length > 0) {
    const failedEvolutions = recentEvolutions.filter(e => e.status === "failed");
    const evolutionFailureRate = failedEvolutions.length / recentEvolutions.length;

    if (evolutionFailureRate > 0.5) {
      patterns.push({
        id: "EVO-001",
        type: "evolution",
        severity: "critical",
        title: "Evolution Cycle Failure Crisis",
        description: `${(evolutionFailureRate * 100).toFixed(0)}% of recent evolution cycles failed.`,
        affectedComponents: ["evolution"],
        evidence: { evolutionFailureRate, failedCount: failedEvolutions.length },
      });
    } else if (evolutionFailureRate > 0.2) {
      patterns.push({
        id: "EVO-002",
        type: "evolution",
        severity: "warning",
        title: "Elevated Evolution Failure Rate",
        description: `${(evolutionFailureRate * 100).toFixed(0)}% of recent evolution cycles failed.`,
        affectedComponents: ["evolution"],
        evidence: { evolutionFailureRate },
      });
    }
  }

  return patterns;
}

// ── Repair Recommendation Generation ──────────────────────────────

function generateRecommendations(patterns: FailurePattern[]): RepairRecommendation[] {
  const recommendations: RepairRecommendation[] = [];

  for (const pattern of patterns) {
    switch (pattern.id) {
      case "HEALTH-001":
      case "HEALTH-002":
        recommendations.push({
          patternId: pattern.id,
          priority: "urgent",
          action: "Investigate system health issues",
          description: "Check logs for errors, review resource usage patterns, consider restarting services.",
          automated: false,
        });
        break;

      case "HEALTH-003":
      case "HEALTH-004":
        recommendations.push({
          patternId: pattern.id,
          priority: "high",
          action: "Optimize memory usage",
          description: "Clear caches, review memory-intensive processes, consider increasing RAM.",
          automated: true,
          command: "memory_optimization",
        });
        break;

      case "HEALTH-005":
        recommendations.push({
          patternId: pattern.id,
          priority: "medium",
          action: "Clean up disk space",
          description: "Remove old logs, clear temporary files, archive old data.",
          automated: true,
          command: "disk_cleanup",
        });
        break;

      case "PERF-001":
      case "PERF-002":
        recommendations.push({
          patternId: pattern.id,
          priority: "high",
          action: "Review LLM configuration",
          description: "Check API keys, review model settings, consider fallback models.",
          automated: false,
        });
        break;

      case "PERF-003":
        recommendations.push({
          patternId: pattern.id,
          priority: "medium",
          action: "Optimize response time",
          description: "Consider enabling streaming, reducing context length, or using faster models.",
          automated: false,
        });
        break;

      case "PERF-005":
        recommendations.push({
          patternId: pattern.id,
          priority: "medium",
          action: "Review failing tools",
          description: `Failing tools: ${(pattern.evidence.failedTools as string[] || []).join(", ")}. Check tool configurations and dependencies.`,
          automated: false,
        });
        break;

      case "EVO-001":
      case "EVO-002":
        recommendations.push({
          patternId: pattern.id,
          priority: "high",
          action: "Pause evolution and investigate",
          description: "Evolution cycles are failing frequently. Review recent changes, check task complexity, consider manual intervention.",
          automated: false,
        });
        break;
    }
  }

  return recommendations;
}

// ── Main Diagnosis Function ──────────────────────────────────────

export function runSelfDiagnosis(): DiagnosisReport {
  const history = loadHealthHistory();
  const metrics = loadPerformanceMetrics();

  const healthPatterns = detectHealthPatterns(history);
  const perfPatterns = detectPerformancePatterns(metrics);
  const allPatterns = [...healthPatterns, ...perfPatterns];

  const recommendations = generateRecommendations(allPatterns);

  // Determine overall health
  let overallHealth: "healthy" | "degraded" | "critical" = "healthy";
  if (allPatterns.some(p => p.severity === "critical")) {
    overallHealth = "critical";
  } else if (allPatterns.some(p => p.severity === "warning")) {
    overallHealth = "degraded";
  }

  // Generate summary
  let summary: string;
  if (allPatterns.length === 0) {
    summary = "✅ System is healthy. No issues detected.";
  } else {
    const critical = allPatterns.filter(p => p.severity === "critical").length;
    const warning = allPatterns.filter(p => p.severity === "warning").length;
    const info = allPatterns.filter(p => p.severity === "info").length;
    summary = `Found ${allPatterns.length} pattern(s): ${critical} critical, ${warning} warning, ${info} info.`;
  }

  return {
    timestamp: new Date().toISOString(),
    overallHealth,
    patternsFound: allPatterns.length,
    patterns: allPatterns,
    recommendations,
    summary,
  };
}

// ── Report Formatting ─────────────────────────────────────────────

export function formatDiagnosisReport(report: DiagnosisReport): string {
  const lines: string[] = [
    "🔬 Self-Diagnosis Report",
    `Generated: ${new Date(report.timestamp).toLocaleString()}`,
    "",
    `Overall Health: ${report.overallHealth.toUpperCase()}`,
    report.summary,
    "",
  ];

  if (report.patterns.length > 0) {
    lines.push("📋 Detected Patterns:");
    lines.push("");

    for (const pattern of report.patterns) {
      const emoji = pattern.severity === "critical" ? "🚨" :
                    pattern.severity === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${emoji} [${pattern.id}] ${pattern.title}`);
      lines.push(`    ${pattern.description}`);
      lines.push(`    Affected: ${pattern.affectedComponents.join(", ")}`);
      lines.push("");
    }

    lines.push("🔧 Recommendations:");
    lines.push("");

    const sortedRecs = [...report.recommendations].sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const rec of sortedRecs) {
      const emoji = rec.priority === "urgent" ? "🚨" :
                    rec.priority === "high" ? "🔴" :
                    rec.priority === "medium" ? "🟡" : "🟢";
      lines.push(`${emoji} [${rec.priority.toUpperCase()}] ${rec.action}`);
      lines.push(`    ${rec.description}`);
      if (rec.automated && rec.command) {
        lines.push(`    Auto-fix available: ${rec.command}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Automated Repair Actions ─────────────────────────────────────

export async function executeRepairAction(command: string): Promise<boolean> {
  log.info("Executing repair action", { command });

  switch (command) {
    case "disk_cleanup":
      return await cleanupDisk();
    case "memory_optimization":
      return await optimizeMemory();
    default:
      log.warn("Unknown repair command", { command });
      return false;
  }
}

async function cleanupDisk(): Promise<boolean> {
  try {
    // In a real implementation, this would:
    // 1. Clean old logs
    // 2. Remove temporary files
    // 3. Archive old data
    log.info("Disk cleanup would be executed here");
    return true;
  } catch (e) {
    log.error("Disk cleanup failed", { error: (e as Error).message });
    return false;
  }
}

async function optimizeMemory(): Promise<boolean> {
  try {
    // In a real implementation, this would:
    // 1. Clear caches
    // 2. Suggest GC if applicable
    // 3. Alert about memory leaks
    log.info("Memory optimization would be executed here");
    return true;
  } catch (e) {
    log.error("Memory optimization failed", { error: (e as Error).message });
    return false;
  }
}
