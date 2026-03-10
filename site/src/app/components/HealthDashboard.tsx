"use client";

import { useEffect, useState } from "react";

// Types
interface HealthStatus {
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
    current: {
      name: string;
      fitness: number;
      status: string;
    } | null;
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

// Helpers
function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
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
  return data.map((v) => {
    const p = (v - min) / range;
    const index = Math.round(p * (ticks.length - 1));
    return ticks[index];
  }).join("");
}

const STATUS_COLORS = {
  healthy: { dot: "bg-emerald-400", text: "text-emerald-400", label: "健康" },
  warning: { dot: "bg-yellow-400", text: "text-yellow-400", label: "警告" },
  critical: { dot: "bg-red-400", text: "text-red-400", label: "危急" },
};

// Level priority for sorting (higher = more severe)
const LEVEL_PRIORITY: Record<string, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const STAGE_LABELS: Record<string, string> = {
  understanding: "理解任务",
  implementing: "实现中",
  committing: "提交中",
  reporting: "汇报中",
  completed: "已完成",
};

// Components
function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className={`h-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function StatRow({ label, value, unit, color }: { label: string; value: number; unit?: string; color?: string }) {
  const colorClass = color || (value > 80 ? "text-red-400" : value > 60 ? "text-yellow-400" : "text-zinc-300");
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`font-mono text-sm ${colorClass}`}>
        {value.toFixed(1)}{unit || "%"}
      </span>
    </div>
  );
}

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
        
        if (healthRes.ok) {
          setHealth(await healthRes.json());
        }
        if (statusRes.ok) {
          setStatus(await statusRes.json());
        }
        if (logsRes.ok) {
          setLogStats(await logsRes.json());
        }
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="animate-pulse text-zinc-500">加载健康状态...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-6">
        <div className="text-red-400">无法加载健康状态: {error}</div>
      </div>
    );
  }

  const statusColor = health ? STATUS_COLORS[health.status] : STATUS_COLORS.healthy;

  return (
    <div className="space-y-4">
      {/* Health Status Card */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            系统健康
          </h2>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColor.dot} animate-pulse`} />
            <span className={`text-xs font-medium ${statusColor.text}`}>
              {statusColor.label}
            </span>
          </div>
        </div>

        {health && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <StatRow label="CPU 负载" value={health.cpu.loadPercent} />
              <ProgressBar value={health.cpu.loadPercent} color="bg-blue-500" />
            </div>
            <div className="space-y-2">
              <StatRow label="内存使用" value={health.memory.usedPercent} />
              <ProgressBar value={health.memory.usedPercent} color="bg-purple-500" />
            </div>
            <div className="space-y-2">
              <StatRow label="磁盘使用" value={health.disk.usedPercent} />
              <ProgressBar value={health.disk.usedPercent} color="bg-emerald-500" />
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <span>运行时间: {health ? formatUptime(health.uptime) : "-"}</span>
          <span>磁盘: {health ? formatBytes(health.disk.size) : "-"}</span>
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evolution Progress */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            进化状态
          </h3>
          {status?.evolutionProgress ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-zinc-300">
                  循环 #{status.evolutionProgress.cycle}
                </span>
                <span className="rounded-full bg-blue-400/15 px-2 py-0.5 text-xs text-blue-400">
                  {STAGE_LABELS[status.evolutionProgress.stage] || status.evolutionProgress.stage}
                </span>
              </div>
              <p className="text-xs text-zinc-500">{status.evolutionProgress.message}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">暂无进行中的进化</p>
          )}
        </div>

        {/* Circuit Breaker */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            熔断器
          </h3>
          {status?.circuitBreaker ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">连续失败</span>
                <span className={`font-mono text-sm ${
                  status.circuitBreaker.consecutiveFailures >= 3 ? "text-red-400" : "text-zinc-400"
                }`}>
                  {status.circuitBreaker.consecutiveFailures}
                </span>
              </div>
              {status.circuitBreaker.pausedUntil && (
                <p className="text-xs text-yellow-400">
                  暂停至 {new Date(status.circuitBreaker.pausedUntil).toLocaleTimeString()}
                </p>
              )}
              {!status.circuitBreaker.pausedUntil && status.circuitBreaker.consecutiveFailures === 0 && (
                <p className="text-xs text-emerald-400">运行正常</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">状态未知</p>
          )}
        </div>

        {/* Current Task */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            当前任务
          </h3>
          {status?.currentTask ? (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs text-zinc-500">{status.currentTask.taskId}</span>
                <span className="rounded-full bg-yellow-400/15 px-2 py-0.5 text-xs text-yellow-400">
                  {status.currentTask.status}
                </span>
              </div>
              <p className="text-sm text-zinc-300">{status.currentTask.taskTitle}</p>
              <p className="text-xs text-zinc-500">已用 {status.currentTask.cyclesSpent} 循环</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">无当前任务</p>
          )}
        </div>

        {/* Branch Status */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Agent 分支
          </h3>
          {status?.branches ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">活跃分支</span>
                <span className="font-mono text-sm text-zinc-400">
                  {status.branches.active} / {status.branches.total}
                </span>
              </div>
              {status.branches.current && (
                <div className="rounded bg-white/5 p-2">
                  <p className="truncate text-xs text-zinc-300">{status.branches.current.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-zinc-500">适应度</span>
                    <span className="font-mono text-xs text-emerald-400">
                      {(status.branches.current.fitness * 100).toFixed(0)}%
                    </span>
                    <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {status.branches.current.status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">无分支信息</p>
          )}
        </div>
      </div>

      {/* Health History Sparkline */}
      {status?.healthHistory && status.healthHistory.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            健康历史趋势
          </h3>
          <div className="space-y-2 font-mono text-xs">
            <div className="flex items-center gap-3">
              <span className="w-12 text-zinc-500">CPU</span>
              <span className="text-zinc-300">[{generateSparkline(status.healthHistory.map(h => h.cpuPercent))}]</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-12 text-zinc-500">内存</span>
              <span className="text-zinc-300">[{generateSparkline(status.healthHistory.map(h => h.memoryPercent))}]</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-12 text-zinc-500">磁盘</span>
              <span className="text-zinc-300">[{generateSparkline(status.healthHistory.map(h => h.diskPercent))}]</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            最近 {status.healthHistory.length} 次检查
          </p>
        </div>
      )}

      {/* Log Statistics */}
      {logStats && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              日志统计
            </h3>
            <span className="font-mono text-xs text-zinc-500">
              {logStats.totalEntries.toLocaleString()} 条
            </span>
          </div>
          
          <div className="mb-4 grid gap-4 sm:grid-cols-4">
            <div className="text-center">
              <div className="font-mono text-xl text-red-400">{logStats.errors}</div>
              <div className="text-xs text-zinc-500">错误</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-xl text-yellow-400">{logStats.warnings}</div>
              <div className="text-xs text-zinc-500">警告</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-xl text-blue-400">{logStats.uniqueTraceIds}</div>
              <div className="text-xs text-zinc-500">追踪</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-xl text-zinc-400">{(logStats.fileSize / 1024).toFixed(1)}KB</div>
              <div className="text-xs text-zinc-500">大小</div>
            </div>
          </div>
          
          {/* Log level breakdown */}
          <div className="mb-4 space-y-1">
            {Object.entries(logStats.byLevel)
              .sort((a, b) => (LEVEL_PRIORITY[b[0]] || 0) - (LEVEL_PRIORITY[a[0]] || 0))
              .map(([level, count]) => (
                <div key={level} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{level}</span>
                  <span className={`font-mono ${
                    level === "error" || level === "fatal" ? "text-red-400" :
                    level === "warn" ? "text-yellow-400" :
                    "text-zinc-400"
                  }`}>
                    {count.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
          
          {/* Recent errors */}
          {logStats.recentErrors.length > 0 && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <h4 className="mb-2 text-xs font-medium text-zinc-400">最近错误</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {logStats.recentErrors.map((err, i) => (
                  <div key={i} className="rounded bg-white/5 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-zinc-300 line-clamp-2">{err.msg}</p>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {new Date(err.time).toLocaleTimeString()}
                      </span>
                    </div>
                    {err.errorMessage && (
                      <p className="mt-1 text-[10px] text-red-400/70 line-clamp-1">{err.errorMessage}</p>
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