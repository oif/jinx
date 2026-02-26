import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { 
  getPackageVersion, 
  extractCycleFromVersion,
  readCurrentStats,
  updateEvologStats,
  incrementSuccessfulCycle,
  incrementFailedCycle 
} from "../src/util/evolog-sync.js";

const TEST_EVOLOG_PATH = "test/fixtures/test-evolog.md";
const BACKUP_PATH = "test/fixtures/test-evolog.md.backup";

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

Some history here...
`;

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
    it("should read current stats from actual EVOLOG.md", () => {
      const stats = readCurrentStats();
      expect(stats).not.toBeNull();
      expect(stats?.totalCycles).toBeGreaterThan(0);
      expect(stats?.successfulCycles).toBeGreaterThan(0);
    });
  });

  describe("updateEvologStats", () => {
    it("should update statistics correctly", () => {
      // This test validates the regex patterns work
      const testContent = sampleEvolog;
      
      // Create a test file
      const testStats = {
        totalCycles: 51,
        successfulCycles: 50,
        failedCycles: 1,
        skippedCycles: 0,
        currentStreak: 35,
        longestStreak: 35,
      };
      
      // Test that the update doesn't throw
      expect(() => updateEvologStats(testStats, "2026-02-26T15:00:00.000Z")).not.toThrow();
      
      // Verify the update was applied by reading back
      const updatedContent = readFileSync("EVOLOG.md", "utf-8");
      expect(updatedContent).toContain("| Total Cycles | 51 |");
      expect(updatedContent).toContain("| Successful | 50 |");
    });
  });

  describe("incrementSuccessfulCycle", () => {
    it("should increment successful cycle stats", () => {
      // Get current stats
      const beforeStats = readCurrentStats();
      expect(beforeStats).not.toBeNull();
      
      // Store the values
      const beforeTotal = beforeStats!.totalCycles;
      const beforeSuccessful = beforeStats!.successfulCycles;
      const beforeStreak = beforeStats!.currentStreak;
      
      // Increment
      incrementSuccessfulCycle();
      
      // Read again
      const afterStats = readCurrentStats();
      expect(afterStats).not.toBeNull();
      
      // Verify increment
      expect(afterStats!.totalCycles).toBe(beforeTotal + 1);
      expect(afterStats!.successfulCycles).toBe(beforeSuccessful + 1);
      expect(afterStats!.currentStreak).toBe(beforeStreak + 1);
    });
  });

  describe("incrementFailedCycle", () => {
    it("should increment failed cycle stats and reset streak", () => {
      // Get current stats
      const beforeStats = readCurrentStats();
      expect(beforeStats).not.toBeNull();
      
      // Store the values
      const beforeTotal = beforeStats!.totalCycles;
      const beforeFailed = beforeStats!.failedCycles;
      const beforeLongest = beforeStats!.longestStreak;
      
      // Increment
      incrementFailedCycle();
      
      // Read again
      const afterStats = readCurrentStats();
      expect(afterStats).not.toBeNull();
      
      // Verify increment
      expect(afterStats!.totalCycles).toBe(beforeTotal + 1);
      expect(afterStats!.failedCycles).toBe(beforeFailed + 1);
      expect(afterStats!.currentStreak).toBe(0);
      expect(afterStats!.longestStreak).toBe(beforeLongest); // Should not decrease
    });
  });
});
