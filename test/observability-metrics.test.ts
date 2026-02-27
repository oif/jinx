import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  recordAgentPrompt,
  recordToolCall,
  recordEvolutionCycle,
  getPerformanceSummary,
  formatPerformanceReport,
  resetSessionMetrics,
} from "../src/observability/metrics.js";

const TEST_DATA_DIR = join(process.cwd(), "data");
const TEST_METRICS_PATH = join(TEST_DATA_DIR, "performance-metrics.json");

describe("observability/metrics", () => {
  beforeEach(() => {
    // Clean up test data
    try {
      if (existsSync(TEST_METRICS_PATH)) {
        rmSync(TEST_METRICS_PATH);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  afterEach(() => {
    // Clean up after tests
    try {
      if (existsSync(TEST_METRICS_PATH)) {
        rmSync(TEST_METRICS_PATH);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("recordAgentPrompt", () => {
    it("should record successful prompt metrics", () => {
      recordAgentPrompt({
        durationMs: 1500,
        hasImages: false,
        wasStreaming: false,
        success: true,
      });

      const summary = getPerformanceSummary();
      expect(summary.totalPrompts).toBe(1);
      expect(summary.avgResponseTimeMs).toBe(1500);
    });

    it("should record failed prompt metrics", () => {
      recordAgentPrompt({
        durationMs: 5000,
        hasImages: true,
        wasStreaming: true,
        success: false,
        errorType: "timeout",
      });

      const summary = getPerformanceSummary();
      expect(summary.totalPrompts).toBe(1);
      expect(summary.avgResponseTimeMs).toBe(5000);
    });

    it("should calculate average across multiple prompts", () => {
      recordAgentPrompt({ durationMs: 1000, hasImages: false, wasStreaming: false, success: true });
      recordAgentPrompt({ durationMs: 2000, hasImages: false, wasStreaming: false, success: true });
      recordAgentPrompt({ durationMs: 3000, hasImages: false, wasStreaming: false, success: true });

      const summary = getPerformanceSummary();
      expect(summary.totalPrompts).toBe(3);
      expect(summary.avgResponseTimeMs).toBe(2000);
    });

    it("should calculate P95 response time", () => {
      // Add 20 prompts with varying durations
      for (let i = 1; i <= 20; i++) {
        recordAgentPrompt({ durationMs: i * 100, hasImages: false, wasStreaming: false, success: true });
      }

      const summary = getPerformanceSummary();
      expect(summary.p95ResponseTimeMs).toBeGreaterThanOrEqual(1900);
    });
  });

  describe("recordToolCall", () => {
    it("should record tool calls with breakdown", () => {
      recordToolCall({ toolName: "claude_code", durationMs: 5000, success: true });
      recordToolCall({ toolName: "claude_code", durationMs: 6000, success: true });
      recordToolCall({ toolName: "fetch_webpage", durationMs: 1000, success: true });

      const summary = getPerformanceSummary();
      expect(summary.totalToolCalls).toBe(3);
      expect(summary.toolBreakdown["claude_code"]).toBe(2);
      expect(summary.toolBreakdown["fetch_webpage"]).toBe(1);
    });
  });

  describe("recordEvolutionCycle", () => {
    it("should record successful evolution cycles", () => {
      recordEvolutionCycle({
        cycle: 1,
        taskId: "#001",
        durationMs: 30000,
        status: "success",
      });

      const summary = getPerformanceSummary();
      expect(summary.totalEvolutions).toBe(1);
      expect(summary.evolutionSuccessRate).toBe(100);
      expect(summary.avgEvolutionTimeMs).toBe(30000);
    });

    it("should calculate success rate correctly", () => {
      recordEvolutionCycle({ cycle: 1, taskId: "#001", durationMs: 10000, status: "success" });
      recordEvolutionCycle({ cycle: 2, taskId: "#002", durationMs: 20000, status: "failed" });
      recordEvolutionCycle({ cycle: 3, taskId: "#003", durationMs: 15000, status: "success" });

      const summary = getPerformanceSummary();
      expect(summary.totalEvolutions).toBe(3);
      expect(summary.evolutionSuccessRate).toBe(67); // 2 out of 3
    });
  });

  describe("formatPerformanceReport", () => {
    it("should format a readable performance report", () => {
      // Add some test data
      recordAgentPrompt({ durationMs: 1500, hasImages: false, wasStreaming: false, success: true });
      recordToolCall({ toolName: "claude_code", durationMs: 5000, success: true });
      recordEvolutionCycle({ cycle: 1, taskId: "#001", durationMs: 30000, status: "success" });

      const report = formatPerformanceReport();

      expect(report).toContain("Performance Report");
      expect(report).toContain("Agent Prompts");
      expect(report).toContain("Tool Calls");
      expect(report).toContain("Evolution Cycles");
      expect(report).toContain("Total: 1");
    });

    it("should show empty report when no data", () => {
      const report = formatPerformanceReport();

      expect(report).toContain("Performance Report");
      expect(report).toContain("Total: 0");
    });
  });

  describe("resetSessionMetrics", () => {
    it("should reset session start time", () => {
      const beforeSummary = getPerformanceSummary();
      const initialUptime = beforeSummary.uptimeHours;

      // Wait a tiny bit and reset
      resetSessionMetrics();

      const afterSummary = getPerformanceSummary();
      expect(afterSummary.uptimeHours).toBeLessThan(initialUptime + 0.1);
    });
  });
});
