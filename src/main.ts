import { log } from "./util/log.js";
import { readVersion, readState } from "./util/state.js";
import { startAgent, registerTelegramSend, promptConversation, abortAgent } from "./agent/session.js";
import { createTelegramBot } from "./telegram/bot.js";
import { startLifecycleMonitor, stopLifecycleMonitor, registerShutdownHandlers, registerNotify } from "./supervisor/lifecycle.js";
import { ensureDevBranch, getCurrentSha, getCurrentBranch } from "./supervisor/git-ops.js";
import { startConsciousness } from "./consciousness/loop.js";
import { loadNextTask } from "./consciousness/loop.js";
import { checkHealth, registerHealthNotifier } from "./health/check.js";
import { formatHistoryReport } from "./health/history.js";
import { cleanupOldSessions } from "./supervisor/cleanup.js";
import { checkCrashLoopAndRecover } from "./supervisor/recovery.js";
import { formatProgress, isEvolutionActive } from "./consciousness/evolution-progress.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
      const imageContents = images?.map(img => ({
        type: "image" as const,
        mimeType: img.mimeType,
        data: img.data,
      }));
      return await promptConversation(text, imageContents);
    },
    // onCommand: built-in commands
    {
      start: async () => "Jinx is alive. 🐾",

      status: async () => {
        const state = readState();
        const branch = getCurrentBranch();
        const sha = getCurrentSha().slice(0, 8);
        const health = await checkHealth();
        const nextTask = loadNextTask();

        const lines: string[] = [
          `Version: ${state.version}`,
          `Branch: ${branch} (${sha})`,
          `Cycle: ${state.cycle}`,
          `Next task: ${nextTask ? `${nextTask.id}: ${nextTask.title}` : "none (backlog empty)"}`,
          `PID: ${process.pid}`,
          `Uptime: ${formatUptime(process.uptime())}`,
          `Health: ${health.status.toUpperCase()} (Mem: ${health.memory.usedPercent}%, CPU: ${health.cpu.loadPercent}%, Disk: ${health.disk.usedPercent}%)`,
        ];

        // Show evolution progress if active
        if (isEvolutionActive()) {
          lines.push("", formatProgress());
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

      backlog: async () => {
        const backlogPath = join(process.cwd(), "data", "backlog.md");
        if (!existsSync(backlogPath)) return "No backlog file found.";
        const content = readFileSync(backlogPath, "utf-8");
        // Return just the Pending section (first ~50 lines)
        const lines = content.split("\n");
        const result: string[] = [];
        let inPending = false;
        for (const line of lines) {
          if (line.trim() === "## Pending") { inPending = true; result.push(line); continue; }
          if (inPending && line.trim().startsWith("## ")) break;
          if (inPending) result.push(line);
        }
        const pendingItems = result.filter(l => l.trim().startsWith("- [ ]"));
        if (pendingItems.length === 0) return "📋 Backlog: empty (no pending tasks)";
        return `📋 Backlog (${pendingItems.length} pending):\n${pendingItems.slice(0, 10).join("\n")}`;
      },

      evolve: async () => {
        if (consciousness.handle) {
          consciousness.handle.triggerNow();
          const task = loadNextTask();
          if (task) return `🧬 Triggering evolution for: ${task.id}: ${task.title}`;
          return "📋 Backlog is empty — nothing to evolve. Add tasks first.";
        }
        return "Consciousness loop not running.";
      },

      recent: async () => {
        const { loadEvolutionHistory } = await import("./consciousness/history.js");
        const history = loadEvolutionHistory();
        if (history.length === 0) {
          return "No evolution history yet.";
        }
        const recent = history.slice(-5).reverse();
        const lines = ["📜 Recent Evolutions:"];
        for (const record of recent) {
          const emoji = record.status === "success" ? "✅" : record.status === "failed" ? "❌" : "⏭️";
          const date = new Date(record.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          const summary = record.summary.split("\n")[0].slice(0, 40);
          lines.push(
            `${emoji} #${record.cycle} (${record.version}) - ${date}`,
            `   ${summary}${record.summary.length > 40 ? "..." : ""}`
          );
        }
        return lines.join("\n");
      },

      perf: async () => {
        const { formatPerformanceReport } = await import("./observability/metrics.js");
        return formatPerformanceReport();
      },

      costs: async () => {
        const { getCostSummary, formatCostReport, getRecentCalls, formatRecentCalls } = await import("./costs/tracker.js");

        const summary = getCostSummary(30);
        const recent = getRecentCalls(10);
        return [
          formatCostReport(summary),
          "",
          formatRecentCalls(recent),
          "",
          "💡 Use /pricing to see API pricing details",
        ].join("\n");
      },

      pricing: async () => {
        const { formatPricingInfo } = await import("./costs/pricing.js");
        return formatPricingInfo();
      },

      coverage: async () => {
        const { readCoverageReport, formatCoverageReport } = await import("./coverage/analyzer.js");
        const summary = readCoverageReport();
        if (!summary) {
          return "📊 No coverage data available. Run tests with coverage first.";
        }
        return formatCoverageReport(summary);
      },

      quality: async () => {
        const { runQualityCheck, formatQualityReport } = await import("./quality/code-quality.js");
        const result = await runQualityCheck();
        return formatQualityReport(result);
      },

      swarm: async (args) => {
        const task = args.trim();
        if (!task) {
          return [
            "Usage: /swarm <task description>",
            "",
            "Example: /swarm Analyze the pros and cons of switching from PostgreSQL to MongoDB",
            "",
            "Spawns multiple specialized AI agents in parallel, then synthesizes their reports into a unified conclusion.",
          ].join("\n");
        }

        // Fire-and-forget: return acknowledgment immediately, send result when done
        void (async () => {
          try {
            const { runSwarm, formatSwarmResult } = await import("./swarm/orchestrator.js");
            log.info("Swarm command triggered", { task: task.slice(0, 80) });
            const result = await runSwarm({ task });
            const formatted = formatSwarmResult(result);
            await tg.sendToOwner(formatted);
          } catch (e) {
            const err = e as Error;
            log.error("Swarm command failed", { error: err.message });
            await tg.sendToOwner(`❌ Swarm failed: ${err.message}`);
          }
        })();

        return [
          `🐝 Swarm analysis started!`,
          ``,
          `**Task**: ${task}`,
          ``,
          `Spawning specialized agents in parallel... this may take a few minutes.`,
          `I'll send the full report when all agents complete.`,
        ].join("\n");
      },

      search: async (args) => {
        const { webSearch, formatSearchResults } = await import("./search/web-search.js");
        const query = args.trim();
        if (!query) return "Usage: /search <query>";
        try {
          const result = await webSearch({ query, count: 10 });
          return formatSearchResults(result);
        } catch (e) {
          return `Search error: ${(e as Error).message}`;
        }
      },

      restart: async () => {
        const { requestRestart } = await import("./supervisor/restart.js");
        await requestRestart("Manual restart requested via Telegram");
        return "🔄 Restart requested. Supervisor will restart me shortly.";
      },

      ping: async () => "pong 🏓",

      strategy: async (args) => {
        const { formatStrategyStatus, forceStrategy, enableAutoSelect } = await import("./evolution/strategy.js");
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase();

        if (!subcommand) {
          // No args → show current strategy status
          return formatStrategyStatus();
        }

        if (subcommand === "auto") {
          enableAutoSelect();
          return "✅ Strategy auto-selection enabled. System will now pick the best strategy based on health and performance metrics.";
        }

        if (subcommand === "set") {
          const strategyName = parts[1]?.toLowerCase();
          const valid = ["innovate", "harden", "repair-only", "balanced"];
          if (!strategyName || !valid.includes(strategyName)) {
            return [
              "❌ Invalid strategy. Valid options:",
              "  /strategy set innovate    — 🚀 Explore new capabilities",
              "  /strategy set harden      — 🛡️ Focus on stability",
              "  /strategy set repair-only — 🔧 Emergency fixes only",
              "  /strategy set balanced    — ⚖️ Default balanced mode",
              "",
              "Or use /strategy auto to re-enable automatic selection.",
            ].join("\n");
          }
          const strategy = strategyName as "innovate" | "harden" | "repair-only" | "balanced";
          forceStrategy(strategy, "Set via Telegram /strategy command");
          return `✅ Strategy manually set to: ${strategy.toUpperCase()}\n\nAuto-selection is now OFF. Use /strategy auto to re-enable it.`;
        }

        return [
          "📋 /strategy usage:",
          "  /strategy              — Show current strategy & system analysis",
          "  /strategy set innovate — 🚀 Force innovate strategy",
          "  /strategy set harden   — 🛡️ Force harden strategy",
          "  /strategy set repair-only — 🔧 Force repair-only (emergency)",
          "  /strategy set balanced — ⚖️ Force balanced strategy",
          "  /strategy auto         — Re-enable automatic strategy selection",
        ].join("\n");
      },

      help: async () => {
        return [
          "📋 Available Commands:",
          "",
          "/start - Check if Jinx is alive",
          "/status - Show system status (version, health, next task)",
          "/backlog - Show pending tasks",
          "/evolve - Trigger evolution immediately (if tasks pending)",
          "/evolution - Show evolution history report",
          "/recent - Show recent 5 evolutions summary",
          "/history - Show health history with statistics",
          "/perf - Show performance metrics report",
          "/costs - Show API usage costs and recent calls",
          "/pricing - Show API pricing information",
          "/coverage - Show test coverage report",
          "/quality - Run code quality checks",
          "/strategy - View/change evolution strategy",
          "/swarm <task> - Multi-agent parallel analysis",
          "/search - Search the web",
          "/restart - Request process restart",
          "/ping - Ping Jinx",
          "/help - Show this help message",
          "",
          "💬 Send a message to add tasks, ask questions, or give instructions.",
        ].join("\n");
      },
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

  consciousness.handle = startConsciousness(tg.sendToOwner);

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
