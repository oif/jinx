/**
 * Performance metrics tracking for Jinx
 * Tracks agent response times, tool usage, and evolution cycle performance
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

const METRICS_PATH = join(DATA_DIR, "performance-metrics.json");
const MAX_ENTRIES = 1000; // Keep last 1000 measurements

// ── Types ──────────────────────────────────────────────────────────

export interface AgentPromptMetric {
  timestamp: string;
  durationMs: number;
  hasImages: boolean;
  wasStreaming: boolean;
  success: boolean;
  errorType?: string;
}

export interface ToolCallMetric {
  timestamp: string;
  toolName: string;
  durationMs: number;
  success: boolean;
}

export interface EvolutionCycleMetric {
  timestamp: string;
  cycle: number;
  taskId: string;
  durationMs: number;
  status: "success" | "failed";
}

export interface PerformanceMetrics {
  agentPrompts: AgentPromptMetric[];
  toolCalls: ToolCallMetric[];
  evolutionCycles: EvolutionCycleMetric[];
  sessionStartTime: string;
}

export interface PerformanceSummary {
  uptimeHours: number;
  totalPrompts: number;
  avgResponseTimeMs: number;
  p95ResponseTimeMs: number;
  totalToolCalls: number;
  toolBreakdown: Record<string, number>;
  totalEvolutions: number;
  evolutionSuccessRate: number;
  avgEvolutionTimeMs: number;
}

// ── Storage ────────────────────────────────────────────────────────

function loadMetrics(): PerformanceMetrics {
  try {
    if (existsSync(METRICS_PATH)) {
      const data = JSON.parse(readFileSync(METRICS_PATH, "utf-8"));
      // Ensure all arrays exist
      return {
        agentPrompts: data.agentPrompts || [],
        toolCalls: data.toolCalls || [],
        evolutionCycles: data.evolutionCycles || [],
        sessionStartTime: data.sessionStartTime || new Date().toISOString(),
      };
    }
  } catch (e) {
    log.warn("Failed to load performance metrics", { error: (e as Error).message });
  }
  return {
    agentPrompts: [],
    toolCalls: [],
    evolutionCycles: [],
    sessionStartTime: new Date().toISOString(),
  };
}

function saveMetrics(metrics: PerformanceMetrics): void {
  try {
    // Trim arrays to MAX_ENTRIES
    const trimmed: PerformanceMetrics = {
      agentPrompts: metrics.agentPrompts.slice(-MAX_ENTRIES),
      toolCalls: metrics.toolCalls.slice(-MAX_ENTRIES),
      evolutionCycles: metrics.evolutionCycles.slice(-MAX_ENTRIES),
      sessionStartTime: metrics.sessionStartTime,
    };
    writeFileSync(METRICS_PATH, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    log.warn("Failed to save performance metrics", { error: (e as Error).message });
  }
}

// ── Recording ──────────────────────────────────────────────────────

export function recordAgentPrompt(metric: Omit<AgentPromptMetric, "timestamp">): void {
  const metrics = loadMetrics();
  metrics.agentPrompts.push({
    ...metric,
    timestamp: new Date().toISOString(),
  });
  saveMetrics(metrics);
}

export function recordToolCall(metric: Omit<ToolCallMetric, "timestamp">): void {
  const metrics = loadMetrics();
  metrics.toolCalls.push({
    ...metric,
    timestamp: new Date().toISOString(),
  });
  saveMetrics(metrics);
}

export function recordEvolutionCycle(metric: Omit<EvolutionCycleMetric, "timestamp">): void {
  const metrics = loadMetrics();
  metrics.evolutionCycles.push({
    ...metric,
    timestamp: new Date().toISOString(),
  });
  saveMetrics(metrics);
}

// ── Analysis ───────────────────────────────────────────────────────

function calculatePercentile(sortedArray: number[], percentile: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

export function getPerformanceSummary(): PerformanceSummary {
  const metrics = loadMetrics();
  const now = new Date();
  const sessionStart = new Date(metrics.sessionStartTime);
  const uptimeHours = (now.getTime() - sessionStart.getTime()) / (1000 * 60 * 60);

  // Agent prompt stats
  const promptDurations = metrics.agentPrompts.map(p => p.durationMs).sort((a, b) => a - b);
  const successfulPrompts = metrics.agentPrompts.filter(p => p.success);
  const avgResponseTimeMs = promptDurations.length > 0
    ? promptDurations.reduce((a, b) => a + b, 0) / promptDurations.length
    : 0;
  const p95ResponseTimeMs = calculatePercentile(promptDurations, 95);

  // Tool call stats
  const toolBreakdown: Record<string, number> = {};
  for (const call of metrics.toolCalls) {
    toolBreakdown[call.toolName] = (toolBreakdown[call.toolName] || 0) + 1;
  }

  // Evolution stats
  const successfulEvolutions = metrics.evolutionCycles.filter(e => e.status === "success");
  const evolutionDurations = metrics.evolutionCycles.map(e => e.durationMs);
  const avgEvolutionTimeMs = evolutionDurations.length > 0
    ? evolutionDurations.reduce((a, b) => a + b, 0) / evolutionDurations.length
    : 0;

  return {
    uptimeHours: Math.round(uptimeHours * 100) / 100,
    totalPrompts: metrics.agentPrompts.length,
    avgResponseTimeMs: Math.round(avgResponseTimeMs),
    p95ResponseTimeMs: Math.round(p95ResponseTimeMs),
    totalToolCalls: metrics.toolCalls.length,
    toolBreakdown,
    totalEvolutions: metrics.evolutionCycles.length,
    evolutionSuccessRate: metrics.evolutionCycles.length > 0
      ? Math.round((successfulEvolutions.length / metrics.evolutionCycles.length) * 100)
      : 0,
    avgEvolutionTimeMs: Math.round(avgEvolutionTimeMs),
  };
}

// ── Formatting ─────────────────────────────────────────────────────

export function formatPerformanceReport(): string {
  const summary = getPerformanceSummary();

  const lines: string[] = [
    "📊 Performance Report",
    "",
    `⏱️ Uptime: ${summary.uptimeHours.toFixed(1)} hours`,
    "",
    "🤖 Agent Prompts:",
    `   Total: ${summary.totalPrompts}`,
    `   Avg Response: ${summary.avgResponseTimeMs}ms`,
    `   P95 Response: ${summary.p95ResponseTimeMs}ms`,
    "",
    "🛠️ Tool Calls:",
    `   Total: ${summary.totalToolCalls}`,
  ];

  if (Object.keys(summary.toolBreakdown).length > 0) {
    lines.push("   Breakdown:");
    for (const [tool, count] of Object.entries(summary.toolBreakdown).sort((a, b) => b[1] - a[1])) {
      lines.push(`      ${tool}: ${count}`);
    }
  }

  lines.push(
    "",
    "🧬 Evolution Cycles:",
    `   Total: ${summary.totalEvolutions}`,
    `   Success Rate: ${summary.evolutionSuccessRate}%`,
    `   Avg Duration: ${summary.avgEvolutionTimeMs}ms`,
  );

  return lines.join("\n");
}

// ── Reset ──────────────────────────────────────────────────────────

export function resetSessionMetrics(): void {
  const metrics = loadMetrics();
  metrics.sessionStartTime = new Date().toISOString();
  saveMetrics(metrics);
  log.info("Performance metrics session reset");
}
