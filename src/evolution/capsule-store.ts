/**
 * GEP Capsule Store
 * Manages successful evolution records (capsules) and audit events.
 *
 * Files:
 *   data/gep/capsules.jsonl  — one JSON record per successful evolution
 *   data/gep/events.jsonl    — audit log for all capsule-related events
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { log } from "../util/log.js";

// ── Paths ──────────────────────────────────────────────────────────

const GEP_DIR = join(process.cwd(), "data", "gep");
const CAPSULES_PATH = join(GEP_DIR, "capsules.jsonl");
const EVENTS_PATH = join(GEP_DIR, "events.jsonl");

// ── Types ──────────────────────────────────────────────────────────

export interface EvolutionCapsule {
  /** Timestamp of when this capsule was recorded (ISO) */
  timestamp: string;
  /** Evolution cycle number */
  cycle: number;
  /** Task ID from backlog, e.g. "#077" */
  taskId: string;
  /** Inferred task type: feature | bugfix | refactor | testing | research | other */
  taskType: string;
  /** Short description of the approach / what was done */
  approach: string;
  /** Key source files that were changed */
  keyFiles: string[];
  /** Duration of the evolution in milliseconds */
  durationMs: number;
  /** Quality score 1-10 from evolution scorer */
  qualityScore: number;
}

export interface EvolutionEvent {
  /** Timestamp (ISO) */
  timestamp: string;
  /** Event type */
  type: "capsule_added" | "capsule_read" | "store_init";
  /** Associated capsule cycle, if applicable */
  cycle?: number;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

// ── Helpers ────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(GEP_DIR)) {
    mkdirSync(GEP_DIR, { recursive: true });
  }
}

/** Infer task type from task title and result text */
export function inferTaskType(taskTitle: string, result: string): string {
  const combined = (taskTitle + " " + result).toLowerCase();

  if (/\b(fix|bug|repair|patch|broken|error|crash|fail)\b/.test(combined)) {
    return "bugfix";
  }
  if (/\b(test|spec|coverage|vitest|jest)\b/.test(combined)) {
    return "testing";
  }
  if (/\b(refactor|clean|reorganize|restructure|rename|move)\b/.test(combined)) {
    return "refactor";
  }
  if (/\b(research|study|analyze|explore|investigate|understand)\b/.test(combined)) {
    return "research";
  }
  if (/\b(add|implement|create|build|new|feature|support)\b/.test(combined)) {
    return "feature";
  }
  return "other";
}

/** Extract short approach summary from evolution result text */
export function extractApproach(result: string): string {
  // Look for the first meaningful sentence or bullet in the result
  const lines = result.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Skip very short lines or lines that are just headers/symbols
    if (line.length < 20) continue;
    // Skip markdown headers
    if (line.startsWith("#")) continue;
    // Skip emoji-only lines
    if (/^[\p{Emoji}\s]+$/u.test(line)) continue;

    // Clean up bullets, bold markers etc.
    const clean = line
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\*\*/g, "")
      .trim();

    if (clean.length >= 20) {
      return clean.slice(0, 200);
    }
  }

  return result.slice(0, 200).replace(/\n/g, " ").trim();
}

/** Get list of changed files from git diff (last commit) */
export function getChangedFiles(): string[] {
  try {
    const output = execSync(
      "git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo ''",
      { encoding: "utf-8", cwd: process.cwd(), timeout: 10000 }
    ).trim();

    if (!output) return [];

    return output
      .split("\n")
      .map(f => f.trim())
      .filter(f => f.length > 0)
      .filter(f => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".json") || f.endsWith(".md"))
      .slice(0, 10); // limit to 10 most relevant files
  } catch {
    return [];
  }
}

// ── Core Operations ────────────────────────────────────────────────

/**
 * Append a successful evolution capsule to data/gep/capsules.jsonl.
 * Also appends an audit event to data/gep/events.jsonl.
 */
export function appendCapsule(capsule: EvolutionCapsule): void {
  try {
    ensureDir();

    const line = JSON.stringify(capsule) + "\n";
    appendFileSync(CAPSULES_PATH, line, "utf-8");

    // Also log an audit event
    appendEvent({
      timestamp: new Date().toISOString(),
      type: "capsule_added",
      cycle: capsule.cycle,
      meta: {
        taskId: capsule.taskId,
        taskType: capsule.taskType,
        qualityScore: capsule.qualityScore,
        durationMs: capsule.durationMs,
        filesCount: capsule.keyFiles.length,
      },
    });

    log.info("GEP capsule recorded", {
      cycle: capsule.cycle,
      taskId: capsule.taskId,
      qualityScore: capsule.qualityScore,
    });
  } catch (e) {
    log.error("Failed to append GEP capsule", { error: (e as Error).message });
  }
}

/**
 * Append an audit event to data/gep/events.jsonl.
 */
export function appendEvent(event: EvolutionEvent): void {
  try {
    ensureDir();
    const line = JSON.stringify(event) + "\n";
    appendFileSync(EVENTS_PATH, line, "utf-8");
  } catch (e) {
    log.error("Failed to append GEP event", { error: (e as Error).message });
  }
}

/**
 * Read the N most recent capsules from data/gep/capsules.jsonl.
 */
export function getRecentCapsules(n: number = 10): EvolutionCapsule[] {
  try {
    if (!existsSync(CAPSULES_PATH)) return [];

    const content = readFileSync(CAPSULES_PATH, "utf-8").trim();
    if (!content) return [];

    const lines = content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const capsules: EvolutionCapsule[] = [];
    for (const line of lines) {
      try {
        capsules.push(JSON.parse(line) as EvolutionCapsule);
      } catch {
        // Skip malformed lines
      }
    }

    // Return last N (most recent)
    return capsules.slice(-Math.max(1, n));
  } catch (e) {
    log.error("Failed to read GEP capsules", { error: (e as Error).message });
    return [];
  }
}

/**
 * Get total count of capsules.
 */
export function getCapsuleCount(): number {
  try {
    if (!existsSync(CAPSULES_PATH)) return 0;
    const content = readFileSync(CAPSULES_PATH, "utf-8").trim();
    if (!content) return 0;
    return content.split("\n").filter(l => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * Format capsules for Telegram display.
 */
export function formatCapsulesReport(capsules: EvolutionCapsule[], total: number): string {
  if (capsules.length === 0) {
    return "💊 No GEP capsules yet. Successful evolutions will appear here.";
  }

  const lines: string[] = [
    `💊 GEP Capsules — ${capsules.length} of ${total} total`,
    "",
  ];

  // Show most recent first
  const reversed = [...capsules].reverse();

  for (const c of reversed) {
    const date = new Date(c.timestamp).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
    });
    const time = new Date(c.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const durationSec = (c.durationMs / 1000).toFixed(1);
    const qualityStars = "⭐".repeat(Math.min(5, Math.max(1, Math.round(c.qualityScore / 2))));
    const typeEmoji: Record<string, string> = {
      feature: "🚀",
      bugfix: "🔧",
      refactor: "♻️",
      testing: "🧪",
      research: "🔬",
      other: "📦",
    };
    const emoji = typeEmoji[c.taskType] ?? "📦";

    lines.push(`${emoji} **#${c.cycle}** ${c.taskId} [${c.taskType}] — ${date} ${time}`);
    lines.push(`   ${qualityStars} Q:${c.qualityScore}/10 | ⏱ ${durationSec}s`);
    lines.push(`   ${c.approach.slice(0, 100)}${c.approach.length > 100 ? "..." : ""}`);
    if (c.keyFiles.length > 0) {
      lines.push(`   📄 ${c.keyFiles.slice(0, 3).join(", ")}${c.keyFiles.length > 3 ? ` +${c.keyFiles.length - 3}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Retrieve capsules most relevant to the current task.
 *
 * Scoring strategy:
 *   - Capsules whose taskType matches the inferred type of taskTitle get a +2 bonus
 *   - Capsules are then sorted by (bonus + qualityScore) descending
 *   - Top n capsules are returned
 */
export function getRelevantCapsules(taskTitle: string, n: number = 3): EvolutionCapsule[] {
  try {
    if (!existsSync(CAPSULES_PATH)) return [];

    const content = readFileSync(CAPSULES_PATH, "utf-8").trim();
    if (!content) return [];

    const lines = content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const capsules: EvolutionCapsule[] = [];
    for (const line of lines) {
      try {
        capsules.push(JSON.parse(line) as EvolutionCapsule);
      } catch {
        // Skip malformed lines
      }
    }

    if (capsules.length === 0) return [];

    // Infer the task type of the current task title
    const targetType = inferTaskType(taskTitle, "");

    // Score and sort: same taskType gets +2 bonus, then sort by qualityScore desc
    const scored = capsules.map(c => ({
      capsule: c,
      score: c.qualityScore + (c.taskType === targetType ? 2 : 0),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Log retrieval event
    appendEvent({
      timestamp: new Date().toISOString(),
      type: "capsule_read",
      meta: {
        taskTitle: taskTitle.slice(0, 100),
        targetType,
        totalCapsules: capsules.length,
        retrieved: Math.min(n, scored.length),
      },
    });

    return scored.slice(0, Math.max(1, n)).map(s => s.capsule);
  } catch (e) {
    log.error("Failed to retrieve relevant GEP capsules", { error: (e as Error).message });
    return [];
  }
}

/**
 * Format capsules into a "## Past Successful Approaches" prompt section.
 * Returns empty string when capsules array is empty (graceful degradation).
 */
export function formatCapsulesForPrompt(capsules: EvolutionCapsule[]): string {
  if (capsules.length === 0) return "";

  const lines: string[] = [
    "",
    "## Past Successful Approaches",
    "",
    "The following successful evolution capsules are relevant to this task. " +
    "Use them as inspiration for your approach:",
    "",
  ];

  for (const c of capsules) {
    const durationSec = (c.durationMs / 1000).toFixed(0);
    lines.push(`**#${c.cycle} ${c.taskId}** [${c.taskType}] — Quality: ${c.qualityScore}/10 | Duration: ${durationSec}s`);
    lines.push(`> ${c.approach}`);
    if (c.keyFiles.length > 0) {
      lines.push(`> Files: ${c.keyFiles.slice(0, 5).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a capsule from evolution cycle data and append it.
 * This is the main integration point called from loop.ts.
 */
export function recordSuccessfulEvolution(params: {
  cycle: number;
  taskId: string;
  taskTitle: string;
  result: string;
  durationMs: number;
  qualityScore: number;
}): void {
  const { cycle, taskId, taskTitle, result, durationMs, qualityScore } = params;

  const capsule: EvolutionCapsule = {
    timestamp: new Date().toISOString(),
    cycle,
    taskId,
    taskType: inferTaskType(taskTitle, result),
    approach: extractApproach(result),
    keyFiles: getChangedFiles(),
    durationMs,
    qualityScore,
  };

  appendCapsule(capsule);
}
