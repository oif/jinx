import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSha } from "./git-ops.js";
import { log } from "../util/log.js";

const DATA_DIR = join(process.cwd(), "data");
const RESTART_MARKER = join(DATA_DIR, ".restart_requested");

interface RestartRequest {
  reason: string;
  sha: string;
  requestedAt: string;
}

/**
 * Request a process restart.
 * Writes a marker file that the lifecycle monitor polls for.
 * This is the clean way to trigger a restart from anywhere in the codebase.
 */
export function requestRestart(reason: string): void {
  const sha = getCurrentSha();

  const marker: RestartRequest = {
    reason,
    sha,
    requestedAt: new Date().toISOString(),
  };

  writeFileSync(RESTART_MARKER, JSON.stringify(marker, null, 2));
  log.info("Restart requested", { reason, sha });
}
