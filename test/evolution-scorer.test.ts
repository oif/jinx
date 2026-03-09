/**
 * Tests for Evolution Quality Scorer
 */

import { describe, it, expect } from "vitest";
import {
  evolutionQualityScorer,
  scoreEvolution,
  scoreRecentEvolutions,
  formatQualityReport,
  scoreCompletion,
  scoreTests,
  scoreEfficiency,
  scoreImpact,
  type EvolutionInput,
} from "../src/evals/evolution-scorer.js";

describe("Evolution Quality Scorer", () => {
  describe("Scoring Functions", () => {
    describe("scoreCompletion", () => {
      it("should return 25 for success status", () => {
        expect(scoreCompletion("success")).toBe(25);
      });

      it("should return 10 for skipped status", () => {
        expect(scoreCompletion("skipped")).toBe(10);
      });

      it("should return 0 for failed status", () => {
        expect(scoreCompletion("failed")).toBe(0);
      });
    });

    describe("scoreTests", () => {
      it("should return 25 when tests passed", () => {
        expect(scoreTests(true)).toBe(25);
      });

      it("should return 0 when tests failed", () => {
        expect(scoreTests(false)).toBe(0);
      });

      it("should return 15 when tests info is undefined", () => {
        expect(scoreTests(undefined)).toBe(15);
      });
    });

    describe("scoreEfficiency", () => {
      it("should return 25 for duration < 5 minutes", () => {
        expect(scoreEfficiency(4 * 60 * 1000)).toBe(25); // 4 min
      });

      it("should return 20 for duration 5-15 minutes", () => {
        expect(scoreEfficiency(10 * 60 * 1000)).toBe(20); // 10 min
      });

      it("should return 15 for duration 15-30 minutes", () => {
        expect(scoreEfficiency(20 * 60 * 1000)).toBe(15); // 20 min
      });

      it("should return 10 for duration 30-60 minutes", () => {
        expect(scoreEfficiency(45 * 60 * 1000)).toBe(10); // 45 min
      });

      it("should return 5 for duration > 60 minutes", () => {
        expect(scoreEfficiency(90 * 60 * 1000)).toBe(5); // 90 min
      });

      it("should return 15 when duration is undefined", () => {
        expect(scoreEfficiency(undefined)).toBe(15);
      });
    });

    describe("scoreImpact", () => {
      it("should score high impact with many files and commit", () => {
        const score = scoreImpact(
          ["file1.ts", "file2.ts", "file3.ts", "file4.ts", "file5.ts"],
          "abc123"
        );
        expect(score).toBe(25); // 15 (5+ files) + 10 (commit)
      });

      it("should score moderate impact with few files and commit", () => {
        const score = scoreImpact(["file1.ts", "file2.ts"], "abc123");
        expect(score).toBe(20); // 10 (2 files) + 10 (commit)
      });

      it("should score low impact with single file and no commit", () => {
        const score = scoreImpact(["file1.ts"], undefined);
        expect(score).toBe(10); // 5 (1 file) + 5 (no commit)
      });

      it("should handle undefined files", () => {
        const score = scoreImpact(undefined, "abc123");
        expect(score).toBe(15); // 5 (no info) + 10 (commit)
      });
    });
  });

  describe("Scorer Integration", () => {
    it("should score a successful evolution highly", async () => {
      const input: EvolutionInput = {
        cycle: 100,
        taskId: "#100",
        taskTitle: "Test task",
        status: "success",
        summary: "Completed successfully",
        durationMs: 5 * 60 * 1000, // 5 min
        filesChanged: ["file1.ts", "file2.ts"],
        testsPassed: true,
        commitHash: "abc123",
      };

      const result = await scoreEvolution(input);

      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.completion).toBe(25);
      expect(result.tests).toBe(25);
      expect(result.reason).toContain("Excellent");
    });

    it("should score a failed evolution poorly", async () => {
      const input: EvolutionInput = {
        cycle: 100,
        taskId: "#100",
        taskTitle: "Test task",
        status: "failed",
        summary: "Failed due to timeout",
        durationMs: 30 * 60 * 1000, // 30 min
        testsPassed: false,
        errorReason: "Timeout",
      };

      const result = await scoreEvolution(input);

      expect(result.score).toBeLessThan(50);
      expect(result.completion).toBe(0);
      expect(result.tests).toBe(0);
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations!.length).toBeGreaterThan(0);
    });

    it("should score a skipped evolution moderately", async () => {
      const input: EvolutionInput = {
        cycle: 100,
        taskId: "#100",
        taskTitle: "Test task",
        status: "skipped",
        summary: "Skipped due to no work needed",
      };

      const result = await scoreEvolution(input);

      expect(result.completion).toBe(10);
      expect(result.score).toBeLessThanOrEqual(50);
    });
  });

  describe("scoreRecentEvolutions", () => {
    it("should return summary for multiple evolutions", async () => {
      const records: EvolutionInput[] = [
        {
          cycle: 1,
          taskId: "#1",
          taskTitle: "Task 1",
          status: "success",
          summary: "Done",
          testsPassed: true,
        },
        {
          cycle: 2,
          taskId: "#2",
          taskTitle: "Task 2",
          status: "failed",
          summary: "Failed",
        },
        {
          cycle: 3,
          taskId: "#3",
          taskTitle: "Task 3",
          status: "success",
          summary: "Done",
          testsPassed: true,
          commitHash: "abc123",
        },
      ];

      const summary = await scoreRecentEvolutions(records);

      expect(summary.successRate).toBeCloseTo(0.667, 1);
      expect(summary.avgScore).toBeGreaterThan(0);
      expect(summary.lowScores).toBeDefined();
    });

    it("should handle empty records", async () => {
      const summary = await scoreRecentEvolutions([]);

      expect(summary.avgScore).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.lowScores).toEqual([]);
    });
  });

  describe("formatQualityReport", () => {
    it("should format a readable report", () => {
      const summary = {
        avgScore: 75.5,
        avgCompletion: 20,
        avgTests: 20,
        avgEfficiency: 18,
        avgImpact: 17.5,
        successRate: 0.8,
        lowScores: [
          { cycle: 42, score: 35, reason: "Failed due to timeout" },
        ],
      };

      const report = formatQualityReport(summary);

      expect(report).toContain("Evolution Quality Report");
      expect(report).toContain("75.5/100");
      expect(report).toContain("80.0%");
      expect(report).toContain("Completion: 20.0/25");
      expect(report).toContain("#42");
    });
  });

  describe("Mastra Scorer Integration", () => {
    it("should create scorer with correct id", () => {
      expect(evolutionQualityScorer.id).toBe("evolution-quality");
    });

    it("should have correct name", () => {
      expect(evolutionQualityScorer.name).toBe("Evolution Quality Scorer");
    });

    it("should have description", () => {
      expect(evolutionQualityScorer.description).toContain("evolution cycles");
    });
  });
});