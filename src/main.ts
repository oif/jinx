import { log } from "./util/log.js";
import { readVersion, readState } from "./util/state.js";
import { startAgent, registerTelegramSend, registerTelegramStream, promptConversation, abortAgent } from "./agent/session.js";
import { createTelegramBot, TopicType } from "./telegram/bot.js";
import { startLifecycleMonitor, stopLifecycleMonitor, registerShutdownHandlers, registerNotify } from "./supervisor/lifecycle.js";
import { startDailyBriefing, stopDailyBriefing } from "./supervisor/briefing.js";
import { ensureDevBranch, getCurrentSha, getCurrentBranch } from "./supervisor/git-ops.js";
import { startConsciousness } from "./consciousness/loop.js";
import { loadNextTask } from "./consciousness/loop.js";
import { checkHealth, registerHealthNotifier } from "./health/check.js";
import { formatHistoryReport } from "./health/history.js";
import { getAverageQualityScore } from "./consciousness/history.js";
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

      diagnostics: async () => {
        return buildDiagnosticsReport();
      },

      ping: async () => "pong 🏓",

      reflect: async () => {
        const {
          runReflection,
          formatReflectionReport,
          getPendingSuggestions,
        } = await import("./memory/reflection.js");

        const session = runReflection("Manual trigger via /reflect command");
        const report = formatReflectionReport(session);

        const pending = getPendingSuggestions();
        const summary = [
          report,
          "",
          `📌 ${pending.length} pending improvement suggestions available.`,
        ].join("\n");

        return summary;
      },

      insights: async () => {
        const {
          getReflectionSummary,
          getRecentReflections,
        } = await import("./memory/reflection.js");

        const recent = getRecentReflections(3);
        if (recent.length === 0) {
          return "No reflection sessions yet. Use /reflect to trigger one.";
        }

        const lines = [getReflectionSummary()];
        lines.push("");
        lines.push("📚 Recent Reflections:");
        for (const session of recent) {
          lines.push(`  ${new Date(session.timestamp).toLocaleDateString()}: ${session.insights.length} insights, ${session.suggestions.length} suggestions`);
        }

        return lines.join("\n");
      },

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

      recall: async (args) => {
        const {
          retrieveMemories,
          getMemoryStats,
          formatMemoryStats,
          advancedSemanticSearch,
        } = await import("./memory/graph.js");

        // Parse args
        const input = args.trim();
        
        // Show stats if "stats" or empty
        if (input === "stats" || input === "") {
          return formatMemoryStats();
        }

        // Parse parameters
        let query = "";
        let type: string | undefined;
        let limit = 10;
        let useAdvanced = false;

        const parts = input.split(/\s+/);
        for (const part of parts) {
          if (part.startsWith("type:")) {
            type = part.slice(5).toLowerCase();
          } else if (part.startsWith("limit:")) {
            const n = parseInt(part.slice(6), 10);
            if (!isNaN(n) && n > 0 && n <= 50) {
              limit = n;
            }
          } else if (part === "advanced") {
            useAdvanced = true;
          } else {
            query += (query ? " " : "") + part;
          }
        }

        if (!query) {
          return [
            "🧠 Memory Recall",
            "",
            "Usage:",
            "  /recall <query>          - Search memories",
            "  /recall <query> type:xxx  - Filter by type",
            "  /recall <query> limit:n   - Limit results (default: 10)",
            "  /recall <query> advanced  - Use advanced semantic search",
            "  /recall stats             - Show memory statistics",
            "",
            "Types: concept, fact, experience, entity, skill, goal",
            "",
            "Examples:",
            "  /recall evolution",
            "  /recall bug fix type:fact",
            "  /recall performance type:experience limit:5",
            "  /recall advanced optimization",
          ].join("\n");
        }

        // Valid types
        const validTypes = ["concept", "fact", "experience", "entity", "skill", "goal"];
        if (type && !validTypes.includes(type)) {
          return `❌ Invalid type "${type}". Valid types: ${validTypes.join(", ")}`;
        }

        try {
          let results;
          
          if (useAdvanced) {
            // Advanced semantic search
            const searchResults = advancedSemanticSearch(query, {
              limit,
              minRelevance: 0.05,
              boostRecent: true,
              boostAccessed: true,
            });
            
            results = searchResults.map(r => ({
              node: r.node,
              relevance: r.relevance,
              matchedKeywords: r.matchedKeywords,
            }));
          } else {
            // Standard search
            const memories = retrieveMemories({
              text: query,
              type: type as any,
              limit,
            });
            
            results = memories.map(m => ({
              node: m.node,
              relevance: m.relevance,
            }));
          }

          if (results.length === 0) {
            return [
              "🧠 Memory Recall",
              "",
              `No memories found for "${query}"${type ? ` (type: ${type})` : ""}`,
              "",
              "Try:",
              "  - Different keywords",
              "  - Remove type filter",
              "  - Use /recall stats to see available memories",
            ].join("\n");
          }

          // Format results
          const lines: string[] = [
            "🧠 Memory Recall",
            "",
            `Found ${results.length} result(s) for "${query}"${type ? ` (type: ${type})` : ""}:`,
            "",
          ];

          for (let i = 0; i < results.length; i++) {
            const r = results[i] as any;
            const node = r.node;
            const relevance = ((r.relevance * 100) | 0);
            const age = formatAge(node.createdAt);
            
            lines.push(`${i + 1}. [${node.type}] (${relevance}%) ${node.summary.slice(0, 60)}${node.summary.length > 60 ? "..." : ""}`);
            lines.push(`   ID: ${node.id} | Level: ${node.level} | Age: ${age}`);
            
            if (node.tags.length > 0) {
              lines.push(`   Tags: ${node.tags.slice(0, 5).join(", ")}`);
            }
            
            if (r.matchedKeywords && r.matchedKeywords.length > 0) {
              lines.push(`   Matched: ${r.matchedKeywords.slice(0, 5).join(", ")}`);
            }
            
            // Show content preview for high relevance
            if (r.relevance > 0.7 && node.content.length > 0) {
              const preview = node.content.slice(0, 150);
              lines.push(`   Preview: ${preview}${node.content.length > 150 ? "..." : ""}`);
            }
            
            lines.push("");
          }

          // Add stats summary
          const stats = getMemoryStats();
          lines.push("---");
          lines.push(`Total: ${stats.totalNodes} nodes | ${stats.totalEdges} edges | Pending review: ${stats.pendingReview}`);

          return lines.join("\n");
        } catch (e) {
          const err = e as Error;
          return `❌ Recall error: ${err.message}`;
        }
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
          "/reflect - Run reflection session (MARS self-improvement)",
          "/insights - View reflection summary and insights",
          "/recall - Query memory graph (search memories)",
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
          "/diagnostics - Deep system health diagnostics",
          "/help - Show this help message",
          "",
          "💬 Send a message to add tasks, ask questions, or give instructions.",
        ].join("\n");
      },
    }
  );

  // Step 3: Register Telegram send for agent tools
  // - send_owner_message → owner DM (private) + 🏆 Results topic (key milestones)
  // - send_stream_message → 🌊 Stream topic (verbose progress, internal thoughts)
  registerTelegramSend(async (msg) => {
    await tg.sendToOwner(msg);                              // always DM owner
    await tg.sendToTopic(TopicType.RESULTS, msg);           // mirror to Results topic
  });
  registerTelegramStream((msg) => tg.sendToTopic(TopicType.STREAM, msg));
  registerNotify(tg.sendToOwner);

  // Step 4: Start agent session
  await startAgent();

  // Step 5: Start subsystems
  startLifecycleMonitor();
  await tg.start();

  // Register health notifier - sends to HEALTH topic
  registerHealthNotifier((msg) => tg.sendToTopic(TopicType.HEALTH, msg));

  // Consciousness loop - sends to EVOLUTION topic (includes evolution & goal discovery)
  consciousness.handle = startConsciousness((msg) => tg.sendToTopic(TopicType.EVOLUTION, msg));

  // Daily briefing - sends to DAILY_BRIEFING topic
  startDailyBriefing((msg) => tg.sendToTopic(TopicType.DAILY_BRIEFING, msg));

  // Step 6: Register shutdown
  registerShutdownHandlers(async () => {
    consciousness.handle?.stop();
    stopDailyBriefing();
    stopLifecycleMonitor();
    await abortAgent();
    await tg.stop();
  });

  log.info("Jinx is alive", { version: readVersion() });

  // Notify on startup - sends to ANNOUNCEMENTS topic
  try {
    await tg.sendToTopic(
      TopicType.ANNOUNCEMENTS,
      `🐾 Jinx started.\nVersion: ${readVersion()}\nBranch: ${getCurrentBranch()} (${getCurrentSha().slice(0, 8)})`
    );
  } catch {
    // TG might not be ready yet — not fatal
  }
}

// ── Diagnostics ────────────────────────────────────────────────────

interface DiagnosticsData {
  consecutiveFailures: number;
  circuitOpen: boolean;
  pausedUntil: string | null;
  oscillations24h: number;
  currentStrategy: string;
  principleCount: number;
  avgEffectiveness: number;
  totalTraces: number;
  lastTraceStatus: string;
  lastTraceTask: string;
  recentSuccessRate: number;
}

function loadCircuitBreakerDiag(): Pick<DiagnosticsData, "consecutiveFailures" | "circuitOpen" | "pausedUntil"> {
  try {
    const cbPath = join(process.cwd(), "data", "circuit-breaker.json");
    if (existsSync(cbPath)) {
      const cbData = JSON.parse(readFileSync(cbPath, "utf-8"));
      const pausedUntil = cbData.pausedUntil ?? null;
      const circuitOpen = !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();
      return { consecutiveFailures: cbData.consecutiveFailures ?? 0, circuitOpen, pausedUntil };
    }
  } catch { /* safe */ }
  return { consecutiveFailures: 0, circuitOpen: false, pausedUntil: null };
}

function loadStrategyDiag(): Pick<DiagnosticsData, "oscillations24h" | "currentStrategy"> {
  try {
    const stratPath = join(process.cwd(), "data", "evolution-strategy.json");
    if (existsSync(stratPath)) {
      const strat = JSON.parse(readFileSync(stratPath, "utf-8"));
      const history: Array<{ timestamp: string }> = strat.strategyHistory ?? [];
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return {
        currentStrategy: strat.currentStrategy ?? "unknown",
        oscillations24h: history.filter(h => new Date(h.timestamp).getTime() > cutoff).length,
      };
    }
  } catch { /* safe */ }
  return { oscillations24h: 0, currentStrategy: "unknown" };
}

function loadPrinciplesDiag(): Pick<DiagnosticsData, "principleCount" | "avgEffectiveness"> {
  try {
    const pPath = join(process.cwd(), "data", "memory", "principles.json");
    if (existsSync(pPath)) {
      const principles: Array<{ voting?: { effectiveness?: number } }> = JSON.parse(readFileSync(pPath, "utf-8"));
      if (Array.isArray(principles) && principles.length > 0) {
        const total = principles.reduce((sum, p) => sum + (p.voting?.effectiveness ?? 0), 0);
        return { principleCount: principles.length, avgEffectiveness: total / principles.length };
      }
    }
  } catch { /* safe */ }
  return { principleCount: 0, avgEffectiveness: 0 };
}

function loadTracesDiag(): Pick<DiagnosticsData, "totalTraces" | "lastTraceStatus" | "lastTraceTask" | "recentSuccessRate"> {
  try {
    const idxPath = join(process.cwd(), "data", "traces", "index.json");
    if (existsSync(idxPath)) {
      const idx = JSON.parse(readFileSync(idxPath, "utf-8"));
      const traces: Array<{ status: string; metadata?: { taskTitle?: string } }> = idx.traces ?? [];
      const total = traces.length;
      if (total > 0) {
        const last = traces[total - 1];
        const recent = traces.slice(-10);
        const successes = recent.filter(t => t.status === "success").length;
        return {
          totalTraces: total,
          lastTraceStatus: last.status,
          lastTraceTask: (last.metadata?.taskTitle ?? "").slice(0, 40),
          recentSuccessRate: successes / recent.length,
        };
      }
    }
  } catch { /* safe */ }
  return { totalTraces: 0, lastTraceStatus: "none", lastTraceTask: "", recentSuccessRate: 0 };
}

function computeHealthScore(d: DiagnosticsData): number {
  let score = 100;
  score -= Math.min(45, d.consecutiveFailures * 15);
  score -= Math.min(25, d.oscillations24h * 5);
  if (d.principleCount > 0) score += Math.round((d.avgEffectiveness - 0.5) * 20);
  if (d.totalTraces > 0) score += Math.round((d.recentSuccessRate - 0.5) * 20);
  return Math.max(0, Math.min(100, score));
}

function failEmoji(n: number): string { return n === 0 ? "✅" : n >= 3 ? "🚨" : "⚠️"; }
function oscEmoji(n: number): string { return n === 0 ? "✅" : n >= 5 ? "🔴" : "🟡"; }
function healthEmoji(s: number): string { return s >= 80 ? "💚" : s >= 60 ? "💛" : s >= 40 ? "🟠" : "❤️"; }
function healthLabel(s: number): string { return s >= 80 ? "EXCELLENT" : s >= 60 ? "GOOD" : s >= 40 ? "DEGRADED" : "CRITICAL"; }

function buildDiagnosticsReport(): string {
  const cb = loadCircuitBreakerDiag();
  const strat = loadStrategyDiag();
  const princ = loadPrinciplesDiag();
  const traces = loadTracesDiag();
  const d: DiagnosticsData = { ...cb, ...strat, ...princ, ...traces };
  const score = computeHealthScore(d);

  const pauseStr = cb.circuitOpen ? ` (circuit OPEN until ${new Date(cb.pausedUntil!).toLocaleTimeString()})` : "";
  const traceEmoji = traces.lastTraceStatus === "success" ? "✅" : traces.lastTraceStatus === "error" ? "❌" : "⚪";
  const princEmoji = princ.principleCount === 0 ? "⚪" : "✅";

  // Quality score: average of last 5 evolution cycles
  const avgQuality = getAverageQualityScore(5);
  const qualityStr = avgQuality !== null
    ? `${avgQuality}/10`
    : "N/A (no scored cycles yet)";
  const qualityEmoji = avgQuality === null ? "⚪" : avgQuality >= 7 ? "🌟" : avgQuality >= 5 ? "✅" : "⚠️";

  const lines: string[] = [
    "🔬 Deep Diagnostics Report",
    "",
    `${failEmoji(cb.consecutiveFailures)} Consecutive Failures: ${cb.consecutiveFailures}${pauseStr}`,
    `${oscEmoji(strat.oscillations24h)} Strategy Oscillations (24h): ${strat.oscillations24h} (current: ${strat.currentStrategy})`,
    `${princEmoji} Principles: ${princ.principleCount} (avg effectiveness: ${Math.round(princ.avgEffectiveness * 100)}%)`,
    `${traceEmoji} Traces: ${traces.totalTraces} total | Last: ${traces.lastTraceStatus} | Recent success: ${Math.round(traces.recentSuccessRate * 100)}%`,
    `${qualityEmoji} Avg Evolution Quality (last 5): ${qualityStr}`,
  ];
  if (d.lastTraceTask) lines.push(`   Last task: ${d.lastTraceTask}${d.lastTraceTask.length >= 40 ? "..." : ""}`);
  lines.push("", `${healthEmoji(score)} Health Score: ${score}/100 (${healthLabel(score)})`, "", `Generated: ${new Date().toLocaleString()}`);

  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

function formatAge(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 30) return `${diffDays}d`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

// ── Entry ──────────────────────────────────────────────────────────

main().catch((e) => {
  log.error("Fatal error", { error: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
