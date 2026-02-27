import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
import { getEvolutionCyclePrompt, getConsciousnessCheckPrompt } from "../config/evolution-prompt.js";

const BACKLOG_PATH = join(process.cwd(), "data", "backlog.md");

// ── Backlog ────────────────────────────────────────────────────────

export interface Task {
  id: string;    // e.g. "#001"
  title: string;
}

function safeReadBacklog(): string {
  try {
    if (existsSync(BACKLOG_PATH)) return readFileSync(BACKLOG_PATH, "utf-8");
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
  const content = safeReadBacklog();
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

// ── Loop interval ──────────────────────────────────────────────────

function getLoopIntervalMs(): number {
  const env = process.env.CONSCIOUSNESS_INTERVAL_SECONDS;
  if (env) {
    const seconds = parseFloat(env);
    if (!isNaN(seconds) && seconds > 0) return Math.round(seconds * 1000);
  }
  return 5 * 1000; // default: 5 seconds
}

// Consciousness check runs at most once every 6 hours when backlog is empty
const CONSCIOUSNESS_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastConsciousnessCheckAt = 0;

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

// ── Types ──────────────────────────────────────────────────────────

type PromptFn = (message: string) => Promise<string>;
type NotifyFn = (message: string) => Promise<void>;

export interface ConsciousnessHandle {
  /** Immediately trigger one cycle if a task is pending. */
  triggerNow: () => void;
  stop: () => void;
}

// ── Main loop ──────────────────────────────────────────────────────

export function startConsciousness(
  promptFn: PromptFn,
  notifyFn: NotifyFn,
  isAgentBusy: () => boolean,
): ConsciousnessHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running || isAgentBusy()) {
      scheduleNext();
      return;
    }

    running = true;
    try {
      const task = loadNextTask();

      if (task) {
        await runEvolutionCycle(task, promptFn, notifyFn);
      } else {
        // No tasks: run consciousness check at most every 6 hours
        const now = Date.now();
        if (now - lastConsciousnessCheckAt >= CONSCIOUSNESS_CHECK_INTERVAL_MS) {
          lastConsciousnessCheckAt = now;
          await runConsciousnessCheck(promptFn);
        }
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
      if (!running && !isAgentBusy()) {
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

async function runEvolutionCycle(task: Task, promptFn: PromptFn, notifyFn: NotifyFn): Promise<void> {
  const state = readState();
  const cycle = state.cycle + 1;
  const startTime = Date.now();

  log.info(`Evolution cycle #${cycle} starting`, { task: task.id, title: task.title });
  startEvolutionProgress(cycle);
  setEvolutionStage("implementing", `Executing: ${task.title}`);

  try {
    const recentHistory = loadRecentHistory(3);
    const stats = calculateEvolutionStats();

    const prompt = getEvolutionCyclePrompt(cycle, task.id, task.title, {
      recentHistory: recentHistory.map(h => `#${h.cycle} ${h.status}`).join(", ") || "none",
      totalCycles: stats.totalCycles,
      currentStreak: stats.currentStreak,
    });

    const result = await promptFn(prompt);

    const durationMs = Date.now() - startTime;
    setEvolutionStage("committing", "Saving results");

    // Mark task done in backlog
    markTaskDone(task);

    saveState({ cycle, lastEvolution: new Date().toISOString() });
    recordEvolutionResult(cycle, state.version, "success", result.slice(0, 200), durationMs);
    completeEvolutionProgress(durationMs);

    log.info(`Evolution cycle #${cycle} completed`, { durationMs, task: task.id });

    const notifySummary = result.length > 500 ? result.slice(0, 500) + "..." : result;
    await notifyFn(`🧬 Evolution #${cycle} complete [${task.id}]:\n${notifySummary}`);
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - startTime;

    recordEvolutionResult(cycle, state.version, "failed", err.message, durationMs);
    failEvolutionProgress(err.message);

    log.error(`Evolution cycle #${cycle} failed`, { error: err.message, durationMs });
    await notifyFn(`❌ Evolution #${cycle} failed [${task.id}]: ${err.message}`);
  }
}

// ── Consciousness check ────────────────────────────────────────────

async function runConsciousnessCheck(promptFn: PromptFn): Promise<void> {
  log.info("Consciousness check");
  try {
    await recordHealthSnapshot();
    await promptFn(getConsciousnessCheckPrompt());
  } catch (e) {
    log.error("Consciousness check failed", { error: (e as Error).message });
  }
}
