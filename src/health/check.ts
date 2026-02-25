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

const MEMORY_WARNING_THRESHOLD = 85;
const MEMORY_CRITICAL_THRESHOLD = 95;
const DISK_WARNING_THRESHOLD = 80;
const DISK_CRITICAL_THRESHOLD = 90;

/**
 * Perform a system health check.
 */
export async function checkHealth(): Promise<HealthStatus> {
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

    let status: HealthStatus["status"] = "healthy";

    if (memUsedPercent > MEMORY_CRITICAL_THRESHOLD || diskUsedPercent > DISK_CRITICAL_THRESHOLD) {
      status = "critical";
    } else if (memUsedPercent > MEMORY_WARNING_THRESHOLD || diskUsedPercent > DISK_WARNING_THRESHOLD) {
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
