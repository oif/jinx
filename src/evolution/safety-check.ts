import { checkHealth, type HealthStatus } from "../health/check.js";
import { log } from "../util/log.js";
import { isCircuitBreakerOpen } from "../consciousness/circuit-breaker.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ── Configuration ────────────────────────────────────────────────────────

const MIN_DISK_FREE_GB = 1;
const MIN_MEMORY_FREE_MB = 100;
const MAX_CPU_LOAD_PERCENT = 90;
const TEST_COMMAND = "pnpm test";
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

// ── Helper Functions ──────────────────────────────────────────────────────

function createDiskCheck(health: HealthStatus, minDiskGB: number): ConstraintCheck {
  const diskFreeGB = (health.disk.size - health.disk.used) / (1024 * 1024 * 1024);
  const passed = diskFreeGB >= minDiskGB;
  return {
    passed,
    value: Math.round(diskFreeGB * 100) / 100,
    threshold: minDiskGB,
    message: passed
      ? `Disk space OK: ${diskFreeGB.toFixed(2)}GB free (>= ${minDiskGB}GB)`
      : `Disk space LOW: ${diskFreeGB.toFixed(2)}GB free (< ${minDiskGB}GB)`,
  };
}

function createMemoryCheck(health: HealthStatus, minMemMB: number): ConstraintCheck {
  const memoryFreeMB = health.memory.free / (1024 * 1024);
  const passed = memoryFreeMB >= minMemMB;
  return {
    passed,
    value: Math.round(memoryFreeMB),
    threshold: minMemMB,
    message: passed
      ? `Memory OK: ${Math.round(memoryFreeMB)}MB free (>= ${minMemMB}MB)`
      : `Memory LOW: ${Math.round(memoryFreeMB)}MB free (< ${minMemMB}MB)`,
  };
}

function createCpuCheck(health: HealthStatus, maxCpu: number): ConstraintCheck {
  const passed = health.cpu.loadPercent < maxCpu;
  return {
    passed,
    value: health.cpu.loadPercent,
    threshold: maxCpu,
    message: passed
      ? `CPU OK: ${health.cpu.loadPercent.toFixed(1)}% (< ${maxCpu}%)`
      : `CPU HIGH: ${health.cpu.loadPercent.toFixed(1)}% (>= ${maxCpu}%)`,
  };
}

function createCircuitBreakerCheck(): ConstraintCheck {
  const isOpen = isCircuitBreakerOpen();
  return {
    passed: !isOpen,
    value: isOpen ? 1 : 0,
    threshold: 0,
    message: isOpen
      ? "Circuit breaker OPEN - recent failures detected"
      : "Circuit breaker CLOSED - system stable",
  };
}

function buildEndureFailedResult(err: Error, minDiskGB: number, minMemMB: number, maxCpu: number): EndureResult {
  return {
    passed: false,
    timestamp: new Date().toISOString(),
    checks: {
      disk: { passed: false, value: 0, threshold: minDiskGB, message: `Exception: ${err.message}` },
      memory: { passed: false, value: 0, threshold: minMemMB, message: `Exception: ${err.message}` },
      cpu: { passed: false, value: 100, threshold: maxCpu, message: `Exception: ${err.message}` },
      circuitBreaker: { passed: true, value: 0, threshold: 0, message: "Not checked" },
    },
    reason: `Endure check failed with exception: ${err.message}`,
  };
}

function logEndureResult(result: EndureResult): void {
  if (!result.passed) {
    log.warn("Endure check FAILED - evolution blocked", {
      checks: result.checks,
      reason: result.reason,
    });
  } else {
    log.info("Endure check PASSED - evolution allowed", {
      disk: `${result.checks.disk.value}GB free`,
      memory: `${result.checks.memory.value}MB free`,
      cpu: `${result.checks.cpu.value}%`,
    });
  }
}

// ── Endure Check (SEA Law #1) ─────────────────────────────────────────────

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
    const result = buildEndureFailedResult(err, minDiskGB, minMemMB, maxCpu);
    logEndureResult(result);
    return result;
  }

  const diskCheck = createDiskCheck(health, minDiskGB);
  const memoryCheck = createMemoryCheck(health, minMemMB);
  const cpuCheck = createCpuCheck(health, maxCpu);
  const circuitBreakerCheck = createCircuitBreakerCheck();

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
    const failedChecks = [diskCheck, memoryCheck, cpuCheck, circuitBreakerCheck]
      .filter(c => !c.passed)
      .map(c => c.message);
    result.reason = `Endure check failed: ${failedChecks.join("; ")}`;
  }

  logEndureResult(result);
  return result;
}

// ── Excel Check Helpers ───────────────────────────────────────────────────

async function runBuildCheck(): Promise<ConstraintCheck> {
  try {
    log.info("Excel check: Running build...");
    await execAsync(BUILD_COMMAND, { timeout: 60000 });
    log.info("Excel check: Build PASSED");
    return { passed: true, value: 0, threshold: 0, message: "Build passed" };
  } catch (e) {
    const err = e as Error & { stderr?: string; stdout?: string };
    const output = err.stderr || err.stdout || err.message;
    log.error("Excel check: Build FAILED", { error: output.slice(0, 500) });
    return { passed: false, value: 1, threshold: 0, message: `Build failed: ${output.slice(0, 200)}` };
  }
}

async function runTestCheck(testTimeout: number): Promise<{ check: ConstraintCheck; output: string }> {
  try {
    log.info("Excel check: Running tests...");
    const result = await execAsync(TEST_COMMAND, { timeout: testTimeout });
    log.info("Excel check: Tests PASSED");
    return {
      check: { passed: true, value: 0, threshold: 0, message: "All tests passed" },
      output: result.stdout,
    };
  } catch (e) {
    const err = e as Error & { stderr?: string; stdout?: string };
    const output = err.stderr || err.stdout || err.message;
    const hasPassed = output.includes("passed") && !output.includes("failed");
    log.error("Excel check: Tests FAILED", { error: output.slice(0, 500) });
    return {
      check: { passed: hasPassed, value: hasPassed ? 0 : 1, threshold: 0, message: hasPassed ? "Tests passed" : `Tests failed: ${output.slice(0, 200)}` },
      output,
    };
  }
}

// ── Excel Check (SEA Law #2) ──────────────────────────────────────────────

export async function checkExcelConstraints(options?: {
  skipBuild?: boolean;
  skipTests?: boolean;
  testTimeout?: number;
}): Promise<ExcelResult> {
  const skipBuild = options?.skipBuild ?? false;
  const skipTests = options?.skipTests ?? false;
  const testTimeout = options?.testTimeout ?? 120000;

  const checks: ExcelResult["checks"] = {
    build: { passed: true, value: 0, threshold: 0, message: "Skipped" },
    tests: { passed: true, value: 0, threshold: 0, message: "Skipped" },
  };

  // Run build check
  if (!skipBuild) {
    checks.build = await runBuildCheck();
    if (!checks.build.passed) {
      return {
        passed: false,
        timestamp: new Date().toISOString(),
        checks,
        reason: `Excel check failed: Build failed - cannot proceed with tests`,
      };
    }
  }

  // Run test check
  if (!skipTests) {
    const { check, output } = await runTestCheck(testTimeout);
    checks.tests = check;
    if (!check.passed) {
      return {
        passed: false,
        timestamp: new Date().toISOString(),
        checks,
        reason: `Excel check failed: Tests failed`,
        testOutput: output,
      };
    }
  }

  log.info("Excel check PASSED - commit allowed");
  return { passed: true, timestamp: new Date().toISOString(), checks };
}

// ── Combined Safety Check ────────────────────────────────────────────────

export async function performSafetyCheck(options?: {
  skipExcel?: boolean;
  minDiskFreeGB?: number;
  minMemoryFreeMB?: number;
  maxCpuLoadPercent?: number;
}): Promise<SafetyCheckResult> {
  const endure = await checkEndureConstraints({
    minDiskFreeGB: options?.minDiskFreeGB,
    minMemoryFreeMB: options?.minMemoryFreeMB,
    maxCpuLoadPercent: options?.maxCpuLoadPercent,
  });

  if (!endure.passed) {
    return { endure, canProceed: false, blockedBy: "endure" };
  }

  return { endure, canProceed: true };
}

// ── Utility Functions ─────────────────────────────────────────────────────

export function formatSafetyCheckResult(result: SafetyCheckResult): string {
  const lines: string[] = [];
  lines.push("╔════════════════════════════════════════╗");
  lines.push("║     SEA Safety Check Report           ║");
  lines.push("╚════════════════════════════════════════╝");
  lines.push("");
  lines.push("🔹 ENDURE CHECK (System Health)");
  lines.push(`   Status: ${result.endure.passed ? "✅ PASSED" : "❌ FAILED"}`);
  lines.push(`   Disk:   ${result.endure.checks.disk.message}`);
  lines.push(`   Memory: ${result.endure.checks.memory.message}`);
  lines.push(`   CPU:    ${result.endure.checks.cpu.message}`);
  lines.push(`   CB:     ${result.endure.checks.circuitBreaker.message}`);

  if (result.excel) {
    lines.push("");
    lines.push("🔹 EXCEL CHECK (Performance)");
    lines.push(`   Status: ${result.excel.passed ? "✅ PASSED" : "❌ FAILED"}`);
    lines.push(`   Build:  ${result.excel.checks.build.message}`);
    lines.push(`   Tests:  ${result.excel.checks.tests.message}`);
  }

  lines.push("");
  lines.push("────────────────────────────────────────");
  lines.push(`📋 VERDICT: ${result.canProceed ? "✅ EVOLUTION ALLOWED" : `🚫 BLOCKED BY ${result.blockedBy?.toUpperCase()}`}`);

  return lines.join("\n");
}

export default {
  checkEndureConstraints,
  checkExcelConstraints,
  performSafetyCheck,
  formatSafetyCheckResult,
};