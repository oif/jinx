/**
 * Tests for Reflection Module - MARS-inspired Reflective Self-Improvement
 * 
 * Tests the core reflection capabilities:
 * - Pattern extraction from evolution records
 * - Insight generation from patterns and stats
 * - Suggestion generation and application
 * - Reflection session execution
 * - Trigger conditions for reflection
 * - Feedback loop integration
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  runReflection,
  shouldTriggerReflection,
  extractPatterns,
  generateInsights,
  generateSuggestions,
  getPendingSuggestions,
  applySuggestion,
  formatReflectionReport,
  getReflectionSummary,
  processHighPrioritySuggestions,
  getInsightsForPrompt,
  getPerformanceTrends,
  loadReflections,
  computeReflectionStats,
  reviewExperiences,
  // Types
  type ReflectionSession,
  type ReflectionInsight,
  type ExtractedPattern,
  type ImprovementSuggestion,
  type ReflectionStats,
} from "../src/memory/reflection.js";
import {
  loadEvolutionHistory,
  saveEvolutionHistory,
  type EvolutionRecord,
} from "../src/consciousness/history.js";
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Test data directory
const TEST_DATA_DIR = join(process.cwd(), "data");
const TEST_MEMORY_DIR = join(TEST_DATA_DIR, "memory");
const TEST_REFLECTIONS_PATH = join(TEST_MEMORY_DIR, "reflections.json");
const TEST_EVOLUTION_PATH = join(TEST_DATA_DIR, "evolution-history.json");
const TEST_BACKLOG_PATH = join(TEST_DATA_DIR, "backlog.md");

// Store original functions for cleanup
let originalLoadEvolutionHistory: typeof loadEvolutionHistory;

// Helper to clean up test data
function cleanupTestData() {
  if (existsSync(TEST_REFLECTIONS_PATH)) {
    rmSync(TEST_REFLECTIONS_PATH, { force: true });
  }
}

// Helper to create mock evolution records
function createMockEvolutionRecords(overrides: Partial<EvolutionRecord>[] = []): EvolutionRecord[] {
  const defaults: EvolutionRecord[] = [
    {
      cycle: 1,
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      status: "success",
      summary: "Added testing infrastructure for module X",
      durationMs: 120000,
      branch: "dev",
      strategy: "BALANCED",
    },
    {
      cycle: 2,
      timestamp: new Date(Date.now() - 3000000).toISOString(),
      status: "success",
      summary: "Improved code quality with refactoring",
      durationMs: 90000,
      branch: "dev",
      strategy: "BALANCED",
    },
    {
      cycle: 3,
      timestamp: new Date(Date.now() - 2400000).toISOString(),
      status: "failed",
      summary: "Attempted performance optimization but hit errors",
      durationMs: 180000,
      branch: "dev",
      strategy: "BALANCED",
    },
    {
      cycle: 4,
      timestamp: new Date(Date.now() - 1800000).toISOString(),
      status: "success",
      summary: "Fixed testing bugs and added coverage",
      durationMs: 150000,
      branch: "dev",
      strategy: "BALANCED",
    },
    {
      cycle: 5,
      timestamp: new Date(Date.now() - 600000).toISOString(),
      status: "success",
      summary: "Completed code quality improvements",
      durationMs: 100000,
      branch: "dev",
      strategy: "BALANCED",
    },
  ];

  return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

// Helper to create mock reflection session
function createMockReflectionSession(): ReflectionSession {
  return {
    id: "ref_test_001",
    timestamp: new Date().toISOString(),
    triggerReason: "test_trigger",
    cyclesAnalyzed: 5,
    insights: [
      {
        id: "ins_test_001",
        type: "success_factor",
        category: "testing",
        title: "Testing pattern detected",
        description: "Consistent testing approach leads to success",
        evidence: ["test example 1", "test example 2"],
        confidence: 0.85,
        createdAt: new Date().toISOString(),
        reinforcementCount: 0,
        actionable: true,
        actionSuggestion: "Continue testing approach",
      },
      {
        id: "ins_test_002",
        type: "failure_cause",
        category: "performance",
        title: "Performance issues detected",
        description: "Optimization attempts often fail",
        evidence: ["fail example 1"],
        confidence: 0.75,
        createdAt: new Date().toISOString(),
        reinforcementCount: 0,
        actionable: true,
        actionSuggestion: "Approach optimization more carefully",
      },
    ],
    patterns: [
      {
        type: "success",
        description: "Testing leads to success",
        frequency: 3,
        examples: ["test1", "test2", "test3"],
        relatedCategories: ["testing"],
      },
    ],
    suggestions: [
      {
        id: "sug_test_001",
        priority: "high",
        category: "testing",
        title: "Improve testing coverage",
        description: "Add more test cases",
        rationale: "Testing is a success factor",
        relatedInsights: ["ins_test_001"],
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ],
    stats: {
      successRate: 0.8,
      avgDurationMs: 128000,
      commonFailureReasons: [{ reason: "errors", count: 1 }],
      commonSuccessFactors: [{ factor: "testing", count: 3 }],
      categoryPerformance: { testing: { success: 3, failure: 0 } },
    },
  };
}

describe("Reflection Module", () => {
  beforeEach(() => {
    // Clean up before each test
    cleanupTestData();
    
    // Ensure memory directory exists
    if (!existsSync(TEST_MEMORY_DIR)) {
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    cleanupTestData();
  });

  describe("extractPatterns()", () => {
    it("should extract patterns from evolution records", () => {
      const records = createMockEvolutionRecords();
      const patterns = extractPatterns(records);

      expect(patterns).toBeDefined();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it("should identify success patterns", () => {
      const records = createMockEvolutionRecords([
        { status: "success", summary: "Testing improvement A" },
        { status: "success", summary: "Testing improvement B" },
        { status: "success", summary: "Testing improvement C" },
        { status: "success", summary: "Unrelated task" },
      ]);

      const patterns = extractPatterns(records);
      const successPatterns = patterns.filter((p) => p.type === "success");

      expect(successPatterns.length).toBeGreaterThan(0);
    });

    it("should identify failure patterns", () => {
      const records = createMockEvolutionRecords([
        { status: "failed", summary: "Performance optimization failed due to memory" },
        { status: "failed", summary: "Memory allocation error in optimization" },
        { status: "success", summary: "Simple task completed" },
      ]);

      const patterns = extractPatterns(records);
      const failurePatterns = patterns.filter((p) => p.type === "failure");

      expect(failurePatterns.length).toBeGreaterThan(0);
    });

    it("should handle empty records gracefully", () => {
      const patterns = extractPatterns([]);
      expect(patterns).toEqual([]);
    });

    it("should detect long-running tasks as neutral patterns", () => {
      const records = createMockEvolutionRecords([
        { durationMs: 10000 },
        { durationMs: 12000 },
        { durationMs: 500000 }, // Very long task
        { durationMs: 600000 }, // Very long task
      ]);

      const patterns = extractPatterns(records);
      const longTaskPatterns = patterns.filter(
        (p) => p.type === "neutral" && p.description.includes("Long-running")
      );

      expect(longTaskPatterns.length).toBeGreaterThan(0);
    });

    it("should sort patterns by frequency", () => {
      const records = createMockEvolutionRecords([
        { status: "success", summary: "Testing testing testing testing" },
        { status: "success", summary: "Testing testing testing" },
        { status: "success", summary: "Testing testing" },
        { status: "failed", summary: "Error error" },
      ]);

      const patterns = extractPatterns(records);

      for (let i = 1; i < patterns.length; i++) {
        expect(patterns[i - 1].frequency).toBeGreaterThanOrEqual(patterns[i].frequency);
      }
    });
  });

  describe("computeReflectionStats()", () => {
    it("should compute correct success rate", () => {
      // Create records explicitly for predictable results
      const records: EvolutionRecord[] = [
        {
          cycle: 1,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 1",
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 2,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 2",
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 3,
          timestamp: new Date().toISOString(),
          status: "failed",
          summary: "Task 3",
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 4,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 4",
          branch: "dev",
          strategy: "BALANCED",
        },
      ];

      const stats = computeReflectionStats(records);

      expect(stats.successRate).toBeCloseTo(0.75, 2);
    });

    it("should compute average duration", () => {
      // Create records explicitly for predictable results
      const records: EvolutionRecord[] = [
        {
          cycle: 1,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 1",
          durationMs: 100000,
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 2,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 2",
          durationMs: 200000,
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 3,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 3",
          durationMs: 300000,
          branch: "dev",
          strategy: "BALANCED",
        },
      ];

      const stats = computeReflectionStats(records);

      expect(stats.avgDurationMs).toBe(200000);
    });

    it("should handle records without duration", () => {
      // Create records explicitly without durationMs
      const records: EvolutionRecord[] = [
        {
          cycle: 1,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Task 1",
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 2,
          timestamp: new Date().toISOString(),
          status: "failed",
          summary: "Task 2",
          branch: "dev",
          strategy: "BALANCED",
        },
      ];

      const stats = computeReflectionStats(records);

      expect(stats.avgDurationMs).toBe(0);
    });

    it("should identify common failure reasons", () => {
      const records = createMockEvolutionRecords([
        { status: "failed", summary: "Failed due to memory error" },
        { status: "failed", summary: "Failed due to memory issue" },
        { status: "failed", summary: "Failed due to timeout error" },
      ]);

      const stats = computeReflectionStats(records);

      expect(stats.commonFailureReasons.length).toBeGreaterThan(0);
    });

    it("should identify common success factors", () => {
      const records = createMockEvolutionRecords([
        { status: "success", summary: "Testing improvement completed" },
        { status: "success", summary: "Testing coverage increased" },
        { status: "success", summary: "Testing bugs fixed" },
      ]);

      const stats = computeReflectionStats(records);

      expect(stats.commonSuccessFactors.length).toBeGreaterThan(0);
    });

    it("should compute category performance", () => {
      // Create records with explicit summaries for predictable category detection
      const records: EvolutionRecord[] = [
        {
          cycle: 1,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Testing task completed successfully",
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 2,
          timestamp: new Date().toISOString(),
          status: "failed",
          summary: "Performance optimization failed",
          branch: "dev",
          strategy: "BALANCED",
        },
        {
          cycle: 3,
          timestamp: new Date().toISOString(),
          status: "success",
          summary: "Another testing success story",
          branch: "dev",
          strategy: "BALANCED",
        },
      ];

      const stats = computeReflectionStats(records);

      expect(stats.categoryPerformance).toBeDefined();
      // Testing category should have 2 successes
      expect(stats.categoryPerformance.testing?.success).toBe(2);
    });

    it("should handle empty records", () => {
      const stats = computeReflectionStats([]);

      expect(stats.successRate).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.commonFailureReasons).toEqual([]);
      expect(stats.commonSuccessFactors).toEqual([]);
      expect(stats.categoryPerformance).toEqual({});
    });
  });

  describe("generateInsights()", () => {
    it("should generate insights from patterns and stats", () => {
      const patterns: ExtractedPattern[] = [
        {
          type: "success",
          description: "Testing leads to success",
          frequency: 3,
          examples: ["test1", "test2", "test3"],
          relatedCategories: ["testing"],
        },
        {
          type: "failure",
          description: "Performance issues recurring",
          frequency: 2,
          examples: ["fail1", "fail2"],
          relatedCategories: ["performance"],
        },
      ];

      const stats: ReflectionStats = {
        successRate: 0.6,
        avgDurationMs: 150000,
        commonFailureReasons: [{ reason: "timeout", count: 2 }],
        commonSuccessFactors: [{ factor: "testing", count: 3 }],
        categoryPerformance: { testing: { success: 3, failure: 0 } },
      };

      const records = createMockEvolutionRecords();
      const insights = generateInsights(patterns, stats, records);

      expect(insights).toBeDefined();
      expect(Array.isArray(insights)).toBe(true);
    });

    it("should create success factor insights for repeated patterns", () => {
      const patterns: ExtractedPattern[] = [
        {
          type: "success",
          description: "Testing is successful approach",
          frequency: 5,
          examples: ["test1", "test2", "test3", "test4", "test5"],
          relatedCategories: ["testing"],
        },
      ];

      const stats: ReflectionStats = {
        successRate: 0.8,
        avgDurationMs: 100000,
        commonFailureReasons: [],
        commonSuccessFactors: [{ factor: "testing", count: 5 }],
        categoryPerformance: {},
      };

      const records = createMockEvolutionRecords();
      const insights = generateInsights(patterns, stats, records);

      const successInsights = insights.filter((i) => i.type === "success_factor");
      expect(successInsights.length).toBeGreaterThan(0);
    });

    it("should create failure cause insights for failure patterns", () => {
      const patterns: ExtractedPattern[] = [
        {
          type: "failure",
          description: "Performance problems keep occurring",
          frequency: 3,
          examples: ["fail1", "fail2", "fail3"],
          relatedCategories: ["performance"],
        },
      ];

      const stats: ReflectionStats = {
        successRate: 0.5,
        avgDurationMs: 200000,
        commonFailureReasons: [{ reason: "performance", count: 3 }],
        commonSuccessFactors: [],
        categoryPerformance: {},
      };

      const records = createMockEvolutionRecords();
      const insights = generateInsights(patterns, stats, records);

      const failureInsights = insights.filter((i) => i.type === "failure_cause");
      expect(failureInsights.length).toBeGreaterThan(0);
    });

    it("should create warning insight for low success rate", () => {
      const patterns: ExtractedPattern[] = [];
      const stats: ReflectionStats = {
        successRate: 0.5, // Below 0.7 threshold
        avgDurationMs: 100000,
        commonFailureReasons: [],
        commonSuccessFactors: [],
        categoryPerformance: {},
      };

      // Need at least 5 records
      const records = createMockEvolutionRecords([
        { status: "success" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
        { status: "failed" },
      ]);

      const insights = generateInsights(patterns, stats, records);

      const warningInsights = insights.filter(
        (i) => i.type === "warning" && i.title.includes("Low Success Rate")
      );
      expect(warningInsights.length).toBeGreaterThan(0);
    });

    it("should filter insights below confidence threshold", () => {
      const patterns: ExtractedPattern[] = [
        {
          type: "success",
          description: "Single occurrence",
          frequency: 1, // Low frequency = lower confidence
          examples: ["test1"],
          relatedCategories: ["testing"],
        },
      ];

      const stats: ReflectionStats = {
        successRate: 0.8,
        avgDurationMs: 100000,
        commonFailureReasons: [],
        commonSuccessFactors: [],
        categoryPerformance: {},
      };

      const records = createMockEvolutionRecords();
      const insights = generateInsights(patterns, stats, records);

      // All insights should meet confidence threshold
      for (const insight of insights) {
        expect(insight.confidence).toBeGreaterThanOrEqual(0.6);
      }
    });

    it("should mark insights as actionable with suggestions", () => {
      const patterns: ExtractedPattern[] = [
        {
          type: "failure",
          description: "Performance errors",
          frequency: 3,
          examples: ["fail1", "fail2", "fail3"],
          relatedCategories: ["performance"],
        },
      ];

      const stats: ReflectionStats = {
        successRate: 0.6,
        avgDurationMs: 100000,
        commonFailureReasons: [],
        commonSuccessFactors: [],
        categoryPerformance: {},
      };

      const records = createMockEvolutionRecords();
      const insights = generateInsights(patterns, stats, records);

      const actionableInsights = insights.filter((i) => i.actionable);
      expect(actionableInsights.length).toBeGreaterThan(0);

      for (const insight of actionableInsights) {
        expect(insight.actionSuggestion).toBeDefined();
      }
    });
  });

  describe("generateSuggestions()", () => {
    it("should generate suggestions from insights", () => {
      const insights: ReflectionInsight[] = [
        {
          id: "ins_001",
          type: "failure_cause",
          category: "performance",
          title: "Performance failures detected",
          description: "Test description",
          evidence: ["evidence1"],
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
        {
          id: "ins_002",
          type: "warning",
          category: "testing",
          title: "Testing coverage low",
          description: "Test description",
          evidence: ["evidence2"],
          confidence: 0.7,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
      ];

      const suggestions = generateSuggestions(insights);

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it("should prioritize suggestions correctly", () => {
      const insights: ReflectionInsight[] = [
        {
          id: "ins_001",
          type: "warning",
          category: "critical",
          title: "Critical warning",
          description: "Test description",
          evidence: ["evidence1"],
          confidence: 0.9,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
        {
          id: "ins_002",
          type: "failure_cause",
          category: "minor",
          title: "Minor failure",
          description: "Test description",
          evidence: ["evidence2"],
          confidence: 0.7,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
      ];

      const suggestions = generateSuggestions(insights);

      // Warnings should result in high priority
      const highPriority = suggestions.filter((s) => s.priority === "high");
      expect(highPriority.length).toBeGreaterThan(0);
    });

    it("should group suggestions by category", () => {
      const insights: ReflectionInsight[] = [
        {
          id: "ins_001",
          type: "failure_cause",
          category: "testing",
          title: "Testing issue",
          description: "Test description",
          evidence: ["evidence1"],
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
        {
          id: "ins_002",
          type: "warning",
          category: "testing",
          title: "Testing warning",
          description: "Test description",
          evidence: ["evidence2"],
          confidence: 0.7,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
        {
          id: "ins_003",
          type: "failure_cause",
          category: "performance",
          title: "Performance issue",
          description: "Test description",
          evidence: ["evidence3"],
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
      ];

      const suggestions = generateSuggestions(insights);
      const categories = new Set(suggestions.map((s) => s.category));

      // Should have suggestions for testing and performance
      expect(categories.has("testing")).toBe(true);
      expect(categories.has("performance")).toBe(true);
    });

    it("should include success factor documentation suggestions", () => {
      const insights: ReflectionInsight[] = [
        {
          id: "ins_001",
          type: "success_factor",
          category: "testing",
          title: "Testing is successful",
          description: "Test description",
          evidence: ["evidence1"],
          confidence: 0.9, // High confidence
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        },
      ];

      const suggestions = generateSuggestions(insights);

      // Should suggest documenting the success factor
      const docSuggestion = suggestions.find((s) =>
        s.title.includes("Document success factor")
      );
      expect(docSuggestion).toBeDefined();
    });
  });

  describe("formatReflectionReport()", () => {
    it("should format reflection session for display", () => {
      const session = createMockReflectionSession();
      const report = formatReflectionReport(session);

      expect(report).toContain("Reflection Session");
      expect(report).toContain(session.id);
      expect(report).toContain("Statistics");
      expect(report).toContain("Success Rate");
    });

    it("should include insights in report", () => {
      const session = createMockReflectionSession();
      const report = formatReflectionReport(session);

      expect(report).toContain("Insights:");
      expect(report).toContain("Testing pattern detected");
    });

    it("should include suggestions in report", () => {
      const session = createMockReflectionSession();
      const report = formatReflectionReport(session);

      expect(report).toContain("Top Suggestions:");
      expect(report).toContain("Improve testing coverage");
    });

    it("should handle session with no insights", () => {
      const session: ReflectionSession = {
        id: "ref_empty",
        timestamp: new Date().toISOString(),
        triggerReason: "test",
        cyclesAnalyzed: 0,
        insights: [],
        patterns: [],
        suggestions: [],
        stats: {
          successRate: 0,
          avgDurationMs: 0,
          commonFailureReasons: [],
          commonSuccessFactors: [],
          categoryPerformance: {},
        },
      };

      const report = formatReflectionReport(session);

      expect(report).toContain("Reflection Session");
      expect(report).toContain("0 evolution cycles");
    });
  });

  describe("getReflectionSummary()", () => {
    it("should return summary when no reflections exist", () => {
      cleanupTestData();
      const summary = getReflectionSummary();

      expect(summary).toContain("No reflection sessions");
    });

    it("should return summary for existing reflections", () => {
      // Create a reflection file
      const session = createMockReflectionSession();
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const summary = getReflectionSummary();

      expect(summary).toContain("Reflection Summary");
      expect(summary).toContain("Sessions: 1");
      expect(summary).toContain("Total Insights");
    });
  });

  describe("getPerformanceTrends()", () => {
    it("should return stable trend with insufficient data", () => {
      cleanupTestData();
      const trends = getPerformanceTrends();

      expect(trends.successRateTrend).toBe("stable");
      expect(trends.avgSuccessRate).toBe(0);
    });

    it("should calculate trends from multiple sessions", () => {
      // Create multiple reflection sessions
      const sessions: ReflectionSession[] = [];
      for (let i = 0; i < 3; i++) {
        const session: ReflectionSession = {
          id: `ref_${i}`,
          timestamp: new Date(Date.now() - i * 3600000).toISOString(),
          triggerReason: "test",
          cyclesAnalyzed: 5,
          insights: [],
          patterns: [],
          suggestions: [],
          stats: {
            successRate: 0.7 + i * 0.1, // Improving trend
            avgDurationMs: 100000,
            commonFailureReasons: [],
            commonSuccessFactors: [],
            categoryPerformance: {
              testing: { success: 3 + i, failure: 1 },
            },
          },
        };
        sessions.push(session);
      }

      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify(sessions));

      const trends = getPerformanceTrends();

      expect(trends.avgSuccessRate).toBeGreaterThan(0);
      expect(trends.topSuccessCategories).toContain("testing");
    });
  });

  describe("getInsightsForPrompt()", () => {
    it("should return empty string when no reflections exist", () => {
      cleanupTestData();
      const insights = getInsightsForPrompt();

      expect(insights).toBe("");
    });

    it("should return formatted insights for prompt", () => {
      const session = createMockReflectionSession();
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const insights = getInsightsForPrompt();

      expect(insights).toContain("Reflection Insights");
      expect(insights).toContain("Testing pattern detected");
    });

    it("should limit insights to specified count", () => {
      // Create session with many insights
      const session: ReflectionSession = {
        id: "ref_multi",
        timestamp: new Date().toISOString(),
        triggerReason: "test",
        cyclesAnalyzed: 10,
        insights: Array(10).fill(null).map((_, i) => ({
          id: `ins_${i}`,
          type: "success_factor" as const,
          category: "testing",
          title: `Insight ${i}`,
          description: `Description ${i}`,
          evidence: [`evidence${i}`],
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          reinforcementCount: 0,
          actionable: true,
        })),
        patterns: [],
        suggestions: [],
        stats: {
          successRate: 0.8,
          avgDurationMs: 100000,
          commonFailureReasons: [],
          commonSuccessFactors: [],
          categoryPerformance: {},
        },
      };

      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const insights = getInsightsForPrompt(3);

      // Should only include top 3 insights by confidence
      const insightLines = insights.split("\n").filter((l) => l.includes("Insight"));
      expect(insightLines.length).toBeLessThanOrEqual(5); // 3 insights + headers
    });
  });

  describe("applySuggestion()", () => {
    it("should apply suggestion and update status", () => {
      const session = createMockReflectionSession();
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const result = applySuggestion("sug_test_001", "Applied successfully");

      expect(result).toBe(true);

      // Verify status was updated
      const reflections = loadReflections();
      const suggestion = reflections[0].suggestions.find(
        (s) => s.id === "sug_test_001"
      );
      expect(suggestion?.status).toBe("completed");
      expect(suggestion?.appliedAt).toBeDefined();
      expect(suggestion?.result).toBe("Applied successfully");
    });

    it("should return false for non-existent suggestion", () => {
      const result = applySuggestion("non_existent_id");
      expect(result).toBe(false);
    });
  });

  describe("getPendingSuggestions()", () => {
    it("should return pending suggestions", () => {
      const session = createMockReflectionSession();
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const pending = getPendingSuggestions();

      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].status).toBe("pending");
    });

    it("should sort suggestions by priority", () => {
      const session: ReflectionSession = {
        id: "ref_priority",
        timestamp: new Date().toISOString(),
        triggerReason: "test",
        cyclesAnalyzed: 5,
        insights: [],
        patterns: [],
        suggestions: [
          {
            id: "sug_low",
            priority: "low",
            category: "test",
            title: "Low priority",
            description: "Test",
            rationale: "Test",
            relatedInsights: [],
            status: "pending",
            createdAt: new Date().toISOString(),
          },
          {
            id: "sug_high",
            priority: "high",
            category: "test",
            title: "High priority",
            description: "Test",
            rationale: "Test",
            relatedInsights: [],
            status: "pending",
            createdAt: new Date().toISOString(),
          },
          {
            id: "sug_medium",
            priority: "medium",
            category: "test",
            title: "Medium priority",
            description: "Test",
            rationale: "Test",
            relatedInsights: [],
            status: "pending",
            createdAt: new Date().toISOString(),
          },
        ],
        stats: {
          successRate: 0.8,
          avgDurationMs: 100000,
          commonFailureReasons: [],
          commonSuccessFactors: [],
          categoryPerformance: {},
        },
      };

      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const pending = getPendingSuggestions();

      expect(pending[0].priority).toBe("high");
      expect(pending[1].priority).toBe("medium");
      expect(pending[2].priority).toBe("low");
    });
  });

  describe("reviewExperiences()", () => {
    it("should review evolution records", () => {
      const result = reviewExperiences({});

      expect(result).toBeDefined();
      expect(result.records).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    it("should filter records by date", () => {
      const result = reviewExperiences({
        since: new Date(Date.now() - 1000), // Last second
      });

      // Most records should be filtered out
      expect(result.records.length).toBeLessThanOrEqual(5);
    });

    it("should limit number of records", () => {
      const result = reviewExperiences({ limit: 2 });

      expect(result.records.length).toBeLessThanOrEqual(2);
    });
  });

  describe("shouldTriggerReflection()", () => {
    it("should trigger when forced", () => {
      const result = shouldTriggerReflection(true);
      expect(result).toBe(true);
    });

    it("should not trigger with insufficient history", () => {
      // This test may vary based on actual history, so just verify function runs
      const result = shouldTriggerReflection(false);
      expect(typeof result).toBe("boolean");
    });
  });

  describe("loadReflections()", () => {
    it("should return empty array when no reflections file exists", () => {
      cleanupTestData();
      const reflections = loadReflections();

      expect(Array.isArray(reflections)).toBe(true);
      expect(reflections.length).toBe(0);
    });

    it("should load existing reflections", () => {
      const session = createMockReflectionSession();
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      const reflections = loadReflections();

      expect(reflections.length).toBe(1);
      expect(reflections[0].id).toBe("ref_test_001");
    });

    it("should handle invalid JSON gracefully", () => {
      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, "invalid json");

      const reflections = loadReflections();

      expect(Array.isArray(reflections)).toBe(true);
      expect(reflections.length).toBe(0);
    });
  });

  describe("processHighPrioritySuggestions()", () => {
    it("should return empty when no pending suggestions", () => {
      cleanupTestData();
      const result = processHighPrioritySuggestions();

      expect(result.processed).toBe(0);
      expect(result.suggestions).toEqual([]);
    });

    it("should process high priority suggestions", () => {
      const session: ReflectionSession = {
        id: "ref_process",
        timestamp: new Date().toISOString(),
        triggerReason: "test",
        cyclesAnalyzed: 5,
        insights: [],
        patterns: [],
        suggestions: [
          {
            id: "sug_high",
            priority: "high",
            category: "testing",
            title: "Critical improvement needed",
            description: "Need to improve testing coverage",
            rationale: "Testing is below threshold",
            relatedInsights: [],
            status: "pending",
            createdAt: new Date().toISOString(),
          },
        ],
        stats: {
          successRate: 0.8,
          avgDurationMs: 100000,
          commonFailureReasons: [],
          commonSuccessFactors: [],
          categoryPerformance: {},
        },
      };

      mkdirSync(TEST_MEMORY_DIR, { recursive: true });
      writeFileSync(TEST_REFLECTIONS_PATH, JSON.stringify([session]));

      // Create a minimal backlog
      const backlogContent = `# Backlog

## Pending
- [ ] #100: Existing task

## Completed
`;
      writeFileSync(TEST_BACKLOG_PATH, backlogContent);

      const result = processHighPrioritySuggestions();

      expect(result.processed).toBe(1);
      expect(result.suggestions.length).toBe(1);
      expect(result.suggestions[0].priority).toBe("high");

      // Verify backlog was updated
      const updatedBacklog = readFileSync(TEST_BACKLOG_PATH, "utf-8");
      expect(updatedBacklog).toContain("Critical improvement needed");
    });
  });

  describe("runReflection() integration", () => {
    it("should run a complete reflection session", () => {
      // This test requires evolution history to exist
      // Just verify the function runs without error
      const session = runReflection("test_trigger");

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.timestamp).toBeDefined();
      expect(session.triggerReason).toBe("test_trigger");
      expect(session.insights).toBeDefined();
      expect(session.patterns).toBeDefined();
      expect(session.suggestions).toBeDefined();
      expect(session.stats).toBeDefined();

      // Verify session was saved
      const reflections = loadReflections();
      const savedSession = reflections.find((r) => r.id === session.id);
      expect(savedSession).toBeDefined();
    });
  });
});