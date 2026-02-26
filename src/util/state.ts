import { readFileSync, existsSync } from "node:fs";
import { STATE_PATH, EVOLOG_PATH, PACKAGE_PATH } from "../supervisor/paths.js";

export interface State {
  version: string;
  cycle: number;
  evolutionEnabled: boolean;
  lastRestart: string | null;
  lastEvolution: string | null;
  [key: string]: unknown;
}

/**
 * Read cycle count from EVOLOG.md (git-tracked).
 * Falls back to 0 if EVOLOG.md doesn't exist or has no cycles.
 */
function readCycleFromEvolog(): number {
  try {
    const content = readFileSync(EVOLOG_PATH, "utf-8");
    // Match "Total Cycles | N" or "Cycle #N" patterns
    const match = content.match(/\|\s*Total Cycles\s*\|\s*(\d+)\s*\|/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Fallback: count "### ✅ Cycle #N" occurrences
    const cycleMatches = content.match(/Cycle\s+#(\d+)/g);
    if (cycleMatches) {
      return cycleMatches.length;
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
 * - cycle from EVOLOG.md (git-tracked, persistent)
 * - other fields from state.json (runtime state)
 */
export function readState(): State {
  // Git-tracked values
  const version = readVersion();
  const cycle = readCycleFromEvolog();

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
