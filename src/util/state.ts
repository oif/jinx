import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(process.cwd(), "data", "state.json");
const EVOLOG_PATH = join(process.cwd(), "EVOLOG.md");

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
 * Read the current version from state.json.
 * Falls back to "0.0.1" if not found.
 */
export function readVersion(): string {
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    return state.version || "0.0.1";
  } catch {
    return "0.0.1";
  }
}

/**
 * Read the full state, merging:
 * - cycle from EVOLOG.md (git-tracked, persistent)
 * - other fields from state.json (runtime state)
 */
export function readState(): State {
  // Cycle comes from EVOLOG.md (git-tracked)
  const cycle = readCycleFromEvolog();

  // Other state comes from state.json (runtime)
  try {
    const runtimeState = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    return {
      ...runtimeState,
      version: runtimeState.version || "0.0.1",
      cycle, // Always use git-tracked cycle from EVOLOG
      evolutionEnabled: runtimeState.evolutionEnabled ?? false,
      lastRestart: runtimeState.lastRestart || null,
      lastEvolution: runtimeState.lastEvolution || null,
    };
  } catch {
    // state.json doesn't exist - return defaults with git-tracked cycle
    return {
      version: "0.0.1",
      cycle,
      evolutionEnabled: false,
      lastRestart: null,
      lastEvolution: null,
    };
  }
}
