"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface HealthStatus {
  status: "healthy" | "warning" | "critical";
  memory: { total: number; free: number; usedPercent: number };
  cpu: { loadPercent: number };
  disk: { size: number; used: number; usedPercent: number };
  uptime: number;
  timestamp: string;
}

interface StatusResponse {
  evolutionProgress: {
    cycle: number;
    stage: string;
    startedAt: string;
    message: string;
  } | null;
  circuitBreaker: {
    consecutiveFailures: number;
    pausedUntil: string | null;
  };
  currentTask: {
    taskId: string;
    taskTitle: string;
    status: string;
    cyclesSpent: number;
  } | null;
  branches: {
    total: number;
    active: number;
    current: { name: string; fitness: number; status: string } | null;
  };
  healthHistory: Array<{
    timestamp: string;
    status: string;
    memoryPercent: number;
    cpuPercent: number;
    diskPercent: number;
  }>;
}

interface LogStatsResponse {
  totalEntries: number;
  byLevel: Record<string, number>;
  uniqueTraceIds: number;
  errors: number;
  warnings: number;
  oldestEntry: string | null;
  newestEntry: string | null;
  recentErrors: Array<{
    time: string;
    msg: string;
    errorName?: string;
    errorMessage?: string;
    traceId?: string;
  }>;
  fileSize: number;
  timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function generateSparkline(data: number[]): string {
  if (data.length === 0) return "";
  const ticks = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 100);
  const range = max - min || 1;
  return data
    .map((v) => ticks[Math.round(((v - min) / range) * (ticks.length - 1))])
    .join("");
}

const STATUS_COLORS = {
  healthy: { color: "#00ff88", label: "HEALTHY" },
  warning: { color: "#ffaa00", label: "WARNING" },
  critical: { color: "#ff4040", label: "CRITICAL" },
};

const LEVEL_PRIORITY: Record<string, number> = {
  fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10,
};

const STAGE_LABELS: Record<string, string> = {
  understanding: "PARSING",
  implementing: "BUILDING",
  committing: "COMMIT",
  reporting: "REPORT",
  completed: "DONE",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function NeonBar({ value, color }: { value: number; color: string }) {
  return (
    <div
      className="relative h-[3px] w-full overflow-hidden"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      <div
        className="absolute top-0 left-0 h-full transition-all duration-700"
        style={{ width: `${Math.min(value, 100)}%`, background: color, boxShadow: `0 0 6px ${color}` }}
      />
    </div>
  );
}

function MetricRow({ label, value, unit = "%", warnAt = 80, critAt = 90 }: {
  label: string;
  value: number;
  unit?: string;
  warnAt?: number;
  critAt?: number;
}) {
  const color =
    value >= critAt ? "#ff4040" :
    value >= warnAt ? "#ffaa00" :
    "#00d9ff";
  return (
    <div className="flex items-center justify-between py-1">
      <span className="font-mono text-[11px] tracking-wider uppercase" style={{ color: "rgba(148,163,184,0.5)" }}>
        {label}
      </span>
      <span className="font-mono text-sm tabular-nums" style={{ color, textShadow: `0 0 8px ${color}60` }}>
        {value.toFixed(1)}{unit}
      </span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function HealthDashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [logStats, setLogStats] = useState<LogStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [healthRes, statusRes, logsRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/status"),
          fetch("/api/logs"),
        ]);
        if (healthRes.ok) setHealth(await healthRes.json());
        if (statusRes.ok) setStatus(await statusRes.json());
        if (logsRes.ok)   setLogStats(await logsRes.json());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, []);

  if (loading) {
    return (
      <div
        className="clip-md p-6"
        style={{
          background: "rgba(0,217,255,0.02)",
          border: "1px solid rgba(0,217,255,0.12)",
        }}
      >
        <span
          className="font-mono text-xs tracking-wider animate-pulse"
          style={{ color: "rgba(0,217,255,0.45)" }}
        >
          LOADING TELEMETRY DATA...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="clip-md p-6"
        style={{ background: "rgba(255,64,64,0.04)", border: "1px solid rgba(255,64,64,0.2)" }}
      >
        <span className="font-mono text-xs" style={{ color: "#ff4040" }}>
          ERR: {error}
        </span>
      </div>
    );
  }

  const sc = health ? STATUS_COLORS[health.status] : STATUS_COLORS.healthy;

  return (
    <div className="space-y-4">
      {/* ── System Health ─────────────────────────────────────────────── */}
      <div
        className="clip-md relative p-6"
        style={{
          background: "rgba(0,217,255,0.025)",
          border: "1px solid rgba(0,217,255,0.14)",
        }}
      >
        <div
          className="absolute top-0 left-[15%] right-[15%] h-px"
          style={{ background: "linear-gradient(90deg,transparent,rgba(0,217,255,0.4),transparent)" }}
        />
        <div className="flex items-center justify-between mb-5">
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: "rgba(0,217,255,0.5)" }}>
            SYS.VITALS
          </span>
          <div className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                background: sc.color,
                boxShadow: `0 0 8px ${sc.color}`,
                animation: "pulse-green 1.8s ease-in-out infinite",
              }}
            />
            <span className="font-mono text-[10px] tracking-widest" style={{ color: sc.color }}>
              {sc.label}
            </span>
          </div>
        </div>

        {health && (
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="space-y-2">
              <MetricRow label="CPU LOAD" value={health.cpu.loadPercent} />
              <NeonBar value={health.cpu.loadPercent} color="#00d9ff" />
            </div>
            <div className="space-y-2">
              <MetricRow label="MEMORY" value={health.memory.usedPercent} />
              <NeonBar value={health.memory.usedPercent} color="#c77dff" />
            </div>
            <div className="space-y-2">
              <MetricRow label="DISK" value={health.disk.usedPercent} />
              <NeonBar value={health.disk.usedPercent} color="#00ff88" />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-6 font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.3)" }}>
          <span>UPTIME: {health ? formatUptime(health.uptime) : "—"}</span>
          <span>DISK: {health ? formatBytes(health.disk.size) : "—"}</span>
        </div>
      </div>

      {/* ── Status Grid ───────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evolution Progress */}
        <div
          className="clip-sm p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase mb-4" style={{ color: "rgba(0,217,255,0.45)" }}>
            EVOLUTION.STATE
          </div>
          {status?.evolutionProgress ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm" style={{ color: "#e2e8f0" }}>
                  CYCLE #{status.evolutionProgress.cycle}
                </span>
                <span
                  className="font-mono text-[10px] px-2 py-0.5"
                  style={{
                    color: "#00d9ff",
                    border: "1px solid rgba(0,217,255,0.4)",
                    background: "rgba(0,217,255,0.08)",
                  }}
                >
                  {STAGE_LABELS[status.evolutionProgress.stage] ?? status.evolutionProgress.stage}
                </span>
              </div>
              <p className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>
                {status.evolutionProgress.message}
              </p>
            </div>
          ) : (
            <p className="font-mono text-xs" style={{ color: "rgba(148,163,184,0.35)" }}>
              NO ACTIVE EVOLUTION
            </p>
          )}
        </div>

        {/* Circuit Breaker */}
        <div
          className="clip-sm p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase mb-4" style={{ color: "rgba(0,217,255,0.45)" }}>
            CIRCUIT.BREAKER
          </div>
          {status?.circuitBreaker ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider" style={{ color: "rgba(148,163,184,0.5)" }}>
                  FAILURES
                </span>
                <span
                  className="font-mono text-sm tabular-nums"
                  style={{
                    color: status.circuitBreaker.consecutiveFailures >= 3 ? "#ff4040" : "#00ff88",
                  }}
                >
                  {status.circuitBreaker.consecutiveFailures}
                </span>
              </div>
              {status.circuitBreaker.pausedUntil && (
                <p className="font-mono text-[10px]" style={{ color: "#ffaa00" }}>
                  PAUSED UNTIL {new Date(status.circuitBreaker.pausedUntil).toLocaleTimeString()}
                </p>
              )}
              {!status.circuitBreaker.pausedUntil &&
                status.circuitBreaker.consecutiveFailures === 0 && (
                  <p className="font-mono text-[10px]" style={{ color: "#00ff88" }}>
                    NOMINAL
                  </p>
                )}
            </div>
          ) : (
            <p className="font-mono text-xs" style={{ color: "rgba(148,163,184,0.35)" }}>UNKNOWN</p>
          )}
        </div>

        {/* Current Task */}
        <div
          className="clip-sm p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase mb-4" style={{ color: "rgba(0,217,255,0.45)" }}>
            ACTIVE.TASK
          </div>
          {status?.currentTask ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.35)" }}>
                  {status.currentTask.taskId}
                </span>
                <span
                  className="font-mono text-[10px] px-2 py-0.5"
                  style={{
                    color: "#ffaa00",
                    border: "1px solid rgba(255,170,0,0.3)",
                    background: "rgba(255,170,0,0.06)",
                  }}
                >
                  {status.currentTask.status}
                </span>
              </div>
              <p className="text-sm" style={{ color: "#e2e8f0" }}>
                {status.currentTask.taskTitle}
              </p>
              <p className="font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.35)" }}>
                {status.currentTask.cyclesSpent} CYCLES SPENT
              </p>
            </div>
          ) : (
            <p className="font-mono text-xs" style={{ color: "rgba(148,163,184,0.35)" }}>IDLE</p>
          )}
        </div>

        {/* Branch Status */}
        <div
          className="clip-sm p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase mb-4" style={{ color: "rgba(0,217,255,0.45)" }}>
            AGENT.BRANCHES
          </div>
          {status?.branches ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider" style={{ color: "rgba(148,163,184,0.5)" }}>
                  ACTIVE
                </span>
                <span className="font-mono text-sm tabular-nums" style={{ color: "#00d9ff" }}>
                  {status.branches.active} / {status.branches.total}
                </span>
              </div>
              {status.branches.current && (
                <div
                  className="p-2 mt-1"
                  style={{ background: "rgba(0,217,255,0.04)", border: "1px solid rgba(0,217,255,0.1)" }}
                >
                  <p className="font-mono text-[10px] truncate" style={{ color: "rgba(148,163,184,0.6)" }}>
                    {status.branches.current.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.4)" }}>FITNESS</span>
                    <span className="font-mono text-xs" style={{ color: "#00ff88" }}>
                      {(status.branches.current.fitness * 100).toFixed(0)}%
                    </span>
                    <span
                      className="font-mono text-[9px] px-1"
                      style={{ color: "rgba(148,163,184,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      {status.branches.current.status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="font-mono text-xs" style={{ color: "rgba(148,163,184,0.35)" }}>NO DATA</p>
          )}
        </div>
      </div>

      {/* ── Health History Sparkline ───────────────────────────────────── */}
      {status?.healthHistory && status.healthHistory.length > 0 && (
        <div
          className="clip-sm p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="font-mono text-[10px] tracking-[0.22em] uppercase mb-4" style={{ color: "rgba(0,217,255,0.45)" }}>
            TELEMETRY.HISTORY
          </div>
          <div className="space-y-2 font-mono text-[11px]">
            {[
              { key: "CPU ", data: status.healthHistory.map((h) => h.cpuPercent),    color: "#00d9ff" },
              { key: "MEM ", data: status.healthHistory.map((h) => h.memoryPercent), color: "#c77dff" },
              { key: "DSK ", data: status.healthHistory.map((h) => h.diskPercent),   color: "#00ff88" },
            ].map(({ key, data, color }) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-10" style={{ color: "rgba(148,163,184,0.4)" }}>{key}</span>
                <span style={{ color, letterSpacing: "0.02em" }}>
                  [{generateSparkline(data)}]
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.25)" }}>
            LAST {status.healthHistory.length} CHECKS
          </p>
        </div>
      )}

      {/* ── Log Statistics ─────────────────────────────────────────────── */}
      {logStats && (
        <div
          className="clip-sm p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center justify-between mb-5">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase" style={{ color: "rgba(0,217,255,0.45)" }}>
              LOG.STATS
            </span>
            <span className="font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.3)" }}>
              {logStats.totalEntries.toLocaleString()} ENTRIES
            </span>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { val: logStats.errors,         label: "ERR",   color: "#ff4040" },
              { val: logStats.warnings,        label: "WARN",  color: "#ffaa00" },
              { val: logStats.uniqueTraceIds,  label: "TRACE", color: "#00d9ff" },
              { val: parseFloat((logStats.fileSize / 1024).toFixed(1)), label: "KB", color: "rgba(148,163,184,0.6)" },
            ].map(({ val, label, color }) => (
              <div key={label} className="text-center">
                <div className="font-mono text-lg tabular-nums" style={{ color }}>
                  {val}
                </div>
                <div className="font-mono text-[9px] tracking-wider" style={{ color: "rgba(148,163,184,0.35)" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Level breakdown */}
          <div className="space-y-1 mb-4">
            {Object.entries(logStats.byLevel)
              .sort((a, b) => (LEVEL_PRIORITY[b[0]] || 0) - (LEVEL_PRIORITY[a[0]] || 0))
              .map(([level, count]) => (
                <div key={level} className="flex items-center justify-between">
                  <span
                    className="font-mono text-[10px] tracking-wider uppercase"
                    style={{ color: "rgba(148,163,184,0.38)" }}
                  >
                    {level}
                  </span>
                  <span
                    className="font-mono text-xs tabular-nums"
                    style={{
                      color:
                        level === "error" || level === "fatal"
                          ? "#ff4040"
                          : level === "warn"
                            ? "#ffaa00"
                            : "rgba(148,163,184,0.5)",
                    }}
                  >
                    {count.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>

          {/* Recent errors */}
          {logStats.recentErrors.length > 0 && (
            <div className="border-t pt-4" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <div
                className="font-mono text-[10px] tracking-[0.2em] uppercase mb-3"
                style={{ color: "rgba(255,64,64,0.5)" }}
              >
                RECENT ERRORS
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {logStats.recentErrors.map((err, i) => (
                  <div
                    key={i}
                    className="p-2"
                    style={{
                      background: "rgba(255,64,64,0.04)",
                      border: "1px solid rgba(255,64,64,0.1)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs line-clamp-2" style={{ color: "rgba(148,163,184,0.7)" }}>
                        {err.msg}
                      </p>
                      <span className="shrink-0 font-mono text-[9px]" style={{ color: "rgba(148,163,184,0.3)" }}>
                        {new Date(err.time).toLocaleTimeString()}
                      </span>
                    </div>
                    {err.errorMessage && (
                      <p className="mt-1 font-mono text-[10px] line-clamp-1" style={{ color: "rgba(255,64,64,0.55)" }}>
                        {err.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
