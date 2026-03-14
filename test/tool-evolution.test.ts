/**
 * Tests for Tool Evolution System
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  analyzeToolNeeds,
  generateTool,
  runToolEvolution,
  formatToolEvolutionStatus,
  formatToolTemplates,
  formatToolNeeds,
  createCustomTool,
  getToolEvolutionStats,
  TOOL_TEMPLATES,
  type ToolNeed,
} from "../src/evolution/tool-evolution.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Test data directory
const TEST_DATA_DIR = join(process.cwd(), "data");
const TEST_TOOL_EVOLUTION_PATH = join(TEST_DATA_DIR, "tool-evolution.json");
const TEST_SKILLS_DIR = join(TEST_DATA_DIR, "skills");
const TEST_GENERATED_TOOLS_DIR = join(TEST_DATA_DIR, "generated-tools");

describe("Tool Evolution System", () => {
  beforeEach(() => {
    // Clean up test files before each test
    try {
      if (existsSync(TEST_TOOL_EVOLUTION_PATH)) {
        rmSync(TEST_TOOL_EVOLUTION_PATH, { force: true });
      }
      if (existsSync(TEST_GENERATED_TOOLS_DIR)) {
        rmSync(TEST_GENERATED_TOOLS_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }
  });

  afterEach(() => {
    // Clean up after tests
    try {
      if (existsSync(TEST_TOOL_EVOLUTION_PATH)) {
        rmSync(TEST_TOOL_EVOLUTION_PATH, { force: true });
      }
    } catch {
      // Ignore errors
    }
  });

  describe("Tool Templates", () => {
    it("should have predefined templates", () => {
      expect(Object.keys(TOOL_TEMPLATES).length).toBeGreaterThan(0);
    });

    it("should have valid template structure", () => {
      for (const [key, template] of Object.entries(TOOL_TEMPLATES)) {
        expect(template.id).toBe(key);
        expect(template.name).toBeTruthy();
        expect(template.type).toMatch(/^(tool|skill|extension)$/);
        expect(template.description).toBeTruthy();
        expect(Array.isArray(template.tags)).toBe(true);
      }
    });

    it("should include data-transformer template", () => {
      expect(TOOL_TEMPLATES["data-transformer"]).toBeDefined();
      expect(TOOL_TEMPLATES["data-transformer"].type).toBe("skill");
    });

    it("should include backup-manager template", () => {
      expect(TOOL_TEMPLATES["backup-manager"]).toBeDefined();
      expect(TOOL_TEMPLATES["backup-manager"].category).toBe("maintenance");
    });
  });

  describe("Tool Need Analysis", () => {
    it("should analyze and return tool needs", () => {
      const needs = analyzeToolNeeds();
      expect(Array.isArray(needs)).toBe(true);
    });

    it("should identify needs with proper structure", () => {
      const needs = analyzeToolNeeds();
      
      if (needs.length > 0) {
        const need = needs[0];
        expect(need.id).toMatch(/^need-/);
        expect(need.name).toBeTruthy();
        expect(need.description).toBeTruthy();
        expect(["critical", "high", "normal", "low"]).toContain(need.priority);
        expect(["identified", "planned", "implementing", "completed", "rejected"]).toContain(need.status);
      }
    });
  });

  describe("Tool Generation", () => {
    it("should generate tool from template", () => {
      const tool = generateTool(null, "data-transformer");
      
      expect(tool).not.toBeNull();
      if (tool) {
        expect(tool.name).toBe("Data Transformer");
        expect(tool.type).toBe("skill");
        expect(tool.isRegistered).toBe(true);
      }
    });

    it("should return null for invalid template", () => {
      const tool = generateTool(null, "non-existent-template");
      expect(tool).toBeNull();
    });

    it("should generate tool from need", () => {
      const need: ToolNeed = {
        id: "test-need-1",
        type: "skill",
        name: "Test Tool",
        description: "A test tool for testing",
        rationale: "Testing the tool evolution system",
        priority: "high",
        category: "testing",
        createdAt: new Date().toISOString(),
        status: "identified",
      };

      const tool = generateTool(need);
      
      expect(tool).not.toBeNull();
      if (tool) {
        expect(tool.name).toBe("Test Tool");
        expect(tool.type).toBe("skill");
      }
    });
  });

  describe("Full Tool Evolution Cycle", () => {
    it("should run tool evolution and return results", () => {
      const result = runToolEvolution();
      
      expect(result.analyzed).toBe(true);
      expect(result.needsIdentified).toBeGreaterThanOrEqual(0);
      expect(result.toolsGenerated).toBeGreaterThanOrEqual(0);
      expect(result.toolsRegistered).toBeGreaterThanOrEqual(0);
      expect(result.summary).toBeTruthy();
      expect(Array.isArray(result.needs)).toBe(true);
      expect(Array.isArray(result.generatedTools)).toBe(true);
    });
  });

  describe("Status and Reporting", () => {
    it("should format tool evolution status", () => {
      const status = formatToolEvolutionStatus();
      
      expect(status).toContain("Tool Evolution Status");
      expect(status).toContain("Last Analysis");
      expect(status).toContain("Analysis Count");
    });

    it("should format tool templates", () => {
      const formatted = formatToolTemplates();
      
      expect(formatted).toContain("Available Tool Templates");
      expect(formatted).toContain("data-transformer");
      expect(formatted).toContain("backup-manager");
    });

    it("should format tool needs", () => {
      const needs: ToolNeed[] = [
        {
          id: "test-1",
          type: "skill",
          name: "Test Need",
          description: "A test need",
          rationale: "Testing",
          priority: "high",
          category: "test",
          createdAt: new Date().toISOString(),
          status: "identified",
        },
      ];

      const formatted = formatToolNeeds(needs);
      
      expect(formatted).toContain("Tool Needs");
      expect(formatted).toContain("Test Need");
      expect(formatted).toContain("IDENTIFIED");
    });

    it("should handle empty needs list", () => {
      const formatted = formatToolNeeds([]);
      expect(formatted).toContain("No tool needs identified");
    });
  });

  describe("Custom Tool Creation", () => {
    it("should create a custom skill", () => {
      const tool = createCustomTool({
        name: "Custom Test Skill",
        description: "A custom test skill",
        type: "skill",
        category: "testing",
      });

      expect(tool).not.toBeNull();
      if (tool) {
        expect(tool.name).toBe("Custom Test Skill");
        expect(tool.type).toBe("skill");
        expect(tool.source).toBe("manual");
      }
    });

    it("should return null for duplicate tool name", () => {
      // Create first tool
      createCustomTool({
        name: "Duplicate Tool",
        description: "First tool",
        type: "skill",
      });

      // Try to create duplicate
      const tool = createCustomTool({
        name: "Duplicate Tool",
        description: "Second tool",
        type: "skill",
      });

      expect(tool).toBeNull();
    });
  });

  describe("Statistics", () => {
    it("should return tool evolution statistics", () => {
      const stats = getToolEvolutionStats();
      
      expect(stats).toHaveProperty("analysisCount");
      expect(stats).toHaveProperty("generationCount");
      expect(stats).toHaveProperty("rejectionCount");
      expect(stats).toHaveProperty("totalNeeds");
      expect(stats).toHaveProperty("pendingNeeds");
      expect(stats).toHaveProperty("generatedTools");
      expect(stats).toHaveProperty("registeredTools");
    });
  });

  describe("Integration Tests", () => {
    it("should run complete workflow", () => {
      // Step 1: Analyze needs
      const needs = analyzeToolNeeds();
      expect(needs.length).toBeGreaterThanOrEqual(0);

      // Step 2: Run evolution
      const result = runToolEvolution();
      expect(result.analyzed).toBe(true);

      // Step 3: Get status
      const status = formatToolEvolutionStatus();
      expect(status).toContain("Tool Evolution Status");

      // Step 4: Get stats
      const stats = getToolEvolutionStats();
      expect(stats.analysisCount).toBeGreaterThan(0);
    });
  });
});