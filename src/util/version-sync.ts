/**
 * Version synchronization utility
 * Automatically keeps version numbers in sync across all documentation files
 */

import { readFileSync, writeFileSync } from "node:fs";
import { log } from "./log.js";

const PKG_PATH = "package.json";
const IDENTITY_PATH = "data/identity.md";
const SCRATCHPAD_PATH = "data/scratchpad.md";

/**
 * Read current version from package.json
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
    return pkg.version || "0.0.0";
  } catch (e) {
    log.error("Failed to read package.json version", { error: (e as Error).message });
    return "0.0.0";
  }
}

/**
 * Update version in identity.md
 */
export function syncIdentityVersion(version: string, cycle: number, streak: number): void {
  try {
    let content = readFileSync(IDENTITY_PATH, "utf-8");
    
    // Update version
    content = content.replace(
      /-\s*\*\*版本\*\*:\s*[\d.]+/,
      `- **版本**: ${version}`
    );
    
    // Update cycle count
    content = content.replace(
      /-\s*\*\*进化循环\*\*:\s*\d+\s*次/,
      `- **进化循环**: ${cycle} 次`
    );
    
    // Update streak
    content = content.replace(
      /-\s*\*\*当前 streak\*\*:\s*\d+/,
      `- **当前 streak**: ${streak}`
    );
    
    writeFileSync(IDENTITY_PATH, content);
    log.info("Synced identity.md version", { version, cycle, streak });
  } catch (e) {
    log.error("Failed to sync identity.md", { error: (e as Error).message });
  }
}

/**
 * Update version in scratchpad.md
 */
export function syncScratchpadVersion(version: string, cycle: number, streak: number): void {
  try {
    let content = readFileSync(SCRATCHPAD_PATH, "utf-8");
    
    // Update version
    content = content.replace(
      /-\s*版本:\s*[\d.]+/,
      `- 版本: ${version}`
    );
    
    // Update cycle count
    content = content.replace(
      /进化循环\s*\d+\s*次/,
      `进化循环 ${cycle} 次`
    );
    
    // Update streak
    content = content.replace(
      /streak\s*\d+/,
      `streak ${streak}`
    );
    
    writeFileSync(SCRATCHPAD_PATH, content);
    log.info("Synced scratchpad.md version", { version, cycle, streak });
  } catch (e) {
    log.error("Failed to sync scratchpad.md", { error: (e as Error).message });
  }
}

/**
 * Sync all version numbers across documentation files
 */
export function syncAllVersions(cycle?: number, streak?: number): void {
  const version = getPackageVersion();
  const currentCycle = cycle ?? 0;
  const currentStreak = streak ?? 0;
  
  syncIdentityVersion(version, currentCycle, currentStreak);
  syncScratchpadVersion(version, currentCycle, currentStreak);
  
  log.info("Version sync completed", { 
    version, 
    cycle: currentCycle, 
    streak: currentStreak 
  });
}

// Auto-run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const cycle = parseInt(process.argv[2], 10) || 0;
  const streak = parseInt(process.argv[3], 10) || 0;
  syncAllVersions(cycle, streak);
  log.info("Version sync completed via CLI", { cycle, streak });
}
