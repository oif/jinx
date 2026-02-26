import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { log } from "../util/log.js";
import { rollbackToMain, rebuild, getCurrentSha } from "./git-ops.js";
import { STATE_PATH } from "./paths.js";

const CRASH_THRESHOLD_MS = 15000;
const MAX_CRASHES = 3;

interface RuntimeState {
  version?: string;
  cycle?: number;
  lastBoot?: string;
  crashCount?: number;
  [key: string]: unknown;
}

export function checkCrashLoopAndRecover(): void {
  try {
    if (!existsSync(STATE_PATH)) return;

    const state: RuntimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    const now = Date.now();

    if (state.lastBoot) {
      const lastBootMs = new Date(state.lastBoot).getTime();
      const timeSinceLastBoot = now - lastBootMs;

      if (timeSinceLastBoot < CRASH_THRESHOLD_MS) {
        state.crashCount = (state.crashCount || 0) + 1;
        log.warn(`Rapid crash detected! Count: ${state.crashCount}`);
      } else {
        state.crashCount = 0;
      }
    } else {
      state.crashCount = 0;
    }

    state.lastBoot = new Date(now).toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

    if (state.crashCount >= MAX_CRASHES) {
      log.error(`Crash loop detected (${state.crashCount} crashes). Executing emergency rollback to main branch.`);
      
      const rolledBack = rollbackToMain();
      if (rolledBack) {
        rebuild();
        log.info("Rollback successful. Exiting to allow PM2 to restart with main branch code.");
        
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

export function markIntentionalRestart(): void {
  try {
    if (!existsSync(STATE_PATH)) return;
    const state: RuntimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    state.crashCount = 0;
    state.lastBoot = new Date(0).toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Ignore
  }
}
