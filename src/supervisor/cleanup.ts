import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { SESSIONS_DIR } from "./paths.js";

const MAX_SESSIONS_TO_KEEP = 5;

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
