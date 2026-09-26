import { classifyLayer } from "@/server/flows/inferFlows";
import type { FlowStepKind } from "@/types/flow";
import type { RiskIndicator } from "@/types/knowledge-model";

/**
 * The architectural ROLE of a single file — what shape/structure it becomes
 * in the World renderer (src/world-engine/buildings.tsx). Reuses the exact
 * same deterministic, path-pattern classification the Flow lens already
 * uses for its steps (`classifyLayer`, src/server/flows/inferFlows.ts) —
 * "architectural role detection should derive from the existing repository
 * data/classification" (no second, ad-hoc classifier). `middleware` is the
 * one addition on top, purely for the renderer: Flow inference has no use
 * for a "this branches off the main path" distinction, but the building
 * system does.
 */
export type BuildingRole = FlowStepKind | "middleware";

const MIDDLEWARE_PATTERN = /(^|[/_.-])middlewares?([/_-]|\.|$)/i;

export function classifyFileRole(path: string): BuildingRole {
  if (MIDDLEWARE_PATTERN.test(path)) return "middleware";
  return classifyLayer(path);
}

/**
 * Roles that form the MAIN AVENUE — the literal architectural sequence
 * "entrance -> application hub -> data boundary -> persistence interface ->
 * infrastructure" (product brief §8). Lower number = earlier on the
 * avenue. Roles absent from this map (`middleware`, `event`, `unknown`,
 * generic `function`) are SIDE BRANCHES — they never sit on the main
 * chain, matching "AuthMiddleware should branch from the main avenue
 * rather than appearing as another step in the registration chain."
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

/** True for a role that should never get its own building at all — pure wiring/DI glue, not an architectural concept (product brief §22: "every visual element should communicate something"). */
export function isWiringOnly(path: string): boolean {
  return /(^|[/_.-])(module|index)\.[jt]sx?$/i.test(path);
}

export function hasStructuralRisk(risk: RiskIndicator[]): boolean {
  return risk.some((r) => r.kind === "dead-code-candidate" || r.kind === "deprecated-pattern" || r.severity === "high");
}
