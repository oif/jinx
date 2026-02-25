import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { rollbackToMain, rebuild, getCurrentSha } from "./git-ops.js";

const STATE_PATH = join(process.cwd(), "data", "state.json");
const CRASH_THRESHOLD_MS = 15000; // 15 seconds
const MAX_CRASHES = 3;

interface RuntimeState {
  version?: string;
  cycle?: number;
  lastBoot?: string;
  crashCount?: number;
  [key: string]: unknown;
}

/**
 * Checks if the process is in a crash loop.
 * Should be called synchronously at the very beginning of main().
 */
export function checkCrashLoopAndRecover(): void {
  try {
    if (!existsSync(STATE_PATH)) return;

    const state: RuntimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    const now = Date.now();

    if (state.lastBoot) {
      const lastBootMs = new Date(state.lastBoot).getTime();
      const timeSinceLastBoot = now - lastBootMs;

      if (timeSinceLastBoot < CRASH_THRESHOLD_MS) {
        // We crashed rapidly!
        state.crashCount = (state.crashCount || 0) + 1;
        log.warn(`Rapid crash detected! Count: ${state.crashCount}`);
      } else {
        // Stable boot
        state.crashCount = 0;
      }
    } else {
      state.crashCount = 0;
    }

    state.lastBoot = new Date(now).toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

    if (state.crashCount >= MAX_CRASHES) {
      log.error(`Crash loop detected (${state.crashCount} crashes). Executing emergency rollback to main branch.`);
      
      // Attempt rollback
      const rolledBack = rollbackToMain();
      if (rolledBack) {
        rebuild();
        log.info("Rollback successful. Exiting to allow PM2 to restart with main branch code.");
        
        // Reset crash count so we don't immediately rollback again if main is somehow broken too
        state.crashCount = 0;
        writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
        
        process.exit(1);
      } else {
        log.error("Emergency rollback failed!");
      }
    }
  } catch (e) {
    const err = e as Error;
    log.error("Failed to check crash loop", { error: err.message });
  }
}

/**
 * Optional: Call this after a successful intentional restart to reset the crash count,
 * so the next boot isn't mistakenly flagged as a crash if it happens quickly.
 */
export function markIntentionalRestart(): void {
  try {
    if (!existsSync(STATE_PATH)) return;
    const state: RuntimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    state.crashCount = 0;
    // Set lastBoot far into the past so the next boot isn't considered rapid
    state.lastBoot = new Date(0).toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Ignore
  }
}
