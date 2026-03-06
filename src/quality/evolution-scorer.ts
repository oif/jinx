/**
 * Evolution Quality Scorer
 * Provides heuristic quality scoring (1-10) for completed evolution cycles.
 *
 * Score breakdown:
 *   Task Completion  (0-3): How well the task was completed
 *   Test Quality     (0-2): Whether tests were added/improved
 *   Code Conciseness (0-2): Whether changes were reasonably scoped
 *   Side Effects     (0-3): Absence of TODOs, errors, regressions
 */

import { execSync } from "node:child_process";
import { log } from "../util/log.js";

export interface EvolutionQualityBreakdown {
  taskCompletion: number;  // 0-3
  testQuality: number;     // 0-2
  codeConcisenessScore: number; // 0-2
  sideEffects: number;     // 0-3
  total: number;           // 1-10
}

// ── Git Helpers ────────────────────────────────────────────────────

interface GitDiffStats {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  testFilesChanged: number;
}

function getGitDiffStats(): GitDiffStats | null {
  try {
    // Get stats for the last commit
    const output = execSync("git diff --stat HEAD~1 HEAD 2>/dev/null || git diff --stat HEAD 2>/dev/null || echo ''", {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 10000,
    }).trim();

    if (!output) {
      return null;
    }

    // Parse lines added/removed from summary line like:
    // "5 files changed, 120 insertions(+), 30 deletions(-)"
    const summaryMatch = output.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionMatch = output.match(/(\d+)\s+deletions?\(-\)/);
    const filesMatch = output.match(/(\d+)\s+files?\s+changed/);

    const linesAdded = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
    const linesRemoved = deletionMatch ? parseInt(deletionMatch[1], 10) : 0;
    const filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;

    // Count test files
    const testFilesChanged = (output.match(/test[s]?\.|\.spec\.|\.test\./gi) || []).length;

    return { linesAdded, linesRemoved, filesChanged, testFilesChanged };
  } catch (e) {
    log.debug("Could not get git diff stats", { error: (e as Error).message });
    return null;
  }
}

// ── Scoring Functions ──────────────────────────────────────────────

/**
 * Task Completion (0-3):
 * Checks result text for signals of successful task completion.
 */
function scoreTaskCompletion(result: string): number {
  const lower = result.toLowerCase();
  let score = 1; // Baseline: task ran

  // Strong completion signals
  const strongSignals = [
    /✅/,
    /completed?\b/i,
    /implemented\b/i,
    /added\b.*\bfeature/i,
    /successfully\b/i,
    /commit\s+[a-f0-9]{7}/i,  // git commit hash
    /pushed\b/i,
    /merged\b/i,
  ];

  // Partial/weak signals
  const weakSignals = [
    /done\b/i,
    /finished\b/i,
    /fixed\b/i,
    /refactored\b/i,
  ];

  // Failure signals (deduct)
  const failureSignals = [
    /could not\b/i,
    /unable to\b/i,
    /error:/i,
    /failed to\b/i,
    /timed out\b/i,
    /aborted\b/i,
  ];

  const strongMatches = strongSignals.filter(r => r.test(result)).length;
  const weakMatches = weakSignals.filter(r => r.test(lower)).length;
  const failureMatches = failureSignals.filter(r => r.test(lower)).length;

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

  // Check result text for test signals
  const lower = result.toLowerCase();
  const hasTestMention = /test(s)?\s+(pass|passed|added|created|written|updated)/i.test(lower)
    || /pnpm\s+test/i.test(lower)
    || /vitest/i.test(lower);

  const hasTestFile = /\.test\.\w+|\.spec\.\w+/i.test(result);

  if (hasTestMention) score += 1;
  if (hasTestFile) score += 1;

  // If we have git stats, check test file changes
  if (gitStats !== null) {
    if (gitStats.testFilesChanged > 0) {
      score = Math.max(score, 1);
    }
  }

  return Math.min(2, score);
}

/**
 * Code Conciseness (0-2):
 * Rewards reasonably scoped changes. Too many lines = less focused.
 */
function scoreCodeConciseness(gitStats: GitDiffStats | null): number {
  if (gitStats === null) {
    // No git info — give middle score
    return 1;
  }

  const totalLines = gitStats.linesAdded + gitStats.linesRemoved;

  if (totalLines === 0) return 1; // No changes detected (could be config-only)
  if (totalLines <= 150) return 2; // Nicely focused
  if (totalLines <= 400) return 1; // Acceptable scope
  return 0; // Too many lines = sprawling change
}

/**
 * Side Effects (0-3):
 * Starts at 3 and deducts for warning signals in result text.
 */
function scoreSideEffects(result: string): number {
  let score = 3;

  const lower = result.toLowerCase();

  // Deductions for warning signals
  const todoCount = (result.match(/\bTODO\b|\bFIXME\b|\bHACK\b/g) || []).length;
  const brokenCount = (lower.match(/\bbroken\b|\bregression\b|\bbroke\b/g) || []).length;
  const skippedCount = (lower.match(/\bskipped\b|\bskipping\b|\bnot implemented\b/g) || []).length;
  const errorCount = (lower.match(/\bunexpected error\b|\buncaught\b|\bcrash\b/g) || []).length;

  score -= Math.min(1, todoCount * 0.5);    // TODOs/FIXMEs
  score -= Math.min(1, brokenCount);         // Regressions
  score -= Math.min(1, skippedCount * 0.5); // Skipped work
  score -= Math.min(1, errorCount);          // Unexpected errors

  return Math.max(0, Math.min(3, Math.round(score)));
}

// ── Main Scoring Function ──────────────────────────────────────────

/**
 * Score an evolution cycle on a 1-10 scale using heuristics.
 * Safe to call even when git data is unavailable.
 */
export function scoreEvolutionQuality(
  result: string,
  _durationMs?: number
): EvolutionQualityBreakdown {
  const gitStats = getGitDiffStats();

  const taskCompletion = scoreTaskCompletion(result);
  const testQuality = scoreTestQuality(result, gitStats);
  const codeConcisenessScore = scoreCodeConciseness(gitStats);
  const sideEffects = scoreSideEffects(result);

  // Sum: theoretical max = 3+2+2+3 = 10, min = 0
  const rawTotal = taskCompletion + testQuality + codeConcisenessScore + sideEffects;

  // Clamp to 1-10
  const total = Math.max(1, Math.min(10, rawTotal));

  log.debug("Evolution quality scored", {
    taskCompletion,
    testQuality,
    codeConcisenessScore,
    sideEffects,
    total,
    gitStats,
  });

  return { taskCompletion, testQuality, codeConcisenessScore, sideEffects, total };
}
