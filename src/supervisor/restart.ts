import { writeFileSync } from "node:fs";
import { getCurrentSha } from "./git-ops.js";
import { log } from "../util/log.js";
import { RESTART_MARKER } from "./paths.js";

interface RestartRequest {
  reason: string;
  sha: string;
  requestedAt: string;
}

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
