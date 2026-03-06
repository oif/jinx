import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadEvolutionHistory,
  saveEvolutionHistory,
  recordEvolutionResult,
  calculateEvolutionStats,
  formatEvolutionReport,
  getAverageQualityScore,
  type EvolutionRecord,
} from "../src/consciousness/history.js";
import { scoreEvolutionQuality } from "../src/quality/evolution-scorer.js";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// The real history file path (loadEvolutionHistory uses hardcoded path)
const HISTORY_PATH = join(process.cwd(), "data", "evolution-history.json");

describe("evolution history", () => {
  // Store original history content to restore after tests
  let originalHistoryContent: string | null = null;

  beforeEach(() => {
    // Save original history content BEFORE any test operations
    originalHistoryContent = existsSync(HISTORY_PATH) 
      ? readFileSync(HISTORY_PATH, "utf-8") 
      : null;

    // Ensure data directory exists
    mkdirSync(join(process.cwd(), "data"), { recursive: true });

    // Start with a clean state for tests
    // Note: We save the original content above, so it's safe to clear for tests
    if (existsSync(HISTORY_PATH)) {
      unlinkSync(HISTORY_PATH);
    }
  });

  afterEach(() => {
    // CRITICAL: Restore original history content to prevent data loss
    if (originalHistoryContent !== null) {
      writeFileSync(HISTORY_PATH, originalHistoryContent);
    } else if (existsSync(HISTORY_PATH)) {
      // If there was no original content, clean up any test-created file
      unlinkSync(HISTORY_PATH);
    }
  });

  it("should return empty array when no history exists", () => {
    const history = loadEvolutionHistory();
    expect(history).toEqual([]);
  });

  it("should save and load history", () => {
    const records: EvolutionRecord[] = [
      {
        cycle: 1,
        timestamp: new Date().toISOString(),
        version: "0.1.0",
        status: "success",
        summary: "Test evolution",
      },
    ];
    saveEvolutionHistory(records);
    const loaded = loadEvolutionHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].cycle).toBe(1);
    expect(loaded[0].status).toBe("success");
  });

  it("should record evolution result", () => {
    recordEvolutionResult(2, "0.1.1", "success", "Another test", 1000);
    const history = loadEvolutionHistory();
    expect(history).toHaveLength(1);
    expect(history[0].cycle).toBe(2);
    expect(history[0].durationMs).toBe(1000);
  });

  it("should calculate stats correctly", () => {
    recordEvolutionResult(1, "0.1.0", "success", "Test 1");
    recordEvolutionResult(2, "0.1.0", "success", "Test 2");
    recordEvolutionResult(3, "0.1.1", "failed", "Test 3");
    recordEvolutionResult(4, "0.1.1", "success", "Test 4");

    const stats = calculateEvolutionStats();
    expect(stats.totalCycles).toBe(4);
    expect(stats.successfulCycles).toBe(3);
    expect(stats.failedCycles).toBe(1);
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(2);
  });

  it("should limit summary length", () => {
    const longSummary = "a".repeat(1000);
    recordEvolutionResult(1, "0.1.0", "success", longSummary);
    const history = loadEvolutionHistory();
    expect(history[0].summary.length).toBeLessThanOrEqual(500);
  });

  it("should format evolution report", () => {
    recordEvolutionResult(1, "0.1.0", "success", "Test evolution summary");
    const report = formatEvolutionReport();
    expect(report).toContain("Evolution Statistics");
    expect(report).toContain("Total: 1");
    expect(report).toContain("Test evolution summary");
  });

  it("should handle empty history in format report", () => {
    const report = formatEvolutionReport();
    expect(report).toBe("No evolution history recorded yet.");
  });

  it("should track skipped cycles in stats", () => {
    recordEvolutionResult(1, "0.1.0", "success", "Test 1");
    recordEvolutionResult(2, "0.1.0", "skipped", "Test 2");

    const stats = calculateEvolutionStats();
    expect(stats.totalCycles).toBe(2);
    expect(stats.successfulCycles).toBe(1);
    expect(stats.skippedCycles).toBe(1);
  });

  it("should store qualityScore field when provided", () => {
    recordEvolutionResult(1, "0.1.0", "success", "Quality test", 1000, 7);
    const history = loadEvolutionHistory();
    expect(history[0].qualityScore).toBe(7);
  });

  it("should omit qualityScore when not provided (backward compat)", () => {
    recordEvolutionResult(1, "0.1.0", "success", "No quality", 1000);
    const history = loadEvolutionHistory();
    expect(history[0].qualityScore).toBeUndefined();
  });

  it("getAverageQualityScore returns null when no scored records", () => {
    // All records lack qualityScore
    recordEvolutionResult(1, "0.1.0", "failed", "fail 1");
    recordEvolutionResult(2, "0.1.0", "failed", "fail 2");
    const avg = getAverageQualityScore(5);
    expect(avg).toBeNull();
  });

  it("getAverageQualityScore computes mean of last N scored entries", () => {
    recordEvolutionResult(1, "0.1.0", "success", "ok", 1000, 6);
    recordEvolutionResult(2, "0.1.0", "success", "ok", 1000, 8);
    recordEvolutionResult(3, "0.1.0", "success", "ok", 1000, 10);

    const avg = getAverageQualityScore(5);
    expect(avg).toBe(8); // (6+8+10)/3 = 8
  });

  it("getAverageQualityScore does not crash when history has missing fields", () => {
    // Simulate old-format records without qualityScore
    const oldRecords: EvolutionRecord[] = [
      { cycle: 1, timestamp: new Date().toISOString(), version: "0.1.0", status: "success", summary: "old" },
    ];
    saveEvolutionHistory(oldRecords);

    expect(() => getAverageQualityScore(5)).not.toThrow();
    expect(getAverageQualityScore(5)).toBeNull();
  });
});

describe("evolution quality scorer", () => {
  it("scores a successful result above 5", () => {
    const result = "✅ Implemented feature. Tests pass. pnpm test succeeded. Commit abc1234 pushed.";
    const score = scoreEvolutionQuality(result);
    expect(score.total).toBeGreaterThanOrEqual(5);
    expect(score.total).toBeLessThanOrEqual(10);
  });

  it("scores a failed result lower than a success", () => {
    const successResult = "✅ Completed successfully. Tests pass. pnpm test passed.";
    const failResult = "Error: unable to complete. Failed to build. Unexpected error occurred.";
    const successScore = scoreEvolutionQuality(successResult);
    const failScore = scoreEvolutionQuality(failResult);
    expect(successScore.total).toBeGreaterThan(failScore.total);
  });

  it("deducts for TODOs in result", () => {
    const cleanResult = "✅ Done. Implemented cleanly.";
    const dirtyResult = "✅ Done. TODO: fix later. FIXME: hack here. TODO: also this.";
    const cleanScore = scoreEvolutionQuality(cleanResult);
    const dirtyScore = scoreEvolutionQuality(dirtyResult);
    expect(cleanScore.sideEffects).toBeGreaterThanOrEqual(dirtyScore.sideEffects);
  });

  it("always returns score in range 1-10", () => {
    const extremeResults = [
      "",
      "x",
      "✅".repeat(100) + " completed implemented successfully pushed",
      "error failed unable broken crash regression TODO FIXME HACK",
    ];
    for (const r of extremeResults) {
      const score = scoreEvolutionQuality(r);
      expect(score.total).toBeGreaterThanOrEqual(1);
      expect(score.total).toBeLessThanOrEqual(10);
    }
  });

  it("returns breakdown with all four components", () => {
    const score = scoreEvolutionQuality("✅ completed successfully");
    expect(score).toHaveProperty("taskCompletion");
    expect(score).toHaveProperty("testQuality");
    expect(score).toHaveProperty("codeConcisenessScore");
    expect(score).toHaveProperty("sideEffects");
    expect(score).toHaveProperty("total");
  });
});
