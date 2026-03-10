/**
 * Reflective Self-Improvement Module
 * 
 * Based on MARS paper (Memory-Enhanced Agents with Reflective Self-improvement):
 * - Periodically reviews past experiences from evolution history and memory nodes
 * - Extracts success/failure patterns
 * - Generates actionable improvement suggestions
 * - Stores insights back to memory graph for future reference
 * 
 * Core Components:
 * 1. Experience Review: Analyze evolution history and memory nodes
 * 2. Pattern Extraction: Identify recurring themes, success factors, failure causes
 * 3. Suggestion Generation: Create concrete improvement recommendations
 * 4. Insight Storage: Persist reflections to memory graph
 */

import {
  MemoryNode,
  encodeMemory,
  retrieveMemories,
  MemoryQuery,
} from "./graph.js";
import {
  loadEvolutionHistory,
  EvolutionRecord,
  EvolutionStats,
  calculateEvolutionStats,
} from "../consciousness/history.js";
import { log } from "../util/log.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

const REFLECTION_PATH = join(DATA_DIR, "memory", "reflections.json");

// ── Types ──────────────────────────────────────────────────────────

export interface ReflectionInsight {
  id: string;
  type: "pattern" | "suggestion" | "warning" | "success_factor" | "failure_cause";
  category: string; // e.g., "code_quality", "testing", "architecture", "process"
  title: string;
  description: string;
  evidence: string[]; // Supporting evidence from history
  confidence: number; // 0-1, how confident we are about this insight
  createdAt: string;
  lastReinforced?: string;
  reinforcementCount: number;
  actionable: boolean;
  actionSuggestion?: string;
}

export interface ReflectionSession {
  id: string;
  timestamp: string;
  triggerReason: string;
  cyclesAnalyzed: number;
  insights: ReflectionInsight[];
  patterns: ExtractedPattern[];
  suggestions: ImprovementSuggestion[];
  stats: ReflectionStats;
}

export interface ExtractedPattern {
  type: "success" | "failure" | "neutral";
  description: string;
  frequency: number;
  examples: string[]; // Task IDs or summaries
  relatedCategories: string[];
}

export interface ImprovementSuggestion {
  id: string;
  priority: "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  rationale: string;
  relatedInsights: string[]; // Insight IDs
  status: "pending" | "in_progress" | "completed" | "dismissed";
  createdAt: string;
  appliedAt?: string;
  result?: string;
}

export interface ReflectionStats {
  successRate: number;
  avgDurationMs: number;
  commonFailureReasons: Array<{ reason: string; count: number }>;
  commonSuccessFactors: Array<{ factor: string; count: number }>;
  categoryPerformance: Record<string, { success: number; failure: number }>;
}

// ── Configuration ──────────────────────────────────────────────────

const REFLECTION_INTERVAL_CYCLES = 5; // Trigger reflection every N evolutions
const MIN_HISTORY_FOR_REFLECTION = 3; // Minimum history entries needed for history-based trigger
const INSIGHT_CONFIDENCE_THRESHOLD = 0.6; // Minimum confidence to store insight
const FORCED_REFLECTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours - fallback time-based trigger
const MIN_MEMORY_NODES_FOR_TRIGGER = 5; // Alternative trigger: minimum memory nodes

// ── ID Generation ──────────────────────────────────────────────────

function generateReflectionId(): string {
  return `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateInsightId(): string {
  return `ins_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function generateSuggestionId(): string {
  return `sug_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Reflection Storage ──────────────────────────────────────────────

export function loadReflections(): ReflectionSession[] {
  try {
    if (existsSync(REFLECTION_PATH)) {
      return JSON.parse(readFileSync(REFLECTION_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load reflections", { error: (e as Error).message });
  }
  return [];
}

function saveReflections(reflections: ReflectionSession[]): void {
  try {
    if (!existsSync(join(DATA_DIR, "memory"))) {
      writeFileSync(join(DATA_DIR, "memory", ".gitkeep"), "");
    }
    writeFileSync(REFLECTION_PATH, JSON.stringify(reflections, null, 2));
  } catch (e) {
    log.error("Failed to save reflections", { error: (e as Error).message });
  }
}

// ── Experience Review ───────────────────────────────────────────────

/**
 * Analyze evolution history to extract experiences for reflection.
 */
export function reviewExperiences(options: {
  since?: Date;
  limit?: number;
}): {
  records: EvolutionRecord[];
  stats: EvolutionStats;
} {
  const history = loadEvolutionHistory();
  let records = history;

  if (options.since) {
    const sinceTime = options.since.getTime();
    records = records.filter((r) => new Date(r.timestamp).getTime() >= sinceTime);
  }

  if (options.limit) {
    records = records.slice(-options.limit);
  }

  const stats = calculateEvolutionStats();

  return { records, stats };
}

/**
 * Query memory for experience-type nodes.
 */
export function queryExperienceMemories(): MemoryNode[] {
  const query: MemoryQuery = {
    type: "experience",
    limit: 50,
  };
  const results = retrieveMemories(query);
  return results.map((r) => r.node);
}

/**
 * Query memory for goal-type nodes.
 */
export function queryGoalMemories(): MemoryNode[] {
  const query: MemoryQuery = {
    type: "goal",
    limit: 20,
  };
  const results = retrieveMemories(query);
  return results.map((r) => r.node);
}

// ── Pattern Extraction ─────────────────────────────────────────────

/**
 * Extract patterns from evolution records.
 */
export function extractPatterns(records: EvolutionRecord[]): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];

  // Group by status
  const successes = records.filter((r) => r.status === "success");
  const failures = records.filter((r) => r.status === "failed");

  // Extract success patterns
  const successThemes = extractThemes(successes.map((r) => r.summary));
  for (const theme of successThemes) {
    patterns.push({
      type: "success",
      description: theme.description,
      frequency: theme.count,
      examples: theme.examples,
      relatedCategories: inferCategories(theme.description),
    });
  }

  // Extract failure patterns
  const failureThemes = extractThemes(failures.map((r) => r.summary));
  for (const theme of failureThemes) {
    patterns.push({
      type: "failure",
      description: theme.description,
      frequency: theme.count,
      examples: theme.examples,
      relatedCategories: inferCategories(theme.description),
    });
  }

  // Analyze duration patterns
  const durations = records.filter((r) => r.durationMs).map((r) => r.durationMs!);
  if (durations.length >= 3) {
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const slowRecords = records.filter((r) => r.durationMs && r.durationMs > avgDuration * 2);

    if (slowRecords.length > 0) {
      patterns.push({
        type: "neutral",
        description: `Long-running tasks detected (${slowRecords.length} tasks took >2x average time)`,
        frequency: slowRecords.length,
        examples: slowRecords.map((r) => `#${r.cycle}`).slice(0, 3),
        relatedCategories: ["performance", "process"],
      });
    }
  }

  return patterns.sort((a, b) => b.frequency - a.frequency);
}

interface ThemeExtraction {
  description: string;
  count: number;
  examples: string[];
}

/**
 * Extract common themes from text summaries.
 */
function extractThemes(summaries: string[]): ThemeExtraction[] {
  const keywords = new Map<string, { count: number; examples: string[] }>();

  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "was", "one", "our", "out", "has", "his", "how", "new", "now", "its",
    "with", "this", "will", "your", "from", "they", "been", "some", "time",
    "when", "just", "like", "make", "than", "them", "were", "evolution",
    "cycle", "task", "completed", "done", "finished",
  ]);

  for (const summary of summaries) {
    const words = summary
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4 && !stopWords.has(w));

    const seen = new Set<string>();
    for (const word of words) {
      if (!seen.has(word)) {
        const entry = keywords.get(word) || { count: 0, examples: [] };
        entry.count++;
        if (entry.examples.length < 3) {
          entry.examples.push(summary.slice(0, 50) + "...");
        }
        keywords.set(word, entry);
        seen.add(word);
      }
    }
  }

  return Array.from(keywords.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([word, data]) => ({
      description: `Frequent theme: "${word}"`,
      count: data.count,
      examples: data.examples,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * Infer categories from a description.
 */
// eslint-disable-next-line complexity
function inferCategories(description: string): string[] {
  const categories: string[] = [];
  const lower = description.toLowerCase();

  if (lower.includes("test") || lower.includes("testing")) categories.push("testing");
  if (lower.includes("code") || lower.includes("implement") || lower.includes("refactor")) {
    categories.push("code_quality");
  }
  if (lower.includes("error") || lower.includes("fail") || lower.includes("bug")) {
    categories.push("error_handling");
  }
  if (lower.includes("memory") || lower.includes("data") || lower.includes("store")) {
    categories.push("data_management");
  }
  if (lower.includes("api") || lower.includes("integration") || lower.includes("connect")) {
    categories.push("integration");
  }
  if (lower.includes("performance") || lower.includes("slow") || lower.includes("fast")) {
    categories.push("performance");
  }
  if (lower.includes("document") || lower.includes("comment") || lower.includes("readme")) {
    categories.push("documentation");
  }
  if (lower.includes("security") || lower.includes("auth") || lower.includes("permission")) {
    categories.push("security");
  }
  if (lower.includes("process") || lower.includes("workflow") || lower.includes("automation")) {
    categories.push("process");
  }

  if (categories.length === 0) categories.push("general");

  return categories;
}

// ── Stats Computation ───────────────────────────────────────────────

/**
 * Compute reflection statistics from records.
 */
export function computeReflectionStats(records: EvolutionRecord[]): ReflectionStats {
  const total = records.length;
  const successes = records.filter((r) => r.status === "success").length;
  // failures count can be derived from total - successes, no need to calculate separately

  // Success rate
  const successRate = total > 0 ? successes / total : 0;

  // Average duration
  const durations = records.filter((r) => r.durationMs).map((r) => r.durationMs!);
  const avgDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Common failure reasons (from summaries)
  const failureReasons = new Map<string, number>();
  for (const record of records.filter((r) => r.status === "failed")) {
    // Extract key words from failure summary
    const words = record.summary
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);

    for (const word of words.slice(0, 5)) {
      failureReasons.set(word, (failureReasons.get(word) || 0) + 1);
    }
  }

  const commonFailureReasons = Array.from(failureReasons.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  // Common success factors
  const successFactors = new Map<string, number>();
  for (const record of records.filter((r) => r.status === "success")) {
    const words = record.summary
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4);

    for (const word of words.slice(0, 5)) {
      successFactors.set(word, (successFactors.get(word) || 0) + 1);
    }
  }

  const commonSuccessFactors = Array.from(successFactors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([factor, count]) => ({ factor, count }));

  // Category performance (inferred from summaries)
  const categoryPerformance: Record<string, { success: number; failure: number }> = {};

  for (const record of records) {
    const categories = inferCategories(record.summary);
    for (const cat of categories) {
      if (!categoryPerformance[cat]) {
        categoryPerformance[cat] = { success: 0, failure: 0 };
      }
      if (record.status === "success") {
        categoryPerformance[cat].success++;
      } else if (record.status === "failed") {
        categoryPerformance[cat].failure++;
      }
    }
  }

  return {
    successRate,
    avgDurationMs,
    commonFailureReasons,
    commonSuccessFactors,
    categoryPerformance,
  };
}

// ── Insight Generation ──────────────────────────────────────────────

/**
 * Generate insights from patterns and stats.
 */
export function generateInsights(
  patterns: ExtractedPattern[],
  stats: ReflectionStats,
  records: EvolutionRecord[],
): ReflectionInsight[] {
  const insights: ReflectionInsight[] = [];
  const now = new Date().toISOString();

  // Generate insights from success patterns
  for (const pattern of patterns.filter((p) => p.type === "success")) {
    if (pattern.frequency >= 2) {
      insights.push({
        id: generateInsightId(),
        type: "success_factor",
        category: pattern.relatedCategories[0] || "general",
        title: `Success Pattern: ${pattern.description}`,
        description: `Consistently observed across ${pattern.frequency} successful evolutions: ${pattern.description}. Applying this pattern reliably improves outcomes.`,
        evidence: pattern.examples,
        confidence: Math.min(0.5 + pattern.frequency * 0.1, 0.95),
        createdAt: now,
        reinforcementCount: 0,
        actionable: true,
        actionSuggestion: `Continue applying this pattern. Consider documenting it as a best practice.`,
      });
    }
  }

  // Generate insights from failure patterns
  for (const pattern of patterns.filter((p) => p.type === "failure")) {
    if (pattern.frequency >= 2) {
      insights.push({
        id: generateInsightId(),
        type: "failure_cause",
        category: pattern.relatedCategories[0] || "general",
        title: `Failure Pattern: ${pattern.description}`,
        description: `Recurring failure mode seen in ${pattern.frequency} evolutions: ${pattern.description}. Address this root cause to prevent future failures.`,
        evidence: pattern.examples,
        confidence: Math.min(0.5 + pattern.frequency * 0.1, 0.95),
        createdAt: now,
        reinforcementCount: 0,
        actionable: true,
        actionSuggestion: `Investigate root cause and implement preventive measures.`,
      });
    }
  }

  // Generate warning insights from low success rate
  if (stats.successRate < 0.7 && records.length >= 5) {
    insights.push({
      id: generateInsightId(),
      type: "warning",
      category: "process",
      title: `Low Success Rate: ${(stats.successRate * 100).toFixed(1)}%`,
      description: `Recent success rate is below 70%. This may indicate systemic issues that need attention.`,
      evidence: [
        `${records.filter((r) => r.status === "failed").length} failures in last ${records.length} cycles`,
      ],
      confidence: 0.8,
      createdAt: now,
      reinforcementCount: 0,
      actionable: true,
      actionSuggestion: `Review failed evolutions and identify common root causes. Consider slowing down evolution pace.`,
    });
  }

  // Generate performance insights from long durations
  if (stats.avgDurationMs > 300000) { // > 5 minutes
    insights.push({
      id: generateInsightId(),
      type: "pattern",
      category: "performance",
      title: "Long Average Evolution Duration",
      description: `Average evolution takes ${Math.round(stats.avgDurationMs / 60000)} minutes. This may indicate complex tasks or inefficiencies.`,
      evidence: [`Average: ${Math.round(stats.avgDurationMs / 1000)}s`],
      confidence: 0.6,
      createdAt: now,
      reinforcementCount: 0,
      actionable: true,
      actionSuggestion: `Consider breaking large tasks into smaller, focused iterations.`,
    });
  }

  // Generate category-specific insights
  for (const [category, perf] of Object.entries(stats.categoryPerformance)) {
    const total = perf.success + perf.failure;
    const rate = total > 0 ? perf.success / total : 0;

    if (total >= 3 && rate < 0.5) {
      insights.push({
        id: generateInsightId(),
        type: "warning",
        category,
        title: `Struggling in ${category}`,
        description: `Success rate of ${(rate * 100).toFixed(0)}% in ${category} (${perf.success}/${total} successful)`,
        evidence: [`${perf.failure} failures out of ${total} attempts`],
        confidence: 0.7,
        createdAt: now,
        reinforcementCount: 0,
        actionable: true,
        actionSuggestion: `Focus improvement efforts on ${category}. Consider adding specialized tools or knowledge.`,
      });
    }
  }

  return insights.filter((i) => i.confidence >= INSIGHT_CONFIDENCE_THRESHOLD);
}

// ── Suggestion Generation ───────────────────────────────────────────

/**
 * Generate improvement suggestions from insights.
 */
export function generateSuggestions(insights: ReflectionInsight[]): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];
  const now = new Date().toISOString();

  // Group insights by category
  const byCategory = new Map<string, ReflectionInsight[]>();
  for (const insight of insights) {
    const cat = insight.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(insight);
  }

  // Generate suggestions for each category with issues
  for (const [category, categoryInsights] of byCategory) {
    const failures = categoryInsights.filter((i) => i.type === "failure_cause");
    const warnings = categoryInsights.filter((i) => i.type === "warning");

    if (failures.length > 0 || warnings.length > 0) {
      const priority = warnings.length > 0 ? "high" : failures.length > 1 ? "medium" : "low";

      suggestions.push({
        id: generateSuggestionId(),
        priority,
        category,
        title: `Improve ${category} handling`,
        description: `Address ${failures.length} failure patterns and ${warnings.length} warnings in ${category}`,
        rationale: categoryInsights.map((i) => i.title).join("; "),
        relatedInsights: categoryInsights.map((i) => i.id),
        status: "pending",
        createdAt: now,
      });
    }
  }

  // Add suggestions for high-confidence success factors (to reinforce them)
  const successFactors = insights.filter((i) => i.type === "success_factor" && i.confidence >= 0.8);
  for (const factor of successFactors.slice(0, 2)) { // Top 2 only
    suggestions.push({
      id: generateSuggestionId(),
      priority: "low",
      category: factor.category,
      title: `Document success factor: ${factor.title}`,
      description: `This success factor has high confidence (${(factor.confidence * 100).toFixed(0)}%) and should be preserved.`,
      rationale: factor.description,
      relatedInsights: [factor.id],
      status: "pending",
      createdAt: now,
    });
  }

  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

// ── Main Reflection Function ────────────────────────────────────────

/**
 * Run a reflection session.
 * Analyzes recent experiences and generates insights and suggestions.
 */
export function runReflection(triggerReason: string): ReflectionSession {
  const now = new Date().toISOString();
  const reflectionId = generateReflectionId();

  log.info("Starting reflection session", { id: reflectionId, trigger: triggerReason });

  // 1. Review experiences
  const { records } = reviewExperiences({});
  const cyclesAnalyzed = records.length;

  // 2. Query memory for context (reserved for future use)
  // const experienceMemories = queryExperienceMemories();
  // const goalMemories = queryGoalMemories();

  // 3. Extract patterns
  const patterns = extractPatterns(records);

  // 4. Compute stats
  const stats = computeReflectionStats(records);

  // 5. Generate insights
  const insights = generateInsights(patterns, stats, records);

  // 6. Generate suggestions
  const suggestions = generateSuggestions(insights);

  // 7. Create reflection session
  const session: ReflectionSession = {
    id: reflectionId,
    timestamp: now,
    triggerReason,
    cyclesAnalyzed,
    insights,
    patterns,
    suggestions,
    stats,
  };

  // 8. Save reflections
  const reflections = loadReflections();
  reflections.push(session);
  // Keep last 20 reflections
  if (reflections.length > 20) {
    reflections.splice(0, reflections.length - 20);
  }
  saveReflections(reflections);

  // 9. Store key insights to memory graph
  for (const insight of insights.filter((i) => i.confidence >= 0.8 && i.actionable)) {
    try {
      encodeMemory({
        type: "experience",
        content: `[Reflection Insight] ${insight.title}\n\n${insight.description}\n\nAction: ${insight.actionSuggestion || "N/A"}`,
        importance: insight.confidence,
        confidence: insight.confidence,
        tags: ["reflection", insight.type, insight.category],
        metadata: {
          insightId: insight.id,
          reflectionId,
          type: insight.type,
          category: insight.category,
        },
      });
    } catch (e) {
      log.warn("Failed to store insight to memory", { error: (e as Error).message });
    }
  }

  // 10. Store suggestions as goals
  for (const suggestion of suggestions.filter((s) => s.priority === "high")) {
    try {
      encodeMemory({
        type: "goal",
        content: `[Improvement Suggestion] ${suggestion.title}\n\n${suggestion.description}\n\nRationale: ${suggestion.rationale}`,
        importance: suggestion.priority === "high" ? 0.9 : 0.7,
        confidence: 0.8,
        tags: ["improvement", suggestion.category, suggestion.priority],
        metadata: {
          suggestionId: suggestion.id,
          reflectionId,
          status: suggestion.status,
        },
      });
    } catch (e) {
      log.warn("Failed to store suggestion to memory", { error: (e as Error).message });
    }
  }

  log.info("Reflection session completed", {
    id: reflectionId,
    insights: insights.length,
    suggestions: suggestions.length,
    cyclesAnalyzed,
  });

  return session;
}

/**
 * Check if reflection should be triggered based on multiple criteria.
 * 
 * Trigger conditions (any of these):
 * 1. History-based: Enough evolution history (>= MIN_HISTORY_FOR_REFLECTION) and enough cycles since last reflection
 * 2. Time-based fallback: No reflection in FORCED_REFLECTION_INTERVAL_MS (6 hours)
 * 3. Memory-based: Sufficient memory nodes exist (>= MIN_MEMORY_NODES_FOR_TRIGGER)
 * 4. Manual flag: Can be forced via parameter
 */
export function shouldTriggerReflection(force: boolean = false): boolean {
  if (force) {
    return true;
  }

  const history = loadEvolutionHistory();
  const reflections = loadReflections();
  const lastReflection = reflections[reflections.length - 1];
  
  // 1. Time-based fallback: Force reflection if too long since last one
  if (lastReflection) {
    const lastReflectionTime = new Date(lastReflection.timestamp).getTime();
    const timeSinceLastMs = Date.now() - lastReflectionTime;
    if (timeSinceLastMs >= FORCED_REFLECTION_INTERVAL_MS) {
      log.info("Triggering reflection due to time-based fallback", {
        hoursSinceLast: Math.round(timeSinceLastMs / (60 * 60 * 1000))
      });
      return true;
    }
  } else {
    // No previous reflection exists - check time since first evolution
    if (history.length > 0) {
      const firstEvolutionTime = new Date(history[0].timestamp).getTime();
      const timeSinceFirstMs = Date.now() - firstEvolutionTime;
      if (timeSinceFirstMs >= FORCED_REFLECTION_INTERVAL_MS) {
        log.info("Triggering first reflection due to time-based fallback", {
          hoursSinceFirst: Math.round(timeSinceFirstMs / (60 * 60 * 1000))
        });
        return true;
      }
    }
  }

  // 2. Memory-based trigger: Check if we have enough memory nodes
  try {
    const memories = retrieveMemories({ limit: MIN_MEMORY_NODES_FOR_TRIGGER + 1 });
    if (memories.length >= MIN_MEMORY_NODES_FOR_TRIGGER) {
      // Only trigger if we haven't reflected recently (within 1 hour)
      if (lastReflection) {
        const lastTime = new Date(lastReflection.timestamp).getTime();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        if (lastTime < oneHourAgo) {
          log.info("Triggering reflection due to memory-based trigger", {
            memoryNodes: memories.length
          });
          return true;
        }
      } else {
        // No previous reflection, memory nodes are enough
        log.info("Triggering reflection due to memory nodes (no prior reflection)", {
          memoryNodes: memories.length
        });
        return true;
      }
    }
  } catch (e) {
    log.warn("Failed to check memory nodes for reflection trigger", { 
      error: (e as Error).message 
    });
  }

  // 3. History-based trigger: Original logic (requires minimum history)
  if (history.length < MIN_HISTORY_FOR_REFLECTION) {
    return false;
  }

  // Check if we've had enough cycles since last reflection
  if (lastReflection) {
    // Find cycles since last reflection
    const lastReflectionTime = new Date(lastReflection.timestamp).getTime();
    const cyclesSince = history.filter(
      (r) => new Date(r.timestamp).getTime() > lastReflectionTime
    ).length;
    
    return cyclesSince >= REFLECTION_INTERVAL_CYCLES;
  }

  // No previous reflection, trigger if enough history
  return history.length >= REFLECTION_INTERVAL_CYCLES;
}

/**
 * Get recent reflection sessions.
 */
export function getRecentReflections(limit: number = 5): ReflectionSession[] {
  const reflections = loadReflections();
  return reflections.slice(-limit);
}

/**
 * Get pending improvement suggestions.
 */
export function getPendingSuggestions(): ImprovementSuggestion[] {
  const reflections = loadReflections();
  const suggestions: ImprovementSuggestion[] = [];

  for (const session of reflections) {
    for (const suggestion of session.suggestions) {
      if (suggestion.status === "pending") {
        suggestions.push(suggestion);
      }
    }
  }

  // Sort by priority
  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Mark a suggestion as applied.
 */
export function applySuggestion(suggestionId: string, result?: string): boolean {
  const reflections = loadReflections();

  for (const session of reflections) {
    const suggestion = session.suggestions.find((s) => s.id === suggestionId);
    if (suggestion) {
      suggestion.status = "completed";
      suggestion.appliedAt = new Date().toISOString();
      suggestion.result = result;
      saveReflections(reflections);
      log.info("Suggestion applied", { suggestionId });
      return true;
    }
  }

  return false;
}

/**
 * Format reflection session for display.
 */
export function formatReflectionReport(session: ReflectionSession): string {
  const lines: string[] = [
    `🔍 Reflection Session: ${session.id}`,
    `📅 ${new Date(session.timestamp).toLocaleString()}`,
    `📊 Analyzed ${session.cyclesAnalyzed} evolution cycles`,
    "",
  ];

  // Stats
  lines.push("📈 Statistics:");
  lines.push(`  Success Rate: ${(session.stats.successRate * 100).toFixed(1)}%`);
  lines.push(`  Avg Duration: ${Math.round(session.stats.avgDurationMs / 1000)}s`);

  if (session.stats.commonFailureReasons.length > 0) {
    lines.push("  Common Failure Reasons:");
    for (const { reason, count } of session.stats.commonFailureReasons.slice(0, 3)) {
      lines.push(`    - ${reason} (${count})`);
    }
  }

  // Insights
  if (session.insights.length > 0) {
    lines.push("");
    lines.push("💡 Insights:");
    for (const insight of session.insights.slice(0, 5)) {
      const icon = insight.type === "success_factor" ? "✅"
        : insight.type === "failure_cause" ? "❌"
        : insight.type === "warning" ? "⚠️"
        : "📌";
      lines.push(`  ${icon} [${insight.category}] ${insight.title}`);
      if (insight.actionSuggestion) {
        lines.push(`     → ${insight.actionSuggestion}`);
      }
    }
  }

  // Suggestions
  if (session.suggestions.length > 0) {
    lines.push("");
    lines.push("🎯 Top Suggestions:");
    for (const suggestion of session.suggestions.slice(0, 3)) {
      const priorityIcon = suggestion.priority === "high" ? "🔴"
        : suggestion.priority === "medium" ? "🟡"
        : "🟢";
      lines.push(`  ${priorityIcon} [${suggestion.category}] ${suggestion.title}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get reflection summary for context.
 */
export function getReflectionSummary(): string {
  const reflections = loadReflections();
  const pending = getPendingSuggestions();

  if (reflections.length === 0) {
    return "No reflection sessions yet.";
  }

  const lastSession = reflections[reflections.length - 1];
  const insights = reflections.reduce((sum, r) => sum + r.insights.length, 0);
  const suggestions = reflections.reduce((sum, r) => sum + r.suggestions.length, 0);

  const lines: string[] = [
    `🧠 Reflection Summary:`,
    `  Sessions: ${reflections.length}`,
    `  Total Insights: ${insights}`,
    `  Total Suggestions: ${suggestions}`,
    `  Pending Suggestions: ${pending.length}`,
    "",
    `Last Reflection: ${new Date(lastSession.timestamp).toLocaleDateString()}`,
    `  Cycles Analyzed: ${lastSession.cyclesAnalyzed}`,
    `  Success Rate: ${(lastSession.stats.successRate * 100).toFixed(1)}%`,
  ];

  if (pending.length > 0) {
    lines.push("");
    lines.push("Priority Suggestions:");
    for (const s of pending.slice(0, 3)) {
      lines.push(`  - [${s.priority}] ${s.title}`);
    }
  }

  return lines.join("\n");
}

// ── Feedback Loop Integration ──────────────────────────────────────

/**
 * Process high priority suggestions and convert them to backlog tasks.
 * This implements the feedback loop where reflection insights automatically
 * influence the evolution direction.
 * 
 * @returns Number of suggestions processed
 */
export function processHighPrioritySuggestions(): {
  processed: number;
  suggestions: ImprovementSuggestion[];
} {
  const pending = getPendingSuggestions();
  const highPriority = pending.filter(s => s.priority === "high");
  
  if (highPriority.length === 0) {
    return { processed: 0, suggestions: [] };
  }

  // Read current backlog to determine next ID
  const backlogPath = join(process.cwd(), "data", "backlog.md");
  let backlogContent = "";
  try {
    if (existsSync(backlogPath)) {
      backlogContent = readFileSync(backlogPath, "utf-8");
    }
  } catch (e) {
    log.error("Failed to read backlog for suggestion processing", { error: (e as Error).message });
    return { processed: 0, suggestions: [] };
  }

  // Find the highest existing task number
  const lines = backlogContent.split("\n");
  const existingIds = lines
    .filter(l => /^- \[ \] #\d+:/.test(l.trim()) || /^### 挑战 #\d+:/.test(l.trim()))
    .map(l => {
      const match = l.match(/#(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });
  
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 192;
  const updated: string[] = [];
  let inserted = false;
  let inPending = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === "## Pending") {
      inPending = true;
    } else if (trimmed.startsWith("## ")) {
      inPending = false;
    }

    updated.push(line);

    // Insert suggestion tasks after "## Pending" header
    if (inPending && !inserted && !trimmed.startsWith("##")) {
      for (const suggestion of highPriority) {
        const backlogId = `#${nextId.toString().padStart(3, "0")}`;
        
        const challengeLines = [
          "",
          `### 挑战 ${backlogId}: ${suggestion.title} (自动生成)`,
          "",
          `**类别**: reflection-feedback | **优先级**: high | **来源**: Reflection`,
          "",
          `**描述**: ${suggestion.description}`,
          "",
          `**原因**: ${suggestion.rationale}`,
          "",
        ];
        
        updated.push(...challengeLines);
        nextId++;
        
        // Mark suggestion as in_progress
        suggestion.status = "in_progress";
        log.info("High priority suggestion added to backlog", { 
          suggestionId: suggestion.id, 
          backlogId,
          title: suggestion.title 
        });
      }
      inserted = true;
    }
  }

  if (inserted) {
    try {
      writeFileSync(backlogPath, updated.join("\n"));
      
      // Save updated suggestions status
      const reflections = loadReflections();
      saveReflections(reflections);
      
      log.info("Processed high priority suggestions to backlog", { 
        count: highPriority.length 
      });
    } catch (e) {
      log.error("Failed to write backlog with suggestion tasks", { error: (e as Error).message });
      return { processed: 0, suggestions: [] };
    }
  }

  return { processed: highPriority.length, suggestions: highPriority };
}

// ── Insights Context for Evolution ─────────────────────────────────

/**
 * Get recent insights formatted for evolution prompt context.
 * This injects reflection insights into evolution decisions.
 * 
 * @param limit Maximum number of insights to include
 * @returns Formatted insights string for prompt injection
 */
export function getInsightsForPrompt(limit: number = 5): string {
  const reflections = loadReflections();
  
  if (reflections.length === 0) {
    return "";
  }

  // Collect recent insights from last few sessions
  const recentSessions = reflections.slice(-3);
  const allInsights: ReflectionInsight[] = [];
  
  for (const session of recentSessions) {
    allInsights.push(...session.insights);
  }

  // Sort by confidence and recency
  const sortedInsights = allInsights
    .filter(i => i.confidence >= 0.7 && i.actionable)
    .sort((a, b) => {
      // First by confidence, then by reinforcement count (less reinforced = newer)
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.reinforcementCount - b.reinforcementCount;
    })
    .slice(0, limit);

  if (sortedInsights.length === 0) {
    return "";
  }

  const lines: string[] = [
    "",
    "【Reflection Insights - 从历史经验中学习】",
    "",
  ];

  for (const insight of sortedInsights) {
    const icon = insight.type === "success_factor" ? "✅"
      : insight.type === "failure_cause" ? "❌"
      : insight.type === "warning" ? "⚠️"
      : "📌";
    
    lines.push(`${icon} **${insight.category}**: ${insight.title}`);
    if (insight.actionSuggestion) {
      lines.push(`   💡 ${insight.actionSuggestion}`);
    }
    lines.push("");
  }

  // Add pending high priority suggestions
  const pendingHigh = getPendingSuggestions().filter(s => s.priority === "high");
  if (pendingHigh.length > 0) {
    lines.push("【待处理的高优先级建议】");
    for (const s of pendingHigh.slice(0, 3)) {
      lines.push(`🔴 ${s.title}: ${s.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get performance trends from reflection history.
 * Useful for evolution strategy decisions.
 */
export function getPerformanceTrends(): {
  successRateTrend: "improving" | "declining" | "stable";
  avgSuccessRate: number;
  topFailureCategories: string[];
  topSuccessCategories: string[];
  recentWarningCount: number;
} {
  const reflections = loadReflections();
  
  if (reflections.length < 2) {
    return {
      successRateTrend: "stable",
      avgSuccessRate: 0,
      topFailureCategories: [],
      topSuccessCategories: [],
      recentWarningCount: 0,
    };
  }

  // Calculate success rate trend
  const recent = reflections.slice(-5);
  const rates = recent.map(r => r.stats.successRate);
  const avgSuccessRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  
  // Determine trend by comparing first half to second half
  const mid = Math.floor(rates.length / 2);
  const firstHalf = rates.slice(0, mid);
  const secondHalf = rates.slice(mid);
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  
  let successRateTrend: "improving" | "declining" | "stable" = "stable";
  if (secondAvg > firstAvg + 0.1) {
    successRateTrend = "improving";
  } else if (secondAvg < firstAvg - 0.1) {
    successRateTrend = "declining";
  }

  // Aggregate category performance
  const categorySuccess = new Map<string, number>();
  const categoryFailure = new Map<string, number>();
  
  for (const session of recent) {
    for (const [cat, perf] of Object.entries(session.stats.categoryPerformance)) {
      categorySuccess.set(cat, (categorySuccess.get(cat) || 0) + perf.success);
      categoryFailure.set(cat, (categoryFailure.get(cat) || 0) + perf.failure);
    }
  }

  // Top failure categories (most failures)
  const topFailureCategories = Array.from(categoryFailure.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  // Top success categories (most successes)
  const topSuccessCategories = Array.from(categorySuccess.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  // Count recent warnings
  const recentWarningCount = recent.reduce((sum, r) => 
    sum + r.insights.filter(i => i.type === "warning").length, 0
  );

  return {
    successRateTrend,
    avgSuccessRate,
    topFailureCategories,
    topSuccessCategories,
    recentWarningCount,
  };
}