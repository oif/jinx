import { join } from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = join(PROJECT_ROOT, "data");
export const STATE_PATH = join(DATA_DIR, "state.json");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");

// Restart marker file — used for agent→supervisor restart communication.
// Writer: restart.ts / tools.ts (writes .tmp then renames atomically)
// Reader: lifecycle.ts (renames to .processing then reads)
export const RESTART_MARKER = join(DATA_DIR, ".restart_requested");
export const RESTART_MARKER_TMP = join(DATA_DIR, ".restart_requested.tmp");
export const RESTART_MARKER_PROCESSING = join(DATA_DIR, ".restart_requested.processing");
