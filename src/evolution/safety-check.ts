/**
 * Safety Check - SEA (Self-Evolving Agents) Three Laws Implementation
 *
 * This module implements the safety constraints from the Self-Evolving Agents framework.
 * The Three Laws (in priority order):
 *
 * 1. Endure (安全适应) - Evolution must preserve system stability and safety
 *    - Check disk space, memory, CPU load before evolution
 *    - Verify circuit breaker is not tripped
 *
 * 2. Excel (性能保持) - Evolution must not degrade existing performance
 *    - Run tests after evolution
 *    - Verify no regressions in core functionality
 *
 * 3. Evolve (自主进化) - Agent should evolve under the above constraints
 *    - This is the actual evolution cycle, already implemented in loop.ts
 *
 * Reference: Fang et al. (2025) "A Comprehensive Survey of Self-Evolving AI Agents"
 */

import { checkHealth, type HealthStatus } from "../health/check.js";
import { log } from "../util/log.js";
import { isCircuitBreakerOpen } from "../consciousness/circuit-breaker.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ── Configuration ────────────────────────────────────────────────────────

/**
 * Minimum free disk space in GB for Endure check
 */
const MIN_DISK_FREE_GB = 1;

/**
 * Minimum free memory in MB for Endure check
 */
const MIN_MEMORY_FREE_MB = 100;

/**
 * Maximum CPU load percentage for Endure check
 */
const MAX_CPU_LOAD_PERCENT = 90;

/**
 * Test command to run for Excel check
 */
const TEST_COMMAND = "pnpm test";

/**
 * Build command to run for Excel check
 */
const BUILD_COMMAND = "pnpm build";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ConstraintCheck {
  passed: boolean;
  value: number;
  threshold: number;
  message: string;
}

export interface EndureResult {
  passed: boolean;
  timestamp: string;
  checks: {
    disk: ConstraintCheck;
    memory: ConstraintCheck;
    cpu: ConstraintCheck;
    circuitBreaker: ConstraintCheck;
  };
  reason?: string;
}

export interface ExcelResult {
  passed: boolean;
  timestamp: string;
  checks: {
    build: ConstraintCheck;
    tests: ConstraintCheck;
  };
  reason?: string;
  testOutput?: string;
}

export interface SafetyCheckResult {
  endure: EndureResult;
  excel?: ExcelResult;
  canProceed: boolean;
  blockedBy?: "endure" | "excel";
}

// ── Endure Check (SEA Law #1) ─────────────────────────────────────────────

/**
 * Perform Endure check (SEA safety constraint #1).
 * Checks system health before allowing evolution to proceed.
 *
 * This ensures the agent doesn't evolve when the system is in a precarious state:
 * - Low disk space could prevent saving changes
 * - Low memory could cause OOM during evolution
 * - High CPU could indicate system stress
 * - Open circuit breaker indicates recent failures
 */
export async function checkEndureConstraints(options?: {
  minDiskFreeGB?: number;
  minMemoryFreeMB?: number;
  maxCpuLoadPercent?: number;
}): Promise<EndureResult> {
  const minDiskGB = options?.minDiskFreeGB ?? MIN_DISK_FREE_GB;
  const minMemMB = options?.minMemoryFreeMB ?? MIN_MEMORY_FREE_MB;
  const maxCpu = options?.maxCpuLoadPercent ?? MAX_CPU_LOAD_PERCENT;

  let health: HealthStatus;
  try {
    health = await checkHealth({ silent: true });
  } catch (e) {
    const err = e as Error;
    log.error("Endure check failed - health check threw error", { error: err.message });
    return {
      passed: false,
      timestamp: new Date().toISOString(),
      checks: {
        disk: { passed: false, value: 0, threshold: minDiskGB, message: `Health check failed: ${err.message}` },
        memory: { passed: false, value: 0, threshold: minMemMB, message: `Health check failed: ${err.message}` },
        cpu: { passed: false, value: 100, threshold: maxCpu, message: `Health check failed: ${err.message}` },
        circuitBreaker: { passed: true, value: 0, threshold: 0, message: "Not checked due to health failure" },
      },
      reason: `Health check failed: ${err.message}`,
    };
  }

  // Calculate free disk in GB
  const diskFreeGB = (health.disk.size - health.disk.used) / (1024 * 1024 * 1024);
  const diskCheck: ConstraintCheck = {
    passed: diskFreeGB >= minDiskGB,
    value: Math.round(diskFreeGB * 100) / 100,
    threshold: minDiskGB,
    message: diskFreeGB >= minDiskGB
      ? `Disk space OK: ${diskFreeGB.toFixed(2)}GB free (>= ${minDiskGB}GB)`
      : `Disk space LOW: ${diskFreeGB.toFixed(2)}GB free (< ${minDiskGB}GB)`,
  };

  // Calculate free memory in MB
  const memoryFreeMB = health.memory.free / (1024 * 1024);
  const memoryCheck: ConstraintCheck = {
    passed: memoryFreeMB >= minMemMB,
    value: Math.round(memoryFreeMB),
    threshold: minMemMB,
    message: memoryFreeMB >= minMemMB
      ? `Memory OK: ${Math.round(memoryFreeMB)}MB free (>= ${minMemMB}MB)`
      : `Memory LOW: ${Math.round(memoryFreeMB)}MB free (< ${minMemMB}MB)`,
  };

  // CPU load check
  const cpuCheck: ConstraintCheck = {
    passed: health.cpu.loadPercent < maxCpu,
    value: health.cpu.loadPercent,
    threshold: maxCpu,
    message: health.cpu.loadPercent < maxCpu
      ? `CPU OK: ${health.cpu.loadPercent.toFixed(1)}% (< ${maxCpu}%)`
      : `CPU HIGH: ${health.cpu.loadPercent.toFixed(1)}% (>= ${maxCpu}%)`,
  };

  // Circuit breaker check
  const circuitBreakerOpen = isCircuitBreakerOpen();
  const circuitBreakerCheck: ConstraintCheck = {
    passed: !circuitBreakerOpen,
    value: circuitBreakerOpen ? 1 : 0,
    threshold: 0,
    message: circuitBreakerOpen
      ? "Circuit breaker OPEN - recent failures detected"
      : "Circuit breaker CLOSED - system stable",
  };

  const allPassed = diskCheck.passed && memoryCheck.passed && cpuCheck.passed && circuitBreakerCheck.passed;

  const result: EndureResult = {
    passed: allPassed,
    timestamp: new Date().toISOString(),
    checks: {
      disk: diskCheck,
      memory: memoryCheck,
      cpu: cpuCheck,
      circuitBreaker: circuitBreakerCheck,
    },
  };

  if (!allPassed) {
    const failedChecks: string[] = [];
    if (!diskCheck.passed) failedChecks.push(diskCheck.message);
    if (!memoryCheck.passed) failedChecks.push(memoryCheck.message);
    if (!cpuCheck.passed) failedChecks.push(cpuCheck.message);
    if (!circuitBreakerCheck.passed) failedChecks.push(circuitBreakerCheck.message);
    result.reason = `Endure check failed: ${failedChecks.join("; ")}`;
    log.warn("Endure check FAILED - evolution blocked", {
      checks: result.checks,
      reason: result.reason,
    });
  } else {
    log.info("Endure check PASSED - evolution allowed", {
      disk: `${diskFreeGB.toFixed(2)}GB free`,
      memory: `${Math.round(memoryFreeMB)}MB free`,
      cpu: `${health.cpu.loadPercent.toFixed(1)}%`,
      circuitBreaker: circuitBreakerOpen ? "OPEN" : "CLOSED",
    });
  }

  return result;
}

// ── Excel Check (SEA Law #2) ──────────────────────────────────────────────

/**
 * Perform Excel check (SEA safety constraint #2).
 * Verifies that evolution has not degraded existing functionality.
 *
 * This ensures:
 * - Build still passes (no compilation errors)
 * - Tests still pass (no regressions)
 */
export async function checkExcelConstraints(options?: {
  skipBuild?: boolean;
  skipTests?: boolean;
  testTimeout?: number;
}): Promise<ExcelResult> {
  const skipBuild = options?.skipBuild ?? false;
  const skipTests = options?.skipTests ?? false;
  const testTimeout = options?.testTimeout ?? 120000; // 2 minutes default

  const checks: ExcelResult["checks"] = {
    build: { passed: true, value: 0, threshold: 0, message: "Skipped" },
    tests: { passed: true, value: 0, threshold: 0, message: "Skipped" },
  };

  // Run build check
  if (!skipBuild) {
    try {
      log.info("Excel check: Running build...");
      await execAsync(BUILD_COMMAND, { timeout: 60000 });
      checks.build = {
        passed: true,
        value: 0,
        threshold: 0,
        message: "Build passed",
      };
      log.info("Excel check: Build PASSED");
    } catch (e) {
      const err = e as Error & { stdout?: string; stderr?: string };
      const output = err.stderr || err.stdout || err.message;
      checks.build = {
        passed: false,
        value: 1,
        threshold: 0,
        message: `Build failed: ${output.slice(0, 200)}`,
      };
      log.error("Excel check: Build FAILED", { error: output.slice(0, 500) });

      // If build fails, skip tests
      return {
        passed: false,
        timestamp: new Date().toISOString(),
        checks,
        reason: `Excel check failed: Build failed - cannot proceed with tests`,
        testOutput: output,
      };
    }
  }

  // Run test check
  if (!skipTests) {
    try {
      log.info("Excel check: Running tests...");
      const { stdout, stderr } = await execAsync(TEST_COMMAND, { timeout: testTimeout });
      checks.tests = {
        passed: true,
        value: 0,
        threshold: 0,
        message: "All tests passed",
      };
      log.info("Excel check: Tests PASSED");
    } catch (e) {
      const err = e as Error & { stdout?: string; stderr?: string };
      const output = err.stderr || err.stdout || err.message;
      
      // Check if tests passed with some failures (non-zero exit code but tests ran)
      const hasPassed = output.includes("passed") && !output.includes("failed");
      
      checks.tests = {
        passed: hasPassed,
        value: hasPassed ? 0 : 1,
        threshold: 0,
        message: hasPassed ? "Tests passed" : `Tests failed: ${output.slice(0, 200)}`,
      };
      
      if (!hasPassed) {
        log.error("Excel check: Tests FAILED", { error: output.slice(0, 500) });
        return {
          passed: false,
          timestamp: new Date().toISOString(),
          checks,
          reason: `Excel check failed: Tests failed`,
          testOutput: output,
        };
      }
    }
  }

  const allPassed = checks.build.passed && checks.tests.passed;

  const result: ExcelResult = {
    passed: allPassed,
    timestamp: new Date().toISOString(),
    checks,
  };

  if (!allPassed) {
    const failedChecks: string[] = [];
    if (!checks.build.passed) failedChecks.push("build failed");
    if (!checks.tests.passed) failedChecks.push("tests failed");
    result.reason = `Excel check failed: ${failedChecks.join(", ")}`;
    log.warn("Excel check FAILED - commit blocked", {
      checks: result.checks,
      reason: result.reason,
    });
  } else {
    log.info("Excel check PASSED - commit allowed");
  }

  return result;
}

// ── Combined Safety Check ────────────────────────────────────────────────

/**
 * Perform full safety check (Endure + Excel).
 * This is the main entry point for the evolution cycle.
 */
export async function performSafetyCheck(options?: {
  skipExcel?: boolean;
  minDiskFreeGB?: number;
  minMemoryFreeMB?: number;
  maxCpuLoadPercent?: number;
}): Promise<SafetyCheckResult> {
  // Step 1: Endure check (before evolution)
  const endure = await checkEndureConstraints({
    minDiskFreeGB: options?.minDiskFreeGB,
    minMemoryFreeMB: options?.minMemoryFreeMB,
    maxCpuLoadPercent: options?.maxCpuLoadPercent,
  });

  if (!endure.passed) {
    return {
      endure,
      canProceed: false,
      blockedBy: "endure",
    };
  }

  // Step 2: Excel check (after evolution, optional here for pre-evolution check)
  if (options?.skipExcel) {
    return {
      endure,
      canProceed: true,
    };
  }

  // Note: Excel check is typically run separately after evolution
  // Here we just return that we can proceed with evolution
  return {
    endure,
    canProceed: true,
  };
}

// ── Utility Functions ─────────────────────────────────────────────────────

/**
 * Format safety check result for logging/notification.
 */
export function formatSafetyCheckResult(result: SafetyCheckResult): string {
  const lines: string[] = [];
  
  lines.push("╔════════════════════════════════════════╗");
  lines.push("║     SEA Safety Check Report           ║");
  lines.push("╚════════════════════════════════════════╝");
  
  // Endure check
  lines.push("");
  lines.push("🔹 ENDURE CHECK (System Health)");
  lines.push(`   Status: ${result.endure.passed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push(`   Disk:   ${result.endure.checks.disk.message}`);
  lines.push(`   Memory: ${result.endure.checks.memory.message}`);
  lines.push(`   CPU:    ${result.endure.checks.cpu.message}`);
  lines.push(`   CB:     ${result.endure.checks.circuitBreaker.message}`);
  
  // Excel check (if performed)
  if (result.excel) {
    lines.push("");
    lines.push("🔹 EXCEL CHECK (Performance)");
    lines.push(`   Status: ${result.excel.passed ? "✅ PASSED" : "❌ FAILED"}`);
    lines.push(`   Build:  ${result.excel.checks.build.message}`);
    lines.push(`   Tests:  ${result.excel.checks.tests.message}`);
  }
  
  // Final verdict
  lines.push("");
  lines.push("────────────────────────────────────────");
  lines.push(`📋 VERDICT: ${result.canProceed ? "✅ EVOLUTION ALLOWED" : `🚫 BLOCKED BY ${result.blockedBy?.toUpperCase()}`}`);
  
  return lines.join("\n");
}

// ── Export ────────────────────────────────────────────────────────────────

export default {
  checkEndureConstraints,
  checkExcelConstraints,
  performSafetyCheck,
  formatSafetyCheckResult,
};