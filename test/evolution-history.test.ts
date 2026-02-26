import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadEvolutionHistory,
  saveEvolutionHistory,
  recordEvolutionResult,
  calculateEvolutionStats,
  formatEvolutionReport,
  setFileSystem,
  resetFileSystem,
  createMemoryFileSystem,
  type EvolutionRecord,
} from "../src/consciousness/history.js";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const TEST_HISTORY_PATH = join(process.cwd(), "data", "evolution-history.json");

// Sample EVOLOG content for testing
const sampleEvolog = `# Evolution Log

> Auto-generated record of Jinx's growth and evolution cycles.

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Total Cycles | 50 |
| Successful | 49 |
| Failed | 1 |
| Skipped | 0 |
| Current Streak | 34 |
| Longest Streak | 35 |

**Last Success:** 2/26/2026, 2:57:15 PM

## 📜 Evolution History

Test fixture file for evolution-history tests.
`;

describe("evolution history", () => {
  beforeEach(() => {
    // Clean up test file
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
    }
    
    // Set up memory file system for EVOLOG.md to prevent test pollution
    const memoryFs = createMemoryFileSystem({
      "EVOLOG.md": sampleEvolog,
    });
    setFileSystem(memoryFs);
  });

  afterEach(() => {
    // Reset to real file system
    resetFileSystem();
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

  it("should not pollute real EVOLOG.md during tests", () => {
    recordEvolutionResult(999, "9.9.9", "success", "Test should not appear in real EVOLOG");
    const history = loadEvolutionHistory();
    expect(history[0].cycle).toBe(999);
  });
});
