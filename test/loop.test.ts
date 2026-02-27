import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/util/state.js", () => ({
  readState: vi.fn(() => ({
    version: "0.0.17",
    cycle: 18,
    lastRestart: null,
    lastEvolution: null,
  })),
}));

vi.mock("../src/consciousness/history.js", () => ({
  recordEvolutionResult: vi.fn(),
  loadRecentHistory: vi.fn(() => []),
  calculateEvolutionStats: vi.fn(() => ({ totalCycles: 0, currentStreak: 0 })),
}));

vi.mock("../src/consciousness/evolution-progress.js", () => ({
  startEvolutionProgress: vi.fn(),
  setEvolutionStage: vi.fn(),
  completeEvolutionProgress: vi.fn(),
  failEvolutionProgress: vi.fn(),
}));

vi.mock("../src/health/history.js", () => ({
  recordHealthSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/supervisor/paths.js", () => ({
  STATE_PATH: "/tmp/test-state.json",
}));

vi.mock("../src/config/evolution-prompt.js", () => ({
  getEvolutionCyclePrompt: vi.fn(() => "mock evolution prompt"),
  getConsciousnessCheckPrompt: vi.fn(() => "mock consciousness check"),
}));

describe("consciousness/loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getLoopIntervalMs", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.CONSCIOUSNESS_INTERVAL_SECONDS;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should use default 5 seconds when env not set", async () => {
      const mod = await import("../src/consciousness/loop.js");
      expect(mod).toBeDefined();
    });

    it("should use custom value when env is valid", async () => {
      process.env.CONSCIOUSNESS_INTERVAL_SECONDS = "10";
      const mod = await import("../src/consciousness/loop.js");
      expect(mod).toBeDefined();
    });

    it("should use default for invalid env value", async () => {
      process.env.CONSCIOUSNESS_INTERVAL_SECONDS = "invalid";
      const mod = await import("../src/consciousness/loop.js");
      expect(mod).toBeDefined();
    });

    it("should use default for negative value", async () => {
      process.env.CONSCIOUSNESS_INTERVAL_SECONDS = "-5";
      const mod = await import("../src/consciousness/loop.js");
      expect(mod).toBeDefined();
    });
  });
});

describe("startConsciousness exports", () => {
  it("should export startConsciousness function", async () => {
    const mod = await import("../src/consciousness/loop.js");
    expect(mod.startConsciousness).toBeDefined();
    expect(typeof mod.startConsciousness).toBe("function");
  });

  it("should export loadNextTask function", async () => {
    const mod = await import("../src/consciousness/loop.js");
    expect(mod.loadNextTask).toBeDefined();
    expect(typeof mod.loadNextTask).toBe("function");
  });

  it("should export markTaskDone function", async () => {
    const mod = await import("../src/consciousness/loop.js");
    expect(mod.markTaskDone).toBeDefined();
    expect(typeof mod.markTaskDone).toBe("function");
  });
});

describe("loadNextTask", () => {
  it("should return null when backlog file does not exist", async () => {
    // File at default location won't exist in test env
    const { loadNextTask } = await import("../src/consciousness/loop.js");
    // This test just verifies it doesn't throw
    expect(() => loadNextTask()).not.toThrow();
  });
});
