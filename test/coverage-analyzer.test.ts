import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readCoverageReport,
  loadCoverageHistory,
  saveCoverageHistory,
  recordCoverage,
  getCoverageTrend,
  getCoverageChange,
  formatCoverageReport,
  formatCoverageSummary,
} from "../src/coverage/analyzer.js";

// Mock fs
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));

import { readFileSync, writeFileSync, existsSync } from "node:fs";

describe("Coverage Analyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("readCoverageReport", () => {
    it("should return null when coverage report not found", () => {
      (existsSync as any).mockReturnValue(false);
      
      const result = readCoverageReport();
      
      expect(result).toBeNull();
    });

    it("should parse coverage report correctly", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          total: {
            lines: { pct: 75.5, covered: 100, total: 133 },
            statements: { pct: 80, covered: 120, total: 150 },
            functions: { pct: 70, covered: 35, total: 50 },
            branches: { pct: 65, covered: 26, total: 40 },
          },
          "/test/file.ts": {
            lines: { pct: 100, covered: 10, total: 10 },
          },
        })
      );

      const result = readCoverageReport();

      expect(result).not.toBeNull();
      expect(result?.overall.lines.pct).toBe(75.5);
      expect(result?.files).toHaveLength(1);
      expect(result?.untestedFiles).toHaveLength(0);
    });

    it("should categorize untested files", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          total: {
            lines: { pct: 50, covered: 10, total: 20 },
            statements: { pct: 50, covered: 10, total: 20 },
            functions: { pct: 50, covered: 5, total: 10 },
            branches: { pct: 50, covered: 5, total: 10 },
          },
          "/test/untested.ts": {
            lines: { pct: 0, covered: 0, total: 10 },
          },
          "/test/low.ts": {
            lines: { pct: 30, covered: 3, total: 10 },
          },
          "/test/good.ts": {
            lines: { pct: 90, covered: 9, total: 10 },
          },
        })
      );

      const result = readCoverageReport();

      expect(result?.untestedFiles).toContain("test/untested.ts");
      expect(result?.lowCoverageFiles).toHaveLength(1);
      expect(result?.lowCoverageFiles[0].path).toBe("test/low.ts");
    });
  });

  describe("Coverage History", () => {
    it("should load empty history when file not exists", () => {
      (existsSync as any).mockReturnValue(false);
      
      const history = loadCoverageHistory();
      
      expect(history.entries).toEqual([]);
    });

    it("should load existing history", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          entries: [
            {
              date: "2024-01-01T00:00:00Z",
              overall: {
                lines: { pct: 70, covered: 70, total: 100 },
                statements: { pct: 70, covered: 70, total: 100 },
                functions: { pct: 70, covered: 70, total: 100 },
                branches: { pct: 70, covered: 70, total: 100 },
              },
            },
          ],
        })
      );

      const history = loadCoverageHistory();

      expect(history.entries).toHaveLength(1);
      expect(history.entries[0].overall.lines.pct).toBe(70);
    });

    it("should record coverage to history", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify({ entries: [] }));

      const summary = {
        timestamp: new Date().toISOString(),
        overall: {
          lines: { pct: 75, covered: 75, total: 100 },
          statements: { pct: 75, covered: 75, total: 100 },
          functions: { pct: 75, covered: 75, total: 100 },
          branches: { pct: 75, covered: 75, total: 100 },
        },
        files: [],
        untestedFiles: [],
        lowCoverageFiles: [],
      };

      recordCoverage(summary);

      expect(writeFileSync).toHaveBeenCalled();
      const savedData = JSON.parse((writeFileSync as any).mock.calls[0][1]);
      expect(savedData.entries).toHaveLength(1);
      expect(savedData.entries[0].overall.lines.pct).toBe(75);
    });
  });

  describe("Coverage Trends", () => {
    it("should get coverage trend", () => {
      // Use future dates so they pass the 30-day filter
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const date1 = futureDate.toISOString();
      futureDate.setDate(futureDate.getDate() + 1);
      const date2 = futureDate.toISOString();
      futureDate.setDate(futureDate.getDate() + 1);
      const date3 = futureDate.toISOString();

      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          entries: [
            { date: date1, overall: { lines: { pct: 60 } } },
            { date: date2, overall: { lines: { pct: 65 } } },
            { date: date3, overall: { lines: { pct: 70 } } },
          ],
        })
      );

      const trend = getCoverageTrend(30);

      expect(trend).toHaveLength(3);
      expect(trend[2].lineCoverage).toBe(70);
    });

    it("should calculate coverage change", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          entries: [
            { date: "2024-01-01T00:00:00Z", overall: { lines: { pct: 60 }, statements: { pct: 60 }, functions: { pct: 60 }, branches: { pct: 60 } } },
            { date: "2024-01-02T00:00:00Z", overall: { lines: { pct: 70 }, statements: { pct: 70 }, functions: { pct: 70 }, branches: { pct: 70 } } },
          ],
        })
      );

      const change = getCoverageChange();

      expect(change.lines).toBe(10);
      expect(change.statements).toBe(10);
      expect(change.functions).toBe(10);
      expect(change.branches).toBe(10);
    });

    it("should return zero change with insufficient history", () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          entries: [{ date: "2024-01-01T00:00:00Z", overall: { lines: { pct: 60 } } }],
        })
      );

      const change = getCoverageChange();

      expect(change.lines).toBe(0);
    });
  });

  describe("Formatting", () => {
    it("should format coverage report", () => {
      const summary = {
        timestamp: new Date().toISOString(),
        overall: {
          lines: { pct: 75, covered: 75, total: 100 },
          statements: { pct: 80, covered: 80, total: 100 },
          functions: { pct: 70, covered: 35, total: 50 },
          branches: { pct: 65, covered: 26, total: 40 },
        },
        files: [
          { path: "test.ts", metrics: { lines: { pct: 100 } } as any },
        ],
        untestedFiles: ["untested.ts"],
        lowCoverageFiles: [],
      };

      const report = formatCoverageReport(summary);

      expect(report).toContain("Test Coverage Report");
      expect(report).toContain("75.0%");
      expect(report).toContain("untested.ts");
    });

    it("should format coverage summary", () => {
      // Use future dates so they pass the 30-day filter
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const date1 = futureDate.toISOString();
      futureDate.setDate(futureDate.getDate() + 1);
      const date2 = futureDate.toISOString();

      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          entries: [
            { 
              date: date1, 
              overall: { 
                lines: { pct: 60, covered: 60, total: 100 },
                statements: { pct: 60, covered: 60, total: 100 },
                functions: { pct: 60, covered: 30, total: 50 },
                branches: { pct: 60, covered: 24, total: 40 },
              } 
            },
            { 
              date: date2, 
              overall: { 
                lines: { pct: 70, covered: 70, total: 100 },
                statements: { pct: 70, covered: 70, total: 100 },
                functions: { pct: 70, covered: 35, total: 50 },
                branches: { pct: 70, covered: 28, total: 40 },
              } 
            },
          ],
        })
      );

      const summary = {
        timestamp: new Date().toISOString(),
        overall: {
          lines: { pct: 75, covered: 75, total: 100 },
          statements: { pct: 75, covered: 75, total: 100 },
          functions: { pct: 75, covered: 75, total: 100 },
          branches: { pct: 75, covered: 75, total: 100 },
        },
        files: [],
        untestedFiles: ["untested.ts"],
        lowCoverageFiles: [],
      };

      const formatted = formatCoverageSummary(summary);

      expect(formatted).toContain("75.0%");
      expect(formatted).toContain("📈");
      expect(formatted).toContain("+10.0%");
    });
  });
});
