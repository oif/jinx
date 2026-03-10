import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `jinx-rescue-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBacklog(dir: string, content: string): string {
  const path = join(dir, "backlog.md");
  writeFileSync(path, content);
  return path;
}

// ── reconcileBacklogState ────────────────────────────────────────────────────

describe("self-rescue", () => {
  describe("reconcileBacklogState", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTmpDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("fixes a legacy-format task that is completed in progress but still pending", async () => {
      const { reconcileBacklogState } = await import("../src/consciousness/self-rescue.js");

      const backlogPath = writeBacklog(
        tmpDir,
        "# Backlog\n\n## Pending\n- [ ] #100: Existing task\n\n## Completed\n",
      );

      const progressPath = join(tmpDir, "task-progress.json");
      writeFileSync(
        progressPath,
        JSON.stringify([
          {
            taskId: "#100",
            taskTitle: "Existing task",
            startedAt: "2026-03-09T20:35:34.742Z",
            complexity: "small",
            completedSteps: ["Existing task"],
            remainingSteps: [],
            updatedAt: "2026-03-09T20:40:23.229Z",
            cyclesSpent: 1,
            status: "completed",
          },
        ]),
      );

      // Patch loadTaskProgress to read from our temp file
      vi.doMock("../src/consciousness/task-decomposer.js", () => ({
        loadTaskProgress: () => {
          const data = JSON.parse(readFileSync(progressPath, "utf-8")) as Array<{
            taskId: string;
            taskTitle: string;
            status: string;
            updatedAt: string;
          }>;
          const map = new Map();
          for (const e of data) map.set(e.taskId, e);
          return map;
        },
      }));

      const markedDone: Array<{ taskId: string; title: string }> = [];
      const fixed = reconcileBacklogState(backlogPath, (taskId, title) => {
        markedDone.push({ taskId, title });
      });

      expect(fixed).toContain("#100");
      expect(markedDone).toHaveLength(1);
      expect(markedDone[0].taskId).toBe("#100");
    });

    it("does nothing when backlog and progress are consistent", async () => {
      const { reconcileBacklogState } = await import("../src/consciousness/self-rescue.js");

      const backlogPath = writeBacklog(
        tmpDir,
        "# Backlog\n\n## Pending\n\n## Completed\n- [x] #100: Existing task — 2026-03-10\n",
      );

      const markedDone: string[] = [];
      const fixed = reconcileBacklogState(backlogPath, (taskId) => {
        markedDone.push(taskId);
      });

      expect(fixed).toHaveLength(0);
      expect(markedDone).toHaveLength(0);
    });

    it("handles missing backlog gracefully", async () => {
      const { reconcileBacklogState } = await import("../src/consciousness/self-rescue.js");

      const nonExistentPath = join(tmpDir, "does-not-exist.md");
      const fixed = reconcileBacklogState(nonExistentPath, () => {});
      expect(fixed).toHaveLength(0);
    });
  });

  // ── detectStuckTask ───────────────────────────────────────────────────────

  describe("detectStuckTask", () => {
    function makeArchive(history: Array<{ taskId: string; status: "success" | "failed" }>) {
      const evolutionHistory = history.map((h, i) => ({
        cycle: i + 1,
        taskId: h.taskId,
        status: h.status,
        fitnessDelta: h.status === "success" ? 0.1 : -0.1,
        learnings: [],
        timestamp: new Date().toISOString(),
      }));

      return {
        branches: [
          {
            id: "branch-test",
            parentId: null,
            name: "Test Branch",
            state: {
              gitCommit: "abc",
              version: "0.0.1",
              capabilities: [],
              strategy: "balanced" as const,
              activeTaskId: null,
              metrics: { testCoverage: null, codeQuality: null, healthScore: null },
            },
            evolutionHistory,
            fitness: 1.0,
            diversityScore: 0.5,
            explorationTags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true,
            cyclesSpent: history.length,
            status: "exploring" as const,
            notes: "",
          },
        ],
        currentBranchId: "branch-test",
        config: {
          maxActiveBranches: 5,
          maxArchiveSize: 100,
          minFitnessImprovement: 0.05,
          stagnantThreshold: 5,
          diversityWeight: 0.3,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    it("detects a task stuck after 3 consecutive failures", async () => {
      const { detectStuckTask, STUCK_THRESHOLD } = await import("../src/consciousness/self-rescue.js");

      const archive = makeArchive([
        { taskId: "#100", status: "failed" },
        { taskId: "#100", status: "failed" },
        { taskId: "#100", status: "failed" },
      ]);

      const info = detectStuckTask("#100", archive);
      expect(info.isStuck).toBe(true);
      expect(info.failureCount).toBeGreaterThanOrEqual(STUCK_THRESHOLD);
    });

    it("does not flag a task with fewer than threshold failures", async () => {
      const { detectStuckTask } = await import("../src/consciousness/self-rescue.js");

      const archive = makeArchive([
        { taskId: "#100", status: "failed" },
        { taskId: "#100", status: "failed" },
      ]);

      const info = detectStuckTask("#100", archive);
      expect(info.isStuck).toBe(false);
    });

    it("resets streak when a success occurs", async () => {
      const { detectStuckTask } = await import("../src/consciousness/self-rescue.js");

      const archive = makeArchive([
        { taskId: "#100", status: "failed" },
        { taskId: "#100", status: "failed" },
        { taskId: "#100", status: "success" }, // streak reset
        { taskId: "#100", status: "failed" },
        { taskId: "#100", status: "failed" },
      ]);

      const info = detectStuckTask("#100", archive);
      expect(info.isStuck).toBe(false);
      expect(info.failureCount).toBe(2);
    });

    it("ignores other tasks when counting streak", async () => {
      const { detectStuckTask } = await import("../src/consciousness/self-rescue.js");

      // #100 only fails twice; other tasks interleaved
      const archive = makeArchive([
        { taskId: "#100", status: "failed" },
        { taskId: "#200", status: "failed" }, // different task
        { taskId: "#200", status: "failed" },
        { taskId: "#100", status: "failed" },
      ]);

      const info = detectStuckTask("#100", archive);
      // #100 has 2 failures at the tail (non-consecutive by position but
      // consecutive in task-filtered view)
      expect(info.isStuck).toBe(false);
      expect(info.failureCount).toBe(2);
    });

    it("returns not-stuck for an unknown task", async () => {
      const { detectStuckTask } = await import("../src/consciousness/self-rescue.js");

      const archive = makeArchive([{ taskId: "#200", status: "success" }]);
      const info = detectStuckTask("#999", archive);
      expect(info.isStuck).toBe(false);
      expect(info.failureCount).toBe(0);
    });
  });

  // ── Excel Failure Context ─────────────────────────────────────────────────

  describe("Excel failure context", () => {
    let tmpDir: string;
    const origCwd = process.cwd;

    beforeEach(() => {
      tmpDir = makeTmpDir();
      // Redirect process.cwd() so RESCUE_DIR lands in tmpDir
      process.cwd = () => tmpDir;
    });

    afterEach(() => {
      process.cwd = origCwd;
      rmSync(tmpDir, { recursive: true, force: true });
      vi.resetModules();
    });

    it("saves and loads Excel failure context", async () => {
      const { saveExcelFailureContext, loadExcelFailureRecord } = await import(
        "../src/consciousness/self-rescue.js"
      );

      saveExcelFailureContext("#101", "Tests failed", "FAIL src/foo.ts\n  expect(1).toBe(2)");
      const record = loadExcelFailureRecord("#101");

      expect(record).not.toBeNull();
      expect(record!.taskId).toBe("#101");
      expect(record!.failureCount).toBe(1);
      expect(record!.testOutput).toContain("expect(1).toBe(2)");
    });

    it("increments failure count on repeated saves", async () => {
      const { saveExcelFailureContext, loadExcelFailureRecord } = await import(
        "../src/consciousness/self-rescue.js"
      );

      saveExcelFailureContext("#101", "Tests failed", "output1");
      saveExcelFailureContext("#101", "Tests failed", "output2");
      saveExcelFailureContext("#101", "Tests failed", "output3");

      const record = loadExcelFailureRecord("#101");
      expect(record!.failureCount).toBe(3);
    });

    it("clears failure context after success", async () => {
      const { saveExcelFailureContext, clearExcelFailureContext, loadExcelFailureRecord } =
        await import("../src/consciousness/self-rescue.js");

      saveExcelFailureContext("#101", "Tests failed", "output");
      clearExcelFailureContext("#101");

      const record = loadExcelFailureRecord("#101");
      expect(record).toBeNull();
    });

    it("returns null when no context exists", async () => {
      const { loadExcelFailureRecord } = await import("../src/consciousness/self-rescue.js");
      const record = loadExcelFailureRecord("#999");
      expect(record).toBeNull();
    });

    it("formats failure context for prompt injection", async () => {
      const { formatExcelFailureContext } = await import("../src/consciousness/self-rescue.js");

      const formatted = formatExcelFailureContext({
        taskId: "#101",
        failureCount: 2,
        lastFailedAt: "2026-03-10T07:00:00Z",
        reason: "Tests failed",
        testOutput: "1 test failed",
      });

      expect(formatted).toContain("Excel");
      expect(formatted).toContain("2"); // failureCount
      expect(formatted).toContain("1 test failed");
      expect(formatted).toContain("pnpm test");
    });

    it("truncates test output to 2000 chars", async () => {
      const { saveExcelFailureContext, loadExcelFailureRecord } = await import(
        "../src/consciousness/self-rescue.js"
      );

      const longOutput = "x".repeat(5000);
      saveExcelFailureContext("#101", "fail", longOutput);
      const record = loadExcelFailureRecord("#101");

      expect(record!.testOutput.length).toBeLessThanOrEqual(2000);
    });
  });
});
