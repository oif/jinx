/**
 * Self-Rescue Module
 *
 * Detects and recovers from three stuck-loop failure modes automatically:
 *
 * Mode A — State Divergence:
 *   task-progress.json says "completed" but backlog.md still pending.
 *   Cause: crash or API error between task completion and markTaskDone().
 *   Fix: boot-time reconciliation via reconcileBacklogState().
 *
 * Mode B — Consecutive Failure Loop:
 *   Same taskId fails 3+ times in a row in the agent archive.
 *   Cause: task is genuinely broken or always times out.
 *   Fix: detectStuckTask() → force-abandon before running the cycle.
 *
 * Mode C — Excel Block Without Learning:
 *   Excel check (pnpm test) fails, task stays pending, same broken
 *   code is attempted again next cycle with no memory of what broke.
 *   Fix: save failure context → inject into next attempt's prompt.
 *   Excel failures also count toward Mode B streak so they self-escape.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { loadTaskProgress } from "./task-decomposer.js";
import { getCurrentBranch, type AgentArchive } from "../evolution/agent-archive.js";

// ── Constants ─────────────────────────────────────────────────────

/** Consecutive task-specific failures before declaring stuck. */
export const STUCK_THRESHOLD = 3;

/** Excel check failures before a task is force-abandoned. */
export const EXCEL_FAIL_THRESHOLD = 3;

/** Lazily computed so tests can override process.cwd() before calling any function. */
function getRescueDir(): string {
  return join(process.cwd(), "data", "self-rescue");
}

// ── Types ─────────────────────────────────────────────────────────

export interface StuckInfo {
  isStuck: boolean;
  reason: string;
  failureCount: number;
}

export interface ExcelFailureRecord {
  taskId: string;
  failureCount: number;
  lastFailedAt: string;
  reason: string;
  /** Truncated test output for prompt injection (max 2000 chars). */
  testOutput: string;
}

// ── Mode A: State Divergence Reconciliation ───────────────────────

/**
 * Check whether taskId appears as pending in backlog.md.
 * Supports both legacy `- [ ] #id:` and challenge `### 挑战 #id:` formats.
 */
function isPendingInBacklog(backlogPath: string, taskId: string): boolean {
  try {
    if (!existsSync(backlogPath)) return false;
    const content = readFileSync(backlogPath, "utf-8");
    const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const legacyRe = new RegExp(`^- \\[ \\] ${escaped}:`, "m");
    if (legacyRe.test(content)) return true;
    const challengeRe = new RegExp(`^### 挑战 ${escaped}:`, "m");
    return challengeRe.test(content);
  } catch {
    return false;
  }
}

/**
 * Boot-time reconciliation.
 *
 * Scans all entries in task-progress.json; any task that is marked
 * "completed" there but still appears as pending in backlog.md is
 * force-moved to Done via the provided markDone callback.
 *
 * This is idempotent and safe to call on every startup.
 *
 * @param backlogPath  Absolute path to data/backlog.md
 * @param markDone     Callback that writes the Done marker (e.g. markTaskDone)
 * @returns            List of task IDs that were fixed
 */
export function reconcileBacklogState(
  backlogPath: string,
  markDone: (taskId: string, title: string) => void,
): string[] {
  const fixed: string[] = [];
  try {
    const allProgress = loadTaskProgress();

    for (const [taskId, progress] of allProgress) {
      if (progress.status !== "completed") continue;
      if (!isPendingInBacklog(backlogPath, taskId)) continue;

      markDone(taskId, progress.taskTitle);
      fixed.push(taskId);
      log.warn("Boot reconciliation: fixed stuck task", {
        taskId,
        title: progress.taskTitle,
        completedAt: progress.updatedAt,
      });
    }

    if (fixed.length > 0) {
      log.info("Boot reconciliation complete", { fixedCount: fixed.length, tasks: fixed });
    }
  } catch (e) {
    log.error("Boot reconciliation failed", { error: (e as Error).message });
  }
  return fixed;
}

// ── Mode B: Consecutive Failure Detection ─────────────────────────

/**
 * Count how many consecutive failures this task has at the tail of the
 * current branch's evolution history.
 *
 * "Consecutive" means: starting from the most recent entry for this task
 * and scanning backwards, count unbroken failed entries.  A single success
 * resets the streak.
 */
export function detectStuckTask(taskId: string, archive: AgentArchive): StuckInfo {
  const currentBranch = getCurrentBranch(archive);
  if (!currentBranch) return { isStuck: false, reason: "", failureCount: 0 };

  // Filter to only this task's history
  const taskHistory = currentBranch.evolutionHistory.filter(e => e.taskId === taskId);

  let streak = 0;
  for (let i = taskHistory.length - 1; i >= 0; i--) {
    if (taskHistory[i].status === "failed") streak++;
    else break; // success interrupts the streak
  }

  if (streak >= STUCK_THRESHOLD) {
    return {
      isStuck: true,
      reason: `Task ${taskId} has failed ${streak} consecutive times (threshold: ${STUCK_THRESHOLD})`,
      failureCount: streak,
    };
  }

  return { isStuck: false, reason: "", failureCount: streak };
}

// ── Mode C: Excel Failure Context ─────────────────────────────────

function getFailurePath(taskId: string): string {
  const safeId = taskId.replace(/[^a-zA-Z0-9]/g, "");
  return join(getRescueDir(), `${safeId}-excel-failure.json`);
}

/**
 * Persist an Excel check failure so the next evolution attempt can see
 * exactly what broke and avoid repeating the same mistake.
 *
 * Increments failureCount on each call.
 */
export function saveExcelFailureContext(
  taskId: string,
  reason: string,
  testOutput: string,
): ExcelFailureRecord {
  try {
    if (!existsSync(getRescueDir())) mkdirSync(getRescueDir(), { recursive: true });

    const existing = loadExcelFailureRecord(taskId);
    const record: ExcelFailureRecord = {
      taskId,
      failureCount: (existing?.failureCount ?? 0) + 1,
      lastFailedAt: new Date().toISOString(),
      reason,
      testOutput: testOutput.slice(0, 2000),
    };

    writeFileSync(getFailurePath(taskId), JSON.stringify(record, null, 2));
    log.info("Excel failure context saved", {
      taskId,
      failureCount: record.failureCount,
      reason: reason.slice(0, 120),
    });
    return record;
  } catch (e) {
    log.error("Failed to save Excel failure context", { error: (e as Error).message });
    return {
      taskId,
      failureCount: 1,
      lastFailedAt: new Date().toISOString(),
      reason,
      testOutput: "",
    };
  }
}

/** Load a previously saved Excel failure record, or null if none exists. */
export function loadExcelFailureRecord(taskId: string): ExcelFailureRecord | null {
  try {
    const path = getFailurePath(taskId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ExcelFailureRecord;
  } catch {
    return null;
  }
}

/**
 * Format an Excel failure record for injection into the next evolution prompt.
 * Written in Chinese to match the rest of the agent prompt context.
 */
export function formatExcelFailureContext(record: ExcelFailureRecord): string {
  return `
## ⚠️ 上次 Excel 检查失败 (共失败 ${record.failureCount} 次)

**失败原因**: ${record.reason}
**失败时间**: ${record.lastFailedAt}

**测试输出**:
\`\`\`
${record.testOutput || "(无输出)"}
\`\`\`

**本次迭代指引**:
1. 首先运行 \`pnpm test\` 确认当前测试状态
2. 如果测试失败，先修复失败的测试，不要添加新代码
3. 每次只做最小改动，每步都验证 \`pnpm test\` 通过
4. 避免一次添加多个测试文件或大量新代码
`;
}

/** Remove the Excel failure record after a successful evolution. */
export function clearExcelFailureContext(taskId: string): void {
  try {
    const path = getFailurePath(taskId);
    if (existsSync(path)) {
      unlinkSync(path);
      log.info("Excel failure context cleared after success", { taskId });
    }
  } catch {
    // Non-fatal
  }
}

/** Return the current Excel failure count for a task (0 if none). */
export function getExcelFailureCount(taskId: string): number {
  return loadExcelFailureRecord(taskId)?.failureCount ?? 0;
}
