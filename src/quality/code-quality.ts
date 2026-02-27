/**
 * Code quality checking module for Jinx
 * Integrates ESLint, complexity analysis, and security scanning
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

export interface QualityCheckResult {
  passed: boolean;
  eslint: EslintResult | null;
  security: SecurityResult | null;
  complexity: ComplexityResult | null;
  summary: string;
}

export interface EslintResult {
  totalErrors: number;
  totalWarnings: number;
  filesChecked: number;
  issues: EslintIssue[];
}

export interface EslintIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  rule: string;
}

export interface SecurityResult {
  vulnerabilities: number;
  summary: string;
  details: string;
}

export interface ComplexityResult {
  highComplexityFiles: ComplexityInfo[];
  averageComplexity: number;
  maxComplexity: number;
}

export interface ComplexityInfo {
  file: string;
  complexity: number;
  function: string;
  line: number;
}

// ── ESLint Check ───────────────────────────────────────────────────

export function runEslintCheck(): EslintResult | null {
  try {
    const output = execSync("npx eslint src/ --format json", {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 60000,
    });

    // If no output, no issues found
    if (!output.trim()) {
      return {
        totalErrors: 0,
        totalWarnings: 0,
        filesChecked: 0,
        issues: [],
      };
    }

    const results = JSON.parse(output) as Array<{
      filePath: string;
      messages: Array<{
        line: number;
        column: number;
        severity: number;
        message: string;
        ruleId: string | null;
      }>;
    }>;

    const issues: EslintIssue[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const result of results) {
      for (const msg of result.messages) {
        const issue: EslintIssue = {
          file: result.filePath.replace(process.cwd(), "."),
          line: msg.line,
          column: msg.column,
          severity: msg.severity === 2 ? "error" : "warning",
          message: msg.message,
          rule: msg.ruleId || "unknown",
        };
        issues.push(issue);

        if (msg.severity === 2) {
          totalErrors++;
        } else {
          totalWarnings++;
        }
      }
    }

    return {
      totalErrors,
      totalWarnings,
      filesChecked: results.length,
      issues: issues.slice(0, 20), // Limit to first 20 issues
    };
  } catch (e) {
    // ESLint exits with non-zero code if there are errors
    const error = e as Error & { stdout?: string };
    if (error.stdout) {
      try {
        const results = JSON.parse(error.stdout) as Array<{
          filePath: string;
          messages: Array<{
            line: number;
            column: number;
            severity: number;
            message: string;
            ruleId: string | null;
          }>;
        }>;

        const issues: EslintIssue[] = [];
        let totalErrors = 0;
        let totalWarnings = 0;

        for (const result of results) {
          for (const msg of result.messages) {
            const issue: EslintIssue = {
              file: result.filePath.replace(process.cwd(), "."),
              line: msg.line,
              column: msg.column,
              severity: msg.severity === 2 ? "error" : "warning",
              message: msg.message,
              rule: msg.ruleId || "unknown",
            };
            issues.push(issue);

            if (msg.severity === 2) {
              totalErrors++;
            } else {
              totalWarnings++;
            }
          }
        }

        return {
          totalErrors,
          totalWarnings,
          filesChecked: results.length,
          issues: issues.slice(0, 20),
        };
      } catch {
        log.error("Failed to parse ESLint output", { error: error.message });
        return null;
      }
    }
    log.error("ESLint check failed", { error: error.message });
    return null;
  }
}

// ── Security Check ─────────────────────────────────────────────────

export function runSecurityCheck(): SecurityResult | null {
  try {
    const output = execSync("npm audit --json", {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 60000,
    });

    const audit = JSON.parse(output) as {
      metadata?: {
        vulnerabilities?: {
          info: number;
          low: number;
          moderate: number;
          high: number;
          critical: number;
          total: number;
        };
      };
    };

    const vulns = audit.metadata?.vulnerabilities || { total: 0, critical: 0, high: 0 };

    return {
      vulnerabilities: vulns.total,
      summary: `Found ${vulns.total} vulnerabilities (${vulns.critical || 0} critical, ${vulns.high || 0} high)`,
      details: JSON.stringify(vulns, null, 2),
    };
  } catch (e) {
    // npm audit exits with non-zero if vulnerabilities found
    const error = e as Error & { stdout?: string };
    if (error.stdout) {
      try {
        const audit = JSON.parse(error.stdout) as {
          metadata?: {
            vulnerabilities?: {
              info: number;
              low: number;
              moderate: number;
              high: number;
              critical: number;
              total: number;
            };
          };
        };

        const vulns = audit.metadata?.vulnerabilities || { total: 0, critical: 0, high: 0 };

        return {
          vulnerabilities: vulns.total,
          summary: `Found ${vulns.total} vulnerabilities (${vulns.critical || 0} critical, ${vulns.high || 0} high)`,
          details: JSON.stringify(vulns, null, 2),
        };
      } catch {
        log.error("Failed to parse npm audit output");
      }
    }
    log.error("Security check failed", { error: (e as Error).message });
    return null;
  }
}

// ── Complexity Analysis ────────────────────────────────────────────

export function runComplexityAnalysis(): ComplexityResult | null {
  try {
    // Use ESLint to find high complexity functions
    const output = execSync(
      'npx eslint src/ --format json --rule "complexity: [error, 10]"',
      {
        encoding: "utf-8",
        cwd: process.cwd(),
        timeout: 60000,
      }
    );

    // Parse complexity issues
    const results = JSON.parse(output) as Array<{
      filePath: string;
      messages: Array<{
        line: number;
        message: string;
        ruleId: string | null;
      }>;
    }>;

    const highComplexityFiles: ComplexityInfo[] = [];
    const complexities: number[] = [];

    for (const result of results) {
      for (const msg of result.messages) {
        if (msg.ruleId === "complexity") {
          // Extract complexity number from message like "Function has a complexity of 15"
          const match = msg.message.match(/complexity of (\d+)/);
          const complexity = match ? parseInt(match[1], 10) : 0;

          // Extract function name from message
          const funcMatch = msg.message.match(/Function '([^']+)'/);
          const funcName = funcMatch ? funcMatch[1] : "anonymous";

          highComplexityFiles.push({
            file: result.filePath.replace(process.cwd(), "."),
            complexity,
            function: funcName,
            line: msg.line,
          });

          complexities.push(complexity);
        }
      }
    }

    const averageComplexity =
      complexities.length > 0
        ? complexities.reduce((a, b) => a + b, 0) / complexities.length
        : 0;

    return {
      highComplexityFiles: highComplexityFiles.slice(0, 10),
      averageComplexity: Math.round(averageComplexity * 10) / 10,
      maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
    };
  } catch (e) {
    // ESLint exits with non-zero if complexity issues found
    const error = e as Error & { stdout?: string };
    if (error.stdout) {
      try {
        const results = JSON.parse(error.stdout) as Array<{
          filePath: string;
          messages: Array<{
            line: number;
            message: string;
            ruleId: string | null;
          }>;
        }>;

        const highComplexityFiles: ComplexityInfo[] = [];
        const complexities: number[] = [];

        for (const result of results) {
          for (const msg of result.messages) {
            if (msg.ruleId === "complexity") {
              const match = msg.message.match(/complexity of (\d+)/);
              const complexity = match ? parseInt(match[1], 10) : 0;

              const funcMatch = msg.message.match(/Function '([^']+)'/);
              const funcName = funcMatch ? funcMatch[1] : "anonymous";

              highComplexityFiles.push({
                file: result.filePath.replace(process.cwd(), "."),
                complexity,
                function: funcName,
                line: msg.line,
              });

              complexities.push(complexity);
            }
          }
        }

        const averageComplexity =
          complexities.length > 0
            ? complexities.reduce((a, b) => a + b, 0) / complexities.length
            : 0;

        return {
          highComplexityFiles: highComplexityFiles.slice(0, 10),
          averageComplexity: Math.round(averageComplexity * 10) / 10,
          maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
        };
      } catch {
        log.error("Failed to parse complexity output");
      }
    }
    // No complexity issues found is also a valid result
    return {
      highComplexityFiles: [],
      averageComplexity: 0,
      maxComplexity: 0,
    };
  }
}

// ── Main Quality Check ─────────────────────────────────────────────

export async function runQualityCheck(): Promise<QualityCheckResult> {
  log.info("Starting code quality check");

  const eslint = runEslintCheck();
  const security = runSecurityCheck();
  const complexity = runComplexityAnalysis();

  const hasEslintErrors = eslint && eslint.totalErrors > 0;
  const hasCriticalVulns = security && security.vulnerabilities > 0;
  const hasHighComplexity = complexity && complexity.highComplexityFiles.length > 0;

  const passed = !hasEslintErrors;

  // Build summary
  const summaryParts: string[] = [];

  if (eslint) {
    summaryParts.push(
      `ESLint: ${eslint.totalErrors} errors, ${eslint.totalWarnings} warnings (${eslint.filesChecked} files)`
    );
  } else {
    summaryParts.push("ESLint: check failed");
  }

  if (security) {
    summaryParts.push(`Security: ${security.summary}`);
  } else {
    summaryParts.push("Security: check failed");
  }

  if (complexity) {
    if (complexity.highComplexityFiles.length > 0) {
      summaryParts.push(
        `Complexity: ${complexity.highComplexityFiles.length} high-complexity functions (max: ${complexity.maxComplexity})`
      );
    } else {
      summaryParts.push("Complexity: All functions within limits");
    }
  } else {
    summaryParts.push("Complexity: check failed");
  }

  const summary = summaryParts.join(" | ");

  log.info("Code quality check complete", {
    passed,
    hasErrors: hasEslintErrors,
    hasVulns: hasCriticalVulns,
    hasComplexity: hasHighComplexity,
  });

  return {
    passed,
    eslint,
    security,
    complexity,
    summary,
  };
}

// ── Formatting ─────────────────────────────────────────────────────

export function formatQualityReport(result: QualityCheckResult): string {
  const lines: string[] = [
    result.passed ? "✅ Code Quality Check Passed" : "❌ Code Quality Check Failed",
    "",
    "📊 Summary:",
    `   ${result.summary}`,
    "",
  ];

  if (result.eslint && result.eslint.totalErrors > 0) {
    lines.push("🚨 ESLint Errors:");
    for (const issue of result.eslint.issues.filter((i) => i.severity === "error").slice(0, 5)) {
      lines.push(`   ${issue.file}:${issue.line} - ${issue.message} (${issue.rule})`);
    }
    if (result.eslint.totalErrors > 5) {
      lines.push(`   ... and ${result.eslint.totalErrors - 5} more errors`);
    }
    lines.push("");
  }

  if (result.eslint && result.eslint.totalWarnings > 0) {
    lines.push("⚠️ ESLint Warnings:");
    for (const issue of result.eslint.issues.filter((i) => i.severity === "warning").slice(0, 3)) {
      lines.push(`   ${issue.file}:${issue.line} - ${issue.message}`);
    }
    if (result.eslint.totalWarnings > 3) {
      lines.push(`   ... and ${result.eslint.totalWarnings - 3} more warnings`);
    }
    lines.push("");
  }

  if (result.security && result.security.vulnerabilities > 0) {
    lines.push("🔒 Security:");
    lines.push(`   ${result.security.summary}`);
    lines.push("   Run 'npm audit fix' to attempt automatic fixes");
    lines.push("");
  }

  if (result.complexity && result.complexity.highComplexityFiles.length > 0) {
    lines.push("📈 High Complexity Functions:");
    for (const info of result.complexity.highComplexityFiles.slice(0, 5)) {
      lines.push(`   ${info.file}:${info.line} - ${info.function} (complexity: ${info.complexity})`);
    }
    if (result.complexity.highComplexityFiles.length > 5) {
      lines.push(`   ... and ${result.complexity.highComplexityFiles.length - 5} more`);
    }
  }

  return lines.join("\n");
}
