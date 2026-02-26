/**
 * EVOLOG.md Statistics Synchronization Utility
 * 
 * Automatically updates EVOLOG.md statistics based on package.json version
 * and provided cycle information. Eliminates manual number updating.
 * 
 * Now with dependency injection support for testing!
 */

import { readFileSync, writeFileSync } from "node:fs";
import { log } from "./log.js";

const DEFAULT_EVOLOG_PATH = "EVOLOG.md";
const PKG_PATH = "package.json";

// File system interface for dependency injection
export interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
}

// Real file system implementation
export const realFileSystem: FileSystem = {
  readFile(path: string): string {
    return readFileSync(path, "utf-8");
  },
  writeFile(path: string, content: string): void {
    writeFileSync(path, content);
  },
};

// In-memory file system for testing
export function createMemoryFileSystem(initialFiles: Record<string, string> = {}): FileSystem {
  const files = { ...initialFiles };
  return {
    readFile(path: string): string {
      if (!(path in files)) {
        throw new Error(`File not found: ${path}`);
      }
      return files[path];
    },
    writeFile(path: string, content: string): void {
      files[path] = content;
    },
  };
}

// Global file system instance (can be overridden for testing)
let fileSystem: FileSystem = realFileSystem;

/**
 * Set the file system implementation (for testing)
 */
export function setFileSystem(fs: FileSystem): void {
  fileSystem = fs;
}

/**
 * Reset to real file system (after testing)
 */
export function resetFileSystem(): void {
  fileSystem = realFileSystem;
}

/**
 * Get current file system
 */
export function getFileSystem(): FileSystem {
  return fileSystem;
}

/**
 * Get current version from package.json
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fileSystem.readFile(PKG_PATH));
    return pkg.version || "0.0.0";
  } catch (e) {
    log.error("Failed to read package.json", { error: (e as Error).message });
    return "0.0.0";
  }
}

/**
 * Extract cycle number from version
 */
export function extractCycleFromVersion(version: string, offset: number = 0): number {
  const parts = version.split(".").map(Number);
  const cycle = parts[2] + parts[1] * 100 + parts[0] * 10000;
  return cycle + offset;
}

export interface EvologStats {
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
export function readCurrentStats(evologPath: string = DEFAULT_EVOLOG_PATH): EvologStats | null {
  try {
    const content = fileSystem.readFile(evologPath);
    
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
export function updateEvologStats(
  stats: EvologStats, 
  lastSuccessTime?: string,
  evologPath: string = DEFAULT_EVOLOG_PATH
): void {
  try {
    let content = fileSystem.readFile(evologPath);
    
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
    
    fileSystem.writeFile(evologPath, content);
    log.info("Updated EVOLOG.md statistics", { stats });
  } catch (e) {
    log.error("Failed to update EVOLOG.md", { error: (e as Error).message });
    throw e;
  }
}

/**
 * Increment statistics for a successful evolution cycle
 */
export function incrementSuccessfulCycle(evologPath: string = DEFAULT_EVOLOG_PATH): void {
  const stats = readCurrentStats(evologPath);
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
  
  updateEvologStats(newStats, new Date().toISOString(), evologPath);
}

/**
 * Increment statistics for a failed evolution cycle
 */
export function incrementFailedCycle(evologPath: string = DEFAULT_EVOLOG_PATH): void {
  const stats = readCurrentStats(evologPath);
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
  
  updateEvologStats(newStats, undefined, evologPath);
}

/**
 * Main function to auto-sync EVOLOG.md after a successful evolution
 */
export function syncAfterEvolution(evologPath: string = DEFAULT_EVOLOG_PATH): void {
  const version = getPackageVersion();
  log.info("Syncing EVOLOG.md after evolution", { version });
  incrementSuccessfulCycle(evologPath);
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
