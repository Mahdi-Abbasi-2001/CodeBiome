"use client";

/**
 * Ambient forest-at-night decoration shared by the world's inner pages —
 * the same hill-silhouette/firefly visual language as the landing page's
 * `WorldScene`, scaled back so it reads as atmosphere behind real content
 * instead of competing with it. Purely decorative: `pointerEvents: "none"`,
 * absolutely positioned behind everything else in the page.
 */

const HILL_LAYERS = [
  { points: "0,620 200,560 420,600 640,540 860,590 1080,530 1300,580 1440,540 1440,900 0,900", fill: "#1B2530", opacity: 0.45 },
  { points: "0,680 220,620 460,660 680,600 900,650 1120,590 1440,630 1440,900 0,900", fill: "#182A24", opacity: 0.55 },
  { points: "0,740 260,680 500,720 740,660 980,710 1220,650 1440,690 1440,900 0,900", fill: "#12241C", opacity: 0.75 },
  { points: "0,800 300,740 560,780 820,720 1080,770 1300,730 1440,760 1440,900 0,900", fill: "#0D1B15", opacity: 0.92 },
];

const FIREFLIES: Array<{ x: number; y: number; r: number; opacity: number }> = [
  { x: 1340, y: 140, r: 2.2, opacity: 0.75 },
  { x: 1380, y: 760, r: 1.8, opacity: 0.55 },
  { x: 70, y: 500, r: 2, opacity: 0.65 },
  { x: 55, y: 760, r: 1.6, opacity: 0.5 },
  { x: 720, y: 95, r: 2, opacity: 0.6 },
  { x: 900, y: 830, r: 1.8, opacity: 0.55 },
];

function PineTree({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <rect x={-2} y={0} width={4} height={10} fill={color} />
      <polygon points="0,-46 16,-6 -16,-6" fill={color} />
      <polygon points="0,-32 13,2 -13,2" fill={color} />
      <polygon points="0,-18 10,8 -10,8" fill={color} />
    </g>
  );
}

function RoundTree({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <rect x={-2} y={-4} width={4} height={14} fill={color} />
      <circle cx={0} cy={-24} r={19} fill={color} />
      <circle cx={-11} cy={-16} r={13} fill={color} />
      <circle cx={11} cy={-16} r={13} fill={color} />
    </g>
  );
}

const TREES: Array<{ x: number; y: number; scale: number; color: string; kind: "pine" | "round" }> = [
  { x: 90, y: 812, scale: 0.9, color: "#0D1B15", kind: "pine" },
  { x: 170, y: 800, scale: 0.65, color: "#12241C", kind: "round" },
  { x: 250, y: 818, scale: 1.05, color: "#0D1B15", kind: "pine" },
  { x: 340, y: 806, scale: 0.7, color: "#12241C", kind: "pine" },
  { x: 1060, y: 800, scale: 0.75, color: "#12241C", kind: "round" },
  { x: 1150, y: 816, scale: 1.0, color: "#0D1B15", kind: "pine" },
  { x: 1250, y: 804, scale: 0.6, color: "#12241C", kind: "pine" },
  { x: 1340, y: 812, scale: 0.85, color: "#0D1B15", kind: "round" },
];

export function ForestBackdrop() {
  return (
    <svg
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <defs>
        <radialGradient id="fb-sky" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="#141B24" />
          <stop offset="100%" stopColor="#0A0D12" />
        </radialGradient>
        <radialGradient id="fb-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F2B84B" stopOpacity="0.14" />
          <stop offset="60%" stopColor="#4FD1C5" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#4FD1C5" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="1440" height="900" fill="url(#fb-sky)" />
      <circle cx="1150" cy="220" r="220" fill="url(#fb-glow)" className="cb-canopy-glow" />

      {HILL_LAYERS.map((layer, i) => (
        <polygon key={i} points={layer.points} fill={layer.fill} opacity={layer.opacity} />
      ))}

      {TREES.map((t, i) =>
        t.kind === "pine" ? (
          <PineTree key={i} x={t.x} y={t.y} scale={t.scale} color={t.color} />
        ) : (
          <RoundTree key={i} x={t.x} y={t.y} scale={t.scale} color={t.color} />
        )
      )}

      <g fill="#F2B84B">
        {FIREFLIES.map((f, i) => (
          <circle key={i} cx={f.x} cy={f.y} r={f.r} opacity={f.opacity} className="cb-spark" />
        ))}
      </g>
    </svg>
  );
}
