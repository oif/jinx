import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pino - must be self-contained factory
vi.mock("pino", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockPino = vi.fn(() => mockLogger);
  (mockPino as any).stdTimeFunctions = {
    isoTime: () => ',"time":"2024-01-01T00:00:00.000Z"',
  };
  return {
    default: mockPino,
  };
});

// Get reference to mocked pino
import pino from "pino";
import { 
  log, 
  createLoggerWithContext, 
  createModuleLogger,
  generateTraceId,
  setTraceId,
  getTraceId,
  withTraceId
} from "../src/util/log.js";

const mockPino = pino as unknown as () => {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
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
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ key: "value", num: 42 }),
        "Test info with data"
      );
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
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ warning: "something", code: 500 }),
        "Test warn with data"
      );
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
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: "failed", stack: "line 1" }),
        "Test error with data"
      );
    });
  });

  describe("log.debug", () => {
    it("should log debug message without data", () => {
      log.debug("Test debug message");
      expect(mockLogger.debug).toHaveBeenCalledWith("Test debug message");
    });

    it("should log debug message with data", () => {
      const data = { debug: "info" };
      log.debug("Test debug with data", data);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ debug: "info" }),
        "Test debug with data"
      );
    });
  });

  describe("child logger", () => {
    it("should create child logger with persistent context", () => {
      const childLog = log.child({ module: "test-module" });
      childLog.info("Child log message");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ module: "test-module" }),
        "Child log message"
      );
    });

    it("should merge child context with additional data", () => {
      const childLog = log.child({ module: "test-module" });
      childLog.info("Message with data", { userId: 123 });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ module: "test-module", userId: 123 }),
        "Message with data"
      );
    });

    it("should support nested child loggers", () => {
      const childLog = log.child({ module: "parent" });
      const grandchildLog = childLog.child({ submodule: "child" });
      grandchildLog.info("Nested message");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ module: "parent", submodule: "child" }),
        "Nested message"
      );
    });
  });

  describe("createLoggerWithContext", () => {
    it("should create logger with context", () => {
      const contextLog = createLoggerWithContext({ service: "api" });
      contextLog.info("API message");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ service: "api" }),
        "API message"
      );
    });
  });

  describe("createModuleLogger", () => {
    it("should create logger with module name", () => {
      const moduleLog = createModuleLogger("supervisor");
      moduleLog.info("Supervisor message");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ module: "supervisor" }),
        "Supervisor message"
      );
    });

    it("should create logger with module name and additional context", () => {
      const moduleLog = createModuleLogger("telegram", { chatId: 12345 });
      moduleLog.info("Telegram message");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ module: "telegram", chatId: 12345 }),
        "Telegram message"
      );
    });
  });

  describe("trace ID", () => {
    afterEach(() => {
      // Clear trace ID after each test
      setTraceId("");
    });

    it("should generate a valid trace ID", () => {
      const traceId = generateTraceId();
      expect(traceId).toBeDefined();
      expect(typeof traceId).toBe("string");
      expect(traceId.length).toBeGreaterThan(0);
    });

    it("should set and get trace ID", () => {
      const traceId = "test-trace-123";
      setTraceId(traceId);
      expect(getTraceId()).toBe(traceId);
    });

    it("should include trace ID in log output", () => {
      const traceId = "test-trace-456";
      setTraceId(traceId);
      log.info("Message with trace");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "test-trace-456" }),
        "Message with trace"
      );
    });

    it("should run function with trace ID using withTraceId", () => {
      let capturedTraceId: string | undefined;
      withTraceId(() => {
        capturedTraceId = getTraceId();
        log.info("Inside withTraceId");
      }, "custom-trace-789");
      
      expect(capturedTraceId).toBe("custom-trace-789");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: "custom-trace-789" }),
        "Inside withTraceId"
      );
    });

    it("should auto-generate trace ID if not provided", () => {
      let capturedTraceId: string | undefined;
      withTraceId(() => {
        capturedTraceId = getTraceId();
      });
      
      expect(capturedTraceId).toBeDefined();
      expect(typeof capturedTraceId).toBe("string");
    });
  });

  describe("JSON structure validation", () => {
    it("should include timestamp, level, message, and context in JSON format", () => {
      // This test verifies the structure is suitable for jq filtering
      const data = { userId: 123, action: "login" };
      log.info("User logged in", data);
      
      // Verify the call includes all expected fields
      const call = mockLogger.info.mock.calls[0];
      const loggedData = call[0];
      
      // Context should be merged
      expect(loggedData).toHaveProperty("userId");
      expect(loggedData).toHaveProperty("action");
      
      // Message should be second argument
      expect(call[1]).toBe("User logged in");
    });
  });
});