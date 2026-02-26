import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { log } from "../util/log.js";
import { rollbackToMain, rebuild, getCurrentBranch } from "./git-ops.js";
import { STATE_PATH } from "./paths.js";

const CRASH_THRESHOLD_MS = 15_000; // 15 seconds
const MAX_CRASHES = 3;
// After rollback to main, if main also crashes this many times, enter safe mode
const MAX_MAIN_CRASHES = 3;

interface RuntimeState {
  version?: string;
  cycle?: number;
  lastBoot?: string;
  crashCount?: number;
  safeMode?: boolean;
  [key: string]: unknown;
}

export interface CrashLoopResult {
  /** Whether the process should enter safe mode (TG bot only, no agent) */
  safeMode: boolean;
}

/**
 * Checks if the process is in a crash loop.
 * Should be called synchronously at the very beginning of main().
 *
 * Recovery strategy:
 * 1. On dev branch with MAX_CRASHES rapid crashes → rollback to main, restart
 * 2. On main branch with MAX_MAIN_CRASHES rapid crashes → enter safe mode
 *    (only start Telegram bot, no agent/consciousness — lets owner investigate)
 */
export function checkCrashLoopAndRecover(): CrashLoopResult {
  try {
    if (!existsSync(STATE_PATH)) return { safeMode: false };

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
        // Stable boot — reset crash counter and exit safe mode
        state.crashCount = 0;
        if (state.safeMode) {
          log.info("Stable boot detected, exiting safe mode");
          state.safeMode = false;
        }
      }
    } else {
      state.crashCount = 0;
    }

    state.lastBoot = new Date(now).toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

    if (state.crashCount >= MAX_CRASHES) {
      const branch = getCurrentBranch();

      if (branch !== "main") {
        // On dev: rollback to main
        log.error(`Crash loop detected on ${branch} (${state.crashCount} crashes). Rolling back to main.`);

        const rolledBack = rollbackToMain();
        if (rolledBack) {
          rebuild();
          log.info("Rollback successful. Exiting to allow PM2 to restart with main branch code.");

          // Reset crash count so the next boot on main starts fresh
          state.crashCount = 0;
          state.safeMode = false;
          writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

          process.exit(1);
        } else {
          log.error("Emergency rollback failed!");
        }
      }

      if (branch === "main" && state.crashCount >= MAX_MAIN_CRASHES) {
        // On main and still crashing — enter safe mode
        log.error(`Crash loop on main branch (${state.crashCount} crashes). Entering safe mode.`);
        state.safeMode = true;
        writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
        return { safeMode: true };
      }
    }

    // Check if we were previously in safe mode and haven't recovered yet
    if (state.safeMode) {
      log.warn("Resuming in safe mode from previous crash loop");
      return { safeMode: true };
    }

    return { safeMode: false };
  } catch (e) {
    const err = e as Error;
    log.error("Failed to check crash loop", { error: err.message });
    return { safeMode: false };
  }
}

/**
 * Call this before a planned restart to reset the crash counter,
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
    // Ignore — best effort
  }
}
