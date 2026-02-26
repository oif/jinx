import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock dependencies
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/supervisor/git-ops.js", () => ({
  safePull: vi.fn(() => true),
  rebuild: vi.fn(() => true),
  rollbackToMain: vi.fn(() => true),
  getCurrentSha: vi.fn(() => "abc123"),
}));

vi.mock("../src/supervisor/recovery.js", () => ({
  markIntentionalRestart: vi.fn(),
}));

vi.mock("../src/supervisor/paths.js", () => ({
  RESTART_MARKER: "/tmp/test-restart-marker.json",
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("supervisor/lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("exports", () => {
    it("should export required functions", async () => {
      const mod = await import("../src/supervisor/lifecycle.js");
      expect(mod.startLifecycleMonitor).toBeDefined();
      expect(mod.stopLifecycleMonitor).toBeDefined();
      expect(mod.registerShutdownHandlers).toBeDefined();
      expect(mod.registerNotify).toBeDefined();
    });
  });

  describe("registerNotify", () => {
    it("should accept a notification function", async () => {
      const { registerNotify } = await import("../src/supervisor/lifecycle.js");
      const mockNotify = vi.fn();
      expect(() => registerNotify(mockNotify)).not.toThrow();
    });
  });

  describe("startLifecycleMonitor", () => {
    it("should start without error", async () => {
      const { startLifecycleMonitor } = await import("../src/supervisor/lifecycle.js");
      expect(() => startLifecycleMonitor()).not.toThrow();
    });
  });

  describe("stopLifecycleMonitor", () => {
    it("should stop without error when not started", async () => {
      const { stopLifecycleMonitor } = await import("../src/supervisor/lifecycle.js");
      expect(() => stopLifecycleMonitor()).not.toThrow();
    });
  });

  describe("registerShutdownHandlers", () => {
    it("should register handlers without error", async () => {
      const { registerShutdownHandlers } = await import("../src/supervisor/lifecycle.js");
      const mockCleanup = vi.fn(() => Promise.resolve());
      expect(() => registerShutdownHandlers(mockCleanup)).not.toThrow();
    });
  });
});
