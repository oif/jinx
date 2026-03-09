/**
 * Tests for Pi Extensions
 *
 * Tests the jinx-tools extension and tool-groups functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  TOOL_GROUPS,
  ESSENTIAL_TOOLS,
  getEnabledToolNames,
  filterToolsByGroups,
  getToolGroupsSummary,
  getAvailableGroups,
  getToolsInGroup,
} from "../src/agent/tool-groups.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

// Test fixtures
const testConfigDir = join(process.cwd(), "data");
const testConfigPath = join(testConfigDir, "tool-groups.json");

// Mock tools for testing
const mockTools: ToolDefinition[] = [
  { name: "send_owner_message", label: "Owner Message", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "send_stream_message", label: "Stream Message", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "github_list_issues", label: "List Issues", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "remember", label: "Remember", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "claude_code", label: "Claude Code", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "list_skills", label: "List Skills", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "update_identity", label: "Update Identity", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "web_search", label: "Web Search", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
  { name: "run_swarm", label: "Run Swarm", description: "Test", parameters: {} as any, execute: async () => ({ content: [] }) },
];

describe("Tool Groups", () => {
  describe("TOOL_GROUPS constant", () => {
    it("should define all expected groups", () => {
      expect(TOOL_GROUPS).toHaveProperty("github");
      expect(TOOL_GROUPS).toHaveProperty("memory");
      expect(TOOL_GROUPS).toHaveProperty("evolution");
      expect(TOOL_GROUPS).toHaveProperty("skills");
      expect(TOOL_GROUPS).toHaveProperty("system");
      expect(TOOL_GROUPS).toHaveProperty("web");
      expect(TOOL_GROUPS).toHaveProperty("swarm");
    });

    it("should have proper structure for each group", () => {
      for (const [key, group] of Object.entries(TOOL_GROUPS)) {
        expect(group.name).toBe(key);
        expect(group.description).toBeTruthy();
        expect(Array.isArray(group.tools)).toBe(true);
        expect(group.tools.length).toBeGreaterThan(0);
      }
    });

    it("should have github group with GitHub-related tools", () => {
      expect(TOOL_GROUPS.github.tools).toContain("github_list_issues");
      expect(TOOL_GROUPS.github.tools).toContain("github_create_pr");
    });

    it("should have memory group with memory-related tools", () => {
      expect(TOOL_GROUPS.memory.tools).toContain("remember");
      expect(TOOL_GROUPS.memory.tools).toContain("recall");
    });

    it("should have evolution group with evolution-related tools", () => {
      expect(TOOL_GROUPS.evolution.tools).toContain("claude_code");
      expect(TOOL_GROUPS.evolution.tools).toContain("request_restart");
    });
  });

  describe("ESSENTIAL_TOOLS", () => {
    it("should include send_owner_message", () => {
      expect(ESSENTIAL_TOOLS.has("send_owner_message")).toBe(true);
    });

    it("should include send_stream_message", () => {
      expect(ESSENTIAL_TOOLS.has("send_stream_message")).toBe(true);
    });
  });

  describe("getAvailableGroups", () => {
    it("should return all group names", () => {
      const groups = getAvailableGroups();
      expect(groups).toContain("github");
      expect(groups).toContain("memory");
      expect(groups).toContain("evolution");
      expect(groups.length).toBe(Object.keys(TOOL_GROUPS).length);
    });
  });

  describe("getToolsInGroup", () => {
    it("should return tools for valid group", () => {
      const tools = getToolsInGroup("github");
      expect(tools).toContain("github_list_issues");
    });

    it("should return empty array for invalid group", () => {
      const tools = getToolsInGroup("nonexistent");
      expect(tools).toEqual([]);
    });
  });
});

describe("Tool Group Filtering", () => {
  const originalEnv = process.env.JINX_TOOL_GROUPS;

  beforeEach(() => {
    // Clean up any existing config
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
    delete process.env.JINX_TOOL_GROUPS;
  });

  afterEach(() => {
    // Restore environment
    if (originalEnv) {
      process.env.JINX_TOOL_GROUPS = originalEnv;
    } else {
      delete process.env.JINX_TOOL_GROUPS;
    }
    // Clean up config
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  describe("getEnabledToolNames", () => {
    it("should return all tools when no config", () => {
      const enabled = getEnabledToolNames();
      // Should include all tools from all groups plus essential tools
      expect(enabled.size).toBeGreaterThan(10);
    });

    it("should always include essential tools", () => {
      const enabled = getEnabledToolNames();
      expect(enabled.has("send_owner_message")).toBe(true);
      expect(enabled.has("send_stream_message")).toBe(true);
    });

    it("should respect JINX_TOOL_GROUPS environment variable", () => {
      process.env.JINX_TOOL_GROUPS = "github,system";
      const enabled = getEnabledToolNames();

      // Should include github tools
      expect(enabled.has("github_list_issues")).toBe(true);

      // Should include system tools
      expect(enabled.has("update_identity")).toBe(true);

      // Should NOT include memory tools
      expect(enabled.has("remember")).toBe(false);

      // Should always include essential tools
      expect(enabled.has("send_owner_message")).toBe(true);
    });

    it("should handle 'all' in environment variable", () => {
      process.env.JINX_TOOL_GROUPS = "all";
      const enabled = getEnabledToolNames();
      // Should include tools from all groups
      expect(enabled.size).toBeGreaterThan(20);
    });
  });

  describe("filterToolsByGroups", () => {
    it("should filter tools based on enabled groups", () => {
      process.env.JINX_TOOL_GROUPS = "github";
      const filtered = filterToolsByGroups(mockTools);

      // Should include github tool
      expect(filtered.some(t => t.name === "github_list_issues")).toBe(true);

      // Should include essential tools
      expect(filtered.some(t => t.name === "send_owner_message")).toBe(true);

      // Should NOT include memory tools
      expect(filtered.some(t => t.name === "remember")).toBe(false);
    });

    it("should return all tools when configured for all groups", () => {
      process.env.JINX_TOOL_GROUPS = "all";
      const filtered = filterToolsByGroups(mockTools);
      expect(filtered.length).toBe(mockTools.length);
    });

    it("should include essential tools regardless of group config", () => {
      process.env.JINX_TOOL_GROUPS = "web"; // Only web group
      const filtered = filterToolsByGroups(mockTools);

      // Essential tools should always be present
      expect(filtered.some(t => t.name === "send_owner_message")).toBe(true);
      expect(filtered.some(t => t.name === "send_stream_message")).toBe(true);
    });
  });

  describe("getToolGroupsSummary", () => {
    it("should return a readable summary", () => {
      const summary = getToolGroupsSummary();

      expect(summary).toContain("Tool Groups Configuration");
      expect(summary).toContain("github");
      expect(summary).toContain("memory");
      expect(summary).toContain("Total tools enabled");
    });
  });
});

describe("Skills Format", () => {
  it("should have valid frontmatter in web-presence skill", async () => {
    const skillPath = join(process.cwd(), "skills", "web-presence", "SKILL.md");
    if (existsSync(skillPath)) {
      const content = await import("node:fs").then(fs => fs.readFileSync(skillPath, "utf-8"));
      expect(content).toContain("---");
      expect(content).toContain("name: web-presence");
      expect(content).toContain("description:");
    }
  });

  it("should have valid frontmatter in evolution skill", async () => {
    const skillPath = join(process.cwd(), "skills", "evolution", "SKILL.md");
    if (existsSync(skillPath)) {
      const content = await import("node:fs").then(fs => fs.readFileSync(skillPath, "utf-8"));
      expect(content).toContain("---");
      expect(content).toContain("name: evolution");
      expect(content).toContain("description:");
    }
  });
});

describe("Extensions README", () => {
  it("should exist", () => {
    const readmePath = join(process.cwd(), "extensions", "README.md");
    expect(existsSync(readmePath)).toBe(true);
  });

  it("should document tool groups", async () => {
    const readmePath = join(process.cwd(), "extensions", "README.md");
    const content = await import("node:fs").then(fs => fs.readFileSync(readmePath, "utf-8"));
    expect(content).toContain("Tool Groups");
    expect(content).toContain("github");
    expect(content).toContain("memory");
  });
});