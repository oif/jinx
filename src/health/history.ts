import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HealthStatus, checkHealth } from "./check.js";
import { log } from "../util/log.js";

const HISTORY_PATH = join(process.cwd(), "data", "health-history.json");
const MAX_HISTORY_ENTRIES = 288; // 24 hours of 5-minute intervals

export interface HealthHistoryEntry {
  timestamp: string;
  status: HealthStatus["status"];
  memoryPercent: number;
  cpuPercent: number;
  diskPercent: number;
}

export function loadHealthHistory(): HealthHistoryEntry[] {
  try {
    if (existsSync(HISTORY_PATH)) {
      return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
    }
  } catch (e) {
    log.warn("Failed to load health history", { error: (e as Error).message });
  }
  return [];
}

export function saveHealthHistory(history: HealthHistoryEntry[]): void {
  try {
    // Keep only the last MAX_HISTORY_ENTRIES
    const trimmed = history.slice(-MAX_HISTORY_ENTRIES);
    writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    log.warn("Failed to save health history", { error: (e as Error).message });
  }
}

export async function recordHealthSnapshot(): Promise<void> {
  const currentHealth = await checkHealth({ silent: true });
  const history = loadHealthHistory();
  
  history.push({
    timestamp: new Date().toISOString(),
    status: currentHealth.status,
    memoryPercent: currentHealth.memory.usedPercent,
    cpuPercent: currentHealth.cpu.loadPercent,
    diskPercent: currentHealth.disk.usedPercent,
  });

  saveHealthHistory(history);
  log.info("Health snapshot recorded");
}

/**
 * Generate a simple ASCII sparkline for an array of numbers.
 */
export function generateSparkline(data: number[]): string {
  if (data.length === 0) return "";
  const ticks = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...data, 0); // anchor at 0 for percentage
  const max = Math.max(...data, 100); // anchor at 100
  const range = max - min || 1;

  return data.map(v => {
    const p = (v - min) / range;
    const index = Math.round(p * (ticks.length - 1));
    return ticks[index];
  }).join("");
}

export function formatHistoryReport(): string {
  const history = loadHealthHistory();
  if (history.length === 0) return "No health history available yet.";

  // Grab the last 20 entries for the sparkline
  const recent = history.slice(-20);
  const memLine = generateSparkline(recent.map(h => h.memoryPercent));
  const cpuLine = generateSparkline(recent.map(h => h.cpuPercent));
  const diskLine = generateSparkline(recent.map(h => h.diskPercent));

  return [
    `📈 Health History (Last ${recent.length} checks):`,
    `CPU:  [${cpuLine}]`,
    `MEM:  [${memLine}]`,
    `DISK: [${diskLine}]`,
  ].join("\n");
}
