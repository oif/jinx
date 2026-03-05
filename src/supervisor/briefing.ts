/**
 * Daily Briefing Module
 * 
 * Sends a proactive daily summary to the owner at Beijing time 9:00 AM.
 * Makes Jinx an active partner, not a silent background process.
 */

import { statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { checkHealth } from "../health/check.js";
import { getRecentActivitySummary } from "../consciousness/history.js";
import { loadNextTask } from "../consciousness/loop.js";
import { readState } from "../util/state.js";
import { getCurrentSha, getCurrentBranch } from "./git-ops.js";

type NotifyFn = (message: string) => Promise<void>;

let briefingTimer: ReturnType<typeof setTimeout> | null = null;
let notifyFn: NotifyFn | null = null;

// Beijing timezone (UTC+8)
const BEIJING_TIMEZONE = "Asia/Shanghai";

/**
 * Register the notification function for briefings.
 */
export function registerBriefingNotifier(fn: NotifyFn): void {
  notifyFn = fn;
}

/**
 * Calculate milliseconds until next Beijing time 9:00 AM.
 */
function msUntilNextBriefing(): number {
  const now = new Date();
  
  // Get current time in Beijing timezone
  const beijingNow = new Date(now.toLocaleString("en-US", { timeZone: BEIJING_TIMEZONE }));
  const nowHours = beijingNow.getHours();
  const nowMinutes = beijingNow.getMinutes();
  const nowSeconds = beijingNow.getSeconds();
  const nowMs = beijingNow.getMilliseconds();
  
  // Calculate ms since midnight in Beijing time
  const msSinceMidnight = (nowHours * 60 * 60 * 1000) + (nowMinutes * 60 * 1000) + (nowSeconds * 1000) + nowMs;
  
  // Target: 9:00 AM = 9 * 60 * 60 * 1000 ms
  const targetMs = 9 * 60 * 60 * 1000;
  
  // If we haven't passed 9:00 AM yet today, target is today
  // Otherwise, target is tomorrow (add 24 hours)
  let msUntil = targetMs - msSinceMidnight;
  if (msUntil <= 0) {
    msUntil += 24 * 60 * 60 * 1000; // Add 24 hours
  }
  
  return msUntil;
}

/**
 * Get the size of the memory database (number of nodes and edges).
 */
function getMemoryStats(): { nodes: number; edges: number; totalKB: number } {
  const memoryPath = join(process.cwd(), "data", "memory");
  
  try {
    if (!existsSync(memoryPath)) {
      return { nodes: 0, edges: 0, totalKB: 0 };
    }
    
    const nodesPath = join(memoryPath, "nodes.json");
    const edgesPath = join(memoryPath, "edges.json");
    
    let nodes = 0;
    let edges = 0;
    let totalBytes = 0;
    
    if (existsSync(nodesPath)) {
      const nodesData = JSON.parse(readFileSync(nodesPath, "utf-8"));
      nodes = Array.isArray(nodesData) ? nodesData.length : 0;
      totalBytes += statSync(nodesPath).size;
    }
    
    if (existsSync(edgesPath)) {
      const edgesData = JSON.parse(readFileSync(edgesPath, "utf-8"));
      edges = Array.isArray(edgesData) ? edgesData.length : 0;
      totalBytes += statSync(edgesPath).size;
    }
    
    return { 
      nodes, 
      edges, 
      totalKB: Math.round(totalBytes / 1024 * 10) / 10 
    };
  } catch (e) {
    log.warn("Failed to read memory stats", { error: (e as Error).message });
    return { nodes: 0, edges: 0, totalKB: 0 };
  }
}

/**
 * Get current focus from goals.md (first line after header).
 */
function getCurrentFocus(): string {
  const goalsPath = join(process.cwd(), "data", "goals.md");
  
  try {
    if (!existsSync(goalsPath)) {
      return "Exploring autonomously";
    }
    
    const content = readFileSync(goalsPath, "utf-8");
    const lines = content.split("\n");
    
    // Find first non-empty, non-header line that describes a focus area
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith(">")) continue;
      if (trimmed.startsWith("---")) continue;
      if (trimmed.startsWith("## ")) {
        // Get section title as focus
        return trimmed.replace("## ", "").trim();
      }
    }
    
    return "Exploring autonomously";
  } catch {
    return "Exploring autonomously";
  }
}

/**
 * Format uptime as human readable string.
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  
  return parts.join(" ");
}

/**
 * Generate the daily briefing message.
 */
async function generateBriefing(): Promise<string> {
  const lines: string[] = [];
  const now = new Date();
  
  // Header with timestamp
  const beijingTime = now.toLocaleString("zh-CN", { 
    timeZone: BEIJING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  
  lines.push(`📅 每日简报 - ${beijingTime}`);
  lines.push("");
  
  // System health
  try {
    const health = await checkHealth({ silent: true });
    const healthEmoji = health.status === "healthy" ? "✅" : health.status === "warning" ? "⚠️" : "🚨";
    lines.push(`🏥 系统: ${healthEmoji} ${health.status.toUpperCase()}`);
    lines.push(`   内存: ${health.memory.usedPercent}% | CPU: ${health.cpu.loadPercent}% | 磁盘: ${health.disk.usedPercent}%`);
  } catch {
    lines.push("🏥 系统: ⚠️ 健康检查失败");
  }
  
  // Evolution stats (last 24 hours)
  const stats = getRecentActivitySummary(24);
  const total = stats.total;
  const successRate = total > 0 ? Math.round((stats.successful / total) * 100) : 0;
  const successEmoji = total === 0 ? "💤" : successRate >= 80 ? "🎯" : successRate >= 50 ? "📊" : "⚠️";
  
  lines.push(`🧬 进化(24h): ${successEmoji} ${stats.successful}/${total} 成功 (${successRate}%)`);
  if (stats.avgDurationMs) {
    const avgMin = Math.round(stats.avgDurationMs / 60000);
    lines.push(`   平均耗时: ${avgMin}分钟`);
  }
  
  // Backlog status
  const nextTask = loadNextTask();
  if (nextTask) {
    lines.push(`📋 待办: ${nextTask.id}: ${nextTask.title}`);
  } else {
    lines.push("📋 待办: 空（等待目标探索）");
  }
  
  // Memory stats
  const memory = getMemoryStats();
  lines.push(`🧠 记忆库: ${memory.nodes} 节点, ${memory.edges} 边 (${memory.totalKB}KB)`);
  
  // Current focus
  lines.push(`🎯 关注点: ${getCurrentFocus()}`);
  
  // System info
  const state = readState();
  const sha = getCurrentSha().slice(0, 7);
  const branch = getCurrentBranch();
  const uptime = formatUptime(process.uptime());
  
  lines.push("");
  lines.push(`ℹ️ 版本: ${state.version} | ${branch} (${sha}) | 运行: ${uptime}`);
  
  return lines.join("\n");
}

/**
 * Send the briefing to the owner.
 */
async function sendBriefing(): Promise<void> {
  if (!notifyFn) {
    log.warn("Briefing notifier not registered, skipping briefing");
    return;
  }
  
  try {
    const message = await generateBriefing();
    await notifyFn(message);
    log.info("Daily briefing sent successfully");
  } catch (e) {
    log.error("Failed to send daily briefing", { error: (e as Error).message });
  }
}

/**
 * Schedule the next briefing.
 */
function scheduleNextBriefing(): void {
  const msUntil = msUntilNextBriefing();
  const hoursUntil = (msUntil / (1000 * 60 * 60)).toFixed(1);
  
  log.info("Scheduling next briefing", { msUntil, hoursUntil, targetTime: "Beijing 9:00 AM" });
  
  briefingTimer = setTimeout(async () => {
    await sendBriefing();
    // Reschedule for next day
    scheduleNextBriefing();
  }, msUntil);
}

/**
 * Start the daily briefing scheduler.
 * Sends a briefing every day at Beijing time 9:00 AM.
 */
export function startDailyBriefing(notify: NotifyFn): void {
  if (briefingTimer) {
    log.warn("Daily briefing already running");
    return;
  }
  
  notifyFn = notify;
  
  log.info("Starting daily briefing scheduler", { targetTime: "Beijing 9:00 AM" });
  scheduleNextBriefing();
}

/**
 * Stop the daily briefing scheduler.
 */
export function stopDailyBriefing(): void {
  if (briefingTimer) {
    clearTimeout(briefingTimer);
    briefingTimer = null;
    log.info("Daily briefing stopped");
  }
}

/**
 * Manually trigger a briefing (for testing or on-demand).
 */
export async function triggerBriefing(): Promise<string> {
  return generateBriefing();
}