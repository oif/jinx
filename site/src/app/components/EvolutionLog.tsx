"use client";

import { useState } from "react";

export interface EvolutionEntry {
  cycle: number;
  timestamp: string;
  version: string;
  status: "success" | "failed" | "skipped";
  summary: string;
  durationMs?: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

const STATUS = {
  success: { color: "#00ff88", label: "SUCCESS", bg: "rgba(0,255,136,0.02)",  border: "rgba(0,255,136,0.15)" },
  failed:  { color: "#ff4040", label: "FAILED",  bg: "rgba(255,64,64,0.02)",  border: "rgba(255,64,64,0.15)"  },
  skipped: { color: "#64748b", label: "SKIPPED", bg: "rgba(255,255,255,0.01)", border: "rgba(255,255,255,0.07)" },
};

function LogEntry({ entry, defaultOpen = false }: { entry: EvolutionEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const st = STATUS[entry.status];
  const lines = entry.summary ? entry.summary.split("\n").filter(Boolean) : [];
  const preview = lines[0] ?? "";

  return (
    <div
      className="clip-sm"
      style={{ background: st.bg, border: `1px solid ${st.border}` }}
    >
      {/* ── Header row (always visible, clickable) ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-white/[0.02]"
      >
        {/* Status dot */}
        <div
          className="shrink-0 h-2 w-2 rounded-full"
          style={{
            background: st.color,
            boxShadow: defaultOpen ? `0 0 8px ${st.color}` : "none",
          }}
        />

        {/* Cycle + status + version */}
        <span className="font-mono text-xs" style={{ color: "rgba(0,217,255,0.45)" }}>
          #{entry.cycle}
        </span>
        <span
          className="font-mono text-xs font-semibold tracking-wider"
          style={{ color: st.color }}
        >
          {st.label}
        </span>
        <span className="font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.28)" }}>
          {entry.version}
        </span>

        {/* Summary preview */}
        {preview && !open && (
          <span
            className="flex-1 min-w-0 truncate text-sm"
            style={{ color: "rgba(148,163,184,0.5)" }}
          >
            {preview}
          </span>
        )}

        {/* Timestamp + expand chevron */}
        <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: "rgba(148,163,184,0.28)" }}>
          {formatDate(entry.timestamp)}
        </span>
        <span
          className="shrink-0 font-mono text-[11px] transition-transform duration-200"
          style={{
            color: "rgba(0,217,255,0.35)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          ›
        </span>
      </button>

      {/* ── Expanded detail ── */}
      {open && (
        <div
          className="px-5 pb-5 space-y-4 border-t"
          style={{ borderColor: `${st.border}` }}
        >
          {/* Meta row */}
          <div className="pt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px]">
            <div>
              <span style={{ color: "rgba(148,163,184,0.38)" }}>CYCLE </span>
              <span style={{ color: "#00d9ff" }}>#{entry.cycle}</span>
            </div>
            <div>
              <span style={{ color: "rgba(148,163,184,0.38)" }}>VERSION </span>
              <span style={{ color: "#00d9ff" }}>{entry.version}</span>
            </div>
            {entry.durationMs !== undefined && (
              <div>
                <span style={{ color: "rgba(148,163,184,0.38)" }}>DURATION </span>
                <span style={{ color: "#00d9ff" }}>{formatDuration(entry.durationMs)}</span>
              </div>
            )}
            <div>
              <span style={{ color: "rgba(148,163,184,0.38)" }}>TIME </span>
              <span style={{ color: "rgba(148,163,184,0.55)" }}>{formatDate(entry.timestamp)}</span>
            </div>
          </div>

          {/* Full summary */}
          {entry.summary && (
            <div
              className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
              style={{
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.05)",
                color: "rgba(148,163,184,0.75)",
              }}
            >
              {entry.summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EvolutionLog({ entries }: { entries: EvolutionEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="font-mono text-xs" style={{ color: "rgba(148,163,184,0.3)" }}>
        NO EVOLUTION HISTORY
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <LogEntry key={entry.cycle} entry={entry} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
