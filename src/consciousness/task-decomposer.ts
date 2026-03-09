/**
 * Task Decomposer - 超时任务分解机制
 * 
 * 解决问题：
 * - 大任务无法在 20 分钟内完成导致超时失败
 * - 超时后无进度保存，下次从头开始
 * 
 * 实现方案：
 * 1. 任务执行前估算复杂度（small/medium/large）
 * 2. 大任务自动分解为多个子任务
 * 3. 支持跨循环的任务进度恢复
 * 4. 进度持久化到 data/task-progress.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

export type TaskComplexity = "small" | "medium" | "large";

export interface Task {
  id: string;
  title: string;
}

export interface SubTask extends Task {
  parentId: string;
  stepIndex: number;
  totalSteps: number;
}

export interface TaskProgress {
  /** Original task ID */
  taskId: string;
  /** Original task title */
  taskTitle: string;
  /** When this task was first started */
  startedAt: string;
  /** Estimated complexity */
  complexity: TaskComplexity;
  /** Steps that have been completed */
  completedSteps: string[];
  /** Steps remaining to be done */
  remainingSteps: string[];
  /** Last update time */
  updatedAt: string;
  /** How many evolution cycles have been spent on this task */
  cyclesSpent: number;
  /** Current status */
  status: "in-progress" | "paused" | "completed";
}

export interface DecompositionResult {
  /** Whether decomposition was performed */
  decomposed: boolean;
  /** Original task (if not decomposed) or first subtask (if decomposed) */
  task: Task;
  /** All subtasks (only if decomposed) */
  subtasks?: SubTask[];
  /** Remaining subtasks to add to backlog (excluding first one) */
  remainingSubtasks?: SubTask[];
}

// ── Complexity Estimation ─────────────────────────────────────────

/**
 * Keywords that indicate task complexity
 */
const COMPLEXITY_KEYWORDS = {
  large: [
    "重构", "refactor",
    "重新设计", "redesign",
    "实现完整", "implement complete",
    "多个文件", "multiple files",
    "系统级", "system-level",
    "架构", "architecture",
    "集成", "integration",
    "全面", "comprehensive",
    "自动化", "automation",
    "完整实现", "full implementation",
    "从零开始", "from scratch",
    "重写", "rewrite",
  ],
  medium: [
    "实现", "implement",
    "添加", "add",
    "创建", "create",
    "更新", "update",
    "修改", "modify",
    "优化", "optimize",
    "扩展", "extend",
    "增强", "enhance",
  ],
  small: [
    "修复", "fix",
    "更新字段", "update field",
    "简单", "simple",
    "快速", "quick",
    "文档", "documentation",
    "配置", "config",
    "清理", "cleanup",
  ],
};

/**
 * Estimate task complexity based on title analysis
 * 
 * @param task - The task to analyze
 * @returns Complexity level: small (< 5 min), medium (5-15 min), large (> 15 min)
 */
export function estimateTaskComplexity(task: Task): TaskComplexity {
  const title = task.title.toLowerCase();
  
  // Count keyword matches for each complexity level
  let largeScore = 0;
  let mediumScore = 0;
  let smallScore = 0;
  
  for (const keyword of COMPLEXITY_KEYWORDS.large) {
    if (title.includes(keyword.toLowerCase())) {
      largeScore += 2; // Large keywords are stronger indicators
    }
  }
  
  for (const keyword of COMPLEXITY_KEYWORDS.medium) {
    if (title.includes(keyword.toLowerCase())) {
      mediumScore += 1;
    }
  }
  
  for (const keyword of COMPLEXITY_KEYWORDS.small) {
    if (title.includes(keyword.toLowerCase())) {
      smallScore += 1;
    }
  }
  
  // Determine complexity based on scores
  if (largeScore > 0) {
    return "large";
  }
  
  if (smallScore > mediumScore) {
    return "small";
  }
  
  if (mediumScore > 0) {
    return "medium";
  }
  
  // Default heuristics based on title length
  if (title.length > 80) {
    return "large";
  }
  
  if (title.length > 40) {
    return "medium";
  }
  
  return "small";
}

/**
 * Get estimated duration in minutes for a complexity level
 */
export function getEstimatedMinutes(complexity: TaskComplexity): number {
  switch (complexity) {
    case "small": return 5;
    case "medium": return 10;
    case "large": return 20;
  }
}

// ── Task Decomposition ─────────────────────────────────────────────

/**
 * Decomposition patterns for different task types
 */
const DECOMPOSITION_PATTERNS: Array<{
  pattern: RegExp;
  steps: (match: RegExpMatchArray) => string[];
}> = [
  {
    // Pattern: "实现 X 功能" -> 分析, 设计, 实现, 测试
    pattern: /实现\s+(.+?)(?:\s*功能)?$/i,
    steps: (match) => [
      `分析需求: ${match[1]}`,
      `设计实现方案: ${match[1]}`,
      `实现核心逻辑: ${match[1]}`,
      `编写测试: ${match[1]}`,
      `验证和提交: ${match[1]}`,
    ],
  },
  {
    // Pattern: "重构 X" -> 分析, 规划, 执行, 验证
    pattern: /重构\s+(.+)$/i,
    steps: (match) => [
      `分析现有代码: ${match[1]}`,
      `制定重构计划: ${match[1]}`,
      `执行重构: ${match[1]}`,
      `验证重构结果: ${match[1]}`,
      `更新文档和提交: ${match[1]}`,
    ],
  },
  {
    // Pattern: "集成 X" -> 研究, 配置, 集成, 测试
    pattern: /集成\s+(.+)$/i,
    steps: (match) => [
      `研究集成方案: ${match[1]}`,
      `配置依赖: ${match[1]}`,
      `实现集成代码: ${match[1]}`,
      `测试集成: ${match[1]}`,
    ],
  },
  {
    // Pattern: "优化 X" -> 分析, 优化, 验证
    pattern: /优化\s+(.+)$/i,
    steps: (match) => [
      `分析优化目标: ${match[1]}`,
      `实施优化: ${match[1]}`,
      `验证优化效果: ${match[1]}`,
    ],
  },
];

/**
 * Decompose a large task into subtasks
 * 
 * @param task - The task to decompose
 * @param complexity - Pre-calculated complexity (optional)
 * @returns Decomposition result with subtasks
 */
export function decomposeTask(task: Task, complexity?: TaskComplexity): DecompositionResult {
  const actualComplexity = complexity ?? estimateTaskComplexity(task);
  
  // Only decompose large tasks
  if (actualComplexity !== "large") {
    return {
      decomposed: false,
      task,
    };
  }
  
  // Try to match decomposition patterns
  for (const { pattern, steps } of DECOMPOSITION_PATTERNS) {
    const match = task.title.match(pattern);
    if (match) {
      const stepDescriptions = steps(match);
      const subtasks: SubTask[] = stepDescriptions.map((step, index) => ({
        id: `${task.id}-step${index + 1}`,
        title: step,
        parentId: task.id,
        stepIndex: index,
        totalSteps: stepDescriptions.length,
      }));
      
      log.info("Task decomposed by pattern", {
        taskId: task.id,
        pattern: pattern.source,
        steps: subtasks.length,
      });
      
      return {
        decomposed: true,
        task: subtasks[0], // Return first subtask
        subtasks,
        remainingSubtasks: subtasks.slice(1),
      };
    }
  }
  
  // Default decomposition: break into phases
  const defaultSteps = [
    `分析任务: ${task.title}`,
    `执行实现: ${task.title}`,
    `验证完成: ${task.title}`,
  ];
  
  const subtasks: SubTask[] = defaultSteps.map((step, index) => ({
    id: `${task.id}-step${index + 1}`,
    title: step,
    parentId: task.id,
    stepIndex: index,
    totalSteps: defaultSteps.length,
  }));
  
  log.info("Task decomposed by default pattern", {
    taskId: task.id,
    steps: subtasks.length,
  });
  
  return {
    decomposed: true,
    task: subtasks[0],
    subtasks,
    remainingSubtasks: subtasks.slice(1),
  };
}

// ── Progress Persistence ───────────────────────────────────────────

const PROGRESS_PATH = join(process.cwd(), "data", "task-progress.json");

/**
 * Load task progress from disk
 */
export function loadTaskProgress(): Map<string, TaskProgress> {
  const progress = new Map<string, TaskProgress>();
  
  try {
    if (existsSync(PROGRESS_PATH)) {
      const content = readFileSync(PROGRESS_PATH, "utf-8");
      const data = JSON.parse(content) as TaskProgress[];
      
      for (const entry of data) {
        progress.set(entry.taskId, entry);
      }
      
      log.info("Loaded task progress", { count: progress.size });
    }
  } catch (e) {
    log.error("Failed to load task progress", { error: (e as Error).message });
  }
  
  return progress;
}

/**
 * Save task progress to disk
 */
export function saveTaskProgress(progress: Map<string, TaskProgress>): void {
  try {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    
    const data = Array.from(progress.values());
    writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2));
    
    log.info("Saved task progress", { count: data.length });
  } catch (e) {
    log.error("Failed to save task progress", { error: (e as Error).message });
  }
}

/**
 * Get progress for a specific task
 */
export function getTaskProgress(taskId: string): TaskProgress | null {
  const progress = loadTaskProgress();
  return progress.get(taskId) ?? null;
}

/**
 * Initialize or update progress for a task
 */
export function initOrUpdateTaskProgress(
  task: Task,
  complexity: TaskComplexity,
  steps: string[],
): TaskProgress {
  const progress = loadTaskProgress();
  const existing = progress.get(task.id);
  
  if (existing) {
    // Update existing progress
    existing.updatedAt = new Date().toISOString();
    existing.cyclesSpent += 1;
    return existing;
  }
  
  // Create new progress entry
  const newProgress: TaskProgress = {
    taskId: task.id,
    taskTitle: task.title,
    startedAt: new Date().toISOString(),
    complexity,
    completedSteps: [],
    remainingSteps: steps,
    updatedAt: new Date().toISOString(),
    cyclesSpent: 1,
    status: "in-progress",
  };
  
  progress.set(task.id, newProgress);
  saveTaskProgress(progress);
  
  return newProgress;
}

/**
 * Mark a step as completed
 */
export function completeStep(taskId: string, stepDescription: string): TaskProgress | null {
  const progress = loadTaskProgress();
  const entry = progress.get(taskId);
  
  if (!entry) {
    log.warn("Cannot complete step: task progress not found", { taskId });
    return null;
  }
  
  // Move step from remaining to completed
  const stepIndex = entry.remainingSteps.indexOf(stepDescription);
  if (stepIndex >= 0) {
    entry.remainingSteps.splice(stepIndex, 1);
    entry.completedSteps.push(stepDescription);
    entry.updatedAt = new Date().toISOString();
    
    // Check if all steps completed
    if (entry.remainingSteps.length === 0) {
      entry.status = "completed";
    }
    
    saveTaskProgress(progress);
    log.info("Step completed", { taskId, step: stepDescription, remaining: entry.remainingSteps.length });
  }
  
  return entry;
}

/**
 * Pause task progress (called on timeout warning)
 */
export function pauseTaskProgress(taskId: string, completedSteps: string[], remainingSteps: string[]): TaskProgress | null {
  const progress = loadTaskProgress();
  const entry = progress.get(taskId);
  
  if (!entry) {
    log.warn("Cannot pause: task progress not found", { taskId });
    return null;
  }
  
  entry.completedSteps = completedSteps;
  entry.remainingSteps = remainingSteps;
  entry.status = "paused";
  entry.updatedAt = new Date().toISOString();
  
  saveTaskProgress(progress);
  log.info("Task progress paused", { taskId, completed: completedSteps.length, remaining: remainingSteps.length });
  
  return entry;
}

/**
 * Resume task progress (returns remaining steps)
 */
export function resumeTaskProgress(taskId: string): { resumed: boolean; remainingSteps: string[] } | null {
  const progress = loadTaskProgress();
  const entry = progress.get(taskId);
  
  if (!entry || entry.status !== "paused") {
    return null;
  }
  
  entry.status = "in-progress";
  entry.updatedAt = new Date().toISOString();
  entry.cyclesSpent += 1;
  
  saveTaskProgress(progress);
  log.info("Task progress resumed", { taskId, remainingSteps: entry.remainingSteps.length });
  
  return {
    resumed: true,
    remainingSteps: entry.remainingSteps,
  };
}

/**
 * Clear completed or old progress entries
 */
export function cleanupProgress(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
  const progress = loadTaskProgress();
  const now = Date.now();
  let cleaned = 0;
  
  for (const [taskId, entry] of progress) {
    const age = now - new Date(entry.updatedAt).getTime();
    
    // Remove completed tasks or tasks older than maxAge
    if (entry.status === "completed" || age > maxAge) {
      progress.delete(taskId);
      cleaned += 1;
    }
  }
  
  if (cleaned > 0) {
    saveTaskProgress(progress);
    log.info("Cleaned up task progress", { removed: cleaned, remaining: progress.size });
  }
}

/**
 * Check if a task has paused progress that can be resumed
 */
export function hasPausedProgress(taskId: string): boolean {
  const progress = loadTaskProgress();
  const entry = progress.get(taskId);
  return entry?.status === "paused" && entry.remainingSteps.length > 0;
}

/**
 * Generate a progress summary for logging/messaging
 */
export function formatProgressSummary(progress: TaskProgress): string {
  const completed = progress.completedSteps.length;
  const remaining = progress.remainingSteps.length;
  const total = completed + remaining;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  return `Task ${progress.taskId}: ${completed}/${total} steps (${percent}%) - ${progress.status}`;
}