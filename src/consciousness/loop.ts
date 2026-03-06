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
import { getEvolutionCyclePrompt, getGoalDiscoveryPrompt } from "../config/evolution-prompt.js";
import { SessionPool, isConversationBusy } from "../agent/session.js";
import {
  shouldTriggerReflection,
  runReflection,
  formatReflectionReport,
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
} from "../evolution/capsule-store.js";

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
 * Format: `- [ ] #001: Task title`
 */
export function loadNextTask(): Task | null {
  const content = safeRead(BACKLOG_PATH);
  const lines = content.split("\n");
  let inPending = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "## Pending") { inPending = true; continue; }
    if (trimmed.startsWith("## ")) { inPending = false; continue; }

    if (inPending) {
      const m = /^- \[ \] (#\d+): (.+)$/.exec(trimmed);
      if (m) return { id: m[1], title: m[2].trim() };
    }
  }

  return null;
}

/**
 * Move a task from Pending to Done in backlog.md.
 */
export function markTaskDone(task: Task): void {
  try {
    const content = readFileSync(BACKLOG_PATH, "utf-8");
    const taskLine = `- [ ] ${task.id}: ${task.title}`;
    const doneLine = `- [x] ${task.id}: ${task.title} — ${new Date().toLocaleDateString("en-CA")}`;

    const lines = content.split("\n");
    const updated: string[] = [];
    let insertedDone = false;

    for (const line of lines) {
      if (line.trim() === taskLine.trim()) continue; // remove from pending

      updated.push(line);

      if (!insertedDone && line.trim() === "## Done") {
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
    }) + "\n\n" + archivePromptContext + principlesContext + capsulesContext;
    endSpan(promptSpan.id, "success");

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

    // Defensive: treat empty or trivially short results as failures to prevent
    // silent pass-throughs from infrastructure errors (e.g. auth/permission issues).
    if (!result || result.trim().length < 20) {
      endSpan(execSpan.id, "error", { type: "InvalidResult", message: `Suspiciously short result: "${result}"` });
      throw new Error(`Evolution worker returned suspiciously short result: "${result}"`);
    }

    const durationMs = Date.now() - startTime;
    setEvolutionStage("committing", "Saving results");

    // Record results
    const recordSpan = startSpan("result-recording", { traceId: trace.id });
    markTaskDone(task);
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

    // ── End Trace (Success) ─────────────────────────────────────────
    endTrace(trace.id, "success");
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - startTime;

    const errorSpan = startSpan("error-handler", { traceId: trace.id });
    recordEvolutionResult(cycle, state.version, "failed", err.message, durationMs);
    failEvolutionProgress(err.message);

    // Track consecutive failures in circuit breaker
    const circuitResult = recordCircuitFailure();
    await notifyCircuitTripIfNeeded(circuitResult, notifyFn);

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
      [`Failed: ${err.message}`],
      -0.1 // Negative fitness delta for failure
    );
    endSpan(errorSpan.id, "error", { type: err.constructor.name, message: err.message });

    log.error(`Evolution cycle #${cycle} failed`, { error: err.message, durationMs });
    await notifyFn(`❌ Evolution #${cycle} failed [${task.id}]: ${err.message}`);

    // Record principle retrieval result as failure for Experience Distillation feedback
    recordRetrievalResult(evolutionId, "failure");

    // ── End Trace (Error) ───────────────────────────────────────────
    endTrace(trace.id, "error");
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
      addSpanEvent(trace.rootSpanId, "task_added", { taskId: taskAfter.id, title: taskAfter.title });
      log.info("Goal discovery added tasks to backlog");
      await notifyFn(`🔍 Goal discovery complete. New task queued: ${taskAfter.id}: ${taskAfter.title}`);
    } else {
      log.info("Goal discovery found nothing to add");
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
