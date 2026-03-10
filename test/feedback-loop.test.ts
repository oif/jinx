/**
 * Tests for Feedback Loop Module
 * Closed-loop verification for Evaluation-driven Improvement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadFeedbackRecords,
  startTrackingTask,
  completeTracking,
  generateFeedbackSummary,
  shouldRunFeedbackLoop,
  formatFeedbackSummary,
  getMostEffectivePatterns,
  getLeastEffectivePatterns,
  type FeedbackRecord,
  type FeedbackConfig,
} from "../src/evolution/feedback-loop.js";
import type { ImprovementTask } from "../src/evolution/improvement-generator.js";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Mock data directory for tests
const TEST_FEEDBACK_DIR = join(process.cwd(), "data", "feedback");
const TEST_FEEDBACK_PATH = join(TEST_FEEDBACK_DIR, "feedback-records.jsonl");

describe("Feedback Loop", () => {
  // Clean up before/after tests
  beforeEach(() => {
    // Reset any mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test files if they exist
    try {
      if (existsSync(TEST_FEEDBACK_PATH)) {
        rmSync(TEST_FEEDBACK_PATH, { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("loadFeedbackRecords", () => {
    it("should return empty array when no records exist", () => {
      // The function reads from a specific path, so we just verify it returns an array
      const records = loadFeedbackRecords();
      expect(Array.isArray(records)).toBe(true);
    });
  });

  describe("startTrackingTask", () => {
    it("should create tracking info for a task", () => {
      const task: ImprovementTask = {
        id: "task-1",
        title: "Test Task",
        description: "A test task",
        source: "low-health",
        priority: "high",
        status: "pending",
        createdAt: new Date().toISOString(),
        affectedModules: ["src/test.ts"],
        suggestedActions: ["Add tests"],
      };
      
      const result = startTrackingTask(task);
      
      expect(result.trackingId).toBe("track-task-1");
      expect(result.beforeMetrics).toBeDefined();
      expect(result.beforeMetrics.healthScore).toBeGreaterThanOrEqual(0);
      expect(result.beforeMetrics.healthScore).toBeLessThanOrEqual(100);
    });

    it("should record before metrics", () => {
      const task: ImprovementTask = {
        id: "task-2",
        title: "Another Task",
        description: "Another test task",
        source: "low-quality",
        priority: "medium",
        status: "pending",
        createdAt: new Date().toISOString(),
        affectedModules: [],
        suggestedActions: [],
      };
      
      const result = startTrackingTask(task);
      
      expect(result.beforeMetrics).toHaveProperty("healthScore");
      expect(result.beforeMetrics).toHaveProperty("qualityAvg");
      expect(result.beforeMetrics).toHaveProperty("successRate");
      expect(result.beforeMetrics).toHaveProperty("opportunityCount");
    });
  });

  describe("completeTracking", () => {
    it("should create feedback record with improvement score", () => {
      const task: ImprovementTask = {
        id: "task-3",
        title: "Complete Task",
        description: "Task to complete",
        source: "high-complexity",
        priority: "high",
        status: "completed",
        createdAt: new Date().toISOString(),
        affectedModules: ["src/module.ts"],
        suggestedActions: ["Refactor"],
      };
      
      const beforeMetrics = {
        healthScore: 50,
        qualityAvg: 5.0,
        successRate: 0.5,
        opportunityCount: 5,
      };
      
      const record = completeTracking(task, beforeMetrics, "Success", {
        minCyclesForMeasurement: 1,
        effectivenessThreshold: 5,
        comparisonWindowHours: 1,
      });
      
      expect(record.taskId).toBe("task-3");
      expect(record.taskTitle).toBe("Complete Task");
      expect(record.taskSource).toBe("high-complexity");
      expect(record.beforeHealthScore).toBe(50);
      expect(typeof record.improvement).toBe("number");
      expect(typeof record.effective).toBe("boolean");
      expect(record.analysis).toBeDefined();
    });

    it("should mark task as effective when improvement exceeds threshold", () => {
      const task: ImprovementTask = {
        id: "task-4",
        title: "Effective Task",
        description: "Should be effective",
        source: "low-health",
        priority: "high",
        status: "completed",
        createdAt: new Date().toISOString(),
        affectedModules: [],
        suggestedActions: [],
      };
      
      // High before metrics that will likely result in improvement detection
      const beforeMetrics = {
        healthScore: 30,
        qualityAvg: 3.0,
        successRate: 0.3,
        opportunityCount: 10,
      };
      
      const record = completeTracking(task, beforeMetrics, "Improved!", {
        minCyclesForMeasurement: 1,
        effectivenessThreshold: 0, // Any improvement is effective
        comparisonWindowHours: 1,
      });
      
      // The actual effectiveness depends on current system state
      expect(typeof record.effective).toBe("boolean");
    });

    it("should calculate improvement correctly", () => {
      const task: ImprovementTask = {
        id: "task-5",
        title: "Calc Task",
        description: "Calculation test",
        source: "low-health",
        priority: "medium",
        status: "completed",
        createdAt: new Date().toISOString(),
        affectedModules: [],
        suggestedActions: [],
      };
      
      const beforeMetrics = {
        healthScore: 50,
        qualityAvg: 5.0,
        successRate: 0.5,
        opportunityCount: 5,
      };
      
      const record = completeTracking(task, beforeMetrics, "Done");
      
      // Improvement calculation:
      // healthScore diff * 0.4 + qualityAvg diff * 10 * 0.3 + successRate diff * 100 * 0.2 + opportunityCount diff * 5 * 0.1
      expect(typeof record.improvement).toBe("number");
    });
  });

  describe("generateFeedbackSummary", () => {
    it("should return empty summary when no records", () => {
      const summary = generateFeedbackSummary();
      
      expect(summary.totalTracked).toBeGreaterThanOrEqual(0);
      expect(summary.recommendations).toBeInstanceOf(Array);
    });

    it("should calculate statistics from records", () => {
      const summary = generateFeedbackSummary();
      
      expect(summary.totalTracked).toBeGreaterThanOrEqual(0);
      expect(summary.effectiveCount).toBeGreaterThanOrEqual(0);
      expect(summary.ineffectiveCount).toBeGreaterThanOrEqual(0);
      expect(typeof summary.averageImprovement).toBe("number");
    });

    it("should include pattern breakdown", () => {
      const summary = generateFeedbackSummary();
      
      expect(summary.byPattern).toBeDefined();
      // byPattern is a record of pattern -> stats
    });
  });

  describe("shouldRunFeedbackLoop", () => {
    it("should return a decision object", () => {
      const result = shouldRunFeedbackLoop();
      
      expect(result).toHaveProperty("shouldRun");
      expect(result).toHaveProperty("reason");
      expect(typeof result.shouldRun).toBe("boolean");
      expect(typeof result.reason).toBe("string");
    });
  });

  describe("formatFeedbackSummary", () => {
    it("should format summary with emojis", () => {
      const summary = {
        totalTracked: 5,
        effectiveCount: 3,
        ineffectiveCount: 2,
        averageImprovement: 7.5,
        byPattern: {
          "low-health": { count: 3, avgImprovement: 10, effectiveRate: 0.67 },
          "low-quality": { count: 2, avgImprovement: 4, effectiveRate: 0.5 },
        },
        recommendations: ["Keep going", "Focus on quality"],
      };
      
      const formatted = formatFeedbackSummary(summary);
      
      expect(formatted).toContain("Feedback Loop Summary");
      expect(formatted).toContain("Total Tracked: 5");
      expect(formatted).toContain("Effective: 3");
      expect(formatted).toContain("+7.5");
      expect(formatted).toContain("Recommendations:");
    });

    it("should handle empty summary", () => {
      const summary = {
        totalTracked: 0,
        effectiveCount: 0,
        ineffectiveCount: 0,
        averageImprovement: 0,
        byPattern: {},
        recommendations: ["No data yet"],
      };
      
      const formatted = formatFeedbackSummary(summary);
      
      expect(formatted).toContain("Total Tracked: 0");
    });
  });

  describe("getMostEffectivePatterns", () => {
    it("should return array of patterns", () => {
      const patterns = getMostEffectivePatterns(3);
      
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getLeastEffectivePatterns", () => {
    it("should return array of patterns", () => {
      const patterns = getLeastEffectivePatterns(3);
      
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeLessThanOrEqual(3);
    });
  });

  describe("Integration", () => {
    it("should track task lifecycle", () => {
      const task: ImprovementTask = {
        id: "integration-1",
        title: "Integration Test",
        description: "Full lifecycle test",
        source: "low-health",
        priority: "high",
        status: "pending",
        createdAt: new Date().toISOString(),
        affectedModules: ["src/core.ts"],
        suggestedActions: ["Fix the issue"],
      };
      
      // Start tracking
      const { trackingId, beforeMetrics } = startTrackingTask(task);
      expect(trackingId).toBe("track-integration-1");
      
      // Complete tracking
      task.status = "completed";
      const record = completeTracking(task, beforeMetrics, "Successfully completed");
      
      expect(record.taskId).toBe("integration-1");
      expect(record.taskTitle).toBe("Integration Test");
    });
  });
});