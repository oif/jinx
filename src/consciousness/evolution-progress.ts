import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { log } from "../util/log.js";

import { PROGRESS_PATH } from "../supervisor/paths.js";

export type EvolutionStage =
  | "idle"
  | "evaluating"
  | "selecting"
  | "implementing"
  | "validating"
  | "committing"
  | "reviewing"
  | "reporting"
  | "completed"
  | "failed";

export interface EvolutionProgress {
  cycle: number;
  stage: EvolutionStage;
  startedAt: string;
  stageStartedAt: string;
  message?: string;
  durationMs?: number;
}

/**
 * Start tracking a new evolution cycle.
 */
export function startEvolutionProgress(cycle: number): void {
  const progress: EvolutionProgress = {
    cycle,
    stage: "idle",
    startedAt: new Date().toISOString(),
    stageStartedAt: new Date().toISOString(),
  };
  saveProgress(progress);
  log.info(`Evolution #${cycle} progress tracking started`);
}

/**
 * Update the current stage of evolution.
 */
export function setEvolutionStage(stage: EvolutionStage, message?: string): void {
  const progress = loadProgress();
  if (!progress) return;

  const now = new Date().toISOString();
  const stageDuration = progress.stageStartedAt
    ? Date.now() - new Date(progress.stageStartedAt).getTime()
    : 0;

  progress.stage = stage;
  progress.stageStartedAt = now;
  if (message) {
    progress.message = message;
  }

  saveProgress(progress);

  const emoji = getStageEmoji(stage);
  const durationStr = stageDuration > 0 ? ` (${formatDuration(stageDuration)})` : "";
  log.info(`Evolution #${progress.cycle}: ${stage}${durationStr}`, message ? { message } : undefined);
}

/**
 * Mark evolution as completed.
 */
export function completeEvolutionProgress(durationMs: number): void {
  const progress = loadProgress();
  if (!progress) return;

  progress.stage = "completed";
  progress.durationMs = durationMs;
  saveProgress(progress);

  // Clear the progress file after a delay (keep it briefly for status queries)
  setTimeout(() => {
    try {
      if (existsSync(PROGRESS_PATH)) {
        // Keep the file but mark as old cycle
        const p = JSON.parse(readFileSync(PROGRESS_PATH, "utf-8")) as EvolutionProgress;
        if (p.cycle === progress.cycle && p.stage === "completed") {
          // File is stale, can be cleaned up on next cycle start
        }
      }
    } catch {
      // ignore
    }
  }, 60000); // Keep for 1 minute after completion

  log.info(`Evolution #${progress.cycle} completed`, { durationMs });
}

/**
 * Mark evolution as failed.
 */
export function failEvolutionProgress(error: string): void {
  const progress = loadProgress();
  if (!progress) return;

  progress.stage = "failed";
  progress.message = error;
  saveProgress(progress);
  log.error(`Evolution #${progress.cycle} failed`, { error });
}

/**
 * Load current progress from disk.
 */
export function loadProgress(): EvolutionProgress | null {
  try {
    if (existsSync(PROGRESS_PATH)) {
      return JSON.parse(readFileSync(PROGRESS_PATH, "utf-8")) as EvolutionProgress;
    }
  } catch (e) {
    log.warn("Failed to load evolution progress", { error: (e as Error).message });
  }
  return null;
}

/**
 * Save progress to disk.
 */
function saveProgress(progress: EvolutionProgress): void {
  try {
    writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  } catch (e) {
    log.warn("Failed to save evolution progress", { error: (e as Error).message });
  }
}

/**
 * Get emoji for stage.
 */
function getStageEmoji(stage: EvolutionStage): string {
  const emojis: Record<EvolutionStage, string> = {
    idle: "⏳",
    evaluating: "🔍",
    selecting: "🎯",
    implementing: "🔨",
    validating: "🧪",
    committing: "💾",
    reviewing: "🔍",
    reporting: "📢",
    completed: "✅",
    failed: "❌",
  };
  return emojis[stage] || "❓";
}

/**
 * Format duration in human-readable form.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format current progress for display.
 */
export function formatProgress(): string {
  const progress = loadProgress();
  if (!progress) {
    return "No evolution in progress.";
  }

  const emoji = getStageEmoji(progress.stage);
  const startTime = new Date(progress.startedAt).getTime();
  const elapsed = Date.now() - startTime;

  const lines: string[] = [
    `🧬 Evolution #${progress.cycle}`,
    ``,
    `${emoji} Stage: ${progress.stage}`,
    `⏱️  Elapsed: ${formatDuration(elapsed)}`,
  ];

  if (progress.message) {
    lines.push(`📝 ${progress.message}`);
  }

  // Add stage progression bar
  const stages: EvolutionStage[] = ["evaluating", "selecting", "implementing", "validating", "committing", "reviewing", "reporting"];
  const currentIndex = stages.indexOf(progress.stage);

  if (currentIndex >= 0) {
    const bar = stages.map((s, i) => {
      if (i < currentIndex) return "✓"; // Completed
      if (i === currentIndex) return "▶"; // Current
      return "○"; // Pending
    }).join(" ");

    const labels = ["eval", "select", "implement", "validate", "commit", "review", "report"];
    lines.push(`\nProgress: ${bar}`);
    lines.push(`          ${labels.map((l, i) => i === currentIndex ? l.padEnd(8) : "".padEnd(8)).join("")}`);
  }

  return lines.join("\n");
}

/**
 * Check if evolution is currently active (not idle/completed/failed).
 */
export function isEvolutionActive(): boolean {
  const progress = loadProgress();
  if (!progress) return false;
  return !["idle", "completed", "failed"].includes(progress.stage);
}
