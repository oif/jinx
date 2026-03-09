/**
 * Auto Evolution - Automatic evolution cycle triggering with safety constraints
 *
 * This module implements the "evolution-automation" capability from CAPABILITIES.md.
 * It provides:
 * - Configurable evolution intervals (default: 1 hour)
 * - Endure check (system health check before evolution)
 * - Enable/disable switch via environment variable
 * - Integration with existing circuit-breaker
 *
 * SEA (Self-Evolving Agents) Three Laws:
 * - Endure: System health check before evolution (disk, memory, network)
 * - Excel: Performance preservation (tests must pass) - handled by existing code
 * - Evolve: Automatic evolution triggering - this module
 */

import { checkHealth, type HealthStatus } from "../health/check.js";
import { log } from "../util/log.js";
import { readState } from "../util/state.js";
import {
  getCircuitBreakerPauseMs,
  isCircuitBreakerOpen,
} from "./circuit-breaker.js";

// ── Configuration ────────────────────────────────────────────────────────

/**
 * Default interval between auto-evolution checks (1 hour)
 * Can be overridden via AUTO_EVOLUTION_INTERVAL_MS env var
 */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Minimum free disk space in GB for Endure check
 */
const MIN_DISK_FREE_GB = 1;

/**
 * Minimum free memory in MB for Endure check
 */
const MIN_MEMORY_FREE_MB = 100;

/**
 * Maximum CPU load percentage for Endure check
 */
const MAX_CPU_LOAD_PERCENT = 90;

// ── State ─────────────────────────────────────────────────────────────────

let autoEvolutionTimer: ReturnType<typeof setInterval> | null = null;
let isEnabled = false;
let lastEndureCheck: EndureResult | null = null;
let evolutionTriggeredCount = 0;
let evolutionSkippedCount = 0;

// ── Types ─────────────────────────────────────────────────────────────────

export interface EndureResult {
  passed: boolean;
  timestamp: string;
  checks: {
    disk: {
      passed: boolean;
      freeGB: number;
      requiredGB: number;
    };
    memory: {
      passed: boolean;
      freeMB: number;
      requiredMB: number;
    };
    cpu: {
      passed: boolean;
      loadPercent: number;
      maxPercent: number;
    };
    circuitBreaker: {
      passed: boolean;
      isOpen: boolean;
    };
  };
  reason?: string;
}

export interface AutoEvolutionConfig {
  /** Interval in milliseconds between checks (default: 1 hour) */
  intervalMs?: number;
  /** Callback to trigger evolution (typically consciousness.triggerNow) */
  triggerEvolution: () => void;
  /** Optional notification function for alerts */
  notifyFn?: (message: string) => Promise<void>;
  /** Minimum disk free in GB (default: 1) */
  minDiskFreeGB?: number;
  /** Minimum memory free in MB (default: 100) */
  minMemoryFreeMB?: number;
  /** Maximum CPU load percent (default: 90) */
  maxCpuLoadPercent?: number;
}

export interface AutoEvolutionStatus {
  enabled: boolean;
  intervalMs: number;
  triggeredCount: number;
  skippedCount: number;
  lastEndureCheck: EndureResult | null;
}

// ── Endure Check ──────────────────────────────────────────────────────────

/**
 * Perform Endure check (SEA safety constraint #1).
 * Checks system health before allowing evolution to proceed.
 */
export async function performEndureCheck(
  config: AutoEvolutionConfig
): Promise<EndureResult> {
  const minDiskGB = config.minDiskFreeGB ?? MIN_DISK_FREE_GB;
  const minMemMB = config.minMemoryFreeMB ?? MIN_MEMORY_FREE_MB;
  const maxCpu = config.maxCpuLoadPercent ?? MAX_CPU_LOAD_PERCENT;

  let health: HealthStatus;
  try {
    health = await checkHealth({ silent: true });
  } catch (e) {
    const err = e as Error;
    log.error("Endure check failed - health check threw error", { error: err.message });
    return {
      passed: false,
      timestamp: new Date().toISOString(),
      checks: {
        disk: { passed: false, freeGB: 0, requiredGB: minDiskGB },
        memory: { passed: false, freeMB: 0, requiredMB: minMemMB },
        cpu: { passed: false, loadPercent: 100, maxPercent: maxCpu },
        circuitBreaker: { passed: true, isOpen: false },
      },
      reason: `Health check failed: ${err.message}`,
    };
  }

  // Calculate free disk in GB
  const diskFreeGB = (health.disk.size - health.disk.used) / (1024 * 1024 * 1024);
  const diskPassed = diskFreeGB >= minDiskGB;

  // Calculate free memory in MB
  const memoryFreeMB = health.memory.free / (1024 * 1024);
  const memoryPassed = memoryFreeMB >= minMemMB;

  // CPU load check
  const cpuPassed = health.cpu.loadPercent < maxCpu;

  // Circuit breaker check
  const circuitBreakerOpen = isCircuitBreakerOpen();
  const circuitBreakerPassed = !circuitBreakerOpen;

  const allPassed = diskPassed && memoryPassed && cpuPassed && circuitBreakerPassed;

  const result: EndureResult = {
    passed: allPassed,
    timestamp: new Date().toISOString(),
    checks: {
      disk: {
        passed: diskPassed,
        freeGB: Math.round(diskFreeGB * 100) / 100,
        requiredGB: minDiskGB,
      },
      memory: {
        passed: memoryPassed,
        freeMB: Math.round(memoryFreeMB),
        requiredMB: minMemMB,
      },
      cpu: {
        passed: cpuPassed,
        loadPercent: health.cpu.loadPercent,
        maxPercent: maxCpu,
      },
      circuitBreaker: {
        passed: circuitBreakerPassed,
        isOpen: circuitBreakerOpen,
      },
    },
  };

  if (!allPassed) {
    const failedChecks: string[] = [];
    if (!diskPassed) failedChecks.push(`disk:${diskFreeGB.toFixed(1)}GB<${minDiskGB}GB`);
    if (!memoryPassed) failedChecks.push(`memory:${memoryFreeMB.toFixed(0)}MB<${minMemMB}MB`);
    if (!cpuPassed) failedChecks.push(`cpu:${health.cpu.loadPercent}%>${maxCpu}%`);
    if (!circuitBreakerPassed) failedChecks.push("circuit-breaker:open");
    result.reason = `Endure check failed: ${failedChecks.join(", ")}`;
  }

  lastEndureCheck = result;
  return result;
}

// ── Auto Evolution Control ────────────────────────────────────────────────

/**
 * Check if auto evolution is enabled via environment variable.
 */
export function isAutoEvolutionEnabled(): boolean {
  const env = process.env.AUTO_EVOLUTION_ENABLED;
  // Default to true if not explicitly set to "false"
  return env !== "false";
}

/**
 * Get the configured evolution interval from environment or default.
 */
export function getEvolutionIntervalMs(): number {
  const env = process.env.AUTO_EVOLUTION_INTERVAL_MS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    log.warn(`Invalid AUTO_EVOLUTION_INTERVAL_MS: ${env}, using default`);
  }
  return DEFAULT_INTERVAL_MS;
}

/**
 * Start auto evolution.
 * Periodically checks if evolution should be triggered.
 */
export function startAutoEvolution(config: AutoEvolutionConfig): void {
  if (autoEvolutionTimer) {
    log.warn("Auto evolution already running, ignoring start request");
    return;
  }

  if (!isAutoEvolutionEnabled()) {
    log.info("Auto evolution is disabled via AUTO_EVOLUTION_ENABLED=false");
    return;
  }

  const intervalMs = config.intervalMs ?? getEvolutionIntervalMs();
  isEnabled = true;

  log.info("Auto evolution started", {
    intervalMinutes: Math.round(intervalMs / 60000),
    minDiskFreeGB: config.minDiskFreeGB ?? MIN_DISK_FREE_GB,
    minMemoryFreeMB: config.minMemoryFreeMB ?? MIN_MEMORY_FREE_MB,
  });

  autoEvolutionTimer = setInterval(async () => {
    if (!isEnabled) return;

    try {
      // Perform Endure check before triggering evolution
      const endureResult = await performEndureCheck(config);

      if (endureResult.passed) {
        log.info("Auto evolution: Endure check passed, triggering evolution");
        evolutionTriggeredCount++;
        config.triggerEvolution();
      } else {
        evolutionSkippedCount++;
        log.warn("Auto evolution: Endure check failed, skipping", {
          reason: endureResult.reason,
        });

        // Notify owner if configured
        if (config.notifyFn && evolutionSkippedCount % 5 === 0) {
          await config.notifyFn(
            `⏸️ Auto evolution skipped (${evolutionSkippedCount} total)\n${endureResult.reason}`
          ).catch(() => {});
        }
      }
    } catch (e) {
      const err = e as Error;
      log.error("Auto evolution check failed", { error: err.message });
    }
  }, intervalMs);
}

/**
 * Stop auto evolution.
 */
export function stopAutoEvolution(): void {
  if (autoEvolutionTimer) {
    clearInterval(autoEvolutionTimer);
    autoEvolutionTimer = null;
    isEnabled = false;
    log.info("Auto evolution stopped", {
      triggeredCount: evolutionTriggeredCount,
      skippedCount: evolutionSkippedCount,
    });
  }
}

/**
 * Get current auto evolution status.
 */
export function getAutoEvolutionStatus(): AutoEvolutionStatus {
  return {
    enabled: isEnabled,
    intervalMs: autoEvolutionTimer ? getEvolutionIntervalMs() : 0,
    triggeredCount: evolutionTriggeredCount,
    skippedCount: evolutionSkippedCount,
    lastEndureCheck,
  };
}

/**
 * Force an Endure check (for manual testing or debugging).
 */
export async function testEndureCheck(
  config: Partial<AutoEvolutionConfig> = {}
): Promise<EndureResult> {
  return performEndureCheck({
    triggerEvolution: () => {},
    ...config,
  });
}

/**
 * Reset auto evolution counters (for testing).
 */
export function resetAutoEvolutionCounters(): void {
  evolutionTriggeredCount = 0;
  evolutionSkippedCount = 0;
  lastEndureCheck = null;
}

// ── Export ─────────────────────────────────────────────────────────────────

export default {
  startAutoEvolution,
  stopAutoEvolution,
  getAutoEvolutionStatus,
  isAutoEvolutionEnabled,
  getEvolutionIntervalMs,
  performEndureCheck,
  testEndureCheck,
  resetAutoEvolutionCounters,
};