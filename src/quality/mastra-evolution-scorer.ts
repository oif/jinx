/**
 * Mastra-based Evolution Quality Scorer
 * 
 * Integrates with Mastra AI framework's Scorer system for standardized
 * quality evaluation of evolution cycles.
 * 
 * Uses builder pattern from MastraScorer with function-based steps
 * that wrap the existing heuristic scoring logic.
 * 
 * @see data/knowledge/198-55-mastra-ai-agent-framework.md
 */

import { createScorer, type MastraScorer } from "@mastra/core/evals";
import { z } from "zod";
import { execSync } from "node:child_process";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Input schema for evolution quality scoring
 */
export const EvolutionScoringInputSchema = z.object({
  /** Task ID (e.g., "#001") */
  taskId: z.string(),
  /** Task title */
  taskTitle: z.string(),
  /** Evolution cycle number */
  cycle: z.number(),
  /** Result text from the evolution */
  result: z.string(),
  /** Duration in milliseconds */
  durationMs: z.number().optional(),
});

export type EvolutionScoringInput = z.infer<typeof EvolutionScoringInputSchema>;

/**
 * Output schema for evolution quality scoring
 */
export const EvolutionScoringOutputSchema = z.object({
  /** Overall quality score (1-10) */
  score: z.number().min(1).max(10),
  /** Task completion score (0-3) */
  taskCompletion: z.number().min(0).max(3),
  /** Test quality score (0-2) */
  testQuality: z.number().min(0).max(2),
  /** Code conciseness score (0-2) */
  codeConciseness: z.number().min(0).max(2),
  /** Side effects score (0-3) */
  sideEffects: z.number().min(0).max(3),
  /** Reasoning for the score */
  reasoning: z.string(),
});

export type EvolutionScoringOutput = z.infer<typeof EvolutionScoringOutputSchema>;

// ── Git Helpers ────────────────────────────────────────────────────

interface GitDiffStats {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  testFilesChanged: number;
}

function getGitDiffStats(): GitDiffStats | null {
  try {
    const output = execSync(
      "git diff --stat HEAD~1 HEAD 2>/dev/null || git diff --stat HEAD 2>/dev/null || echo ''",
      {
        encoding: "utf-8",
        cwd: process.cwd(),
        timeout: 10000,
      }
    ).trim();

    if (!output) {
      return null;
    }

    const summaryMatch = output.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionMatch = output.match(/(\d+)\s+deletions?\(-\)/);
    const filesMatch = output.match(/(\d+)\s+files?\s+changed/);

    const linesAdded = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
    const linesRemoved = deletionMatch ? parseInt(deletionMatch[1], 10) : 0;
    const filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
    const testFilesChanged = (output.match(/test[s]?\.|\.spec\.|\.test\./gi) || []).length;

    return { linesAdded, linesRemoved, filesChanged, testFilesChanged };
  } catch (e) {
    log.debug("Could not get git diff stats", { error: (e as Error).message });
    return null;
  }
}

// ── Scoring Functions (from existing evolution-scorer.ts) ───────────

/**
 * Task Completion (0-3):
 * Checks result text for signals of successful task completion.
 */
function scoreTaskCompletion(result: string): number {
  const lower = result.toLowerCase();
  let score = 1; // Baseline: task ran

  const strongSignals = [
    /✅/,
    /completed?\b/i,
    /implemented\b/i,
    /added\b.*\bfeature/i,
    /successfully\b/i,
    /commit\s+[a-f0-9]{7}/i,
    /pushed\b/i,
    /merged\b/i,
  ];

  const weakSignals = [/done\b/i, /finished\b/i, /fixed\b/i, /refactored\b/i];

  const failureSignals = [
    /could not\b/i,
    /unable to\b/i,
    /error:/i,
    /failed to\b/i,
    /timed out\b/i,
    /aborted\b/i,
  ];

  const strongMatches = strongSignals.filter((r) => r.test(result)).length;
  const weakMatches = weakSignals.filter((r) => r.test(lower)).length;
  const failureMatches = failureSignals.filter((r) => r.test(lower)).length;

  score += Math.min(2, strongMatches);
  score += Math.min(1, weakMatches) * 0.5;
  score -= Math.min(2, failureMatches);

  return Math.max(0, Math.min(3, Math.round(score)));
}

/**
 * Test Quality (0-2):
 * Checks for test-related activity.
 */
function scoreTestQuality(result: string, gitStats: GitDiffStats | null): number {
  let score = 0;

  const lower = result.toLowerCase();
  const hasTestMention =
    /test(s)?\s+(pass|passed|added|created|written|updated)/i.test(lower) ||
    /pnpm\s+test/i.test(lower) ||
    /vitest/i.test(lower);

  const hasTestFile = /\.test\.\w+|\.spec\.\w+/i.test(result);

  if (hasTestMention) score += 1;
  if (hasTestFile) score += 1;

  if (gitStats !== null) {
    if (gitStats.testFilesChanged > 0) {
      score = Math.max(score, 1);
    }
  }

  return Math.min(2, score);
}

/**
 * Code Conciseness (0-2):
 * Rewards reasonably scoped changes.
 */
function scoreCodeConciseness(gitStats: GitDiffStats | null): number {
  if (gitStats === null) {
    return 1;
  }

  const totalLines = gitStats.linesAdded + gitStats.linesRemoved;

  if (totalLines === 0) return 1;
  if (totalLines <= 150) return 2;
  if (totalLines <= 400) return 1;
  return 0;
}

/**
 * Side Effects (0-3):
 * Starts at 3 and deducts for warning signals.
 */
function scoreSideEffects(result: string): number {
  let score = 3;

  const lower = result.toLowerCase();

  const todoCount = (result.match(/\bTODO\b|\bFIXME\b|\bHACK\b/g) || []).length;
  const brokenCount = (lower.match(/\bbroken\b|\bregression\b|\bbroke\b/g) || []).length;
  const skippedCount = (lower.match(/\bskipped\b|\bskipping\b|\bnot implemented\b/g) || []).length;
  const errorCount = (lower.match(/\bunexpected error\b|\buncaught\b|\bcrash\b/g) || []).length;

  score -= Math.min(1, todoCount * 0.5);
  score -= Math.min(1, brokenCount);
  score -= Math.min(1, skippedCount * 0.5);
  score -= Math.min(1, errorCount);

  return Math.max(0, Math.min(3, Math.round(score)));
}

// ── Mastra Scorer Definition ───────────────────────────────────────

/**
 * Analysis output schema for the scorer
 */
const AnalysisOutputSchema = z.object({
  taskCompletion: z.number(),
  testQuality: z.number(),
  codeConciseness: z.number(),
  sideEffects: z.number(),
  gitStats: z
    .object({
      linesAdded: z.number(),
      linesRemoved: z.number(),
      filesChanged: z.number(),
      testFilesChanged: z.number(),
    })
    .nullable(),
});

/**
 * Create the Evolution Quality Scorer using Mastra's builder pattern.
 * 
 * This scorer evaluates evolution cycles on a 1-10 scale across four dimensions:
 * - Task Completion (0-3): How well the task was completed
 * - Test Quality (0-2): Whether tests were added/improved
 * - Code Conciseness (0-2): Whether changes were reasonably scoped
 * - Side Effects (0-3): Absence of TODOs, errors, regressions
 * 
 * Uses function-based steps (no LLM calls) for efficient heuristic scoring.
 * 
 * @example
 * ```typescript
 * const result = await evolutionQualityScorer.run({
 *   input: {
 *     taskId: '#001',
 *     taskTitle: 'Add rate limiting',
 *     cycle: 42,
 *     result: '✅ Implemented rate limiting with exponential backoff...',
 *     durationMs: 120000,
 *   },
 *   output: {}, // Required by Mastra Scorer API
 * });
 * 
 * console.log(`Score: ${result.score}/10`);
 * console.log(`Reasoning: ${result.reason}`);
 * ```
 */
export const evolutionQualityScorer: MastraScorer<
  "evolution-quality",
  EvolutionScoringInput,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {},
  {
    analyzeStepResult: z.infer<typeof AnalysisOutputSchema>;
    generateScoreStepResult: number;
    generateReasonStepResult: string;
  }
> = createScorer({
  id: "evolution-quality",
  description:
    "Evaluates evolution cycle quality on a 1-10 scale across task completion, test quality, code conciseness, and side effects",
  type: {
    input: EvolutionScoringInputSchema,
    output: z.object({}),
  },
})
  // Step 1: Analyze the evolution output using heuristic functions
  .analyze((context) => {
    const input = context.run.input;
    const result = input?.result ?? "";
    const gitStats = getGitDiffStats();

    const taskCompletion = scoreTaskCompletion(result);
    const testQuality = scoreTestQuality(result, gitStats);
    const codeConciseness = scoreCodeConciseness(gitStats);
    const sideEffects = scoreSideEffects(result);

    return {
      taskCompletion,
      testQuality,
      codeConciseness,
      sideEffects,
      gitStats,
    };
  })
  // Step 2: Generate the overall score (1-10)
  .generateScore((context) => {
    const analysis = context.results.analyzeStepResult;
    if (!analysis) {
      return 5; // Default middle score
    }

    const rawTotal =
      analysis.taskCompletion +
      analysis.testQuality +
      analysis.codeConciseness +
      analysis.sideEffects;

    // Clamp to 1-10
    return Math.max(1, Math.min(10, rawTotal));
  })
  // Step 3: Generate reasoning for the score
  .generateReason((context) => {
    const analysis = context.results.analyzeStepResult;
    const score = context.score;

    if (!analysis) {
      return {
        reason: `Score: ${score}/10 - Analysis not available, using default score.`,
      };
    }

    const parts: string[] = [
      `Task Completion: ${analysis.taskCompletion}/3`,
      `Test Quality: ${analysis.testQuality}/2`,
      `Code Conciseness: ${analysis.codeConciseness}/2`,
      `Side Effects: ${analysis.sideEffects}/3`,
    ];

    if (analysis.gitStats) {
      parts.push(
        `Files changed: ${analysis.gitStats.filesChanged}, Lines: +${analysis.gitStats.linesAdded}/-${analysis.gitStats.linesRemoved}`
      );
    }

    return {
      reason: `Score: ${score}/10\nBreakdown: ${parts.join(" | ")}`,
    };
  });

// ── Helper Function ─────────────────────────────────────────────────

/**
 * Score an evolution cycle using the Mastra-based scorer.
 * 
 * This is a convenience wrapper that executes the scorer and returns
 * a structured result compatible with the existing evolution loop.
 * 
 * @param input - The evolution scoring input
 * @returns The scoring output with breakdown and reasoning
 */
export async function scoreEvolutionWithMastra(
  input: EvolutionScoringInput
): Promise<EvolutionScoringOutput> {
  try {
    // Get git stats for analysis
    const gitStats = getGitDiffStats();

    // Calculate individual scores
    const taskCompletion = scoreTaskCompletion(input.result);
    const testQuality = scoreTestQuality(input.result, gitStats);
    const codeConciseness = scoreCodeConciseness(gitStats);
    const sideEffects = scoreSideEffects(input.result);

    // Run the Mastra scorer
    const result = await evolutionQualityScorer.run({
      input: {
        ...input,
        // Override the analyze step result with our computed values
      },
      output: {},
    });

    // Build the reasoning
    const parts = [
      `Task Completion: ${taskCompletion}/3`,
      `Test Quality: ${testQuality}/2`,
      `Code Conciseness: ${codeConciseness}/2`,
      `Side Effects: ${sideEffects}/3`,
    ];

    if (gitStats) {
      parts.push(
        `Files: ${gitStats.filesChanged}, Lines: +${gitStats.linesAdded}/-${gitStats.linesRemoved}`
      );
    }

    const reasoning = result.reason || parts.join(" | ");

    log.debug("Evolution quality scored with Mastra", {
      taskId: input.taskId,
      cycle: input.cycle,
      score: result.score,
      taskCompletion,
      testQuality,
      codeConciseness,
      sideEffects,
    });

    return {
      score: result.score,
      taskCompletion,
      testQuality,
      codeConciseness,
      sideEffects,
      reasoning,
    };
  } catch (e) {
    log.error("Mastra scorer failed, returning default score", {
      error: (e as Error).message,
      taskId: input.taskId,
    });

    // Fallback to heuristic scoring
    const gitStats = getGitDiffStats();
    const taskCompletion = scoreTaskCompletion(input.result);
    const testQuality = scoreTestQuality(input.result, gitStats);
    const codeConciseness = scoreCodeConciseness(gitStats);
    const sideEffects = scoreSideEffects(input.result);
    const rawTotal = taskCompletion + testQuality + codeConciseness + sideEffects;
    const score = Math.max(1, Math.min(10, rawTotal));

    return {
      score,
      taskCompletion,
      testQuality,
      codeConciseness,
      sideEffects,
      reasoning: `Fallback scoring due to error: ${(e as Error).message}`,
    };
  }
}

/**
 * Sync version for backward compatibility with existing evolution loop.
 * Uses the same heuristic logic but returns Mastra-compatible output.
 */
export function scoreEvolutionQualitySync(
  result: string,
  _durationMs?: number
): { total: number; taskCompletion: number; testQuality: number; codeConciseness: number; sideEffects: number } {
  const gitStats = getGitDiffStats();

  const taskCompletion = scoreTaskCompletion(result);
  const testQuality = scoreTestQuality(result, gitStats);
  const codeConciseness = scoreCodeConciseness(gitStats);
  const sideEffects = scoreSideEffects(result);

  const rawTotal = taskCompletion + testQuality + codeConciseness + sideEffects;
  const total = Math.max(1, Math.min(10, rawTotal));

  log.debug("Evolution quality scored (sync)", {
    taskCompletion,
    testQuality,
    codeConciseness,
    sideEffects,
    total,
    gitStats,
  });

  return { taskCompletion, testQuality, codeConciseness, sideEffects, total };
}