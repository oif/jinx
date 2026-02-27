import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import {
  getLastCommitSha,
  getLastCommitMessage,
  getFilesChanged,
  hasMeaningfulChanges,
  parseTestResult,
  formatChangeReview,
  type ChangeReviewResult,
  type FileChange,
  type TestResult,
  type QualityCheckResult,
} from "../src/quality/change-review.js";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("change-review module", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getLastCommitSha", () => {
    it("returns commit SHA", () => {
      vi.mocked(execSync).mockReturnValue("abc123def456\n");
      expect(getLastCommitSha()).toBe("abc123def456");
    });

    it("returns empty string on error", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("git error");
      });
      expect(getLastCommitSha()).toBe("");
    });
  });

  describe("getLastCommitMessage", () => {
    it("returns commit message", () => {
      vi.mocked(execSync).mockReturnValue("feat: add new feature\n");
      expect(getLastCommitMessage()).toBe("feat: add new feature");
    });
  });

  describe("getFilesChanged", () => {
    it("parses git diff-tree output correctly", () => {
      vi.mocked(execSync).mockReturnValue(`
10	5	src/main.ts
0	20	src/old.ts
50	0	src/new.ts
      `.trim());

      const files = getFilesChanged();
      expect(files).toHaveLength(3);
      expect(files[0]).toEqual({
        path: "src/main.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
      });
      expect(files[1]).toEqual({
        path: "src/old.ts",
        status: "deleted",
        additions: 0,
        deletions: 20,
      });
      expect(files[2]).toEqual({
        path: "src/new.ts",
        status: "added",
        additions: 50,
        deletions: 0,
      });
    });

    it("returns empty array on error", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("git error");
      });
      expect(getFilesChanged()).toEqual([]);
    });
  });

  describe("hasMeaningfulChanges", () => {
    it("detects code changes", () => {
      const files: FileChange[] = [
        { path: "src/main.ts", status: "modified", additions: 10, deletions: 5 },
      ];
      expect(hasMeaningfulChanges(files)).toBe(true);
    });

    it("ignores metadata files", () => {
      const files: FileChange[] = [
        { path: "data/scratchpad.md", status: "modified", additions: 10, deletions: 5 },
        { path: "EVOLOG.md", status: "modified", additions: 5, deletions: 0 },
      ];
      expect(hasMeaningfulChanges(files)).toBe(false);
    });

    it("ignores non-code files", () => {
      const files: FileChange[] = [
        { path: "README.md", status: "modified", additions: 10, deletions: 5 },
      ];
      expect(hasMeaningfulChanges(files)).toBe(false);
    });
  });

  describe("parseTestResult", () => {
    it("parses successful test results", () => {
      const mockResult = {
        numTotalTests: 10,
        numPassedTests: 10,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      };

      const result = (parseTestResult as unknown as (r: unknown, d: number) => TestResult)(mockResult, 1000);

      expect(result.passed).toBe(true);
      expect(result.total).toBe(10);
      expect(result.passedCount).toBe(10);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBe(1000);
    });

    it("parses failed test results", () => {
      const mockResult = {
        numTotalTests: 10,
        numPassedTests: 8,
        numFailedTests: 2,
        numPendingTests: 0,
        testResults: [
          {
            name: "test/file.test.ts",
            assertionResults: [
              {
                fullName: "should pass",
                status: "passed",
                failureMessages: [],
              },
              {
                fullName: "should fail",
                status: "failed",
                failureMessages: ["Expected true to be false"],
              },
            ],
          },
        ],
      };

      const result = (parseTestResult as unknown as (r: unknown, d: number) => TestResult)(mockResult, 1000);

      expect(result.passed).toBe(false);
      expect(result.failed).toBe(2);
      expect(result.failedTests).toHaveLength(1);
      expect(result.failedTests[0].name).toBe("should fail");
      expect(result.failedTests[0].error).toBe("Expected true to be false");
    });
  });

  describe("formatChangeReview", () => {
    it("formats passed review without changes", () => {
      const result: ChangeReviewResult = {
        passed: true,
        hasChanges: false,
        commitSha: "abc123def456",
        commitMessage: "feat: add feature\n\nDetails here",
        filesChanged: [],
        testResult: null,
        qualityResult: null,
        issues: [],
        summary: "No meaningful code changes",
        recommendations: ["No meaningful code changes detected in this cycle."],
      };

      const formatted = formatChangeReview(result);
      expect(formatted).toContain("✅ Change Review Passed");
      expect(formatted).toContain("abc123de");
      expect(formatted).toContain("feat: add feature");
      expect(formatted).toContain("No meaningful code changes detected");
    });

    it("formats review with test failures", () => {
      const result: ChangeReviewResult = {
        passed: false,
        hasChanges: true,
        commitSha: "abc123def456",
        commitMessage: "feat: add feature",
        filesChanged: [
          { path: "src/main.ts", status: "modified", additions: 10, deletions: 5 },
        ],
        testResult: {
          passed: false,
          total: 10,
          passed: 8,
          failed: 2,
          skipped: 0,
          durationMs: 1000,
          failedTests: [
            { name: "should work", file: "test/main.test.ts", error: "assertion failed" },
          ],
        },
        qualityResult: null,
        issues: [
          { severity: "error", category: "test", message: "Test failed: should work", file: "test/main.test.ts" },
        ],
        summary: "1 file changed | 8/10 tests passed | 1 issues (1 critical)",
        recommendations: ["Fix failing tests before pushing to main."],
      };

      const formatted = formatChangeReview(result);
      expect(formatted).toContain("❌ Change Review Failed");
      expect(formatted).toContain("should work");
      expect(formatted).toContain("Fix failing tests before pushing to main");
    });

    it("formats review with quality issues", () => {
      const qualityResult: QualityCheckResult = {
        passed: false,
        eslint: {
          totalErrors: 2,
          totalWarnings: 5,
          filesChecked: 10,
          issues: [
            { file: "src/main.ts", line: 10, column: 5, severity: "error", message: "Unexpected token", rule: "syntax" },
          ],
        },
        security: {
          vulnerabilities: 1,
          summary: "Found 1 vulnerabilities (0 critical, 1 high)",
          details: "{}",
        },
        complexity: {
          highComplexityFiles: [],
          averageComplexity: 5,
          maxComplexity: 10,
        },
        summary: "ESLint: 2 errors, 5 warnings (10 files) | Security: Found 1 vulnerabilities | Complexity: All functions within limits",
      };

      const result: ChangeReviewResult = {
        passed: false,
        hasChanges: true,
        commitSha: "abc123def456",
        commitMessage: "feat: add feature",
        filesChanged: [
          { path: "src/main.ts", status: "modified", additions: 10, deletions: 5 },
        ],
        testResult: {
          passed: true,
          total: 10,
          passed: 10,
          failed: 0,
          skipped: 0,
          durationMs: 1000,
          failedTests: [],
        },
        qualityResult,
        issues: [
          { severity: "error", category: "quality", message: "ESLint error: Unexpected token", file: "src/main.ts", line: 10 },
        ],
        summary: "1 file changed | 10/10 tests passed | 2 ESLint errors | 1 issues (1 critical)",
        recommendations: ["Run 'npm run lint:fix' to auto-fix 2 ESLint errors."],
      };

      const formatted = formatChangeReview(result);
      expect(formatted).toContain("ESLint: 2 errors, 5 warnings");
      expect(formatted).toContain("Unexpected token");
      expect(formatted).toContain("Run 'npm run lint:fix'");
    });
  });
});
