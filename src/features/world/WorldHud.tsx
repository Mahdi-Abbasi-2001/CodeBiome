"use client";

const TEAL = "#4FD1C5";
const AMBER = "#F2B84B";

export type WorldLens = "architecture" | "onboarding" | "flow" | "health" | "plan";

const LENS_ITEMS: Array<{ lens: WorldLens | null; label: string }> = [
  { lens: "architecture", label: "Architecture" },
  { lens: "onboarding", label: "Onboarding" },
  { lens: "flow", label: "Flow" },
  { lens: "health", label: "Health" },
  { lens: "plan", label: "Plan" },
];

/** The top chrome bar shared by every "world" lens page — kept in one place so every lens stays pixel-identical instead of drifting via copy-paste. */
export function WorldHud({ repoName, activeLens, onSelectLens }: { repoName: string; activeLens: WorldLens; onSelectLens: (lens: WorldLens) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        boxSizing: "border-box",
        background: "linear-gradient(180deg,rgba(10,13,18,0.9),rgba(10,13,18,0))",
        zIndex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <svg width="20" height="20" viewBox="0 0 26 26">
          <circle cx="13" cy="13" r="11" fill="none" stroke={TEAL} strokeWidth="1.6" />
          <circle cx="13" cy="13" r="4.5" fill={AMBER} />
        </svg>
        <span style={{ fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 14, fontWeight: 600 }}>CodeBiome</span>
        <span style={{ color: "#3D3D3A" }}>/</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: "#B7BDC3" }}>{repoName}</span>
      </div>
      <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: 3, gap: 1 }}>
        {LENS_ITEMS.map((item) => {
          const active = item.lens === activeLens;
          const enabled = item.lens !== null;
          return (
            <button
              key={item.label}
              onClick={enabled ? () => onSelectLens(item.lens!) : undefined}
              style={{
                border: 0,
                background: active ? AMBER : "transparent",
                color: active ? "#171208" : enabled ? "#B7BDC3" : "#8A9199",
                fontWeight: active ? 600 : 400,
                fontSize: 12,
                padding: "7px 13px",
                borderRadius: 15,
                fontFamily: "inherit",
                cursor: enabled ? "pointer" : "not-allowed",
              }}
              disabled={!enabled}
              title={enabled ? undefined : "Not built yet"}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {/* Balances the logo/breadcrumb on the left so the lens tabs stay centered — not a button: there's no search feature behind it yet. */}
      <div style={{ width: 32, height: 32 }} aria-hidden="true" />
    </div>
  );
}
