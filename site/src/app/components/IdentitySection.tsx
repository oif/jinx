"use client";

import { useEffect, useState } from "react";

interface IdentityData {
  identity: string | null;
  goals: string | null;
  scratchpad: string | null;
}

function renderTerminal(text: string): string {
  return text
    .replace(/^### (.*$)/gm, '<div class="font-mono text-[11px] tracking-[0.2em] uppercase mt-5 mb-2" style="color:rgba(0,217,255,0.55)">◈ $1</div>')
    .replace(/^## (.*$)/gm,  '<div class="font-mono text-xs tracking-[0.18em] uppercase mt-6 mb-2" style="color:rgba(0,217,255,0.7)">◉ $1</div>')
    .replace(/^# (.*$)/gm,   '<div class="font-mono text-sm tracking-widest uppercase mt-6 mb-3" style="color:#00d9ff">⬡ $1</div>')
    .replace(/\*\*(.*?)\*\*/g, '<span style="color:#e2e8f0;font-weight:600">$1</span>')
    .replace(/\*(.*?)\*/g,     '<em style="color:rgba(148,163,184,0.8)">$1</em>')
    .replace(/`(.*?)`/g,       '<code class="font-mono text-[11px] px-1.5 py-0.5 rounded-sm" style="color:#00d9ff;background:rgba(0,217,255,0.08);border:1px solid rgba(0,217,255,0.2)">$1</code>')
    .replace(/^- (.*$)/gm,     '<div class="flex gap-2 my-0.5"><span style="color:rgba(0,217,255,0.4)">›</span><span>$1</span></div>')
    .replace(/^> (.*$)/gm,     '<div class="border-l-2 pl-3 my-2 italic" style="border-color:rgba(0,217,255,0.25);color:rgba(148,163,184,0.5)">$1</div>')
    .replace(/^---$/gm,        '<div class="my-4 h-px" style="background:rgba(0,217,255,0.1)"></div>')
    .replace(/\n\n/g,          '<div class="my-3"></div>')
    .replace(/\n/g,            '<br/>');
}

function extractSummary(markdown: string, maxLength = 280): string {
  const cleaned = markdown
    .replace(/^#{1,6} .*/gm, "")
    .replace(/^> .*/gm, "")
    .replace(/^---$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .trim();
  const first = cleaned.split("\n\n").filter((p) => p.trim().length > 0)[0] ?? "";
  return first.length > maxLength ? first.slice(0, maxLength).trim() + "…" : first;
}

function TerminalPanel({
  label,
  file,
  children,
}: {
  label: string;
  file: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="clip-md relative"
      style={{
        background: "rgba(0,217,255,0.02)",
        border: "1px solid rgba(0,217,255,0.12)",
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-[15%] right-[15%] h-px"
        style={{
          background: "linear-gradient(90deg,transparent,rgba(0,217,255,0.35),transparent)",
        }}
      />

      {/* Terminal title bar */}
      <div
        className="flex items-center justify-between px-5 py-2.5 border-b"
        style={{ borderColor: "rgba(0,217,255,0.08)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ background: "rgba(255,64,64,0.4)" }} />
            <div className="h-2 w-2 rounded-full" style={{ background: "rgba(255,170,0,0.4)" }} />
            <div className="h-2 w-2 rounded-full" style={{ background: "rgba(0,255,136,0.4)" }} />
          </div>
          <span
            className="font-mono text-[10px] tracking-[0.2em] uppercase"
            style={{ color: "rgba(0,217,255,0.5)" }}
          >
            {label}
          </span>
        </div>
        <span
          className="font-mono text-[10px]"
          style={{ color: "rgba(148,163,184,0.3)" }}
        >
          {file}
        </span>
      </div>

      {/* Content */}
      <div className="px-5 py-5 text-sm leading-relaxed" style={{ color: "rgba(148,163,184,0.7)" }}>
        {children}
      </div>
    </section>
  );
}

export default function IdentitySection() {
  const [data, setData] = useState<IdentityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/identity")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div
        className="clip-md p-6"
        style={{ background: "rgba(0,217,255,0.02)", border: "1px solid rgba(0,217,255,0.12)" }}
      >
        <span className="font-mono text-xs tracking-wider animate-pulse" style={{ color: "rgba(0,217,255,0.4)" }}>
          READING MEMORY FILES...
        </span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Identity */}
      {data.identity && (
        <TerminalPanel label="IDENTITY" file="data/identity.md">
          <div
            dangerouslySetInnerHTML={{
              __html: renderTerminal(data.identity),
            }}
          />
        </TerminalPanel>
      )}

      {/* Goals */}
      {data.goals && (
        <TerminalPanel label="GOALS" file="data/goals.md">
          <div
            dangerouslySetInnerHTML={{
              __html: renderTerminal(data.goals),
            }}
          />
        </TerminalPanel>
      )}

      {/* Scratchpad summary */}
      {data.scratchpad && (
        <section
          className="clip-sm px-5 py-4"
          style={{
            background: "rgba(199,125,255,0.025)",
            border: "1px solid rgba(199,125,255,0.12)",
          }}
        >
          <div
            className="font-mono text-[10px] tracking-[0.22em] uppercase mb-3"
            style={{ color: "rgba(199,125,255,0.5)" }}
          >
            WORKING MEMORY // scratchpad.md
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(148,163,184,0.6)" }}>
            {extractSummary(data.scratchpad)}
          </p>
        </section>
      )}
    </div>
  );
}
