import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { Domain } from "./domains";
import { classifyFileRole, isMainSequenceRole, isRecognizedRole, isWiringOnly, hasStructuralRisk, MAIN_SEQUENCE_ORDER, type BuildingRole } from "./buildingRoles";

export type Vec2 = [number, number];

export interface PlacedBuilding {
  fileId: string;
  path: string;
  moduleId: string;
  role: BuildingRole;
  position: Vec2;
  onMainSequence: boolean;
  order: number | null;
  damaged: boolean;
  /**
   * True when this building is one of a genuinely crowded group — spiral
   * placement was needed at all (main-sequence overflow), or there are
   * enough branches that a full-size label would overlap its neighbors
   * regardless of how well the POSITIONS are spread. DomainView.tsx uses
   * this to shrink the label rather than pretend a wide label fits: no
   * amount of position math makes a 220px-wide label fit in the ~57px of
   * clearance seven real landmarks can have in a fixed-size canvas corner.
   */
  compact: boolean;
}

export interface YardInfo {
  /** Bounding box of the recessed persistence tier. */
  x: number;
  y: number;
  width: number;
  height: number;
  wallY: number;
  rampX: number;
}

export interface PlazaInfo {
  center: Vec2;
  radius: number;
}

export interface DomainSequence {
  buildings: PlacedBuilding[];
  /** Waypoints the main avenue threads through, in order. */
  avenuePoints: Vec2[];
  /** One entry per side branch: the fork point on the avenue, and the branch's own building. */
  branches: Array<{ from: Vec2; building: PlacedBuilding }>;
  yard: YardInfo | null;
  plaza: PlazaInfo | null;
  junction: Vec2 | null;
  isGeneric: boolean;
  internalEdgeCount: number;
  riskFileCount: number;
}

// Canonical waypoints for the five main-sequence stops, in the same
// 1440x900 ground the rest of the World UI uses. Not every domain has a
// building at every stop — the avenue only threads through the ones that
// exist, so a 2-stop domain gets a short, direct avenue rather than empty
// waypoints.
const ORDER_WAYPOINTS: Record<number, Vec2> = {
  0: [430, 740], // entrance
  1: [720, 520], // hub / plaza
  2: [1040, 450], // data boundary
  3: [1110, 635], // persistence interface, at the wall
  4: [1110, 748], // infrastructure, in the yard
};
// A domain with only ONE present main-sequence stop (or a branch fork with
// nothing to point away from) has no real "next waypoint" to derive a
// direction from — dx/dy both come out 0, which used to collapse every
// sibling/branch at that spot onto the exact same point instead of spreading
// them. Falls back to the canonical entrance->hub direction so there's
// always a real 2D direction to fan out along.
const FALLBACK_FORWARD: Vec2 = [ORDER_WAYPOINTS[1][0] - ORDER_WAYPOINTS[0][0], ORDER_WAYPOINTS[1][1] - ORDER_WAYPOINTS[0][1]];
const YARD_ORDERS = new Set([3, 4]);
// Wide enough that two neighbors' 220px-wide labels (DomainView.tsx) don't
// sit on top of each other — 90 was narrower than the label itself.
const LATERAL_SPACING = 150;
// Total width a row of siblings at one stop is allowed to occupy, however
// many there are — the fixed 1440x900 canvas (DomainView.tsx) clips
// anything past its edge, so unbounded growth eventually renders off-screen
// rather than just crowded.
const MAX_LATERAL_SPREAD = 560;
// Below this, a straight line of siblings reads as crowded/overlapping
// (each has a 220px-wide label) well before it's actually unsafe — past
// this point a stop switches to spiral placement instead of compressing further.
const MIN_READABLE_SPACING = 110;
// Below THIS, DomainView.tsx's normal 220px-wide, two-line label starts
// visibly overlapping its neighbors even once the POSITIONS are spread as
// well as this file can manage — found live, comparing a 45-item group at
// ~74px (its full labels read fine — short names, and 220px is a box, not
// how wide the actual centered text renders) against a 7-item group at
// ~57px (visibly broken — much longer names, e.g. "ProductController").
// Lower than MIN_READABLE_SPACING on purpose: that one decides whether
// POSITIONING needs to change; this one decides whether the LABEL does,
// checked separately against where things actually ended up.
const COMPACT_LABEL_THRESHOLD = 65;
// A real domain's files rarely match a backend-shaped role at all (a React
// feature folder full of components/hooks is entirely "function" — every
// one of them becomes a branch candidate here), so branch counts in the
// dozens are the common case, not an edge case.
const CANVAS_WIDTH = 1440;
const CANVAS_HEIGHT = 900;
const EDGE_MARGIN = 90; // roughly half a building's own footprint plus its label

function isYardOrder(order: number | null): boolean {
  return order !== null && YARD_ORDERS.has(order);
}

function minPairwiseDistance(positions: Vec2[]): number {
  if (positions.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const d = Math.hypot(positions[i][0] - positions[j][0], positions[i][1] - positions[j][1]);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * The largest |offset| such that `point + t*dir` stays within the canvas
 * (minus EDGE_MARGIN) for every t in [-offset, offset] — i.e. safe for a
 * row of siblings laid out symmetrically around `point` along `dir` in
 * EITHER direction, not just one. A waypoint sitting close to an edge (the
 * entrance, [430,740], is only 160px above the bottom edge) can have a very
 * different safe distance depending on which way `dir` actually points —
 * this is computed per-call, not assumed from the point alone.
 */
function maxSymmetricOffset(point: Vec2, dir: Vec2): number {
  const axisLimit = (coord: number, d: number, high: number): number => {
    if (Math.abs(d) < 1e-6) return Infinity;
    return Math.min(high - EDGE_MARGIN - coord, coord - EDGE_MARGIN) / Math.abs(d);
  };
  return Math.max(
    40,
    Math.min(axisLimit(point[0], dir[0], CANVAS_WIDTH), axisLimit(point[1], dir[1], CANVAS_HEIGHT))
  );
}

// The standard sunflower/phyllotaxis spacing constant: placing point `i` of
// `n` at angle `i * GOLDEN_ANGLE`, radius scaled by `sqrt((i+0.5)/n)`, fills
// a disk with close-to-even spacing between every point and never repeats
// an angle for any realistic n — an EARLIER version of this (fixed angle
// step per fixed-size ring, ring radius growing by a flat amount) could
// still land two rings at the identical radius when a tight anchor forced
// their spacing to ~0, and its per-ring angle stagger wasn't reliably enough
// separation on its own (found live: two items only ~5px apart). This has no
// such failure mode — every point gets a genuinely distinct radius.
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * `index`'s position in a phyllotaxis spiral around `anchor`, along
 * `primaryDir`/`secondaryDir` — an ELLIPSE, not a circle: `primaryRadius`
 * and `secondaryRadius` are each that direction's own safe distance from
 * `anchor` (see maxSymmetricOffset) and can be very different (a waypoint
 * near the canvas edge has much less room in one direction than the
 * other — using their shared minimum as a single circular radius wasted
 * all the extra room the roomier direction actually had, and still left
 * a crowded result: confirmed live, 7 siblings at ~40px apart where the
 * tight axis alone allowed room for ~70px, the other for ~163px).
 */
function spiralPosition(
  anchor: Vec2,
  primaryDir: Vec2,
  secondaryDir: Vec2,
  index: number,
  count: number,
  primaryRadius: number,
  secondaryRadius: number
): Vec2 {
  const t = Math.sqrt((index + 0.5) / count);
  const angle = index * GOLDEN_ANGLE;
  const rp = primaryRadius * t * Math.cos(angle);
  const rs = secondaryRadius * t * Math.sin(angle);
  const x = anchor[0] + primaryDir[0] * rp - secondaryDir[0] * rs;
  const y = anchor[1] + primaryDir[1] * rp - secondaryDir[1] * rs;
  // primaryRadius/secondaryRadius are each safe ALONE, but a rotated
  // ellipse's extent along a single screen axis (x or y) isn't simply
  // bounded by either one — the two contributions can add up in the same
  // screen direction. Clamping the final point is the one guarantee that
  // doesn't depend on getting that trigonometry exactly right: whatever the
  // spiral math produces, the result never actually leaves the canvas.
  return [
    Math.min(CANVAS_WIDTH - EDGE_MARGIN, Math.max(EDGE_MARGIN, x)),
    Math.min(CANVAS_HEIGHT - EDGE_MARGIN, Math.max(EDGE_MARGIN, y)),
  ];
}

export function computeDomainSequence(domain: Domain, knowledgeModel: RepositoryKnowledgeModel): DomainSequence {
  const moduleById = new Map(knowledgeModel.modules.map((m) => [m.id, m]));
  const fileById = new Map(knowledgeModel.files.map((f) => [f.id, f]));

  const candidateFiles: Array<{ fileId: string; path: string; moduleId: string }> = [];
  for (const moduleId of domain.moduleIds) {
    const mod = moduleById.get(moduleId);
    if (!mod) continue;
    for (const fileId of mod.fileIds) {
      const file = fileById.get(fileId);
      if (!file || isWiringOnly(file.path) || file.type !== "source") continue;
      candidateFiles.push({ fileId, path: file.path, moduleId });
    }
  }

  const classified = candidateFiles.map((f) => ({ ...f, role: classifyFileRole(f.path) }));
  const recognized = classified.filter((f) => isRecognizedRole(f.role));

  const riskFileCount = recognized.filter((f) => {
    const file = fileById.get(f.fileId);
    return file ? hasStructuralRisk(file.riskIndicators) : false;
  }).length;

  if (recognized.length === 0) {
    return {
      buildings: [],
      avenuePoints: [],
      branches: [],
      yard: null,
      plaza: null,
      junction: null,
      isGeneric: true,
      internalEdgeCount: 0,
      riskFileCount: 0,
    };
  }

  const onMain = recognized.filter((f) => isMainSequenceRole(f.role));
  const branchCandidates = recognized.filter((f) => !isMainSequenceRole(f.role));

  const byOrder = new Map<number, typeof onMain>();
  for (const f of onMain) {
    const order = MAIN_SEQUENCE_ORDER[f.role]!;
    const list = byOrder.get(order) ?? [];
    list.push(f);
    byOrder.set(order, list);
  }

  const presentOrders = [...byOrder.keys()].sort((a, b) => a - b);
  const avenuePoints = presentOrders.map((o) => ORDER_WAYPOINTS[o]);

  const isDamaged = (fileId: string) => {
    const file = fileById.get(fileId);
    return file ? hasStructuralRisk(file.riskIndicators) : false;
  };

  const buildings: PlacedBuilding[] = [];
  presentOrders.forEach((order, i) => {
    const files = byOrder.get(order)!;
    const point = ORDER_WAYPOINTS[order];
    const prev = avenuePoints[i - 1] ?? point;
    const next = avenuePoints[i + 1] ?? point;
    // Perpendicular to the local avenue direction, so siblings at the same
    // stop spread sideways rather than stacking on the road itself.
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    if (dx === 0 && dy === 0) [dx, dy] = FALLBACK_FORWARD; // only one stop present at all — no real direction to derive
    const len = Math.hypot(dx, dy) || 1;
    const perp: Vec2 = [-dy / len, dx / len];
    // Same fixed-canvas constraint as the branch rings below: a stop with
    // many siblings spreading at a flat LATERAL_SPACING each would eventually
    // run past the edge of the map — and since perp isn't always sideways
    // (a waypoint with only ONE neighbor takes its perp from that single
    // direction, which can point mostly vertically), the safe distance
    // depends on where THIS stop actually is, not a single global constant.
    const maxOffset = Math.min(MAX_LATERAL_SPREAD / 2, maxSymmetricOffset(point, perp));
    const spacing = files.length > 1 ? Math.min(LATERAL_SPACING, (2 * maxOffset) / (files.length - 1)) : LATERAL_SPACING;
    // A tight corner (the entrance waypoint has as little as ~70px of
    // headroom in some directions) forces `spacing` down to keep everyone
    // on-screen — comfortably safe, but uncomfortably CROWDED, well before
    // it's actually unsafe. Past that point, wrap into rings around the
    // stop (using both perp and the avenue direction, not just one line) —
    // the same mechanism branches already use — instead of continuing to
    // compress every sibling onto one increasingly narrow line.
    const useSpiral = files.length > 1 && spacing < MIN_READABLE_SPACING;
    const forwardUnit: Vec2 = [dx / len, dy / len];
    // The avenue direction usually has more real room than the sideways one
    // does (a waypoint near an edge is near it along ONE axis, not both) —
    // an ellipse using each direction's own safe distance uses that extra
    // room instead of treating both directions as equally cramped.
    const forwardOffset = useSpiral ? Math.min(MAX_LATERAL_SPREAD / 2, maxSymmetricOffset(point, forwardUnit)) : 0;

    const positions = files.map((f, j): Vec2 =>
      useSpiral
        ? spiralPosition(point, perp, forwardUnit, j, files.length, maxOffset, forwardOffset)
        : [point[0] + perp[0] * (j - (files.length - 1) / 2) * spacing, point[1] + perp[1] * (j - (files.length - 1) / 2) * spacing]
    );
    // Whether the label needs to shrink is a question about the ACTUAL
    // achieved spacing, not the item count or which placement strategy ran —
    // checked against the real computed positions rather than estimated,
    // so a well-spread stop with a wide safe area doesn't shrink
    // unnecessarily just because it also happened to need the spiral.
    const compact = minPairwiseDistance(positions) < COMPACT_LABEL_THRESHOLD;

    files.forEach((f, j) => {
      buildings.push({
        fileId: f.fileId,
        path: f.path,
        moduleId: f.moduleId,
        role: f.role,
        position: positions[j],
        onMainSequence: true,
        order,
        damaged: isDamaged(f.fileId),
        compact,
      });
    });
  });

  // Side branches fork off the avenue near its start — "related, but not
  // part of the primary architectural sequence." A domain with NO
  // main-sequence files at all (a pure-frontend client/ folder, all
  // components/hooks) has no real avenue point to fork from, so it falls
  // back to a fixed one — and that fallback needs real room around it,
  // since this is exactly the shape most likely to have MANY branches. The
  // entrance waypoint ([430,740]) sits only 160px above the canvas's bottom
  // edge; the hub ([720,520]) is far more central on every side (confirmed
  // live: using the entrance here left only ~124px of safe radius for the
  // demo repo's 45-component client domain, collapsing every ring onto the
  // same distance from the junction instead of spreading them; the hub
  // leaves ~290px).
  const forkPoint = avenuePoints[0] ?? ORDER_WAYPOINTS[1];
  const forkTarget = avenuePoints[1] ?? forkPoint;
  let forkDx = forkTarget[0] - forkPoint[0];
  let forkDy = forkTarget[1] - forkPoint[1];
  if (forkDx === 0 && forkDy === 0) [forkDx, forkDy] = FALLBACK_FORWARD; // only one main-sequence stop exists — nothing to fork away from
  const forkLen = Math.hypot(forkDx, forkDy) || 1;
  const forkPerp: Vec2 = [-forkDy / forkLen, forkDx / forkLen];
  const junction: Vec2 = [forkPoint[0] + (forkDx / forkLen) * 90, forkPoint[1] + (forkDy / forkLen) * 90];

  const forkForward: Vec2 = [forkDx / forkLen, forkDy / forkLen];
  // Same ellipse reasoning as the overcrowded main-sequence stop below: use
  // each axis's own safe distance from the junction, not their shared
  // minimum as one circular radius.
  const branchPerpRadius = Math.min(320, maxSymmetricOffset(junction, forkPerp));
  const branchForwardRadius = Math.min(320, maxSymmetricOffset(junction, forkForward));

  const branchPositions = branchCandidates.map(
    (f, i): Vec2 => spiralPosition(junction, forkPerp, forkForward, i, branchCandidates.length, branchPerpRadius, branchForwardRadius)
  );
  // Checked against the real computed positions, same as the main-sequence
  // stop above — a handful of branches with a wide safe area to spiral
  // across can end up just as comfortably spaced as a normal stop.
  const branchesCompact = minPairwiseDistance(branchPositions) < COMPACT_LABEL_THRESHOLD;

  const branches = branchCandidates.map((f, i) => {
    const building: PlacedBuilding = {
      fileId: f.fileId,
      path: f.path,
      moduleId: f.moduleId,
      role: f.role,
      position: branchPositions[i],
      onMainSequence: false,
      order: null,
      damaged: isDamaged(f.fileId),
      compact: branchesCompact,
    };
    return { from: junction, building };
  });
  for (const b of branches) buildings.push(b.building);

  const hasYard = presentOrders.some(isYardOrder);
  const yard: YardInfo | null = hasYard
    ? { x: 940, y: 660, width: 340, height: 190, wallY: 615, rampX: 1110 }
    : null;

  const hasHub = presentOrders.includes(1);
  const plaza: PlazaInfo | null = hasHub ? { center: ORDER_WAYPOINTS[1], radius: 180 } : null;

  const fileIdSet = new Set(recognized.map((f) => f.fileId));
  let internalEdgeCount = 0;
  for (const edge of knowledgeModel.dependencies) {
    if (edge.fromKind === "file" && edge.toKind === "file" && fileIdSet.has(edge.fromId) && fileIdSet.has(edge.toId)) {
      internalEdgeCount++;
    }
  }

  return {
    buildings,
    avenuePoints,
    branches,
    yard,
    plaza,
    junction: branches.length > 0 ? junction : null,
    isGeneric: false,
    internalEdgeCount,
    riskFileCount,
  };
}

export function buildingForFile(sequence: DomainSequence, fileId: string): PlacedBuilding | null {
  return sequence.buildings.find((b) => b.fileId === fileId) ?? null;
}
