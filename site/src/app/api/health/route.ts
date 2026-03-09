import { NextResponse } from "next/server";
import si from "systeminformation";

export const dynamic = "force-dynamic";

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
  timestamp: string;
}

// Default thresholds
const DEFAULT_MEMORY_WARNING = 85;
const DEFAULT_MEMORY_CRITICAL = 95;
const DEFAULT_DISK_WARNING = 80;
const DEFAULT_DISK_CRITICAL = 90;

export async function GET() {
  try {
    const [mem, cpu, disk] = await Promise.all([
      si.mem(),
      si.currentLoad(),
      si.fsSize(),
    ]);

    const memUsedPercent = (mem.active / mem.total) * 100;
    const mainDisk = disk.find((d) => d.mount === "/") || disk[0];
    const diskUsedPercent = mainDisk ? mainDisk.use : 0;

    let status: HealthStatus["status"] = "healthy";
    if (memUsedPercent > DEFAULT_MEMORY_CRITICAL || diskUsedPercent > DEFAULT_DISK_CRITICAL) {
      status = "critical";
    } else if (memUsedPercent > DEFAULT_MEMORY_WARNING || diskUsedPercent > DEFAULT_DISK_WARNING) {
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
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get health status", message: (error as Error).message },
      { status: 500 }
    );
  }
}