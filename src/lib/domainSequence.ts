import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { Domain } from "./domains";
import { classifyFileRole, isMainSequenceRole, isWiringOnly, hasStructuralRisk, MAIN_SEQUENCE_ORDER, type BuildingRole } from "./buildingRoles";

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
const YARD_ORDERS = new Set([3, 4]);
const LATERAL_SPACING = 90;
const BRANCH_DISTANCE = 150;

function isYardOrder(order: number | null): boolean {
  return order !== null && YARD_ORDERS.has(order);
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
  const recognized = classified.filter((f) => isMainSequenceRole(f.role) || f.role === "middleware" || f.role === "event");

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
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const perp: Vec2 = [-dy / len, dx / len];

    files.forEach((f, j) => {
      const offset = (j - (files.length - 1) / 2) * LATERAL_SPACING;
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
  const forkDx = forkTarget[0] - forkPoint[0];
  const forkDy = forkTarget[1] - forkPoint[1];
  const forkLen = Math.hypot(forkDx, forkDy) || 1;
  const forkPerp: Vec2 = [-forkDy / forkLen, forkDx / forkLen];
  const junction: Vec2 = [forkPoint[0] + (forkDx / forkLen) * 90, forkPoint[1] + (forkDy / forkLen) * 90];

  const branches = branchCandidates.map((f, i) => {
    const angleOffset = (i - (branchCandidates.length - 1) / 2) * 0.5;
    const dirX = forkPerp[0] * Math.cos(angleOffset) - (forkDx / forkLen) * Math.sin(angleOffset);
    const dirY = forkPerp[1] * Math.cos(angleOffset) - (forkDy / forkLen) * Math.sin(angleOffset);
    const position: Vec2 = [junction[0] + dirX * BRANCH_DISTANCE, junction[1] + dirY * BRANCH_DISTANCE];
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
