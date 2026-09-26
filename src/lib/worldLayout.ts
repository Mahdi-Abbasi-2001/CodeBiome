import type { Domain } from "@/world-engine/domains";

export type Vec3 = [number, number, number];

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPACING = 5.5;

/** A domain terrace's footprint radius on the ground — scales with its size signal, floored so even a single-module domain reads as a real platform. */
export function domainRadius(domain: Domain): number {
  return 2.1 + Math.sqrt(domain.footprint) * 1.15;
}

/**
 * Places domain terraces on the ground plane. Same phyllotaxis spiral (and
 * the same `SPACING * sqrt(i)` growth rate) the original flat per-module
 * layout used — bounded, `O(sqrt(count))` growth, so a repository with a
 * dozen domains still fits in a walkable, visible world instead of spiraling
 * out toward the fog. A modest per-domain footprint bonus (not a cumulative
 * "frontier" that keeps growing with every terrace already placed) gives
 * bigger multi-module domains a little more breathing room without
 * blowing up the overall scale. Deterministic: same domain set (any
 * repository) always lays out the same way.
 */
export function layoutDomains(domains: Domain[]): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  domains.forEach((domain, i) => {
    const radius = i === 0 ? 0 : SPACING * Math.sqrt(i + 0.5) + domainRadius(domain) * 0.4;
    const angle = i * GOLDEN_ANGLE;
    positions.set(domain.id, [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
  });
  return positions;
}

export function maxLayoutRadius(positions: Map<string, Vec3>): number {
  let max = SPACING * 3;
  for (const pos of positions.values()) max = Math.max(max, Math.hypot(pos[0], pos[2]));
  return max;
}

/** The gate sits at the world's perimeter — the avatar's arrival point. */
export function gatePosition(positions: Map<string, Vec3>): Vec3 {
  const radius = maxLayoutRadius(positions) + SPACING * 1.5;
  return [Math.cos(Math.PI * 0.75) * radius, 0, Math.sin(Math.PI * 0.75) * radius];
}
