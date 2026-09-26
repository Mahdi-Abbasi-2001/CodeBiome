import type { RepositoryKnowledgeModel } from "@/types/knowledge-model";
import type { Domain } from "@/world-engine/domains";
import { classifyFileRole, isWiringOnly, MAIN_SEQUENCE_ORDER, isMainSequenceRole, type BuildingRole } from "@/world-engine/buildingRoles";
import type { Vec3 } from "@/lib/worldLayout";

/**
 * The avenue/plaza/yard layout — computed ONCE per domain and reused by
 * BOTH the Architecture view and the Flow lens (product brief §14: "reuse
 * the exact same architectural geometry... do NOT create a second
 * approximation of the flow layout"). All positions are LOCAL to the
 * domain's own center; callers add the domain's world position.
 *
 * "Entrance -> application hub -> data boundary -> persistence interface ->
 * infrastructure" (§8) maps directly to `MAIN_SEQUENCE_ORDER`: local X grows
 * with a role's order (generous, fixed spacing — never packed, per §7), and
 * persistence roles (repository/database, order >= PERSISTENCE_ORDER) drop
 * to a lower Y — the real, recessed "yard" a retaining wall separates from
 * the plaza. Side-branch roles (middleware, event) never sit on this line —
 * they fork from a junction between the entrance and the hub.
 */

const ORDER_SPACING = 6.5;
const LATERAL_SPACING = 2.2;
const BRANCH_DEPTH = 4.5;
const BRANCH_SPACING = 2.4;
const PERSISTENCE_ORDER = 3;
const YARD_DROP = 1.6;

export interface PlacedBuilding {
  fileId: string;
  path: string;
  moduleId: string;
  role: BuildingRole;
  position: Vec3;
  onMainSequence: boolean;
  order: number | null;
}

export interface YardInfo {
  center: Vec3;
  wallCenter: Vec3;
  facingAngle: number;
  width: number;
  depth: number;
  drop: number;
}

export interface PlazaInfo {
  center: Vec3;
  radius: number;
}

export interface DomainSequence {
  buildings: PlacedBuilding[];
  /** The main avenue's own waypoints, in order — what both the Architecture road and the Flow lens's lit route are drawn through. */
  avenuePoints: Vec3[];
  yard: YardInfo | null;
  /** The application-tier deck (entrance/hub/entity, at grade) — a real raised platform the hub sits at the center of, distinct ground treatment from the surrounding district. Null when there's no at-grade main-sequence building to build one around. */
  plaza: PlazaInfo | null;
  /** True only when this domain has no file with a recognizable architectural role at all — the single-generic-building fallback case. */
  isGeneric: boolean;
}

function isRecognizedRole(role: BuildingRole): boolean {
  return isMainSequenceRole(role) || role === "middleware" || role === "event";
}

function orderFor(role: BuildingRole): number | null {
  return MAIN_SEQUENCE_ORDER[role] ?? null;
}

/**
 * Computes every recognized-role file across a domain's member modules and
 * places it along the avenue (main-sequence roles) or off a side branch
 * (middleware/event). Files with no recognizable role (generic
 * helpers/utils, and `.module.ts`/`index.ts` wiring) never get their own
 * building — kept out entirely, not shrunk to fit (§22).
 */
export function computeDomainSequence(domain: Domain, knowledgeModel: RepositoryKnowledgeModel): DomainSequence {
  const moduleById = new Map(knowledgeModel.modules.map((m) => [m.id, m]));
  const candidateFiles: { fileId: string; path: string; moduleId: string }[] = [];
  for (const moduleId of domain.moduleIds) {
    const mod = moduleById.get(moduleId);
    if (!mod) continue;
    for (const fileId of mod.fileIds) {
      if (isWiringOnly(fileId)) continue;
      candidateFiles.push({ fileId, path: fileId, moduleId });
    }
  }

  const recognized = candidateFiles
    .map((f) => ({ ...f, role: classifyFileRole(f.path) }))
    .filter((f) => isRecognizedRole(f.role));

  if (recognized.length === 0) {
    return { buildings: [], avenuePoints: [[0, 0, 0]], yard: null, plaza: null, isGeneric: true };
  }

  // Group main-sequence files by their order, so several files at the same
  // order (e.g. two controllers) spread laterally instead of overlapping.
  const byOrder = new Map<number, typeof recognized>();
  const branches: typeof recognized = [];
  for (const f of recognized) {
    const order = orderFor(f.role);
    if (order === null) {
      branches.push(f);
      continue;
    }
    const list = byOrder.get(order) ?? [];
    list.push(f);
    byOrder.set(order, list);
  }

  const orders = [...byOrder.keys()].sort((a, b) => a - b);
  const buildings: PlacedBuilding[] = [];
  const avenuePoints: Vec3[] = [];

  for (const order of orders) {
    const files = byOrder.get(order)!;
    const x = order * ORDER_SPACING;
    const y = order >= PERSISTENCE_ORDER ? -YARD_DROP : 0;
    const centerOffset = (files.length - 1) / 2;
    files.forEach((f, i) => {
      const z = (i - centerOffset) * LATERAL_SPACING;
      buildings.push({ fileId: f.fileId, path: f.path, moduleId: f.moduleId, role: f.role, position: [x, y, z], onMainSequence: true, order });
    });
    avenuePoints.push([x, y, 0]);
  }

  // Side branches fork from the junction between the first two present
  // orders (entrance -> hub), or from the first present order if there's
  // only one — "AuthMiddleware should branch from the main avenue rather
  // than appearing as another step in the registration chain."
  const junctionX = orders.length >= 2 ? (orders[0] + orders[1]) * 0.5 * ORDER_SPACING : orders.length === 1 ? orders[0] * ORDER_SPACING : 0;
  branches.forEach((f, i) => {
    const z = -(BRANCH_DEPTH + i * BRANCH_SPACING);
    buildings.push({ fileId: f.fileId, path: f.path, moduleId: f.moduleId, role: f.role, position: [junctionX, 0, z], onMainSequence: false, order: null });
  });

  let yard: YardInfo | null = null;
  const persistenceOrders = orders.filter((o) => o >= PERSISTENCE_ORDER);
  if (persistenceOrders.length > 0) {
    const lastAtGrade = orders.filter((o) => o < PERSISTENCE_ORDER).at(-1) ?? persistenceOrders[0] - 1;
    const wallX = (lastAtGrade + persistenceOrders[0]) * 0.5 * ORDER_SPACING;
    const yardMinX = persistenceOrders[0] * ORDER_SPACING - ORDER_SPACING * 0.5;
    const yardMaxX = persistenceOrders.at(-1)! * ORDER_SPACING + ORDER_SPACING * 0.5;
    const yardWidth = Math.max(ORDER_SPACING * 1.3, yardMaxX - yardMinX + ORDER_SPACING);
    yard = {
      center: [(yardMinX + yardMaxX) / 2, 0, 0],
      wallCenter: [wallX, 0, 0],
      facingAngle: Math.PI / 2,
      width: yardWidth,
      depth: LATERAL_SPACING * 3.5,
      drop: YARD_DROP,
    };
  }

  // The plaza — a real raised deck under the at-grade application tier,
  // centered on the hub (service) when present, else the at-grade
  // midpoint. Radius covers every at-grade building plus its own margin,
  // so the deck genuinely contains them rather than implying it by color
  // alone.
  let plaza: PlazaInfo | null = null;
  const atGradeOrders = orders.filter((o) => o < PERSISTENCE_ORDER);
  if (atGradeOrders.length > 0) {
    const hubOrder = MAIN_SEQUENCE_ORDER.service ?? 1;
    const centerX = atGradeOrders.includes(hubOrder) ? hubOrder * ORDER_SPACING : ((atGradeOrders[0] + atGradeOrders.at(-1)!) / 2) * ORDER_SPACING;
    const spread = (atGradeOrders.at(-1)! - atGradeOrders[0]) * ORDER_SPACING;
    plaza = { center: [centerX, 0, 0], radius: Math.max(ORDER_SPACING * 0.85, spread / 2 + ORDER_SPACING * 0.6) };
  }

  return { buildings, avenuePoints, yard, plaza, isGeneric: false };
}

export function buildingForFile(sequence: DomainSequence, fileId: string): PlacedBuilding | null {
  return sequence.buildings.find((b) => b.fileId === fileId) ?? null;
}
