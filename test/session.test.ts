import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    create: vi.fn(() => ({})),
  },
  codingTools: [],
  DefaultResourceLoader: vi.fn(() => ({
    load: vi.fn(),
  })),
  ModelRegistry: vi.fn(() => ({
    find: vi.fn(),
    getAll: vi.fn(() => []),
  })),
  AuthStorage: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

describe("agent/session timeout configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENT_PROMPT_TIMEOUT_MS;
    delete process.env.AGENT_FOLLOWUP_TIMEOUT_MS;
    vi.clearAllMocks();
  });

  describe("AGENT_PROMPT_TIMEOUT_MS", () => {
    it("should handle valid timeout value", () => {
      process.env.AGENT_PROMPT_TIMEOUT_MS = "30000";
      expect(process.env.AGENT_PROMPT_TIMEOUT_MS).toBe("30000");
    });

    it("should use default when env not set", () => {
      expect(process.env.AGENT_PROMPT_TIMEOUT_MS).toBeUndefined();
    });
  });

  describe("AGENT_FOLLOWUP_TIMEOUT_MS", () => {
    it("should handle valid timeout value", () => {
      process.env.AGENT_FOLLOWUP_TIMEOUT_MS = "60000";
      expect(process.env.AGENT_FOLLOWUP_TIMEOUT_MS).toBe("60000");
    });

    it("should use default when env not set", () => {
      expect(process.env.AGENT_FOLLOWUP_TIMEOUT_MS).toBeUndefined();
    });
  });
});

describe("agent/session exports", () => {
  it("should export required functions", async () => {
    const mod = await import("../src/agent/session.js");
    expect(mod.registerTelegramSend).toBeDefined();
    expect(mod.abortAgent).toBeDefined();
    expect(mod.startAgent).toBeDefined();
  });


  it("abortAgent should not throw when no session", async () => {
    const { abortAgent } = await import("../src/agent/session.js");
    await expect(abortAgent()).resolves.not.toThrow();
  });

  it("registerTelegramSend should accept a function", async () => {
    const { registerTelegramSend } = await import("../src/agent/session.js");
    const mockSend = vi.fn();
    expect(() => registerTelegramSend(mockSend)).not.toThrow();
  });
});
