import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_PATH, PACKAGE_PATH, DATA_DIR } from "../supervisor/paths.js";

export interface State {
  version: string;
  cycle: number;
  lastRestart: string | null;
  lastEvolution: string | null;
  lastBoot: string | null;
  crashCount: number;
  [key: string]: unknown;
}

const HISTORY_PATH = join(DATA_DIR, "evolution-history.json");

/**
 * Read cycle count from evolution-history.json.
 * Falls back to 0 if file doesn't exist or is empty.
 */
function readCycleFromHistory(): number {
  try {
    if (!existsSync(HISTORY_PATH)) {
      return 0;
    }
    const history = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    if (Array.isArray(history) && history.length > 0) {
      // Get the highest cycle number from history
      return Math.max(...history.map((h: { cycle?: number }) => h.cycle || 0));
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Read the current version from package.json (git-tracked).
 * Falls back to "0.0.1" if not found.
 */
export function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_PATH, "utf-8"));
    return pkg.version || "0.0.1";
  } catch {
    return "0.0.1";
  }
}

/**
 * Initialize state.json with default values if it doesn't exist.
 * This ensures state.json exists after system startup.
 */
function initializeStateFile(): void {
  if (!existsSync(STATE_PATH)) {
    const defaultState = {
      lastRestart: new Date().toISOString(),
      lastEvolution: null,
      lastBoot: null,
      crashCount: 0,
    };
    writeFileSync(STATE_PATH, JSON.stringify(defaultState, null, 2));
  }
}

/**
 * Read the full state, merging:
 * - version from package.json (git-tracked)
 * - cycle from evolution-history.json (calculated from actual records)
 * - other fields from state.json (runtime state)
 *
 * If state.json doesn't exist, it will be initialized with defaults.
 */
export function readState(): State {
  // Git-tracked values
  const version = readVersion();
  const cycle = readCycleFromHistory();

  // Ensure state.json exists (initialization fix for #120)
  initializeStateFile();

  // Runtime state from state.json
  try {
    const runtimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    return {
      ...runtimeState,
      version, // Always use git-tracked version
      cycle,   // Always use git-tracked cycle
      lastRestart: runtimeState.lastRestart || null,
      lastEvolution: runtimeState.lastEvolution || null,
      lastBoot: runtimeState.lastBoot || null,
      crashCount: runtimeState.crashCount ?? 0,
    };
  } catch {
    // This should rarely happen since we just initialized the file
    // But if it does, return defaults
    return {
      version,
      cycle,
      lastRestart: new Date().toISOString(),
      lastEvolution: null,
      lastBoot: null,
      crashCount: 0,
    };
  }
}
