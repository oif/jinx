/**
 * EVOLOG.md Statistics Synchronization Utility
 * 
 * Automatically updates EVOLOG.md statistics based on package.json version
 * and provided cycle information. Eliminates manual number updating.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { log } from "./log.js";

const EVOLOG_PATH = "EVOLOG.md";
const PKG_PATH = "package.json";

/**
 * Get current version from package.json
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
    return pkg.version || "0.0.0";
  } catch (e) {
    log.error("Failed to read package.json", { error: (e as Error).message });
    return "0.0.0";
  }
}

/**
 * Extract cycle number from version (e.g., "0.0.62" -> 62 cycles if starting from 0.0.0)
 * Or use provided cycle number
 */
export function extractCycleFromVersion(version: string, offset: number = 0): number {
  const parts = version.split(".").map(Number);
  // version format: major.minor.patch
  // if we started at 0.0.0, total cycles = patch + minor*100 + major*10000
  const cycle = parts[2] + parts[1] * 100 + parts[0] * 10000;
  return cycle + offset;
}

interface EvologStats {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  skippedCycles: number;
  currentStreak: number;
  longestStreak: number;
}

/**
 * Read current EVOLOG.md statistics
 */
export function readCurrentStats(): EvologStats | null {
  try {
    const content = readFileSync(EVOLOG_PATH, "utf-8");
    
    const totalMatch = content.match(/\|\s*Total Cycles\s*\|\s*(\d+)\s*\|/);
    const successfulMatch = content.match(/\|\s*Successful\s*\|\s*(\d+)\s*\|/);
    const failedMatch = content.match(/\|\s*Failed\s*\|\s*(\d+)\s*\|/);
    const skippedMatch = content.match(/\|\s*Skipped\s*\|\s*(\d+)\s*\|/);
    const streakMatch = content.match(/\|\s*Current Streak\s*\|\s*(\d+)\s*\|/);
    const longestMatch = content.match(/\|\s*Longest Streak\s*\|\s*(\d+)\s*\|/);
    
    return {
      totalCycles: totalMatch ? parseInt(totalMatch[1], 10) : 0,
      successfulCycles: successfulMatch ? parseInt(successfulMatch[1], 10) : 0,
      failedCycles: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      skippedCycles: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
      currentStreak: streakMatch ? parseInt(streakMatch[1], 10) : 0,
      longestStreak: longestMatch ? parseInt(longestMatch[1], 10) : 0,
    };
  } catch (e) {
    log.error("Failed to read EVOLOG.md", { error: (e as Error).message });
    return null;
  }
}

/**
 * Update EVOLOG.md with new statistics
 */
export function updateEvologStats(stats: EvologStats, lastSuccessTime?: string): void {
  try {
    let content = readFileSync(EVOLOG_PATH, "utf-8");
    
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
    
    // Update Last Success timestamp
    if (lastSuccessTime) {
      const formattedTime = new Date(lastSuccessTime).toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      content = content.replace(
        /(\*\*Last Success:\*\*).*/,
        `$1 ${formattedTime}`
      );
    }
    
    writeFileSync(EVOLOG_PATH, content);
    log.info("Updated EVOLOG.md statistics", { stats });
  } catch (e) {
    log.error("Failed to update EVOLOG.md", { error: (e as Error).message });
    throw e;
  }
}

/**
 * Increment statistics for a successful evolution cycle
 */
export function incrementSuccessfulCycle(): void {
  const stats = readCurrentStats();
  if (!stats) {
    throw new Error("Could not read current EVOLOG.md stats");
  }
  
  const newStats: EvologStats = {
    totalCycles: stats.totalCycles + 1,
    successfulCycles: stats.successfulCycles + 1,
    failedCycles: stats.failedCycles,
    skippedCycles: stats.skippedCycles,
    currentStreak: stats.currentStreak + 1,
    longestStreak: Math.max(stats.longestStreak, stats.currentStreak + 1),
  };
  
  updateEvologStats(newStats, new Date().toISOString());
}

/**
 * Increment statistics for a failed evolution cycle
 */
export function incrementFailedCycle(): void {
  const stats = readCurrentStats();
  if (!stats) {
    throw new Error("Could not read current EVOLOG.md stats");
  }
  
  const newStats: EvologStats = {
    totalCycles: stats.totalCycles + 1,
    successfulCycles: stats.successfulCycles,
    failedCycles: stats.failedCycles + 1,
    skippedCycles: stats.skippedCycles,
    currentStreak: 0,
    longestStreak: stats.longestStreak,
  };
  
  updateEvologStats(newStats);
}

/**
 * Main function to auto-sync EVOLOG.md after a successful evolution
 */
export function syncAfterEvolution(): void {
  const version = getPackageVersion();
  log.info("Syncing EVOLOG.md after evolution", { version });
  incrementSuccessfulCycle();
}

// CLI usage: npx tsx src/util/evolog-sync.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  try {
    switch (command) {
      case "success":
        incrementSuccessfulCycle();
        console.log("✓ Incremented successful cycle");
        break;
      case "fail":
        incrementFailedCycle();
        console.log("✓ Incremented failed cycle");
        break;
      default:
        syncAfterEvolution();
        console.log("✓ Synced EVOLOG.md after evolution");
    }
  } catch (e) {
    console.error("Failed to sync:", (e as Error).message);
    process.exit(1);
  }
}
