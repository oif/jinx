import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recordApiCall,
  recordClaudeUsage,
  recordSearchUsage,
  recordGitHubUsage,
  getCostSummary,
  getRecentCalls,
  setBudget,
  getBudget,
  shouldSendBudgetAlert,
  formatCostReport,
  formatRecentCalls,
} from "../src/costs/tracker.js";

// Mock fs
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

import { readFileSync, writeFileSync, existsSync } from "node:fs";

describe("Cost Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as any).mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("recordApiCall", () => {
    it("should record an API call", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ daily: [] }));

      const call = recordApiCall("test-provider", 0.05, {
        endpoint: "/test",
        metadata: { test: true },
      });

      expect(call.provider).toBe("test-provider");
      expect(call.cost).toBe(0.05);
      expect(call.id).toBeDefined();
      expect(call.timestamp).toBeDefined();
      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe("recordClaudeUsage", () => {
    it("should record Claude usage with estimated cost", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ daily: [] }));

      const call = recordClaudeUsage(4000, 2000, { task: "test" });

      expect(call.provider).toBe("claude-code");
      expect(call.inputTokens).toBe(4000);
      expect(call.outputTokens).toBe(2000);
      expect(call.cost).toBeGreaterThan(0);
      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe("recordSearchUsage", () => {
    it("should record search usage with provider cost", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ daily: [] }));

      const call = recordSearchUsage("brave", "test query");

      expect(call.provider).toBe("brave");
      expect(call.cost).toBe(0.003);
      expect(call.metadata).toEqual({ query: "test query" });
    });

    it("should record different providers with different costs", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ daily: [] }));

      const exaCall = recordSearchUsage("exa");
      const braveCall = recordSearchUsage("brave");
      const serperCall = recordSearchUsage("serper");

      expect(exaCall.cost).toBe(0.05);
      expect(braveCall.cost).toBe(0.003);
      expect(serperCall.cost).toBe(0.001);
    });
  });

  describe("recordGitHubUsage", () => {
    it("should record GitHub usage as free", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ daily: [] }));

      const call = recordGitHubUsage("/repos/issues");

      expect(call.provider).toBe("github");
      expect(call.cost).toBe(0);
      expect(call.endpoint).toBe("/repos/issues");
    });
  });

  describe("getCostSummary", () => {
    it("should return summary with zero values when no data", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          daily: [
            {
              date: new Date().toISOString().split("T")[0],
              calls: [],
              totalCost: 0,
              byProvider: {},
            },
          ],
        })
      );

      const summary = getCostSummary(30);

      expect(summary.totalCost).toBe(0);
      expect(summary.totalCalls).toBe(0);
      expect(summary.todayCost).toBe(0);
      expect(summary.todayCalls).toBe(0);
    });

    it("should aggregate costs correctly", () => {
      const today = new Date().toISOString().split("T")[0];
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          daily: [
            {
              date: today,
              calls: [
                { id: "1", provider: "brave", cost: 0.003 },
                { id: "2", provider: "exa", cost: 0.05 },
              ],
              totalCost: 0.053,
              byProvider: {
                brave: { calls: 1, cost: 0.003 },
                exa: { calls: 1, cost: 0.05 },
              },
            },
          ],
        })
      );

      const summary = getCostSummary(30);

      expect(summary.totalCost).toBe(0.053);
      expect(summary.totalCalls).toBe(2);
      expect(summary.todayCost).toBe(0.053);
      expect(summary.byProvider.brave.cost).toBe(0.003);
      expect(summary.byProvider.exa.cost).toBe(0.05);
    });
  });

  describe("Budget Management", () => {
    it("should set and get budget", () => {
      // First mock for setBudget (reads existing)
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ daily: [] }));

      setBudget(50, 80);
      
      // Now mock for getBudget to return saved budget
      (readFileSync as any).mockReturnValue(
        JSON.stringify({ 
          daily: [], 
          budget: { monthlyLimit: 50, alertThreshold: 80 } 
        })
      );
      const budget = getBudget();

      expect(budget).toEqual({ monthlyLimit: 50, alertThreshold: 80 });
    });

    it("should detect budget alert condition", () => {
      const today = new Date().toISOString().split("T")[0];
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          daily: [
            {
              date: today,
              calls: [{ id: "1", provider: "claude-code", cost: 45 }],
              totalCost: 45,
              byProvider: { "claude-code": { calls: 1, cost: 45 } },
            },
          ],
          budget: { monthlyLimit: 50, alertThreshold: 80 },
        })
      );

      const alert = shouldSendBudgetAlert();

      expect(alert.shouldAlert).toBe(true);
      expect(alert.percentage).toBe(90);
      expect(alert.remaining).toBe(5);
    });

    it("should not alert if already sent today", () => {
      const today = new Date().toISOString().split("T")[0];
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          daily: [
            {
              date: today,
              calls: [{ id: "1", provider: "claude-code", cost: 45 }],
              totalCost: 45,
              byProvider: { "claude-code": { calls: 1, cost: 45 } },
            },
          ],
          budget: { monthlyLimit: 50, alertThreshold: 80 },
          lastAlertSent: today,
        })
      );

      const alert = shouldSendBudgetAlert();

      expect(alert.shouldAlert).toBe(false);
    });
  });

  describe("Formatting", () => {
    it("should format cost report", () => {
      const summary = {
        totalCost: 1.5,
        totalCalls: 10,
        todayCost: 0.5,
        todayCalls: 3,
        byProvider: {
          brave: { calls: 5, cost: 0.5 },
          exa: { calls: 5, cost: 1.0 },
        },
        dailyAverage: 0.05,
      };

      const report = formatCostReport(summary);

      expect(report).toContain("API Cost Report");
      expect(report).toContain("Today: $0.5000");
      expect(report).toContain("30-Day Total: $1.5000");
      expect(report).toContain("brave");
      expect(report).toContain("exa");
    });

    it("should format recent calls", () => {
      const calls = [
        {
          id: "1",
          timestamp: new Date().toISOString(),
          provider: "brave",
          cost: 0.003,
        },
        {
          id: "2",
          timestamp: new Date().toISOString(),
          provider: "claude-code",
          cost: 0.04,
          metadata: { query: "test" },
        },
      ];

      const formatted = formatRecentCalls(calls);

      expect(formatted).toContain("Recent API Calls");
      expect(formatted).toContain("brave");
      expect(formatted).toContain("claude-code");
    });
  });
});
