import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pino - must be self-contained factory with all required methods
vi.mock("pino", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: "info",
  };
  const mockPino = vi.fn(() => mockLogger);
  // Add static methods used by log.ts
  (mockPino as any).stdTimeFunctions = {
    isoTime: () => ',"time":"2024-01-01T00:00:00.000Z"',
  };
  (mockPino as any).transport = vi.fn(() => ({ type: 'mock-transport' }));
  (mockPino as any).multistream = vi.fn(() => ({ type: 'mock-multistream' }));
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
  withTraceId,
  getLogLevel,
  setLogLevel,
  withSpan,
  withSpanAsync,
  getCurrentSpan,
  addSpanEvent,
  startTimer,
  time,
  timeAsync,
  warnSlowOperation,
  trackPerformance
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

  // ── Expert Features Tests ─────────────────────────────────────────────

  describe("dynamic log level", () => {
    it("should get current log level", () => {
      const level = getLogLevel();
      expect(level).toBe("info");
    });

    it("should set valid log level", () => {
      const result = setLogLevel("debug");
      expect(result).toBe(true);
      expect(getLogLevel()).toBe("debug");
    });

    it("should reject invalid log level", () => {
      const result = setLogLevel("invalid");
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should accept all valid levels", () => {
      const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
      for (const level of validLevels) {
        const result = setLogLevel(level);
        expect(result).toBe(true);
        expect(getLogLevel()).toBe(level);
      }
    });
  });

  describe("span support", () => {
    it("should run function within a span", () => {
      const result = withSpan("test-span", () => {
        return "success";
      });

      expect(result).toBe("success");
      expect(mockLogger.debug).toHaveBeenCalledTimes(2); // start and end
    });

    it("should include span metadata in log entries", () => {
      withSpan("test-span", () => {
        // Span started
      });

      // Check start log
      const startCall = mockLogger.debug.mock.calls.find(
        (call) => call[1]?.includes?.("started")
      );
      expect(startCall).toBeDefined();
      expect(startCall[0]).toHaveProperty("spanId");
      expect(startCall[0]).toHaveProperty("spanName", "test-span");
      expect(startCall[0]).toHaveProperty("spanOp", "start");
    });

    it("should include duration in span end log", () => {
      withSpan("timed-span", () => {
        // Some operation
      });

      // Check end log
      const endCall = mockLogger.debug.mock.calls.find(
        (call) => call[1]?.includes?.("ended")
      );
      expect(endCall).toBeDefined();
      expect(endCall[0]).toHaveProperty("durationMs");
    });

    it("should log error and rethrow when span fails", () => {
      expect(() => {
        withSpan("failing-span", () => {
          throw new Error("Test error");
        });
      }).toThrow("Test error");

      const errorCall = mockLogger.error.mock.calls.find(
        (call) => call[1]?.includes?.("failed")
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[0]).toHaveProperty("spanOp", "error");
      expect(errorCall[0]).toHaveProperty("errorMessage", "Test error");
    });

    it("should support nested spans", () => {
      withSpan("outer-span", () => {
        withSpan("inner-span", () => {
          // Nested operation
        });
      });

      // Should have 4 debug calls: outer start, inner start, inner end, outer end
      expect(mockLogger.debug).toHaveBeenCalledTimes(4);
    });

    it("should support async spans", async () => {
      const result = await withSpanAsync("async-span", async () => {
        return "async-result";
      });

      expect(result).toBe("async-result");
      expect(mockLogger.debug).toHaveBeenCalledTimes(2);
    });
  });

  describe("getCurrentSpan", () => {
    it("should return undefined outside span context", () => {
      expect(getCurrentSpan()).toBeUndefined();
    });

    it("should return span context inside withSpan", () => {
      withSpan("my-span", () => {
        const span = getCurrentSpan();
        expect(span).toBeDefined();
        expect(span?.spanName).toBe("my-span");
        expect(span?.spanId).toBeDefined();
      });
    });
  });

  describe("addSpanEvent", () => {
    it("should add event to current span", () => {
      withSpan("span-with-events", () => {
        addSpanEvent("checkpoint-1", { progress: 50 });
      });

      const eventCall = mockLogger.debug.mock.calls.find(
        (call) => call[0]?.spanEvent === "checkpoint-1"
      );
      expect(eventCall).toBeDefined();
      expect(eventCall[0]).toHaveProperty("spanElapsedMs");
    });
  });

  describe("timing utilities", () => {
    describe("startTimer", () => {
      it("should return a function that logs duration", () => {
        const endTimer = startTimer("my-operation");
        const duration = endTimer();

        expect(duration).toBeGreaterThanOrEqual(0);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ durationMs: duration }),
          "Timer: my-operation"
        );
      });

      it("should include additional data in timer log", () => {
        const endTimer = startTimer("operation", { userId: 123 });
        endTimer();

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ durationMs: expect.any(Number), userId: 123 }),
          "Timer: operation"
        );
      });
    });

    describe("time", () => {
      it("should time a synchronous function", () => {
        const result = time("sync-op", () => "done");

        expect(result).toBe("done");
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ durationMs: expect.any(Number) }),
          "Timer: sync-op"
        );
      });

      it("should log error when timed function throws", () => {
        expect(() => {
          time("failing-op", () => {
            throw new Error("Sync error");
          });
        }).toThrow("Sync error");

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ 
            durationMs: expect.any(Number),
            error: "Sync error" 
          }),
          "Timer failed: failing-op"
        );
      });
    });

    describe("timeAsync", () => {
      it("should time an async function", async () => {
        const result = await timeAsync("async-op", async () => {
          return "async-done";
        });

        expect(result).toBe("async-done");
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ durationMs: expect.any(Number) }),
          "Timer: async-op"
        );
      });
    });
  });

  describe("warnSlowOperation", () => {
    it("should warn when duration exceeds threshold", () => {
      warnSlowOperation("slow-op", 6000, 5000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ 
          durationMs: 6000, 
          thresholdMs: 5000,
          operation: "slow-op"
        }),
        expect.stringContaining("Slow operation detected")
      );
    });

    it("should not warn when duration is below threshold", () => {
      warnSlowOperation("fast-op", 100, 5000);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("trackPerformance", () => {
    it("should track async operation performance", async () => {
      const { result, durationMs } = await trackPerformance("tracked-op", async () => {
        return "tracked-result";
      });

      expect(result).toBe("tracked-result");
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should warn on slow operation", async () => {
      await trackPerformance(
        "slow-tracked-op",
        async () => {
          await new Promise((r) => setTimeout(r, 10));
        },
        { warnThresholdMs: 5 }
      );

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should include additional data in performance log", async () => {
      await trackPerformance(
        "data-op",
        async () => "result",
        { data: { requestId: "req-123" } }
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-123" }),
        expect.stringContaining("Performance")
      );
    });
  });
});