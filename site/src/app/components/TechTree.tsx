"use client";

interface Capability {
  id: string;
  name: string;
  category: string;
  description: string;
  maturity: "novice" | "advanced" | "expert";
}

type MaturityKey = "novice" | "advanced" | "expert";

const MATURITY: Record<
  MaturityKey,
  { label: string; color: string; border: string; bg: string; glow: string; dot: string; stem: string }
> = {
  novice: {
    label: "I",
    color: "#64748b",
    border: "rgba(100,116,139,0.3)",
    bg: "rgba(100,116,139,0.04)",
    glow: "none",
    dot: "rgba(100,116,139,0.5)",
    stem: "rgba(100,116,139,0.18)",
  },
  advanced: {
    label: "II",
    color: "#00d9ff",
    border: "rgba(0,217,255,0.4)",
    bg: "rgba(0,217,255,0.04)",
    glow: "0 0 12px rgba(0,217,255,0.25), inset 0 0 8px rgba(0,217,255,0.03)",
    dot: "rgba(0,217,255,0.8)",
    stem: "rgba(0,217,255,0.22)",
  },
  expert: {
    label: "III",
    color: "#c77dff",
    border: "rgba(199,125,255,0.5)",
    bg: "rgba(199,125,255,0.05)",
    glow: "0 0 18px rgba(199,125,255,0.38), inset 0 0 12px rgba(199,125,255,0.04)",
    dot: "rgba(199,125,255,0.9)",
    stem: "rgba(199,125,255,0.3)",
  },
};

const CAT_CONFIG: Record<string, { icon: string; label: string; accent: string }> = {
  survival:      { icon: "⬡", label: "SURVIVAL",    accent: "#00ff88" },
  identity:      { icon: "◈", label: "IDENTITY",    accent: "#00d9ff" },
  evolution:     { icon: "⟳", label: "EVOLUTION",   accent: "#c77dff" },
  cognition:     { icon: "◉", label: "COGNITION",   accent: "#ffaa00" },
  communication: { icon: "⊿", label: "COMM",        accent: "#00d9ff" },
  adaptation:    { icon: "⧖", label: "ADAPT",       accent: "#00ff88" },
  minimalism:    { icon: "◇", label: "MINIMAL",     accent: "#94a3b8" },
  extension:     { icon: "⊕", label: "EXTEND",      accent: "#c77dff" },
};

export default function TechTree({
  capsByCategory,
}: {
  capsByCategory: Record<string, Capability[]>;
}) {
  const entries = Object.entries(capsByCategory);

  return (
    <div
      className="overflow-x-auto pb-6"
      style={{ scrollbarColor: "rgba(0,217,255,0.2) transparent", scrollbarWidth: "thin" }}
    >
      {/* Legend */}
      <div className="flex items-center gap-6 mb-6 font-mono text-[10px] tracking-wider uppercase">
        {(["novice", "advanced", "expert"] as MaturityKey[]).map((m) => {
          const ms = MATURITY[m];
          return (
            <div key={m} className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: ms.dot, boxShadow: `0 0 4px ${ms.dot}` }}
              />
              <span style={{ color: ms.color }}>
                {m === "novice" ? "初级 LV.I" : m === "advanced" ? "进阶 LV.II" : "专家 LV.III"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tree */}
      <div
        className="flex gap-8"
        style={{ minWidth: `${Math.max(entries.length * 210, 600)}px` }}
      >
        {entries.map(([cat, caps]) => {
          const cfg = CAT_CONFIG[cat] ?? { icon: "◆", label: cat.toUpperCase(), accent: "#00d9ff" };

          return (
            <div key={cat} className="flex flex-col" style={{ width: "192px", flexShrink: 0 }}>
              {/* Category header badge */}
              <div
                className="flex items-center gap-2 px-3 py-1.5 mb-5 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] whitespace-nowrap"
                style={{
                  color: cfg.accent,
                  textShadow: `0 0 10px ${cfg.accent}80`,
                  background: `${cfg.accent}10`,
                  border: `1px solid ${cfg.accent}45`,
                  boxShadow: `0 0 16px ${cfg.accent}18`,
                  clipPath: "polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)",
                }}
              >
                <span style={{ fontSize: "14px" }}>{cfg.icon}</span>
                <span>{cfg.label}</span>
              </div>

              {/* Stem + capability nodes */}
              <div
                className="relative flex flex-col gap-3 pl-5"
                style={{ borderLeft: `1px solid ${cfg.accent}20` }}
              >
                {caps.map((cap) => {
                  const ms = MATURITY[cap.maturity] ?? MATURITY.novice;
                  const isPulse = cap.maturity === "expert";

                  return (
                    <div key={cap.id} className="relative">
                      {/* Horizontal connector line */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2"
                        style={{
                          left: "-20px",
                          width: "20px",
                          height: "1px",
                          background: ms.stem,
                        }}
                      />
                      {/* Dot on stem */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 rounded-full"
                        style={{
                          left: "-23px",
                          width: "5px",
                          height: "5px",
                          background: ms.dot,
                          boxShadow: `0 0 5px ${ms.dot}`,
                        }}
                      />
                      {/* Capability node */}
                      <div
                        className={`relative p-3 transition-transform duration-300 hover:scale-[1.02] cursor-default${isPulse ? " animate-pulse-violet" : ""}`}
                        style={{
                          background: ms.bg,
                          border: `1px solid ${ms.border}`,
                          boxShadow: ms.glow,
                          clipPath:
                            "polygon(8px 0%, 100% 0%, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0% 100%, 0% 8px)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span
                            className="text-xs font-medium leading-snug"
                            style={{ color: ms.color }}
                          >
                            {cap.name}
                          </span>
                          <span
                            className="shrink-0 font-mono text-[9px] px-1 py-0.5 rounded-sm"
                            style={{
                              color: ms.color,
                              border: `1px solid ${ms.border}`,
                              opacity: 0.72,
                            }}
                          >
                            {ms.label}
                          </span>
                        </div>
                        <p
                          className="text-[10.5px] leading-relaxed"
                          style={{ color: "rgba(148,163,184,0.58)" }}
                        >
                          {cap.description.length > 88
                            ? cap.description.slice(0, 88) + "…"
                            : cap.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
