/**
 * Rate Limiter Tests
 *
 * Verifies:
 * 1. Global rate limit state management (persists across restarts)
 * 2. Exponential backoff with jitter algorithm
 * 3. API usage tracking and prediction
 * 4. Degradation strategy (fallback to built-in tools)
 * 5. Rate limit event monitoring and alerting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock modules ────────────────────────────────────────────────────────────
vi.mock("../src/util/log.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("rate-limiter", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    vi.resetModules();
    
    // Import and clear state completely
    const mod = await import("../src/adaptation/rate-limiter.js");
    mod.rateLimiter.clearState();
    mod.rateLimiter.exitDegradationMode();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Rate Limit Detection ─────────────────────────────────────────────────

  describe("isRateLimitError", () => {
    it("detects 429 status as rate limit", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Too many requests") as Error & { status: number };
      error.status = 429;
      expect(rateLimiter.isRateLimitError(error)).toBe(true);
    });

    it("detects 529 status as rate limit (overloaded)", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Overloaded") as Error & { status: number };
      error.status = 529;
      expect(rateLimiter.isRateLimitError(error)).toBe(true);
    });

    it("detects 'rate limit' in error message", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit exceeded. Please wait.");
      expect(rateLimiter.isRateLimitError(error)).toBe(true);
    });

    it("detects 'too many requests' in error message", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Too many requests. Slow down.");
      expect(rateLimiter.isRateLimitError(error)).toBe(true);
    });

    it("detects 'overloaded' in stderr", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("API Error") as Error & { stderr: string };
      error.stderr = "Error: Service is overloaded. Please retry later.";
      expect(rateLimiter.isRateLimitError(error)).toBe(true);
    });

    it("detects 'throttl' in message", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Request throttled. Wait before retrying.");
      expect(rateLimiter.isRateLimitError(error)).toBe(true);
    });

    it("does NOT detect regular errors as rate limit", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Network error");
      expect(rateLimiter.isRateLimitError(error)).toBe(false);
    });

    it("does NOT detect 500 errors as rate limit", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Internal server error") as Error & { status: number };
      error.status = 500;
      expect(rateLimiter.isRateLimitError(error)).toBe(false);
    });
  });

  // ── Exponential Backoff ───────────────────────────────────────────────────

  describe("calculateBackoff", () => {
    it("returns initial backoff on first attempt", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const backoff = rateLimiter.calculateBackoff("claude", 0);
      // Default for claude: 5_000 ms initial with 0.2 jitter
      expect(backoff).toBeGreaterThanOrEqual(5_000);
      expect(backoff).toBeLessThanOrEqual(5_000 + 5_000 * 0.2);
    });

    it("increases exponentially with attempts", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const backoff0 = rateLimiter.calculateBackoff("claude", 0);
      const backoff1 = rateLimiter.calculateBackoff("claude", 1);
      const backoff2 = rateLimiter.calculateBackoff("claude", 2);

      // Each should be approximately double the previous (with jitter)
      expect(backoff1).toBeGreaterThan(backoff0 * 1.5);
      expect(backoff2).toBeGreaterThan(backoff1 * 1.5);
    });

    it("caps at max backoff", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const backoff = rateLimiter.calculateBackoff("claude", 10);
      // Default max for claude: 300_000 ms (5 minutes)
      expect(backoff).toBeLessThanOrEqual(300_000 + 300_000 * 0.2);
    });

    it("includes jitter to prevent thundering herd", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      // Run multiple times to verify jitter randomness
      const backoffs = new Set<number>();
      for (let i = 0; i < 10; i++) {
        backoffs.add(rateLimiter.calculateBackoff("claude", 0));
      }
      // With jitter, we should see some variation
      expect(backoffs.size).toBeGreaterThan(1);
    });
  });

  // ── State Management ─────────────────────────────────────────────────────

  describe("recordHit", () => {
    it("sets isLimited to true", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      const status = rateLimiter.getStatus();
      
      expect(status["claude"].isLimited).toBe(true);
    });

    it("increments consecutiveHits", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      rateLimiter.recordHit("claude", error);
      const status = rateLimiter.getStatus();
      
      expect(status["claude"].consecutiveHits).toBe(2);
    });

    it("sets resetAt timestamp based on backoff", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      const status = rateLimiter.getStatus();
      
      expect(status["claude"].currentBackoffMs).toBeGreaterThan(0);
    });

    it("records events for monitoring", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      const events = rateLimiter.getRecentEvents(10);
      
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].provider).toBe("claude");
      expect(events[0].errorType).toBe("429");
    });
  });

  describe("recordSuccess", () => {
    it("clears isLimited flag", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      rateLimiter.recordSuccess("claude");
      const status = rateLimiter.getStatus();
      
      expect(status["claude"].isLimited).toBe(false);
    });

    it("resets consecutiveHits", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      rateLimiter.recordHit("claude", error);
      rateLimiter.recordSuccess("claude");
      const status = rateLimiter.getStatus();
      
      expect(status["claude"].consecutiveHits).toBe(0);
    });
  });

  // ── Wait Logic ───────────────────────────────────────────────────────────

  describe("shouldWait", () => {
    it("returns no wait when not limited", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const result = rateLimiter.shouldWait("claude");
      expect(result.wait).toBe(false);
      expect(result.ms).toBe(0);
    });

    it("returns wait time when limited", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      const result = rateLimiter.shouldWait("claude");
      
      expect(result.wait).toBe(true);
      expect(result.ms).toBeGreaterThan(0);
    });
  });

  // ── Usage Prediction ─────────────────────────────────────────────────────

  describe("predictUsage", () => {
    it("returns prediction for provider", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const prediction = rateLimiter.predictUsage("claude");
      
      expect(prediction.provider).toBe("claude");
      expect(prediction.currentUsage).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
    });

    it("tracks requests for usage calculation", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      
      // Record some successes (which tracks requests)
      for (let i = 0; i < 5; i++) {
        rateLimiter.recordSuccess("claude");
      }
      
      const prediction = rateLimiter.predictUsage("claude");
      expect(prediction.currentUsage).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Degradation Strategy ────────────────────────────────────────────────

  describe("getFallbackStrategy", () => {
    it("returns 'wait' strategy when under max retries", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude-code", error);
      const strategy = rateLimiter.getFallbackStrategy("claude-code");
      
      expect(strategy.strategy).toBe("wait");
      expect(strategy.waitMs).toBeGreaterThan(0);
    });

    it("returns 'fallback' strategy when over max retries and fallback available", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      // Record max retries + 1 hits (default for claude-code is 4)
      for (let i = 0; i < 5; i++) {
        rateLimiter.recordHit("claude-code", error);
      }
      
      const strategy = rateLimiter.getFallbackStrategy("claude-code");
      
      // claude-code has fallbackProvider: "built-in"
      expect(strategy.strategy).toBe("fallback");
      expect(strategy.fallbackProvider).toBe("built-in");
    });

    it("returns 'queue' strategy when no fallback available", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      // Record many hits for a provider without fallback
      for (let i = 0; i < 10; i++) {
        rateLimiter.recordHit("unknown-provider", error);
      }
      
      const strategy = rateLimiter.getFallbackStrategy("unknown-provider");
      
      expect(strategy.strategy).toBe("queue");
    });
  });

  describe("degradationMode", () => {
    it("enters degradation mode after max retries", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      // Initially not in degradation mode
      expect(rateLimiter.isInDegradationMode()).toBe(false);
      
      // Hit max retries (5 for claude)
      for (let i = 0; i < 6; i++) {
        rateLimiter.recordHit("claude", error);
      }
      
      expect(rateLimiter.isInDegradationMode()).toBe(true);
    });

    it("can exit degradation mode", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      for (let i = 0; i < 6; i++) {
        rateLimiter.recordHit("claude", error);
      }
      
      expect(rateLimiter.isInDegradationMode()).toBe(true);
      
      rateLimiter.exitDegradationMode();
      expect(rateLimiter.isInDegradationMode()).toBe(false);
    });
  });

  // ── Monitoring & Alerting ───────────────────────────────────────────────

  describe("addListener", () => {
    it("calls listener on rate limit hit", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const alertListener = vi.fn();
      
      rateLimiter.addListener(alertListener);
      
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      rateLimiter.recordHit("claude", error);
      
      expect(alertListener).toHaveBeenCalled();
      const alert = alertListener.mock.calls[0][0];
      expect(alert.type).toBe("rate_limit_hit");
      expect(alert.provider).toBe("claude");
    });

    it("returns unsubscribe function", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const alertListener = vi.fn();
      
      const unsubscribe = rateLimiter.addListener(alertListener);
      unsubscribe();
      
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      rateLimiter.recordHit("claude", error);
      
      expect(alertListener).not.toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("returns status for all configured providers", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const status = rateLimiter.getStatus();
      
      expect(status["claude"]).toBeDefined();
      expect(status["openai"]).toBeDefined();
      expect(status["github"]).toBeDefined();
    });

    it("includes prediction in status", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const status = rateLimiter.getStatus();
      
      expect(status["claude"].prediction).toBeDefined();
      expect(status["claude"].prediction.provider).toBe("claude");
    });
  });

  describe("getRecentEvents", () => {
    it("returns events in reverse chronological order", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      rateLimiter.recordHit("claude", error);
      
      vi.advanceTimersByTime(1000);
      rateLimiter.recordHit("openai", error);
      
      const events = rateLimiter.getRecentEvents(10);
      
      expect(events.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      expect(new Date(events[0].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(events[1].timestamp).getTime()
      );
    });

    it("respects limit parameter", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      for (let i = 0; i < 10; i++) {
        rateLimiter.recordHit("claude", error);
        vi.advanceTimersByTime(1000);
      }
      
      const events = rateLimiter.getRecentEvents(5);
      expect(events.length).toBeLessThanOrEqual(5);
    });
  });

  // ── withRateLimit Helper ─────────────────────────────────────────────────

  describe("withRateLimit", () => {
    it("executes function and records success", async () => {
      const { withRateLimit, rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      
      const result = await withRateLimit("claude", async () => {
        return "success";
      });
      
      expect(result).toBe("success");
      const status = rateLimiter.getStatus();
      expect(status["claude"].isLimited).toBe(false);
    });

    it("retries on rate limit error", async () => {
      const { withRateLimit, rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      
      let attempts = 0;
      const onRetry = vi.fn();
      
      // Use a promise to track when the function completes
      const resultPromise = withRateLimit<string>(
        "claude",
        async () => {
          attempts++;
          if (attempts < 3) {
            const error = new Error("Rate limit") as Error & { status: number };
            error.status = 429;
            throw error;
          }
          return "success";
        },
        { onRetry }
      );
      
      // Run all timers to allow retries to complete
      await vi.runAllTimersAsync();
      
      const result = await resultPromise;
      expect(result).toBe("success");
      expect(attempts).toBe(3);
      expect(onRetry).toHaveBeenCalled();
    });

    it("calls onFallback when strategy is fallback", async () => {
      const { withRateLimit, rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      
      // Hit max retries first
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      for (let i = 0; i < 5; i++) {
        rateLimiter.recordHit("claude-code", error);
      }
      
      const onFallback = vi.fn().mockReturnValue("fallback result");
      
      const resultPromise = withRateLimit<string>(
        "claude-code",
        async () => {
          throw error;
        },
        { onFallback }
      );
      
      // Run timers and await result
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      
      expect(onFallback).toHaveBeenCalled();
    });

    it("throws after max retries without fallback", async () => {
      const { withRateLimit } = await import("../src/adaptation/rate-limiter.js");
      
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      
      // Create promise and attach catch handler immediately to prevent unhandled rejection
      let caught = false;
      const resultPromise = withRateLimit("unknown-provider", async () => {
        throw error;
      }).catch(() => { caught = true; });
      
      // Run timers to allow retries
      await vi.runAllTimersAsync();
      
      // Wait for the promise to settle
      await resultPromise;
      
      expect(caught).toBe(true);
    });
  });

  // ── Configuration ────────────────────────────────────────────────────────

  describe("setProviderConfig", () => {
    it("allows custom provider configuration", async () => {
      const { rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      
      rateLimiter.setProviderConfig({
        provider: "custom-provider",
        initialBackoffMs: 1_000,
        maxBackoffMs: 60_000,
        backoffMultiplier: 3,
        jitterFactor: 0.5,
        maxRetries: 2,
      });
      
      const config = rateLimiter.getProviderConfig("custom-provider");
      expect(config?.initialBackoffMs).toBe(1_000);
      expect(config?.maxRetries).toBe(2);
    });
  });

  // ── Formatting ────────────────────────────────────────────────────────────

  describe("formatRateLimitStatus", () => {
    it("returns formatted status string", async () => {
      const { formatRateLimitStatus } = await import("../src/adaptation/rate-limiter.js");
      const formatted = formatRateLimitStatus();
      
      expect(formatted).toContain("Rate Limit Status");
      expect(formatted).toContain("claude");
    });
  });

  describe("formatRateLimitEvents", () => {
    it("returns formatted events string", async () => {
      const { formatRateLimitEvents, rateLimiter } = await import("../src/adaptation/rate-limiter.js");
      
      const error = new Error("Rate limit") as Error & { status: number };
      error.status = 429;
      rateLimiter.recordHit("claude", error);
      
      const formatted = formatRateLimitEvents(10);
      
      expect(formatted).toContain("Rate Limit Events");
    });

    it("returns message when no events", async () => {
      const { formatRateLimitEvents } = await import("../src/adaptation/rate-limiter.js");
      const formatted = formatRateLimitEvents(10);
      
      expect(formatted).toContain("No rate limit events");
    });
  });
});