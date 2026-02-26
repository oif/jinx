import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  getPackageVersion, 
  extractCycleFromVersion,
  readCurrentStats,
  updateEvologStats,
  incrementSuccessfulCycle,
  incrementFailedCycle,
  setFileSystem,
  resetFileSystem,
  createMemoryFileSystem,
  type EvologStats,
} from "../src/util/evolog-sync.js";

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

describe("evolog-sync with dependency injection", () => {
  const TEST_PATH = "test-evolog.md";
  
  beforeEach(() => {
    // Set up memory file system with test data
    const memoryFs = createMemoryFileSystem({
      [TEST_PATH]: sampleEvolog,
    });
    setFileSystem(memoryFs);
  });

  afterEach(() => {
    // Reset to real file system
    resetFileSystem();
  });

  describe("getPackageVersion", () => {
    it("should return a valid version string", () => {
      // Use real file system for this test since it reads package.json
      resetFileSystem();
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

    it("should handle major version", () => {
      expect(extractCycleFromVersion("1.0.0")).toBe(10000);
    });

    it("should handle offset", () => {
      expect(extractCycleFromVersion("0.0.1", 10)).toBe(11);
    });
  });

  describe("readCurrentStats", () => {
    it("should read current stats from memory file system", () => {
      const stats = readCurrentStats(TEST_PATH);
      expect(stats).not.toBeNull();
      expect(stats?.totalCycles).toBe(50);
      expect(stats?.successfulCycles).toBe(49);
      expect(stats?.failedCycles).toBe(1);
      expect(stats?.currentStreak).toBe(34);
      expect(stats?.longestStreak).toBe(35);
    });
  });

  describe("updateEvologStats", () => {
    it("should update statistics correctly in memory", () => {
      const testStats: EvologStats = {
        totalCycles: 51,
        successfulCycles: 50,
        failedCycles: 1,
        skippedCycles: 0,
        currentStreak: 35,
        longestStreak: 35,
      };
      
      updateEvologStats(testStats, "2026-02-26T15:00:00.000Z", TEST_PATH);
      
      // Read back and verify
      const updatedStats = readCurrentStats(TEST_PATH);
      expect(updatedStats?.totalCycles).toBe(51);
      expect(updatedStats?.successfulCycles).toBe(50);
      expect(updatedStats?.currentStreak).toBe(35);
    });
  });

  describe("incrementSuccessfulCycle", () => {
    it("should increment successful cycle stats in memory", () => {
      const beforeStats = readCurrentStats(TEST_PATH);
      expect(beforeStats).not.toBeNull();
      
      incrementSuccessfulCycle(TEST_PATH);
      
      const afterStats = readCurrentStats(TEST_PATH);
      expect(afterStats).not.toBeNull();
      expect(afterStats!.totalCycles).toBe(51);
      expect(afterStats!.successfulCycles).toBe(50);
      expect(afterStats!.currentStreak).toBe(35);
    });
  });

  describe("incrementFailedCycle", () => {
    it("should increment failed cycle stats and reset streak in memory", () => {
      // Set up specific initial state
      const initialStats: EvologStats = {
        totalCycles: 60,
        successfulCycles: 59,
        failedCycles: 1,
        skippedCycles: 0,
        currentStreak: 10,
        longestStreak: 25,
      };
      updateEvologStats(initialStats, undefined, TEST_PATH);
      
      incrementFailedCycle(TEST_PATH);
      
      const afterStats = readCurrentStats(TEST_PATH);
      expect(afterStats).not.toBeNull();
      expect(afterStats!.totalCycles).toBe(61);
      expect(afterStats!.failedCycles).toBe(2);
      expect(afterStats!.currentStreak).toBe(0);
      expect(afterStats!.longestStreak).toBe(25); // Should not decrease
    });
  });
});
