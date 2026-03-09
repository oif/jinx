/**
 * Evolution Evaluator
 * 
 * Implements evaluation-driven improvement by analyzing evolution quality trends
 * and identifying improvement opportunities.
 * 
 * Key Features:
 * - Quality trend analysis (improving, declining, stable)
 * - Problem pattern detection (repeated failures, timeouts, low quality)
 * - Improvement opportunity scoring
 * - Actionable recommendations generation
 */

import { loadEvolutionHistory, EvolutionRecord, calculateEvolutionStats, getAverageQualityScore } from "../consciousness/history.js";
import { getRecentCapsules, EvolutionCapsule } from "./capsule-store.js";
import { readCoverageReport } from "../coverage/analyzer.js";
import { log } from "../util/log.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

// ── Types ──────────────────────────────────────────────────────────

export type QualityTrend = "improving" | "declining" | "stable" | "insufficient_data";

export type ProblemPattern = 
  | "repeated_failure"
  | "quality_decline"
  | "timeout_issues"
  | "low_test_coverage"
  | "code_bloat"
  | "stagnation"
  | "capability_gap";

export interface ImprovementOpportunity {
  id: string;
  pattern: ProblemPattern;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  recommendation: string;
  evidence: string[];
  score: number; // 0-100, higher = more urgent
  detectedAt: string;
  relatedCycles: number[];
}

export interface EvaluationReport {
  timestamp: string;
  periodStart: string;
  periodEnd: string;
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  averageQuality: number | null;
  qualityTrend: QualityTrend;
  opportunities: ImprovementOpportunity[];
  recommendations: string[];
  healthScore: number; // 0-100, overall system health
}

export interface EvaluationConfig {
  /** Minimum cycles needed for trend analysis */
  minCyclesForTrend: number;
  /** Window size for moving average */
  trendWindow: number;
  /** Threshold for quality decline detection */
  qualityDeclineThreshold: number;
  /** Minimum quality score to consider "good" */
  goodQualityThreshold: number;
  /** Consecutive failures to trigger critical alert */
  criticalFailureThreshold: number;
}

// ── Configuration ───────────────────────────────────────────────────

const DEFAULT_CONFIG: EvaluationConfig = {
  minCyclesForTrend: 5,
  trendWindow: 5,
  qualityDeclineThreshold: 2, // 2 points drop triggers decline
  goodQualityThreshold: 7,
  criticalFailureThreshold: 3,
};

const EVALUATION_PATH = join(DATA_DIR, "evaluation");

// ── Quality Trend Analysis ───────────────────────────────────────────

/**
 * Analyze quality trend over recent cycles.
 * Returns 'improving' if recent average > older average,
 * 'declining' if recent average < older average,
 * 'stable' if difference is within threshold.
 */
export function analyzeQualityTrend(
  history: EvolutionRecord[],
  config: EvaluationConfig = DEFAULT_CONFIG
): { trend: QualityTrend; details: string } {
  const scoredRecords = history.filter(r => typeof r.qualityScore === "number");
  
  if (scoredRecords.length < config.minCyclesForTrend) {
    return { 
      trend: "insufficient_data", 
      details: `Only ${scoredRecords.length} scored cycles (need ${config.minCyclesForTrend})` 
    };
  }

  const windowSize = Math.min(config.trendWindow, Math.floor(scoredRecords.length / 2));
  if (windowSize < 2) {
    return { 
      trend: "insufficient_data", 
      details: "Window size too small" 
    };
  }

  // Split into two halves
  const recentScores = scoredRecords.slice(-windowSize).map(r => r.qualityScore!);
  const olderScores = scoredRecords.slice(-windowSize * 2, -windowSize).map(r => r.qualityScore!);

  const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  const olderAvg = olderScores.length > 0 
    ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length 
    : recentAvg;

  const diff = recentAvg - olderAvg;

  let trend: QualityTrend;
  let details: string;

  if (Math.abs(diff) < 0.5) {
    trend = "stable";
    details = `Quality stable around ${recentAvg.toFixed(1)} (change: ${diff > 0 ? "+" : ""}${diff.toFixed(1)})`;
  } else if (diff > 0) {
    trend = "improving";
    details = `Quality improving: ${olderAvg.toFixed(1)} → ${recentAvg.toFixed(1)} (+${diff.toFixed(1)})`;
  } else {
    trend = "declining";
    details = `Quality declining: ${olderAvg.toFixed(1)} → ${recentAvg.toFixed(1)} (${diff.toFixed(1)})`;
  }

  return { trend, details };
}

// ── Problem Pattern Detection ───────────────────────────────────────

/**
 * Detect repeated failure pattern.
 */
function detectRepeatedFailures(
  history: EvolutionRecord[],
  config: EvaluationConfig
): ImprovementOpportunity | null {
  const recentFailures = history
    .slice(-10)
    .filter(r => r.status === "failed" || r.status === "timeout");
  
  if (recentFailures.length < 2) return null;

  // Check for consecutive failures
  let consecutiveCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === "failed" || history[i].status === "timeout") {
      consecutiveCount++;
    } else {
      break;
    }
  }

  const severity = consecutiveCount >= config.criticalFailureThreshold ? "critical" 
    : consecutiveCount >= 2 ? "high"
    : recentFailures.length >= 3 ? "medium"
    : "low";

  if (severity === "low") return null;

  return {
    id: `pattern-repeated-failure-${Date.now()}`,
    pattern: "repeated_failure",
    severity,
    description: `${consecutiveCount} consecutive failures detected, ${recentFailures.length} failures in last 10 cycles`,
    recommendation: "Investigate root cause of failures. Consider running diagnostics or adjusting strategy.",
    evidence: recentFailures.map(r => `Cycle #${r.cycle}: ${r.status} - ${r.summary?.slice(0, 50)}`),
    score: severity === "critical" ? 95 : severity === "high" ? 75 : 50,
    detectedAt: new Date().toISOString(),
    relatedCycles: recentFailures.map(r => r.cycle),
  };
}

/**
 * Detect quality decline pattern.
 */
function detectQualityDecline(
  history: EvolutionRecord[],
  trend: QualityTrend,
  config: EvaluationConfig
): ImprovementOpportunity | null {
  if (trend !== "declining") return null;

  const recent = history.slice(-config.trendWindow);
  const avgQuality = getAverageQualityScore(config.trendWindow);

  if (avgQuality === null || avgQuality >= config.goodQualityThreshold) return null;

  return {
    id: `pattern-quality-decline-${Date.now()}`,
    pattern: "quality_decline",
    severity: avgQuality < 4 ? "critical" : avgQuality < 6 ? "high" : "medium",
    description: `Quality trend declining, average quality: ${avgQuality.toFixed(1)}/10`,
    recommendation: "Review recent changes. Consider: reducing scope, improving tests, or focusing on stability.",
    evidence: recent
      .filter(r => r.qualityScore !== undefined)
      .map(r => `Cycle #${r.cycle}: quality ${r.qualityScore}/10`),
    score: avgQuality < 4 ? 90 : avgQuality < 6 ? 70 : 50,
    detectedAt: new Date().toISOString(),
    relatedCycles: recent.map(r => r.cycle),
  };
}

/**
 * Detect timeout issues pattern.
 */
function detectTimeoutIssues(
  history: EvolutionRecord[],
  _config: EvaluationConfig
): ImprovementOpportunity | null {
  const recentTimeouts = history
    .slice(-15)
    .filter(r => r.status === "timeout" || r.status === "timeout-warning");

  if (recentTimeouts.length < 2) return null;

  const timeoutRate = recentTimeouts.length / Math.min(15, history.length);

  return {
    id: `pattern-timeout-issues-${Date.now()}`,
    pattern: "timeout_issues",
    severity: timeoutRate > 0.3 ? "high" : "medium",
    description: `${recentTimeouts.length} timeout events in last 15 cycles (${(timeoutRate * 100).toFixed(0)}% rate)`,
    recommendation: "Tasks may be too complex. Consider: task decomposition, optimizing slow operations, or increasing timeout thresholds.",
    evidence: recentTimeouts.map(r => `Cycle #${r.cycle}: ${r.status} - ${r.summary?.slice(0, 40)}`),
    score: timeoutRate > 0.3 ? 80 : 60,
    detectedAt: new Date().toISOString(),
    relatedCycles: recentTimeouts.map(r => r.cycle),
  };
}

/**
 * Detect stagnation pattern (no improvements, no learning).
 */
function detectStagnation(
  history: EvolutionRecord[],
  capsules: EvolutionCapsule[],
  _config: EvaluationConfig
): ImprovementOpportunity | null {
  if (history.length < 10) return null;

  const recent = history.slice(-10);
  const successRate = recent.filter(r => r.status === "success").length / recent.length;
  const avgQuality = getAverageQualityScore(10);

  // High success rate but low capsule count might indicate stagnation
  if (successRate > 0.7 && capsules.length < 3 && avgQuality !== null && avgQuality < 6) {
    return {
      id: `pattern-stagnation-${Date.now()}`,
      pattern: "stagnation",
      severity: "medium",
      description: "High success rate but low quality improvements - system may be in maintenance mode",
      recommendation: "Consider taking on more challenging tasks. Review goals and explore new capabilities.",
      evidence: [
        `Success rate: ${(successRate * 100).toFixed(0)}%`,
        `Average quality: ${avgQuality.toFixed(1)}/10`,
        `Capsule count: ${capsules.length}`,
      ],
      score: 45,
      detectedAt: new Date().toISOString(),
      relatedCycles: recent.map(r => r.cycle),
    };
  }

  return null;
}

/**
 * Detect capability gap pattern (tasks failing in specific areas).
 */
function detectCapabilityGap(
  history: EvolutionRecord[],
  capsules: EvolutionCapsule[],
  _config: EvaluationConfig
): ImprovementOpportunity | null {
  if (history.length < 5) return null;

  // Analyze capsule task types
  const typeCounts: Record<string, number> = {};
  for (const c of capsules) {
    typeCounts[c.taskType] = (typeCounts[c.taskType] || 0) + 1;
  }

  // Check if we have low quality scores across the board
  const recentLowQuality = history
    .slice(-10)
    .filter(r => typeof r.qualityScore === "number" && r.qualityScore < 5);

  if (recentLowQuality.length >= 3) {
    return {
      id: `pattern-capability-gap-${Date.now()}`,
      pattern: "capability_gap",
      severity: "medium",
      description: "Multiple low-quality completions suggest capability gaps",
      recommendation: "Review task types with poor outcomes. Consider: training, tool improvements, or simpler tasks.",
      evidence: recentLowQuality.map(r => `Cycle #${r.cycle}: quality ${r.qualityScore}/10 - ${r.summary?.slice(0, 40)}`),
      score: 55,
      detectedAt: new Date().toISOString(),
      relatedCycles: recentLowQuality.map(r => r.cycle),
    };
  }

  return null;
}

/**
 * Detect low test coverage pattern.
 * Uses the coverage analyzer to check if test coverage is below threshold.
 */
function detectLowTestCoverage(
  _config: EvaluationConfig
): ImprovementOpportunity | null {
  // Read coverage report
  const coverageSummary = readCoverageReport();
  
  if (!coverageSummary) {
    // No coverage data available - this itself might be an issue
    return {
      id: `pattern-low-test-coverage-${Date.now()}`,
      pattern: "low_test_coverage",
      severity: "medium",
      description: "No test coverage data available. Coverage report may not have been generated.",
      recommendation: "Run 'pnpm test:coverage' to generate coverage report and enable coverage tracking.",
      evidence: ["Coverage report not found at coverage/coverage-summary.json"],
      score: 50,
      detectedAt: new Date().toISOString(),
      relatedCycles: [],
    };
  }

  const lineCoverage = coverageSummary.overall.lines.pct;
  const branchCoverage = coverageSummary.overall.branches.pct;
  const untestedCount = coverageSummary.untestedFiles.length;
  const lowCoverageCount = coverageSummary.lowCoverageFiles.length;

  // Determine severity based on coverage percentage
  // Thresholds: critical < 30%, high < 50%, medium < 70%
  let severity: "critical" | "high" | "medium" | "low";
  let score: number;
  
  if (lineCoverage < 30) {
    severity = "critical";
    score = 95;
  } else if (lineCoverage < 50) {
    severity = "high";
    score = 80;
  } else if (lineCoverage < 70) {
    severity = "medium";
    score = 60;
  } else if (lineCoverage < 80 || untestedCount > 5 || lowCoverageCount > 10) {
    severity = "low";
    score = 40;
  } else {
    // Coverage is acceptable
    return null;
  }

  const evidence: string[] = [
    `Line coverage: ${lineCoverage.toFixed(1)}%`,
    `Branch coverage: ${branchCoverage.toFixed(1)}%`,
    `${untestedCount} untested files`,
    `${lowCoverageCount} files with <50% coverage`,
  ];

  // Add examples of low coverage files
  if (coverageSummary.lowCoverageFiles.length > 0) {
    const examples = coverageSummary.lowCoverageFiles
      .sort((a, b) => a.metrics.lines.pct - b.metrics.lines.pct)
      .slice(0, 3)
      .map(f => `${f.path}: ${f.metrics.lines.pct.toFixed(0)}%`);
    evidence.push(`Low coverage examples: ${examples.join(", ")}`);
  }

  return {
    id: `pattern-low-test-coverage-${Date.now()}`,
    pattern: "low_test_coverage",
    severity,
    description: `Test coverage is ${lineCoverage.toFixed(1)}% (lines), below the recommended 80% threshold`,
    recommendation: "Add tests for untested or low-coverage files. Focus on critical paths and error handling.",
    evidence,
    score,
    detectedAt: new Date().toISOString(),
    relatedCycles: [],
  };
}

// ── Main Evaluation Functions ───────────────────────────────────────

/**
 * Run full evaluation and generate improvement opportunities.
 */
export function runEvaluation(
  config: EvaluationConfig = DEFAULT_CONFIG
): EvaluationReport {
  const history = loadEvolutionHistory();
  const capsules = getRecentCapsules(20);
  const stats = calculateEvolutionStats();

  const now = new Date();
  const periodStart = history.length > 0 
    ? history[0].timestamp 
    : now.toISOString();
  const periodEnd = now.toISOString();

  // Analyze quality trend
  const { trend: qualityTrend, details: trendDetails } = analyzeQualityTrend(history, config);
  log.info("Quality trend analyzed", { trend: qualityTrend, details: trendDetails });

  // Detect problem patterns
  const opportunities: ImprovementOpportunity[] = [];

  const repeatedFailures = detectRepeatedFailures(history, config);
  if (repeatedFailures) opportunities.push(repeatedFailures);

  const qualityDecline = detectQualityDecline(history, qualityTrend, config);
  if (qualityDecline) opportunities.push(qualityDecline);

  const timeoutIssues = detectTimeoutIssues(history, config);
  if (timeoutIssues) opportunities.push(timeoutIssues);

  const stagnation = detectStagnation(history, capsules, config);
  if (stagnation) opportunities.push(stagnation);

  const capabilityGap = detectCapabilityGap(history, capsules, config);
  if (capabilityGap) opportunities.push(capabilityGap);

  const lowTestCoverage = detectLowTestCoverage(config);
  if (lowTestCoverage) opportunities.push(lowTestCoverage);

  // Sort opportunities by score (highest first)
  opportunities.sort((a, b) => b.score - a.score);

  // Calculate health score
  const avgQuality = getAverageQualityScore(10);
  const successRate = stats.totalCycles > 0 
    ? stats.successfulCycles / stats.totalCycles 
    : 0;

  let healthScore = 100;
  
  // Deduct for low success rate
  healthScore -= (1 - successRate) * 30;
  
  // Deduct for low quality
  if (avgQuality !== null) {
    healthScore -= Math.max(0, (8 - avgQuality) * 5);
  }
  
  // Deduct for opportunities
  const criticalCount = opportunities.filter(o => o.severity === "critical").length;
  const highCount = opportunities.filter(o => o.severity === "high").length;
  const mediumCount = opportunities.filter(o => o.severity === "medium").length;
  
  healthScore -= criticalCount * 20;
  healthScore -= highCount * 10;
  healthScore -= mediumCount * 5;
  
  // Deduct for declining trend
  if (qualityTrend === "declining") {
    healthScore -= 10;
  }
  
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  // Generate recommendations
  const recommendations: string[] = [];
  
  if (opportunities.length === 0) {
    recommendations.push("System is healthy. Continue current approach.");
  } else {
    // Top 3 opportunities by severity
    for (const opp of opportunities.slice(0, 3)) {
      recommendations.push(`[${opp.severity.toUpperCase()}] ${opp.recommendation}`);
    }
  }

  if (qualityTrend === "improving") {
    recommendations.push("Quality trend is positive. Consider more ambitious tasks.");
  }

  const report: EvaluationReport = {
    timestamp: now.toISOString(),
    periodStart,
    periodEnd,
    totalCycles: stats.totalCycles,
    successfulCycles: stats.successfulCycles,
    failedCycles: stats.failedCycles,
    averageQuality: avgQuality,
    qualityTrend,
    opportunities,
    recommendations,
    healthScore,
  };

  // Save evaluation report
  saveEvaluationReport(report);

  log.info("Evaluation complete", {
    healthScore,
    trend: qualityTrend,
    opportunities: opportunities.length,
    avgQuality,
  });

  return report;
}

/**
 * Save evaluation report to data/evaluation/
 */
function saveEvaluationReport(report: EvaluationReport): void {
  try {
    if (!existsSync(EVALUATION_PATH)) {
      mkdirSync(EVALUATION_PATH, { recursive: true });
    }

    const filename = `evaluation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const filepath = join(EVALUATION_PATH, filename);
    
    writeFileSync(filepath, JSON.stringify(report, null, 2));
    
    // Also save as latest
    const latestPath = join(EVALUATION_PATH, "latest.json");
    writeFileSync(latestPath, JSON.stringify(report, null, 2));
    
    log.info("Evaluation report saved", { path: filepath });
  } catch (e) {
    log.error("Failed to save evaluation report", { error: (e as Error).message });
  }
}

/**
 * Load the latest evaluation report.
 */
export function loadLatestEvaluation(): EvaluationReport | null {
  try {
    const latestPath = join(EVALUATION_PATH, "latest.json");
    if (!existsSync(latestPath)) return null;
    
    const content = readFileSync(latestPath, "utf-8");
    return JSON.parse(content) as EvaluationReport;
  } catch (e) {
    log.warn("Failed to load latest evaluation", { error: (e as Error).message });
    return null;
  }
}

/**
 * Get improvement opportunities sorted by urgency.
 */
export function getTopOpportunities(limit: number = 5): ImprovementOpportunity[] {
  const latest = loadLatestEvaluation();
  if (!latest) return [];
  
  return latest.opportunities
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Check if evaluation is due.
 * Evaluations should run periodically (e.g., after every N successful cycles).
 */
export function shouldRunEvaluation(
  intervalCycles: number = 5
): { shouldRun: boolean; reason: string } {
  const history = loadEvolutionHistory();
  
  if (history.length === 0) {
    return { shouldRun: false, reason: "No evolution history yet" };
  }

  const latest = loadLatestEvaluation();
  
  if (!latest) {
    return { shouldRun: true, reason: "No previous evaluation found" };
  }

  // Count cycles since last evaluation
  const lastEvalTime = new Date(latest.timestamp).getTime();
  const cyclesSinceEval = history.filter(
    r => new Date(r.timestamp).getTime() > lastEvalTime
  ).length;

  if (cyclesSinceEval >= intervalCycles) {
    return { 
      shouldRun: true, 
      reason: `${cyclesSinceEval} cycles since last evaluation (interval: ${intervalCycles})` 
    };
  }

  return { 
    shouldRun: false, 
    reason: `Only ${cyclesSinceEval} cycles since last evaluation (need ${intervalCycles})` 
  };
}

/**
 * Format evaluation report for display.
 */
export function formatEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [
    "📊 Evaluation Report",
    "",
    `Health Score: ${report.healthScore}/100`,
    `Quality Trend: ${report.qualityTrend.toUpperCase()}`,
    `Average Quality: ${report.averageQuality?.toFixed(1) ?? "N/A"}/10`,
    "",
    `📈 Cycles: ${report.totalCycles} total | ${report.successfulCycles} success | ${report.failedCycles} failed`,
    "",
  ];

  if (report.opportunities.length > 0) {
    lines.push("🔍 Improvement Opportunities:");
    for (const opp of report.opportunities.slice(0, 5)) {
      const severityEmoji = {
        critical: "🔴",
        high: "🟠",
        medium: "🟡",
        low: "🟢",
      }[opp.severity];
      
      lines.push(`  ${severityEmoji} [${opp.score}] [${opp.pattern}] ${opp.description}`);
      lines.push(`     → ${opp.recommendation}`);
    }
    lines.push("");
  }

  if (report.recommendations.length > 0) {
    lines.push("💡 Recommendations:");
    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
  }

  return lines.join("\n");
}