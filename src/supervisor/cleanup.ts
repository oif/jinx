import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { SESSIONS_DIR } from "./paths.js";

const DEFAULT_MAX_SESSIONS = 5;

/**
 * Parse max sessions to keep from environment variable.
 * Returns default if env var is not set or invalid.
 */
function getMaxSessionsToKeep(): number {
  const env = process.env.CLEANUP_MAX_SESSIONS_TO_KEEP;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    log.warn(`Invalid CLEANUP_MAX_SESSIONS_TO_KEEP value: ${env}, using default: ${DEFAULT_MAX_SESSIONS}`);
  }
  return DEFAULT_MAX_SESSIONS;
}

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
      .sort((a, b) => b.mtime - a.mtime);

    const maxSessions = getMaxSessionsToKeep();
    if (files.length > maxSessions) {
      const toDelete = files.slice(maxSessions);
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
