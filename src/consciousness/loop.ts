import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { readState } from "../util/state.js";
import { recordEvolutionResult, loadRecentHistory, calculateEvolutionStats } from "./history.js";
import { scoreEvolutionQuality } from "../quality/evolution-scorer.js";
import {
  startEvolutionProgress,
  setEvolutionStage,
  completeEvolutionProgress,
  failEvolutionProgress,
} from "./evolution-progress.js";
import { STATE_PATH } from "../supervisor/paths.js";
import { recordHealthSnapshot } from "../health/history.js";
import { recordEvolutionCycle } from "../observability/metrics.js";
import {
  startTrace,
  endTrace,
  startSpan,
  endSpan,
  addSpanEvent,
} from "../observability/trace.js";
import {
  checkEndureConstraints,
  checkExcelConstraints,
  type EndureResult,
  type ExcelResult,
} from "../evolution/safety-check.js";
import { getEvolutionCyclePrompt, getGoalDiscoveryPrompt } from "../config/evolution-prompt.js";
import { SessionPool, isConversationBusy } from "../agent/session.js";
import {
  shouldTriggerReflection,
  runReflection,
  formatReflectionReport,
  getInsightsForPrompt,
} from "../memory/reflection.js";
import {
  shouldTriggerMetacognitive,
  runMetacognitiveSession,
  formatMetacognitiveReport,
} from "../memory/metacognitive.js";
import {
  runDistillation,
  formatDistillationResult,
  shouldRunDistillation,
} from "../memory/principle-distiller.js";
import {
  retrieveAndRecord,
  recordRetrievalResult,
  formatPrinciplesForPrompt,
} from "../memory/principle-retriever.js";
import {
  getCapabilitySummary,
  initCapabilityTaxonomy,
} from "./capabilities.js";
import {
  initializeArchive,
  prepareArchiveContext,
  recordEvolutionToArchive,
  createExplorationBranch,
  generateArchiveContextForPrompt,
  type AgentArchive,
} from "../evolution/archive-integration.js";
import {
  getCircuitBreakerPauseMs,
  recordCircuitFailure,
  recordCircuitSuccess,
  formatCircuitBreakerAlert,
} from "./circuit-breaker.js";
import {
  recordSuccessfulEvolution,
  getRelevantCapsules,
  formatCapsulesForPrompt,
  checkAndTriggerCapsuleDistillation,
} from "../evolution/capsule-store.js";
import {
  estimateTaskComplexity,
  decomposeTask,
  getEstimatedMinutes,
  initOrUpdateTaskProgress,
  completeStep,
  pauseTaskProgress,
  hasPausedProgress,
  resumeTaskProgress,
  formatProgressSummary,
  type TaskProgress,
  type SubTask,
} from "./task-decomposer.js";
import {
  runEvaluation,
  shouldRunEvaluation,
} from "../evolution/evaluator.js";
import {
  generateImprovementTasks,
  addTasksToBacklog,
} from "../evolution/improvement-generator.js";

// ── Timeout Warning Configuration ───────────────────────────────────

/**
 * Default timeout for worker sessions (matches session.ts DEFAULT_WORKER_TIMEOUT_MS).
 * We set warning threshold slightly below this to allow graceful termination.
 */
const DEFAULT_WORKER_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Time buffer before actual timeout to trigger warning and save progress.
 * If remaining time < this threshold, we should gracefully terminate.
 */
const TIMEOUT_WARNING_BUFFER_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Warning threshold = actual timeout - buffer
 * When elapsed time exceeds this, we trigger the warning.
 */
const TIMEOUT_WARNING_THRESHOLD_MS = DEFAULT_WORKER_TIMEOUT_MS - TIMEOUT_WARNING_BUFFER_MS; // 18 minutes

/**
 * Custom error for timeout warning - allows graceful termination with progress saved.
 */
export class TimeoutWarningError extends Error {
  constructor(
    public readonly elapsedMs: number,
    public readonly remainingMs: number,
    message: string = `Evolution approaching timeout: ${Math.floor(elapsedMs / 60000)}m elapsed, ${Math.floor(remainingMs / 60000)}m remaining`
  ) {
    super(message);
    this.name = "TimeoutWarningError";
  }
}

/**
 * Check if we're approaching timeout and should trigger warning.
 * @param startTimeMs - The start time in milliseconds (from Date.now())
 * @returns Object with elapsed time, remaining time, and whether warning should be triggered
 */
export function checkTimeoutWarning(startTimeMs: number): {
  elapsedMs: number;
  remainingMs: number;
  shouldWarn: boolean;
} {
  const elapsedMs = Date.now() - startTimeMs;
  const remainingMs = Math.max(0, DEFAULT_WORKER_TIMEOUT_MS - elapsedMs);
  const shouldWarn = elapsedMs >= TIMEOUT_WARNING_THRESHOLD_MS;

  return { elapsedMs, remainingMs, shouldWarn };
}

/**
 * Log a timeout warning with stage information.
 */
function logTimeoutWarning(elapsedMs: number, remainingMs: number, stage: string, taskId: string): void {
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const remainingMin = Math.floor(remainingMs / 60000);
  log.warn("Evolution approaching timeout - initiating graceful termination", {
    taskId,
    stage,
    elapsedMin,
    remainingMin,
    elapsedMs,
    remainingMs,
  });
}

const BACKLOG_PATH = join(process.cwd(), "data", "backlog.md");
const GOALS_PATH = join(process.cwd(), "data", "goals.md");
const KNOWLEDGE_PATH = join(process.cwd(), "data", "knowledge");

// ── Backlog ────────────────────────────────────────────────────────

export interface Task {
  id: string;    // e.g. "#001"
  title: string;
}

function safeRead(path: string): string {
  try {
    if (existsSync(path)) return readFileSync(path, "utf-8");
  } catch {
    // Not fatal
  }
  return "";
}

/**
 * Parse the Pending section of backlog.md and return the first task.
 * Supports two formats:
 * - Legacy: `- [ ] #001: Task title`
 * - Self-Challenge: `### 挑战 #184: Task title (33分)`
 */
export function loadNextTask(): Task | null {
  const content = safeRead(BACKLOG_PATH);
  const lines = content.split("\n");
  let inPending = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "## Pending") { inPending = true; continue; }
    if (trimmed.startsWith("## Done")) { inPending = false; continue; }
    if (trimmed.startsWith("## 目标发现历史")) { inPending = false; continue; }

    if (inPending) {
      // Legacy format: `- [ ] #001: Task title`
      const legacyMatch = /^- \[ \] (#\d+): (.+)$/.exec(trimmed);
      if (legacyMatch) return { id: legacyMatch[1], title: legacyMatch[2].trim() };

      // Self-Challenge format: `### 挑战 #184: Task title (33分)`
      const challengeMatch = /^### 挑战 (#\d+): (.+?)(?:\s*\(\d+分\))?$/.exec(trimmed);
      if (challengeMatch) return { id: challengeMatch[1], title: challengeMatch[2].trim() };
    }
  }

  return null;
}

/**
 * Move a task from Pending to Done in backlog.md.
 * Supports two formats:
 * - Legacy: `- [ ] #001: Task title`
 * - Self-Challenge: `### 挑战 #184: Task title (33分)` followed by multi-line block
 */
export function markTaskDone(task: Task): void {
  try {
    const content = readFileSync(BACKLOG_PATH, "utf-8");
    const lines = content.split("\n");
    const updated: string[] = [];
    let insertedDone = false;
    let skipUntilNextSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Handle legacy format: `- [ ] #001: Task title`
      if (trimmed === `- [ ] ${task.id}: ${task.title}`) {
        continue; // Skip this line (remove from pending)
      }

      // Handle Self-Challenge format: `### 挑战 #184: Task title (33分)`
      const challengeMatch = /^### 挑战 (#\d+):/.exec(trimmed);
      if (challengeMatch && challengeMatch[1] === task.id) {
        skipUntilNextSection = true;
        continue; // Start skipping this challenge block
      }

      // Skip lines within a Self-Challenge block until next section
      if (skipUntilNextSection) {
        if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
          skipUntilNextSection = false;
          // Don't continue here - we want to keep this line
        } else {
          continue; // Still skipping
        }
      }

      updated.push(line);

      // Insert done entry
      if (!insertedDone && trimmed === "## Done") {
        const doneLine = `- [x] ${task.id}: ${task.title} — ${new Date().toLocaleDateString("en-CA")}`;
        updated.push(doneLine);
        insertedDone = true;
      }
    }

    writeFileSync(BACKLOG_PATH, updated.join("\n"));
  } catch (e) {
    log.error("Failed to mark task done in backlog", { error: (e as Error).message });
  }
}

/** Load recent Done entries from backlog for context */
function loadRecentDone(limit = 5): string {
  const content = safeRead(BACKLOG_PATH);
  const lines = content.split("\n");
  const done: string[] = [];
  let inDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "## Done") { inDone = true; continue; }
    if (trimmed.startsWith("## ")) { inDone = false; continue; }
    if (inDone && trimmed.startsWith("- [x]")) done.push(trimmed);
  }

  const recent = done.slice(-limit);
  return recent.length > 0 ? recent.join(", ") : "none yet";
}

/**
 * Format a subtask for backlog insertion (self-challenge format)
 */
function formatSubtaskAsChallenge(subtask: SubTask): string[] {
  return [
    "",
    `### 挑战 ${subtask.id}: ${subtask.title} (分解自 ${subtask.parentId})`,
    "",
    "**类别**: 自动分解",
    "**难度**: small",
    "",
    `**步骤**: ${subtask.stepIndex + 1}/${subtask.totalSteps}`,
  ];
}

/**
 * Format a subtask for backlog insertion (legacy format)
 */
function formatSubtaskAsLegacy(subtask: SubTask): string {
  return `- [ ] ${subtask.id}: ${subtask.title} (分解自 ${subtask.parentId})`;
}

/**
 * Check if line is a self-challenge task header
 */
function isChallengeTaskHeader(line: string): boolean {
  return line.trim().startsWith("### 挑战");
}

/**
 * Check if line is a legacy task format
 */
function isLegacyTaskFormat(line: string): boolean {
  return /^- \[ \] #\d+:/.test(line.trim());
}

/**
 * Find the end of a challenge task block
 */
function findChallengeBlockEnd(lines: string[], startIndex: number): number {
  let j = startIndex;
  while (j < lines.length && !isChallengeTaskHeader(lines[j]) && !lines[j].trim().startsWith("## ")) {
    j++;
  }
  return j;
}

/**
 * Add subtasks to the backlog after the current task.
 * This allows decomposed tasks to be processed in sequence.
 */
function addSubtasksToBacklog(subtasks: SubTask[]): void {
  if (subtasks.length === 0) return;
  
  try {
    const content = readFileSync(BACKLOG_PATH, "utf-8");
    const lines = content.split("\n");
    const updated: string[] = [];
    let inserted = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      updated.push(line);

      if (inserted) continue;

      // Insert subtasks after the first pending task
      if (isChallengeTaskHeader(line)) {
        const nextLine = lines[i + 1] || "";
        const isChallengeTask = nextLine.includes("类别") || nextLine.includes("**类别**");
        
        if (isChallengeTask) {
          const blockEnd = findChallengeBlockEnd(lines, i + 1);
          // Copy the rest of this task's block
          for (let k = i + 1; k < blockEnd; k++) {
            updated.push(lines[k]);
          }
          // Insert subtasks
          for (const subtask of subtasks) {
            updated.push(...formatSubtaskAsChallenge(subtask));
          }
          inserted = true;
          i = blockEnd - 1;
        }
      } else if (isLegacyTaskFormat(line)) {
        for (const subtask of subtasks) {
          updated.push(formatSubtaskAsLegacy(subtask));
        }
        inserted = true;
      }
    }

    if (inserted) {
      writeFileSync(BACKLOG_PATH, updated.join("\n"));
      log.info("Subtasks added to backlog", { count: subtasks.length });
    }
  } catch (e) {
    log.error("Failed to add subtasks to backlog", { error: (e as Error).message });
  }
}

// ── Loop interval ──────────────────────────────────────────────────

function getLoopIntervalMs(): number {
  const env = process.env.CONSCIOUSNESS_INTERVAL_SECONDS;
  if (env) {
    const seconds = parseFloat(env);
    if (!isNaN(seconds) && seconds > 0) return Math.round(seconds * 1000);
  }
  return 5 * 1000; // default: 5 seconds
}

// Goal discovery cooldown: at least 30 minutes between discoveries
// This prevents tight loops when discovery finds nothing or fails
const GOAL_DISCOVERY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
let lastGoalDiscoveryAt = 0;

// Track consecutive goal discovery failures (no tasks added)
let consecutiveGoalDiscoveryFailures = 0;
const MAX_GOAL_DISCOVERY_FAILURES = 3; // After this many failures, alert and force a default task

// ── State helpers ──────────────────────────────────────────────────

type PartialState = { cycle?: number; lastEvolution?: string };

function saveState(patch: PartialState): void {
  try {
    const current = JSON.parse(existsSync(STATE_PATH) ? readFileSync(STATE_PATH, "utf-8") : "{}");
    writeFileSync(STATE_PATH, JSON.stringify({ ...current, ...patch }, null, 2));
  } catch (e) {
    log.error("Failed to save state", { error: (e as Error).message });
  }
}

/**
 * Record evolution knowledge to data/knowledge/{taskId}-{cycle}.md
 * This ensures each evolution's experience is preserved for future recall.
 */
function recordEvolutionKnowledge(
  taskId: string,
  cycle: number,
  title: string,
  result: string,
): void {
  try {
    // Ensure knowledge directory exists
    if (!existsSync(KNOWLEDGE_PATH)) {
      mkdirSync(KNOWLEDGE_PATH, { recursive: true });
    }

    // Create a safe filename: remove # from taskId, format as {id}-{cycle}.md
    const safeId = taskId.replace(/[^a-zA-Z0-9]/g, "");
    const filename = `${safeId}-${cycle}.md`;
    const filepath = join(KNOWLEDGE_PATH, filename);

    // Create structured knowledge content
    const timestamp = new Date().toISOString();
    const content = `# Evolution ${taskId} - Cycle #${cycle}

**Title:** ${title}
**Date:** ${timestamp}

---

## Evolution Result

${result}
`;

    writeFileSync(filepath, content);
    log.info(`Evolution knowledge recorded`, { taskId, cycle, file: filename });
  } catch (e) {
    log.error("Failed to record evolution knowledge", { error: (e as Error).message });
  }
}

// ── Types ──────────────────────────────────────────────────────────

type NotifyFn = (message: string) => Promise<void>;


export interface ConsciousnessHandle {
  /** Immediately trigger one cycle if a task is pending, or goal discovery if not. */
  triggerNow: () => void;
  stop: () => void;
}

// ── Agent Archive ──────────────────────────────────────────────────

let agentArchive: AgentArchive | null = null;

function getArchive(): AgentArchive {
  if (!agentArchive) {
    agentArchive = initializeArchive();
  }
  return agentArchive;
}

// ── Main loop ──────────────────────────────────────────────────────

export function startConsciousness(
  notifyFn: NotifyFn,
): ConsciousnessHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running || isConversationBusy()) {
      scheduleNext();
      return;
    }

    running = true;
    try {
      const task = loadNextTask();

      if (task) {
        // ── Circuit Breaker check ──────────────────────────────────
        const pauseMs = getCircuitBreakerPauseMs();
        if (pauseMs > 0) {
          const resumeInMinutes = Math.ceil(pauseMs / 1000 / 60);
          log.warn("Circuit breaker is OPEN — skipping evolution cycle", {
            resumeInMinutes,
            taskId: task.id,
          });
          return;
        }

        await runEvolutionCycle(task, notifyFn);
      } else {
        // Backlog empty: run goal discovery if cooldown has elapsed
        const now = Date.now();
        if (now - lastGoalDiscoveryAt >= GOAL_DISCOVERY_COOLDOWN_MS) {
          lastGoalDiscoveryAt = now;
          await runGoalDiscovery(notifyFn);
        }
        // else: nothing to do this tick
      }
    } catch (e) {
      log.error("Consciousness tick failed", { error: (e as Error).message });
    } finally {
      running = false;
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, getLoopIntervalMs());
  }

  scheduleNext();
  log.info("Consciousness loop started", { intervalSeconds: getLoopIntervalMs() / 1000 });

  return {
    triggerNow: () => {
        if (!running && !isConversationBusy()) {
        // Force goal discovery on next trigger even if within cooldown
        lastGoalDiscoveryAt = 0;
        if (timer) clearTimeout(timer);
        tick();
      }
    },
    stop: () => {
      if (timer) { clearTimeout(timer); timer = null; }
      log.info("Consciousness loop stopped");
    },
  };
}

// ── Circuit Breaker helpers ────────────────────────────────────────

/** Send Telegram alert when circuit breaker is tripped (extracted to keep runEvolutionCycle complexity in check). */
async function notifyCircuitTripIfNeeded(
  circuitResult: { tripped: boolean; consecutiveFailures: number; pausedUntil: string | null },
  notifyFn: NotifyFn,
): Promise<void> {
  if (circuitResult.tripped && circuitResult.pausedUntil) {
    const alert = formatCircuitBreakerAlert(
      circuitResult.pausedUntil,
      circuitResult.consecutiveFailures,
    );
    await notifyFn(alert).catch(() => {});
  }
}

// ── Evolution cycle ────────────────────────────────────────────────

// eslint-disable-next-line complexity
async function runEvolutionCycle(task: Task, notifyFn: NotifyFn): Promise<void> {
  const state = readState();
  const cycle = state.cycle + 1;
  const startTime = Date.now();

  // ── Start Trace ──────────────────────────────────────────────────
  const trace = startTrace({
    evolutionCycle: cycle,
    taskId: task.id,
    taskTitle: task.title,
    triggerSource: "consciousness",
    version: state.version,
  });

  log.info(`Evolution cycle #${cycle} starting`, { task: task.id, title: task.title, traceId: trace.id });
  startEvolutionProgress(cycle);
  setEvolutionStage("implementing", `Executing: ${task.title}`);

  // ── Task Decomposition Check ─────────────────────────────────────
  // Estimate task complexity and decompose large tasks
  const complexitySpan = startSpan("complexity-check", { traceId: trace.id });
  const taskComplexity = estimateTaskComplexity(task);
  const estimatedMinutes = getEstimatedMinutes(taskComplexity);
  addSpanEvent(complexitySpan.id, "complexity_result", {
    complexity: taskComplexity,
    estimatedMinutes,
  });
  log.info(`Task complexity estimated`, {
    taskId: task.id,
    complexity: taskComplexity,
    estimatedMinutes,
  });

  // Check if this task has paused progress to resume
  if (hasPausedProgress(task.id)) {
    const resumeResult = resumeTaskProgress(task.id);
    if (resumeResult && resumeResult.remainingSteps.length > 0) {
      log.info(`Resuming paused task`, {
        taskId: task.id,
        remainingSteps: resumeResult.remainingSteps.length,
      });
      await notifyFn(`🔄 Evolution #${cycle} resuming paused task ${task.id}\nRemaining steps: ${resumeResult.remainingSteps.length}`);
    }
  }

  // Decompose large tasks into subtasks
  let taskProgress: TaskProgress | null = null;
  
  if (taskComplexity === "large") {
    const decomposition = decomposeTask(task, taskComplexity);
    
    if (decomposition.decomposed && decomposition.subtasks) {
      log.info(`Large task decomposed into subtasks`, {
        originalTask: task.id,
        subtaskCount: decomposition.subtasks.length,
      });
      
      // Add remaining subtasks to backlog
      if (decomposition.remainingSubtasks && decomposition.remainingSubtasks.length > 0) {
        addSubtasksToBacklog(decomposition.remainingSubtasks);
        await notifyFn(`📋 Large task ${task.id} decomposed into ${decomposition.subtasks.length} subtasks\nFirst subtask: ${decomposition.task.title}`);
      }
      
      // Initialize progress tracking
      taskProgress = initOrUpdateTaskProgress(
        task,
        taskComplexity,
        decomposition.subtasks.map(s => s.title),
      );
    }
  } else {
    // Initialize progress for non-decomposed tasks
    taskProgress = initOrUpdateTaskProgress(task, taskComplexity, [task.title]);
  }
  endSpan(complexitySpan.id, "success");

  // ── Agent Archive Integration ────────────────────────────────────
  const archiveSpan = startSpan("archive-prepare", { traceId: trace.id });
  const archive = getArchive();
  const archiveContext = prepareArchiveContext(archive, task.title);
  
  // Check if we should create a new exploration branch
  if (archiveContext.shouldSpawnBranch && archiveContext.selectedBranch) {
    log.info("Spawning new exploration branch for diversity", {
      currentBranch: archiveContext.selectedBranch.name,
      taskTitle: task.title,
    });
    createExplorationBranch(archive, task.title);
    addSpanEvent(archiveSpan.id, "branch_spawned", { branch: archiveContext.selectedBranch.name });
  }
  const archivePromptContext = generateArchiveContextForPrompt(archive);
  endSpan(archiveSpan.id, "success");

  // Notify owner that evolution has started (system-level, not LLM-dependent)
  await notifyFn(`🧬 Evolution #${cycle} starting\n📋 Task: ${task.id}: ${task.title}`).catch(() => {});

  // Generate evolution ID for principle tracking (needed in both try and catch)
  const evolutionId = `evolution-${cycle}-${task.id.replace(/[^a-zA-Z0-9]/g, "")}`;

  // ── SEA Law #1: Endure Check ────────────────────────────────────────
  // Perform system health check before allowing evolution to proceed
  const endureSpan = startSpan("endure-check", { traceId: trace.id });
  let endureResult: EndureResult;
  try {
    endureResult = await checkEndureConstraints();
    addSpanEvent(endureSpan.id, "endure_result", {
      passed: endureResult.passed,
      disk: endureResult.checks.disk.value,
      memory: endureResult.checks.memory.value,
      cpu: endureResult.checks.cpu.value,
    });
  } catch (e) {
    const err = e as Error;
    log.error("Endure check threw exception", { error: err.message });
    endureResult = {
      passed: false,
      timestamp: new Date().toISOString(),
      checks: {
        disk: { passed: false, value: 0, threshold: 1, message: `Exception: ${err.message}` },
        memory: { passed: false, value: 0, threshold: 100, message: `Exception: ${err.message}` },
        cpu: { passed: false, value: 100, threshold: 90, message: `Exception: ${err.message}` },
        circuitBreaker: { passed: true, value: 0, threshold: 0, message: "Not checked" },
      },
      reason: `Endure check failed with exception: ${err.message}`,
    };
    addSpanEvent(endureSpan.id, "endure_exception", { error: err.message });
  }

  if (!endureResult.passed) {
    endSpan(endureSpan.id, "error", { type: "EndureCheckFailed", message: endureResult.reason || "Endure check failed" });
    setEvolutionStage("failed", "Endure check failed - system not healthy");
    recordEvolutionResult(cycle, state.version, "skipped", endureResult.reason || "Endure check failed", 0);
    failEvolutionProgress(`Endure check failed: ${endureResult.reason}`);
    endTrace(trace.id, "error");
    log.warn(`Evolution cycle #${cycle} BLOCKED by Endure check`, {
      reason: endureResult.reason,
      checks: endureResult.checks,
    });
    await notifyFn(`🚫 Evolution #${cycle} BLOCKED by Endure check\n${endureResult.reason}\n\nSEA Law #1 (Endure) requires system health before evolution.`);
    return; // Exit early - cannot proceed with evolution
  }
  endSpan(endureSpan.id, "success");
  log.info(`Evolution cycle #${cycle} passed Endure check`, {
    disk: `${endureResult.checks.disk.value}GB free`,
    memory: `${endureResult.checks.memory.value}MB free`,
    cpu: `${endureResult.checks.cpu.value}%`,
  });

  try {
    const recentHistory = loadRecentHistory(3);
    const stats = calculateEvolutionStats();

    // Build prompt with archive context
    const promptSpan = startSpan("prompt-build", { traceId: trace.id });
    
    // Retrieve relevant principles for this evolution task (EvolveR closed loop)
    const principleSpan = startSpan("principle-retrieval", { traceId: trace.id });
    const retrievalResult = retrieveAndRecord({
      taskId: task.id,
      taskTitle: task.title,
      maxPrinciples: 5,
    }, evolutionId);
    const principlesContext = formatPrinciplesForPrompt(retrievalResult.principles);
    endSpan(principleSpan.id, "success");

    // Retrieve relevant GEP capsules (past successful approaches) — closes the GEP feedback loop
    const capsuleSpan = startSpan("capsule-context", { traceId: trace.id });
    const relevantCapsules = getRelevantCapsules(task.title, 3);
    const capsulesContext = formatCapsulesForPrompt(relevantCapsules);
    addSpanEvent(capsuleSpan.id, "capsules_retrieved", {
      count: relevantCapsules.length,
      taskTitle: task.title,
    });
    endSpan(capsuleSpan.id, "success");

    const prompt = getEvolutionCyclePrompt(cycle, task.id, task.title, {
      recentHistory: recentHistory.map(h => `#${h.cycle} ${h.status}`).join(", ") || "none",
      totalCycles: stats.totalCycles,
      currentStreak: stats.currentStreak,
    }) + "\n\n" + archivePromptContext + principlesContext + capsulesContext + getInsightsForPrompt(5);
    endSpan(promptSpan.id, "success");

    // ── Timeout Warning Check: Before prompt execution ──────────────
    const beforePromptCheck = checkTimeoutWarning(startTime);
    if (beforePromptCheck.shouldWarn) {
      logTimeoutWarning(beforePromptCheck.elapsedMs, beforePromptCheck.remainingMs, "pre-prompt", task.id);
      // We're already at 18+ minutes, don't even start the prompt
      // Save progress and notify about the timeout warning
      
      // Save task progress for resumption
      if (taskProgress) {
        pauseTaskProgress(task.id, taskProgress.completedSteps, taskProgress.remainingSteps);
      }
      
      setEvolutionStage("failed", `Timeout warning: ${Math.floor(beforePromptCheck.elapsedMs / 60000)}m elapsed`);
      recordEvolutionResult(cycle, state.version, "timeout-warning", 
        `Evolution aborted due to timeout warning: ${Math.floor(beforePromptCheck.elapsedMs / 60000)}m elapsed, ${Math.floor(beforePromptCheck.remainingMs / 60000)}m remaining`,
        beforePromptCheck.elapsedMs);
      failEvolutionProgress(`Timeout warning before prompt execution`);
      await notifyFn(`⏰ Evolution #${cycle} timeout warning\nTask ${task.id} aborted: ${Math.floor(beforePromptCheck.elapsedMs / 60000)}m elapsed, approaching 20m limit.\nProgress saved - task can be resumed.`);
      endTrace(trace.id, "timeout-warning");
      return; // Exit early, don't throw - we've handled it gracefully
    }

    // Spawn worker and execute
    const sessionSpan = startSpan("session-spawn", { traceId: trace.id });
    const worker = await SessionPool.spawn({ label: `evolution-${cycle}`, thinkingLevel: "high" });
    endSpan(sessionSpan.id, "success");
    
    let result: string;
    const execSpan = startSpan("prompt-execution", { traceId: trace.id, attributes: { task: task.id } });
    try {
      result = await worker.prompt(prompt);
    } finally {
      worker.dispose();
    }
    endSpan(execSpan.id, "success");

    // ── Timeout Warning Check: After prompt execution ───────────────
    const afterPromptCheck = checkTimeoutWarning(startTime);
    if (afterPromptCheck.shouldWarn) {
      logTimeoutWarning(afterPromptCheck.elapsedMs, afterPromptCheck.remainingMs, "post-prompt", task.id);
      // We got a result but we're out of time - save what we have
      setEvolutionStage("committing", "Saving partial results due to timeout warning");
      
      // Mark current step as completed in progress tracking
      if (taskProgress && taskProgress.remainingSteps.length > 0) {
        const currentStep = taskProgress.remainingSteps[0];
        completeStep(task.id, currentStep);
      }
      
      // Record partial result if we have something meaningful
      if (result && result.trim().length >= 20) {
        recordEvolutionKnowledge(task.id, cycle, task.title, result + "\n\n⚠️ **Partial result saved due to timeout warning**");
        await notifyFn(`⏰ Evolution #${cycle} timeout warning (post-prompt)\nTask ${task.id} got a result but ran out of time.\nPartial result saved to knowledge base.\nProgress saved - remaining steps can be resumed.`);
      }
      
      recordEvolutionResult(cycle, state.version, "timeout-warning",
        `Evolution completed prompt but hit timeout warning: ${Math.floor(afterPromptCheck.elapsedMs / 60000)}m elapsed`,
        afterPromptCheck.elapsedMs);
      failEvolutionProgress(`Timeout warning after prompt execution - partial result saved`);
      endTrace(trace.id, "timeout-warning");
      return;
    }

    // Defensive: treat empty or trivially short results as failures to prevent
    // silent pass-throughs from infrastructure errors (e.g. auth/permission issues).
    if (!result || result.trim().length < 20) {
      endSpan(execSpan.id, "error", { type: "InvalidResult", message: `Suspiciously short result: "${result}"` });
      throw new Error(`Evolution worker returned suspiciously short result: "${result}"`);
    }

    // ── SEA Law #2: Excel Check ────────────────────────────────────────
    // Verify build and tests pass before committing evolution results
    const excelSpan = startSpan("excel-check", { traceId: trace.id });
    let excelResult: ExcelResult;
    try {
      excelResult = await checkExcelConstraints({ testTimeout: 120000 });
      addSpanEvent(excelSpan.id, "excel_result", {
        passed: excelResult.passed,
        build: excelResult.checks.build.passed,
        tests: excelResult.checks.tests.passed,
      });
    } catch (e) {
      const err = e as Error;
      log.error("Excel check threw exception", { error: err.message });
      excelResult = {
        passed: false,
        timestamp: new Date().toISOString(),
        checks: {
          build: { passed: false, value: 1, threshold: 0, message: `Exception: ${err.message}` },
          tests: { passed: false, value: 1, threshold: 0, message: `Exception: ${err.message}` },
        },
        reason: `Excel check failed with exception: ${err.message}`,
      };
      addSpanEvent(excelSpan.id, "excel_exception", { error: err.message });
    }

    if (!excelResult.passed) {
      endSpan(excelSpan.id, "error", { type: "ExcelCheckFailed", message: excelResult.reason || "Excel check failed" });
      setEvolutionStage("failed", "Excel check failed - tests or build failed");
      const durationMs = Date.now() - startTime;
      recordEvolutionResult(cycle, state.version, "failed", excelResult.reason || "Excel check failed", durationMs);
      failEvolutionProgress(`Excel check failed: ${excelResult.reason}`);
      endTrace(trace.id, "error");
      log.error(`Evolution cycle #${cycle} BLOCKED by Excel check`, {
        reason: excelResult.reason,
        checks: excelResult.checks,
      });
      // Don't mark task as done - it should be retried after fixing the issue
      await notifyFn(`🚫 Evolution #${cycle} BLOCKED by Excel check\n${excelResult.reason}\n\nSEA Law #2 (Excel) requires tests to pass before commit.\nTask ${task.id} not marked as done - fix issues and retry.`);
      return; // Exit early - cannot proceed with commit
    }
    endSpan(excelSpan.id, "success");
    log.info(`Evolution cycle #${cycle} passed Excel check`);

    const durationMs = Date.now() - startTime;
    setEvolutionStage("committing", "Saving results");

    // Record results
    const recordSpan = startSpan("result-recording", { traceId: trace.id });
    markTaskDone(task);
    
    // Complete task progress tracking
    if (taskProgress && taskProgress.remainingSteps.length > 0) {
      const currentStep = taskProgress.remainingSteps[0];
      const updatedProgress = completeStep(task.id, currentStep);
      if (updatedProgress) {
        log.info("Task step completed", { taskId: task.id, progress: formatProgressSummary(updatedProgress) });
      }
    }
    
    saveState({ cycle, lastEvolution: new Date().toISOString() });
    const qualityBreakdown = scoreEvolutionQuality(result, durationMs);
    recordEvolutionResult(cycle, state.version, "success", result.slice(0, 200), durationMs, qualityBreakdown.total);
    completeEvolutionProgress(durationMs);

    // Record successful evolution as a GEP capsule
    recordSuccessfulEvolution({
      cycle,
      taskId: task.id,
      taskTitle: task.title,
      result,
      durationMs,
      qualityScore: qualityBreakdown.total,
    });

    // AgentC2 Flywheel Step 3: asynchronously check if capsule threshold triggers distillation
    checkAndTriggerCapsuleDistillation(notifyFn).catch(e => {
      log.error("Async capsule distillation check failed", { error: (e as Error).message });
    });

    // Reset circuit breaker on success
    recordCircuitSuccess();

    // Record performance metrics for successful evolution
    recordEvolutionCycle({
      cycle,
      taskId: task.id,
      durationMs,
      status: "success",
    });
    endSpan(recordSpan.id, "success");
    
    // Record to Agent Archive
    const archiveRecordSpan = startSpan("archive-record", { traceId: trace.id });
    recordEvolutionToArchive(
      archive,
      cycle,
      task.id,
      "success",
      [`Completed: ${task.title}`],
      0.1 // Positive fitness delta for success
    );
    endSpan(archiveRecordSpan.id, "success");

    log.info(`Evolution cycle #${cycle} completed`, { durationMs, task: task.id });

    const notifySummary = result.length > 500 ? result.slice(0, 500) + "..." : result;
    await notifyFn(`🧬 Evolution #${cycle} complete [${task.id}]:\n${notifySummary}`);

    // Record evolution knowledge for future recall
    const knowledgeSpan = startSpan("knowledge-recording", { traceId: trace.id });
    recordEvolutionKnowledge(task.id, cycle, task.title, result);
    endSpan(knowledgeSpan.id, "success");

    // Record principle retrieval result for Experience Distillation feedback loop
    recordRetrievalResult(evolutionId, "success");

    // Check if we should run a reflection session (MARS-inspired reflective self-improvement)
    if (shouldTriggerReflection()) {
      const reflectSpan = startSpan("reflection", { traceId: trace.id });
      try {
        log.info("Triggering reflection session after evolution", { cycle });
        const reflectionSession = runReflection(`After evolution #${cycle}`);
        const report = formatReflectionReport(reflectionSession);
        await notifyFn(report);
        endSpan(reflectSpan.id, "success");
      } catch (e) {
        endSpan(reflectSpan.id, "error", { type: "ReflectionError", message: (e as Error).message });
        log.error("Reflection session failed", { error: (e as Error).message });
      }
    }

    // Check if we should run a metacognitive session (real-time self-assessment)
    if (shouldTriggerMetacognitive()) {
      const metaSpan = startSpan("metacognitive", { traceId: trace.id });
      try {
        log.info("Triggering metacognitive session after evolution", { cycle });
        const metaSession = runMetacognitiveSession({
          activity: `Evolution #${cycle}: ${task.title}`,
          outputToEvaluate: result,
          outputType: "output",
          statedConfidence: 0.8,
        });
        const report = formatMetacognitiveReport(metaSession);
        await notifyFn(report);
        endSpan(metaSpan.id, "success");
      } catch (e) {
        endSpan(metaSpan.id, "error", { type: "MetacognitiveError", message: (e as Error).message });
        log.error("Metacognitive session failed", { error: (e as Error).message });
      }
    }

    // Check if we should run principle distillation (EvolveR Experience Distillation)
    if (shouldRunDistillation()) {
      const distillSpan = startSpan("distillation", { traceId: trace.id });
      try {
        log.info("Triggering principle distillation after evolution", { cycle });
        const distillationResult = await runDistillation();
        const report = formatDistillationResult(distillationResult);
        await notifyFn(report);
        endSpan(distillSpan.id, "success");
      } catch (e) {
        endSpan(distillSpan.id, "error", { type: "DistillationError", message: (e as Error).message });
        log.error("Principle distillation failed", { error: (e as Error).message });
      }
    }

    // ── Evaluation-driven Improvement ─────────────────────────────────────
    // Check if we should run evaluation (every 5 successful cycles)
    const evalCheck = shouldRunEvaluation(5);
    if (evalCheck.shouldRun) {
      const evalSpan = startSpan("evaluation", { traceId: trace.id });
      try {
        log.info("Running evaluation-driven improvement check", { cycle, reason: evalCheck.reason });
        
        // Run evaluation
        const evaluationReport = runEvaluation();
        addSpanEvent(evalSpan.id, "evaluation_complete", {
          healthScore: evaluationReport.healthScore,
          trend: evaluationReport.qualityTrend,
          opportunities: evaluationReport.opportunities.length,
        });
        
        // Generate improvement tasks if there are opportunities
        if (evaluationReport.opportunities.length > 0) {
          const taskReport = generateImprovementTasks({ maxTasks: 2, minSeverity: "medium" });
          
          if (taskReport.generated.length > 0) {
            // Add tasks to backlog
            const addedCount = addTasksToBacklog(taskReport.generated);
            
            if (addedCount > 0) {
              const taskSummary = taskReport.generated.map(t => t.title).join(", ");
              await notifyFn(`📊 Evaluation generated ${addedCount} improvement tasks:\n${taskSummary}`);
            }
          }
        }
        
        // Log evaluation summary
        log.info("Evaluation complete", {
          healthScore: evaluationReport.healthScore,
          trend: evaluationReport.qualityTrend,
          opportunities: evaluationReport.opportunities.length,
        });
        
        endSpan(evalSpan.id, "success");
      } catch (e) {
        endSpan(evalSpan.id, "error", { type: "EvaluationError", message: (e as Error).message });
        log.error("Evaluation-driven improvement check failed", { error: (e as Error).message });
      }
    }

    // ── End Trace (Success) ─────────────────────────────────────────
    endTrace(trace.id, "success");
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - startTime;

    const errorSpan = startSpan("error-handler", { traceId: trace.id });
    
    // ── Detect timeout from session.ts ──────────────────────────────
    const isTimeout = err.message.includes("timed out after") || err.name === "TimeoutWarningError";
    const status = isTimeout ? "timeout" : "failed";
    const friendlyMessage = isTimeout 
      ? `Evolution timed out after ${Math.floor(durationMs / 60000)} minutes`
      : err.message;

    // Save task progress on timeout for resumption
    if (isTimeout && taskProgress) {
      pauseTaskProgress(task.id, taskProgress.completedSteps, taskProgress.remainingSteps);
      log.info("Task progress saved due to timeout", { taskId: task.id });
    }

    recordEvolutionResult(cycle, state.version, status, friendlyMessage, durationMs);
    failEvolutionProgress(friendlyMessage);

    // Track consecutive failures in circuit breaker (but not for timeouts - they're different)
    if (!isTimeout) {
      const circuitResult = recordCircuitFailure();
      await notifyCircuitTripIfNeeded(circuitResult, notifyFn);
    } else {
      // For timeouts, just log a warning and continue - don't trip circuit breaker
      log.warn("Evolution timed out - not incrementing circuit breaker counter", {
        taskId: task.id,
        cycle,
        durationMin: Math.floor(durationMs / 60000),
      });
    }

    // Record performance metrics for failed evolution
    recordEvolutionCycle({
      cycle,
      taskId: task.id,
      durationMs,
      status: "failed",
    });
    
    // Record failure to Agent Archive
    recordEvolutionToArchive(
      archive,
      cycle,
      task.id,
      "failed",
      [`Failed: ${friendlyMessage}`],
      -0.1 // Negative fitness delta for failure
    );
    endSpan(errorSpan.id, "error", { type: err.constructor.name, message: friendlyMessage });

    log.error(`Evolution cycle #${cycle} ${status}`, { error: friendlyMessage, durationMs });
    
    // Send more informative timeout message
    if (isTimeout) {
      await notifyFn(`⏰ Evolution #${cycle} timed out [${task.id}]\nDuration: ${Math.floor(durationMs / 60000)}m / 20m limit\nTask was: ${task.title}\n\nProgress saved - task can be resumed.\nTo prevent this, consider:\n- Breaking down complex tasks\n- Adding timeout warning checkpoints`);
    } else {
      await notifyFn(`❌ Evolution #${cycle} failed [${task.id}]: ${friendlyMessage}`);
    }

    // Record principle retrieval result as failure for Experience Distillation feedback
    recordRetrievalResult(evolutionId, "failure");

    // ── End Trace (Error) ───────────────────────────────────────────
    endTrace(trace.id, status === "timeout" ? "timeout" : "error");
  }
}

// ── Goal discovery ─────────────────────────────────────────────────

async function runGoalDiscovery(notifyFn: NotifyFn): Promise<void> {
  // ── Start Trace ──────────────────────────────────────────────────
  const state = readState();
  const trace = startTrace({
    triggerSource: "consciousness-goal-discovery",
    version: state.version,
  });

  log.info("Goal discovery starting", { traceId: trace.id });

  try {
    await recordHealthSnapshot();
    const healthSpan = startSpan("health-snapshot", { traceId: trace.id });
    endSpan(healthSpan.id, "success");

    // Initialize capability taxonomy if needed (Alita-G Phase 2)
    const taxonomySpan = startSpan("capability-init", { traceId: trace.id });
    initCapabilityTaxonomy();
    endSpan(taxonomySpan.id, "success");

    const stats = calculateEvolutionStats();
    const goals = safeRead(GOALS_PATH) || "No direction set yet. Explore freely.";
    const recentDone = loadRecentDone(5);
    
    // Get capability summary for systematic goal discovery (Alita-G)
    const capSpan = startSpan("capability-summary", { traceId: trace.id });
    const capabilitySummary = getCapabilitySummary();
    endSpan(capSpan.id, "success");

    const promptSpan = startSpan("prompt-build", { traceId: trace.id });
    const prompt = getGoalDiscoveryPrompt({
      goals,
      recentDone,
      totalCycles: stats.totalCycles,
      capabilitySummary,
    });
    endSpan(promptSpan.id, "success");

    const sessionSpan = startSpan("session-spawn", { traceId: trace.id });
    const worker = await SessionPool.spawn({ label: "goal-discovery", thinkingLevel: "medium" });
    endSpan(sessionSpan.id, "success");

    let result: string;
    const execSpan = startSpan("prompt-execution", { traceId: trace.id });
    try {
      result = await worker.prompt(prompt);
    } finally {
      worker.dispose();
    }
    endSpan(execSpan.id, "success");

    // Check if new tasks were added
    const taskAfter = loadNextTask();
    if (taskAfter) {
      consecutiveGoalDiscoveryFailures = 0; // Reset on success
      addSpanEvent(trace.rootSpanId, "task_added", { taskId: taskAfter.id, title: taskAfter.title });
      log.info("Goal discovery added tasks to backlog");
      await notifyFn(`🔍 Goal discovery complete. New task queued: ${taskAfter.id}: ${taskAfter.title}`);
    } else {
      consecutiveGoalDiscoveryFailures++;
      log.warn("Goal discovery found nothing to add", {
        consecutiveFailures: consecutiveGoalDiscoveryFailures,
        resultPreview: result.slice(0, 200),
      });

      // If too many consecutive failures, force a default recovery task
      if (consecutiveGoalDiscoveryFailures >= MAX_GOAL_DISCOVERY_FAILURES) {
        log.error("Goal discovery has failed to add tasks too many times", {
          consecutiveFailures: consecutiveGoalDiscoveryFailures,
        });
        await notifyFn(
          `⚠️ Goal discovery has failed to add tasks ${consecutiveGoalDiscoveryFailures} times in a row.\n` +
          `The system may be stuck in a research loop.\n\n` +
          `Suggested actions:\n` +
          `1. Check if the AI is spending too much time researching\n` +
          `2. Manually add tasks via Telegram\n` +
          `3. Review the goal discovery prompt`
        );
        // Reset counter to avoid spamming alerts
        consecutiveGoalDiscoveryFailures = 0;
      } else {
        await notifyFn(
          `🔍 Goal discovery found nothing (attempt ${consecutiveGoalDiscoveryFailures}/${MAX_GOAL_DISCOVERY_FAILURES}).\n` +
          `The AI may be stuck in research mode. Will retry in 30 minutes.`
        );
      }
    }

    // Also trigger reflection/metacognitive during idle time if due
    // This ensures self-improvement happens even when backlog is empty
    if (shouldTriggerReflection()) {
      const reflectSpan = startSpan("reflection", { traceId: trace.id });
      try {
        log.info("Triggering reflection session during goal discovery");
        const reflectionSession = runReflection("Periodic check during idle");
        const report = formatReflectionReport(reflectionSession);
        await notifyFn(report);
        endSpan(reflectSpan.id, "success");
      } catch (e) {
        endSpan(reflectSpan.id, "error", { type: "ReflectionError", message: (e as Error).message });
        log.error("Reflection session failed during goal discovery", { error: (e as Error).message });
      }
    }

    if (shouldTriggerMetacognitive()) {
      const metaSpan = startSpan("metacognitive", { traceId: trace.id });
      try {
        log.info("Triggering metacognitive session during goal discovery");
        const metaSession = runMetacognitiveSession({
          activity: "Goal discovery - idle time self-assessment",
        });
        const report = formatMetacognitiveReport(metaSession);
        await notifyFn(report);
        endSpan(metaSpan.id, "success");
      } catch (e) {
        endSpan(metaSpan.id, "error", { type: "MetacognitiveError", message: (e as Error).message });
        log.error("Metacognitive session failed during goal discovery", { error: (e as Error).message });
      }
    }

    log.info("Goal discovery completed", { result: result.slice(0, 100) });

    // ── End Trace (Success) ─────────────────────────────────────────
    endTrace(trace.id, "success");
  } catch (e) {
    const errorSpan = startSpan("error-handler", { traceId: trace.id });
    endSpan(errorSpan.id, "error", { type: (e as Error).constructor.name, message: (e as Error).message });
    log.error("Goal discovery failed", { error: (e as Error).message });

    // ── End Trace (Error) ───────────────────────────────────────────
    endTrace(trace.id, "error");
  }
}
