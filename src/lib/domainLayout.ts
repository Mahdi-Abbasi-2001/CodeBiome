import type { Domain } from "./domains";

export type Vec2 = [number, number];

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPACING = 118;

/** A district's footprint radius — scales with its size signal, floored so even a single-module domain reads as a real district. */
export function domainRadius(domain: Domain): number {
  return 46 + Math.sqrt(domain.footprint) * 24;
}

/**
 * Places every domain on the ground plane with a bounded phyllotaxis
 * spiral — deterministic (the same domain set always lays out the same
 * way), and `O(sqrt(count))` growth so a repository with a dozen domains
 * still fits in one frame instead of spiraling out indefinitely. Isolated
 * domains (no bridge to anything) are laid out separately by the caller as
 * a disconnected fragment, per the "cut off, no bridge" treatment.
 */
export function layoutDomains(domains: Domain[]): Map<string, Vec2> {
  const positions = new Map<string, Vec2>();
  domains.forEach((domain, i) => {
    const radius = i === 0 ? 0 : SPACING * Math.sqrt(i + 0.5) + domainRadius(domain) * 0.5;
    const angle = i * GOLDEN_ANGLE;
    positions.set(domain.id, [Math.cos(angle) * radius, Math.sin(angle) * radius]);
  });
  return positions;
}

export function maxLayoutRadius(positions: Map<string, Vec2>): number {
  let max = SPACING * 2;
  for (const [x, y] of positions.values()) max = Math.max(max, Math.hypot(x, y));
  return max;
}

/** The gate sits at the world's perimeter — the entry point into the whole repository. */
export function gatePosition(positions: Map<string, Vec2>): Vec2 {
  const radius = maxLayoutRadius(positions) + SPACING * 1.4;
  const angle = Math.PI * 0.72;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/** A domain with no real cross-domain relationship at all — architecturally cut off, rendered as its own disconnected fragment. */
export function isolatedDomainIds(domains: Domain[], connectedDomainIds: Set<string>): Set<string> {
  const isolated = new Set<string>();
  if (domains.length <= 1) return isolated;
  for (const d of domains) if (!connectedDomainIds.has(d.id)) isolated.add(d.id);
  return isolated;
}

function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Vec2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function centroid(points: Vec2[]): Vec2 {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Vec2, [0, 0] as Vec2);
  return [sum[0] / points.length, sum[1] / points.length];
}

/**
 * A smooth, organic closed outline around a set of points with padding —
 * "one continuous landmass" instead of a hard polygon. Expands the convex
 * hull outward from its centroid, then rounds every corner by drawing a
 * quadratic curve through the midpoints of consecutive edges (a standard
 * "midpoint smoothing" trick) so the shape reads as terrain, not a raw
 * geometric hull.
 */
export function landmassOutline(points: Vec2[], padding: number): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x - padding} ${y} A ${padding} ${padding} 0 1 0 ${x + padding} ${y} A ${padding} ${padding} 0 1 0 ${x - padding} ${y} Z`;
  }
  const hull = convexHull(points);
  const c = centroid(hull);
  const expanded = hull.map(([x, y]) => {
    const dx = x - c[0];
    const dy = y - c[1];
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * padding, y + (dy / len) * padding] as Vec2;
  });

  const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = expanded.length;
  const start = mid(expanded[n - 1], expanded[0]);
  let d = `M ${start[0]} ${start[1]} `;
  for (let i = 0; i < n; i++) {
    const p = expanded[i];
    const next = expanded[(i + 1) % n];
    const m = mid(p, next);
    d += `Q ${p[0]} ${p[1]} ${m[0]} ${m[1]} `;
  }
  return d + "Z";
}
