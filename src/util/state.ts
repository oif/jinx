import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATE_PATH, PACKAGE_PATH, DATA_DIR } from "../supervisor/paths.js";

export interface State {
  version: string;
  cycle: number;
  evolutionEnabled: boolean;
  lastRestart: string | null;
  lastEvolution: string | null;
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
 * Read the full state, merging:
 * - version from package.json (git-tracked)
 * - cycle from evolution-history.json (calculated from actual records)
 * - other fields from state.json (runtime state)
 */
export function readState(): State {
  // Git-tracked values
  const version = readVersion();
  const cycle = readCycleFromHistory();

  // Runtime state from state.json
  try {
    const runtimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    return {
      ...runtimeState,
      version, // Always use git-tracked version
      cycle,   // Always use git-tracked cycle
      evolutionEnabled: runtimeState.evolutionEnabled ?? false,
      lastRestart: runtimeState.lastRestart || null,
      lastEvolution: runtimeState.lastEvolution || null,
    };
  } catch {
    // state.json doesn't exist - return defaults with git-tracked values
    return {
      version,
      cycle,
      evolutionEnabled: false,
      lastRestart: null,
      lastEvolution: null,
    };
  }
}
