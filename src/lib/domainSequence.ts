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
const BRANCH_DISTANCE = 150;
// A real domain's files rarely match a backend-shaped role at all (a React
// feature folder full of components/hooks is entirely "function" — every
// one of them becomes a branch candidate here), so branch counts in the
// dozens are the common case, not an edge case. A single ring at a fixed
// angle step wraps past a full 2π turn well before then, landing several
// files on the exact same point. Rings keep each one spread out: a fixed
// number of items per ring, radius growing per ring.
const BRANCH_ITEMS_PER_RING = 6;
// The world canvas is a FIXED 1440x900 viewBox with overflow clipped, not a
// pannable/zoomable one (DomainView.tsx) — a ring radius that keeps growing
// by a flat amount per ring (the original version of this fix) eventually
// pushes outer rings past the edge of that box entirely, invisible rather
// than just crowded. Ring spacing is computed per-domain instead (below) so
// the OUTERMOST ring never exceeds a radius safe for THAT domain's own
// junction position, regardless of how many branches there are — a domain
// with many branches gets tighter rings, not ones that run off the map.
const CANVAS_WIDTH = 1440;
const CANVAS_HEIGHT = 900;
const EDGE_MARGIN = 90; // roughly half a building's own footprint plus its label
const RING_ANGLE_STAGGER = 0.18; // radians — see its use below

function isYardOrder(order: number | null): boolean {
  return order !== null && YARD_ORDERS.has(order);
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

    files.forEach((f, j) => {
      const offset = (j - (files.length - 1) / 2) * spacing;
      const position: Vec2 = [point[0] + perp[0] * offset, point[1] + perp[1] * offset];
      buildings.push({
        fileId: f.fileId,
        path: f.path,
        moduleId: f.moduleId,
        role: f.role,
        position,
        onMainSequence: true,
        order,
        damaged: isDamaged(f.fileId),
      });
    });
  });

  // Side branches fork off the avenue near its start — "related, but not
  // part of the primary architectural sequence."
  const forkPoint = avenuePoints[0] ?? ORDER_WAYPOINTS[0];
  const forkTarget = avenuePoints[1] ?? forkPoint;
  let forkDx = forkTarget[0] - forkPoint[0];
  let forkDy = forkTarget[1] - forkPoint[1];
  if (forkDx === 0 && forkDy === 0) [forkDx, forkDy] = FALLBACK_FORWARD; // only one main-sequence stop exists — nothing to fork away from
  const forkLen = Math.hypot(forkDx, forkDy) || 1;
  const forkPerp: Vec2 = [-forkDy / forkLen, forkDx / forkLen];
  const junction: Vec2 = [forkPoint[0] + (forkDx / forkLen) * 90, forkPoint[1] + (forkDy / forkLen) * 90];

  // The fan can point in any direction depending on this domain's own
  // fork/forward vectors, so the safe bound is the junction's distance to
  // the NEAREST canvas edge, not a single constant tuned against one
  // waypoint — the yard-corner waypoint ([1110,748]) has far less room on
  // two sides than the entrance ([430,740]) does.
  const maxRadiusFromEdges = Math.min(
    junction[0] - EDGE_MARGIN,
    CANVAS_WIDTH - EDGE_MARGIN - junction[0],
    junction[1] - EDGE_MARGIN,
    CANVAS_HEIGHT - EDGE_MARGIN - junction[1]
  );
  // Never actually exceed the edge-safe distance, even for ring 0 — a
  // waypoint near the bottom edge (the entrance, [430,740]) has less than
  // BRANCH_DISTANCE's worth of room below it, so BRANCH_DISTANCE can't be
  // treated as an unconditional floor the way MAX_BRANCH_RADIUS used to be.
  const safeMaxRadius = Math.max(40, Math.min(320, maxRadiusFromEdges));
  const baseRadius = Math.min(BRANCH_DISTANCE, safeMaxRadius);

  const ringCount = Math.max(1, Math.ceil(branchCandidates.length / BRANCH_ITEMS_PER_RING));
  const ringSpacing = ringCount > 1 ? (safeMaxRadius - baseRadius) / (ringCount - 1) : 0;

  const branches = branchCandidates.map((f, i) => {
    const ring = Math.floor(i / BRANCH_ITEMS_PER_RING);
    const ringStart = ring * BRANCH_ITEMS_PER_RING;
    const itemsInRing = Math.min(BRANCH_ITEMS_PER_RING, branchCandidates.length - ringStart);
    const posInRing = i - ringStart;
    // The ring-to-ring rotation keeps rings from exactly overlapping when a
    // tight junction (near a canvas edge) has forced ringSpacing to ~0 —
    // without it, a full ring reusing the exact same angles as the ring
    // "before" it at the same radius would land every item on a duplicate
    // of an earlier one instead of a merely tightly-packed new spot.
    const angleOffset = (posInRing - (itemsInRing - 1) / 2) * 0.5 + ring * RING_ANGLE_STAGGER;
    const radius = baseRadius + ring * ringSpacing;
    const dirX = forkPerp[0] * Math.cos(angleOffset) - (forkDx / forkLen) * Math.sin(angleOffset);
    const dirY = forkPerp[1] * Math.cos(angleOffset) - (forkDy / forkLen) * Math.sin(angleOffset);
    const position: Vec2 = [junction[0] + dirX * radius, junction[1] + dirY * radius];
    const building: PlacedBuilding = {
      fileId: f.fileId,
      path: f.path,
      moduleId: f.moduleId,
      role: f.role,
      position,
      onMainSequence: false,
      order: null,
      damaged: isDamaged(f.fileId),
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
