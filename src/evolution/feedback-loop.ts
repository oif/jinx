/**
 * Feedback Loop System
 * 
 * Implements closed-loop verification for the Evaluation-driven Improvement framework.
 * Tracks the effectiveness of improvement tasks and adjusts strategy accordingly.
 * 
 * Key Features:
 * - Track improvement task outcomes
 * - Measure before/after metrics
 * - Validate improvement effectiveness
 * - Adjust strategy based on results
 */

import { 
  ImprovementTask, 
  loadGeneratedTasks, 
  completeTask as markTaskComplete
} from "./improvement-generator.js";
import { 
  loadLatestEvaluation,
  ProblemPattern
} from "./evaluator.js";
import { 
  calculateEvolutionStats,
  getAverageQualityScore 
} from "../consciousness/history.js";
import { log } from "../util/log.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

// ── Types ──────────────────────────────────────────────────────────

export interface FeedbackRecord {
  taskId: string;
  taskTitle: string;
  taskSource: ProblemPattern;
  startedAt: string;
  completedAt: string;
  
  // Before metrics
  beforeHealthScore: number;
  beforeQualityAvg: number | null;
  beforeSuccessRate: number;
  beforeOpportunityCount: number;
  
  // After metrics
  afterHealthScore: number;
  afterQualityAvg: number | null;
  afterSuccessRate: number;
  afterOpportunityCount: number;
  
  // Effectiveness
  improvement: number; // -100 to +100
  effective: boolean;
  analysis: string;
}

export interface FeedbackSummary {
  totalTracked: number;
  effectiveCount: number;
  ineffectiveCount: number;
  averageImprovement: number;
  byPattern: Record<ProblemPattern, { 
    count: number; 
    avgImprovement: number; 
    effectiveRate: number 
  }>;
  recommendations: string[];
}

export interface FeedbackConfig {
  /** Minimum cycles to wait before measuring improvement */
  minCyclesForMeasurement: number;
  /** Minimum improvement to consider task effective */
  effectivenessThreshold: number;
  /** Time window for before/after comparison (hours) */
  comparisonWindowHours: number;
}

// ── Configuration ───────────────────────────────────────────────────

const DEFAULT_CONFIG: FeedbackConfig = {
  minCyclesForMeasurement: 3,
  effectivenessThreshold: 5, // 5% improvement
  comparisonWindowHours: 24,
};

const FEEDBACK_DIR = join(DATA_DIR, "feedback");
const FEEDBACK_PATH = join(FEEDBACK_DIR, "feedback-records.jsonl");

// ── Helper Functions ───────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(FEEDBACK_DIR)) {
    mkdirSync(FEEDBACK_DIR, { recursive: true });
  }
}

/**
 * Load all feedback records.
 */
export function loadFeedbackRecords(): FeedbackRecord[] {
  try {
    if (!existsSync(FEEDBACK_PATH)) return [];
    
    const content = readFileSync(FEEDBACK_PATH, "utf-8").trim();
    if (!content) return [];
    
    const lines = content.split("\n").filter(l => l.trim());
    return lines.map(line => JSON.parse(line) as FeedbackRecord);
  } catch (e) {
    log.warn("Failed to load feedback records", { error: (e as Error).message });
    return [];
  }
}

/**
 * Save a feedback record.
 */
function saveFeedbackRecord(record: FeedbackRecord): void {
  try {
    ensureDir();
    const line = JSON.stringify(record) + "\n";
    writeFileSync(FEEDBACK_PATH, line, { flag: "a" });
    log.info("Feedback record saved", { taskId: record.taskId, improvement: record.improvement });
  } catch (e) {
    log.error("Failed to save feedback record", { error: (e as Error).message });
  }
}

/**
 * Calculate metrics snapshot from evaluation report and history.
 */
function getMetricsSnapshot(): {
  healthScore: number;
  qualityAvg: number | null;
  successRate: number;
  opportunityCount: number;
} {
  const latestEval = loadLatestEvaluation();
  const stats = calculateEvolutionStats();
  const qualityAvg = getAverageQualityScore(10);
  
  return {
    healthScore: latestEval?.healthScore ?? 50,
    qualityAvg,
    successRate: stats.totalCycles > 0 ? stats.successfulCycles / stats.totalCycles : 0,
    opportunityCount: latestEval?.opportunities.length ?? 0,
  };
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Start tracking an improvement task.
 * Records the "before" state.
 */
export function startTrackingTask(task: ImprovementTask): {
  trackingId: string;
  beforeMetrics: ReturnType<typeof getMetricsSnapshot>;
} {
  const beforeMetrics = getMetricsSnapshot();
  
  // Store tracking info in task metadata
  const trackingId = `track-${task.id}`;
  
  log.info("Started tracking improvement task", { 
    taskId: task.id, 
    title: task.title,
    beforeHealth: beforeMetrics.healthScore 
  });
  
  return { trackingId, beforeMetrics };
}

/**
 * Complete tracking and generate feedback record.
 * Compares before/after metrics to determine effectiveness.
 */
export function completeTracking(
  task: ImprovementTask,
  beforeMetrics: ReturnType<typeof getMetricsSnapshot>,
  result: string,
  config: FeedbackConfig = DEFAULT_CONFIG
): FeedbackRecord {
  const afterMetrics = getMetricsSnapshot();
  
  // Calculate improvement score
  // Weight: healthScore 40%, qualityAvg 30%, successRate 20%, opportunityCount 10%
  let improvement = 0;
  
  // Health score improvement (0-100 scale)
  improvement += (afterMetrics.healthScore - beforeMetrics.healthScore) * 0.4;
  
  // Quality improvement (0-10 scale, normalized to 0-100)
  if (beforeMetrics.qualityAvg !== null && afterMetrics.qualityAvg !== null) {
    improvement += (afterMetrics.qualityAvg - beforeMetrics.qualityAvg) * 10 * 0.3;
  }
  
  // Success rate improvement (0-1 scale, normalized to 0-100)
  improvement += (afterMetrics.successRate - beforeMetrics.successRate) * 100 * 0.2;
  
  // Opportunity reduction (fewer problems = better)
  const opportunityChange = beforeMetrics.opportunityCount - afterMetrics.opportunityCount;
  improvement += opportunityChange * 5 * 0.1; // Each opportunity reduced = +5 points
  
  const effective = improvement >= config.effectivenessThreshold;
  
  // Generate analysis
  let analysis = "";
  if (effective) {
    analysis = `Task was effective. Health: ${beforeMetrics.healthScore}→${afterMetrics.healthScore}, ` +
      `Quality: ${beforeMetrics.qualityAvg?.toFixed(1) ?? "N/A"}→${afterMetrics.qualityAvg?.toFixed(1) ?? "N/A"}, ` +
      `Success: ${(beforeMetrics.successRate * 100).toFixed(0)}%→${(afterMetrics.successRate * 100).toFixed(0)}%`;
  } else if (improvement < 0) {
    analysis = `Task may have had negative impact. Health: ${beforeMetrics.healthScore}→${afterMetrics.healthScore}. ` +
      `Consider reviewing the approach.`;
  } else {
    analysis = `Task had minimal impact. Improvement: ${improvement.toFixed(1)} (threshold: ${config.effectivenessThreshold}). ` +
      `May need different approach or more time.`;
  }
  
  const record: FeedbackRecord = {
    taskId: task.id,
    taskTitle: task.title,
    taskSource: task.source,
    startedAt: new Date(Date.now() - config.comparisonWindowHours * 60 * 60 * 1000).toISOString(),
    completedAt: new Date().toISOString(),
    beforeHealthScore: beforeMetrics.healthScore,
    beforeQualityAvg: beforeMetrics.qualityAvg,
    beforeSuccessRate: beforeMetrics.successRate,
    beforeOpportunityCount: beforeMetrics.opportunityCount,
    afterHealthScore: afterMetrics.healthScore,
    afterQualityAvg: afterMetrics.qualityAvg,
    afterSuccessRate: afterMetrics.successRate,
    afterOpportunityCount: afterMetrics.opportunityCount,
    improvement,
    effective,
    analysis,
  };
  
  saveFeedbackRecord(record);
  markTaskComplete(task.id, result);
  
  log.info("Feedback tracking completed", { 
    taskId: task.id, 
    improvement: improvement.toFixed(1),
    effective 
  });
  
  return record;
}

/**
 * Generate feedback summary from all records.
 */
export function generateFeedbackSummary(): FeedbackSummary {
  const records = loadFeedbackRecords();
  
  if (records.length === 0) {
    return {
      totalTracked: 0,
      effectiveCount: 0,
      ineffectiveCount: 0,
      averageImprovement: 0,
      byPattern: {} as Record<ProblemPattern, { count: number; avgImprovement: number; effectiveRate: number }>,
      recommendations: ["No feedback records yet. Complete some improvement tasks to generate feedback."],
    };
  }
  
  const effectiveCount = records.filter(r => r.effective).length;
  const ineffectiveCount = records.length - effectiveCount;
  const avgImprovement = records.reduce((sum, r) => sum + r.improvement, 0) / records.length;
  
  // Group by pattern
  const byPattern: Record<ProblemPattern, { 
    count: number; 
    avgImprovement: number; 
    effectiveRate: number 
  }> = {} as any;
  
  for (const record of records) {
    if (!byPattern[record.taskSource]) {
      byPattern[record.taskSource] = { count: 0, avgImprovement: 0, effectiveRate: 0 };
    }
    byPattern[record.taskSource].count++;
    byPattern[record.taskSource].avgImprovement += record.improvement;
    if (record.effective) {
      byPattern[record.taskSource].effectiveRate++;
    }
  }
  
  // Finalize averages
  for (const pattern of Object.keys(byPattern) as ProblemPattern[]) {
    const data = byPattern[pattern];
    data.avgImprovement = data.avgImprovement / data.count;
    data.effectiveRate = data.effectiveRate / data.count;
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (avgImprovement > 10) {
    recommendations.push("Improvement tasks are highly effective. Continue current approach.");
  } else if (avgImprovement > 0) {
    recommendations.push("Improvement tasks are moderately effective. Consider refining task selection.");
  } else {
    recommendations.push("Improvement tasks are not showing positive results. Review strategy.");
  }
  
  // Pattern-specific recommendations
  for (const [pattern, data] of Object.entries(byPattern)) {
    if (data.effectiveRate < 0.3) {
      recommendations.push(`Tasks for "${pattern}" have low effectiveness (${(data.effectiveRate * 100).toFixed(0)}%). Consider different approaches.`);
    }
  }
  
  return {
    totalTracked: records.length,
    effectiveCount,
    ineffectiveCount,
    averageImprovement: Math.round(avgImprovement * 10) / 10,
    byPattern,
    recommendations,
  };
}

/**
 * Check if feedback loop should run.
 * Should run after completing improvement tasks.
 */
export function shouldRunFeedbackLoop(): { shouldRun: boolean; reason: string } {
  const tasks = loadGeneratedTasks();
  const completedTasks = tasks.filter(t => t.status === "completed");
  const records = loadFeedbackRecords();
  
  // Check for completed tasks without feedback
  const untrackedCompleted = completedTasks.filter(
    t => !records.some(r => r.taskId === t.id)
  );
  
  if (untrackedCompleted.length > 0) {
    return { 
      shouldRun: true, 
      reason: `${untrackedCompleted.length} completed tasks need feedback tracking` 
    };
  }
  
  return { shouldRun: false, reason: "All completed tasks have feedback records" };
}

/**
 * Run the feedback loop for all untracked completed tasks.
 */
export function runFeedbackLoop(
  config: FeedbackConfig = DEFAULT_CONFIG
): FeedbackRecord[] {
  const tasks = loadGeneratedTasks();
  const completedTasks = tasks.filter(t => t.status === "completed");
  const records = loadFeedbackRecords();
  
  const untrackedCompleted = completedTasks.filter(
    t => !records.some(r => r.taskId === t.id)
  );
  
  const newRecords: FeedbackRecord[] = [];
  
  for (const task of untrackedCompleted) {
    // Use default before metrics since we didn't track at start
    // This is a fallback - ideally startTrackingTask should be called when task begins
    const beforeMetrics: ReturnType<typeof getMetricsSnapshot> = {
      healthScore: 50, // Neutral baseline
      qualityAvg: null,
      successRate: 0.5,
      opportunityCount: 3,
    };
    
    const record = completeTracking(task, beforeMetrics, task.result || "Completed", config);
    newRecords.push(record);
  }
  
  log.info("Feedback loop completed", { 
    processedCount: newRecords.length 
  });
  
  return newRecords;
}

/**
 * Format feedback summary for display.
 */
export function formatFeedbackSummary(summary: FeedbackSummary): string {
  const lines: string[] = [
    "🔄 Feedback Loop Summary",
    "",
    `Total Tracked: ${summary.totalTracked}`,
    `Effective: ${summary.effectiveCount} | Ineffective: ${summary.ineffectiveCount}`,
    `Average Improvement: ${summary.averageImprovement > 0 ? "+" : ""}${summary.averageImprovement.toFixed(1)}`,
    "",
  ];
  
  if (Object.keys(summary.byPattern).length > 0) {
    lines.push("📊 By Pattern:");
    for (const [pattern, data] of Object.entries(summary.byPattern)) {
      const emoji = data.effectiveRate > 0.5 ? "✅" : data.effectiveRate > 0.3 ? "🟡" : "❌";
      lines.push(`  ${emoji} ${pattern}: ${data.count} tasks, ${(data.effectiveRate * 100).toFixed(0)}% effective, avg improvement: ${data.avgImprovement.toFixed(1)}`);
    }
    lines.push("");
  }
  
  if (summary.recommendations.length > 0) {
    lines.push("💡 Recommendations:");
    for (const rec of summary.recommendations) {
      lines.push(`  • ${rec}`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Get the most effective patterns based on feedback.
 */
export function getMostEffectivePatterns(limit: number = 3): ProblemPattern[] {
  const summary = generateFeedbackSummary();
  
  return Object.entries(summary.byPattern)
    .sort((a, b) => b[1].effectiveRate - a[1].effectiveRate)
    .slice(0, limit)
    .map(([pattern]) => pattern as ProblemPattern);
}

/**
 * Get the least effective patterns based on feedback.
 */
export function getLeastEffectivePatterns(limit: number = 3): ProblemPattern[] {
  const summary = generateFeedbackSummary();
  
  return Object.entries(summary.byPattern)
    .sort((a, b) => a[1].effectiveRate - b[1].effectiveRate)
    .slice(0, limit)
    .map(([pattern]) => pattern as ProblemPattern);
}