/**
 * Smart Wake-up Scheduler
 * 
 * Eliminates meaningless periodic wake-ups by using condition-based triggers.
 * 
 * Usage:
 * - By default: Only wake when there's actual work
 * - Conditions: testFailure, diskSpace, scheduledTime, telegramMessage
 * - Intervals: Minimum 1 hour recommended (not 5 minutes!)
 * 
 * Configuration: data/scheduler.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { log } from "./util/log.js";

const SCHEDULER_PATH = "data/scheduler.json";
const DEFAULT_CONFIG: SchedulerConfig = {
  mode: "conditional", // "conditional" | "interval" | "manual"
  minIntervalMinutes: 60, // Minimum 1 hour between checks
  conditions: {
    onTestFailure: true,
    onDiskSpaceLow: true, // < 10%
    onTelegramMessage: true,
    onSchedule: [], // Specific times ["09:00", "18:00"]
  },
  lastWakeTime: new Date().toISOString(),
  wakeCount: 0,
};

export interface SchedulerConfig {
  mode: "conditional" | "interval" | "manual";
  minIntervalMinutes: number;
  conditions: {
    onTestFailure: boolean;
    onDiskSpaceLow: boolean;
    onTelegramMessage: boolean;
    onSchedule: string[];
  };
  lastWakeTime: string;
  wakeCount: number;
}

/**
 * Load scheduler configuration
 */
export function loadConfig(): SchedulerConfig {
  try {
    if (existsSync(SCHEDULER_PATH)) {
      const config = JSON.parse(readFileSync(SCHEDULER_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...config };
    }
  } catch (e) {
    log.error("Failed to load scheduler config", { error: (e as Error).message });
  }
  return DEFAULT_CONFIG;
}

/**
 * Save scheduler configuration
 */
export function saveConfig(config: SchedulerConfig): void {
  try {
    writeFileSync(SCHEDULER_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    log.error("Failed to save scheduler config", { error: (e as Error).message });
  }
}

/**
 * Check if tests are passing
 */
export function checkTests(): { passing: boolean; failed: number } {
  try {
    const result = execSync("npm test 2>&1", { encoding: "utf-8", timeout: 120000 });
    const failedMatch = result.match(/(\d+) failed/);
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    return { passing: failed === 0, failed };
  } catch (e) {
    // npm test returns non-zero if tests fail
    return { passing: false, failed: 1 };
  }
}

/**
 * Check disk space
 */
export function checkDiskSpace(): { ok: boolean; percentUsed: number } {
  try {
    const result = execSync("df -h / | tail -1", { encoding: "utf-8" });
    const match = result.match(/(\d+)%/);
    if (match) {
      const percentUsed = parseInt(match[1], 10);
      return { ok: percentUsed < 90, percentUsed };
    }
  } catch (e) {
    log.error("Failed to check disk space", { error: (e as Error).message });
  }
  return { ok: true, percentUsed: 0 };
}

/**
 * Check if minimum interval has passed
 */
export function hasMinIntervalPassed(config: SchedulerConfig): boolean {
  const lastWake = new Date(config.lastWakeTime);
  const now = new Date();
  const minutesSinceLastWake = (now.getTime() - lastWake.getTime()) / (1000 * 60);
  return minutesSinceLastWake >= config.minIntervalMinutes;
}

/**
 * Check if it's a scheduled time
 */
export function isScheduledTime(config: SchedulerConfig): boolean {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return config.conditions.onSchedule.includes(currentTime);
}

/**
 * Determine if wake-up is needed
 */
export function shouldWake(): { wake: boolean; reason: string } {
  const config = loadConfig();
  
  // Always allow manual wake-ups (when explicitly called)
  if (process.env.FORCE_WAKE === "true") {
    return { wake: true, reason: "manual" };
  }
  
  // Manual mode: never auto-wake
  if (config.mode === "manual") {
    return { wake: false, reason: "manual_mode" };
  }
  
  // Check minimum interval
  if (!hasMinIntervalPassed(config)) {
    const lastWake = new Date(config.lastWakeTime);
    const minutesAgo = Math.floor((Date.now() - lastWake.getTime()) / (1000 * 60));
    return { 
      wake: false, 
      reason: `too_soon (${minutesAgo}m ago, min ${config.minIntervalMinutes}m)` 
    };
  }
  
  // Check conditions
  if (config.conditions.onTestFailure) {
    const tests = checkTests();
    if (!tests.passing) {
      return { wake: true, reason: `test_failure (${tests.failed} failed)` };
    }
  }
  
  if (config.conditions.onDiskSpaceLow) {
    const disk = checkDiskSpace();
    if (!disk.ok) {
      return { wake: true, reason: `disk_space_low (${disk.percentUsed}%)` };
    }
  }
  
  if (config.conditions.onSchedule.length > 0) {
    if (isScheduledTime(config)) {
      return { wake: true, reason: "scheduled_time" };
    }
  }
  
  // Interval mode: only wake if interval passed AND no conditions block
  if (config.mode === "interval") {
    return { wake: true, reason: "interval_elapsed" };
  }
  
  // Conditional mode: only wake if there's a condition
  return { wake: false, reason: "no_conditions_met" };
}

/**
 * Record wake-up
 */
export function recordWake(): void {
  const config = loadConfig();
  config.lastWakeTime = new Date().toISOString();
  config.wakeCount++;
  saveConfig(config);
}

/**
 * Get status report
 */
export function getStatus(): string {
  const config = loadConfig();
  const tests = checkTests();
  const disk = checkDiskSpace();
  const should = shouldWake();
  
  return `
📊 Scheduler Status
━━━━━━━━━━━━━━━━━━━
Mode: ${config.mode}
Last wake: ${new Date(config.lastWakeTime).toLocaleString()}
Total wakes: ${config.wakeCount}
Min interval: ${config.minIntervalMinutes} minutes

Conditions:
  • Test failure: ${config.conditions.onTestFailure ? "ON" : "OFF"} (currently: ${tests.passing ? "PASSING" : "FAILING"})
  • Disk space: ${config.conditions.onDiskSpaceLow ? "ON" : "OFF"} (currently: ${disk.percentUsed}%)
  • Telegram: ${config.conditions.onTelegramMessage ? "ON" : "OFF"}
  • Scheduled times: ${config.conditions.onSchedule.length > 0 ? config.conditions.onSchedule.join(", ") : "NONE"}

Should wake: ${should.wake ? "YES" : "NO"}
Reason: ${should.reason}
━━━━━━━━━━━━━━━━━━━
`;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  switch (command) {
    case "status":
      console.log(getStatus());
      break;
    case "check":
      const result = shouldWake();
      console.log(result.wake ? `WAKE: ${result.reason}` : `SKIP: ${result.reason}`);
      process.exit(result.wake ? 0 : 1);
    case "record":
      recordWake();
      console.log("✓ Wake recorded");
      break;
    default:
      console.log("Usage: npx tsx src/scheduler.ts [status|check|record]");
      console.log("\nRecommended crontab:");
      console.log("  */30 * * * * cd /root/jinx && npx tsx src/scheduler.ts check && npm run wake");
  }
}
