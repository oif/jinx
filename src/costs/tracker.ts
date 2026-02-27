/**
 * API Cost Tracker
 * 
 * Tracks API usage and costs across all providers:
 * - Claude Code
 * - Web Search (Exa, Brave, Serper)
 * - GitHub API
 * - Other external calls
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { estimateClaudeCost, getSearchCost, SEARCH_PRICING, CLAUDE_PRICING } from "./pricing.js";

const DATA_DIR = join(process.cwd(), "data");
const COSTS_PATH = join(DATA_DIR, "api-costs.json");

// ── Types ──────────────────────────────────────────────────────────

export interface ApiCall {
  id: string;
  timestamp: string;
  provider: string;
  endpoint?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost: number;
  metadata?: Record<string, unknown>;
}

export interface DailyCosts {
  date: string;  // YYYY-MM-DD
  calls: ApiCall[];
  totalCost: number;
  byProvider: Record<string, { calls: number; cost: number }>;
}

export interface CostSummary {
  totalCost: number;
  totalCalls: number;
  todayCost: number;
  todayCalls: number;
  byProvider: Record<string, { calls: number; cost: number }>;
  dailyAverage: number;
  budgetRemaining?: number;
}

// ── Storage ────────────────────────────────────────────────────────

interface CostsDatabase {
  daily: DailyCosts[];
  budget?: {
    monthlyLimit: number;
    alertThreshold: number;  // Percentage (e.g., 80 for 80%)
  };
  lastAlertSent?: string;
}

function loadDatabase(): CostsDatabase {
  try {
    if (existsSync(COSTS_PATH)) {
      return JSON.parse(readFileSync(COSTS_PATH, "utf-8"));
    }
  } catch (e) {
    log.error("Failed to load costs database", { error: (e as Error).message });
  }
  return { daily: [] };
}

function saveDatabase(db: CostsDatabase): void {
  try {
    if (!existsSync(DATA_DIR)) {
      require("node:fs").mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(COSTS_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    log.error("Failed to save costs database", { error: (e as Error).message });
  }
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getOrCreateDaily(db: CostsDatabase, date: string): DailyCosts {
  let daily = db.daily.find(d => d.date === date);
  if (!daily) {
    daily = {
      date,
      calls: [],
      totalCost: 0,
      byProvider: {},
    };
    db.daily.push(daily);
    // Keep only last 90 days
    db.daily = db.daily.slice(-90);
  }
  return daily;
}

// ── Tracking Functions ─────────────────────────────────────────────

/**
 * Record an API call with cost
 */
export function recordApiCall(
  provider: string,
  cost: number,
  options?: {
    endpoint?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    metadata?: Record<string, unknown>;
  }
): ApiCall {
  const db = loadDatabase();
  const today = getToday();
  const daily = getOrCreateDaily(db, today);

  const call: ApiCall = {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    provider,
    cost,
    ...options,
  };

  daily.calls.push(call);
  daily.totalCost += cost;

  // Update byProvider stats
  if (!daily.byProvider[provider]) {
    daily.byProvider[provider] = { calls: 0, cost: 0 };
  }
  daily.byProvider[provider].calls++;
  daily.byProvider[provider].cost += cost;

  saveDatabase(db);

  log.info("API call recorded", {
    provider,
    cost: cost.toFixed(4),
    todayTotal: daily.totalCost.toFixed(4),
  });

  // Check budget alert
  checkBudgetAlert(db);

  return call;
}

/**
 * Record a Claude Code usage
 */
export function recordClaudeUsage(
  inputTokens: number = 4000,
  outputTokens: number = 2000,
  metadata?: Record<string, unknown>
): ApiCall {
  const cost = estimateClaudeCost(inputTokens, outputTokens);
  return recordApiCall("claude-code", cost, {
    model: CLAUDE_PRICING["claude-code"].model,
    inputTokens,
    outputTokens,
    metadata,
  });
}

/**
 * Record a web search usage
 */
export function recordSearchUsage(
  provider: "exa" | "brave" | "serper",
  query?: string
): ApiCall {
  const cost = getSearchCost(provider);
  return recordApiCall(provider, cost, {
    endpoint: "search",
    metadata: { query: query?.slice(0, 100) },
  });
}

/**
 * Record GitHub API usage (free, just for tracking)
 */
export function recordGitHubUsage(endpoint: string): ApiCall {
  return recordApiCall("github", 0, { endpoint });
}

// ── Query Functions ────────────────────────────────────────────────

/**
 * Get cost summary
 */
export function getCostSummary(days: number = 30): CostSummary {
  const db = loadDatabase();
  const today = getToday();
  
  // Get last N days
  const recentDays = db.daily.slice(-days);
  
  const totalCost = recentDays.reduce((sum, d) => sum + d.totalCost, 0);
  const totalCalls = recentDays.reduce((sum, d) => sum + d.calls.length, 0);
  
  const todayData = recentDays.find(d => d.date === today);
  const todayCost = todayData?.totalCost || 0;
  const todayCalls = todayData?.calls.length || 0;
  
  // Aggregate by provider
  const byProvider: Record<string, { calls: number; cost: number }> = {};
  for (const day of recentDays) {
    for (const [provider, stats] of Object.entries(day.byProvider)) {
      if (!byProvider[provider]) {
        byProvider[provider] = { calls: 0, cost: 0 };
      }
      byProvider[provider].calls += stats.calls;
      byProvider[provider].cost += stats.cost;
    }
  }

  const dailyAverage = days > 0 ? totalCost / days : 0;

  const result: CostSummary = {
    totalCost,
    totalCalls,
    todayCost,
    todayCalls,
    byProvider,
    dailyAverage,
  };

  // Add budget info if configured
  if (db.budget) {
    result.budgetRemaining = db.budget.monthlyLimit - totalCost;
  }

  return result;
}

/**
 * Get daily breakdown
 */
export function getDailyBreakdown(days: number = 7): DailyCosts[] {
  const db = loadDatabase();
  return db.daily.slice(-days);
}

/**
 * Get recent API calls
 */
export function getRecentCalls(limit: number = 20): ApiCall[] {
  const db = loadDatabase();
  const allCalls: ApiCall[] = [];
  
  // Flatten calls from recent days
  for (const day of db.daily.slice(-7)) {
    allCalls.push(...day.calls);
  }
  
  // Sort by timestamp (newest first) and limit
  return allCalls
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ── Budget Management ──────────────────────────────────────────────

/**
 * Set monthly budget
 */
export function setBudget(monthlyLimit: number, alertThreshold: number = 80): void {
  const db = loadDatabase();
  db.budget = { monthlyLimit, alertThreshold };
  saveDatabase(db);
  log.info("Budget set", { monthlyLimit, alertThreshold });
}

/**
 * Get current budget settings
 */
export function getBudget(): { monthlyLimit: number; alertThreshold: number } | null {
  const db = loadDatabase();
  return db.budget || null;
}

/**
 * Check if budget alert should be sent
 */
function checkBudgetAlert(db: CostsDatabase): boolean {
  if (!db.budget) return false;

  const today = getToday();
  
  // Only check once per day
  if (db.lastAlertSent === today) return false;

  // Get current month's usage (simplified: last 30 days)
  const summary = getCostSummary(30);
  const percentageUsed = (summary.totalCost / db.budget.monthlyLimit) * 100;

  if (percentageUsed >= db.budget.alertThreshold) {
    db.lastAlertSent = today;
    saveDatabase(db);
    return true;
  }

  return false;
}

/**
 * Check if budget alert should be sent (public version)
 */
export function shouldSendBudgetAlert(): { shouldAlert: boolean; percentage: number; remaining: number } {
  const db = loadDatabase();
  if (!db.budget) {
    return { shouldAlert: false, percentage: 0, remaining: 0 };
  }

  const summary = getCostSummary(30);
  const percentage = (summary.totalCost / db.budget.monthlyLimit) * 100;
  const remaining = db.budget.monthlyLimit - summary.totalCost;

  // Check if we already sent alert today
  const today = getToday();
  if (db.lastAlertSent === today) {
    return { shouldAlert: false, percentage, remaining };
  }

  const shouldAlert = percentage >= db.budget.alertThreshold;
  
  if (shouldAlert) {
    db.lastAlertSent = today;
    saveDatabase(db);
  }

  return { shouldAlert, percentage, remaining };
}

// ── Formatting ─────────────────────────────────────────────────────

/**
 * Format cost report for display
 */
export function formatCostReport(summary: CostSummary): string {
  const lines: string[] = [
    "💰 API Cost Report",
    "",
    `📊 Today: $${summary.todayCost.toFixed(4)} (${summary.todayCalls} calls)`,
    `📈 30-Day Total: $${summary.totalCost.toFixed(4)} (${summary.totalCalls} calls)`,
    `📉 Daily Average: $${summary.dailyAverage.toFixed(4)}`,
  ];

  if (summary.budgetRemaining !== undefined) {
    const budgetLine = summary.budgetRemaining >= 0
      ? `💵 Budget Remaining: $${summary.budgetRemaining.toFixed(4)}`
      : `🚨 Budget Exceeded: $${Math.abs(summary.budgetRemaining).toFixed(4)}`;
    lines.push(budgetLine);
  }

  lines.push("", "By Provider:");
  
  // Sort by cost (highest first)
  const sorted = Object.entries(summary.byProvider)
    .sort((a, b) => b[1].cost - a[1].cost);
  
  for (const [provider, stats] of sorted) {
    lines.push(`  ${provider}: $${stats.cost.toFixed(4)} (${stats.calls} calls)`);
  }

  return lines.join("\n");
}

/**
 * Format recent calls
 */
export function formatRecentCalls(calls: ApiCall[]): string {
  if (calls.length === 0) {
    return "No recent API calls.";
  }

  const lines: string[] = [
    "📝 Recent API Calls",
    "",
  ];

  for (const call of calls.slice(0, 10)) {
    const time = new Date(call.timestamp).toLocaleTimeString();
    const cost = call.cost > 0 ? `$${call.cost.toFixed(4)}` : "free";
    lines.push(`${time} | ${call.provider} | ${cost}`);
    if (call.metadata?.query) {
      lines.push(`  Query: ${call.metadata.query}`);
    }
  }

  return lines.join("\n");
}
