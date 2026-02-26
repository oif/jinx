import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";

// Set up fixture path before importing module
const FIXTURE_DIR = "test/fixtures";
const TEST_EVOLOG_PATH = `${FIXTURE_DIR}/test-evolog.md`;
const REAL_EVOLOG_PATH = "EVOLOG.md";
const BACKUP_PATH = `${FIXTURE_DIR}/evolog-backup.md`;

// Sample EVOLOG content for testing
const sampleEvolog = `# Evolution Log

> Auto-generated record of Jinx's growth and evolution cycles.

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Total Cycles | 50 |
| Successful | 49 |
| Failed | 1 |
| Skipped | 0 |
| Current Streak | 34 |
| Longest Streak | 35 |

**Last Success:** 2/26/2026, 2:57:15 PM

## 📜 Evolution History

Test fixture file for evolog-sync tests.
`;

// Backup real EVOLOG.md and create fixture before all tests
let realContent: string;

beforeAll(() => {
  // Ensure fixture directory exists
  if (!existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  }
  
  // Backup real EVOLOG.md
  realContent = readFileSync(REAL_EVOLOG_PATH, "utf-8");
  writeFileSync(BACKUP_PATH, realContent);
  
  // Write fixture to real EVOLOG.md location for tests
  writeFileSync(REAL_EVOLOG_PATH, sampleEvolog);
});

// Restore real EVOLOG.md after all tests
afterAll(() => {
  // Restore from backup
  writeFileSync(REAL_EVOLOG_PATH, realContent);
});

// Now import the module (it will read the fixture we just wrote)
const { 
  getPackageVersion, 
  extractCycleFromVersion,
  readCurrentStats,
  updateEvologStats,
  incrementSuccessfulCycle,
  incrementFailedCycle 
} = await import("../src/util/evolog-sync.js");

describe("evolog-sync", () => {
  describe("getPackageVersion", () => {
    it("should return a valid version string", () => {
      const version = getPackageVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("extractCycleFromVersion", () => {
    it("should extract cycle from patch version", () => {
      expect(extractCycleFromVersion("0.0.62")).toBe(62);
    });

    it("should extract cycle from minor version", () => {
      expect(extractCycleFromVersion("0.1.0")).toBe(100);
    });

    it("should handle offset", () => {
      expect(extractCycleFromVersion("0.0.1", 10)).toBe(11);
    });
  });

  describe("readCurrentStats", () => {
    it("should read current stats from EVOLOG.md (fixture)", () => {
      const stats = readCurrentStats();
      expect(stats).not.toBeNull();
      expect(stats?.totalCycles).toBe(50);
      expect(stats?.successfulCycles).toBe(49);
    });
  });

  describe("updateEvologStats", () => {
    it("should update statistics correctly", () => {
      const testStats = {
        totalCycles: 51,
        successfulCycles: 50,
        failedCycles: 1,
        skippedCycles: 0,
        currentStreak: 35,
        longestStreak: 35,
      };
      
      expect(() => updateEvologStats(testStats, "2026-02-26T15:00:00.000Z")).not.toThrow();
      
      const updatedContent = readFileSync(REAL_EVOLOG_PATH, "utf-8");
      expect(updatedContent).toContain("| Total Cycles | 51 |");
      expect(updatedContent).toContain("| Successful | 50 |");
    });
  });

  describe("incrementSuccessfulCycle", () => {
    it("should increment successful cycle stats", () => {
      // Reset to known state first
      writeFileSync(REAL_EVOLOG_PATH, sampleEvolog);
      
      const beforeStats = readCurrentStats();
      expect(beforeStats).not.toBeNull();
      
      incrementSuccessfulCycle();
      
      const afterStats = readCurrentStats();
      expect(afterStats).not.toBeNull();
      expect(afterStats!.totalCycles).toBe(51);
      expect(afterStats!.successfulCycles).toBe(50);
      expect(afterStats!.currentStreak).toBe(35);
    });
  });

  describe("incrementFailedCycle", () => {
    it("should increment failed cycle stats and reset streak", () => {
      // Reset to known state
      let content = sampleEvolog;
      content = content.replace(/\|\s*Total Cycles\s*\|\s*\d+\s*\|/, "| Total Cycles | 60 |");
      content = content.replace(/\|\s*Failed\s*\|\s*\d+\s*\|/, "| Failed | 5 |");
      content = content.replace(/\|\s*Current Streak\s*\|\s*\d+\s*\|/, "| Current Streak | 10 |");
      content = content.replace(/\|\s*Longest Streak\s*\|\s*\d+\s*\|/, "| Longest Streak | 25 |");
      writeFileSync(REAL_EVOLOG_PATH, content);
      
      const beforeStats = readCurrentStats();
      expect(beforeStats).not.toBeNull();
      
      incrementFailedCycle();
      
      const afterStats = readCurrentStats();
      expect(afterStats).not.toBeNull();
      expect(afterStats!.totalCycles).toBe(61);
      expect(afterStats!.failedCycles).toBe(6);
      expect(afterStats!.currentStreak).toBe(0);
      expect(afterStats!.longestStreak).toBe(25);
    });
  });
});
