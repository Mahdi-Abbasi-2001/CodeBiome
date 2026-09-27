"use client";

import type { BuildingRole } from "@/lib/buildingRoles";

export interface Palette {
  front: string;
  top: string;
  side: string;
  trim: string;
}

const HEALTHY: Palette = { front: "#237556", top: "#3FA672", side: "#123B2C", trim: "#4FD1C5" };
const DAMAGED: Palette = { front: "#7A2E22", top: "#8F4536", side: "#4A1C15", trim: "#E0553F" };

export function paletteFor(damaged: boolean): Palette {
  return damaged ? DAMAGED : HEALTHY;
}

/** A simple extruded box — front/top/side facets under one consistent oblique light, the shared vocabulary every building is built from. */
export function Box3D({
  x,
  y,
  width,
  height,
  depth = 12,
  palette,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  depth?: number;
  palette: Palette;
}) {
  const dx = depth;
  const dy = -depth;
  return (
    <g>
      <polygon
        points={`${x + width},${y} ${x + width + dx},${y + dy} ${x + width + dx},${y + height + dy} ${x + width},${y + height}`}
        fill={palette.side}
      />
      <polygon points={`${x},${y} ${x + width},${y} ${x + width + dx},${y + dy} ${x + dx},${y + dy}`} fill={palette.top} />
      <rect x={x} y={y} width={width} height={height} fill={palette.front} stroke={palette.trim} strokeWidth="1" strokeOpacity="0.4" />
    </g>
  );
}

function DamageOverlay({ cx, cy, radius }: { cx: number; cy: number; radius: number }) {
  const d = `M ${cx - radius * 0.5} ${cy - radius * 0.1} Q ${cx - radius * 0.2} ${cy - radius * 0.5} ${cx - radius * 0.35} ${cy - radius * 0.9}`;
  return (
    <g>
      <ellipse cx={cx} cy={cy + radius * 0.75} rx={radius * 0.85} ry={radius * 0.2} fill="none" stroke="#E0553F" strokeWidth="1" strokeDasharray="3 4" opacity="0.6" />
      <path d={d} stroke="#E0553F" strokeWidth="1.4" fill="none" opacity="0.6" />
      <circle cx={cx - radius * 0.3} cy={cy - radius * 0.15} r="3" fill="#FFB199" className="cb-pulse" />
    </g>
  );
}

/** Entrance — the same twin-pillar gate vocabulary used for the repository's own Gateway landmark. */
export function GateGlyph({ cx, cy, scale = 1, damaged }: { cx: number; cy: number; scale?: number; damaged: boolean }) {
  const p = paletteFor(damaged);
  const w = 72 * scale;
  const h = 52 * scale;
  return (
    <g>
      <rect x={cx - w / 2} y={cy - h} width={14 * scale} height={h} fill="#171E26" stroke={p.trim} strokeWidth="1.2" />
      <rect x={cx + w / 2 - 14 * scale} y={cy - h} width={14 * scale} height={h} fill="#171E26" stroke={p.trim} strokeWidth="1.2" />
      <rect x={cx - w / 2 - 4 * scale} y={cy - h - 12 * scale} width={w + 8 * scale} height={12 * scale} fill="#171E26" stroke={p.trim} strokeWidth="1.2" />
      <rect x={cx - 16 * scale} y={cy - 12 * scale} width={32 * scale} height={10 * scale} fill={p.trim} opacity="0.55" />
      <ellipse cx={cx} cy={cy + 6} rx={40 * scale} ry={8 * scale} fill={p.trim} opacity="0.12" />
      {damaged && <DamageOverlay cx={cx} cy={cy - h / 2} radius={30} />}
    </g>
  );
}

/** Central hub — a tiered, stepped silhouette with a beacon; the plaza (drawn by the caller) is built around it. */
export function HubGlyph({ cx, cy, damaged, isPrimary }: { cx: number; cy: number; damaged: boolean; isPrimary: boolean }) {
  const p = paletteFor(damaged);
  return (
    <g>
      <Box3D x={cx - 32} y={cy - 46} width={64} height={92} palette={p} />
      <Box3D x={cx - 20} y={cy - 86} width={40} height={40} palette={p} />
      <Box3D x={cx - 8} y={cy - 111} width={16} height={25} palette={p} />
      {isPrimary && !damaged && (
        <>
          <circle cx={cx} cy={cy - 118} r="4.5" fill="#F2B84B" className="cb-pulse" />
          <circle cx={cx} cy={cy - 118} r="13" fill="#F2B84B" opacity="0.28" />
        </>
      )}
      {damaged && <DamageOverlay cx={cx} cy={cy - 20} radius={40} />}
    </g>
  );
}

/** Data boundary — a compact faceted crystal, deliberately unlike any boxy building. */
export function EntityGlyph({ cx, cy, damaged }: { cx: number; cy: number; damaged: boolean }) {
  const p = paletteFor(damaged);
  const w = 38;
  const topH = 22;
  const bodyH = 44;
  return (
    <g>
      <polygon points={`${cx - w},${cy} ${cx},${cy - topH} ${cx + w},${cy} ${cx},${cy + topH}`} fill={p.top} />
      <polygon points={`${cx - w},${cy} ${cx},${cy + topH} ${cx},${cy + topH + bodyH} ${cx - w},${cy + bodyH}`} fill={p.front} />
      <polygon points={`${cx},${cy + topH} ${cx + w},${cy} ${cx + w},${cy + bodyH} ${cx},${cy + topH + bodyH}`} fill={p.side} />
      <circle cx={cx} cy={cy - topH} r="3.5" fill="#EAFFF6" opacity="0.7" />
      {damaged && <DamageOverlay cx={cx} cy={cy + topH} radius={36} />}
    </g>
  );
}

/** Persistence interface — a colonnaded block; visually between application structures and infrastructure. */
export function RepositoryGlyph({ cx, cy, damaged }: { cx: number; cy: number; damaged: boolean }) {
  const p = paletteFor(damaged);
  const w = 80;
  const h = 48;
  const x = cx - w / 2;
  const y = cy - h;
  return (
    <g>
      <Box3D x={x} y={y} width={w} height={h} palette={p} />
      <g fill={p.side} opacity="0.85">
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={x + 12 + i * 12} y={y + 12} width="5" height="24" />
        ))}
      </g>
      {damaged && <DamageOverlay cx={cx} cy={cy - h / 2} radius={34} />}
    </g>
  );
}

/** Infrastructure — a visible silo/vault, always recessed into the persistence yard by the caller. */
export function DatabaseGlyph({ cx, cy, damaged }: { cx: number; cy: number; damaged: boolean }) {
  const p = paletteFor(damaged);
  const rx = 38;
  const bodyH = 36;
  return (
    <g>
      <ellipse cx={cx} cy={cy + bodyH + 2} rx={rx + 4} ry={9} fill={p.trim} opacity="0.16" />
      <rect x={cx - rx} y={cy} width={rx * 2} height={bodyH} fill={p.front} />
      <ellipse cx={cx} cy={cy + bodyH} rx={rx} ry={14} fill={p.side} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={14} fill={p.top} />
      <ellipse cx={cx} cy={cy} rx={rx * 0.7} ry={9.5} fill={p.front} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={14} fill="none" stroke={p.trim} strokeWidth="1.4" opacity="0.7" />
      {damaged && <DamageOverlay cx={cx} cy={cy + bodyH / 2} radius={40} />}
    </g>
  );
}

/** Generic — side-branch modules (event emitters, unclassified files) that don't have a bespoke shape yet. */
export function GenericGlyph({ cx, cy, damaged }: { cx: number; cy: number; damaged: boolean }) {
  const p = paletteFor(damaged);
  return (
    <g>
      <Box3D x={cx - 22} y={cy - 40} width={44} height={40} palette={p} />
      {damaged && <DamageOverlay cx={cx} cy={cy - 20} radius={30} />}
    </g>
  );
}

export function BuildingGlyph({ role, cx, cy, damaged, isPrimary }: { role: BuildingRole; cx: number; cy: number; damaged: boolean; isPrimary: boolean }) {
  switch (role) {
    case "entry":
    case "controller":
    case "handler":
      return <GateGlyph cx={cx} cy={cy} damaged={damaged} />;
    case "service":
      return <HubGlyph cx={cx} cy={cy} damaged={damaged} isPrimary={isPrimary} />;
    case "entity":
      return <EntityGlyph cx={cx} cy={cy} damaged={damaged} />;
    case "repository":
      return <RepositoryGlyph cx={cx} cy={cy} damaged={damaged} />;
    case "database":
      return <DatabaseGlyph cx={cx} cy={cy} damaged={damaged} />;
    default:
      return <GenericGlyph cx={cx} cy={cy} damaged={damaged} />;
  }
}

export const ROLE_LABEL: Partial<Record<BuildingRole, string>> = {
  entry: "entry point",
  controller: "entry point",
  handler: "entry point",
  service: "central hub",
  entity: "app/data boundary",
  repository: "persistence interface",
  database: "underlying infrastructure",
  middleware: "related, not on this path",
  "external-api": "external interface",
  event: "event",
  component: "view / component",
  hook: "shared logic",
};
