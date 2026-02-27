import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import {
  runEslintCheck,
  runSecurityCheck,
  runComplexityAnalysis,
  runQualityCheck,
  formatQualityReport,
} from "../src/quality/code-quality.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("quality/code-quality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runEslintCheck", () => {
    it("should return no issues when ESLint finds nothing", () => {
      vi.mocked(execSync).mockReturnValue("[]");

      const result = runEslintCheck();
      expect(result).not.toBeNull();
      expect(result?.totalErrors).toBe(0);
      expect(result?.totalWarnings).toBe(0);
    });

    it("should parse ESLint output with errors and warnings", () => {
      const eslintOutput = JSON.stringify([
        {
          filePath: "/root/jinx/src/test.ts",
          messages: [
            {
              line: 10,
              column: 5,
              severity: 2,
              message: "Expected indentation of 2 spaces",
              ruleId: "indent",
            },
            {
              line: 20,
              column: 1,
              severity: 1,
              message: "Unexpected console statement",
              ruleId: "no-console",
            },
          ],
        },
      ]);

      // ESLint exits with non-zero when there are errors
      const error = new Error("ESLint found errors") as Error & { stdout: string };
      error.stdout = eslintOutput;
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runEslintCheck();
      expect(result).not.toBeNull();
      expect(result?.totalErrors).toBe(1);
      expect(result?.totalWarnings).toBe(1);
      expect(result?.issues).toHaveLength(2);
      expect(result?.issues[0].severity).toBe("error");
      expect(result?.issues[1].severity).toBe("warning");
    });

    it("should return null on unexpected error", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = runEslintCheck();
      expect(result).toBeNull();
    });
  });

  describe("runSecurityCheck", () => {
    it("should return vulnerability summary when audit finds issues", () => {
      const auditOutput = JSON.stringify({
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 2,
            moderate: 1,
            high: 1,
            critical: 0,
            total: 4,
          },
        },
      });

      // npm audit exits with non-zero when vulnerabilities found
      const error = new Error("Vulnerabilities found") as Error & { stdout: string };
      error.stdout = auditOutput;
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runSecurityCheck();
      expect(result).not.toBeNull();
      expect(result?.vulnerabilities).toBe(4);
      expect(result?.summary).toContain("4 vulnerabilities");
    });

    it("should return zero vulnerabilities when no issues found", () => {
      vi.mocked(execSync).mockReturnValue(
        JSON.stringify({
          metadata: {
            vulnerabilities: {
              info: 0,
              low: 0,
              moderate: 0,
              high: 0,
              critical: 0,
              total: 0,
            },
          },
        })
      );

      const result = runSecurityCheck();
      expect(result).not.toBeNull();
      expect(result?.vulnerabilities).toBe(0);
    });

    it("should return null on error", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Command not found");
      });

      const result = runSecurityCheck();
      expect(result).toBeNull();
    });
  });

  describe("runComplexityAnalysis", () => {
    it("should return empty result when no complexity issues found", () => {
      vi.mocked(execSync).mockReturnValue("[]");

      const result = runComplexityAnalysis();
      expect(result).not.toBeNull();
      expect(result?.highComplexityFiles).toHaveLength(0);
      expect(result?.maxComplexity).toBe(0);
    });

    it("should parse complexity issues from ESLint output", () => {
      const eslintOutput = JSON.stringify([
        {
          filePath: "/root/jinx/src/complex.ts",
          messages: [
            {
              line: 15,
              message: "Function 'processData' has a complexity of 18",
              ruleId: "complexity",
            },
            {
              line: 45,
              message: "Function 'handleRequest' has a complexity of 12",
              ruleId: "complexity",
            },
          ],
        },
      ]);

      // ESLint exits with non-zero when complexity issues found
      const error = new Error("Complexity issues found") as Error & { stdout: string };
      error.stdout = eslintOutput;
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runComplexityAnalysis();
      expect(result).not.toBeNull();
      expect(result?.highComplexityFiles).toHaveLength(2);
      expect(result?.maxComplexity).toBe(18);
      expect(result?.averageComplexity).toBe(15);
      expect(result?.highComplexityFiles[0].function).toBe("processData");
    });
  });

  describe("runQualityCheck", () => {
    it("should return passed=true when no issues found", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("[]") // ESLint
        .mockReturnValueOnce(
          JSON.stringify({
            metadata: { vulnerabilities: { total: 0 } },
          })
        ) // Security
        .mockReturnValueOnce("[]"); // Complexity

      const result = await runQualityCheck();
      expect(result.passed).toBe(true);
      expect(result.eslint).not.toBeNull();
      expect(result.security).not.toBeNull();
      expect(result.complexity).not.toBeNull();
    });

    it("should return passed=false when ESLint errors found", async () => {
      const eslintOutput = JSON.stringify([
        {
          filePath: "/root/jinx/src/test.ts",
          messages: [
            {
              line: 10,
              column: 5,
              severity: 2,
              message: "Syntax error",
              ruleId: "syntax",
            },
          ],
        },
      ]);

      const error = new Error("ESLint found errors") as Error & { stdout: string };
      error.stdout = eslintOutput;
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw error;
        }) // ESLint
        .mockReturnValueOnce(
          JSON.stringify({
            metadata: { vulnerabilities: { total: 0 } },
          })
        ) // Security
        .mockReturnValueOnce("[]"); // Complexity

      const result = await runQualityCheck();
      expect(result.passed).toBe(false);
      expect(result.eslint?.totalErrors).toBe(1);
    });
  });

  describe("formatQualityReport", () => {
    it("should format passed quality check", () => {
      const result = {
        passed: true,
        eslint: {
          totalErrors: 0,
          totalWarnings: 0,
          filesChecked: 10,
          issues: [],
        },
        security: {
          vulnerabilities: 0,
          summary: "Found 0 vulnerabilities",
          details: "{}",
        },
        complexity: {
          highComplexityFiles: [],
          averageComplexity: 5,
          maxComplexity: 8,
        },
        summary: "ESLint: 0 errors, 0 warnings | Security: No vulnerabilities | Complexity: All good",
      };

      const report = formatQualityReport(result);
      expect(report).toContain("✅ Code Quality Check Passed");
      expect(report).toContain("ESLint: 0 errors, 0 warnings");
    });

    it("should format failed quality check with errors", () => {
      const result = {
        passed: false,
        eslint: {
          totalErrors: 2,
          totalWarnings: 1,
          filesChecked: 10,
          issues: [
            {
              file: "./src/test.ts",
              line: 10,
              column: 5,
              severity: "error" as const,
              message: "Unexpected token",
              rule: "syntax",
            },
            {
              file: "./src/test2.ts",
              line: 20,
              column: 1,
              severity: "error" as const,
              message: "Unused variable",
              rule: "no-unused-vars",
            },
          ],
        },
        security: {
          vulnerabilities: 3,
          summary: "Found 3 vulnerabilities (0 critical, 1 high)",
          details: "{}",
        },
        complexity: {
          highComplexityFiles: [
            { file: "./src/complex.ts", complexity: 18, function: "bigFunction", line: 15 },
          ],
          averageComplexity: 12,
          maxComplexity: 18,
        },
        summary: "ESLint: 2 errors, 1 warning | Security: 3 vulnerabilities | Complexity: 1 high",
      };

      const report = formatQualityReport(result);
      expect(report).toContain("❌ Code Quality Check Failed");
      expect(report).toContain("🚨 ESLint Errors:");
      expect(report).toContain("./src/test.ts:10 - Unexpected token");
      expect(report).toContain("🔒 Security:");
      expect(report).toContain("📈 High Complexity Functions:");
    });
  });
});
