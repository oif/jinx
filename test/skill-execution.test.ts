import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerTool,
  getTool,
  hasTool,
  getRegisteredTools,
  executeSkillSteps,
  formatExecutionResult,
  type Skill,
} from "../src/skills/library.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

// Mock logger to avoid noise in tests
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Skill Execution Engine", () => {
  const mockTool: ToolDefinition = {
    name: "mock_tool",
    label: "Mock Tool",
    description: "A mock tool for testing",
    parameters: {},
    execute: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "mock result" }],
    }),
  };

  const mockFailingTool: ToolDefinition = {
    name: "mock_failing_tool",
    label: "Mock Failing Tool",
    description: "A mock tool that fails",
    parameters: {},
    execute: vi.fn().mockRejectedValue(new Error("Tool failed")),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up registered tools
    const tools = getRegisteredTools();
    for (const tool of tools) {
      // No unregister method, but we can rely on test isolation
    }
  });

  describe("Tool Registry", () => {
    it("should register a tool", () => {
      registerTool(mockTool);
      expect(hasTool("mock_tool")).toBe(true);
      expect(getTool("mock_tool")).toBe(mockTool);
    });

    it("should return undefined for unregistered tools", () => {
      expect(getTool("nonexistent")).toBeUndefined();
      expect(hasTool("nonexistent")).toBe(false);
    });

    it("should list all registered tools", () => {
      registerTool(mockTool);
      const tools = getRegisteredTools();
      expect(tools).toContain("mock_tool");
    });
  });

  describe("executeSkillSteps", () => {
    it("should execute all steps successfully", async () => {
      registerTool(mockTool);

      const skill: Skill = {
        id: "test-skill",
        name: "Test Skill",
        description: "A test skill",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        tags: ["test"],
        parameters: [],
        steps: [
          { toolName: "mock_tool", params: { key: "value1" } },
          { toolName: "mock_tool", params: { key: "value2" } },
        ],
      };

      const result = await executeSkillSteps(skill, {});

      expect(result.success).toBe(true);
      expect(result.skillId).toBe("test-skill");
      expect(result.stepsExecuted).toBe(2);
      expect(result.stepsSucceeded).toBe(2);
      expect(result.stepsFailed).toBe(0);
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0].success).toBe(true);
      expect(result.stepResults[1].success).toBe(true);
    });

    it("should handle missing tools gracefully", async () => {
      const skill: Skill = {
        id: "test-skill-missing-tool",
        name: "Test Skill Missing Tool",
        description: "A test skill with missing tool",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        tags: ["test"],
        parameters: [],
        steps: [{ toolName: "nonexistent_tool", params: {} }],
        errorRecovery: { retryCount: 0 },
      };

      const result = await executeSkillSteps(skill, {});

      expect(result.success).toBe(false);
      expect(result.stepsExecuted).toBe(1);
      expect(result.stepsFailed).toBe(1);
      expect(result.error).toContain("Tool not found");
    });

    it("should handle tool failures with no retry", async () => {
      registerTool(mockFailingTool);

      const skill: Skill = {
        id: "test-skill-failing",
        name: "Test Skill Failing",
        description: "A test skill with failing tool",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        tags: ["test"],
        parameters: [],
        steps: [{ toolName: "mock_failing_tool", params: {} }],
        errorRecovery: { retryCount: 0 },
      };

      const result = await executeSkillSteps(skill, {});

      expect(result.success).toBe(false);
      expect(result.stepsFailed).toBe(1);
      expect(result.error).toBe("Tool failed");
    });

    it("should interpolate parameters correctly", async () => {
      const executeMock = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "result" }],
      });

      const parametricTool: ToolDefinition = {
        name: "parametric_tool",
        label: "Parametric Tool",
        description: "A tool with parameter interpolation",
        parameters: {},
        execute: executeMock,
      };

      registerTool(parametricTool);

      const skill: Skill = {
        id: "test-skill-params",
        name: "Test Skill Params",
        description: "A test skill with parameters",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        tags: ["test"],
        parameters: [],
        steps: [{ toolName: "parametric_tool", params: { value: "${target}" } }],
      };

      await executeSkillSteps(skill, { target: "interpolated_value" });

      // Verify the tool was called with interpolated parameters
      const calls = executeMock.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual({ value: "interpolated_value" });
    });

    it("should call step callbacks", async () => {
      registerTool(mockTool);

      const skill: Skill = {
        id: "test-skill-callbacks",
        name: "Test Skill Callbacks",
        description: "A test skill for callbacks",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        tags: ["test"],
        parameters: [],
        steps: [{ toolName: "mock_tool", params: {} }],
      };

      const onStepStart = vi.fn();
      const onStepComplete = vi.fn();

      await executeSkillSteps(skill, {}, { onStepStart, onStepComplete });

      expect(onStepStart).toHaveBeenCalledWith(0, "mock_tool");
      expect(onStepComplete).toHaveBeenCalledWith(
        0,
        expect.objectContaining({
          stepIndex: 0,
          toolName: "mock_tool",
          success: true,
        })
      );
    });

    it("should respect abort signal", async () => {
      registerTool(mockTool);

      const skill: Skill = {
        id: "test-skill-abort",
        name: "Test Skill Abort",
        description: "A test skill for abort",
        version: "1.0.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        tags: ["test"],
        parameters: [],
        steps: [{ toolName: "mock_tool", params: {} }],
      };

      const controller = new AbortController();
      controller.abort();

      const result = await executeSkillSteps(skill, {}, { signal: controller.signal });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Skill execution aborted");
    });
  });

  describe("formatExecutionResult", () => {
    it("should format successful execution", () => {
      const result = {
        success: true,
        skillId: "test-skill",
        skillName: "Test Skill",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalDurationMs: 100,
        stepsExecuted: 2,
        stepsSucceeded: 2,
        stepsFailed: 0,
        stepResults: [
          {
            stepIndex: 0,
            toolName: "tool1",
            params: {},
            success: true,
            result: "result1",
            durationMs: 50,
          },
          {
            stepIndex: 1,
            toolName: "tool2",
            params: {},
            success: true,
            result: "result2",
            durationMs: 50,
          },
        ],
        finalOutput: "final result",
      };

      const formatted = formatExecutionResult(result);

      expect(formatted).toContain("Test Skill");
      expect(formatted).toContain("✅ Success");
      expect(formatted).toContain("tool1");
      expect(formatted).toContain("tool2");
      expect(formatted).toContain("final result");
    });

    it("should format failed execution", () => {
      const result = {
        success: false,
        skillId: "test-skill",
        skillName: "Test Skill",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalDurationMs: 50,
        stepsExecuted: 1,
        stepsSucceeded: 0,
        stepsFailed: 1,
        stepResults: [
          {
            stepIndex: 0,
            toolName: "failing_tool",
            params: {},
            success: false,
            error: "Something went wrong",
            durationMs: 50,
          },
        ],
        error: "Something went wrong",
      };

      const formatted = formatExecutionResult(result);

      expect(formatted).toContain("Test Skill");
      expect(formatted).toContain("❌ Failed");
      expect(formatted).toContain("Something went wrong");
    });
  });
});
