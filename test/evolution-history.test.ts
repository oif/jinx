import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadEvolutionHistory,
  saveEvolutionHistory,
  recordEvolutionResult,
  calculateEvolutionStats,
  formatEvolutionReport,
  type EvolutionRecord,
} from "../src/consciousness/history.js";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const TEST_HISTORY_PATH = join(process.cwd(), "data", "evolution-history.json");

describe("evolution history", () => {
  beforeEach(() => {
    // Clean up test file
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
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
});
