/**
 * Integration tests for structured JSON logging system
 * Verifies actual JSON output format, jq-filterability, and required fields
 * These tests run the actual logger (not mocked) in production mode
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

/**
 * Run a node script that uses the logger and capture its JSON output
 */
function captureLogOutput(script: string): string[] {
  const fullScript = `
import { log, withTraceId, createModuleLogger } from '${rootDir}/dist/util/log.js';
${script}
`;
  const output = execSync(
    `node --input-type=module`,
    {
      input: fullScript,
      env: { ...process.env, NODE_ENV: "production", LOG_LEVEL: "debug" },
      cwd: rootDir,
      encoding: "utf-8",
    }
  );
  // Split into lines and filter empty lines
  return output.trim().split("\n").filter(Boolean);
}

/**
 * Parse a JSON log line and return the parsed object
 */
function parseLogLine(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

describe("structured logging - JSON format integration", () => {
  let logLines: string[];

  beforeAll(() => {
    logLines = captureLogOutput(`
withTraceId(() => {
  log.info('User action', { userId: 123, action: 'login' });
  log.warn('Rate limit', { ip: '1.2.3.4', attempts: 5 });
  log.error('Request failed', { error: 'timeout', code: 504 });
  log.debug('Debug info', { details: 'internal state' });
}, 'test-trace-integration');
`);
  });

  it("should output valid JSON lines", () => {
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("should include timestamp field in ISO 8601 format", () => {
    for (const line of logLines) {
      const entry = parseLogLine(line);
      expect(entry).toHaveProperty("time");
      // Validate ISO 8601 format
      const time = entry.time as string;
      expect(() => new Date(time)).not.toThrow();
      expect(new Date(time).toISOString()).toBe(time);
    }
  });

  it("should include level field as string (not number)", () => {
    for (const line of logLines) {
      const entry = parseLogLine(line);
      expect(entry).toHaveProperty("level");
      expect(typeof entry.level).toBe("string");
    }
  });

  it("should include message field", () => {
    for (const line of logLines) {
      const entry = parseLogLine(line);
      expect(entry).toHaveProperty("msg");
      expect(typeof entry.msg).toBe("string");
    }
  });

  it("should include service context field", () => {
    for (const line of logLines) {
      const entry = parseLogLine(line);
      expect(entry).toHaveProperty("service");
      expect(entry.service).toBe("jinx");
    }
  });

  it("should include traceId when set", () => {
    for (const line of logLines) {
      const entry = parseLogLine(line);
      expect(entry).toHaveProperty("traceId");
      expect(entry.traceId).toBe("test-trace-integration");
    }
  });

  it("should include custom context fields in log entries", () => {
    const infoLine = logLines.find((l) => {
      const e = parseLogLine(l);
      return e.level === "info";
    });
    expect(infoLine).toBeDefined();
    const entry = parseLogLine(infoLine!);
    expect(entry).toHaveProperty("userId", 123);
    expect(entry).toHaveProperty("action", "login");
  });

  it("should support all log levels: debug, info, warn, error", () => {
    const levels = new Set(
      logLines.map((l) => (parseLogLine(l) as Record<string, string>).level)
    );
    expect(levels.has("debug")).toBe(true);
    expect(levels.has("info")).toBe(true);
    expect(levels.has("warn")).toBe(true);
    expect(levels.has("error")).toBe(true);
  });

  it("should support jq-style filtering by level", () => {
    const errorEntries = logLines
      .map(parseLogLine)
      .filter((e) => e.level === "error");
    expect(errorEntries.length).toBe(1);
    expect(errorEntries[0].msg).toBe("Request failed");
    expect(errorEntries[0].code).toBe(504);
  });

  it("should support jq-style filtering by traceId", () => {
    const tracedEntries = logLines
      .map(parseLogLine)
      .filter((e) => e.traceId === "test-trace-integration");
    expect(tracedEntries.length).toBe(logLines.length);
  });

  it("should support jq-style field selection (timestamp/level/message/context)", () => {
    const entry = parseLogLine(logLines[0]);
    // These are the required fields per verification criteria
    const requiredFields = ["time", "level", "msg"];
    for (const field of requiredFields) {
      expect(entry).toHaveProperty(field);
    }
  });
});

describe("structured logging - child logger integration", () => {
  it("should include module name in all child logger entries", () => {
    const lines = captureLogOutput(`
const moduleLog = createModuleLogger('supervisor', { instance: 'primary' });
moduleLog.info('Started');
moduleLog.warn('Warning occurred');
`);
    for (const line of lines) {
      const entry = parseLogLine(line);
      expect(entry).toHaveProperty("module", "supervisor");
      expect(entry).toHaveProperty("instance", "primary");
    }
  });

  it("should propagate traceId through child loggers", () => {
    const lines = captureLogOutput(`
withTraceId(() => {
  const childLog = log.child({ component: 'auth' });
  childLog.info('Auth check');
}, 'child-trace-test');
`);
    const entry = parseLogLine(lines[0]);
    expect(entry).toHaveProperty("traceId", "child-trace-test");
    expect(entry).toHaveProperty("component", "auth");
  });
});

describe("structured logging - required fields validation", () => {
  it("should always include timestamp, level, message, and service context", () => {
    const lines = captureLogOutput(`
log.info('Minimal message');
`);
    expect(lines.length).toBe(1);
    const entry = parseLogLine(lines[0]);

    // Verification criteria: timestamp/level/message/context
    expect(entry.time).toBeDefined(); // timestamp
    expect(entry.level).toBe("info"); // level
    expect(entry.msg).toBe("Minimal message"); // message
    expect(entry.service).toBe("jinx"); // context (service)
    expect(entry.env).toBeDefined(); // context (environment)
    expect(entry.version).toBeDefined(); // context (version)
  });
});
