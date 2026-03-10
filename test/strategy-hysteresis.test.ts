import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadStrategyConfig,
  saveStrategyConfig,
  getCurrentStrategy,
  forceStrategy,
  enableAutoSelect,
  recommendStrategy,
  type StrategyConfig,
  type EvolutionStrategy,
} from "../src/evolution/strategy.js";
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Use vi.hoisted to define TEST_DATA_DIR so it's available in mocked modules
// Note: Cannot use imported 'join' in hoisted callback, use string concatenation instead
const TEST_DATA_DIR = vi.hoisted(() => `${process.cwd()}/test-temp-strategy-hysteresis`);

// Mock the log module
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the paths module to use TEST_DATA_DIR
vi.mock("../src/supervisor/paths.js", () => ({
  DATA_DIR: TEST_DATA_DIR,
  PROJECT_ROOT: process.cwd(),
  STATE_PATH: `${TEST_DATA_DIR}/state.json`,
  SESSIONS_DIR: `${TEST_DATA_DIR}/sessions`,
  PACKAGE_PATH: `${process.cwd()}/package.json`,
  BORN_PATH: `${process.cwd()}/BORN.md`,
  BACKLOG_PATH: `${TEST_DATA_DIR}/backlog.md`,
  PROGRESS_PATH: `${TEST_DATA_DIR}/evolution-progress.json`,
  RESTART_MARKER: `${TEST_DATA_DIR}/.restart_requested`,
  RESTART_MARKER_TMP: `${TEST_DATA_DIR}/.restart_requested.tmp`,
  RESTART_MARKER_PROCESSING: `${TEST_DATA_DIR}/.restart_requested.processing`,
}));

// Paths inside the test temp directory
const STRATEGY_PATH = join(TEST_DATA_DIR, "evolution-strategy.json");
const METRICS_PATH = join(TEST_DATA_DIR, "performance-metrics.json");
const HEALTH_PATH = join(TEST_DATA_DIR, "health-history.json");

// Helper to create a mock strategy config
function createMockConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    currentStrategy: "balanced",
    lastStrategyChange: new Date().toISOString(),
    strategyHistory: [],
    autoSelect: true,
    thresholds: {
      failureRateCritical: 0.5,
      failureRateWarning: 0.2,
      healthWarningCount: 3,
      consecutiveSuccesses: 3,
    },
    pendingSwitch: null,
    confirmationCount: 0,
    requiredConfirmations: 2,
    ...overrides,
  };
}

// Helper to create mock metrics
function createMockMetrics(failureRate: number = 0): void {
  const totalCycles = 10;
  const failedCount = Math.round(failureRate * totalCycles);
  const successCount = totalCycles - failedCount;
  
  const cycles = [];
  for (let i = 0; i < successCount; i++) {
    cycles.push({ status: "success" });
  }
  for (let i = 0; i < failedCount; i++) {
    cycles.push({ status: "failed" });
  }
  
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  writeFileSync(METRICS_PATH, JSON.stringify({
    agentPrompts: [],
    evolutionCycles: cycles,
  }));
}

// Helper to create mock health history
function createMockHealthHistory(status: "healthy" | "degraded" | "critical" = "healthy"): void {
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push({
      timestamp: new Date().toISOString(),
      status,
      memory: { usedPercent: 50 },
      cpu: { loadPercent: 50 },
      disk: { usedPercent: 50 },
    });
  }
  writeFileSync(HEALTH_PATH, JSON.stringify(entries));
}

describe("Strategy Hysteresis", () => {
  beforeEach(() => {
    // Clean up any existing temp directory first (from failed tests)
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    // Create fresh temp directory
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    vi.clearAllMocks();
    
    // Create healthy mock data
    createMockMetrics(0);
    createMockHealthHistory("healthy");
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  it("should not switch strategy on first different recommendation", () => {
    // Start with balanced strategy
    saveStrategyConfig(createMockConfig({ currentStrategy: "balanced" }));
    
    // Create conditions that would recommend harden (20%+ failure rate)
    createMockMetrics(0.3); // 30% failure rate
    createMockHealthHistory("degraded");
    
    const strategy = getCurrentStrategy();
    
    // Should still be balanced (first recommendation doesn't switch)
    expect(strategy).toBe("balanced");
    
    // Check that pending switch is set
    const config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe("harden");
    expect(config.confirmationCount).toBe(1);
  });

  it("should switch strategy after required confirmations", () => {
    // Start with balanced and pending switch already set
    saveStrategyConfig(createMockConfig({
      currentStrategy: "balanced",
      pendingSwitch: "harden",
      confirmationCount: 1,
    }));
    
    // Create conditions that recommend harden
    createMockMetrics(0.3); // 30% failure rate
    createMockHealthHistory("degraded");
    
    const strategy = getCurrentStrategy();
    
    // Should now be harden (second confirmation triggers switch)
    expect(strategy).toBe("harden");
    
    // Check that pending switch is cleared
    const config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe(null);
    expect(config.confirmationCount).toBe(0);
    expect(config.strategyHistory.length).toBeGreaterThan(0);
  });

  it("should clear pending switch when recommendation matches current", () => {
    // Start with balanced and pending switch to harden
    saveStrategyConfig(createMockConfig({
      currentStrategy: "balanced",
      pendingSwitch: "harden",
      confirmationCount: 1,
    }));
    
    // Create conditions that recommend balanced:
    // - consecutiveSuccesses < 3 (by having last cycle as failed)
    // - healthStatus === "healthy"
    // - low failure rate
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(METRICS_PATH, JSON.stringify({
      agentPrompts: [],
      evolutionCycles: [
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "success" },
        { status: "failed" }, // Last cycle failed → consecutiveSuccesses = 0
      ],
    }));
    createMockHealthHistory("healthy");
    
    const strategy = getCurrentStrategy();
    
    // Should stay balanced (recommendation matches current)
    expect(strategy).toBe("balanced");
    
    // Pending switch should be cleared
    const config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe(null);
    expect(config.confirmationCount).toBe(0);
  });

  it("should reset count when recommendation changes", () => {
    // Start with balanced and pending switch to harden
    saveStrategyConfig(createMockConfig({
      currentStrategy: "balanced",
      pendingSwitch: "harden",
      confirmationCount: 1,
    }));
    
    // Create critical conditions that recommend repair-only (different from pending)
    createMockMetrics(0.6); // 60% failure rate
    createMockHealthHistory("critical");
    
    const strategy = getCurrentStrategy();
    
    // Should still be balanced (new pending switch starts fresh)
    expect(strategy).toBe("balanced");
    
    // Pending switch should change to repair-only with count 1
    const config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe("repair-only");
    expect(config.confirmationCount).toBe(1);
  });

  it("should respect manual override and reset hysteresis", () => {
    // Start with balanced and pending switch
    saveStrategyConfig(createMockConfig({
      currentStrategy: "balanced",
      pendingSwitch: "harden",
      confirmationCount: 1,
    }));
    
    // Force strategy to innovate
    forceStrategy("innovate", "Test override");
    
    const config = loadStrategyConfig();
    expect(config.currentStrategy).toBe("innovate");
    expect(config.pendingSwitch).toBe(null);
    expect(config.confirmationCount).toBe(0);
    expect(config.autoSelect).toBe(false);
  });

  it("should reset hysteresis when re-enabling auto-select", () => {
    // Start with manual mode and some pending state
    saveStrategyConfig(createMockConfig({
      currentStrategy: "innovate",
      autoSelect: false,
      pendingSwitch: "harden",
      confirmationCount: 1,
    }));
    
    enableAutoSelect();
    
    const config = loadStrategyConfig();
    expect(config.autoSelect).toBe(true);
    expect(config.pendingSwitch).toBe(null);
    expect(config.confirmationCount).toBe(0);
  });

  it("should record strategy history with confirmation count", () => {
    // Start with balanced and pending switch ready to trigger
    saveStrategyConfig(createMockConfig({
      currentStrategy: "balanced",
      pendingSwitch: "harden",
      confirmationCount: 1,
    }));
    
    // Create conditions that recommend harden
    createMockMetrics(0.3);
    createMockHealthHistory("degraded");
    
    getCurrentStrategy();
    
    const config = loadStrategyConfig();
    expect(config.strategyHistory.length).toBeGreaterThan(0);
    const lastChange = config.strategyHistory[config.strategyHistory.length - 1];
    expect(lastChange.from).toBe("balanced");
    expect(lastChange.to).toBe("harden");
    expect(lastChange.reason).toContain("2 confirmations");
  });

  it("should handle multiple calls correctly", () => {
    // Start fresh with balanced
    saveStrategyConfig(createMockConfig({ currentStrategy: "balanced" }));
    
    // Create degraded conditions
    createMockMetrics(0.3);
    createMockHealthHistory("degraded");
    
    // First call - sets pending
    expect(getCurrentStrategy()).toBe("balanced");
    let config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe("harden");
    expect(config.confirmationCount).toBe(1);
    
    // Second call - triggers switch
    expect(getCurrentStrategy()).toBe("harden");
    config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe(null);
    expect(config.confirmationCount).toBe(0);
    
    // Third call - stays at harden (recommendation matches current)
    expect(getCurrentStrategy()).toBe("harden");
    config = loadStrategyConfig();
    expect(config.pendingSwitch).toBe(null);
    expect(config.confirmationCount).toBe(0);
  });
});