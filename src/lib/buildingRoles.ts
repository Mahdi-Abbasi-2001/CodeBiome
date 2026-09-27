import { classifyLayer } from "./classifyLayer";
import type { FlowStepKind } from "@/types/flow";
import type { RiskIndicator } from "@/types/knowledge-model";

/**
 * The architectural role a file plays inside a domain — the same
 * per-file classification the Flow lens already uses (`classifyLayer`),
 * plus "middleware" for the one role Flow doesn't need to distinguish
 * (a middleware never anchors a flow chain, but it matters a great deal
 * for "this belongs on a side branch, not the main sequence").
 */
export type BuildingRole = FlowStepKind | "middleware" | "component" | "hook";

const MIDDLEWARE_PATTERN = /(^|[/_.-])middlewares?([/_-]|\.|$)/i;
const HOOK_FILENAME_PATTERN = /^use[A-Z0-9]/;
const COMPONENT_DIR_PATTERN = /(^|[/_.-])components?([/_-]|\.|$)/i;
// Plenty of real UI codebases (this project's own recommended demo repo
// among them) put view files directly in a feature folder with no
// components/ subdirectory at all — PascalCase-named JS/TS is the one
// convention that still identifies them. Same disclosed-heuristic
// tradeoff as every other pattern here, not a claim of universal coverage.
const PASCAL_CASE_FILENAME_PATTERN = /^[A-Z][A-Za-z0-9]*\.(jsx?|tsx?)$/;

/**
 * classifyLayer (server/flows/inferFlows.ts) only recognizes backend-shaped
 * roles (controller/service/entity/…) — a domain that's entirely frontend
 * code got NOTHING recognized there, so the domain view rendered as an
 * empty "no recognizable architectural roles" district even for a real,
 * substantial React/Vue client folder. Tried only after classifyLayer comes
 * back with its "nothing matched" default, so a backend role never loses to
 * a frontend guess.
 */
function classifyFrontendRole(path: string): "hook" | "component" | null {
  const fileName = path.split("/").pop() ?? path;
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (HOOK_FILENAME_PATTERN.test(stem)) return "hook";
  if (COMPONENT_DIR_PATTERN.test(path)) return "component";
  if (PASCAL_CASE_FILENAME_PATTERN.test(fileName)) return "component";
  return null;
}

export function classifyFileRole(path: string): BuildingRole {
  if (MIDDLEWARE_PATTERN.test(path)) return "middleware";
  const backendRole = classifyLayer(path);
  if (backendRole !== "function") return backendRole;
  return classifyFrontendRole(path) ?? "function";
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

/**
 * Every role worth placing as a landmark at all — on the main sequence, or
 * a recognized side branch. "component"/"hook" deliberately stay OFF
 * MAIN_SEQUENCE_ORDER (never a single-line avenue stop): a real frontend
 * domain can have dozens of components, and the side-branch layout already
 * spreads large counts across multiple rings (see domainSequence.ts) — the
 * avenue's single-line lateral spread was never built to hold that many.
 */
export function isRecognizedRole(role: BuildingRole): boolean {
  return isMainSequenceRole(role) || role === "middleware" || role === "event" || role === "component" || role === "hook";
}

/** Framework wiring (module registration, barrel exports) — real files, but not architecturally meaningful structures of their own. */
export function isWiringOnly(path: string): boolean {
  return /\.module\.ts$/i.test(path) || /(^|\/)index\.ts$/i.test(path);
}

export function hasStructuralRisk(risk: RiskIndicator[]): boolean {
  return risk.length > 0;
}
