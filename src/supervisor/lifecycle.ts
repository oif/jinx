import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { safePull, rebuild, rollbackToMain, getCurrentSha } from "./git-ops.js";
import { log } from "../util/log.js";
import { markIntentionalRestart } from "./recovery.js";
import { RESTART_MARKER } from "./paths.js";

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

async function handleRestart(req: RestartRequest): Promise<void> {
  log.info("Processing restart request", { reason: req.reason, expectedSha: req.sha });

  if (!safePull()) {
    log.error("Pull failed, attempting rollback");
    await handleRollback(req.reason);
    return;
  }

  const currentSha = getCurrentSha();
  if (req.sha !== "unknown" && currentSha !== req.sha) {
    log.warn("SHA mismatch after pull", { expected: req.sha, got: currentSha });
  }

  if (!rebuild()) {
    log.error("Rebuild failed, attempting rollback");
    await handleRollback(req.reason);
    return;
  }

  log.info("Restarting via PM2 in 5 seconds to allow graceful agent loop completion");
  await notify(`🔄 Restarting: ${req.reason}`);

  setTimeout(() => {
    try {
      markIntentionalRestart();
      execSync("pm2 restart jinx", { timeout: 30_000, stdio: "pipe" });
    } catch {
      log.error("PM2 restart failed, exiting process for auto-restart");
      process.exit(0);
    }
  }, 5000);
}

async function handleRollback(reason: string): Promise<void> {
  const rolledBack = rollbackToMain();
  if (rolledBack) {
    rebuild();
    await notify(
      `⚠️ Restart failed for: ${reason}\nRolled back to main branch.\nSHA: ${getCurrentSha()}`
    );
  } else {
    await notify(`🔴 CRITICAL: Restart and rollback both failed for: ${reason}`);
  }
}

export function startLifecycleMonitor(): void {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    if (!existsSync(RESTART_MARKER)) return;

    try {
      const raw = readFileSync(RESTART_MARKER, "utf-8");
      const req: RestartRequest = JSON.parse(raw);
      unlinkSync(RESTART_MARKER);
      await handleRestart(req);
    } catch (e) {
      const err = e as Error;
      log.error("Failed to process restart marker", { error: err.message });
      try { unlinkSync(RESTART_MARKER); } catch { /* already gone */ }
    }
  }, POLL_INTERVAL);

  log.info("Lifecycle monitor started", { pollInterval: POLL_INTERVAL });
}

export function stopLifecycleMonitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    log.info("Lifecycle monitor stopped");
  }
}

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
