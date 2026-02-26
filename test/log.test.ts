import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pino - must be self-contained factory
vi.mock("pino", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    default: () => mockLogger,
  };
});

// Get reference to mocked pino
import pino from "pino";
import { log } from "../src/util/log.js";

const mockPino = pino as unknown as () => {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

describe("util/log", () => {
  let mockLogger: ReturnType<typeof mockPino>;

  beforeEach(() => {
    mockLogger = mockPino();
    vi.clearAllMocks();
  });

  describe("log.info", () => {
    it("should log info message without data", () => {
      log.info("Test info message");
      expect(mockLogger.info).toHaveBeenCalledWith("Test info message");
    });

    it("should log info message with data", () => {
      const data = { key: "value", num: 42 };
      log.info("Test info with data", data);
      expect(mockLogger.info).toHaveBeenCalledWith(data, "Test info with data");
    });
  });

  describe("log.warn", () => {
    it("should log warn message without data", () => {
      log.warn("Test warn message");
      expect(mockLogger.warn).toHaveBeenCalledWith("Test warn message");
    });

    it("should log warn message with data", () => {
      const data = { warning: "something", code: 500 };
      log.warn("Test warn with data", data);
      expect(mockLogger.warn).toHaveBeenCalledWith(data, "Test warn with data");
    });
  });

  describe("log.error", () => {
    it("should log error message without data", () => {
      log.error("Test error message");
      expect(mockLogger.error).toHaveBeenCalledWith("Test error message");
    });

    it("should log error message with data", () => {
      const data = { error: "failed", stack: "line 1" };
      log.error("Test error with data", data);
      expect(mockLogger.error).toHaveBeenCalledWith(data, "Test error with data");
    });
  });
});
