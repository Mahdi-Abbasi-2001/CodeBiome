"use client";

/**
 * Shared step-pipeline shape vocabulary — used by FlowDiagram (Flow/Journey,
 * both statically reconstructed) and PlanDiagram (Bob's proposed feature
 * plan, ai-interpreted). One shape language across all three so a "service"
 * always reads as a hexagon and a "database" always reads as a cylinder,
 * whether the step is real or proposed.
 */

export const TEAL = "#4FD1C5";
export const AMBER = "#F2B84B";
export const INDIGO = "#8C9EFF";
export const PURPLE = "#B98CE0";
export const CORAL = "#FF9E7A";
export const SKYBLUE = "#9ED8F2";
export const NEUTRAL = "#8A9199";
export const GHOST = "#C99A6C";
export const LINE_STRONG = "#4A5560";
export const LINE_DIM = "#2B2F36";
export const INK = "#F3F1EA";
export const INK_SOFT = "#9CA6AC";

export type StepShape = "entry" | "hex" | "card" | "vault" | "cylinder" | "external" | "rings" | "box";

export function softColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

/**
 * `ghost` renders a dashed, GHOST-colored outline regardless of `color` —
 * used for a proposed-but-not-yet-built step (PlanDiagram) so "doesn't
 * exist yet" reads the same way "external/unverified" already does
 * elsewhere (a dashed stroke), without inventing a second visual language.
 */
export function StepGlyph({
  shape,
  color,
  w,
  h,
  selected,
  ghost,
}: {
  shape: StepShape;
  color: string;
  w: number;
  h: number;
  selected: boolean;
  ghost?: boolean;
}) {
  const soft = softColor(ghost ? GHOST : color);
  const strong = selected ? TEAL : ghost ? GHOST : color;
  const strokeWidth = selected ? 3 : 1.8;
  const dash = ghost ? "5 4" : undefined;
  const cx = w / 2;
  const cy = h / 2;

  switch (shape) {
    case "entry":
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={14} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray={dash} />
          <polygon points={`${cx - 12},${cy - 16} ${cx - 12},${cy + 16} ${cx + 14},${cy}`} fill={ghost ? GHOST : color} />
        </g>
      );
    case "hex": {
      const pts = [
        [cx * 0.32, 2],
        [w - cx * 0.32, 2],
        [w - 2, cy],
        [w - cx * 0.32, h - 2],
        [cx * 0.32, h - 2],
        [2, cy],
      ]
        .map((p) => p.join(","))
        .join(" ");
      const barY = cy - 14;
      const barColor = ghost ? GHOST : color;
      return (
        <g>
          <polygon points={pts} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray={dash} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={cx - 24} y={barY + i * 11} width={48} height={6} rx={2} fill={barColor} opacity={i === 0 ? 0.9 : 0.5} />
          ))}
        </g>
      );
    }
    case "card":
      return (
        <g>
          <path
            d={`M6,2 H${w - 20} L${w - 2},20 V${h - 2} H6 Z`}
            fill={soft}
            stroke={strong}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeDasharray={dash}
          />
          <path d={`M${w - 20},2 V20 H${w - 2}`} fill="none" stroke={strong} strokeWidth={1.4} opacity={0.7} />
          <rect x={16} y={h * 0.5} width={w - 46} height={6} rx={2} fill={ghost ? GHOST : color} opacity={0.55} />
          <rect x={16} y={h * 0.5 + 14} width={(w - 46) * 0.6} height={6} rx={2} fill={ghost ? GHOST : color} opacity={0.35} />
        </g>
      );
    case "vault": {
      const barColor = ghost ? GHOST : color;
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={10} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray={dash} />
          {[0.3, 0.62].map((f, i) => (
            <g key={i}>
              <rect x={10} y={h * f - 10} width={w - 20} height={20} rx={4} fill="none" stroke={barColor} strokeWidth={1.6} opacity={0.8} />
              <circle cx={w - 22} cy={h * f} r={2.6} fill={barColor} />
            </g>
          ))}
        </g>
      );
    }
    case "cylinder": {
      const ry = 11;
      const bodyD = `M2,${ry} a${cx - 2},${ry} 0 0 1 ${w - 4},0 v${h - ry * 2} a${cx - 2},${ry} 0 0 1 -${w - 4},0 z`;
      const capD = `M2,${ry} a${cx - 2},${ry} 0 0 0 ${w - 4},0`;
      const ringColor = ghost ? GHOST : color;
      return (
        <g>
          <path d={bodyD} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray={dash} />
          <path d={capD} fill="none" stroke={strong} strokeWidth={1.5} opacity={0.7} />
          {[0.45, 0.7].map((f) => (
            <path key={f} d={`M2,${h * f} a${cx - 2},${ry} 0 0 0 ${w - 4},0`} fill="none" stroke={ringColor} strokeWidth={1} opacity={0.3} />
          ))}
        </g>
      );
    }
    case "external": {
      const r = Math.min(w, h) / 2 - 2;
      const ringColor = ghost ? GHOST : color;
      return (
        <g>
          <circle cx={cx} cy={cy} r={r} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray="5 4" />
          <ellipse cx={cx} cy={cy} rx={r * 0.42} ry={r * 0.72} fill="none" stroke={ringColor} strokeWidth={1.3} opacity={0.7} />
          <line x1={cx - r * 0.8} y1={cy} x2={cx + r * 0.8} y2={cy} stroke={ringColor} strokeWidth={1.3} opacity={0.7} />
        </g>
      );
    }
    case "rings": {
      const ringColor = ghost ? GHOST : color;
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={14} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray={dash} />
          <circle cx={cx} cy={cy} r={6} fill={ringColor} />
          <circle cx={cx} cy={cy} r={16} fill="none" stroke={ringColor} strokeWidth={1.6} opacity={0.65} />
          <circle cx={cx} cy={cy} r={26} fill="none" stroke={ringColor} strokeWidth={1.4} opacity={0.4} />
        </g>
      );
    }
    case "box":
    default:
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={10} fill={soft} stroke={strong} strokeWidth={strokeWidth} strokeDasharray={dash} />
          <text x={cx} y={cy + 5} textAnchor="middle" fontFamily="'IBM Plex Mono',monospace" fontSize={16} fill={ghost ? GHOST : color} opacity={0.8}>
            {"{ }"}
          </text>
        </g>
      );
  }
}
