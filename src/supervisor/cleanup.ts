import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

const DATA_DIR = join(process.cwd(), "data");
const SESSIONS_DIR = join(DATA_DIR, "sessions");
const MAX_SESSIONS_TO_KEEP = 5;

/**
 * Periodically clean up old agent sessions to prevent disk bloat.
 * Keeps the most recent N sessions.
 */
export function cleanupOldSessions(): void {
  if (!existsSync(SESSIONS_DIR)) {
    return;
  }

  try {
    const files = readdirSync(SESSIONS_DIR)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => {
        const fullPath = join(SESSIONS_DIR, file);
        return {
          path: fullPath,
          mtime: statSync(fullPath).mtime.getTime(),
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    if (files.length > MAX_SESSIONS_TO_KEEP) {
      const toDelete = files.slice(MAX_SESSIONS_TO_KEEP);
      for (const file of toDelete) {
        unlinkSync(file.path);
        log.info("Deleted old session file", { path: file.path });
      }
    }
  } catch (e) {
    const err = e as Error;
    log.error("Failed to clean up old sessions", { error: err.message });
  }
}
