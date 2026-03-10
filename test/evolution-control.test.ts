/**
 * Tests for Evolution Control Module
 * Ralph-inspired loop control mechanism
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  StopConditions,
  defaultEvolutionStopConditions,
  verifyEvolutionComplete,
  createEvolutionContext,
  trackFileOperation,
  addChangeLogEntry,
  getModifiedFiles,
  buildContextInjection,
  estimateCost,
  EvolutionLoopController,
} from "../src/consciousness/evolution-control.js";

describe("Evolution Control", () => {
  describe("StopConditions", () => {
    describe("maxIterations", () => {
      it("should stop when iteration reaches max", () => {
        const condition = StopConditions.maxIterations(3);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 2, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 3, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
        expect(condition({ iteration: 4, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
      });
    });

    describe("maxTokens", () => {
      it("should stop when token count exceeds limit", () => {
        const condition = StopConditions.maxTokens(1000);
        expect(condition({ iteration: 1, totalTokens: 500, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 999, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 1000, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
        expect(condition({ iteration: 1, totalTokens: 1001, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
      });
    });

    describe("maxCost", () => {
      it("should stop when cost exceeds limit", () => {
        const condition = StopConditions.maxCost(2.0);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 1.5, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 1.99, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 2.0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 2.5, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
      });
    });

    describe("maxDuration", () => {
      it("should stop when duration exceeds limit", () => {
        const condition = StopConditions.maxDuration(60000); // 1 minute
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 30000, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 59999, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 60000, consecutiveFailures: 0 })).toBe(true);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 70000, consecutiveFailures: 0 })).toBe(true);
      });
    });

    describe("maxConsecutiveFailures", () => {
      it("should stop when consecutive failures reach max", () => {
        const condition = StopConditions.maxConsecutiveFailures(2);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 1 })).toBe(false);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 2 })).toBe(true);
        expect(condition({ iteration: 1, totalTokens: 0, estimatedCost: 0, durationMs: 0, consecutiveFailures: 3 })).toBe(true);
      });
    });

    describe("any", () => {
      it("should stop when ANY condition is met", async () => {
        const condition = StopConditions.any(
          StopConditions.maxIterations(5),
          StopConditions.maxCost(1.0)
        );
        
        // Neither condition met
        expect(await condition({ iteration: 2, totalTokens: 0, estimatedCost: 0.5, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        
        // First condition met
        expect(await condition({ iteration: 5, totalTokens: 0, estimatedCost: 0.5, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
        
        // Second condition met
        expect(await condition({ iteration: 2, totalTokens: 0, estimatedCost: 1.0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
        
        // Both conditions met
        expect(await condition({ iteration: 5, totalTokens: 0, estimatedCost: 1.5, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
      });
    });

    describe("all", () => {
      it("should stop when ALL conditions are met", async () => {
        const condition = StopConditions.all(
          StopConditions.maxIterations(3),
          StopConditions.maxCost(1.0)
        );
        
        // Neither condition met
        expect(await condition({ iteration: 1, totalTokens: 0, estimatedCost: 0.5, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        
        // Only first condition met
        expect(await condition({ iteration: 3, totalTokens: 0, estimatedCost: 0.5, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        
        // Only second condition met
        expect(await condition({ iteration: 1, totalTokens: 0, estimatedCost: 1.0, durationMs: 0, consecutiveFailures: 0 })).toBe(false);
        
        // Both conditions met
        expect(await condition({ iteration: 3, totalTokens: 0, estimatedCost: 1.0, durationMs: 0, consecutiveFailures: 0 })).toBe(true);
      });
    });
  });

  describe("verifyEvolutionComplete", () => {
    it("should return success when all checks pass", async () => {
      const result = await verifyEvolutionComplete({
        taskId: "test-1",
        taskTitle: "Test Task",
        filesModified: ["src/test.ts"],
        hasCommit: true,
        testResult: { passed: true },
        typeCheckResult: { passed: true },
      });
      
      expect(result.success).toBe(true);
      expect(result.reason).toContain("successfully");
      expect(result.issues).toEqual([]);
    });

    it("should fail when no commit was created", async () => {
      const result = await verifyEvolutionComplete({
        taskId: "test-1",
        taskTitle: "Test Task",
        filesModified: ["src/test.ts"],
        hasCommit: false,
      });
      
      expect(result.success).toBe(false);
      expect(result.issues).toContain("No git commit was created");
    });

    it("should fail when tests failed", async () => {
      const result = await verifyEvolutionComplete({
        taskId: "test-1",
        taskTitle: "Test Task",
        filesModified: ["src/test.ts"],
        hasCommit: true,
        testResult: { passed: false, failures: ["test failed"] },
      });
      
      expect(result.success).toBe(false);
      expect(result.issues?.some(i => i.includes("Tests failed"))).toBe(true);
    });

    it("should fail when type check failed", async () => {
      const result = await verifyEvolutionComplete({
        taskId: "test-1",
        taskTitle: "Test Task",
        filesModified: ["src/test.ts"],
        hasCommit: true,
        typeCheckResult: { passed: false, errors: ["type error"] },
      });
      
      expect(result.success).toBe(false);
      expect(result.issues?.some(i => i.includes("Type errors"))).toBe(true);
    });

    it("should fail when no files were modified", async () => {
      const result = await verifyEvolutionComplete({
        taskId: "test-1",
        taskTitle: "Test Task",
        filesModified: [],
        hasCommit: true,
      });
      
      expect(result.success).toBe(false);
      expect(result.issues).toContain("No files were modified");
    });
  });

  describe("EvolutionContext", () => {
    it("should create empty context", () => {
      const ctx = createEvolutionContext();
      
      expect(ctx.filesRead).toBeInstanceOf(Set);
      expect(ctx.filesWritten).toBeInstanceOf(Set);
      expect(ctx.filesEdited).toBeInstanceOf(Set);
      expect(ctx.changeLog).toEqual([]);
      expect(ctx.currentIteration).toBe(0);
      expect(ctx.tokenUsage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it("should track file operations", () => {
      const ctx = createEvolutionContext();
      
      trackFileOperation(ctx, "read", "src/file1.ts");
      trackFileOperation(ctx, "write", "src/file2.ts");
      trackFileOperation(ctx, "edit", "src/file3.ts");
      
      expect(ctx.filesRead.has("src/file1.ts")).toBe(true);
      expect(ctx.filesWritten.has("src/file2.ts")).toBe(true);
      expect(ctx.filesEdited.has("src/file3.ts")).toBe(true);
    });

    it("should add change log entries", () => {
      const ctx = createEvolutionContext();
      ctx.currentIteration = 1;
      
      addChangeLogEntry(ctx, {
        type: "decision",
        summary: "Made a decision",
        details: "Details here",
      });
      
      expect(ctx.changeLog.length).toBe(1);
      expect(ctx.changeLog[0].type).toBe("decision");
      expect(ctx.changeLog[0].summary).toBe("Made a decision");
      expect(ctx.changeLog[0].iteration).toBe(1);
      expect(ctx.changeLog[0].timestamp).toBeGreaterThan(0);
    });

    it("should get modified files", () => {
      const ctx = createEvolutionContext();
      
      trackFileOperation(ctx, "write", "src/file1.ts");
      trackFileOperation(ctx, "edit", "src/file2.ts");
      trackFileOperation(ctx, "read", "src/file3.ts"); // Not modified
      
      const modified = getModifiedFiles(ctx);
      
      expect(modified).toContain("src/file1.ts");
      expect(modified).toContain("src/file2.ts");
      expect(modified).not.toContain("src/file3.ts");
    });
  });

  describe("buildContextInjection", () => {
    it("should return empty string for empty context", () => {
      const ctx = createEvolutionContext();
      const injection = buildContextInjection(ctx);
      
      expect(injection).toBe("");
    });

    it("should include change log in injection", () => {
      const ctx = createEvolutionContext();
      ctx.currentIteration = 1;
      
      addChangeLogEntry(ctx, {
        type: "action",
        summary: "Did something",
      });
      
      const injection = buildContextInjection(ctx);
      
      expect(injection).toContain("Change Log");
      expect(injection).toContain("Did something");
    });

    it("should include modified files in injection", () => {
      const ctx = createEvolutionContext();
      trackFileOperation(ctx, "write", "src/modified.ts");
      
      const injection = buildContextInjection(ctx);
      
      expect(injection).toContain("Files Modified");
      expect(injection).toContain("src/modified.ts");
    });
  });

  describe("estimateCost", () => {
    it("should calculate cost correctly for known models", () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };
      
      const cost = estimateCost(usage, "anthropic/claude-sonnet-4.5");
      
      // Input: 1000/1000000 * 3.0 = 0.003
      // Output: 500/1000000 * 15.0 = 0.0075
      // Total: 0.0105
      expect(cost).toBeCloseTo(0.0105, 5);
    });

    it("should use default pricing for unknown models", () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };
      
      const cost = estimateCost(usage, "unknown/model");
      
      // Should use default pricing (claude-sonnet-4.5)
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe("EvolutionLoopController", () => {
    it("should run single iteration successfully", async () => {
      const controller = new EvolutionLoopController({
        maxIterations: 1,
      });
      
      const result = await controller.run(
        { id: "test-1", title: "Test Task" },
        async (ctx) => ({
          success: true,
          output: "Done",
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          durationMs: 1000,
        })
      );
      
      expect(result.success).toBe(true);
      expect(result.iterations).toBe(1);
      expect(result.stopReason).toBe("success");
    });

    it("should retry on failure", async () => {
      let attempts = 0;
      
      const controller = new EvolutionLoopController({
        maxIterations: 3,
      });
      
      const result = await controller.run(
        { id: "test-1", title: "Test Task" },
        async (ctx, feedback) => {
          attempts++;
          if (attempts < 2) {
            return {
              success: false,
              output: "Not yet",
              tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
              durationMs: 1000,
            };
          }
          return {
            success: true,
            output: "Done",
            tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            durationMs: 1000,
          };
        }
      );
      
      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it("should stop after max consecutive failures", async () => {
      const controller = new EvolutionLoopController({
        maxIterations: 5,
        stopConditions: [StopConditions.maxConsecutiveFailures(2)],
      });
      
      const result = await controller.run(
        { id: "test-1", title: "Test Task" },
        async (ctx) => ({
          success: false,
          output: "Failed",
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          durationMs: 1000,
        })
      );
      
      expect(result.success).toBe(false);
      expect(result.iterations).toBe(2);
      expect(result.stopReason).toBe("stop_condition_met");
    });

    it("should call callbacks", async () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const onStop = vi.fn();
      
      const controller = new EvolutionLoopController({
        maxIterations: 1,
        onIterationStart: onStart,
        onIterationEnd: onEnd,
        onStop: onStop,
      });
      
      await controller.run(
        { id: "test-1", title: "Test Task" },
        async (ctx) => ({
          success: true,
          output: "Done",
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          durationMs: 1000,
        })
      );
      
      expect(onStart).toHaveBeenCalledWith(1);
      expect(onEnd).toHaveBeenCalled();
    });

    it("should track total tokens and cost", async () => {
      const controller = new EvolutionLoopController({
        maxIterations: 2,
      });
      
      const result = await controller.run(
        { id: "test-1", title: "Test Task" },
        async (ctx) => ({
          success: true,
          output: "Done",
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          durationMs: 1000,
        })
      );
      
      expect(result.totalTokens).toBe(150);
      expect(result.totalCost).toBeGreaterThanOrEqual(0);
    });
  });
});