import { log } from "./util/log.js";
import { readVersion, readState } from "./util/state.js";
import { startAgent, registerTelegramSend, prompt as agentPrompt, abortAgent } from "./agent/session.js";
import { createTelegramBot } from "./telegram/bot.js";
import { startLifecycleMonitor, stopLifecycleMonitor, registerShutdownHandlers, registerNotify } from "./supervisor/lifecycle.js";
import { ensureDevBranch, getCurrentSha, getCurrentBranch } from "./supervisor/git-ops.js";
import { startConsciousness } from "./consciousness/loop.js";
import { checkHealth, registerHealthNotifier } from "./health/check.js";
import { formatHistoryReport } from "./health/history.js";
import { cleanupOldSessions } from "./supervisor/cleanup.js";
import { checkCrashLoopAndRecover } from "./supervisor/recovery.js";

let agentBusy = false;

async function main(): Promise<void> {
  // Step 0: Emergency crash loop detection
  checkCrashLoopAndRecover();

  log.info("Jinx starting", {
    version: readVersion(),
    sha: getCurrentSha(),
    branch: getCurrentBranch(),
    pid: process.pid,
  });

  // Step 1: Ensure we're on dev branch & clean up old files
  ensureDevBranch();
  cleanupOldSessions();

  // Step 2: Create Telegram bot (before agent, so we can inject sendToOwner)
  const consciousness = { handle: null as ReturnType<typeof startConsciousness> | null };

  const tg = createTelegramBot(
    // onMessage: forward to agent
    async (text, images) => {
      agentBusy = true;
      try {
        const imageContents = images?.map(img => ({
          type: "image" as const,
          mimeType: img.mimeType,
          data: img.data,
        }));
        return await agentPrompt(text, imageContents);
      } finally {
        agentBusy = false;
      }
    },
    // onCommand: built-in commands
    {
      start: async () => "Jinx is alive. 🐾",

      status: async () => {
        const state = readState();
        const branch = getCurrentBranch();
        const sha = getCurrentSha().slice(0, 8);
        const health = await checkHealth();
        return [
          `Version: ${state.version}`,
          `Branch: ${branch} (${sha})`,
          `Cycle: ${state.cycle}`,
          `Evolution: ${state.evolutionEnabled ? "ON" : "OFF"}`,
          `PID: ${process.pid}`,
          `Uptime: ${formatUptime(process.uptime())}`,
          `Health: ${health.status.toUpperCase()} (Mem: ${health.memory.usedPercent}%, CPU: ${health.cpu.loadPercent}%, Disk: ${health.disk.usedPercent}%)`,
        ].join("\n");
      },

      history: async () => {
        return formatHistoryReport();
      },

      evolution: async () => {
        const { formatEvolutionReport } = await import("./consciousness/history.js");
        return formatEvolutionReport();
      },

      evolve: async () => {
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
        await requestRestart("Manual restart requested via Telegram");
        return "🔄 Restart requested. Supervisor will restart me shortly.";
      },

      ping: async () => "pong 🏓",
    }
  );

  // Step 3: Register Telegram send for agent tools
  registerTelegramSend(tg.sendToOwner);
  registerNotify(tg.sendToOwner);

  // Step 4: Start agent session
  await startAgent();

  // Step 5: Start subsystems
  startLifecycleMonitor();
  tg.start();

  // Register health notifier for proactive alerts
  registerHealthNotifier(tg.sendToOwner);

  consciousness.handle = startConsciousness(
    async (msg) => {
      agentBusy = true;
      try {
        return await agentPrompt(msg);
      } finally {
        agentBusy = false;
      }
    },
    tg.sendToOwner,
    () => agentBusy,
  );

  // Step 6: Register shutdown
  registerShutdownHandlers(async () => {
    consciousness.handle?.stop();
    stopLifecycleMonitor();
    await abortAgent();
    await tg.stop();
  });

  log.info("Jinx is alive", { version: readVersion() });

  // Notify owner on startup
  try {
    await tg.sendToOwner(
      `🐾 Jinx started.\nVersion: ${readVersion()}\nBranch: ${getCurrentBranch()} (${getCurrentSha().slice(0, 8)})`
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
