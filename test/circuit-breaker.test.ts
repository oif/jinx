/**
 * Circuit Breaker Tests
 *
 * Verifies:
 * 1. 3 consecutive failures → pause + alert triggered
 * 2. Non-consecutive failures don't trigger circuit
 * 3. Cooldown period ends and circuit auto-recovers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// ── Temp file path ──────────────────────────────────────────────────────────
const TEST_CIRCUIT_PATH = join("/tmp", "circuit-breaker.json");

// ── Mock modules ────────────────────────────────────────────────────────────
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/supervisor/paths.js", () => ({
  DATA_DIR: "/tmp",
  STATE_PATH: "/tmp/test-state.json",
}));

// ── Helper: clean up test state file ────────────────────────────────────────
function cleanState(): void {
  try {
    if (existsSync(TEST_CIRCUIT_PATH)) unlinkSync(TEST_CIRCUIT_PATH);
  } catch {}
}

function writeState(state: object): void {
  writeFileSync(TEST_CIRCUIT_PATH, JSON.stringify(state, null, 2));
}

function readState(): object {
  return JSON.parse(readFileSync(TEST_CIRCUIT_PATH, "utf-8"));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("circuit-breaker", () => {
  beforeEach(() => {
    cleanState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanState();
  });

  // ── loadCircuitBreakerState ─────────────────────────────────────────────

  describe("loadCircuitBreakerState", () => {
    it("returns default state when file does not exist", async () => {
      const { loadCircuitBreakerState } = await import("../src/consciousness/circuit-breaker.js");
      const state = loadCircuitBreakerState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.pausedUntil).toBeNull();
      expect(state.openedAt).toBeNull();
    });

    it("returns persisted state when file exists", async () => {
      writeState({ consecutiveFailures: 2, pausedUntil: null, lastFailureAt: "2026-01-01T11:00:00Z", openedAt: null });
      const { loadCircuitBreakerState } = await import("../src/consciousness/circuit-breaker.js");
      const state = loadCircuitBreakerState();
      expect(state.consecutiveFailures).toBe(2);
    });
  });

  // ── getCircuitBreakerPauseMs ────────────────────────────────────────────

  describe("getCircuitBreakerPauseMs", () => {
    it("returns 0 when circuit is not paused", async () => {
      const { getCircuitBreakerPauseMs } = await import("../src/consciousness/circuit-breaker.js");
      expect(getCircuitBreakerPauseMs()).toBe(0);
    });

    it("returns remaining ms when circuit is open and pause has not expired", async () => {
      // Pause until 1 hour from now
      const pausedUntil = new Date("2026-01-01T13:00:00Z").toISOString();
      writeState({ consecutiveFailures: 3, pausedUntil, lastFailureAt: null, openedAt: null });
      const { getCircuitBreakerPauseMs } = await import("../src/consciousness/circuit-breaker.js");
      const remaining = getCircuitBreakerPauseMs();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it("returns 0 and auto-resets when pause has expired", async () => {
      // Pause expired 1 hour ago
      const pausedUntil = new Date("2026-01-01T11:00:00Z").toISOString();
      writeState({ consecutiveFailures: 3, pausedUntil, lastFailureAt: null, openedAt: "2026-01-01T09:00:00Z" });
      const { getCircuitBreakerPauseMs } = await import("../src/consciousness/circuit-breaker.js");
      const remaining = getCircuitBreakerPauseMs();
      expect(remaining).toBe(0);

      // State should be reset after expiry
      const { loadCircuitBreakerState } = await import("../src/consciousness/circuit-breaker.js");
      const state = loadCircuitBreakerState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.pausedUntil).toBeNull();
    });
  });

  // ── recordCircuitFailure ────────────────────────────────────────────────

  describe("recordCircuitFailure", () => {
    it("increments consecutive failures on each call", async () => {
      const { recordCircuitFailure, loadCircuitBreakerState } = await import(
        "../src/consciousness/circuit-breaker.js"
      );
      recordCircuitFailure();
      expect(loadCircuitBreakerState().consecutiveFailures).toBe(1);

      recordCircuitFailure();
      expect(loadCircuitBreakerState().consecutiveFailures).toBe(2);
    });

    it("does NOT trip the circuit on first 2 failures", async () => {
      const { recordCircuitFailure } = await import("../src/consciousness/circuit-breaker.js");
      const r1 = recordCircuitFailure();
      expect(r1.tripped).toBe(false);

      const r2 = recordCircuitFailure();
      expect(r2.tripped).toBe(false);
      expect(r2.pausedUntil).toBeNull();
    });

    it("trips circuit on 3rd consecutive failure", async () => {
      const { recordCircuitFailure } = await import("../src/consciousness/circuit-breaker.js");
      recordCircuitFailure();
      recordCircuitFailure();
      const r3 = recordCircuitFailure();

      expect(r3.tripped).toBe(true);
      expect(r3.consecutiveFailures).toBe(3);
      expect(r3.pausedUntil).not.toBeNull();
    });

    it("circuit is paused for approximately 2 hours when tripped", async () => {
      const { recordCircuitFailure } = await import("../src/consciousness/circuit-breaker.js");
      recordCircuitFailure();
      recordCircuitFailure();
      const r3 = recordCircuitFailure();

      const pausedUntil = new Date(r3.pausedUntil!).getTime();
      const now = Date.now();
      const diffMs = pausedUntil - now;
      const twoHoursMs = 2 * 60 * 60 * 1000;

      // Should be within 1 second of exactly 2 hours
      expect(diffMs).toBeGreaterThanOrEqual(twoHoursMs - 1000);
      expect(diffMs).toBeLessThanOrEqual(twoHoursMs + 1000);
    });

    it("does NOT trip again on 4th+ failure when already open", async () => {
      const { recordCircuitFailure } = await import("../src/consciousness/circuit-breaker.js");
      recordCircuitFailure();
      recordCircuitFailure();
      const r3 = recordCircuitFailure(); // trips
      const r4 = recordCircuitFailure(); // already open

      expect(r3.tripped).toBe(true);
      expect(r4.tripped).toBe(false);   // not re-tripped
      expect(r4.consecutiveFailures).toBe(4);
    });
  });

  // ── recordCircuitSuccess ────────────────────────────────────────────────

  describe("recordCircuitSuccess", () => {
    it("resets consecutive failures to 0", async () => {
      const { recordCircuitFailure, recordCircuitSuccess, loadCircuitBreakerState } = await import(
        "../src/consciousness/circuit-breaker.js"
      );
      recordCircuitFailure();
      recordCircuitFailure();
      recordCircuitSuccess();

      const state = loadCircuitBreakerState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.pausedUntil).toBeNull();
    });

    it("clears the pause when circuit was open", async () => {
      writeState({
        consecutiveFailures: 3,
        pausedUntil: new Date("2026-01-01T14:00:00Z").toISOString(),
        lastFailureAt: null,
        openedAt: "2026-01-01T12:00:00Z",
      });
      const { recordCircuitSuccess, loadCircuitBreakerState } = await import(
        "../src/consciousness/circuit-breaker.js"
      );
      recordCircuitSuccess();

      const state = loadCircuitBreakerState();
      expect(state.pausedUntil).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  // ── Non-consecutive failure scenario ────────────────────────────────────

  describe("non-consecutive failures", () => {
    it("resets counter after a success — two failures before do not trigger circuit", async () => {
      const { recordCircuitFailure, recordCircuitSuccess, loadCircuitBreakerState } = await import(
        "../src/consciousness/circuit-breaker.js"
      );
      // 2 failures then 1 success then 2 more failures = only 2 consecutive, no trip
      recordCircuitFailure();
      recordCircuitFailure();
      recordCircuitSuccess(); // reset

      const r1 = recordCircuitFailure();
      const r2 = recordCircuitFailure();

      expect(r1.tripped).toBe(false);
      expect(r2.tripped).toBe(false);
      expect(loadCircuitBreakerState().consecutiveFailures).toBe(2);
      expect(loadCircuitBreakerState().pausedUntil).toBeNull();
    });

    it("requires exactly 3 consecutive failures with no successes in between to trip", async () => {
      const { recordCircuitFailure, recordCircuitSuccess } = await import(
        "../src/consciousness/circuit-breaker.js"
      );
      // Pattern: F F S F F S F F — never reaches 3 consecutive
      recordCircuitFailure();
      recordCircuitFailure();
      recordCircuitSuccess();
      const afterSecondPair1 = recordCircuitFailure();
      const afterSecondPair2 = recordCircuitFailure();
      recordCircuitSuccess();
      const afterThirdPair1 = recordCircuitFailure();
      const afterThirdPair2 = recordCircuitFailure();

      expect(afterSecondPair1.tripped).toBe(false);
      expect(afterSecondPair2.tripped).toBe(false);
      expect(afterThirdPair1.tripped).toBe(false);
      expect(afterThirdPair2.tripped).toBe(false);
    });
  });

  // ── Cooldown auto-recovery ───────────────────────────────────────────────

  describe("cooldown auto-recovery", () => {
    it("auto-recovers when 2-hour cooldown expires", async () => {
      const { recordCircuitFailure, getCircuitBreakerPauseMs, loadCircuitBreakerState } = await import(
        "../src/consciousness/circuit-breaker.js"
      );

      // Trip the circuit
      recordCircuitFailure();
      recordCircuitFailure();
      recordCircuitFailure();

      // Verify it's paused
      expect(getCircuitBreakerPauseMs()).toBeGreaterThan(0);

      // Advance time by 2 hours + 1 second
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);

      // Should now be recovered
      const remaining = getCircuitBreakerPauseMs();
      expect(remaining).toBe(0);

      const state = loadCircuitBreakerState();
      expect(state.consecutiveFailures).toBe(0);
      expect(state.pausedUntil).toBeNull();
    });

    it("after cooldown recovery, new failures can trip circuit again", async () => {
      const { recordCircuitFailure, getCircuitBreakerPauseMs } = await import(
        "../src/consciousness/circuit-breaker.js"
      );

      // Trip the circuit
      recordCircuitFailure();
      recordCircuitFailure();
      recordCircuitFailure();

      // Advance past cooldown
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);
      getCircuitBreakerPauseMs(); // triggers auto-reset

      // New 3 consecutive failures should trip again
      recordCircuitFailure();
      recordCircuitFailure();
      const r3 = recordCircuitFailure();

      expect(r3.tripped).toBe(true);
      expect(r3.pausedUntil).not.toBeNull();
    });
  });

  // ── formatCircuitBreakerAlert ───────────────────────────────────────────

  describe("formatCircuitBreakerAlert", () => {
    it("generates a human-readable alert message", async () => {
      const { formatCircuitBreakerAlert } = await import("../src/consciousness/circuit-breaker.js");
      const pausedUntil = new Date("2026-01-01T14:00:00Z").toISOString();
      const message = formatCircuitBreakerAlert(pausedUntil, 3);

      expect(message).toContain("Circuit Breaker");
      expect(message).toContain("2 hours");
      expect(message).toContain("3");
    });
  });
});
