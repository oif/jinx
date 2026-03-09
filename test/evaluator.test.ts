/**
 * Tests for Evolution Evaluator
 * 
 * Tests the evaluation-driven improvement system including:
 * - Quality trend analysis
 * - Problem pattern detection (including low test coverage)
 * - Improvement opportunity scoring
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  analyzeQualityTrend,
  runEvaluation,
  shouldRunEvaluation,
  formatEvaluationReport,
  type EvaluationConfig,
  type EvaluationReport,
} from "../src/evolution/evaluator.js";

// ── Mocks ──────────────────────────────────────────────────────────

// Mock the coverage analyzer
vi.mock("../src/coverage/analyzer.js", () => ({
  readCoverageReport: vi.fn(() => null),
}));

// Mock history module
vi.mock("../src/consciousness/history.js", () => ({
  loadEvolutionHistory: vi.fn(() => []),
  calculateEvolutionStats: vi.fn(() => ({
    totalCycles: 0,
    successfulCycles: 0,
    failedCycles: 0,
    currentStreak: 0,
  })),
  getAverageQualityScore: vi.fn(() => null),
  queryHistory: vi.fn(() => []),
}));

// Mock capsule store
vi.mock("../src/evolution/capsule-store.js", () => ({
  getCapsuleCount: vi.fn(() => 0),
  getRecentCapsules: vi.fn(() => []),
}));

// ── Tests ──────────────────────────────────────────────────────────

describe("analyzeQualityTrend", () => {
  it("returns insufficient_data when not enough records", () => {
    const result = analyzeQualityTrend([]);
    expect(result.trend).toBe("insufficient_data");
  });

  it("returns insufficient_data with fewer than minCyclesForTrend records", () => {
    const history = [
      { cycle: 1, timestamp: new Date().toISOString(), status: "success", qualityScore: 7 },
      { cycle: 2, timestamp: new Date().toISOString(), status: "success", qualityScore: 8 },
    ] as any;
    
    const config: EvaluationConfig = {
      minCyclesForTrend: 5,
      trendWindow: 5,
      qualityDeclineThreshold: 2,
      goodQualityThreshold: 7,
      criticalFailureThreshold: 3,
    };
    
    const result = analyzeQualityTrend(history, config);
    expect(result.trend).toBe("insufficient_data");
  });

  it("detects improving trend", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      cycle: i + 1,
      timestamp: new Date().toISOString(),
      status: "success",
      qualityScore: 5 + i * 0.5, // Increasing quality
    })) as any;
    
    const result = analyzeQualityTrend(history);
    expect(result.trend).toBe("improving");
  });

  it("detects declining trend", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      cycle: i + 1,
      timestamp: new Date().toISOString(),
      status: "success",
      qualityScore: 10 - i * 0.5, // Decreasing quality
    })) as any;
    
    const result = analyzeQualityTrend(history);
    expect(result.trend).toBe("declining");
  });

  it("detects stable trend", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      cycle: i + 1,
      timestamp: new Date().toISOString(),
      status: "success",
      qualityScore: 7, // Constant quality
    })) as any;
    
    const result = analyzeQualityTrend(history);
    expect(result.trend).toBe("stable");
  });
});

describe("runEvaluation", () => {
  it("returns a valid evaluation report", async () => {
    const report = runEvaluation();
    
    expect(report).toHaveProperty("timestamp");
    expect(report).toHaveProperty("healthScore");
    expect(report).toHaveProperty("qualityTrend");
    expect(report).toHaveProperty("opportunities");
    expect(report).toHaveProperty("recommendations");
    expect(typeof report.healthScore).toBe("number");
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(100);
  });

  it("includes low_test_coverage in opportunities when coverage is low", async () => {
    // Re-mock the coverage analyzer for this test
    const { readCoverageReport } = await import("../src/coverage/analyzer.js");
    vi.mocked(readCoverageReport).mockReturnValue({
      timestamp: new Date().toISOString(),
      overall: {
        lines: { total: 100, covered: 40, pct: 40 },
        statements: { total: 100, covered: 40, pct: 40 },
        functions: { total: 50, covered: 20, pct: 40 },
        branches: { total: 30, covered: 10, pct: 33 },
      },
      files: [],
      untestedFiles: ["src/module1.ts", "src/module2.ts"],
      lowCoverageFiles: [
        { path: "src/low1.ts", metrics: { lines: { total: 10, covered: 2, pct: 20 }, statements: { total: 10, covered: 2, pct: 20 }, functions: { total: 5, covered: 1, pct: 20 }, branches: { total: 3, covered: 0, pct: 0 } } },
      ],
    });
    
    const report = runEvaluation();
    
    const lowCoverageOpp = report.opportunities.find(o => o.pattern === "low_test_coverage");
    expect(lowCoverageOpp).toBeDefined();
    expect(lowCoverageOpp?.severity).toBe("high"); // 40% is high severity
    expect(lowCoverageOpp?.score).toBe(80);
  });

  it("does not include low_test_coverage when coverage is good", async () => {
    const { readCoverageReport } = await import("../src/coverage/analyzer.js");
    vi.mocked(readCoverageReport).mockReturnValue({
      timestamp: new Date().toISOString(),
      overall: {
        lines: { total: 100, covered: 85, pct: 85 },
        statements: { total: 100, covered: 85, pct: 85 },
        functions: { total: 50, covered: 42, pct: 84 },
        branches: { total: 30, covered: 25, pct: 83 },
      },
      files: [],
      untestedFiles: [],
      lowCoverageFiles: [],
    });
    
    const report = runEvaluation();
    
    const lowCoverageOpp = report.opportunities.find(o => o.pattern === "low_test_coverage");
    expect(lowCoverageOpp).toBeUndefined();
  });

  it("detects critical severity for very low coverage", async () => {
    const { readCoverageReport } = await import("../src/coverage/analyzer.js");
    vi.mocked(readCoverageReport).mockReturnValue({
      timestamp: new Date().toISOString(),
      overall: {
        lines: { total: 100, covered: 20, pct: 20 },
        statements: { total: 100, covered: 20, pct: 20 },
        functions: { total: 50, covered: 10, pct: 20 },
        branches: { total: 30, covered: 5, pct: 17 },
      },
      files: [],
      untestedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
      lowCoverageFiles: [],
    });
    
    const report = runEvaluation();
    
    const lowCoverageOpp = report.opportunities.find(o => o.pattern === "low_test_coverage");
    expect(lowCoverageOpp?.severity).toBe("critical");
    expect(lowCoverageOpp?.score).toBe(95);
  });
});

describe("shouldRunEvaluation", () => {
  it("returns false when no history exists", async () => {
    const { loadEvolutionHistory } = await import("../src/consciousness/history.js");
    vi.mocked(loadEvolutionHistory).mockReturnValue([]);
    
    const result = shouldRunEvaluation();
    expect(result.shouldRun).toBe(false);
  });

  it("returns true when no previous evaluation exists", async () => {
    const { loadEvolutionHistory } = await import("../src/consciousness/history.js");
    vi.mocked(loadEvolutionHistory).mockReturnValue([
      { cycle: 1, timestamp: new Date().toISOString(), status: "success" },
    ] as any);
    
    const result = shouldRunEvaluation();
    // Should run because no previous evaluation file exists
    expect(typeof result.shouldRun).toBe("boolean");
  });
});

describe("formatEvaluationReport", () => {
  it("formats a complete report correctly", () => {
    const report: EvaluationReport = {
      timestamp: new Date().toISOString(),
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      totalCycles: 10,
      successfulCycles: 8,
      failedCycles: 2,
      averageQuality: 7.5,
      qualityTrend: "improving",
      opportunities: [
        {
          id: "test-1",
          pattern: "low_test_coverage",
          severity: "medium",
          description: "Test coverage is 65%",
          recommendation: "Add more tests",
          evidence: ["Line coverage: 65%"],
          score: 60,
          detectedAt: new Date().toISOString(),
          relatedCycles: [],
        },
      ],
      recommendations: ["Add more tests"],
      healthScore: 75,
    };
    
    const formatted = formatEvaluationReport(report);
    
    expect(formatted).toContain("Health Score: 75/100");
    expect(formatted).toContain("IMPROVING");
    expect(formatted).toContain("7.5/10");
    expect(formatted).toContain("10 total");
    expect(formatted).toContain("low_test_coverage");
    expect(formatted).toContain("Test coverage is 65%");
  });

  it("handles null average quality", () => {
    const report: EvaluationReport = {
      timestamp: new Date().toISOString(),
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      totalCycles: 5,
      successfulCycles: 3,
      failedCycles: 2,
      averageQuality: null,
      qualityTrend: "insufficient_data",
      opportunities: [],
      recommendations: ["System is healthy"],
      healthScore: 80,
    };
    
    const formatted = formatEvaluationReport(report);
    
    expect(formatted).toContain("N/A/10");
  });
});

describe("detectLowTestCoverage integration", () => {
  it("creates opportunity when coverage report is missing", async () => {
    const { readCoverageReport } = await import("../src/coverage/analyzer.js");
    vi.mocked(readCoverageReport).mockReturnValue(null);
    
    const report = runEvaluation();
    
    const lowCoverageOpp = report.opportunities.find(o => o.pattern === "low_test_coverage");
    expect(lowCoverageOpp).toBeDefined();
    expect(lowCoverageOpp?.severity).toBe("medium");
    expect(lowCoverageOpp?.description).toContain("No test coverage data");
  });

  it("includes evidence about untested files", async () => {
    const { readCoverageReport } = await import("../src/coverage/analyzer.js");
    vi.mocked(readCoverageReport).mockReturnValue({
      timestamp: new Date().toISOString(),
      overall: {
        lines: { total: 100, covered: 55, pct: 55 },
        statements: { total: 100, covered: 55, pct: 55 },
        functions: { total: 50, covered: 25, pct: 50 },
        branches: { total: 30, covered: 15, pct: 50 },
      },
      files: [],
      untestedFiles: ["src/untested1.ts", "src/untested2.ts", "src/untested3.ts"],
      lowCoverageFiles: [
        { path: "src/low.ts", metrics: { lines: { total: 20, covered: 5, pct: 25 }, statements: { total: 20, covered: 5, pct: 25 }, functions: { total: 10, covered: 2, pct: 20 }, branches: { total: 5, covered: 1, pct: 20 } } },
      ],
    });
    
    const report = runEvaluation();
    
    const lowCoverageOpp = report.opportunities.find(o => o.pattern === "low_test_coverage");
    expect(lowCoverageOpp).toBeDefined();
    expect(lowCoverageOpp?.evidence).toContain("3 untested files");
    expect(lowCoverageOpp?.evidence).toContain("1 files with <50% coverage");
  });
});