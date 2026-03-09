/**
 * Tests for Auto Evolution Module
 * 
 * Tests the automatic evolution triggering with safety constraints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module
vi.mock("../src/health/check.js", () => ({
  checkHealth: vi.fn(),
}));

vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/util/state.js", () => ({
  readState: vi.fn(() => ({ cycle: 100 })),
}));

vi.mock("../src/consciousness/circuit-breaker.js", () => ({
  getCircuitBreakerPauseMs: vi.fn(() => 0),
  isCircuitBreakerOpen: vi.fn(() => false),
}));

import {
  performEndureCheck,
  isAutoEvolutionEnabled,
  getEvolutionIntervalMs,
  getAutoEvolutionStatus,
  startAutoEvolution,
  stopAutoEvolution,
  testEndureCheck,
  resetAutoEvolutionCounters,
  type AutoEvolutionConfig,
  type EndureResult,
} from "../src/consciousness/auto-evolution.js";

import { checkHealth } from "../src/health/check.js";
import { isCircuitBreakerOpen } from "../src/consciousness/circuit-breaker.js";

const mockCheckHealth = vi.mocked(checkHealth);
const mockIsCircuitBreakerOpen = vi.mocked(isCircuitBreakerOpen);

describe("Auto Evolution", () => {
  const defaultConfig: AutoEvolutionConfig = {
    triggerEvolution: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetAutoEvolutionCounters();
    
    // Default healthy state
    mockCheckHealth.mockResolvedValue({
      status: "healthy",
      memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
      cpu: { loadPercent: 30 },
      disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
      uptime: 100,
    } as any);
    
    mockIsCircuitBreakerOpen.mockReturnValue(false);
    
    // Reset env
    delete process.env.AUTO_EVOLUTION_ENABLED;
    delete process.env.AUTO_EVOLUTION_INTERVAL_MS;
  });

  afterEach(() => {
    stopAutoEvolution();
    vi.useRealTimers();
  });

  describe("isAutoEvolutionEnabled", () => {
    it("should return true by default", () => {
      expect(isAutoEvolutionEnabled()).toBe(true);
    });

    it("should return false when AUTO_EVOLUTION_ENABLED=false", () => {
      process.env.AUTO_EVOLUTION_ENABLED = "false";
      expect(isAutoEvolutionEnabled()).toBe(false);
    });

    it("should return true when AUTO_EVOLUTION_ENABLED=true", () => {
      process.env.AUTO_EVOLUTION_ENABLED = "true";
      expect(isAutoEvolutionEnabled()).toBe(true);
    });
  });

  describe("getEvolutionIntervalMs", () => {
    it("should return default interval (1 hour)", () => {
      expect(getEvolutionIntervalMs()).toBe(60 * 60 * 1000);
    });

    it("should return custom interval from env", () => {
      process.env.AUTO_EVOLUTION_INTERVAL_MS = "1800000"; // 30 min
      expect(getEvolutionIntervalMs()).toBe(1800000);
    });

    it("should ignore invalid env values", () => {
      process.env.AUTO_EVOLUTION_INTERVAL_MS = "invalid";
      expect(getEvolutionIntervalMs()).toBe(60 * 60 * 1000);
    });

    it("should ignore negative env values", () => {
      process.env.AUTO_EVOLUTION_INTERVAL_MS = "-1000";
      expect(getEvolutionIntervalMs()).toBe(60 * 60 * 1000);
    });
  });

  describe("performEndureCheck", () => {
    it("should pass all checks when system is healthy", async () => {
      const result = await performEndureCheck(defaultConfig);
      
      expect(result.passed).toBe(true);
      expect(result.checks.disk.passed).toBe(true);
      expect(result.checks.memory.passed).toBe(true);
      expect(result.checks.cpu.passed).toBe(true);
      expect(result.checks.circuitBreaker.passed).toBe(true);
    });

    it("should fail when disk space is low", async () => {
      mockCheckHealth.mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 30 },
        disk: { size: 10000000000, used: 9900000000, usedPercent: 99 }, // Very little free space
        uptime: 100,
      } as any);

      const result = await performEndureCheck({
        ...defaultConfig,
        minDiskFreeGB: 5,
      });
      
      expect(result.passed).toBe(false);
      expect(result.checks.disk.passed).toBe(false);
      expect(result.reason).toContain("disk");
    });

    it("should fail when memory is low", async () => {
      mockCheckHealth.mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 50000000, usedPercent: 99 }, // 50MB free
        cpu: { loadPercent: 30 },
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);

      const result = await performEndureCheck({
        ...defaultConfig,
        minMemoryFreeMB: 100,
      });
      
      expect(result.passed).toBe(false);
      expect(result.checks.memory.passed).toBe(false);
    });

    it("should fail when CPU load is high", async () => {
      mockCheckHealth.mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 8000000000, usedPercent: 50 },
        cpu: { loadPercent: 95 }, // High CPU
        disk: { size: 500000000000, used: 250000000000, usedPercent: 50 },
        uptime: 100,
      } as any);

      const result = await performEndureCheck({
        ...defaultConfig,
        maxCpuLoadPercent: 90,
      });
      
      expect(result.passed).toBe(false);
      expect(result.checks.cpu.passed).toBe(false);
    });

    it("should fail when circuit breaker is open", async () => {
      mockIsCircuitBreakerOpen.mockReturnValue(true);

      const result = await performEndureCheck(defaultConfig);
      
      expect(result.passed).toBe(false);
      expect(result.checks.circuitBreaker.passed).toBe(false);
      expect(result.checks.circuitBreaker.isOpen).toBe(true);
    });

    it("should handle health check errors", async () => {
      mockCheckHealth.mockRejectedValue(new Error("Health check failed"));

      const result = await performEndureCheck(defaultConfig);
      
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("Health check failed");
    });
  });

  describe("startAutoEvolution / stopAutoEvolution", () => {
    it("should not start when disabled", () => {
      process.env.AUTO_EVOLUTION_ENABLED = "false";
      
      startAutoEvolution(defaultConfig);
      
      const status = getAutoEvolutionStatus();
      expect(status.enabled).toBe(false);
    });

    it("should start and track status", () => {
      startAutoEvolution(defaultConfig);
      
      const status = getAutoEvolutionStatus();
      expect(status.enabled).toBe(true);
      expect(status.intervalMs).toBe(60 * 60 * 1000);
    });

    it("should stop and clear timer", () => {
      startAutoEvolution(defaultConfig);
      stopAutoEvolution();
      
      const status = getAutoEvolutionStatus();
      expect(status.enabled).toBe(false);
    });

    it("should not start twice", () => {
      startAutoEvolution(defaultConfig);
      startAutoEvolution(defaultConfig); // Second call should be ignored
      
      // Should still be enabled with one timer
      const status = getAutoEvolutionStatus();
      expect(status.enabled).toBe(true);
    });

    it("should trigger evolution when Endure check passes", async () => {
      const triggerEvolution = vi.fn();
      
      startAutoEvolution({
        ...defaultConfig,
        intervalMs: 1000,
        triggerEvolution,
      });
      
      // Advance timer past interval
      await vi.advanceTimersByTimeAsync(1000);
      
      expect(triggerEvolution).toHaveBeenCalled();
    });

    it("should skip evolution when Endure check fails", async () => {
      mockIsCircuitBreakerOpen.mockReturnValue(true);
      
      const triggerEvolution = vi.fn();
      
      startAutoEvolution({
        ...defaultConfig,
        intervalMs: 1000,
        triggerEvolution,
      });
      
      await vi.advanceTimersByTimeAsync(1000);
      
      expect(triggerEvolution).not.toHaveBeenCalled();
      
      const status = getAutoEvolutionStatus();
      expect(status.skippedCount).toBe(1);
    });
  });

  describe("testEndureCheck", () => {
    it("should perform Endure check with partial config", async () => {
      const result = await testEndureCheck();
      expect(result).toBeDefined();
      expect(result.passed).toBe(true);
    });

    it("should use custom thresholds", async () => {
      mockCheckHealth.mockResolvedValue({
        status: "healthy",
        memory: { total: 16000000000, free: 50000000, usedPercent: 99 },
        cpu: { loadPercent: 95 },
        disk: { size: 10000000000, used: 9900000000, usedPercent: 99 },
        uptime: 100,
      } as any);

      const result = await testEndureCheck({
        minDiskFreeGB: 100,
        minMemoryFreeMB: 1000,
        maxCpuLoadPercent: 50,
      });
      
      expect(result.passed).toBe(false);
      expect(result.checks.disk.passed).toBe(false);
      expect(result.checks.memory.passed).toBe(false);
      expect(result.checks.cpu.passed).toBe(false);
    });
  });

  describe("getAutoEvolutionStatus", () => {
    it("should return initial status when not started", () => {
      const status = getAutoEvolutionStatus();
      
      expect(status.enabled).toBe(false);
      expect(status.triggeredCount).toBe(0);
      expect(status.skippedCount).toBe(0);
      expect(status.lastEndureCheck).toBeNull();
    });

    it("should update lastEndureCheck after check", async () => {
      await performEndureCheck(defaultConfig);
      
      const status = getAutoEvolutionStatus();
      expect(status.lastEndureCheck).not.toBeNull();
      expect(status.lastEndureCheck?.passed).toBe(true);
    });
  });

  describe("resetAutoEvolutionCounters", () => {
    it("should reset all counters", async () => {
      // Trigger some state changes
      mockIsCircuitBreakerOpen.mockReturnValue(true);
      
      startAutoEvolution({
        ...defaultConfig,
        intervalMs: 1000,
        triggerEvolution: vi.fn(),
      });
      
      await vi.advanceTimersByTimeAsync(1000);
      
      let status = getAutoEvolutionStatus();
      expect(status.skippedCount).toBe(1);
      
      // Reset
      resetAutoEvolutionCounters();
      
      status = getAutoEvolutionStatus();
      expect(status.triggeredCount).toBe(0);
      expect(status.skippedCount).toBe(0);
      expect(status.lastEndureCheck).toBeNull();
    });
  });
});