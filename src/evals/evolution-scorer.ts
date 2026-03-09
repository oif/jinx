/**
 * Evolution Quality Scorer
 *
 * Uses Mastra's scorer framework to evaluate the quality of evolution cycles.
 * Provides objective metrics for self-improvement tracking.
 *
 * Scoring criteria:
 * 1. Completion (0-25): Did the evolution complete successfully?
 * 2. Tests (0-25): Did tests pass after changes?
 * 3. Efficiency (0-25): Was the execution time reasonable?
 * 4. Impact (0-25): Did it make meaningful changes?
 */

import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Evolution input data for scoring
 */
export const EvolutionInputSchema = z.object({
  cycle: z.number(),
  taskId: z.string(),
  taskTitle: z.string(),
  status: z.enum(["success", "failed", "skipped"]),
  summary: z.string(),
  durationMs: z.number().optional(),
  filesChanged: z.array(z.string()).optional(),
  testsPassed: z.boolean().optional(),
  commitHash: z.string().optional(),
  errorReason: z.string().optional(),
});

export type EvolutionInput = z.infer<typeof EvolutionInputSchema>;

/**
 * Evolution scorer output
 */
export const EvolutionOutputSchema = z.object({
  score: z.number().min(0).max(100),
  completion: z.number().min(0).max(25),
  tests: z.number().min(0).max(25),
  efficiency: z.number().min(0).max(25),
  impact: z.number().min(0).max(25),
  reason: z.string(),
  recommendations: z.array(z.string()).optional(),
});

export type EvolutionOutput = z.infer<typeof EvolutionOutputSchema>;

// ── Scoring Functions ──────────────────────────────────────────────

/**
 * Calculate completion score (0-25)
 * - Success: 25 points
 * - Skipped: 10 points (partial - at least didn't fail)
 * - Failed: 0 points
 */
export function scoreCompletion(status: EvolutionInput["status"]): number {
  switch (status) {
    case "success":
      return 25;
    case "skipped":
      return 10;
    case "failed":
      return 0;
  }
}

/**
 * Calculate tests score (0-25)
 * - Tests passed: 25 points
 * - Tests failed: 0 points
 * - No tests info: 15 points (assume neutral)
 */
export function scoreTests(testsPassed: boolean | undefined): number {
  if (testsPassed === undefined) return 15;
  return testsPassed ? 25 : 0;
}

/**
 * Calculate efficiency score (0-25)
 * - < 5 min: 25 points
 * - 5-15 min: 20 points
 * - 15-30 min: 15 points
 * - 30-60 min: 10 points
 * - > 60 min: 5 points
 * - No duration: 15 points (neutral)
 */
export function scoreEfficiency(durationMs: number | undefined): number {
  if (durationMs === undefined) return 15;

  const minutes = durationMs / 60000;

  if (minutes < 5) return 25;
  if (minutes < 15) return 20;
  if (minutes < 30) return 15;
  if (minutes < 60) return 10;
  return 5;
}

/**
 * Calculate impact score (0-25)
 * Based on files changed and commit presence
 */
export function scoreImpact(
  filesChanged: string[] | undefined,
  commitHash: string | undefined
): number {
  let score = 0;

  // Files changed contribution
  if (filesChanged && filesChanged.length > 0) {
    if (filesChanged.length >= 5) {
      score += 15; // Significant change
    } else if (filesChanged.length >= 2) {
      score += 10; // Moderate change
    } else {
      score += 5; // Minor change
    }
  } else {
    score += 5; // No files info - assume minor
  }

  // Commit contribution
  if (commitHash) {
    score += 10; // Committed = meaningful
  } else {
    score += 5; // No commit - might be intentional skip
  }

  return Math.min(score, 25);
}

/**
 * Generate recommendations based on scores
 */
function generateRecommendations(scores: {
  completion: number;
  tests: number;
  efficiency: number;
  impact: number;
}): string[] {
  const recommendations: string[] = [];

  if (scores.completion < 25) {
    recommendations.push("Investigate failure root causes and add preventive measures");
  }

  if (scores.tests < 25) {
    recommendations.push("Ensure all tests pass before committing; consider adding more tests");
  }

  if (scores.efficiency < 20) {
    recommendations.push("Consider breaking large tasks into smaller, focused iterations");
  }

  if (scores.impact < 20) {
    recommendations.push("Focus on changes that provide clear value; document reasoning");
  }

  return recommendations;
}

/**
 * Format a human-readable reason for the score
 */
function formatReason(
  status: EvolutionInput["status"],
  scores: {
    completion: number;
    tests: number;
    efficiency: number;
    impact: number;
  },
  totalScore: number
): string {
  const level =
    totalScore >= 80
      ? "Excellent"
      : totalScore >= 60
        ? "Good"
        : totalScore >= 40
          ? "Fair"
          : "Needs Improvement";

  const statusText = status === "success" ? "completed successfully" : 
                     status === "failed" ? "failed" : "was skipped";

  const breakdown = [
    `Completion: ${scores.completion}/25`,
    `Tests: ${scores.tests}/25`,
    `Efficiency: ${scores.efficiency}/25`,
    `Impact: ${scores.impact}/25`,
  ].join(", ");

  return `${level} evolution cycle (${totalScore}/100). Task ${statusText}. Breakdown: ${breakdown}.`;
}

// ── Main Scorer ────────────────────────────────────────────────────

/**
 * Calculate evolution score directly (synchronous, no LLM needed)
 */
function calculateEvolutionScore(input: EvolutionInput): {
  score: number;
  breakdown: { completion: number; tests: number; efficiency: number; impact: number };
  reason: string;
} {
  const completion = scoreCompletion(input.status);
  const tests = scoreTests(input.testsPassed);
  const efficiency = scoreEfficiency(input.durationMs);
  const impact = scoreImpact(input.filesChanged, input.commitHash);
  const totalScore = completion + tests + efficiency + impact;

  return {
    score: totalScore,
    breakdown: { completion, tests, efficiency, impact },
    reason: formatReason(input.status, { completion, tests, efficiency, impact }, totalScore),
  };
}

/**
 * Create the Evolution Quality Scorer
 *
 * This scorer evaluates the quality of evolution cycles based on:
 * - Completion status
 * - Test results
 * - Execution efficiency
 * - Code impact
 */
export const evolutionQualityScorer = createScorer({
  id: "evolution-quality",
  name: "Evolution Quality Scorer",
  description:
    "Evaluates the quality of Jinx's evolution cycles. " +
    "Scores based on completion, tests, efficiency, and impact.",
  type: {
    input: EvolutionInputSchema,
    output: EvolutionOutputSchema,
  },
})
  .preprocess(({ run }) => {
    const input = run.input as EvolutionInput;
    const result = calculateEvolutionScore(input);
    return {
      ...result.breakdown,
      totalScore: result.score,
      reason: result.reason,
    };
  })
  .generateScore(({ results }) => {
    // Access totalScore from preprocess results
    const scoreResult = results as unknown as { totalScore: number };
    return scoreResult.totalScore;
  })
  .generateReason(({ run, results }) => {
    const input = run.input as EvolutionInput;
    const reasonResult = results as unknown as { 
      completion: number; 
      tests: number; 
      efficiency: number; 
      impact: number; 
      totalScore: number;
    };
    return formatReason(input.status, {
      completion: reasonResult.completion,
      tests: reasonResult.tests,
      efficiency: reasonResult.efficiency,
      impact: reasonResult.impact,
    }, reasonResult.totalScore);
  });

// ── Helper Functions ───────────────────────────────────────────────

/**
 * Score an evolution record from the history
 * Uses direct calculation instead of Mastra scorer for reliability
 */
export async function scoreEvolution(
  record: EvolutionInput
): Promise<EvolutionOutput> {
  try {
    // Use direct calculation for reliable scoring without LLM dependency
    const result = calculateEvolutionScore(record);

    const recommendations = generateRecommendations({
      completion: result.breakdown.completion,
      tests: result.breakdown.tests,
      efficiency: result.breakdown.efficiency,
      impact: result.breakdown.impact,
    });

    return {
      score: result.score,
      completion: result.breakdown.completion,
      tests: result.breakdown.tests,
      efficiency: result.breakdown.efficiency,
      impact: result.breakdown.impact,
      reason: result.reason,
      recommendations,
    };
  } catch (e) {
    log.error("Failed to score evolution", { error: (e as Error).message });
    return {
      score: 0,
      completion: 0,
      tests: 0,
      efficiency: 0,
      impact: 0,
      reason: `Scoring failed: ${(e as Error).message}`,
    };
  }
}

/**
 * Score recent evolutions and return summary
 */
export async function scoreRecentEvolutions(
  records: EvolutionInput[]
): Promise<{
  avgScore: number;
  avgCompletion: number;
  avgTests: number;
  avgEfficiency: number;
  avgImpact: number;
  successRate: number;
  lowScores: Array<{ cycle: number; score: number; reason: string }>;
}> {
  if (records.length === 0) {
    return {
      avgScore: 0,
      avgCompletion: 0,
      avgTests: 0,
      avgEfficiency: 0,
      avgImpact: 0,
      successRate: 0,
      lowScores: [],
    };
  }

  const scores = await Promise.all(records.map(scoreEvolution));

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const avgCompletion =
    scores.reduce((sum, s) => sum + s.completion, 0) / scores.length;
  const avgTests = scores.reduce((sum, s) => sum + s.tests, 0) / scores.length;
  const avgEfficiency =
    scores.reduce((sum, s) => sum + s.efficiency, 0) / scores.length;
  const avgImpact =
    scores.reduce((sum, s) => sum + s.impact, 0) / scores.length;
  const successRate =
    records.filter((r) => r.status === "success").length / records.length;

  const lowScores = scores
    .map((s, i) => ({
      cycle: records[i].cycle,
      score: s.score,
      reason: s.reason,
    }))
    .filter((s) => s.score < 50);

  return {
    avgScore,
    avgCompletion,
    avgTests,
    avgEfficiency,
    avgImpact,
    successRate,
    lowScores,
  };
}

/**
 * Format evolution quality report
 */
export function formatQualityReport(summary: {
  avgScore: number;
  avgCompletion: number;
  avgTests: number;
  avgEfficiency: number;
  avgImpact: number;
  successRate: number;
  lowScores: Array<{ cycle: number; score: number; reason: string }>;
}): string {
  const lines: string[] = [
    "📊 Evolution Quality Report",
    "=".repeat(40),
    "",
    `Overall Score: ${summary.avgScore.toFixed(1)}/100`,
    `Success Rate: ${(summary.successRate * 100).toFixed(1)}%`,
    "",
    "Score Breakdown:",
    `  Completion: ${summary.avgCompletion.toFixed(1)}/25`,
    `  Tests: ${summary.avgTests.toFixed(1)}/25`,
    `  Efficiency: ${summary.avgEfficiency.toFixed(1)}/25`,
    `  Impact: ${summary.avgImpact.toFixed(1)}/25`,
  ];

  if (summary.lowScores.length > 0) {
    lines.push("");
    lines.push("⚠️ Low Scoring Evolutions:");
    for (const low of summary.lowScores.slice(0, 5)) {
      lines.push(`  #${low.cycle}: ${low.score}/100 - ${low.reason}`);
    }
  }

  return lines.join("\n");
}

// Types are exported via EvolutionInput and EvolutionOutput