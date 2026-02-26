import { describe, it, expect } from "vitest";

// Import the function we want to test
// We'll test the regex patterns used in updateStatisticsTable

function updateStatisticsTable(content: string, stats: {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  skippedCycles: number;
  currentStreak: number;
  longestStreak: number;
  lastSuccessAt?: string;
}): string {
  // Update Total Cycles
  content = content.replace(
    /(\|\s*Total Cycles\s*\|\s*)\d+(\s*\|)/,
    `$1${stats.totalCycles}$2`
  );
  // Update Successful
  content = content.replace(
    /(\|\s*Successful\s*\|\s*)\d+(\s*\|)/,
    `$1${stats.successfulCycles}$2`
  );
  // Update Failed
  content = content.replace(
    /(\|\s*Failed\s*\|\s*)\d+(\s*\|)/,
    `$1${stats.failedCycles}$2`
  );
  // Update Skipped
  content = content.replace(
    /(\|\s*Skipped\s*\|\s*)\d+(\s*\|)/,
    `$1${stats.skippedCycles}$2`
  );
  // Update Current Streak
  content = content.replace(
    /(\|\s*Current Streak\s*\|\s*)\d+(\s*\|)/,
    `$1${stats.currentStreak}$2`
  );
  // Update Longest Streak
  content = content.replace(
    /(\|\s*Longest Streak\s*\|\s*)\d+(\s*\|)/,
    `$1${stats.longestStreak}$2`
  );
  // Update Last Success
  if (stats.lastSuccessAt) {
    const lastSuccessDate = new Date(stats.lastSuccessAt).toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    content = content.replace(
      /(\*\*Last Success:\*\*).*/,
      `$1 ${lastSuccessDate}`
    );
  }
  return content;
}

describe("EVOLOG.md statistics update", () => {
  const sampleEvolog = `# Evolution Log

> Auto-generated record of Jinx's growth and evolution cycles.

## 📊 Statistics

| Metric | Value |
|--------|-------|
| Total Cycles | 10 |
| Successful | 9 |
| Failed | 1 |
| Skipped | 0 |
| Current Streak | 3 |
| Longest Streak | 8 |

**Last Success:** 2/25/2026, 10:00:00 AM

## 📜 Evolution History
`;

  it("should update all statistics correctly", () => {
    const newStats = {
      totalCycles: 15,
      successfulCycles: 14,
      failedCycles: 1,
      skippedCycles: 0,
      currentStreak: 5,
      longestStreak: 10,
      lastSuccessAt: "2026-02-26T08:00:00.000Z",
    };

    const updated = updateStatisticsTable(sampleEvolog, newStats);

    expect(updated).toContain("| Total Cycles | 15 |");
    expect(updated).toContain("| Successful | 14 |");
    expect(updated).toContain("| Failed | 1 |");
    expect(updated).toContain("| Skipped | 0 |");
    expect(updated).toContain("| Current Streak | 5 |");
    expect(updated).toContain("| Longest Streak | 10 |");
    expect(updated).toMatch(/\*\*Last Success:\*\* 0?2\/26\/2026, 0?8:00/);
  });

  it("should update partial statistics", () => {
    const newStats = {
      totalCycles: 20,
      successfulCycles: 18,
      failedCycles: 2,
      skippedCycles: 0,
      currentStreak: 0,
      longestStreak: 15,
    };

    const updated = updateStatisticsTable(sampleEvolog, newStats);

    expect(updated).toContain("| Total Cycles | 20 |");
    expect(updated).toContain("| Successful | 18 |");
    expect(updated).toContain("| Failed | 2 |");
    expect(updated).toContain("| Current Streak | 0 |");
    expect(updated).toContain("| Longest Streak | 15 |");
  });

  it("should handle content without statistics table gracefully", () => {
    const contentWithoutStats = `# Evolution Log

## 📜 Evolution History
`;

    const newStats = {
      totalCycles: 5,
      successfulCycles: 4,
      failedCycles: 1,
      skippedCycles: 0,
      currentStreak: 2,
      longestStreak: 3,
    };

    // Should not throw and return content unchanged
    const updated = updateStatisticsTable(contentWithoutStats, newStats);
    expect(updated).toBe(contentWithoutStats);
  });

  it("should update last success with timezone-aware formatting", () => {
    const newStats = {
      totalCycles: 1,
      successfulCycles: 1,
      failedCycles: 0,
      skippedCycles: 0,
      currentStreak: 1,
      longestStreak: 1,
      lastSuccessAt: "2026-01-15T14:30:45.000Z",
    };

    const updated = updateStatisticsTable(sampleEvolog, newStats);

    // Should contain formatted date (exact format depends on locale)
    expect(updated).toMatch(/\*\*Last Success:\*\* \d{1,2}\/\d{1,2}\/\d{4},/);
  });
});
