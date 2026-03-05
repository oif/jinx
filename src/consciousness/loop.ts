import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { readState } from "../util/state.js";
import { recordEvolutionResult, loadRecentHistory, calculateEvolutionStats } from "./history.js";
import {
  startEvolutionProgress,
  setEvolutionStage,
  completeEvolutionProgress,
  failEvolutionProgress,
} from "./evolution-progress.js";
import { STATE_PATH } from "../supervisor/paths.js";
import { recordHealthSnapshot } from "../health/history.js";
import { recordEvolutionCycle } from "../observability/metrics.js";
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
  getCapabilitySummary,
  initCapabilityTaxonomy,
} from "./capabilities.js";

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

// ── Evolution cycle ────────────────────────────────────────────────

async function runEvolutionCycle(task: Task, notifyFn: NotifyFn): Promise<void> {
  const state = readState();
  const cycle = state.cycle + 1;
  const startTime = Date.now();

  log.info(`Evolution cycle #${cycle} starting`, { task: task.id, title: task.title });
  startEvolutionProgress(cycle);
  setEvolutionStage("implementing", `Executing: ${task.title}`);

  // Notify owner that evolution has started (system-level, not LLM-dependent)
  await notifyFn(`🧬 Evolution #${cycle} starting\n📋 Task: ${task.id}: ${task.title}`).catch(() => {});

  try {
    const recentHistory = loadRecentHistory(3);
    const stats = calculateEvolutionStats();

    const prompt = getEvolutionCyclePrompt(cycle, task.id, task.title, {
      recentHistory: recentHistory.map(h => `#${h.cycle} ${h.status}`).join(", ") || "none",
      totalCycles: stats.totalCycles,
      currentStreak: stats.currentStreak,
    });

    const worker = await SessionPool.spawn({ label: `evolution-${cycle}`, thinkingLevel: "high" });
    let result: string;
    try {
      result = await worker.prompt(prompt);
    } finally {
      worker.dispose();
    }

    // Defensive: treat empty or trivially short results as failures to prevent
    // silent pass-throughs from infrastructure errors (e.g. auth/permission issues).
    if (!result || result.trim().length < 20) {
      throw new Error(`Evolution worker returned suspiciously short result: "${result}"`);
    }

    const durationMs = Date.now() - startTime;
    setEvolutionStage("committing", "Saving results");

    markTaskDone(task);
    saveState({ cycle, lastEvolution: new Date().toISOString() });
    recordEvolutionResult(cycle, state.version, "success", result.slice(0, 200), durationMs);
    completeEvolutionProgress(durationMs);

    // Record performance metrics for successful evolution
    recordEvolutionCycle({
      cycle,
      taskId: task.id,
      durationMs,
      status: "success",
    });

    log.info(`Evolution cycle #${cycle} completed`, { durationMs, task: task.id });

    const notifySummary = result.length > 500 ? result.slice(0, 500) + "..." : result;
    await notifyFn(`🧬 Evolution #${cycle} complete [${task.id}]:\n${notifySummary}`);

    // Record evolution knowledge for future recall
    recordEvolutionKnowledge(task.id, cycle, task.title, result);

    // Check if we should run a reflection session (MARS-inspired reflective self-improvement)
    if (shouldTriggerReflection()) {
      try {
        log.info("Triggering reflection session after evolution", { cycle });
        const reflectionSession = runReflection(`After evolution #${cycle}`);
        const report = formatReflectionReport(reflectionSession);
        await notifyFn(report);
      } catch (e) {
        log.error("Reflection session failed", { error: (e as Error).message });
      }
    }

    // Check if we should run a metacognitive session (real-time self-assessment)
    if (shouldTriggerMetacognitive()) {
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
      } catch (e) {
        log.error("Metacognitive session failed", { error: (e as Error).message });
      }
    }
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - startTime;

    recordEvolutionResult(cycle, state.version, "failed", err.message, durationMs);
    failEvolutionProgress(err.message);

    // Record performance metrics for failed evolution
    recordEvolutionCycle({
      cycle,
      taskId: task.id,
      durationMs,
      status: "failed",
    });

    log.error(`Evolution cycle #${cycle} failed`, { error: err.message, durationMs });
    await notifyFn(`❌ Evolution #${cycle} failed [${task.id}]: ${err.message}`);
  }
}

// ── Goal discovery ─────────────────────────────────────────────────

async function runGoalDiscovery(notifyFn: NotifyFn): Promise<void> {
  log.info("Goal discovery starting");

  try {
    await recordHealthSnapshot();

    // Initialize capability taxonomy if needed (Alita-G Phase 2)
    initCapabilityTaxonomy();

    const stats = calculateEvolutionStats();
    const goals = safeRead(GOALS_PATH) || "No direction set yet. Explore freely.";
    const recentDone = loadRecentDone(5);
    
    // Get capability summary for systematic goal discovery (Alita-G)
    const capabilitySummary = getCapabilitySummary();

    const prompt = getGoalDiscoveryPrompt({
      goals,
      recentDone,
      totalCycles: stats.totalCycles,
      capabilitySummary,
    });

    const worker = await SessionPool.spawn({ label: "goal-discovery", thinkingLevel: "medium" });
    let result: string;
    try {
      result = await worker.prompt(prompt);
    } finally {
      worker.dispose();
    }

    // Check if new tasks were added
    const taskAfter = loadNextTask();
    if (taskAfter) {
      log.info("Goal discovery added tasks to backlog");
      await notifyFn(`🔍 Goal discovery complete. New task queued: ${taskAfter.id}: ${taskAfter.title}`);
    } else {
      log.info("Goal discovery found nothing to add");
    }

    // Also trigger reflection/metacognitive during idle time if due
    // This ensures self-improvement happens even when backlog is empty
    if (shouldTriggerReflection()) {
      try {
        log.info("Triggering reflection session during goal discovery");
        const reflectionSession = runReflection("Periodic check during idle");
        const report = formatReflectionReport(reflectionSession);
        await notifyFn(report);
      } catch (e) {
        log.error("Reflection session failed during goal discovery", { error: (e as Error).message });
      }
    }

    if (shouldTriggerMetacognitive()) {
      try {
        log.info("Triggering metacognitive session during goal discovery");
        const metaSession = runMetacognitiveSession({
          activity: "Goal discovery - idle time self-assessment",
        });
        const report = formatMetacognitiveReport(metaSession);
        await notifyFn(report);
      } catch (e) {
        log.error("Metacognitive session failed during goal discovery", { error: (e as Error).message });
      }
    }

    log.info("Goal discovery completed", { result: result.slice(0, 100) });
  } catch (e) {
    log.error("Goal discovery failed", { error: (e as Error).message });
  }
}
