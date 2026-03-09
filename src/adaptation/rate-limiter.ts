/**
 * Advanced Rate Limit Handler
 * 
 * Implements P5 (Adapt to constraints) with:
 * 1. Global rate limit state management
 * 2. Intelligent exponential backoff with jitter
 * 3. API usage tracking and prediction
 * 4. Degradation strategy (fallback to built-in tools)
 * 5. Rate limit event monitoring and alerting
 * 
 * @module adaptation/rate-limiter
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../util/log.js";

// ── Types ──────────────────────────────────────────────────────────

export interface RateLimitState {
  /** Provider identifier (e.g., 'claude', 'openai', 'github') */
  provider: string;
  /** Whether currently rate-limited */
  isLimited: boolean;
  /** When rate limit was triggered */
  limitedAt?: string;
  /** When rate limit will expire (estimated) */
  resetAt?: string;
  /** Number of consecutive rate limit hits */
  consecutiveHits: number;
  /** Current backoff delay in ms */
  currentBackoffMs: number;
  /** Total requests in current window */
  requestCount: number;
  /** Window start time */
  windowStart: string;
  /** Historical rate limit events */
  events: RateLimitEvent[];
}

export interface RateLimitEvent {
  timestamp: string;
  provider: string;
  errorType: string;
  retryAfter?: number;
  backoffMs: number;
  recovered?: boolean;
}

export interface ProviderConfig {
  /** Provider identifier */
  provider: string;
  /** Requests per minute limit (if known) */
  requestsPerMinute?: number;
  /** Requests per hour limit (if known) */
  requestsPerHour?: number;
  /** Initial backoff delay in ms */
  initialBackoffMs: number;
  /** Maximum backoff delay in ms */
  maxBackoffMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Jitter factor (0-1, adds randomness) */
  jitterFactor: number;
  /** Max retries before giving up */
  maxRetries: number;
  /** Fallback provider if available */
  fallbackProvider?: string;
}

export interface UsagePrediction {
  provider: string;
  currentUsage: number;
  predictedLimitHit: boolean;
  minutesToLimit?: number;
  confidence: number;
}

export interface RateLimitAlert {
  type: "rate_limit_hit" | "limit_approaching" | "backoff_extended" | "degradation_active";
  provider: string;
  message: string;
  severity: "warning" | "critical" | "info";
  timestamp: string;
  data?: Record<string, unknown>;
}

export type RateLimitListener = (alert: RateLimitAlert) => void;

// ── Default Configurations ─────────────────────────────────────────

const DEFAULT_CONFIGS: Record<string, ProviderConfig> = {
  "claude": {
    provider: "claude",
    requestsPerMinute: 60,
    initialBackoffMs: 5_000,
    maxBackoffMs: 300_000, // 5 minutes
    backoffMultiplier: 2,
    jitterFactor: 0.2,
    maxRetries: 5,
  },
  "claude-code": {
    provider: "claude-code",
    requestsPerMinute: 30,
    initialBackoffMs: 30_000,
    maxBackoffMs: 300_000,
    backoffMultiplier: 2,
    jitterFactor: 0.3,
    maxRetries: 4,
    fallbackProvider: "built-in",
  },
  "openai": {
    provider: "openai",
    requestsPerMinute: 500,
    initialBackoffMs: 1_000,
    maxBackoffMs: 60_000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    maxRetries: 5,
  },
  "github": {
    provider: "github",
    requestsPerHour: 5000,
    initialBackoffMs: 60_000,
    maxBackoffMs: 3600_000, // 1 hour
    backoffMultiplier: 1.5,
    jitterFactor: 0.1,
    maxRetries: 3,
  },
  "brave-search": {
    provider: "brave-search",
    requestsPerMinute: 2000,
    initialBackoffMs: 1_000,
    maxBackoffMs: 60_000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
    maxRetries: 3,
  },
};

// ── Rate Limit Manager ─────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const STATE_PATH = join(DATA_DIR, "rate-limit-state.json");

/**
 * Global Rate Limit Manager
 * 
 * Singleton that manages rate limit state across all providers.
 */
class RateLimitManager {
  private states: Map<string, RateLimitState> = new Map();
  private configs: Map<string, ProviderConfig> = new Map();
  private listeners: Set<RateLimitListener> = new Set();
  private degradationMode: boolean = false;
  private requestTimestamps: Map<string, number[]> = new Map();

  constructor() {
    // Load default configs
    for (const [key, config] of Object.entries(DEFAULT_CONFIGS)) {
      this.configs.set(key, config);
    }
    // Load persisted state
    this.loadState();
  }

  // ── State Management ─────────────────────────────────────────────

  private loadState(): void {
    try {
      if (existsSync(STATE_PATH)) {
        const data = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
        if (data.states) {
          for (const state of data.states) {
            this.states.set(state.provider, state);
          }
        }
        log.info("Rate limit state loaded", { 
          providers: Array.from(this.states.keys()) 
        });
      }
    } catch (e) {
      log.warn("Failed to load rate limit state", { 
        error: (e as Error).message 
      });
    }
  }

  private saveState(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = {
        lastUpdated: new Date().toISOString(),
        states: Array.from(this.states.values()),
      };
      writeFileSync(STATE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      log.error("Failed to save rate limit state", { 
        error: (e as Error).message 
      });
    }
  }

  private getOrCreateState(provider: string): RateLimitState {
    let state = this.states.get(provider);
    if (!state) {
      state = {
        provider,
        isLimited: false,
        consecutiveHits: 0,
        currentBackoffMs: 0,
        requestCount: 0,
        windowStart: new Date().toISOString(),
        events: [],
      };
      this.states.set(provider, state);
    }
    return state;
  }

  private getConfig(provider: string): ProviderConfig {
    // Try exact match first
    const config = this.configs.get(provider);
    if (config) return config;
    
    // Try partial match (e.g., "claude-code" matches "claude")
    for (const [key, cfg] of this.configs) {
      if (provider.includes(key) || key.includes(provider)) {
        return cfg;
      }
    }
    
    // Return default config
    return {
      provider,
      initialBackoffMs: 10_000,
      maxBackoffMs: 120_000,
      backoffMultiplier: 2,
      jitterFactor: 0.2,
      maxRetries: 3,
    };
  }

  // ── Rate Limit Detection ─────────────────────────────────────────

  /**
   * Check if an error indicates a rate limit
   */
  isRateLimitError(error: Error & { status?: number; stderr?: string }): boolean {
    const msg = (error.stderr || error.message || "").toLowerCase();
    const status = error.status;
    
    return (
      status === 429 ||
      status === 529 ||
      msg.includes("rate limit") ||
      msg.includes("rate_limit") ||
      msg.includes("too many requests") ||
      msg.includes("overloaded") ||
      msg.includes("overload") ||
      msg.includes("quota") ||
      msg.includes("throttl") ||
      msg.includes("limit exceeded") ||
      msg.includes("slow down")
    );
  }

  /**
   * Extract retry-after from error if available
   */
  extractRetryAfter(error: Error & { headers?: Headers }): number | undefined {
    // Check for retry-after header
    if (error.headers) {
      const retryAfter = error.headers.get("retry-after");
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
    
    // Try to parse from error message
    const msg = error.message.toLowerCase();
    const match = msg.match(/retry.?after[:\s]+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10) * 1000;
    }
    
    return undefined;
  }

  // ── Backoff Algorithm ────────────────────────────────────────────

  /**
   * Calculate exponential backoff with jitter
   */
  calculateBackoff(provider: string, attempt: number): number {
    const config = this.getConfig(provider);
    const state = this.getOrCreateState(provider);
    
    // Base exponential backoff
    let backoffMs = config.initialBackoffMs * 
      Math.pow(config.backoffMultiplier, attempt);
    
    // Cap at max
    backoffMs = Math.min(backoffMs, config.maxBackoffMs);
    
    // Add jitter to prevent thundering herd
    const jitter = backoffMs * config.jitterFactor * Math.random();
    backoffMs = backoffMs + jitter;
    
    // Update state
    state.currentBackoffMs = backoffMs;
    
    return Math.floor(backoffMs);
  }

  /**
   * Get current wait time for a provider
   */
  getWaitTime(provider: string): number {
    const state = this.getOrCreateState(provider);
    
    if (!state.isLimited) return 0;
    
    if (state.resetAt) {
      const resetTime = new Date(state.resetAt).getTime();
      const now = Date.now();
      return Math.max(0, resetTime - now);
    }
    
    return state.currentBackoffMs;
  }

  /**
   * Check if should wait before making request
   */
  shouldWait(provider: string): { wait: boolean; ms: number } {
    const state = this.getOrCreateState(provider);
    
    if (!state.isLimited) {
      return { wait: false, ms: 0 };
    }
    
    const waitMs = this.getWaitTime(provider);
    return { wait: waitMs > 0, ms: waitMs };
  }

  // ── Rate Limit Event Handling ────────────────────────────────────

  /**
   * Record a rate limit hit
   */
  recordHit(
    provider: string, 
    error: Error & { status?: number; stderr?: string; headers?: Headers }
  ): void {
    const state = this.getOrCreateState(provider);
    const config = this.getConfig(provider);
    
    state.isLimited = true;
    state.limitedAt = new Date().toISOString();
    state.consecutiveHits++;
    
    // Calculate backoff
    const backoffMs = this.calculateBackoff(provider, state.consecutiveHits);
    
    // Try to get retry-after from error
    const retryAfter = this.extractRetryAfter(error);
    const effectiveBackoff = retryAfter ? Math.max(backoffMs, retryAfter) : backoffMs;
    
    // Set reset time
    state.resetAt = new Date(Date.now() + effectiveBackoff).toISOString();
    state.currentBackoffMs = effectiveBackoff;
    
    // Record event
    const event: RateLimitEvent = {
      timestamp: new Date().toISOString(),
      provider,
      errorType: error.status?.toString() || "unknown",
      retryAfter,
      backoffMs: effectiveBackoff,
    };
    state.events.push(event);
    
    // Keep only last 50 events
    state.events = state.events.slice(-50);
    
    this.saveState();
    
    // Emit alert
    this.emitAlert({
      type: "rate_limit_hit",
      provider,
      message: `Rate limit hit for ${provider}. Backoff: ${Math.round(effectiveBackoff / 1000)}s`,
      severity: state.consecutiveHits > 3 ? "critical" : "warning",
      timestamp: new Date().toISOString(),
      data: {
        consecutiveHits: state.consecutiveHits,
        backoffMs: effectiveBackoff,
        maxRetries: config.maxRetries,
      },
    });
    
    // Check if should enter degradation mode
    if (state.consecutiveHits >= config.maxRetries) {
      this.enterDegradationMode(provider);
    }
    
    log.warn("Rate limit hit recorded", {
      provider,
      consecutiveHits: state.consecutiveHits,
      backoffMs: effectiveBackoff,
    });
  }

  /**
   * Record successful request (rate limit recovery)
   */
  recordSuccess(provider: string): void {
    const state = this.getOrCreateState(provider);
    
    if (state.isLimited) {
      // Record recovery in last event
      const lastEvent = state.events[state.events.length - 1];
      if (lastEvent) {
        lastEvent.recovered = true;
      }
      
      this.emitAlert({
        type: "rate_limit_hit",
        provider,
        message: `Rate limit recovered for ${provider}`,
        severity: "info",
        timestamp: new Date().toISOString(),
      });
    }
    
    state.isLimited = false;
    state.limitedAt = undefined;
    state.resetAt = undefined;
    state.consecutiveHits = 0;
    state.currentBackoffMs = 0;
    
    // Track request for usage prediction
    this.trackRequest(provider);
    
    this.saveState();
  }

  /**
   * Track a request for usage prediction
   */
  private trackRequest(provider: string): void {
    const now = Date.now();
    let timestamps = this.requestTimestamps.get(provider) || [];
    
    // Add current timestamp
    timestamps.push(now);
    
    // Keep only last hour of timestamps
    const oneHourAgo = now - 3600_000;
    timestamps = timestamps.filter(t => t > oneHourAgo);
    
    this.requestTimestamps.set(provider, timestamps);
  }

  // ── Usage Prediction ─────────────────────────────────────────────

  /**
   * Predict if approaching rate limit
   */
  predictUsage(provider: string): UsagePrediction {
    const config = this.getConfig(provider);
    this.getOrCreateState(provider); // Ensure state exists
    const timestamps = this.requestTimestamps.get(provider) || [];
    
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3600_000;
    
    // Count recent requests
    const lastMinute = timestamps.filter(t => t > oneMinuteAgo).length;
    const lastHour = timestamps.filter(t => t > oneHourAgo).length;
    
    let currentUsage = 0;
    let predictedLimitHit = false;
    let minutesToLimit: number | undefined;
    let confidence = 0.5;
    
    if (config.requestsPerMinute) {
      currentUsage = lastMinute / config.requestsPerMinute;
      if (currentUsage > 0.7) {
        predictedLimitHit = true;
        minutesToLimit = Math.max(0, (1 - currentUsage) * config.requestsPerMinute! / (lastMinute || 1));
        confidence = 0.8;
      }
    }
    
    if (config.requestsPerHour) {
      const hourlyUsage = lastHour / config.requestsPerHour;
      if (hourlyUsage > currentUsage) {
        currentUsage = hourlyUsage;
      }
      if (hourlyUsage > 0.8) {
        predictedLimitHit = true;
        confidence = Math.max(confidence, 0.7);
      }
    }
    
    return {
      provider,
      currentUsage,
      predictedLimitHit,
      minutesToLimit,
      confidence,
    };
  }

  /**
   * Get all usage predictions
   */
  getAllPredictions(): UsagePrediction[] {
    const predictions: UsagePrediction[] = [];
    
    for (const provider of this.configs.keys()) {
      predictions.push(this.predictUsage(provider));
    }
    
    return predictions.sort((a, b) => b.currentUsage - a.currentUsage);
  }

  // ── Degradation Strategy ─────────────────────────────────────────

  /**
   * Enter degradation mode for a provider
   */
  private enterDegradationMode(provider: string): void {
    this.degradationMode = true;
    
    this.emitAlert({
      type: "degradation_active",
      provider,
      message: `Entering degradation mode for ${provider}. Will use fallback strategies.`,
      severity: "critical",
      timestamp: new Date().toISOString(),
      data: {
        fallbackProvider: this.getConfig(provider).fallbackProvider,
      },
    });
    
    log.warn("Degradation mode activated", { provider });
  }

  /**
   * Exit degradation mode
   */
  exitDegradationMode(): void {
    this.degradationMode = false;
    log.info("Degradation mode deactivated");
  }

  /**
   * Check if in degradation mode
   */
  isInDegradationMode(): boolean {
    return this.degradationMode;
  }

  /**
   * Get fallback strategy for a provider
   */
  getFallbackStrategy(provider: string): {
    strategy: "wait" | "fallback" | "queue" | "abort";
    waitMs?: number;
    fallbackProvider?: string;
  } {
    const config = this.getConfig(provider);
    const state = this.getOrCreateState(provider);
    
    // If consecutive hits < max retries, wait
    if (state.consecutiveHits < config.maxRetries) {
      return {
        strategy: "wait",
        waitMs: this.getWaitTime(provider),
      };
    }
    
    // If has fallback provider, use it
    if (config.fallbackProvider) {
      return {
        strategy: "fallback",
        fallbackProvider: config.fallbackProvider,
      };
    }
    
    // Otherwise, queue the request
    return {
      strategy: "queue",
    };
  }

  // ── Monitoring & Alerting ────────────────────────────────────────

  /**
   * Add a rate limit listener
   */
  addListener(listener: RateLimitListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an alert to all listeners
   */
  private emitAlert(alert: RateLimitAlert): void {
    for (const listener of this.listeners) {
      try {
        listener(alert);
      } catch (e) {
        log.error("Rate limit listener error", { 
          error: (e as Error).message 
        });
      }
    }
  }

  /**
   * Get current status for all providers
   */
  getStatus(): Record<string, {
    isLimited: boolean;
    consecutiveHits: number;
    currentBackoffMs: number;
    waitTimeMs: number;
    prediction: UsagePrediction;
  }> {
    const status: Record<string, ReturnType<typeof this.getStatus>[string]> = {};
    
    for (const [provider] of this.configs) {
      const state = this.getOrCreateState(provider);
      status[provider] = {
        isLimited: state.isLimited,
        consecutiveHits: state.consecutiveHits,
        currentBackoffMs: state.currentBackoffMs,
        waitTimeMs: this.getWaitTime(provider),
        prediction: this.predictUsage(provider),
      };
    }
    
    return status;
  }

  /**
   * Get recent rate limit events
   */
  getRecentEvents(limit: number = 20): RateLimitEvent[] {
    const events: RateLimitEvent[] = [];
    
    for (const state of this.states.values()) {
      events.push(...state.events);
    }
    
    return events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // ── Configuration ────────────────────────────────────────────────

  /**
   * Update provider configuration
   */
  setProviderConfig(config: ProviderConfig): void {
    this.configs.set(config.provider, config);
    log.info("Provider config updated", { provider: config.provider });
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(provider: string): ProviderConfig | undefined {
    return this.configs.get(provider);
  }

  /**
   * Clear all rate limit state (for testing)
   */
  clearState(): void {
    this.states.clear();
    this.requestTimestamps.clear();
    this.degradationMode = false;
    this.saveState();
  }
}

// ── Singleton Instance ─────────────────────────────────────────────

export const rateLimiter = new RateLimitManager();

// ── Convenience Functions ───────────────────────────────────────────

/**
 * Handle rate limit error with backoff and fallback
 * @returns true if should continue retrying, false if should abort
 */
async function handleRateLimitError<T>(
  provider: string,
  error: Error & { status?: number; stderr?: string },
  attempt: number,
  options?: {
    onRetry?: (attempt: number, backoffMs: number) => void;
    onFallback?: (strategy: string) => T | Promise<T>;
  }
): Promise<{ continue: boolean; result?: T }> {
  rateLimiter.recordHit(provider, error);
  
  const backoffMs = rateLimiter.calculateBackoff(provider, attempt);
  options?.onRetry?.(attempt + 1, backoffMs);
  
  const strategy = rateLimiter.getFallbackStrategy(provider);
  
  if (strategy.strategy === "fallback" && options?.onFallback) {
    return { 
      continue: false, 
      result: await options.onFallback(strategy.fallbackProvider || "built-in") 
    };
  }
  
  if (strategy.strategy === "abort") {
    throw new Error(
      `Rate limit exceeded for ${provider}. Max retries reached.`,
      { cause: error }
    );
  }
  
  // Wait before retry
  await new Promise(resolve => setTimeout(resolve, backoffMs));
  return { continue: true };
}

/**
 * Execute a function with rate limit handling
 */
export async function withRateLimit<T>(
  provider: string,
  fn: () => Promise<T>,
  options?: {
    onWait?: (ms: number) => void;
    onRetry?: (attempt: number, backoffMs: number) => void;
    onFallback?: (strategy: string) => T | Promise<T>;
  }
): Promise<T> {
  const config = rateLimiter.getProviderConfig(provider) || {
    provider,
    initialBackoffMs: 10_000,
    maxBackoffMs: 120_000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
    maxRetries: 3,
  };
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Check if we should wait
    const { wait, ms } = rateLimiter.shouldWait(provider);
    
    if (wait) {
      options?.onWait?.(ms);
      await new Promise(resolve => setTimeout(resolve, ms));
    }
    
    try {
      const result = await fn();
      rateLimiter.recordSuccess(provider);
      return result;
    } catch (e) {
      const error = e as Error & { status?: number; stderr?: string };
      
      if (rateLimiter.isRateLimitError(error)) {
        lastError = error;
        const handled = await handleRateLimitError(provider, error, attempt, options);
        if (!handled.continue) {
          return handled.result as T;
        }
        continue;
      }
      
      // Non-rate-limit error, rethrow
      throw e;
    }
  }
  
  throw lastError || new Error(`Rate limit exceeded for ${provider}`);
}

/**
 * Format rate limit status for display
 */
export function formatRateLimitStatus(): string {
  const status = rateLimiter.getStatus();
  const lines: string[] = [
    "📊 Rate Limit Status",
    "",
  ];
  
  for (const [provider, data] of Object.entries(status)) {
    const icon = data.isLimited ? "🔴" : "🟢";
    const usage = Math.round(data.prediction.currentUsage * 100);
    const usageBar = "█".repeat(Math.floor(usage / 10)) + "░".repeat(10 - Math.floor(usage / 10));
    
    lines.push(`${icon} ${provider}`);
    lines.push(`   Usage: [${usageBar}] ${usage}%`);
    
    if (data.isLimited) {
      lines.push(`   Wait: ${Math.round(data.waitTimeMs / 1000)}s`);
      lines.push(`   Consecutive hits: ${data.consecutiveHits}`);
    }
    
    if (data.prediction.predictedLimitHit) {
      lines.push(`   ⚠️ Approaching limit!`);
    }
    
    lines.push("");
  }
  
  if (rateLimiter.isInDegradationMode()) {
    lines.push("⚠️ DEGRADATION MODE ACTIVE");
  }
  
  return lines.join("\n");
}

/**
 * Format rate limit events for display
 */
export function formatRateLimitEvents(limit: number = 10): string {
  const events = rateLimiter.getRecentEvents(limit);
  
  if (events.length === 0) {
    return "No rate limit events recorded.";
  }
  
  const lines: string[] = [
    "📝 Recent Rate Limit Events",
    "",
  ];
  
  for (const event of events) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const backoff = Math.round(event.backoffMs / 1000);
    const recovered = event.recovered ? "✅ recovered" : "⏳ waiting";
    
    lines.push(`${time} | ${event.provider} | ${event.errorType} | ${backoff}s | ${recovered}`);
  }
  
  return lines.join("\n");
}