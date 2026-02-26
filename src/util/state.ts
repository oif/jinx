import { readFileSync } from "node:fs";
import { join } from "node:path";

const STATE_PATH = join(process.cwd(), "data", "state.json");

export interface State {
  version: string;
  cycle: number;
  evolutionEnabled: boolean;
  lastRestart: string | null;
  lastEvolution: string | null;
  [key: string]: unknown;
}

/**
 * Read the current version from state.json.
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
 * Read the full state from state.json.
 */
export function readState(): State {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {
      version: "0.0.1",
      cycle: 0,
      evolutionEnabled: false,
      lastRestart: null,
      lastEvolution: null,
    };
  }
}
