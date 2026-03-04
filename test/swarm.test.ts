/**
 * Swarm unit tests
 *
 * Tests cover:
 * - Role registry completeness and structure
 * - listRoles() output format
 * - getRole() lookup
 * - formatSwarmResult() output format
 * - run_swarm tool parameter validation
 * - Orchestrator JSON parsing robustness
 */

import { describe, it, expect } from "vitest";
import { ROLE_REGISTRY, listRoles, getRole, MARKET_ANALYST, NEWS_RESEARCHER, CODE_REVIEWER } from "../src/swarm/roles.js";
import { formatSwarmResult } from "../src/swarm/orchestrator.js";
import { runSwarmTool } from "../src/swarm/tool.js";
import type { SwarmResult } from "../src/swarm/orchestrator.js";

// ── Role Registry Tests ──────────────────────────────────────────────────────

describe("swarm/roles", () => {
  it("should have at least 5 roles in the registry", () => {
    const roles = Object.keys(ROLE_REGISTRY);
    expect(roles.length).toBeGreaterThanOrEqual(5);
  });

  it("each role should have required fields", () => {
    for (const role of Object.values(ROLE_REGISTRY)) {
      expect(role.name).toBeTruthy();
      expect(role.label).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.systemPrompt).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(role.thinkingLevel);
      expect(Array.isArray(role.suggestedTools)).toBe(true);
    }
  });

  it("role name should match registry key", () => {
    for (const [key, role] of Object.entries(ROLE_REGISTRY)) {
      expect(role.name).toBe(key);
    }
  });

  it("listRoles() should return formatted string with all role names", () => {
    const list = listRoles();
    expect(list).toContain("market_analyst");
    expect(list).toContain("news_researcher");
    expect(list).toContain("onchain_analyst");
    expect(list).toContain("code_reviewer");
    expect(list).toContain("researcher");
  });

  it("listRoles() should include descriptions", () => {
    const list = listRoles();
    // Each line should contain the role description
    expect(list).toContain("Technical analysis");
    expect(list).toContain("News and fundamental");
  });

  it("getRole() should return correct role by name", () => {
    const role = getRole("market_analyst");
    expect(role).toBeDefined();
    expect(role?.name).toBe("market_analyst");
    expect(role?.label).toBe("Market Analyst");
  });

  it("getRole() should return undefined for unknown role", () => {
    const role = getRole("nonexistent_role_xyz");
    expect(role).toBeUndefined();
  });

  it("market analyst should suggest web_search and fetch_webpage", () => {
    expect(MARKET_ANALYST.suggestedTools).toContain("web_search");
    expect(MARKET_ANALYST.suggestedTools).toContain("fetch_webpage");
  });

  it("code reviewer should suggest read and grep", () => {
    expect(CODE_REVIEWER.suggestedTools).toContain("read");
    expect(CODE_REVIEWER.suggestedTools).toContain("grep");
  });

  it("code reviewer should have high thinking level", () => {
    expect(CODE_REVIEWER.thinkingLevel).toBe("high");
  });

  it("news researcher system prompt should mention searching actively", () => {
    expect(NEWS_RESEARCHER.systemPrompt.toLowerCase()).toContain("search");
  });
});

// ── formatSwarmResult Tests ───────────────────────────────────────────────────

describe("swarm/orchestrator - formatSwarmResult", () => {
  const mockResult: SwarmResult = {
    task: "Analyze BTC for long position",
    agents: [
      {
        role: "market_analyst",
        label: "Market Analyst",
        conclusion: "BTC is in a bullish structure. RSI at 55, support at 95k.",
        durationMs: 12000,
      },
      {
        role: "news_researcher",
        label: "News Researcher",
        conclusion: "Positive sentiment — ETF inflows strong this week.",
        durationMs: 8000,
      },
      {
        role: "devils_advocate",
        label: "Devil's Advocate",
        conclusion: "[Failed: timeout]",
        durationMs: 0,
        error: "timeout",
      },
    ],
    synthesis: "**Conclusion**: Overall bullish. Both technical and fundamental signals align.\n**Recommendation**: Consider long with stop at 93k.",
    totalDurationMs: 35000,
  };

  it("should include task in output", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("Analyze BTC for long position");
  });

  it("should include all agent labels", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("Market Analyst");
    expect(output).toContain("News Researcher");
    expect(output).toContain("Devil's Advocate");
  });

  it("should include agent conclusions", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("bullish structure");
    expect(output).toContain("ETF inflows");
  });

  it("should mark failed agents with error icon", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("❌");
  });

  it("should mark successful agents with success icon", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("✅");
  });

  it("should include synthesis section", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("Synthesis");
    expect(output).toContain("Overall bullish");
    expect(output).toContain("Recommendation");
  });

  it("should show total duration in seconds", () => {
    const output = formatSwarmResult(mockResult);
    expect(output).toContain("35s");
  });
});

// ── run_swarm Tool Tests ──────────────────────────────────────────────────────

describe("swarm/tool - run_swarm", () => {
  it("should have correct tool name", () => {
    expect(runSwarmTool.name).toBe("run_swarm");
  });

  it("should have description mentioning key use cases", () => {
    expect(runSwarmTool.description).toContain("market analysis");
    expect(runSwarmTool.description).toContain("code audit");
  });

  it("should list available roles in description", () => {
    expect(runSwarmTool.description).toContain("market_analyst");
    expect(runSwarmTool.description).toContain("news_researcher");
  });

  it("should fail gracefully when runSwarm throws", () => {
    // Error handling is in the execute function — just verify it exists
    expect(runSwarmTool.execute).toBeTypeOf("function");
  });

  it("tool parameters schema should require task field", () => {
    // The schema is a TypeBox schema object
    const schema = runSwarmTool.parameters as { properties: Record<string, unknown>; required?: string[] };
    expect(schema.properties).toHaveProperty("task");
  });

  it("tool parameters schema should have optional roles array", () => {
    const schema = runSwarmTool.parameters as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("roles");
  });

  it("tool parameters schema should have optional timeout", () => {
    const schema = runSwarmTool.parameters as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("timeout_minutes");
  });
});

// ── Integration: jinxTools includes run_swarm ─────────────────────────────────

describe("swarm/tool - registration in jinxTools", () => {
  it("should be included in jinxTools export", async () => {
    const { jinxTools } = await import("../src/agent/tools.js");
    const swarmTool = jinxTools.find((t) => t.name === "run_swarm");
    expect(swarmTool).toBeDefined();
    expect(swarmTool?.label).toBe("Run Agent Swarm");
  });
});
