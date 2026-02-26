import { writeFileSync } from "node:fs";
import { log } from "../util/log.js";
import { readState, type State } from "../util/state.js";
import { recordEvolutionResult } from "./history.js";
import { STATE_PATH } from "../supervisor/paths.js";

// Consciousness loop interval: configurable via env, default 3 minutes
function getLoopIntervalMs(): number {
  const env = process.env.CONSCIOUSNESS_INTERVAL_MINUTES;
  if (env) {
    const minutes = parseFloat(env);
    if (!isNaN(minutes) && minutes > 0) {
      return Math.round(minutes * 60 * 1000);
    }
  }
  return 3 * 60 * 1000; // default: 3 minutes
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
  log.info("Consciousness loop started", { interval: intervalMs, minutes: +(intervalMs / 60000).toFixed(1) });

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

  log.info(`Evolution cycle #${cycle} starting`);

  try {
    const result = await promptFn(
      `这是你第 ${cycle} 次进化循环。\n\n` +
      `按照 BORN.md 中的进化循环执行：\n` +
      `1. 评估 —— 查看 codebase，找出最有价值的改进\n` +
      `2. 选择 —— 选一件事（只选一件）\n` +
      `3. 实现 —— 完整实现 + 测试\n` +
      `4. 提交 —— git commit，版本递增\n` +
      `5. 汇报 —— 告诉我我做了什么\n\n` +
      `重要：执行完成后，你必须发送一条文本消息汇报结果（即使只是说明为什么这次没有改动）。` +
      `不要只调用工具而不发送最终文本消息。`
    );

    const durationMs = Date.now() - startTime;

    saveState({
      cycle,
      lastEvolution: new Date().toISOString(),
    });

    // Record successful evolution
    const summary = result.slice(0, 200);
    recordEvolutionResult(cycle, state.version, "success", summary, durationMs);

    log.info(`Evolution cycle #${cycle} completed`, { durationMs });

    // Notify creator with a summary
    const notifySummary = result.length > 500 ? result.slice(0, 500) + "..." : result;
    await notifyFn(`🧬 Evolution #${cycle} complete:\n${notifySummary}`);
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - startTime;

    // Record failed evolution
    recordEvolutionResult(cycle, state.version, "failed", err.message, durationMs);

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
