import { writeFileSync } from "node:fs";
import { log } from "../util/log.js";
import { readState, type State } from "../util/state.js";
import { recordEvolutionResult, loadRecentHistory, calculateEvolutionStats } from "./history.js";
import {
  startEvolutionProgress,
  setEvolutionStage,
  completeEvolutionProgress,
  failEvolutionProgress,
} from "./evolution-progress.js";

import { STATE_PATH } from "../supervisor/paths.js";
import { execSync } from "node:child_process";

// Empty cycle detection: files that don't count as "real work"
const METADATA_FILES = new Set([
  "data/scratchpad.md",
  "EVOLOG.md",
  "data/state.json",
]);

const META_EMPTY_INDICATORS = [
  "update EVOLOG",
  "update scratchpad",
  "update state",
  "fix EVOLOG",
  "update statistics",
];

/**
 * Check if the last commit was a "trivial" update (metadata only).
 * Returns true if the cycle should NOT count toward evolution stats.
 */
function isEmptyCycle(): boolean {
  try {
    // Get files changed in last commit
    const filesChanged = execSync("git diff HEAD~1 --name-only", { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter(f => f.length > 0);

    // If no files changed, it's empty
    if (filesChanged.length === 0) return true;

    // If all changes are to metadata files, it's empty
    const allMetadata = filesChanged.every(f => METADATA_FILES.has(f));
    if (allMetadata) return true;

    // Check commit message for empty indicators
    const commitMsg = execSync("git log -1 --pretty=%B", { encoding: "utf-8" }).toLowerCase();
    const hasEmptyIndicator = META_EMPTY_INDICATORS.some(indicator =>
      commitMsg.includes(indicator.toLowerCase())
    );
    if (hasEmptyIndicator) return true;

    return false;
  } catch {
    // If git commands fail, assume it's not empty (safer)
    return false;
  }
}

/** Track consecutive empty cycles */
let consecutiveEmptyCycles = 0;
const MAX_EMPTY_CYCLES_BEFORE_PAUSE = 3;

/**
 * Check if evolution should be auto-paused due to empty cycles.
 * Resets counter if this cycle has real work.
 */
function checkEmptyCyclePause(): boolean {
  if (isEmptyCycle()) {
    consecutiveEmptyCycles++;
    log.warn(`Empty cycle detected (${consecutiveEmptyCycles}/${MAX_EMPTY_CYCLES_BEFORE_PAUSE})`);

    if (consecutiveEmptyCycles >= MAX_EMPTY_CYCLES_BEFORE_PAUSE) {
      log.error(`Auto-pausing evolution: ${MAX_EMPTY_CYCLES_BEFORE_PAUSE} consecutive empty cycles`);
      return true;
    }
  } else {
    consecutiveEmptyCycles = 0;
  }
  return false;
}

// Consciousness loop interval: configurable via env, default 5 seconds
function getLoopIntervalMs(): number {
  const env = process.env.CONSCIOUSNESS_INTERVAL_SECONDS;
  if (env) {
    const seconds = parseFloat(env);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  }
  return 5 * 1000; // default: 5 seconds
}

type PromptFn = (message: string) => Promise<string>;
type NotifyFn = (message: string) => Promise<void>;

interface ConsciousnessHandle {
  triggerEvolution: () => void;
  stopEvolution: () => void;
  stop: () => void;
}

function saveState(patch: Partial<State>): void {
  const current = readState();
  const updated = { ...current, ...patch };
  writeFileSync(STATE_PATH, JSON.stringify(updated, null, 2));
}

export function startConsciousness(
  promptFn: PromptFn,
  notifyFn: NotifyFn,
  isAgentBusy: () => boolean,
): ConsciousnessHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let evolutionEnabled = readState().evolutionEnabled;

  async function tick(): Promise<void> {
    if (running || isAgentBusy()) {
      scheduleNext();
      return;
    }

    running = true;
    try {
      if (evolutionEnabled) {
        await runEvolutionCycle(promptFn, notifyFn);
      } else {
        await runConsciousnessCheck(promptFn);
      }
    } catch (e) {
      const err = e as Error;
      log.error("Consciousness tick failed", { error: err.message });
    } finally {
      running = false;
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, getLoopIntervalMs());
  }

  // Start the loop
  scheduleNext();
  const intervalMs = getLoopIntervalMs();
  log.info("Consciousness loop started", { interval: intervalMs, seconds: +(intervalMs / 1000).toFixed(1) });

  return {
    triggerEvolution: () => {
      evolutionEnabled = true;
      saveState({ evolutionEnabled: true });
      log.info("Evolution mode enabled");
      // Trigger immediately instead of waiting for next tick
      if (!running && !isAgentBusy()) {
        if (timer) clearTimeout(timer);
        tick();
      }
    },
    stopEvolution: () => {
      evolutionEnabled = false;
      saveState({ evolutionEnabled: false });
      log.info("Evolution mode disabled");
    },
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      log.info("Consciousness loop stopped");
    },
  };
}

async function runEvolutionCycle(promptFn: PromptFn, notifyFn: NotifyFn): Promise<void> {
  const state = readState();
  const cycle = state.cycle + 1;
  const startTime = Date.now();

  // Check for empty cycle pause BEFORE starting
  if (checkEmptyCyclePause()) {
    await notifyFn(
      `⚠️ Evolution auto-paused after ${MAX_EMPTY_CYCLES_BEFORE_PAUSE} empty cycles. ` +
      `Last changes were only metadata updates. Please review and re-enable evolution manually.`
    );
    // Disable evolution in state
    saveState({ evolutionEnabled: false });
    return;
  }

  log.info(`Evolution cycle #${cycle} starting`);

  // Start tracking progress
  startEvolutionProgress(cycle);
  setEvolutionStage("evaluating", "Analyzing codebase for improvements");

  try {
    setEvolutionStage("implementing", "Executing evolution cycle");

    // Get recent history for context (memory-efficient: only loads last 3)
    const recentHistory = loadRecentHistory(3);
    const stats = calculateEvolutionStats();

    const result = await promptFn(
      `这是你第 ${cycle} 次进化循环。\n\n` +
      `【进化历史】\n` +
      `- 总循环: ${stats.totalCycles} | 成功: ${stats.successfulCycles} | 当前连胜: ${stats.currentStreak}\n` +
      `- 最近3次: ${recentHistory.map(h => `#${h.cycle} ${h.status}`).join(", ") || "无"}\n\n` +
      `按照 BORN.md 中的进化循环执行：\n` +
      `1. 评估 —— 查看 codebase，找出最有价值的改进\n` +
      `2. 选择 —— 选一件事（只选一件）\n` +
      `3. 实现 —— 完整实现 + 测试\n` +
      `4. 提交 —— git commit，版本递增\n` +
      `5. 汇报 —— 告诉我我做了什么\n\n` +
      `【重要】空循环检测已启用：\n` +
      `如果本次循环只修改了 scratchpad.md 或元数据文件，将被标记为空循环。\n` +
      `连续 ${MAX_EMPTY_CYCLES_BEFORE_PAUSE} 次空循环会自动暂停进化。\n\n` +
      `【重要】进度汇报要求：\n` +
      `在每个阶段完成后，必须使用 send_owner_message 工具向创造者发送进度更新：\n` +
      `- 评估完成后: "🧬 Evolution #${cycle} - 评估完成：找到 X 个改进点"\n` +
      `- 选择完成后: "🧬 Evolution #${cycle} - 选择完成：决定做 XXX"\n` +
      `- 实现完成后: "🧬 Evolution #${cycle} - 实现完成：已修改 XXX 文件"\n` +
      `- 验证完成后: "🧬 Evolution #${cycle} - 验证完成：测试通过"\n` +
      `- 提交完成后: "🧬 Evolution #${cycle} - 提交完成：版本 X.X.X"\n` +
      `- 最终汇报结果\n\n` +
      `执行完成后，必须发送一条文本消息汇报最终结果。`
    );

    const durationMs = Date.now() - startTime;

    setEvolutionStage("committing", "Saving changes and updating records");

    saveState({
      cycle,
      lastEvolution: new Date().toISOString(),
    });

    // Record successful evolution
    const summary = result.slice(0, 200);
    recordEvolutionResult(cycle, state.version, "success", summary, durationMs);
    completeEvolutionProgress(durationMs);

    log.info(`Evolution cycle #${cycle} completed`, { durationMs });

    // Notify creator with a summary
    const notifySummary = result.length > 500 ? result.slice(0, 500) + "..." : result;
    await notifyFn(`🧬 Evolution #${cycle} complete:\n${notifySummary}`);
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - startTime;

    // Record failed evolution
    recordEvolutionResult(cycle, state.version, "failed", err.message, durationMs);
    failEvolutionProgress(err.message);

    log.error(`Evolution cycle #${cycle} failed`, { error: err.message, durationMs });
    await notifyFn(`❌ Evolution #${cycle} failed: ${err.message}`);
  }
}

import { recordHealthSnapshot } from "../health/history.js";

async function runConsciousnessCheck(promptFn: PromptFn): Promise<void> {
  log.info("Consciousness check");
  try {
    // Record health stats quietly in the background
    await recordHealthSnapshot();

    await promptFn(
      "Wake up. Briefly check your state: " +
      "read identity.md and scratchpad.md, " +
      "note anything worth acting on, " +
      "update scratchpad if needed. " +
      "Keep it short — this is a routine check, not a deep dive."
    );
  } catch (e) {
    const err = e as Error;
    log.error("Consciousness check failed", { error: err.message });
  }
}
