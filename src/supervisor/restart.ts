import { writeFileSync, renameSync } from "node:fs";
import { getCurrentSha } from "./git-ops.js";
import { log } from "../util/log.js";
import { RESTART_MARKER, RESTART_MARKER_TMP } from "./paths.js";

interface RestartRequest {
  reason: string;
  sha: string;
  requestedAt: string;
}

/**
 * Request a process restart.
 * Writes a marker file that the lifecycle monitor polls for.
 * This is the clean way to trigger a restart from anywhere in the codebase.
 *
 * Uses atomic write (write to .tmp then rename) to prevent the lifecycle
 * monitor from reading a partially-written file.
 */
export function requestRestart(reason: string): void {
  const sha = getCurrentSha();

  const marker: RestartRequest = {
    reason,
    sha,
    requestedAt: new Date().toISOString(),
  };

  // Atomic write: write to tmp, then rename into place
  writeFileSync(RESTART_MARKER_TMP, JSON.stringify(marker, null, 2));
  renameSync(RESTART_MARKER_TMP, RESTART_MARKER);
  log.info("Restart requested", { reason, sha });
}
