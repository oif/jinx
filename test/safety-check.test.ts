import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkEndureConstraints,
  checkExcelConstraints,
  performSafetyCheck,
  formatSafetyCheckResult,
  type EndureResult,
  type ExcelResult,
  type SafetyCheckResult,
} from "../src/evolution/safety-check.js";

// Mock dependencies
vi.mock("../src/health/check.js", () => ({
  checkHealth: vi.fn(),
}));

vi.mock("../src/consciousness/circuit-breaker.js", () => ({
  isCircuitBreakerOpen: vi.fn(() => false),
}));

vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { checkHealth } from "../src/health/check.js";
import { isCircuitBreakerOpen } from "../src/consciousness/circuit-breaker.js";

describe("Safety Check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkEndureConstraints", () => {
    it("should pass when all constraints are satisfied", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 30 },
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);
      vi.mocked(isCircuitBreakerOpen).mockReturnValue(false);

      const result = await checkEndureConstraints();

      expect(result.passed).toBe(true);
      expect(result.checks.disk.passed).toBe(true);
      expect(result.checks.memory.passed).toBe(true);
      expect(result.checks.cpu.passed).toBe(true);
      expect(result.checks.circuitBreaker.passed).toBe(true);
    });

    it("should fail when disk space is low", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 30 },
        disk: { size: 1000000000, used: 900000000, usedPercent: 90 }, // Only 100MB free
        uptime: 100,
      } as any);

      const result = await checkEndureConstraints();

      expect(result.passed).toBe(false);
      expect(result.checks.disk.passed).toBe(false);
      expect(result.reason).toContain("Disk space LOW");
    });

    it("should fail when memory is low", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 1000000000, free: 50000000, usedPercent: 95 }, // Only 50MB free
        cpu: { loadPercent: 30 },
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);

      const result = await checkEndureConstraints();

      expect(result.passed).toBe(false);
      expect(result.checks.memory.passed).toBe(false);
      expect(result.reason).toContain("Memory LOW");
    });

    it("should fail when CPU load is high", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 95 }, // High CPU
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);

      const result = await checkEndureConstraints();

      expect(result.passed).toBe(false);
      expect(result.checks.cpu.passed).toBe(false);
      expect(result.reason).toContain("CPU HIGH");
    });

    it("should fail when circuit breaker is open", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 30 },
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);
      vi.mocked(isCircuitBreakerOpen).mockReturnValue(true);

      const result = await checkEndureConstraints();

      expect(result.passed).toBe(false);
      expect(result.checks.circuitBreaker.passed).toBe(false);
      expect(result.reason).toContain("Circuit breaker OPEN");
    });

    it("should handle health check errors gracefully", async () => {
      vi.mocked(checkHealth).mockRejectedValue(new Error("Health check failed"));

      const result = await checkEndureConstraints();

      expect(result.passed).toBe(false);
      expect(result.reason).toContain("exception");
    });

    it("should use custom thresholds", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 200000000, usedPercent: 98 }, // 200MB free
        cpu: { loadPercent: 60 },
        disk: { size: 500000000000, used: 498000000000, usedPercent: 99.6 }, // ~2GB free
        uptime: 100,
      } as any);

      const result = await checkEndureConstraints({
        minDiskFreeGB: 5, // Require 5GB
        minMemoryFreeMB: 300, // Require 300MB
        maxCpuLoadPercent: 50, // Max 50% CPU
      });

      expect(result.passed).toBe(false);
      expect(result.checks.disk.passed).toBe(false); // 2GB < 5GB
      expect(result.checks.memory.passed).toBe(false); // 200MB < 300MB
      expect(result.checks.cpu.passed).toBe(false); // 60% > 50%
    });
  });

  describe("checkExcelConstraints", () => {
    it("should pass when build and tests are skipped", async () => {
      const result = await checkExcelConstraints({ skipBuild: true, skipTests: true });

      expect(result.passed).toBe(true);
      expect(result.checks.build.message).toBe("Skipped");
      expect(result.checks.tests.message).toBe("Skipped");
    });

    it("should have timestamp in result", async () => {
      const result = await checkExcelConstraints({ skipBuild: true, skipTests: true });

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe("performSafetyCheck", () => {
    it("should return canProceed: true when endure passes", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 30 },
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);
      vi.mocked(isCircuitBreakerOpen).mockReturnValue(false);

      const result = await performSafetyCheck();

      expect(result.canProceed).toBe(true);
      expect(result.blockedBy).toBeUndefined();
    });

    it("should return canProceed: false when endure fails", async () => {
      vi.mocked(checkHealth).mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 95 }, // High CPU
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);

      const result = await performSafetyCheck();

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe("endure");
    });
  });

  describe("formatSafetyCheckResult", () => {
    it("should format passed result correctly", () => {
      const result: SafetyCheckResult = {
        endure: {
          passed: true,
          timestamp: "2024-01-01T00:00:00Z",
          checks: {
            disk: { passed: true, value: 10, threshold: 1, message: "Disk OK" },
            memory: { passed: true, value: 500, threshold: 100, message: "Memory OK" },
            cpu: { passed: true, value: 30, threshold: 90, message: "CPU OK" },
            circuitBreaker: { passed: true, value: 0, threshold: 0, message: "CB CLOSED" },
          },
        },
        canProceed: true,
      };

      const formatted = formatSafetyCheckResult(result);

      expect(formatted).toContain("SEA Safety Check Report");
      expect(formatted).toContain("ENDURE CHECK");
      expect(formatted).toContain("✅ PASSED");
      expect(formatted).toContain("EVOLUTION ALLOWED");
    });

    it("should format failed result correctly", () => {
      const result: SafetyCheckResult = {
        endure: {
          passed: false,
          timestamp: "2024-01-01T00:00:00Z",
          checks: {
            disk: { passed: false, value: 0.5, threshold: 1, message: "Disk LOW" },
            memory: { passed: true, value: 500, threshold: 100, message: "Memory OK" },
            cpu: { passed: true, value: 30, threshold: 90, message: "CPU OK" },
            circuitBreaker: { passed: true, value: 0, threshold: 0, message: "CB CLOSED" },
          },
          reason: "Disk space LOW",
        },
        canProceed: false,
        blockedBy: "endure",
      };

      const formatted = formatSafetyCheckResult(result);

      expect(formatted).toContain("❌ FAILED");
      expect(formatted).toContain("BLOCKED BY ENDURE");
    });

    it("should include excel check when present", () => {
      const result: SafetyCheckResult = {
        endure: {
          passed: true,
          timestamp: "2024-01-01T00:00:00Z",
          checks: {
            disk: { passed: true, value: 10, threshold: 1, message: "Disk OK" },
            memory: { passed: true, value: 500, threshold: 100, message: "Memory OK" },
            cpu: { passed: true, value: 30, threshold: 90, message: "CPU OK" },
            circuitBreaker: { passed: true, value: 0, threshold: 0, message: "CB CLOSED" },
          },
        },
        excel: {
          passed: true,
          timestamp: "2024-01-01T00:00:00Z",
          checks: {
            build: { passed: true, value: 0, threshold: 0, message: "Build passed" },
            tests: { passed: true, value: 0, threshold: 0, message: "Tests passed" },
          },
        },
        canProceed: true,
      };

      const formatted = formatSafetyCheckResult(result);

      expect(formatted).toContain("EXCEL CHECK");
      expect(formatted).toContain("Build passed");
      expect(formatted).toContain("Tests passed");
    });
  });
});