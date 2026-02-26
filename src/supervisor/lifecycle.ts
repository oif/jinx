import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { safePull, rebuild, rollbackToMain, getCurrentSha, verifyImport } from "./git-ops.js";
import { log } from "../util/log.js";
import { markIntentionalRestart } from "./recovery.js";
import { RESTART_MARKER, RESTART_MARKER_PROCESSING } from "./paths.js";

const POLL_INTERVAL = 5_000; // 5 seconds
const SHUTDOWN_TIMEOUT_MS = 30_000; // Force exit after 30s

interface RestartRequest {
  reason: string;
  sha: string;
  requestedAt: string;
}

type NotifyFn = (msg: string) => Promise<void>;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let notifyOwner: NotifyFn | null = null;

export function registerNotify(fn: NotifyFn): void {
  notifyOwner = fn;
}

async function notify(msg: string): Promise<void> {
  if (notifyOwner) {
    try {
      await notifyOwner(msg);
    } catch {
      log.warn("Failed to notify owner");
    }
  }
}

/**
 * Handle a restart request:
 * 1. Pull new code from origin/dev
 * 2. Verify SHA matches expectation
 * 3. Rebuild (pnpm install + tsc)
 * 4. Verify import works
 * 5. Trigger PM2 restart
 *
 * On failure → rollback to main, notify owner.
 */
async function handleRestart(req: RestartRequest): Promise<void> {
  log.info("Processing restart request", { reason: req.reason, expectedSha: req.sha });

  // Step 1: Pull
  if (!safePull()) {
    log.error("Pull failed, attempting rollback");
    await handleRollback(req.reason);
    return;
  }

  // Step 2: Verify SHA
  const currentSha = getCurrentSha();
  if (req.sha !== "unknown" && currentSha !== req.sha) {
    log.warn("SHA mismatch after pull", { expected: req.sha, got: currentSha });
    // Not fatal — could be a race condition. Continue with rebuild.
  }

  // Step 3: Rebuild
  if (!rebuild()) {
    log.error("Rebuild failed, attempting rollback");
    await handleRollback(req.reason);
    return;
  }

  // Step 4: Verify import works at runtime
  if (!verifyImport()) {
    log.error("Import verification failed after rebuild, attempting rollback");
    await handleRollback(req.reason);
    return;
  }

  // Step 5: Restart via PM2
  // CRITICAL: Mark intentional restart BEFORE the delay, not inside setTimeout.
  // If markIntentionalRestart fails or setTimeout callback errors, we'd otherwise
  // trigger a false crash-loop rollback on the next boot.
  markIntentionalRestart();

  log.info("Restarting via PM2 in 5 seconds to allow graceful agent loop completion");
  await notify(`🔄 Restarting: ${req.reason}`);

  setTimeout(() => {
    try {
      execSync("pm2 restart jinx", { timeout: 30_000, stdio: "pipe" });
    } catch {
      // If pm2 restart fails, try a hard process exit — PM2 will auto-restart
      log.error("PM2 restart failed, exiting process for auto-restart");
      process.exit(0);
    }
  }, 5000);
}

async function handleRollback(reason: string): Promise<void> {
  const rolledBack = rollbackToMain();
  if (rolledBack) {
    rebuild(); // Best effort rebuild on main
    await notify(
      `⚠️ Restart failed for: ${reason}\nRolled back to main branch.\nSHA: ${getCurrentSha()}`
    );
  } else {
    await notify(`🔴 CRITICAL: Restart and rollback both failed for: ${reason}`);
  }
}

/**
 * Start polling for restart requests.
 *
 * Uses atomic file rename to prevent read/write races:
 * Writer (restart.ts) writes to .tmp then renames to RESTART_MARKER.
 * Reader (here) renames RESTART_MARKER to .processing, then reads .processing.
 * This guarantees we never read a partially-written file.
 */
export function startLifecycleMonitor(): void {
  if (pollTimer) return;

  // Clean up any stale processing marker from a previous crash
  try { unlinkSync(RESTART_MARKER_PROCESSING); } catch { /* not present */ }

  pollTimer = setInterval(async () => {
    if (!existsSync(RESTART_MARKER)) return;

    try {
      // Atomically claim the marker — prevents partial-read races
      renameSync(RESTART_MARKER, RESTART_MARKER_PROCESSING);
    } catch {
      // Another tick already claimed it, or writer is mid-rename. Skip.
      return;
    }

    try {
      const raw = readFileSync(RESTART_MARKER_PROCESSING, "utf-8");
      const req: RestartRequest = JSON.parse(raw);

      // Remove claimed marker before processing — prevent infinite restart loops
      unlinkSync(RESTART_MARKER_PROCESSING);

      await handleRestart(req);
    } catch (e) {
      const err = e as Error;
      log.error("Failed to process restart marker", { error: err.message });
      // Remove broken marker
      try { unlinkSync(RESTART_MARKER_PROCESSING); } catch { /* already gone */ }
    }
  }, POLL_INTERVAL);

  log.info("Lifecycle monitor started", { pollInterval: POLL_INTERVAL });
}

/**
 * Stop the lifecycle monitor.
 */
export function stopLifecycleMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    log.info("Lifecycle monitor stopped");
  }
}

/**
 * Register graceful shutdown handlers.
 * Includes a force-exit timeout to prevent hanging on stuck cleanup.
 */
export function registerShutdownHandlers(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;

    log.info(`Received ${signal}, shutting down...`);

    // Force exit if cleanup hangs
    const forceExit = setTimeout(() => {
      log.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref(); // Don't let this timer keep the process alive

    try {
      stopLifecycleMonitor();
      await cleanup();
    } catch (e) {
      log.error("Error during cleanup", { error: (e as Error).message });
    }

    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
