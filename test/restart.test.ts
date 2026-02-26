import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/supervisor/git-ops.js", () => ({
  getCurrentSha: vi.fn(() => "abc123def"),
}));

vi.mock("../src/supervisor/paths.js", () => ({
  RESTART_MARKER: "/tmp/test-restart-marker.json",
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

describe("supervisor/restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("exports", () => {
    it("should export requestRestart function", async () => {
      const mod = await import("../src/supervisor/restart.js");
      expect(mod.requestRestart).toBeDefined();
      expect(typeof mod.requestRestart).toBe("function");
    });
  });

  describe("requestRestart", () => {
    it("should write restart marker with correct structure", async () => {
      const { requestRestart } = await import("../src/supervisor/restart.js");
      const { writeFileSync } = await import("node:fs");
      
      requestRestart("Test restart reason");
      
      expect(writeFileSync).toHaveBeenCalled();
      const callArgs = (writeFileSync as any).mock.calls[0];
      expect(callArgs[0]).toBe("/tmp/test-restart-marker.json");
      
      const markerData = JSON.parse(callArgs[1]);
      expect(markerData.reason).toBe("Test restart reason");
      expect(markerData.sha).toBe("abc123def");
      expect(markerData.requestedAt).toBeDefined();
    });
  });
});
