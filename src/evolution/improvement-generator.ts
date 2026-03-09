/**
 * Improvement Task Generator
 * 
 * Generates actionable improvement tasks from evaluation reports.
 * Part of the Evaluation-driven Improvement framework.
 * 
 * Key Features:
 * - Convert opportunities to concrete tasks
 * - Prioritize by severity and score
 * - Avoid duplicate tasks
 * - Track task effectiveness
 */

import { 
  ImprovementOpportunity, 
  ProblemPattern,
  loadLatestEvaluation
} from "./evaluator.js";
import { log } from "../util/log.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../supervisor/paths.js";

// ── Types ──────────────────────────────────────────────────────────

export interface ImprovementTask {
  id: string;
  source: ProblemPattern;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  category: "bugfix" | "stability" | "performance" | "quality" | "capability";
  estimatedEffort: "small" | "medium" | "large";
  generatedAt: string;
  sourceOpportunityId: string;
  evidence: string[];
  status: "pending" | "in_progress" | "completed" | "dismissed";
  completedAt?: string;
  result?: string;
}

export interface GeneratedTasksReport {
  timestamp: string;
  generated: ImprovementTask[];
  skipped: { reason: string; opportunity: string }[];
  totalOpportunities: number;
}

// ── Paths ──────────────────────────────────────────────────────────

const IMPROVEMENT_DIR = join(DATA_DIR, "improvement");
const TASKS_PATH = join(IMPROVEMENT_DIR, "generated-tasks.jsonl");
const BACKLOG_PATH = join(process.cwd(), "data", "backlog.md");

// ── Task Templates ─────────────────────────────────────────────────

const TASK_TEMPLATES: Record<ProblemPattern, {
  titleTemplate: string;
  category: ImprovementTask["category"];
  effortBySeverity: Record<ImprovementOpportunity["severity"], ImprovementTask["estimatedEffort"]>;
}> = {
  repeated_failure: {
    titleTemplate: "Fix repeated evolution failures",
    category: "stability",
    effortBySeverity: {
      critical: "medium",
      high: "medium",
      medium: "small",
      low: "small",
    },
  },
  quality_decline: {
    titleTemplate: "Improve evolution quality scores",
    category: "quality",
    effortBySeverity: {
      critical: "large",
      high: "medium",
      medium: "small",
      low: "small",
    },
  },
  timeout_issues: {
    titleTemplate: "Resolve evolution timeout issues",
    category: "performance",
    effortBySeverity: {
      critical: "medium",
      high: "small",
      medium: "small",
      low: "small",
    },
  },
  low_test_coverage: {
    titleTemplate: "Increase test coverage",
    category: "quality",
    effortBySeverity: {
      critical: "large",
      high: "medium",
      medium: "small",
      low: "small",
    },
  },
  code_bloat: {
    titleTemplate: "Reduce code complexity",
    category: "quality",
    effortBySeverity: {
      critical: "large",
      high: "medium",
      medium: "small",
      low: "small",
    },
  },
  stagnation: {
    titleTemplate: "Break out of stagnation mode",
    category: "capability",
    effortBySeverity: {
      critical: "large",
      high: "medium",
      medium: "small",
      low: "small",
    },
  },
  capability_gap: {
    titleTemplate: "Address capability gaps",
    category: "capability",
    effortBySeverity: {
      critical: "large",
      high: "medium",
      medium: "medium",
      low: "small",
    },
  },
};

// ── Helper Functions ───────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(IMPROVEMENT_DIR)) {
    mkdirSync(IMPROVEMENT_DIR, { recursive: true });
  }
}

/**
 * Generate a unique task ID.
 */
function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `improvement-${timestamp}-${random}`;
}

/**
 * Load existing generated tasks.
 */
export function loadGeneratedTasks(): ImprovementTask[] {
  try {
    if (!existsSync(TASKS_PATH)) return [];
    
    const content = readFileSync(TASKS_PATH, "utf-8").trim();
    if (!content) return [];
    
    const lines = content.split("\n").filter(l => l.trim());
    return lines.map(line => JSON.parse(line) as ImprovementTask);
  } catch (e) {
    log.warn("Failed to load generated tasks", { error: (e as Error).message });
    return [];
  }
}

/**
 * Save a generated task.
 */
function saveTask(task: ImprovementTask): void {
  try {
    ensureDir();
    const line = JSON.stringify(task) + "\n";
    writeFileSync(TASKS_PATH, line, { flag: "a" });
    log.info("Improvement task saved", { taskId: task.id, title: task.title });
  } catch (e) {
    log.error("Failed to save improvement task", { error: (e as Error).message });
  }
}

/**
 * Check if a similar task already exists.
 */
function hasSimilarTask(
  pattern: ProblemPattern,
  existingTasks: ImprovementTask[]
): boolean {
  const recentSimilar = existingTasks.filter(
    t => t.source === pattern && 
    (t.status === "pending" || t.status === "in_progress") &&
    Date.now() - new Date(t.generatedAt).getTime() < 24 * 60 * 60 * 1000 // 24 hours
  );
  
  return recentSimilar.length > 0;
}

/**
 * Generate specific action description based on opportunity.
 */
function generateActionDescription(opp: ImprovementOpportunity): string {
  const actions: Record<ProblemPattern, string> = {
    repeated_failure: `Investigate and fix the root cause of repeated failures. Evidence: ${opp.evidence.slice(0, 2).join("; ")}`,
    quality_decline: `Review recent low-quality evolutions and identify improvement areas. Average quality: ${opp.description}`,
    timeout_issues: `Optimize or decompose tasks that are causing timeouts. ${opp.description}`,
    low_test_coverage: "Add tests for recently changed code to improve coverage.",
    code_bloat: "Refactor or simplify complex code to reduce maintenance burden.",
    stagnation: "Take on more challenging tasks or explore new capabilities to break out of maintenance mode.",
    capability_gap: "Invest in tools, skills, or knowledge to address capability gaps.",
  };
  
  return actions[opp.pattern] || opp.recommendation;
}

// ── Core Functions ─────────────────────────────────────────────────

/**
 * Convert an improvement opportunity into a concrete task.
 */
export function opportunityToTask(opp: ImprovementOpportunity): ImprovementTask {
  const template = TASK_TEMPLATES[opp.pattern];
  
  const task: ImprovementTask = {
    id: generateTaskId(),
    source: opp.pattern,
    title: template.titleTemplate,
    description: generateActionDescription(opp),
    priority: opp.severity,
    category: template.category,
    estimatedEffort: template.effortBySeverity[opp.severity],
    generatedAt: new Date().toISOString(),
    sourceOpportunityId: opp.id,
    evidence: opp.evidence,
    status: "pending",
  };
  
  return task;
}

/**
 * Generate improvement tasks from the latest evaluation.
 */
export function generateImprovementTasks(
  options: {
    maxTasks?: number;
    minSeverity?: ImprovementOpportunity["severity"];
    skipExisting?: boolean;
  } = {}
): GeneratedTasksReport {
  const { maxTasks = 3, minSeverity = "medium", skipExisting = true } = options;
  
  const report = loadLatestEvaluation();
  if (!report) {
    log.warn("No evaluation report available for task generation");
    return {
      timestamp: new Date().toISOString(),
      generated: [],
      skipped: [],
      totalOpportunities: 0,
    };
  }

  const existingTasks = loadGeneratedTasks();
  const severityOrder: ImprovementOpportunity["severity"][] = ["critical", "high", "medium", "low"];
  const minSeverityIndex = severityOrder.indexOf(minSeverity);
  
  const generated: ImprovementTask[] = [];
  const skipped: { reason: string; opportunity: string }[] = [];

  // Sort opportunities by score (highest = most urgent)
  const sortedOpportunities = [...report.opportunities]
    .sort((a, b) => b.score - a.score);

  for (const opp of sortedOpportunities) {
    // Check severity threshold
    if (severityOrder.indexOf(opp.severity) > minSeverityIndex) {
      skipped.push({ reason: "Below severity threshold", opportunity: opp.description });
      continue;
    }

    // Check for similar existing tasks
    if (skipExisting && hasSimilarTask(opp.pattern, existingTasks)) {
      skipped.push({ reason: "Similar task exists", opportunity: opp.description });
      continue;
    }

    // Check max tasks limit
    if (generated.length >= maxTasks) {
      break;
    }

    const task = opportunityToTask(opp);
    generated.push(task);
    saveTask(task);
  }

  log.info("Improvement tasks generated", { 
    generated: generated.length, 
    skipped: skipped.length,
    totalOpportunities: report.opportunities.length 
  });

  return {
    timestamp: new Date().toISOString(),
    generated,
    skipped,
    totalOpportunities: report.opportunities.length,
  };
}

/**
 * Add generated tasks to the backlog.
 */
export function addTasksToBacklog(tasks: ImprovementTask[]): number {
  if (tasks.length === 0) return 0;
  
  try {
    // Read current backlog
    let backlogContent = "";
    if (existsSync(BACKLOG_PATH)) {
      backlogContent = readFileSync(BACKLOG_PATH, "utf-8");
    }

    // Find the Pending section
    const lines = backlogContent.split("\n");
    const updated: string[] = [];
    let addedCount = 0;
    let inPending = false;
    let inserted = false;

    // Generate task ID for backlog (need sequential numbering)
    // Find the highest existing task number
    const existingIds = lines
      .filter(l => /^- \[ \] #\d+:/.test(l.trim()) || /^### 挑战 #\d+:/.test(l.trim()))
      .map(l => {
        const match = l.match(/#(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      });
    
    let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 192;

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === "## Pending") {
        inPending = true;
      } else if (trimmed.startsWith("## ")) {
        inPending = false;
      }

      updated.push(line);

      // Insert tasks after "## Pending" header
      if (inPending && !inserted && !trimmed.startsWith("##")) {
        for (const task of tasks) {
          const backlogId = `#${nextId.toString().padStart(3, "0")}`;

          // Use the challenge format
          const challengeLines = [
            "",
            `### 挑战 ${backlogId}: ${task.title} (自动生成)`,
            "",
            `**类别**: ${task.category} | **优先级**: ${task.priority} | **难度**: ${task.estimatedEffort}`,
            "",
            `**描述**: ${task.description}`,
            "",
            `**来源**: Evaluation-driven Improvement (${task.source})`,
            "",
          ];
          
          updated.push(...challengeLines);
          nextId++;
          addedCount++;
        }
        inserted = true;
      }
    }

    if (addedCount > 0) {
      writeFileSync(BACKLOG_PATH, updated.join("\n"));
      log.info("Tasks added to backlog", { count: addedCount });
    }

    return addedCount;
  } catch (e) {
    log.error("Failed to add tasks to backlog", { error: (e as Error).message });
    return 0;
  }
}

/**
 * Mark a task as completed.
 */
export function completeTask(taskId: string, result: string): void {
  try {
    const tasks = loadGeneratedTasks();
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    
    if (taskIndex === -1) {
      log.warn("Task not found for completion", { taskId });
      return;
    }

    const task = tasks[taskIndex];
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.result = result;

    // Rewrite all tasks
    ensureDir();
    const lines = tasks.map(t => JSON.stringify(t)).join("\n") + "\n";
    writeFileSync(TASKS_PATH, lines);

    log.info("Task marked as completed", { taskId, title: task.title });
  } catch (e) {
    log.error("Failed to complete task", { error: (e as Error).message });
  }
}

/**
 * Get pending improvement tasks.
 */
export function getPendingTasks(): ImprovementTask[] {
  const tasks = loadGeneratedTasks();
  return tasks.filter(t => t.status === "pending");
}

/**
 * Format generated tasks for display.
 */
export function formatGeneratedTasks(tasks: ImprovementTask[]): string {
  if (tasks.length === 0) {
    return "No improvement tasks generated.";
  }

  const lines: string[] = [
    "🔧 Generated Improvement Tasks",
    "",
  ];

  for (const task of tasks) {
    const priorityEmoji = {
      critical: "🔴",
      high: "🟠",
      medium: "🟡",
      low: "🟢",
    }[task.priority];

    lines.push(`${priorityEmoji} **${task.title}**`);
    lines.push(`   ID: ${task.id}`);
    lines.push(`   Category: ${task.category} | Effort: ${task.estimatedEffort}`);
    lines.push(`   ${task.description}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get statistics about generated tasks.
 */
export function getTaskStats(): {
  total: number;
  pending: number;
  completed: number;
  dismissed: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
} {
  const tasks = loadGeneratedTasks();
  
  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === "pending").length,
    completed: tasks.filter(t => t.status === "completed").length,
    dismissed: tasks.filter(t => t.status === "dismissed").length,
    byCategory: tasks.reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byPriority: tasks.reduce((acc, t) => {
      acc[t.priority] = (acc[t.priority] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}