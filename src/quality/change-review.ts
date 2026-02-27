/**
 * Code Change Review Module
 * Automatically reviews code changes after evolution cycles
 * Includes test execution, quality checks, and issue detection
 */

import { execSync } from "node:child_process";
import { log } from "../util/log.js";
import { runQualityCheck, QualityCheckResult, formatQualityReport } from "./code-quality.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ChangeReviewResult {
  passed: boolean;
  hasChanges: boolean;
  commitSha: string;
  commitMessage: string;
  filesChanged: FileChange[];
  testResult: TestResult | null;
  qualityResult: QualityCheckResult | null;
  issues: ReviewIssue[];
  summary: string;
  recommendations: string[];
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface TestResult {
  passed: boolean;
  total: number;
  passedCount: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failedTests: FailedTest[];
}

export interface FailedTest {
  name: string;
  file: string;
  error: string;
}

export interface ReviewIssue {
  severity: "error" | "warning" | "info";
  category: "test" | "quality" | "security" | "complexity" | "git";
  message: string;
  file?: string;
  line?: number;
}

// ── Git Operations ─────────────────────────────────────────────────

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Get the last commit SHA
 */
export function getLastCommitSha(): string {
  return git("rev-parse HEAD");
}

/**
 * Get the last commit message
 */
export function getLastCommitMessage(): string {
  return git("log -1 --pretty=%B");
}

/**
 * Get files changed in the last commit
 */
export function getFilesChanged(): FileChange[] {
  try {
    // Get summary stats
    const statsOutput = git("diff-tree --no-commit-id --numstat HEAD");
    const files: FileChange[] = [];

    for (const line of statsOutput.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const additions = parseInt(parts[0], 10) || 0;
        const deletions = parseInt(parts[1], 10) || 0;
        const path = parts[2];

        // Determine status
        let status: FileChange["status"] = "modified";
        if (additions === 0 && deletions > 0) status = "deleted";
        else if (deletions === 0 && additions > 0) status = "added";

        files.push({ path, status, additions, deletions });
      }
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Check if there are code changes (not just metadata files)
 */
export function hasMeaningfulChanges(files: FileChange[]): boolean {
  const codeExtensions = [".ts", ".js", ".json", ".yml", ".yaml"];
  const metadataPaths = ["data/", "EVOLOG.md", "README.md"];

  return files.some((f) => {
    // Skip metadata files
    if (metadataPaths.some((mp) => f.path.startsWith(mp))) return false;
    // Include code files
    return codeExtensions.some((ext) => f.path.endsWith(ext));
  });
}

// ── Test Execution ─────────────────────────────────────────────────

export async function runTests(): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const output = execSync("npm test -- --reporter=json", {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 120000,
    });

    const result = JSON.parse(output);
    const durationMs = Date.now() - startTime;

    return parseTestResult(result, durationMs);
  } catch (e) {
    // Test command may exit with non-zero if tests fail
    const error = e as Error & { stdout?: string };
    const durationMs = Date.now() - startTime;

    if (error.stdout) {
      try {
        const result = JSON.parse(error.stdout);
        return parseTestResult(result, durationMs);
      } catch {
        // Failed to parse JSON output
      }
    }

    return {
      passed: false,
      total: 0,
      passedCount: 0,
      failed: 1,
      skipped: 0,
      durationMs,
      failedTests: [{ name: "Test execution failed", file: "unknown", error: error.message || "Unknown error" }],
    };
  }
}

/** @internal Exported for testing */
export function parseTestResult(result: unknown, durationMs: number): TestResult {
  const r = result as {
    numTotalTests?: number;
    numPassedTests?: number;
    numFailedTests?: number;
    numPendingTests?: number;
    testResults?: Array<{
      name?: string;
      status?: string;
      message?: string;
      assertionResults?: Array<{
        fullName?: string;
        status?: string;
        failureMessages?: string[];
      }>;
    }>;
  };

  const total = r.numTotalTests || 0;
  const passedCount = r.numPassedTests || 0;
  const failed = r.numFailedTests || 0;
  const skipped = r.numPendingTests || 0;

  const failedTests: FailedTest[] = [];

  for (const suite of r.testResults || []) {
    for (const test of suite.assertionResults || []) {
      if (test.status === "failed") {
        failedTests.push({
          name: test.fullName || "unknown",
          file: suite.name || "unknown",
          error: (test.failureMessages || ["Unknown error"]).join("\n"),
        });
      }
    }
  }

  return {
    passed: failed === 0,
    total,
    passedCount,
    failed,
    skipped,
    durationMs,
    failedTests,
  };
}

// ── Issue Detection ────────────────────────────────────────────────

function detectIssues(
  files: FileChange[],
  testResult: TestResult | null,
  qualityResult: QualityCheckResult | null
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  // Check for large changes
  const totalChanges = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  if (totalChanges > 500) {
    issues.push({
      severity: "warning",
      category: "git",
      message: `Large change set detected (${totalChanges} lines). Consider breaking into smaller commits.`,
    });
  }

  // Check for test failures
  if (testResult && !testResult.passed) {
    for (const failed of testResult.failedTests) {
      issues.push({
        severity: "error",
        category: "test",
        message: `Test failed: ${failed.name}`,
        file: failed.file,
      });
    }
  }

  // Check quality issues
  if (qualityResult) {
    if (qualityResult.eslint && qualityResult.eslint.totalErrors > 0) {
      for (const err of qualityResult.eslint.issues.filter((i) => i.severity === "error").slice(0, 3)) {
        issues.push({
          severity: "error",
          category: "quality",
          message: `ESLint error: ${err.message}`,
          file: err.file,
          line: err.line,
        });
      }
    }

    if (qualityResult.security && qualityResult.security.vulnerabilities > 0) {
      issues.push({
        severity: qualityResult.security.vulnerabilities > 5 ? "error" : "warning",
        category: "security",
        message: qualityResult.security.summary,
      });
    }

    if (qualityResult.complexity && qualityResult.complexity.highComplexityFiles.length > 0) {
      for (const cf of qualityResult.complexity.highComplexityFiles.slice(0, 3)) {
        issues.push({
          severity: "warning",
          category: "complexity",
          message: `High complexity function: ${cf.function} (complexity: ${cf.complexity})`,
          file: cf.file,
          line: cf.line,
        });
      }
    }
  }

  return issues;
}

// ── Recommendations ────────────────────────────────────────────────

function generateRecommendations(
  hasChanges: boolean,
  testResult: TestResult | null,
  qualityResult: QualityCheckResult | null,
  issues: ReviewIssue[]
): string[] {
  const recommendations: string[] = [];

  if (!hasChanges) {
    recommendations.push("No meaningful code changes detected in this cycle.");
    return recommendations;
  }

  if (!testResult || testResult.failed > 0) {
    recommendations.push("Fix failing tests before pushing to main.");
  }

  if (qualityResult?.eslint && qualityResult.eslint.totalErrors > 0) {
    recommendations.push(`Run 'npm run lint:fix' to auto-fix ${qualityResult.eslint.totalErrors} ESLint errors.`);
  }

  if (qualityResult?.security && qualityResult.security.vulnerabilities > 0) {
    recommendations.push("Run 'npm audit fix' to address security vulnerabilities.");
  }

  if (qualityResult?.complexity && qualityResult.complexity.highComplexityFiles.length > 0) {
    recommendations.push("Consider refactoring high-complexity functions for better maintainability.");
  }

  if (issues.length === 0) {
    recommendations.push("✅ All checks passed! Ready to merge.");
  }

  return recommendations;
}

// ── Main Review Function ───────────────────────────────────────────

export async function reviewChanges(): Promise<ChangeReviewResult> {
  log.info("Starting code change review");
  const startTime = Date.now();

  // Get git info
  const commitSha = getLastCommitSha();
  const commitMessage = getLastCommitMessage();
  const filesChanged = getFilesChanged();
  const hasChanges = hasMeaningfulChanges(filesChanged);

  // Run tests and quality checks
  let testResult: TestResult | null = null;
  let qualityResult: QualityCheckResult | null = null;

  if (hasChanges) {
    try {
      testResult = await runTests();
    } catch (e) {
      log.error("Test execution failed", { error: (e as Error).message });
      testResult = null;
    }

    try {
      qualityResult = await runQualityCheck();
    } catch (e) {
      log.error("Quality check failed", { error: (e as Error).message });
      qualityResult = null;
    }
  }

  // Detect issues
  const issues = detectIssues(filesChanged, testResult, qualityResult);

  // Determine pass/fail
  const criticalIssues = issues.filter((i) => i.severity === "error");
  const passed = criticalIssues.length === 0 && (!testResult || testResult.passed);

  // Generate recommendations
  const recommendations = generateRecommendations(hasChanges, testResult, qualityResult, issues);

  // Build summary
  const summaryParts: string[] = [];

  if (hasChanges) {
    summaryParts.push(`${filesChanged.length} files changed`);

    if (testResult) {
      summaryParts.push(`${testResult.passedCount}/${testResult.total} tests passed`);
    }

    if (qualityResult?.eslint) {
      summaryParts.push(`${qualityResult.eslint.totalErrors} ESLint errors`);
    }

    summaryParts.push(`${issues.length} issues (${criticalIssues.length} critical)`);
  } else {
    summaryParts.push("No meaningful code changes");
  }

  const summary = summaryParts.join(" | ");

  const durationMs = Date.now() - startTime;
  log.info("Code change review complete", { durationMs, passed, issues: issues.length });

  return {
    passed,
    hasChanges,
    commitSha,
    commitMessage,
    filesChanged,
    testResult,
    qualityResult,
    issues,
    summary,
    recommendations,
  };
}

// ── Formatting ─────────────────────────────────────────────────────

export function formatChangeReview(result: ChangeReviewResult): string {
  const lines: string[] = [
    result.passed ? "✅ Change Review Passed" : "❌ Change Review Failed",
    "",
    `📋 Commit: ${result.commitSha.slice(0, 8)}`,
    `💬 ${result.commitMessage.split("\n")[0]}`,
    "",
  ];

  if (!result.hasChanges) {
    lines.push("📂 No meaningful code changes detected.");
    return lines.join("\n");
  }

  lines.push("📊 Summary:", `   ${result.summary}`, "");

  // Files changed
  if (result.filesChanged.length > 0) {
    lines.push("📁 Files Changed:");
    for (const f of result.filesChanged.slice(0, 10)) {
      const changeIcon = f.status === "added" ? "+" : f.status === "deleted" ? "-" : "~";
      lines.push(`   ${changeIcon} ${f.path} (+${f.additions}/-${f.deletions})`);
    }
    if (result.filesChanged.length > 10) {
      lines.push(`   ... and ${result.filesChanged.length - 10} more`);
    }
    lines.push("");
  }

  // Test results
  if (result.testResult) {
    lines.push(`🧪 Tests: ${result.testResult.passedCount}/${result.testResult.total} passed`);
    if (result.testResult.failed > 0) {
      lines.push(`   ❌ ${result.testResult.failed} failed`);
    }
    if (result.testResult.skipped > 0) {
      lines.push(`   ⏭️ ${result.testResult.skipped} skipped`);
    }
    lines.push("");
  }

  // Quality report summary
  if (result.qualityResult) {
    lines.push(formatQualityReport(result.qualityResult));
    lines.push("");
  }

  // Issues
  if (result.issues.length > 0) {
    lines.push("🔍 Issues Found:");
    for (const issue of result.issues.slice(0, 10)) {
      const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
      const location = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : "";
      lines.push(`   ${icon} [${issue.category}] ${issue.message}${location}`);
    }
    if (result.issues.length > 10) {
      lines.push(`   ... and ${result.issues.length - 10} more issues`);
    }
    lines.push("");
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    lines.push("💡 Recommendations:");
    for (const rec of result.recommendations) {
      lines.push(`   • ${rec}`);
    }
  }

  return lines.join("\n");
}
