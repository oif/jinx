import { readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./util/log.js";
import { startAgent, registerTelegramSend, prompt as agentPrompt, abortAgent } from "./agent/session.js";
import { createTelegramBot } from "./telegram/bot.js";
import { startLifecycleMonitor, stopLifecycleMonitor, registerShutdownHandlers, registerNotify } from "./supervisor/lifecycle.js";
import { ensureDevBranch, getCurrentSha, getCurrentBranch } from "./supervisor/git-ops.js";
import { startConsciousness } from "./consciousness/loop.js";

let agentBusy = false;

async function main(): Promise<void> {
  log.info("Jinx starting", {
    version: readVersion(),
    sha: getCurrentSha(),
    branch: getCurrentBranch(),
    pid: process.pid,
  });

  // Step 1: Ensure we're on dev branch
  ensureDevBranch();

  // Step 2: Create Telegram bot (before agent, so we can inject sendToOwner)
  const consciousness = { handle: null as ReturnType<typeof startConsciousness> | null };

  const tg = createTelegramBot(
    // onMessage: forward to agent
    async (text) => {
      agentBusy = true;
      try {
        return await agentPrompt(text);
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
        return [
          `Version: ${state.version}`,
          `Branch: ${branch} (${sha})`,
          `Cycle: ${state.cycle}`,
          `Evolution: ${state.evolutionEnabled ? "ON" : "OFF"}`,
          `PID: ${process.pid}`,
          `Uptime: ${formatUptime(process.uptime())}`,
        ].join("\n");
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

function readVersion(): string {
  try {
    const state = JSON.parse(readFileSync(join(process.cwd(), "data", "state.json"), "utf-8"));
    return state.version || "0.0.1";
  } catch {
    return "0.0.1";
  }
}

function readState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "data", "state.json"), "utf-8"));
  } catch {
    return { version: "0.0.1", cycle: 0, evolutionEnabled: false };
  }
}

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
