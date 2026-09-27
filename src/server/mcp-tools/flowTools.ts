import type { ModuleFact } from "@/types/knowledge-model";
import type { ConfidenceLevel } from "@/types/flow";
import { resolveFlowModel, resolveKnowledgeModel } from "./resolveRepository";
import { findModule, moduleRef } from "./moduleLookup";
import { EntityNotFoundError } from "./errors";

/**
 * Flow-intelligence tools (docs/BOB_INTEGRATION.md §"Flow intelligence
 * tools"). These expose the EXISTING static flow system (src/server/flows/
 * inferFlows.ts) and the EXISTING module dependency graph already computed
 * on every ModuleFact (`dependencyIds`/`dependentIds`) — no second graph,
 * no new inference engine. Every result keeps the same "statically
 * reconstructed, not a runtime trace" framing the UI already uses.
 */

export interface FlowSummary {
  id: string;
  name: string;
  confidence: ConfidenceLevel;
  entryPointId: string;
  stepCount: number;
  /** Ordered, de-duplicated step kinds — e.g. ["entry","controller","service","database"]. */
  layerChain: string[];
  participatingModules: { id: string; name: string }[];
}

function summarizeFlow(flow: { id: string; name: string; confidence: ConfidenceLevel; entryPointId: string; steps: { kind: string; moduleId: string | null }[] }, moduleById: Map<string, ModuleFact>): FlowSummary {
  const seenKinds = new Set<string>();
  const layerChain: string[] = [];
  const moduleIds = new Set<string>();
  for (const step of flow.steps) {
    if (!seenKinds.has(step.kind)) {
      seenKinds.add(step.kind);
      layerChain.push(step.kind);
    }
    if (step.moduleId) moduleIds.add(step.moduleId);
  }
  return {
    id: flow.id,
    name: flow.name,
    confidence: flow.confidence,
    entryPointId: flow.entryPointId,
    stepCount: flow.steps.length,
    layerChain,
    participatingModules: [...moduleIds].map((id) => ({ id, name: moduleById.get(id)?.name ?? id })),
  };
}

export async function listFlows(args: { worldId?: string; owner?: string; repo?: string }): Promise<{ flows: FlowSummary[] }> {
  const { knowledgeModel, flowModel } = await resolveFlowModel(args);
  const moduleById = new Map(knowledgeModel.modules.map((m) => [m.id, m]));
  return { flows: flowModel.flows.map((f) => summarizeFlow(f, moduleById)) };
}

export async function getFlow(args: { flowId: string; worldId?: string; owner?: string; repo?: string }) {
  const { flowModel } = await resolveFlowModel(args);
  const flow = flowModel.flows.find((f) => f.id === args.flowId || f.name.toLowerCase() === args.flowId.toLowerCase());
  if (!flow) throw new EntityNotFoundError("flow", args.flowId);
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    confidence: flow.confidence,
    evidence: flow.evidence,
    disclosure: "Statically reconstructed likely execution path from real entry points and dependency edges — not a runtime trace of this repository.",
    steps: flow.steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      filePath: s.filePath,
      symbol: s.symbol,
      moduleId: s.moduleId,
      explanation: s.explanation,
      evidence: s.evidence,
      confidence: s.confidence,
    })),
  };
}

export interface DependencyPathResult {
  from: { id: string; name: string };
  to: { id: string; name: string };
  found: boolean;
  path: { id: string; name: string }[];
  method: "bfs-over-deterministic-module-dependency-graph";
  disclosure: string;
}

export async function traceDependencyPath(args: { from: string; to: string; worldId?: string; owner?: string; repo?: string }): Promise<DependencyPathResult> {
  const model = await resolveKnowledgeModel(args);
  const fromMod = findModule(model, args.from);
  const toMod = findModule(model, args.to);
  const moduleById = new Map(model.modules.map((m) => [m.id, m]));

  const path = bfsPath(moduleById, fromMod.id, toMod.id);
  return {
    from: moduleRef(fromMod),
    to: moduleRef(toMod),
    found: path !== null,
    path: (path ?? []).map((id) => ({ id, name: moduleById.get(id)?.name ?? id })),
    method: "bfs-over-deterministic-module-dependency-graph",
    disclosure: path
      ? "This chain of real dependency edges connects the two modules — it does not mean every step in between is on the same request/response cycle at runtime."
      : "No chain of dependency edges connects these two modules in the analyzed repository. That does not prove no relationship exists — only that static import/dependency analysis didn't find one.",
  };
}

function bfsPath(moduleById: Map<string, ModuleFact>, fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [fromId];
  const visited = new Set<string>([fromId]);
  const queue: string[][] = [[fromId]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    const neighbors = moduleById.get(last)?.dependencyIds ?? [];
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === toId) return nextPath;
      visited.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}

export interface ModuleDependenciesResult {
  module: { id: string; name: string };
  dependencies: { id: string; name: string; importance: number }[];
  dependents: { id: string; name: string; importance: number }[];
  /** How many hops the furthest reachable dependency is — 0 if it has none. */
  dependencyDepth: number;
  /** Direct mutual dependency pairs — A depends on B and B depends on A. */
  circularWith: { id: string; name: string }[];
}

export async function getModuleDependencies(args: { moduleId: string; worldId?: string; owner?: string; repo?: string }): Promise<ModuleDependenciesResult> {
  const model = await resolveKnowledgeModel(args);
  const mod = findModule(model, args.moduleId);
  const moduleById = new Map(model.modules.map((m) => [m.id, m]));

  const circularWith = mod.dependencyIds
    .filter((depId) => moduleById.get(depId)?.dependencyIds.includes(mod.id))
    .map((id) => ({ id, name: moduleById.get(id)?.name ?? id }));

  return {
    module: moduleRef(mod),
    dependencies: mod.dependencyIds.map((id) => ({ id, name: moduleById.get(id)?.name ?? id, importance: moduleById.get(id)?.importance ?? 0 })),
    dependents: mod.dependentIds.map((id) => ({ id, name: moduleById.get(id)?.name ?? id, importance: moduleById.get(id)?.importance ?? 0 })),
    dependencyDepth: bfsMaxDepth(moduleById, mod.id),
    circularWith,
  };
}

function bfsMaxDepth(moduleById: Map<string, ModuleFact>, startId: string): number {
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  let depth = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dep of moduleById.get(id)?.dependencyIds ?? []) {
        if (!visited.has(dep)) {
          visited.add(dep);
          next.push(dep);
        }
      }
    }
    if (next.length === 0) break;
    depth += 1;
    frontier = next;
  }
  return depth;
}

export interface FindFeatureResult {
  query: string;
  method: "keyword-heuristic";
  disclosure: string;
  candidateFlows: (FlowSummary & { score: number })[];
  candidateModules: { id: string; name: string; path: string; score: number }[];
  candidateEntryPoints: { id: string; name: string; type: string; score: number }[];
}

/**
 * "How does a user place an order?" -> ranked candidates. This is keyword
 * overlap against flow names/layer chains, module names/paths, and entry
 * point names/evidence — NOT semantic understanding. the agent is expected to be
 * the one that turns this ranked evidence into an actual answer; this tool
 * only narrows down what's likely relevant using deterministic signals.
 */
export async function findFeature(args: { query: string; worldId?: string; owner?: string; repo?: string }): Promise<FindFeatureResult> {
  const { knowledgeModel: model, flowModel } = await resolveFlowModel(args);
  const moduleById = new Map(model.modules.map((m) => [m.id, m]));

  const tokens = args.query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const score = (haystack: string): number => tokens.filter((t) => haystack.toLowerCase().includes(t)).length;

  const candidateFlows = flowModel.flows
    .map((f) => ({ ...summarizeFlow(f, moduleById), score: score(`${f.name} ${f.description} ${f.steps.map((s) => s.label).join(" ")}`) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const candidateModules = model.modules
    .map((m) => ({ id: m.id, name: m.name, path: m.path, score: score(`${m.name} ${m.path} ${m.description ?? ""}`) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const fileById = new Map(model.files.map((f) => [f.id, f]));
  const candidateEntryPoints = model.entryPoints
    .map((e) => ({ id: e.id, name: e.name, type: e.type, score: score(`${e.name} ${e.detectionEvidence} ${fileById.get(e.fileId)?.path ?? ""}`) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    query: args.query,
    method: "keyword-heuristic",
    disclosure:
      "Candidates are ranked by keyword overlap with flow names, module names/paths, and entry-point evidence — not by semantic understanding of the question. Treat a zero-candidate result as 'CodeBiome found no keyword match', not 'this feature doesn't exist'.",
    candidateFlows,
    candidateModules,
    candidateEntryPoints,
  };
}
