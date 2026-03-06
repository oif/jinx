/**
 * Evolution Circuit Breaker
 *
 * Prevents API credit waste when evolutions are consistently failing.
 * Tracks consecutive failures and pauses evolution for 2 hours if >=3
 * consecutive failures are detected.
 *
 * State is persisted to data/circuit-breaker.json so it survives restarts.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";
import { DATA_DIR } from "../supervisor/paths.js";

const CIRCUIT_BREAKER_PATH = join(DATA_DIR, "circuit-breaker.json");

export const CONSECUTIVE_FAILURE_THRESHOLD = 3;
export const PAUSE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface CircuitBreakerState {
  /** Number of consecutive failures since last success */
  consecutiveFailures: number;
  /** ISO timestamp when the pause ends; null if not paused */
  pausedUntil: string | null;
  /** ISO timestamp of the last failure */
  lastFailureAt: string | null;
  /** ISO timestamp when the circuit was opened (tripped) */
  openedAt: string | null;
}

const DEFAULT_STATE: CircuitBreakerState = {
  consecutiveFailures: 0,
  pausedUntil: null,
  lastFailureAt: null,
  openedAt: null,
};

export function loadCircuitBreakerState(): CircuitBreakerState {
  try {
    if (existsSync(CIRCUIT_BREAKER_PATH)) {
      const raw = JSON.parse(readFileSync(CIRCUIT_BREAKER_PATH, "utf-8"));
      return { ...DEFAULT_STATE, ...raw };
    }
  } catch (e) {
    log.warn("Failed to load circuit breaker state", { error: (e as Error).message });
  }
  return { ...DEFAULT_STATE };
}

export function saveCircuitBreakerState(state: CircuitBreakerState): void {
  try {
    writeFileSync(CIRCUIT_BREAKER_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    log.warn("Failed to save circuit breaker state", { error: (e as Error).message });
  }
}

/**
 * Check if the circuit breaker is currently open (evolution is paused).
 * Returns remaining pause duration in ms, or 0 if evolution is allowed.
 *
 * Side effect: automatically resets the circuit if the pause has expired.
 */
export function getCircuitBreakerPauseMs(): number {
  const state = loadCircuitBreakerState();
  if (!state.pausedUntil) return 0;

  const now = Date.now();
  const pausedUntil = new Date(state.pausedUntil).getTime();
  const remaining = pausedUntil - now;

  if (remaining <= 0) {
    // Cooldown expired → auto-reset
    log.info("Circuit breaker cooldown expired, auto-recovering", {
      openedAt: state.openedAt,
    });
    const recovered: CircuitBreakerState = {
      ...DEFAULT_STATE,
    };
    saveCircuitBreakerState(recovered);
    return 0;
  }

  return remaining;
}

/**
 * Record a failure. Increments the consecutive failure counter.
 * Returns whether the circuit breaker was just tripped (first time reaching threshold)
 * and the updated consecutive failure count.
 */
export function recordCircuitFailure(): {
  tripped: boolean;
  consecutiveFailures: number;
  pausedUntil: string | null;
} {
  const state = loadCircuitBreakerState();
  state.consecutiveFailures++;
  state.lastFailureAt = new Date().toISOString();

  let tripped = false;

  // Only open the circuit if it isn't already open
  if (state.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD && !state.pausedUntil) {
    const pausedUntil = new Date(Date.now() + PAUSE_DURATION_MS).toISOString();
    state.pausedUntil = pausedUntil;
    state.openedAt = new Date().toISOString();
    tripped = true;

    log.warn("Circuit breaker OPEN: evolution paused due to consecutive failures", {
      consecutiveFailures: state.consecutiveFailures,
      pausedUntil,
      threshold: CONSECUTIVE_FAILURE_THRESHOLD,
    });
  }

  saveCircuitBreakerState(state);

  return {
    tripped,
    consecutiveFailures: state.consecutiveFailures,
    pausedUntil: state.pausedUntil,
  };
}

/**
 * Record a success — resets the consecutive failure counter and closes the circuit.
 */
export function recordCircuitSuccess(): void {
  const state = loadCircuitBreakerState();

  if (state.consecutiveFailures > 0 || state.pausedUntil) {
    log.info("Circuit breaker reset after successful evolution", {
      previousConsecutiveFailures: state.consecutiveFailures,
    });
  }

  saveCircuitBreakerState({ ...DEFAULT_STATE });
}

/**
 * Format a human-readable circuit breaker status message.
 */
export function formatCircuitBreakerAlert(
  pausedUntil: string,
  consecutiveFailures: number
): string {
  const resumeAt = new Date(pausedUntil);
  const resumeStr = resumeAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    `🚨 *Circuit Breaker Tripped!*\n\n` +
    `Evolution has been *paused for 2 hours* due to ${consecutiveFailures} consecutive failures.\n\n` +
    `⏰ Resumes automatically at: ${resumeStr}\n` +
    `💡 Reason: Preventing API credit waste on repeatedly failing cycles.\n` +
    `🔧 Check logs for root cause before resuming.`
  );
}
