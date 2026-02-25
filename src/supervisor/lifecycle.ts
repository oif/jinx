import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { safePull, rebuild, rollbackToMain, getCurrentSha } from "./git-ops.js";
import { log } from "../util/log.js";

const DATA_DIR = join(process.cwd(), "data");
const RESTART_MARKER = join(DATA_DIR, ".restart_requested");
const POLL_INTERVAL = 5_000; // 5 seconds

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
 * 4. Trigger PM2 restart
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

  // Step 4: Restart via PM2
  log.info("Restarting via PM2");
  await notify(`🔄 Restarting: ${req.reason}`);

  try {
    execSync("pm2 restart jinx", { timeout: 30_000, stdio: "pipe" });
  } catch (e) {
    // If pm2 restart fails, try a hard process exit — PM2 will auto-restart
    log.error("PM2 restart failed, exiting process for auto-restart");
    process.exit(0);
  }
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
 */
export function startLifecycleMonitor(): void {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    if (!existsSync(RESTART_MARKER)) return;

    try {
      const raw = readFileSync(RESTART_MARKER, "utf-8");
      const req: RestartRequest = JSON.parse(raw);

      // Remove marker before processing — prevent infinite restart loops
      unlinkSync(RESTART_MARKER);

      await handleRestart(req);
    } catch (e) {
      const err = e as Error;
      log.error("Failed to process restart marker", { error: err.message });
      // Remove broken marker
      try { unlinkSync(RESTART_MARKER); } catch { /* already gone */ }
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
 */
export function registerShutdownHandlers(cleanup: () => Promise<void>): void {
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    stopLifecycleMonitor();
    await cleanup();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
