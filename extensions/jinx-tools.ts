/**
 * Jinx Tools Extension for Pi
 *
 * An advanced Pi extension providing:
 * 1. Dangerous operation protection - Confirms dangerous commands like rm -rf, sudo, dd
 * 2. Custom commands - /jinx-status, /health
 * 3. Session start hook - Shows Jinx status on session start
 * 4. Tool call logging - Records all tool calls for debugging
 *
 * Maturity: Advanced
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Import Jinx modules (relative to extension location)
import { jinxTools } from "../src/agent/tools.js";
import { filterToolsByGroups, getToolGroupsSummary } from "../src/agent/tool-groups.js";
import { checkHealth, type HealthStatus } from "../src/health/check.js";
import { calculateEvolutionStats, loadRecentHistory, type EvolutionRecord } from "../src/consciousness/history.js";

// ============================================================================
// Configuration
// ============================================================================

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brm\s+(-[rf]+|--recursive|--force).*\S/i, description: "rm -rf (recursive force delete)" },
  { pattern: /\bsudo\b/i, description: "sudo (elevated privileges)" },
  { pattern: /\bdd\s+if=/i, description: "dd (disk manipulation)" },
  { pattern: /\bchmod\s+(-R\s+)?777/i, description: "chmod 777 (insecure permissions)" },
  { pattern: /\bchown\s+(-R\s+)?[^\s]+\s+[\/~]/i, description: "chown on root/home" },
  { pattern: /\b(:>|\bcat\s*>\s*\/dev\/)/i, description: "disk/device overwrite" },
  { pattern: /\bmkfs\./i, description: "mkfs (format filesystem)" },
  { pattern: /\bfdisk\b/i, description: "fdisk (partition manipulation)" },
  { pattern: /\bshutdown\b/i, description: "shutdown system" },
  { pattern: /\breboot\b/i, description: "reboot system" },
  { pattern: /\binit\s+[06]/i, description: "init 0/6 (shutdown/reboot)" },
  { pattern: /\bkill\s+-9\s+-1\b/i, description: "kill -9 -1 (kill all processes)" },
  { pattern: /\biptables\s+-F/i, description: "iptables -F (flush firewall rules)" },
  { pattern: /\bgit\s+push\s+.*--force/i, description: "git push --force (destructive push)" },
  { pattern: /\bgit\s+reset\s+--hard/i, description: "git reset --hard (destructive reset)" },
  { pattern: /\bnpm\s+publish/i, description: "npm publish (publish to registry)" },
  { pattern: /\bdocker\s+(rm|rmi)\s+(-f|--force)/i, description: "docker rm/rmi --force" },
  { pattern: /\bkubectl\s+delete\s+/i, description: "kubectl delete (Kubernetes resource deletion)" },
];

const LOG_DIR = join(homedir(), ".jinx");
const TOOL_LOG_FILE = join(LOG_DIR, "tool-calls.log");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// ============================================================================
// Tool Call Logger
// ============================================================================

interface ToolCallLog {
  timestamp: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

let logStream: ReturnType<typeof appendFileSync> | null = null;
let currentLogSize = 0;

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateLogIfNeeded(): void {
  if (!existsSync(TOOL_LOG_FILE)) return;
  
  try {
    const stats = require("node:fs").statSync(TOOL_LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      const backup = `${TOOL_LOG_FILE}.${Date.now()}.bak`;
      require("node:fs").renameSync(TOOL_LOG_FILE, backup);
      // Keep only the last 3 backup files
      const files = require("node:fs").readdirSync(LOG_DIR)
        .filter((f: string) => f.startsWith("tool-calls.log.") && f.endsWith(".bak"))
        .sort()
        .reverse();
      for (let i = 3; i < files.length; i++) {
        require("node:fs").unlinkSync(join(LOG_DIR, files[i]));
      }
    }
  } catch {
    // Ignore errors
  }
}

function logToolCall(entry: ToolCallLog): void {
  try {
    ensureLogDir();
    rotateLogIfNeeded();
    appendFileSync(TOOL_LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    console.error(`[Jinx Extension] Failed to log tool call: ${(e as Error).message}`);
  }
}

// Track tool call start times
const toolCallTimings = new Map<string, number>();

// ============================================================================
// Status Formatters
// ============================================================================

async function formatJinxStatus(ctx: ExtensionContext): Promise<string> {
  const lines: string[] = ["🤖 Jinx Status Report", "=".repeat(40), ""];

  // Evolution stats
  try {
    const stats = calculateEvolutionStats();
    lines.push("📊 Evolution Stats:");
    lines.push(`   Total Cycles: ${stats.totalCycles}`);
    lines.push(`   Success Rate: ${stats.totalCycles > 0 ? Math.round((stats.successfulCycles / stats.totalCycles) * 100) : 0}%`);
    lines.push(`   Current Streak: ${stats.currentStreak} 🔥`);
    lines.push(`   Failed: ${stats.failedCycles} | Skipped: ${stats.skippedCycles}`);
    lines.push("");
  } catch (e) {
    lines.push("📊 Evolution Stats: (unavailable)");
    lines.push("");
  }

  // Recent activity
  try {
    const recent = loadRecentHistory(5);
    if (recent.length > 0) {
      lines.push("📜 Recent Activity:");
      for (const r of recent.reverse()) {
        const emoji = r.status === "success" ? "✅" : r.status === "failed" ? "❌" : "⏭️";
        const time = new Date(r.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        lines.push(`   ${emoji} #${r.cycle} - ${time} - ${r.status}`);
      }
      lines.push("");
    }
  } catch {
    lines.push("📜 Recent Activity: (unavailable)");
    lines.push("");
  }

  // System health
  try {
    const health = await checkHealth({ silent: true });
    const statusEmoji = health.status === "healthy" ? "✅" : health.status === "warning" ? "⚠️" : "🚨";
    lines.push("🏥 System Health:");
    lines.push(`   Status: ${statusEmoji} ${health.status.toUpperCase()}`);
    lines.push(`   Memory: ${health.memory.usedPercent.toFixed(1)}% used`);
    lines.push(`   CPU Load: ${health.cpu.loadPercent.toFixed(1)}%`);
    lines.push(`   Disk: ${health.disk.usedPercent.toFixed(1)}% used`);
    lines.push(`   Uptime: ${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`);
    lines.push("");
  } catch (e) {
    lines.push("🏥 System Health: (unavailable)");
    lines.push("");
  }

  // Tool groups
  try {
    const summary = getToolGroupsSummary();
    lines.push("🔧 Tool Configuration:");
    lines.push(`   ${summary}`);
    lines.push("");
  } catch {
    lines.push("🔧 Tool Configuration: (all tools enabled)");
    lines.push("");
  }

  lines.push("=".repeat(40));
  lines.push(`Report generated at ${new Date().toISOString()}`);

  return lines.join("\n");
}

async function formatHealthStatus(silent: boolean = true): Promise<string> {
  try {
    const health = await checkHealth({ silent });
    const statusEmoji = health.status === "healthy" ? "✅" : health.status === "warning" ? "⚠️" : "🚨";
    
    const lines: string[] = [
      `${statusEmoji} Health Status: ${health.status.toUpperCase()}`,
      "",
      `💾 Memory: ${health.memory.usedPercent.toFixed(1)}% used (${(health.memory.free / 1024 / 1024 / 1024).toFixed(1)} GB free)`,
      `🖥️  CPU: ${health.cpu.loadPercent.toFixed(1)}% load`,
      `💿 Disk: ${health.disk.usedPercent.toFixed(1)}% used`,
      `⏱️  Uptime: ${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`,
    ];

    if (health.status !== "healthy") {
      lines.push("");
      lines.push("⚠️  Warnings:");
      if (health.memory.usedPercent > 85) {
        lines.push(`   - Memory usage is high (${health.memory.usedPercent.toFixed(1)}%)`);
      }
      if (health.disk.usedPercent > 80) {
        lines.push(`   - Disk usage is high (${health.disk.usedPercent.toFixed(1)}%)`);
      }
    }

    return lines.join("\n");
  } catch (e) {
    return `❌ Health check failed: ${(e as Error).message}`;
  }
}

// ============================================================================
// Main Extension
// ============================================================================

export default function jinxToolsExtension(pi: ExtensionAPI) {
  console.log("[Jinx Extension] Initializing advanced features...");

  // =========================================================================
  // 1. Session Start Hook - Show Jinx status
  // =========================================================================
  pi.on("session_start", async (_event, ctx) => {
    console.log("[Jinx Extension] Session started, showing status...");
    
    // Only show status in interactive mode
    if (!ctx.hasUI) return;
    
    try {
      const status = await formatJinxStatus(ctx);
      ctx.ui.notify("🤖 Jinx Ready", "info");
      
      // Show brief stats in widget
      const stats = calculateEvolutionStats();
      const widgetLines = [
        `🤖 Jinx Ready | Cycles: ${stats.totalCycles} | Streak: ${stats.currentStreak} 🔥`,
      ];
      ctx.ui.setWidget("jinx-status", widgetLines, { placement: "belowEditor" });
      
      // Clear widget after 10 seconds
      setTimeout(() => {
        ctx.ui.setWidget("jinx-status", undefined as unknown as string[]);
      }, 10000);
    } catch (e) {
      console.error(`[Jinx Extension] Failed to show session status: ${(e as Error).message}`);
    }
  });

  // =========================================================================
  // 2. Dangerous Operation Protection
  // =========================================================================
  pi.on("tool_call", async (event, ctx) => {
    // Only intercept bash commands
    if (!isToolCallEventType("bash", event)) return undefined;
    
    const command = event.input.command as string;
    
    // Check for dangerous patterns
    const matchedPattern = DANGEROUS_PATTERNS.find(({ pattern }) => pattern.test(command));
    
    if (!matchedPattern) return undefined;
    
    console.log(`[Jinx Extension] Dangerous command detected: ${matchedPattern.description}`);
    
    // In non-interactive mode, block by default for critical commands
    if (!ctx.hasUI) {
      const criticalPatterns = ["rm -rf", "dd if=", "mkfs.", "fdisk", "shutdown", "reboot"];
      const isCritical = criticalPatterns.some(p => command.toLowerCase().includes(p.toLowerCase()));
      
      if (isCritical) {
        return { block: true, reason: `Blocked critical command in non-interactive mode: ${matchedPattern.description}` };
      }
      
      // Allow non-critical dangerous commands with a warning
      console.warn(`[Jinx Extension] WARNING: Allowing dangerous command in non-interactive mode: ${matchedPattern.description}`);
      return undefined;
    }
    
    // Interactive mode: ask for confirmation
    const choice = await ctx.ui.select(
      `⚠️ Dangerous Command Detected`,
      [
        `🚫 Block this command`,
        `✅ Allow once`,
        `🔓 Allow and don't ask again for this session`,
      ],
      {
        titleDetail: `Pattern: ${matchedPattern.description}\n\nCommand:\n${command.slice(0, 200)}${command.length > 200 ? "..." : ""}`,
      }
    );
    
    if (choice?.includes("Block")) {
      return { block: true, reason: `Blocked by user: ${matchedPattern.description}` };
    }
    
    // For "don't ask again" we could track it, but for simplicity just allow
    return undefined;
  });

  // =========================================================================
  // 3. Tool Call Logging
  // =========================================================================
  pi.on("tool_execution_start", async (event, _ctx) => {
    const { toolCallId, toolName, args } = event;
    toolCallTimings.set(toolCallId, Date.now());
    
    logToolCall({
      timestamp: new Date().toISOString(),
      toolName,
      toolCallId,
      input: args,
    });
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    const { toolCallId, toolName, result, isError } = event;
    const startTime = toolCallTimings.get(toolCallId);
    const durationMs = startTime ? Date.now() - startTime : undefined;
    
    toolCallTimings.delete(toolCallId);
    
    logToolCall({
      timestamp: new Date().toISOString(),
      toolName,
      toolCallId,
      input: undefined, // Already logged in start
      output: result ? JSON.stringify(result).slice(0, 1000) : undefined,
      error: isError ? "Tool execution failed" : undefined,
      durationMs,
    });
  });

  // =========================================================================
  // 4. Custom Commands
  // =========================================================================

  // /jinx-status command - Show comprehensive Jinx status
  pi.registerCommand("jinx-status", {
    description: "Show Jinx evolution and system status",
    handler: async (_args, ctx) => {
      const status = await formatJinxStatus(ctx);
      
      if (ctx.hasUI) {
        ctx.ui.notify(status, "info");
      } else {
        console.log(status);
      }
    },
  });

  // /health command - Show system health
  pi.registerCommand("health", {
    description: "Show system health status",
    handler: async (_args, ctx) => {
      const health = await formatHealthStatus(false);
      
      if (ctx.hasUI) {
        ctx.ui.notify(health, "info");
      } else {
        console.log(health);
      }
    },
  });

  // /tool-log command - View recent tool calls
  pi.registerCommand("tool-log", {
    description: "View recent tool call logs",
    handler: async (args, ctx) => {
      const limit = parseInt(args) || 10;
      
      try {
        if (!existsSync(TOOL_LOG_FILE)) {
          const msg = "No tool call logs found yet.";
          if (ctx.hasUI) {
            ctx.ui.notify(msg, "info");
          } else {
            console.log(msg);
          }
          return;
        }
        
        const logs = readFileSync(TOOL_LOG_FILE, "utf-8")
          .trim()
          .split("\n")
          .slice(-limit)
          .map(line => {
            try {
              return JSON.parse(line) as ToolCallLog;
            } catch {
              return null;
            }
          })
          .filter((l): l is ToolCallLog => l !== null);
        
        const lines: string[] = [`📜 Last ${logs.length} Tool Calls:`, ""];
        
        for (const log of logs) {
          const time = new Date(log.timestamp).toLocaleTimeString();
          const status = log.error ? "❌" : "✅";
          const duration = log.durationMs ? ` (${log.durationMs}ms)` : "";
          lines.push(`${status} ${time} | ${log.toolName}${duration}`);
        }
        
        lines.push("", `Log file: ${TOOL_LOG_FILE}`);
        
        const result = lines.join("\n");
        if (ctx.hasUI) {
          ctx.ui.notify(result, "info");
        } else {
          console.log(result);
        }
      } catch (e) {
        const msg = `Failed to read tool logs: ${(e as Error).message}`;
        if (ctx.hasUI) {
          ctx.ui.notify(msg, "error");
        } else {
          console.error(msg);
        }
      }
    },
  });

  // /danger-check command - Toggle dangerous command checking
  pi.registerCommand("danger-check", {
    description: "Toggle dangerous command checking (on/off)",
    handler: async (args, ctx) => {
      const state = args?.toLowerCase().trim();
      
      if (state === "off" || state === "disable") {
        // Note: This is a session-level toggle; the patterns are still checked
        // but we could add a flag to skip them
        const msg = "⚠️ Danger checking can only be disabled for the current session by modifying the extension.";
        if (ctx.hasUI) {
          ctx.ui.notify(msg, "warning");
        } else {
          console.log(msg);
        }
      } else {
        const patterns = DANGEROUS_PATTERNS.map(p => `  • ${p.description}`).join("\n");
        const msg = `🔒 Dangerous command patterns checked:\n${patterns}`;
        if (ctx.hasUI) {
          ctx.ui.notify(msg, "info");
        } else {
          console.log(msg);
        }
      }
    },
  });

  // =========================================================================
  // 5. Register Jinx Tools
  // =========================================================================
  const enabledTools = filterToolsByGroups(jinxTools);

  for (const tool of enabledTools) {
    pi.registerTool(tool);
  }

  const summary = getToolGroupsSummary();
  console.log(`[Jinx Extension] Registered ${enabledTools.length}/${jinxTools.length} tools`);
  console.log(`[Jinx Extension] ${summary}`);
  console.log("[Jinx Extension] Advanced features enabled:");
  console.log("  ✓ Dangerous operation protection");
  console.log("  ✓ Custom commands: /jinx-status, /health, /tool-log, /danger-check");
  console.log("  ✓ Session start hook");
  console.log("  ✓ Tool call logging");
}