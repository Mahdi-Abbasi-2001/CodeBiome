import { classifyLayer } from "@/server/flows/inferFlows";
import type { FlowStepKind } from "@/types/flow";
import type { RiskIndicator } from "@/types/knowledge-model";

/**
 * The architectural role a file plays inside a domain — the same
 * per-file classification the Flow lens already uses (`classifyLayer`),
 * plus "middleware" for the one role Flow doesn't need to distinguish
 * (a middleware never anchors a flow chain, but it matters a great deal
 * for "this belongs on a side branch, not the main sequence").
 */
export type BuildingRole = FlowStepKind | "middleware";

const MIDDLEWARE_PATTERN = /(^|[/_.-])middlewares?([/_-]|\.|$)/i;

export function classifyFileRole(path: string): BuildingRole {
  if (MIDDLEWARE_PATTERN.test(path)) return "middleware";
  return classifyLayer(path);
}

/**
 * Where a role sits along the district's main avenue — entrance, hub,
 * data boundary, persistence interface, infrastructure. Roles absent from
 * this map (function/event/unknown/middleware) never anchor the main
 * sequence; they place laterally or fork onto a side branch instead.
 */
export const MAIN_SEQUENCE_ORDER: Partial<Record<BuildingRole, number>> = {
  entry: 0,
  controller: 0,
  handler: 0,
  service: 1,
  entity: 2,
  repository: 3,
  database: 4,
  "external-api": 4,
};

export function isMainSequenceRole(role: BuildingRole): boolean {
  return MAIN_SEQUENCE_ORDER[role] !== undefined;
}

/** Framework wiring (module registration, barrel exports) — real files, but not architecturally meaningful structures of their own. */
export function isWiringOnly(path: string): boolean {
  return /\.module\.ts$/i.test(path) || /(^|\/)index\.ts$/i.test(path);
}

export function hasStructuralRisk(risk: RiskIndicator[]): boolean {
  return risk.length > 0;
}
