import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import {
  startEvolutionProgress,
  setEvolutionStage,
  completeEvolutionProgress,
  failEvolutionProgress,
  loadProgress,
  formatProgress,
  isEvolutionActive,
  type EvolutionStage,
} from "../src/consciousness/evolution-progress.js";
import { PROGRESS_PATH } from "../src/supervisor/paths.js";

describe("evolution-progress", () => {
  // Clean up before each test
  beforeEach(() => {
    try {
      if (existsSync(PROGRESS_PATH)) {
        unlinkSync(PROGRESS_PATH);
      }
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      if (existsSync(PROGRESS_PATH)) {
        unlinkSync(PROGRESS_PATH);
      }
    } catch {
      // ignore
    }
  });

  describe("startEvolutionProgress", () => {
    it("should create progress file with correct initial state", () => {
      startEvolutionProgress(15);

      expect(existsSync(PROGRESS_PATH)).toBe(true);

      const progress = loadProgress();
      expect(progress).not.toBeNull();
      expect(progress?.cycle).toBe(15);
      expect(progress?.stage).toBe("idle");
      expect(progress?.startedAt).toBeDefined();
      expect(progress?.stageStartedAt).toBeDefined();
    });
  });

  describe("setEvolutionStage", () => {
    it("should update stage and message", () => {
      startEvolutionProgress(15);

      setEvolutionStage("evaluating", "Analyzing codebase");

      const progress = loadProgress();
      expect(progress?.stage).toBe("evaluating");
      expect(progress?.message).toBe("Analyzing codebase");
    });

    it("should track all stages correctly", () => {
      startEvolutionProgress(15);

      const stages: EvolutionStage[] = [
        "evaluating",
        "selecting",
        "implementing",
        "validating",
        "committing",
        "reporting",
      ];

      for (const stage of stages) {
        setEvolutionStage(stage, `Message for ${stage}`);
        const progress = loadProgress();
        expect(progress?.stage).toBe(stage);
      }
    });
  });

  describe("completeEvolutionProgress", () => {
    it("should mark evolution as completed with duration", () => {
      startEvolutionProgress(15);
      setEvolutionStage("implementing");

      completeEvolutionProgress(5000);

      const progress = loadProgress();
      expect(progress?.stage).toBe("completed");
      expect(progress?.durationMs).toBe(5000);
    });
  });

  describe("failEvolutionProgress", () => {
    it("should mark evolution as failed with error message", () => {
      startEvolutionProgress(15);
      setEvolutionStage("implementing");

      failEvolutionProgress("Something went wrong");

      const progress = loadProgress();
      expect(progress?.stage).toBe("failed");
      expect(progress?.message).toBe("Something went wrong");
    });
  });

  describe("loadProgress", () => {
    it("should return null when no progress file exists", () => {
      const progress = loadProgress();
      expect(progress).toBeNull();
    });
  });

  describe("isEvolutionActive", () => {
    it("should return false when no evolution is running", () => {
      expect(isEvolutionActive()).toBe(false);
    });

    it("should return true when evolution is in progress", () => {
      startEvolutionProgress(15);
      setEvolutionStage("evaluating");

      expect(isEvolutionActive()).toBe(true);
    });

    it("should return false when evolution is completed", () => {
      startEvolutionProgress(15);
      completeEvolutionProgress(1000);

      expect(isEvolutionActive()).toBe(false);
    });

    it("should return false when evolution failed", () => {
      startEvolutionProgress(15);
      failEvolutionProgress("Error");

      expect(isEvolutionActive()).toBe(false);
    });
  });

  describe("formatProgress", () => {
    it("should return 'No evolution in progress' when no progress", () => {
      const output = formatProgress();
      expect(output).toBe("No evolution in progress.");
    });

    it("should format active evolution with cycle info", () => {
      startEvolutionProgress(15);
      setEvolutionStage("implementing", "Working on feature");

      const output = formatProgress();
      expect(output).toContain("Evolution #15");
      expect(output).toContain("implementing");
      expect(output).toContain("Working on feature");
      expect(output).toContain("🔨"); // hammer emoji for implementing
    });

    it("should include progress bar for active stages", () => {
      startEvolutionProgress(15);
      setEvolutionStage("validating");

      const output = formatProgress();
      expect(output).toContain("Progress:");
      expect(output).toContain("✓"); // completed stages
      expect(output).toContain("▶"); // current stage
      expect(output).toContain("○"); // pending stages
    });
  });
});
