/**
 * Principle Retriever Module
 * 
 * Bridges the gap between Experience Distillation and decision-making.
 * Retrieves relevant principles for evolution tasks and formats them
 * for injection into prompts.
 * 
 * This completes the EvolveR closed loop:
 * 1. Experience Distillation extracts principles from trajectories
 * 2. Principle Store persists and manages principles
 * 3. Principle Retriever selects relevant principles for current context
 * 4. Principles guide evolution decisions
 * 5. Results feed back into distillation
 */

import {
  retrievePrinciples,
  getPrinciple,
  recordPrincipleApplication,
  type PrincipleQuery,
  type PrincipleCategory,
  type ScoredPrinciple,
} from "./principle-store.js";
import { log } from "../util/log.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

const RETRIEVAL_PATH = join(DATA_DIR, "memory", "principle-retrievals.json");

// ── Types ──────────────────────────────────────────────────────────

/**
 * Context for principle retrieval
 */
export interface PrincipleRetrievalContext {
  taskId: string;              // e.g., "#001"
  taskTitle: string;           // e.g., "Fix memory leak in reflection module"
  taskDescription?: string;    // Optional additional context
  modules?: string[];          // Modules likely involved
  taskType?: TaskType;         // Type of task
  riskLevel?: "low" | "medium" | "high";
  maxPrinciples?: number;      // Maximum principles to retrieve
}

/**
 * Task type classification
 */
export type TaskType =
  | "refactor"
  | "bugfix"
  | "feature"
  | "testing"
  | "documentation"
  | "optimization"
  | "security"
  | "cleanup"
  | "integration"
  | "general";

/**
 * Result of principle retrieval
 */
export interface RetrievalResult {
  principles: ScoredPrinciple[];
  taskType: TaskType;
  inferredModules: string[];
  queryUsed: PrincipleQuery;
  retrievalTimeMs: number;
}

/**
 * Record of a principle retrieval for feedback
 */
export interface RetrievalRecord {
  timestamp: string;
  evolutionId: string;
  taskId: string;
  taskTitle: string;
  retrievedPrincipleIds: string[];
  taskType: TaskType;
  modules: string[];
  result?: "success" | "failure" | "neutral";
  resultRecordedAt?: string;
}

// ── Configuration ──────────────────────────────────────────────────

const RETRIEVAL_CONFIG = {
  maxPrinciples: 5,           // Default max principles to retrieve
  minRelevanceScore: 0.3,     // Minimum score to include
  cacheExpiryMs: 5 * 60 * 1000, // Cache expiry: 5 minutes
  enableFeedback: true,        // Record principle applications for feedback
};

// ── Storage Functions ──────────────────────────────────────────────

interface RetrievalHistory {
  retrievals: RetrievalRecord[];
  lastCleanup: string;
}

function loadRetrievalHistory(): RetrievalHistory {
  try {
    if (existsSync(RETRIEVAL_PATH)) {
      return JSON.parse(readFileSync(RETRIEVAL_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load retrieval history", { error: (e as Error).message });
  }
  return {
    retrievals: [],
    lastCleanup: new Date().toISOString(),
  };
}

function saveRetrievalHistory(history: RetrievalHistory): void {
  try {
    const dir = join(DATA_DIR, "memory");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Keep only last 100 retrievals
    history.retrievals = history.retrievals.slice(-100);
    writeFileSync(RETRIEVAL_PATH, JSON.stringify(history, null, 2));
  } catch (e) {
    log.error("Failed to save retrieval history", { error: (e as Error).message });
  }
}

// ── Task Type Inference ────────────────────────────────────────────

/**
 * Task type keyword patterns for inference
 */
const TASK_TYPE_PATTERNS: Array<{ keywords: string[]; type: TaskType }> = [
  { keywords: ["refactor", "restructure"], type: "refactor" },
  { keywords: ["fix", "bug", "issue", "error"], type: "bugfix" },
  { keywords: ["implement", "add", "feature", "create"], type: "feature" },
  { keywords: ["test", "spec", "coverage"], type: "testing" },
  { keywords: ["document", "readme", "comment"], type: "documentation" },
  { keywords: ["optimiz", "perf", "speed", "memory"], type: "optimization" },
  { keywords: ["secur", "auth", "permission"], type: "security" },
  { keywords: ["clean", "remov", "delet", "deprecate"], type: "cleanup" },
  { keywords: ["integrat", "connect", "api"], type: "integration" },
];

/**
 * Infer task type from task ID and title
 */
export function inferTaskType(taskId: string, taskTitle: string): TaskType {
  const text = `${taskId} ${taskTitle}`.toLowerCase();
  
  for (const { keywords, type } of TASK_TYPE_PATTERNS) {
    if (keywords.some(kw => text.includes(kw))) {
      return type;
    }
  }
  
  return "general";
}

/**
 * Infer task type with category mapping for principles
 */
function inferPrincipleCategory(taskType: TaskType): PrincipleCategory {
  const mapping: Record<TaskType, PrincipleCategory> = {
    refactor: "coding",
    bugfix: "error_handling",
    feature: "coding",
    testing: "testing",
    documentation: "process",
    optimization: "optimization",
    security: "security",
    cleanup: "process",
    integration: "architecture",
    general: "general",
  };
  return mapping[taskType];
}

// ── Module Inference ───────────────────────────────────────────────

/**
 * Known module patterns to look for in task descriptions
 */
const MODULE_PATTERNS: Array<{ pattern: RegExp; module: string }> = [
  { pattern: /\bmemory\b/i, module: "memory" },
  { pattern: /\breflection\b/i, module: "reflection" },
  { pattern: /\bprinciple/i, module: "principle" },
  { pattern: /\btelegram\b/i, module: "telegram" },
  { pattern: /\bagent\b/i, module: "agent" },
  { pattern: /\bconsciousness\b/i, module: "consciousness" },
  { pattern: /\bsupervisor\b/i, module: "supervisor" },
  { pattern: /\bevolution\b/i, module: "evolution" },
  { pattern: /\bhealth\b/i, module: "health" },
  { pattern: /\btest\b/i, module: "testing" },
  { pattern: /\bobservability\b/i, module: "observability" },
  { pattern: /\bmetrics\b/i, module: "metrics" },
  { pattern: /\bgraph\b/i, module: "graph" },
  { pattern: /\bcapabilit/i, module: "capabilities" },
  { pattern: /\bmetacognit/i, module: "metacognitive" },
  { pattern: /\bloop\b/i, module: "loop" },
  { pattern: /\bstrategy\b/i, module: "strategy" },
  { pattern: /\bconfig\b/i, module: "config" },
  { pattern: /\butil\b/i, module: "util" },
];

/**
 * Infer modules from task context
 */
export function inferModules(taskId: string, taskTitle: string, description?: string): string[] {
  const text = `${taskId} ${taskTitle} ${description || ""}`.toLowerCase();
  const modules: string[] = [];
  
  for (const { pattern, module } of MODULE_PATTERNS) {
    if (pattern.test(text) && !modules.includes(module)) {
      modules.push(module);
    }
  }
  
  return modules;
}

// ── Risk Level Inference ───────────────────────────────────────────

/** High risk text keywords */
const HIGH_RISK_KEYWORDS = ["critical", "breaking", "security", "data loss", "migration", "core"];
/** High risk modules */
const HIGH_RISK_MODULES = ["supervisor", "consciousness", "loop"];
/** Medium risk text keywords */
const MEDIUM_RISK_KEYWORDS = ["refactor", "major", "integration"];
/** Medium risk modules */
const MEDIUM_RISK_MODULES = ["memory", "agent"];
/** Low risk text keywords */
const LOW_RISK_KEYWORDS = ["document", "test", "clean"];

/**
 * Infer risk level from task context
 */
export function inferRiskLevel(taskId: string, taskTitle: string, modules: string[]): "low" | "medium" | "high" {
  const text = `${taskId} ${taskTitle}`.toLowerCase();
  
  // High risk indicators
  if (HIGH_RISK_KEYWORDS.some(kw => text.includes(kw))) {
    return "high";
  }
  
  // Core modules are high risk
  if (modules.some(m => HIGH_RISK_MODULES.includes(m))) {
    return "high";
  }
  
  // Medium risk indicators
  if (MEDIUM_RISK_KEYWORDS.some(kw => text.includes(kw)) || modules.some(m => MEDIUM_RISK_MODULES.includes(m))) {
    return "medium";
  }
  
  // Low risk for documentation, tests, cleanup
  if (LOW_RISK_KEYWORDS.some(kw => text.includes(kw))) {
    return "low";
  }
  
  return "medium";
}

// ── Main Retrieval Function ────────────────────────────────────────

/**
 * Retrieve principles relevant to a task context
 */
export function retrieveRelevantPrinciples(
  context: PrincipleRetrievalContext
): RetrievalResult {
  const startTime = Date.now();
  
  // Infer missing fields
  const taskType = context.taskType || inferTaskType(context.taskId, context.taskTitle);
  const modules = context.modules || inferModules(context.taskId, context.taskTitle, context.taskDescription);
  const riskLevel = context.riskLevel || inferRiskLevel(context.taskId, context.taskTitle, modules);
  const category = inferPrincipleCategory(taskType);
  
  // Build query
  const query: PrincipleQuery = {
    text: `${context.taskId} ${context.taskTitle} ${context.taskDescription || ""}`,
    category,
    status: "active", // Only active principles
    minConfidence: 0.4,
    minSuccessRate: 0.3,
    conditions: {
      taskTypes: [taskType, "general"], // Include general principles
      modules: modules.length > 0 ? modules : undefined,
      riskLevel,
    },
    limit: context.maxPrinciples || RETRIEVAL_CONFIG.maxPrinciples,
  };
  
  // Retrieve principles
  let principles = retrievePrinciples(query);
  
  // Filter by minimum relevance
  principles = principles.filter(p => p.score >= RETRIEVAL_CONFIG.minRelevanceScore);
  
  // If no principles found with category, try without category filter
  if (principles.length === 0) {
    const broaderQuery: PrincipleQuery = {
      ...query,
      category: undefined, // Remove category restriction
      minConfidence: 0.3,
    };
    principles = retrievePrinciples(broaderQuery);
    principles = principles.filter(p => p.score >= RETRIEVAL_CONFIG.minRelevanceScore);
  }
  
  // If still no principles, get any active principles
  if (principles.length === 0) {
    const fallbackQuery: PrincipleQuery = {
      status: "active",
      limit: 3,
      minConfidence: 0.5,
    };
    principles = retrievePrinciples(fallbackQuery);
  }
  
  const retrievalTimeMs = Date.now() - startTime;
  
  log.info("Principles retrieved", {
    taskId: context.taskId,
    taskType,
    modules,
    principlesFound: principles.length,
    retrievalTimeMs,
  });
  
  return {
    principles,
    taskType,
    inferredModules: modules,
    queryUsed: query,
    retrievalTimeMs,
  };
}

// ── Formatting for Prompts ──────────────────────────────────────────

/**
 * Format principles for inclusion in evolution prompt
 */
export function formatPrinciplesForPrompt(principles: ScoredPrinciple[]): string {
  if (principles.length === 0) {
    return "";
  }
  
  const lines: string[] = [
    "",
    "📚 相关原则 (Relevant Principles)",
    "",
  ];
  
  for (let i = 0; i < principles.length; i++) {
    const { principle, score, matchReasons } = principles[i];
    const confidence = (principle.metadata.confidence * 100).toFixed(0);
    const successRate = principle.evidence.totalApplications > 0
      ? (principle.evidence.successRate * 100).toFixed(0)
      : "N/A";
    
    lines.push(`**${i + 1}. ${principle.summary}**`);
    lines.push(`   ${principle.content}`);
    lines.push(`   置信度: ${confidence}% | 成功率: ${successRate} | 相关度: ${(score * 100).toFixed(0)}%`);
    
    if (matchReasons.length > 0) {
      lines.push(`   匹配: ${matchReasons.join(", ")}`);
    }
    
    if (principle.examples && principle.examples.length > 0) {
      lines.push(`   示例: ${principle.examples[0]}`);
    }
    
    lines.push("");
  }
  
  lines.push("在执行任务时参考这些原则，特别是与你当前任务类型和模块相关的原则。");
  
  return lines.join("\n");
}

/**
 * Format a concise principle summary for prompt injection
 */
export function formatPrincipleSummary(principles: ScoredPrinciple[], maxLength: number = 500): string {
  if (principles.length === 0) {
    return "";
  }
  
  const parts: string[] = [];
  let totalLength = 0;
  
  for (const { principle, score } of principles) {
    const entry = `• ${principle.summary} (${(score * 100).toFixed(0)}% 相关)`;
    if (totalLength + entry.length > maxLength) break;
    parts.push(entry);
    totalLength += entry.length;
  }
  
  if (parts.length === 0) {
    return "";
  }
  
  return `\n📚 相关原则:\n${parts.join("\n")}\n`;
}

// ── Retrieval with Recording ───────────────────────────────────────

/**
 * Retrieve principles and record the retrieval for later feedback
 */
export function retrieveAndRecord(
  context: PrincipleRetrievalContext,
  evolutionId: string
): RetrievalResult {
  const result = retrieveRelevantPrinciples(context);
  
  // Record the retrieval
  const record: RetrievalRecord = {
    timestamp: new Date().toISOString(),
    evolutionId,
    taskId: context.taskId,
    taskTitle: context.taskTitle,
    retrievedPrincipleIds: result.principles.map(p => p.principle.id),
    taskType: result.taskType,
    modules: result.inferredModules,
  };
  
  const history = loadRetrievalHistory();
  history.retrievals.push(record);
  saveRetrievalHistory(history);
  
  return result;
}

/**
 * Record the result of an evolution that used retrieved principles
 * This completes the feedback loop for Experience Distillation
 */
export function recordRetrievalResult(
  evolutionId: string,
  result: "success" | "failure" | "neutral"
): void {
  if (!RETRIEVAL_CONFIG.enableFeedback) return;
  
  const history = loadRetrievalHistory();
  const retrieval = history.retrievals.find(r => r.evolutionId === evolutionId);
  
  if (!retrieval) {
    log.warn("No retrieval record found for evolution", { evolutionId });
    return;
  }
  
  retrieval.result = result;
  retrieval.resultRecordedAt = new Date().toISOString();
  saveRetrievalHistory(history);
  
  // Record principle application results for each principle
  for (const principleId of retrieval.retrievedPrincipleIds) {
    try {
      recordPrincipleApplication(
        principleId,
        evolutionId,
        `Task: ${retrieval.taskId} - ${retrieval.taskTitle}`,
        result
      );
    } catch (e) {
      log.warn("Failed to record principle application", {
        principleId,
        evolutionId,
        error: (e as Error).message,
      });
    }
  }
  
  log.info("Retrieval result recorded", {
    evolutionId,
    result,
    principlesCount: retrieval.retrievedPrincipleIds.length,
  });
}

// ── Utility Functions ───────────────────────────────────────────────

/**
 * Get retrieval statistics
 */
export function getRetrievalStats(): {
  totalRetrievals: number;
  successRate: number;
  topPrinciples: Array<{ id: string; summary: string; count: number }>;
  topTaskTypes: Array<{ type: string; count: number }>;
} {
  const history = loadRetrievalHistory();
  
  // Count principle retrievals
  const principleCounts = new Map<string, { summary: string; count: number }>();
  for (const r of history.retrievals) {
    for (const id of r.retrievedPrincipleIds) {
      const existing = principleCounts.get(id);
      if (existing) {
        existing.count++;
      } else {
        const principle = getPrinciple(id);
        principleCounts.set(id, {
          summary: principle?.summary || "Unknown",
          count: 1,
        });
      }
    }
  }
  
  // Sort by count
  const topPrinciples = Array.from(principleCounts.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Count task types
  const taskTypeCounts = new Map<string, number>();
  for (const r of history.retrievals) {
    taskTypeCounts.set(r.taskType, (taskTypeCounts.get(r.taskType) || 0) + 1);
  }
  
  const topTaskTypes = Array.from(taskTypeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  
  // Calculate success rate
  const withResult = history.retrievals.filter(r => r.result);
  const successCount = withResult.filter(r => r.result === "success").length;
  const successRate = withResult.length > 0 ? successCount / withResult.length : 0;
  
  return {
    totalRetrievals: history.retrievals.length,
    successRate,
    topPrinciples,
    topTaskTypes,
  };
}

/**
 * Clear old retrieval records
 */
export function cleanupRetrievalRecords(maxAge: number = 30 * 24 * 60 * 60 * 1000): number {
  const history = loadRetrievalHistory();
  const cutoff = Date.now() - maxAge;
  
  const originalCount = history.retrievals.length;
  history.retrievals = history.retrievals.filter(
    r => new Date(r.timestamp).getTime() > cutoff
  );
  history.lastCleanup = new Date().toISOString();
  
  saveRetrievalHistory(history);
  
  const removed = originalCount - history.retrievals.length;
  if (removed > 0) {
    log.info("Cleaned up old retrieval records", { removed });
  }
  
  return removed;
}

/**
 * Get principles formatted for strategy modifier injection
 */
export function getPrinciplesForEvolution(
  taskId: string,
  taskTitle: string,
  evolutionId: string,
  maxPrinciples: number = 5
): string {
  const context: PrincipleRetrievalContext = {
    taskId,
    taskTitle,
    maxPrinciples,
  };
  
  const result = retrieveAndRecord(context, evolutionId);
  
  // Return formatted principles
  return formatPrinciplesForPrompt(result.principles);
}

/**
 * Get a concise principle hint for quick display
 */
export function getPrincipleHint(taskId: string, taskTitle: string): string {
  const result = retrieveRelevantPrinciples({
    taskId,
    taskTitle,
    maxPrinciples: 3,
  });
  
  return formatPrincipleSummary(result.principles, 300);
}