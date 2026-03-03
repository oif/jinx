import si from "systeminformation";
import { log } from "../util/log.js";

export interface HealthStatus {
  status: "healthy" | "warning" | "critical";
  memory: {
    total: number;
    free: number;
    usedPercent: number;
  };
  cpu: {
    loadPercent: number;
  };
  disk: {
    size: number;
    used: number;
    usedPercent: number;
  };
  uptime: number;
}

// Default thresholds (can be overridden via environment variables)
const DEFAULT_MEMORY_WARNING = 85;
const DEFAULT_MEMORY_CRITICAL = 95;
const DEFAULT_DISK_WARNING = 80;
const DEFAULT_DISK_CRITICAL = 90;

function parseThreshold(envVar: string, defaultValue: number): number {
  const env = process.env[envVar];
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      return parsed;
    }
    log.warn(`Invalid ${envVar} value: ${env}, using default: ${defaultValue}`);
  }
  return defaultValue;
}

// Track last notified state to avoid spam
let lastNotifiedStatus: HealthStatus["status"] = "healthy";
let notifyFn: ((message: string) => Promise<void>) | null = null;

/**
 * Register a notification function for health alerts.
 */
export function registerHealthNotifier(fn: (message: string) => Promise<void>): void {
  notifyFn = fn;
}

/**
 * Format a health alert message.
 */
function formatHealthAlert(health: HealthStatus): string {
  const emoji = health.status === "critical" ? "🚨" : "⚠️";
  const issues: string[] = [];

  const memWarning = parseThreshold("HEALTH_MEMORY_WARNING_THRESHOLD", DEFAULT_MEMORY_WARNING);
  const diskWarning = parseThreshold("HEALTH_DISK_WARNING_THRESHOLD", DEFAULT_DISK_WARNING);

  if (health.memory.usedPercent > memWarning) {
    issues.push(`Memory: ${health.memory.usedPercent}%`);
  }
  if (health.disk.usedPercent > diskWarning) {
    issues.push(`Disk: ${health.disk.usedPercent}%`);
  }

  return `${emoji} Health Alert: ${health.status.toUpperCase()}\n${issues.join(" | ")}`;
}

async function sendHealthNotifications(
  health: HealthStatus,
  silent: boolean,
): Promise<void> {
  const { status } = health;
  if (!silent && status !== "healthy" && status !== lastNotifiedStatus && notifyFn) {
    try {
      await notifyFn(formatHealthAlert(health));
      lastNotifiedStatus = status;
    } catch (e) {
      log.error("Failed to send health alert", { error: (e as Error).message });
    }
  }
  if (status === "healthy" && lastNotifiedStatus !== "healthy") {
    lastNotifiedStatus = "healthy";
    if (!silent && notifyFn) {
      try {
        await notifyFn("✅ Health status recovered to HEALTHY");
      } catch (e) {
        log.error("Failed to send health recovery notification", { error: (e as Error).message });
      }
    }
  }
}

/**
 * Perform a system health check.
 * Optionally sends notifications when status changes to warning/critical.
 */
export async function checkHealth(options?: { silent?: boolean }): Promise<HealthStatus> {
  try {
    const [mem, cpu, disk] = await Promise.all([
      si.mem(),
      si.currentLoad(),
      si.fsSize(),
    ]);

    const memUsedPercent = (mem.active / mem.total) * 100;

    // Check main mount point (usually /)
    const mainDisk = disk.find(d => d.mount === "/") || disk[0];
    const diskUsedPercent = mainDisk ? mainDisk.use : 0;

    const memWarning = parseThreshold("HEALTH_MEMORY_WARNING_THRESHOLD", DEFAULT_MEMORY_WARNING);
    const memCritical = parseThreshold("HEALTH_MEMORY_CRITICAL_THRESHOLD", DEFAULT_MEMORY_CRITICAL);
    const diskWarning = parseThreshold("HEALTH_DISK_WARNING_THRESHOLD", DEFAULT_DISK_WARNING);
    const diskCritical = parseThreshold("HEALTH_DISK_CRITICAL_THRESHOLD", DEFAULT_DISK_CRITICAL);

    let status: HealthStatus["status"] = "healthy";

    if (memUsedPercent > memCritical || diskUsedPercent > diskCritical) {
      status = "critical";
    } else if (memUsedPercent > memWarning || diskUsedPercent > diskWarning) {
      status = "warning";
    }

    const health: HealthStatus = {
      status,
      memory: {
        total: mem.total,
        free: mem.free,
        usedPercent: Math.round(memUsedPercent * 100) / 100,
      },
      cpu: {
        loadPercent: Math.round(cpu.currentLoad * 100) / 100,
      },
      disk: {
        size: mainDisk?.size || 0,
        used: mainDisk?.used || 0,
        usedPercent: Math.round(diskUsedPercent * 100) / 100,
      },
      uptime: process.uptime(),
    };

    await sendHealthNotifications(health, options?.silent ?? false);

    if (status !== "healthy") {
      log.warn("Health check reported issues", health as unknown as Record<string, unknown>);
    } else {
      log.info("Health check passed", health as unknown as Record<string, unknown>);
    }

    return health;
  } catch (e) {
    const err = e as Error;
    log.error("Health check failed to execute", { error: err.message });
    throw err;
  }
}
