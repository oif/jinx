import { join } from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = join(PROJECT_ROOT, "data");
export const STATE_PATH = join(DATA_DIR, "state.json");
export const SESSIONS_DIR = join(DATA_DIR, "sessions");

// Git-tracked files
export const PACKAGE_PATH = join(PROJECT_ROOT, "package.json");
export const BORN_PATH = join(PROJECT_ROOT, "BORN.md");
export const BACKLOG_PATH = join(PROJECT_ROOT, "data", "backlog.md");

// Evolution progress tracking
export const PROGRESS_PATH = join(DATA_DIR, "evolution-progress.json");

// Restart marker file — used for agent→supervisor restart communication.
// Writer: restart.ts / tools.ts (writes .tmp then renames atomically)
// Reader: lifecycle.ts (renames to .processing then reads)
export const RESTART_MARKER = join(DATA_DIR, ".restart_requested");
export const RESTART_MARKER_TMP = join(DATA_DIR, ".restart_requested.tmp");
export const RESTART_MARKER_PROCESSING = join(DATA_DIR, ".restart_requested.processing");
