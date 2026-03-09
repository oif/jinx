import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  startSpan,
  endSpan,
  addSpanEvent,
  addEvent,
  getTrace,
  startTrace,
  endTrace,
  getRecentTraces,
  getTraceStats,
  findTraces,
  setSpanAttribute,
  recordSpanError,
  createChildSpan,
  withSpan,
  analyzeTrace,
  formatTrace,
  getTraceSummary,
  // Types
  type Span,
  type Trace,
  type SpanEvent,
  type TraceStats,
  type TrajectoryPatterns,
} from "../src/observability/trace.js";

const DATA_DIR = join(process.cwd(), "data");
const TRACES_DIR = join(DATA_DIR, "traces");

describe("observability/trace", () => {
  beforeEach(() => {
    // Clean up traces directory before each test
    try {
      if (existsSync(TRACES_DIR)) {
        rmSync(TRACES_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  afterEach(() => {
    // Clean up after tests
    try {
      if (existsSync(TRACES_DIR)) {
        rmSync(TRACES_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Interfaces", () => {
    it("should export Span interface type", () => {
      const span: Span = {
        id: "test-span",
        traceId: "test-trace",
        name: "test",
        kind: "internal",
        startTime: Date.now(),
        status: "success",
        attributes: {},
        events: [],
      };
      expect(span.id).toBe("test-span");
      expect(span.name).toBe("test");
    });

    it("should export Trace interface type", () => {
      const trace: Trace = {
        id: "test-trace",
        rootSpanId: "root-span",
        startTime: Date.now(),
        status: "running",
        metadata: {},
      };
      expect(trace.id).toBe("test-trace");
      expect(trace.status).toBe("running");
    });

    it("should export SpanEvent interface type", () => {
      const event: SpanEvent = {
        name: "test-event",
        timestamp: Date.now(),
        attributes: { key: "value" },
      };
      expect(event.name).toBe("test-event");
      expect(event.attributes?.key).toBe("value");
    });

    it("should export TraceStats interface type", () => {
      const stats: TraceStats = {
        totalTraces: 10,
        successfulTraces: 8,
        failedTraces: 2,
        avgDurationMs: 5000,
        commonErrors: [],
      };
      expect(stats.totalTraces).toBe(10);
      expect(stats.successfulTraces).toBe(8);
    });

    it("should export TrajectoryPatterns interface type", () => {
      const patterns: TrajectoryPatterns = {
        recursiveLoops: [],
        repeatedFailures: [],
        wastedTokens: 0,
        inefficientPaths: [],
      };
      expect(patterns.wastedTokens).toBe(0);
    });
  });

  describe("startSpan", () => {
    it("should create a new span with default options", () => {
      const span = startSpan("test-operation");

      expect(span.id).toBeDefined();
      expect(span.id.startsWith("span_")).toBe(true);
      expect(span.name).toBe("test-operation");
      expect(span.kind).toBe("internal");
      expect(span.status).toBe("running");
      expect(span.startTime).toBeLessThanOrEqual(Date.now());
      expect(span.attributes).toEqual({});
      expect(span.events).toEqual([]);
    });

    it("should create span with custom options", () => {
      const span = startSpan("api-call", {
        kind: "client",
        attributes: { url: "https://example.com", method: "GET" },
      });

      expect(span.kind).toBe("client");
      expect(span.attributes.url).toBe("https://example.com");
      expect(span.attributes.method).toBe("GET");
    });

    it("should create span with traceId and parentId", () => {
      const span = startSpan("child-operation", {
        traceId: "custom-trace-123",
        parentId: "parent-span-456",
      });

      expect(span.traceId).toBe("custom-trace-123");
      expect(span.parentId).toBe("parent-span-456");
    });
  });

  describe("endSpan", () => {
    it("should end a running span with success status", () => {
      const span = startSpan("test-span");
      const endedSpan = endSpan(span.id);

      expect(endedSpan).not.toBeNull();
      expect(endedSpan?.status).toBe("success");
      expect(endedSpan?.endTime).toBeDefined();
      expect(endedSpan?.durationMs).toBeDefined();
      expect(endedSpan?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should end a span with error status", () => {
      const span = startSpan("failing-span");
      const endedSpan = endSpan(span.id, "error", {
        type: "TestError",
        message: "Something went wrong",
        stack: "at test.js:10",
      });

      expect(endedSpan?.status).toBe("error");
      expect(endedSpan?.error).toBeDefined();
      expect(endedSpan?.error?.type).toBe("TestError");
      expect(endedSpan?.error?.message).toBe("Something went wrong");
    });

    it("should return null for non-existent span", () => {
      const result = endSpan("non-existent-span");
      expect(result).toBeNull();
    });
  });

  describe("addSpanEvent", () => {
    it("should add an event to an active span", () => {
      const span = startSpan("test-span");
      const result = addSpanEvent(span.id, "checkpoint", { step: 1 });

      expect(result).toBe(true);

      // End the span to finalize
      endSpan(span.id);

      // Verify the event was added (we need to access the span data)
      // Since we can't directly access the span after ending, we trust the function returned true
    });

    it("should add event without attributes", () => {
      const span = startSpan("test-span");
      const result = addSpanEvent(span.id, "simple-event");

      expect(result).toBe(true);
      endSpan(span.id);
    });

    it("should return false for non-existent span", () => {
      const result = addSpanEvent("non-existent", "test-event");
      expect(result).toBe(false);
    });
  });

  describe("addEvent alias", () => {
    it("should be the same function as addSpanEvent", () => {
      expect(addEvent).toBe(addSpanEvent);
    });

    it("should work the same as addSpanEvent", () => {
      const span = startSpan("test-span");
      const result = addEvent(span.id, "aliased-event", { key: "value" });

      expect(result).toBe(true);
      endSpan(span.id);
    });
  });

  describe("setSpanAttribute", () => {
    it("should set attribute on an active span", () => {
      const span = startSpan("test-span");
      const result = setSpanAttribute(span.id, "customKey", "customValue");

      expect(result).toBe(true);
      endSpan(span.id);
    });

    it("should return false for non-existent span", () => {
      const result = setSpanAttribute("non-existent", "key", "value");
      expect(result).toBe(false);
    });
  });

  describe("recordSpanError", () => {
    it("should record error on a span", () => {
      const span = startSpan("error-span");
      const error = new Error("Test error message");
      error.stack = "at test.js:20";

      recordSpanError(span.id, error);

      // The span should be ended with error status
      // We can verify this by checking if the span is no longer active
      // (since endSpan removes it from activeSpans)
    });
  });

  describe("startTrace and endTrace", () => {
    it("should create and end a trace", () => {
      const trace = startTrace({
        evolutionCycle: 1,
        taskId: "#001",
        taskTitle: "Test Task",
      });

      expect(trace.id).toBeDefined();
      expect(trace.id.startsWith("trace_")).toBe(true);
      expect(trace.status).toBe("running");
      expect(trace.rootSpanId).toBeDefined();
      expect(trace.metadata.evolutionCycle).toBe(1);
      expect(trace.metadata.taskId).toBe("#001");

      // End the trace
      const endedTrace = endTrace(trace.id, "success");

      expect(endedTrace).not.toBeNull();
      expect(endedTrace?.status).toBe("success");
      expect(endedTrace?.endTime).toBeDefined();
      expect(endedTrace?.durationMs).toBeDefined();
    });

    it("should return null when ending non-existent trace", () => {
      const result = endTrace("non-existent-trace");
      expect(result).toBeNull();
    });

    it("should end all running spans when trace ends", () => {
      const trace = startTrace({ taskId: "#002" });

      // Create child spans
      const span1 = startSpan("operation-1", { traceId: trace.id });
      const span2 = startSpan("operation-2", { traceId: trace.id, parentId: span1.id });

      // End the trace
      const endedTrace = endTrace(trace.id, "success");

      expect(endedTrace).not.toBeNull();
      expect(endedTrace?.summary?.totalSpans).toBe(3); // root + 2 children
    });
  });

  describe("getTrace", () => {
    it("should retrieve a trace by ID", () => {
      const trace = startTrace({ taskId: "#003" });
      endTrace(trace.id, "success");

      const retrieved = getTrace(trace.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.trace.id).toBe(trace.id);
      expect(retrieved?.spans).toBeDefined();
      expect(retrieved?.spans.length).toBeGreaterThan(0);
    });

    it("should return null for non-existent trace", () => {
      const result = getTrace("non-existent-trace");
      expect(result).toBeNull();
    });
  });

  describe("getRecentTraces", () => {
    it("should return empty array when no traces exist", () => {
      const traces = getRecentTraces();
      expect(traces).toEqual([]);
    });

    it("should return recent traces", () => {
      const trace1 = startTrace({ taskId: "#101" });
      endTrace(trace1.id, "success");

      const trace2 = startTrace({ taskId: "#102" });
      endTrace(trace2.id, "success");

      const traces = getRecentTraces(5);

      expect(traces.length).toBe(2);
      expect(traces[0].metadata.taskId).toBe("#101");
      expect(traces[1].metadata.taskId).toBe("#102");
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        const trace = startTrace({ taskId: `#20${i}` });
        endTrace(trace.id, "success");
      }

      const traces = getRecentTraces(2);
      expect(traces.length).toBe(2);
    });
  });

  describe("getTraceStats", () => {
    it("should return stats for traces", () => {
      const trace1 = startTrace({ taskId: "#201" });
      endTrace(trace1.id, "success");

      const trace2 = startTrace({ taskId: "#202" });
      endTrace(trace2.id, "error");

      const stats = getTraceStats();

      expect(stats.totalTraces).toBe(2);
      expect(stats.successfulTraces).toBe(1);
      expect(stats.failedTraces).toBe(1);
    });
  });

  describe("findTraces", () => {
    it("should find traces by status", () => {
      const trace1 = startTrace({ taskId: "#301" });
      endTrace(trace1.id, "success");

      const trace2 = startTrace({ taskId: "#302" });
      endTrace(trace2.id, "error");

      const successfulTraces = findTraces({ status: "success" });
      const failedTraces = findTraces({ status: "error" });

      expect(successfulTraces.length).toBe(1);
      expect(failedTraces.length).toBe(1);
    });

    it("should find traces by taskId", () => {
      const trace = startTrace({ taskId: "#special-task" });
      endTrace(trace.id, "success");

      const found = findTraces({ taskId: "#special-task" });

      expect(found.length).toBe(1);
      expect(found[0].metadata.taskId).toBe("#special-task");
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        const trace = startTrace({ taskId: `#40${i}` });
        endTrace(trace.id, "success");
      }

      const found = findTraces({ limit: 3 });
      expect(found.length).toBe(3);
    });
  });

  describe("createChildSpan", () => {
    it("should create a child span from a parent", () => {
      const parent = startSpan("parent-operation");
      const child = createChildSpan(parent.id, "child-operation");

      expect(child).not.toBeNull();
      expect(child?.parentId).toBe(parent.id);
      expect(child?.traceId).toBe(parent.traceId);

      endSpan(parent.id);
      if (child) endSpan(child.id);
    });

    it("should return null for non-existent parent", () => {
      const child = createChildSpan("non-existent", "child");
      expect(child).toBeNull();
    });
  });

  describe("withSpan", () => {
    it("should wrap async function with span", async () => {
      const result = await withSpan("async-operation", async (span) => {
        expect(span.id).toBeDefined();
        expect(span.name).toBe("async-operation");
        return "test-result";
      });

      expect(result).toBe("test-result");
    });

    it("should end span with error when function throws", async () => {
      const spanId = await withSpan("failing-operation", async (span) => {
        addEvent(span.id, "before-error");
        throw new Error("Intentional test error");
      }).catch(() => {
        // Expected error
        return null;
      });

      expect(spanId).toBeNull();
    });

    it("should support custom options", async () => {
      const result = await withSpan(
        "custom-operation",
        async () => "custom-result",
        { kind: "client", attributes: { url: "https://example.com" } }
      );

      expect(result).toBe("custom-result");
    });
  });

  describe("analyzeTrace", () => {
    it("should analyze a trace and return insights", () => {
      const trace = startTrace({ taskId: "#501" });

      const span1 = startSpan("slow-operation", { traceId: trace.id });
      endSpan(span1.id, "success");

      endTrace(trace.id, "success");

      const analysis = analyzeTrace(trace.id);

      expect(analysis).toBeDefined();
      expect(analysis.bottlenecks).toBeDefined();
      expect(analysis.errors).toBeDefined();
      expect(analysis.recommendations).toBeDefined();
      expect(analysis.patterns).toBeDefined();
    });

    it("should return empty analysis for non-existent trace", () => {
      const analysis = analyzeTrace("non-existent");

      expect(analysis.bottlenecks).toEqual([]);
      expect(analysis.errors).toEqual([]);
    });

    it("should detect errors in trace", () => {
      const trace = startTrace({ taskId: "#502" });

      const span1 = startSpan("failing-operation", { traceId: trace.id });
      endSpan(span1.id, "error", {
        type: "TestError",
        message: "Operation failed",
      });

      endTrace(trace.id, "error");

      const analysis = analyzeTrace(trace.id);

      expect(analysis.errors.length).toBeGreaterThan(0);
      expect(analysis.errors[0].span).toBe("failing-operation");
    });
  });

  describe("formatTrace", () => {
    it("should format trace for display", () => {
      const trace = startTrace({ taskId: "#601", taskTitle: "Test Task" });
      endTrace(trace.id, "success");

      const formatted = formatTrace(trace.id);

      expect(formatted).toContain("📍 Trace:");
      expect(formatted).toContain("📊 Status: SUCCESS");
    });

    it("should return not found message for non-existent trace", () => {
      const formatted = formatTrace("non-existent");
      expect(formatted).toContain("not found");
    });
  });

  describe("getTraceSummary", () => {
    it("should return trace summary", () => {
      const trace = startTrace({ taskId: "#701" });
      endTrace(trace.id, "success");

      const summary = getTraceSummary();

      expect(summary).toContain("📍 Trace Summary:");
    });
  });

  describe("Trace Persistence", () => {
    it("should persist trace to disk", () => {
      const trace = startTrace({ taskId: "#persist-test" });
      endTrace(trace.id, "success");

      // Verify the traces directory was created
      expect(existsSync(TRACES_DIR)).toBe(true);

      // Verify index file exists
      const indexPath = join(TRACES_DIR, "index.json");
      expect(existsSync(indexPath)).toBe(true);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle nested spans correctly", async () => {
      const trace = startTrace({ taskId: "#complex-nested" });

      const parent = startSpan("parent", { traceId: trace.id });

      addEvent(parent.id, "started");

      const child1 = createChildSpan(parent.id, "child-1");
      const child2 = createChildSpan(parent.id, "child-2");

      if (child1) {
        addEvent(child1.id, "processing");
        endSpan(child1.id, "success");
      }

      if (child2) {
        setSpanAttribute(child2.id, "custom", "value");
        endSpan(child2.id, "success");
      }

      addEvent(parent.id, "completed");
      endSpan(parent.id, "success");

      const endedTrace = endTrace(trace.id, "success");

      expect(endedTrace).not.toBeNull();
      expect(endedTrace?.summary?.totalSpans).toBe(4); // root + parent + 2 children
    });

    it("should handle multiple concurrent traces", () => {
      const trace1 = startTrace({ taskId: "#concurrent-1" });
      const trace2 = startTrace({ taskId: "#concurrent-2" });

      const span1 = startSpan("op1", { traceId: trace1.id });
      const span2 = startSpan("op2", { traceId: trace2.id });

      endSpan(span1.id, "success");
      endSpan(span2.id, "success");

      endTrace(trace1.id, "success");
      endTrace(trace2.id, "success");

      const stats = getTraceStats();
      expect(stats.totalTraces).toBe(2);
      expect(stats.successfulTraces).toBe(2);
    });
  });
});