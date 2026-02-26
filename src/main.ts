import { log } from "./util/log.js";
import { readVersion, readState } from "./util/state.js";
import { startAgent, registerTelegramSend, prompt as agentPrompt, abortAgent, isAgentBusy } from "./agent/session.js";
import { createTelegramBot } from "./telegram/bot.js";
import { startLifecycleMonitor, stopLifecycleMonitor, registerShutdownHandlers, registerNotify } from "./supervisor/lifecycle.js";
import { ensureDevBranch, getCurrentSha, getCurrentBranch } from "./supervisor/git-ops.js";
import { startConsciousness } from "./consciousness/loop.js";
import { checkHealth, registerHealthNotifier } from "./health/check.js";
import { formatHistoryReport } from "./health/history.js";
import { cleanupOldSessions } from "./supervisor/cleanup.js";
import { checkCrashLoopAndRecover } from "./supervisor/recovery.js";

async function main(): Promise<void> {
  // Step 0: Emergency crash loop detection
  const { safeMode } = checkCrashLoopAndRecover();

  log.info("Jinx starting", {
    version: readVersion(),
    sha: getCurrentSha(),
    branch: getCurrentBranch(),
    pid: process.pid,
    safeMode,
  });

  // Step 1: Ensure we're on dev branch & clean up old files
  if (!safeMode) {
    ensureDevBranch();
  }
  cleanupOldSessions();

  // Step 2: Create Telegram bot (before agent, so we can inject sendToOwner)
  const consciousness = { handle: null as ReturnType<typeof startConsciousness> | null };

  const tg = createTelegramBot(
    // onMessage: forward to agent
    async (text, images) => {
      if (safeMode) {
        return "⚠️ Jinx is in safe mode (crash loop recovery). Agent is disabled.\nUse /restart to attempt recovery, or fix the issue manually.";
      }
      const imageContents = images?.map(img => ({
        type: "image" as const,
        mimeType: img.mimeType,
        data: img.data,
      }));
      return await agentPrompt(text, imageContents);
    },
    // onCommand: built-in commands
    {
      start: async () => safeMode
        ? "⚠️ Jinx is alive but in SAFE MODE. Agent and consciousness are disabled due to crash loop."
        : "Jinx is alive. 🐾",

      status: async () => {
        const state = readState();
        const branch = getCurrentBranch();
        const sha = getCurrentSha().slice(0, 8);
        const health = await checkHealth();
        const lines = [
          `Version: ${state.version}`,
          `Branch: ${branch} (${sha})`,
          `Cycle: ${state.cycle}`,
          `Evolution: ${state.evolutionEnabled ? "ON" : "OFF"}`,
          `PID: ${process.pid}`,
          `Uptime: ${formatUptime(process.uptime())}`,
          `Health: ${health.status.toUpperCase()} (Mem: ${health.memory.usedPercent}%, CPU: ${health.cpu.loadPercent}%, Disk: ${health.disk.usedPercent}%)`,
        ];
        if (safeMode) {
          lines.unshift("⚠️ SAFE MODE ACTIVE");
        }
        return lines.join("\n");
      },

      history: async () => {
        return formatHistoryReport();
      },

      evolution: async () => {
        const { formatEvolutionReport } = await import("./consciousness/history.js");
        return formatEvolutionReport();
      },

      evolve: async () => {
        if (safeMode) return "Cannot evolve in safe mode.";
        if (consciousness.handle) {
          consciousness.handle.triggerEvolution();
          return "🧬 Evolution mode activated.";
        }
        return "Consciousness loop not running.";
      },

      stop_evolve: async () => {
        if (consciousness.handle) {
          consciousness.handle.stopEvolution();
          return "Evolution mode deactivated.";
        }
        return "Consciousness loop not running.";
      },

      restart: async () => {
        const { requestRestart } = await import("./supervisor/restart.js");
        requestRestart("Manual restart requested via Telegram");
        return "🔄 Restart requested. Supervisor will restart me shortly.";
      },

      ping: async () => "pong 🏓",
    }
  );

  // Step 3: Register Telegram send
  registerNotify(tg.sendToOwner);

  if (!safeMode) {
    // Step 4: Start agent session (skip in safe mode)
    registerTelegramSend(tg.sendToOwner);
    await startAgent();
  }

  // Step 5: Start subsystems
  startLifecycleMonitor();
  tg.start();

  registerHealthNotifier(tg.sendToOwner);

  if (!safeMode) {
    consciousness.handle = startConsciousness(
      async (msg) => {
        return await agentPrompt(msg);
      },
      tg.sendToOwner,
      isAgentBusy,
    );
  }

  // Step 6: Register shutdown
  registerShutdownHandlers(async () => {
    consciousness.handle?.stop();
    stopLifecycleMonitor();
    if (!safeMode) {
      await abortAgent();
    }
    await tg.stop();
  });

  log.info("Jinx is alive", { version: readVersion(), safeMode });

  // Notify owner on startup
  try {
    const modeLabel = safeMode ? " [⚠️ SAFE MODE]" : "";
    await tg.sendToOwner(
      `🐾 Jinx started${modeLabel}.\nVersion: ${readVersion()}\nBranch: ${getCurrentBranch()} (${getCurrentSha().slice(0, 8)})`
    );
  } catch {
    // TG might not be ready yet — not fatal
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ── Entry ──────────────────────────────────────────────────────────

main().catch((e) => {
  log.error("Fatal error", { error: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
